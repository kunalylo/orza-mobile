#!/usr/bin/env node
/**
 * Synthesises ÖRZA's medicine-alarm tone as a WAV file (no dependencies — plain Node).
 *
 *   node scripts/make-alarm-sound.mjs
 *
 * Output: assets/sounds/orza_alarm.wav — 6 s, 16-bit PCM, mono, 44.1 kHz.
 *
 * The tone is three soft "ding-dong" chimes (A5 → E5, a perfect fourth) with a bell-like timbre: a fundamental plus a
 * few gently inharmonic partials, a 12 ms attack (no click) and an exponential decay. It starts and ends in silence, so
 * Android's FLAG_INSISTENT can loop it until the alarm is answered without an audible seam, and it stays well under
 * iOS's 30 s notification-sound limit (linear PCM in a .wav container is an accepted iOS format).
 *
 * The file name becomes the Android raw resource `orza_alarm` (expo-notifications plugin `sounds`), which the
 * orza-alarms native module looks up by name; iOS uses the bundled file name `orza_alarm.wav`.
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44_100;
const DURATION_S = 6;
const PEAK = 0.72; // ≈ −3 dBFS: loud enough to wake, no clipping on small speakers
const FADE_OUT_S = 0.35;

/** [start s, frequency Hz, gain] — ding (A5) then dong (E5), three times. */
const NOTES = [
  [0.0, 880.0, 1.0],
  [0.42, 659.25, 0.9],
  [1.85, 880.0, 1.0],
  [2.27, 659.25, 0.9],
  [3.7, 880.0, 1.0],
  [4.12, 659.25, 0.95],
];

/** Bell partials: [frequency ratio, relative gain, decay multiplier] (higher partials die faster). */
const PARTIALS = [
  [1.0, 1.0, 1.0],
  [2.0, 0.32, 0.62],
  [2.76, 0.14, 0.45],
  [3.0, 0.1, 0.4],
  [4.07, 0.05, 0.3],
];

const ATTACK_S = 0.012;
const DECAY_TAU_S = 0.62;

const total = Math.round(SAMPLE_RATE * DURATION_S);
const mix = new Float64Array(total);

for (const [start, freq, gain] of NOTES) {
  const first = Math.round(start * SAMPLE_RATE);
  for (let i = first; i < total; i++) {
    const t = (i - first) / SAMPLE_RATE;
    const attack = t < ATTACK_S ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ATTACK_S) : 1; // raised-cosine fade-in
    let sample = 0;
    for (const [ratio, partialGain, decayMul] of PARTIALS) {
      const env = Math.exp(-t / (DECAY_TAU_S * decayMul));
      if (env < 1e-5) continue;
      sample += partialGain * env * Math.sin(2 * Math.PI * freq * ratio * t);
    }
    // A slow 5 Hz shimmer keeps the bell from sounding like a pure beep.
    sample *= 1 + 0.04 * Math.sin(2 * Math.PI * 5 * t);
    mix[i] += gain * attack * sample;
  }
}

// Gentle fade-out so the loop point is silent.
const fadeStart = total - Math.round(FADE_OUT_S * SAMPLE_RATE);
for (let i = fadeStart; i < total; i++) {
  const k = (total - i) / (total - fadeStart);
  mix[i] *= 0.5 - 0.5 * Math.cos(Math.PI * k);
}
mix[0] = 0;
mix[total - 1] = 0;

// Normalise to PEAK.
let max = 0;
for (const v of mix) max = Math.max(max, Math.abs(v));
const scale = max > 0 ? PEAK / max : 0;

const dataBytes = total * 2;
const buf = Buffer.alloc(44 + dataBytes);
buf.write('RIFF', 0, 'ascii');
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write('WAVE', 8, 'ascii');
buf.write('fmt ', 12, 'ascii');
buf.writeUInt32LE(16, 16); // fmt chunk size
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(SAMPLE_RATE, 24);
buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
buf.writeUInt16LE(2, 32); // block align
buf.writeUInt16LE(16, 34); // bits per sample
buf.write('data', 36, 'ascii');
buf.writeUInt32LE(dataBytes, 40);
for (let i = 0; i < total; i++) {
  const v = Math.max(-1, Math.min(1, mix[i] * scale));
  buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'assets', 'sounds', 'orza_alarm.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`Wrote ${out} (${(buf.length / 1024).toFixed(0)} KB, ${DURATION_S} s, ${SAMPLE_RATE} Hz mono 16-bit)`);
