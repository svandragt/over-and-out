import { crushCurve } from './crush.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const setStatus = (text) => { statusEl.textContent = text; };

let ctx, pttGain, shaper, noiseBuffer, dest;
let pressed = false;

function buildGraph(stream) {
  ctx = new AudioContext();
  const mic = ctx.createMediaStreamSource(stream);
  const high = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 300 });
  const low = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3000 });
  const drive = new GainNode(ctx, { gain: 2 });
  shaper = new WaveShaperNode(ctx, { curve: crushCurve(4) });
  pttGain = new GainNode(ctx, { gain: 0 });
  dest = ctx.createMediaStreamDestination();
  // tanh soft clip; raise k for more grit
  const k = 3;
  const fuzz = new WaveShaperNode(ctx, {
    curve: Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(k * (i / 511.5 - 1)) / Math.tanh(k)),
    oversample: '2x',
  });
  mic.connect(high).connect(low).connect(drive).connect(fuzz).connect(shaper).connect(pttGain).connect(dest);

  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const hiss = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer, loop: true });
  hiss.connect(new GainNode(ctx, { gain: 0.04 })).connect(shaper);
  hiss.start();
}

function press() {
  if (pressed) return;
  pressed = true;
  $('ptt').setAttribute('aria-pressed', 'true');
  pttGain.gain.cancelScheduledValues(ctx.currentTime);
  pttGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
}

function release() {
  if (!pressed) return;
  pressed = false;
  $('ptt').setAttribute('aria-pressed', 'false');
  const now = ctx.currentTime;
  const burst = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer });
  const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1500, Q: 1 });
  const env = new GainNode(ctx, { gain: 0.9 });
  env.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
  burst.connect(band).connect(env).connect(shaper);
  burst.start(now);
  burst.stop(now + 0.3);
  pttGain.gain.cancelScheduledValues(now);
  pttGain.gain.setValueAtTime(1, now);
  pttGain.gain.setValueAtTime(0, now + 0.28);
}

function bindPtt() {
  const btn = $('ptt');
  btn.addEventListener('pointerdown', (e) => { btn.setPointerCapture(e.pointerId); press(); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(t, release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  const inInput = () => document.activeElement?.tagName === 'INPUT';
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || inInput()) return;
    e.preventDefault();
    press();
  });
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || inInput()) return;
    e.preventDefault();
    release();
  });
}

function wireCall(call) {
  call.on('stream', (remote) => {
    const audio = $('remote');
    audio.srcObject = remote;
    audio.play();
    setStatus('Connected');
  });
  call.on('close', () => setStatus('Disconnected'));
}

function showShare(id) {
  const link = $('link');
  link.value = location.origin + location.pathname + '#' + id;
  $('share').hidden = false;
  $('copy').addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ url: link.value });
      else await navigator.clipboard.writeText(link.value);
    } catch {
      link.select();
    }
  });
}

function startPeer() {
  const guestOf = location.hash.slice(1);
  const peer = new Peer();
  let current = null;
  peer.on('error', (err) => {
    setStatus(err.type === 'peer-unavailable'
      ? 'That channel is off the air'
      : `Disconnected (${err.type})`);
  });
  if (guestOf) {
    peer.on('open', () => {
      setStatus('Calling…');
      current = peer.call(guestOf, dest.stream);
      wireCall(current);
    });
    return;
  }
  peer.on('open', (id) => { showShare(id); setStatus('Waiting for someone to join'); });
  peer.on('call', (call) => {
    if (current) { call.close(); return; }
    current = call;
    call.on('close', () => { current = null; });
    call.answer(dest.stream);
    wireCall(call);
  });
}

const ua = navigator.userAgent;
const os = /iPhone|iPad|iPod/.test(ua) ? 'ios'
  : /Android/.test(ua) ? 'android'
  : /Mac/.test(ua) ? 'mac'
  : /Windows/.test(ua) ? 'windows'
  : 'linux';

const siteFix = {
  ios: 'In Safari, tap aA in the address bar, then Website Settings, and set Microphone to Allow.',
  android: 'Tap the icon left of the address, open Permissions, and allow Microphone.',
}[os] ?? 'Click the icon left of the address bar, set Microphone to Allow, then reload.';

const systemFix = {
  ios: 'Also check Settings → your browser → Microphone.',
  android: 'Also check Settings → Apps → your browser → Permissions → Microphone.',
  mac: 'Also check System Settings → Privacy & Security → Microphone, turn on your browser, then restart it.',
  windows: 'Also check Settings → Privacy & security → Microphone, and allow your browser.',
  linux: 'Also check Settings → Privacy → Microphone. A Flatpak or Snap browser needs microphone access too (Flatseal, or snap connect <browser>:audio-record).',
}[os];

function micHelp(err) {
  switch (err.name) {
    case 'NotAllowedError': return `${siteFix} ${systemFix}`;
    case 'NotFoundError': return 'No microphone was found. Plug one in or turn it on, then try again.';
    case 'NotReadableError': return `Another app may be using the microphone, so close calls or recorders and try again. ${systemFix}`;
    default: return window.isSecureContext ? err.message : 'Open the https:// address of this page.';
  }
}

$('tune').addEventListener('click', async () => {
  $('tune').hidden = true;
  $('help').hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    buildGraph(stream);
    await ctx.resume();
  } catch (err) {
    setStatus(`Microphone unavailable (${err.name})`);
    $('help').textContent = micHelp(err);
    $('help').hidden = false;
    $('tune').hidden = false;
    return;
  }
  $('ptt').hidden = false;
  $('hint').hidden = false;
  bindPtt();
  startPeer();
});
