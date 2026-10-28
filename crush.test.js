import { test } from 'node:test';
import assert from 'node:assert';
import { crushCurve } from './crush.js';

test('crushCurve(4) is a stepped, monotonic curve from -1 to 1', () => {
  const c = crushCurve(4);
  assert.ok(c instanceof Float32Array);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1]);
  assert.ok(Math.abs(c[0] + 1) < 1e-6);
  assert.ok(Math.abs(c[c.length - 1] - 1) < 1e-6);
  assert.strictEqual(new Set(c).size, 2 ** 4);
});
