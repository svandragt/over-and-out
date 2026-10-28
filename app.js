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

function wireCall(call, onEnd) {
  call.on('stream', (remote) => {
    const audio = $('remote');
    audio.srcObject = remote;
    audio.play();
    setStatus('Connected');
    $('new-channel').hidden = true;
    // PeerJS often skips 'close' when the other tab vanishes; the RTC state still changes
    const pc = call.peerConnection;
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      if (s === 'connected') setStatus('Connected');
      else if (s === 'disconnected') {
        setStatus('Signal lost…');
        // a refreshed tab shows as 'disconnected' long before 'failed', so don't wait for that
        setTimeout(() => pc.connectionState === 'connected' || call.close(), 5000);
      } else if (s === 'failed' || s === 'closed') call.close();
    });
  });
  call.on('close', () => { setStatus('Disconnected'); onEnd?.(); });
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

const CHANNEL_TTL = 2 * 60 * 1000;

function loadChannel() {
  try {
    const { id, t } = JSON.parse(localStorage.getItem('channel'));
    return Date.now() - t < CHANNEL_TTL ? id : undefined;
  } catch {
    return undefined;
  }
}

function saveChannel(id) {
  try { localStorage.setItem('channel', JSON.stringify({ id, t: Date.now() })); } catch {}
}

let peer;

// a sleeping tab loses the broker socket; reconnecting keeps the same ID so the link still works
function keepRegistered(p) {
  p.on('disconnected', () => setTimeout(() => p.destroyed || p.reconnect(), 2000));
}

function guest(hostId) {
  peer = new Peer();
  keepRegistered(peer);
  let timer;
  // keep redialling so the call resumes when a refreshed host comes back on its saved ID
  const redial = () => { clearTimeout(timer); timer = setTimeout(dial, 3000); };
  const dial = () => {
    setStatus('Calling…');
    const call = peer.call(hostId, dest.stream);
    if (call) wireCall(call, redial); else redial();
  };
  peer.once('open', dial);
  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      setStatus('That channel is off the air, retrying…');
      $('new-channel').hidden = false;
      redial();
    }
    else setStatus(`Disconnected (${err.type})`);
  });
}

function host(id = loadChannel(), tries = 0) {
  const p = peer = new Peer(id);
  keepRegistered(p);
  let current = null;
  p.on('error', (err) => {
    if (err.type !== 'unavailable-id') return setStatus(`Disconnected (${err.type})`);
    // the broker holds a dropped ID for a few seconds, so retry before taking a new one
    setStatus('Reclaiming your channel…');
    p.destroy();
    setTimeout(() => host(tries < 5 ? id : undefined, tries + 1), 2000);
  });
  p.once('open', (id) => {
    saveChannel(id);
    setInterval(() => saveChannel(id), 15_000);
    showShare(id);
    setStatus('Waiting for someone to join');
  });
  p.on('call', (call) => {
    // newest caller wins: a reloading guest rejoins before the old link is seen as dead
    // shortcut: anyone with the link can bump the other guest, fine for a two-person toy
    current?.close();
    current = call;
    call.on('close', () => { if (current === call) current = null; });
    call.answer(dest.stream);
    wireCall(call);
  });
}

function startPeer() {
  const hostId = location.hash.slice(1);
  if (hostId) guest(hostId); else host();
  addEventListener('pagehide', () => peer.destroy());
}

// GitHub Pages runs Jekyll, which fills in the commit; a local server serves the raw template
fetch('version.txt', { cache: 'no-store' }).then((r) => r.text()).then((t) => {
  $('version').textContent = t.includes('{{') ? 'dev' : `v ${t.trim().slice(0, 7)}`;
}).catch(() => {});

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
