// Stepped transfer curve for a WaveShaperNode: quantises -1..1 to 2**bits levels.
export function crushCurve(bits, samples = 1024) {
  const levels = 2 ** bits;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = (Math.round(((x + 1) / 2) * (levels - 1)) / (levels - 1)) * 2 - 1;
  }
  return curve;
}
