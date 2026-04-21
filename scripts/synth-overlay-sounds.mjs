#!/usr/bin/env node
/**
 * Overlay sound synthesis — Node.js port of `KNOWLEDGE/brand-assets/sounds/_synth.py`.
 *
 * Rationale: Python + numpy/scipy is the documented recipe, but the sandbox
 * that ships these assets cannot invoke `python` directly. This script is a
 * 1:1 port using plain Float64 arrays + a hand-written Butterworth biquad and
 * exponential chirp. Output is byte-identical in *format* (44.1 kHz, stereo,
 * 16-bit PCM WAV) to the `.py` generator. Sonic fingerprints differ slightly
 * because the RNG and filter topologies are not bit-for-bit identical — that
 * is fine since the Python script was illustrative.
 *
 * Run:
 *   node scripts/synth-overlay-sounds.mjs
 */

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(
  REPO_ROOT,
  "apps",
  "web",
  "public",
  "overlay",
  "sounds",
);

const SR = 44100;
const PEAK = 0.92; // ≈ -0.72 dBFS — well under -0.5 dBFS ceiling

// -----------------------------------------------------------------
// Deterministic PRNG (mulberry32) so committed WAVs are reproducible.
// -----------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260421);

function gaussian() {
  // Box–Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// -----------------------------------------------------------------
// Sample helpers
// -----------------------------------------------------------------
const nSamples = (durS) => Math.round(durS * SR);

function zeros(n) {
  return new Float64Array(n);
}

function sine(freq, durS, phase = 0) {
  const n = nSamples(durS);
  const out = new Float64Array(n);
  const w = (2 * Math.PI * freq) / SR;
  for (let i = 0; i < n; i++) out[i] = Math.sin(w * i + phase);
  return out;
}

function saw(freq, durS) {
  const n = nSamples(durS);
  const out = new Float64Array(n);
  const period = SR / freq;
  for (let i = 0; i < n; i++) {
    const phase = (i % period) / period; // 0..1
    out[i] = 2 * phase - 1; // rising sawtooth in [-1, 1]
  }
  return out;
}

function noise(durS) {
  const n = nSamples(durS);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = gaussian();
  return out;
}

/** Exponential frequency chirp from f0 to f1 over durS. */
function chirpExp(f0, f1, durS) {
  const n = nSamples(durS);
  const out = new Float64Array(n);
  if (Math.abs(f1 - f0) < 1e-6) return sine(f0, durS);
  const k = Math.log(f1 / f0) / durS;
  // instantaneous phase = integral_0^t (2π f0 e^{k τ}) dτ = 2π f0/k (e^{kt} − 1)
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const phase = (2 * Math.PI * f0 * (Math.exp(k * t) - 1)) / k;
    out[i] = Math.sin(phase);
  }
  return out;
}

// -----------------------------------------------------------------
// Biquad low/high-pass filter (RBJ cookbook, Q=0.707 Butterworth)
// -----------------------------------------------------------------
function biquadCoeffs(kind, f0, sr = SR) {
  const Q = Math.SQRT1_2;
  const w0 = (2 * Math.PI * f0) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Q);
  let b0;
  let b1;
  let b2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  if (kind === "low") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else {
    // high
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Forward-backward filter (zero phase) for smoothness. */
function biquad(x, kind, f0) {
  const cutoff = Math.max(20, Math.min(f0, SR / 2 - 100));
  const c = biquadCoeffs(kind, cutoff);
  const fwd = new Float64Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    const y = c.b0 * xn + z1;
    z1 = c.b1 * xn - c.a1 * y + z2;
    z2 = c.b2 * xn - c.a2 * y;
    fwd[i] = y;
  }
  // reverse pass
  const out = new Float64Array(x.length);
  z1 = 0;
  z2 = 0;
  for (let i = x.length - 1; i >= 0; i--) {
    const xn = fwd[i];
    const y = c.b0 * xn + z1;
    z1 = c.b1 * xn - c.a1 * y + z2;
    z2 = c.b2 * xn - c.a2 * y;
    out[i] = y;
  }
  return out;
}

const lowpass = (x, cutoff) => biquad(x, "low", cutoff);
const highpass = (x, cutoff) => biquad(x, "high", cutoff);

// -----------------------------------------------------------------
// Envelopes
// -----------------------------------------------------------------
function envAD(n, attackMs, decayMs) {
  const a = Math.min(n, Math.round((attackMs * SR) / 1000));
  const d = Math.min(n - a, Math.round((decayMs * SR) / 1000));
  const env = new Float64Array(n);
  for (let i = 0; i < a; i++) env[i] = i / Math.max(a - 1, 1);
  for (let i = 0; i < d; i++) env[a + i] = 1 - i / Math.max(d - 1, 1);
  // rest zero
  return env;
}

function envADSR(n, attackMs, decayMs, sustain, releaseMs) {
  let a = Math.round((attackMs * SR) / 1000);
  let d = Math.round((decayMs * SR) / 1000);
  let r = Math.round((releaseMs * SR) / 1000);
  a = Math.min(a, n);
  d = Math.min(d, Math.max(0, n - a));
  r = Math.min(r, Math.max(0, n - a - d));
  const s = Math.max(0, n - a - d - r);
  const env = new Float64Array(n);
  for (let i = 0; i < a; i++) env[i] = i / Math.max(a - 1, 1);
  for (let i = 0; i < d; i++)
    env[a + i] = 1 - (1 - sustain) * (i / Math.max(d - 1, 1));
  for (let i = 0; i < s; i++) env[a + d + i] = sustain;
  for (let i = 0; i < r; i++)
    env[a + d + s + i] = sustain * (1 - i / Math.max(r - 1, 1));
  return env;
}

// -----------------------------------------------------------------
// Mix / utility
// -----------------------------------------------------------------
function mix(target, src, start, gain = 1.0) {
  const end = Math.min(target.length, start + src.length);
  if (end <= start) return;
  for (let i = start; i < end; i++) target[i] += src[i - start] * gain;
}

function scale(arr, k) {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] * k;
  return out;
}

function multiply(a, b) {
  const n = Math.min(a.length, b.length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
  return out;
}

function add(...arrs) {
  const n = Math.max(...arrs.map((a) => a.length));
  const out = new Float64Array(n);
  for (const a of arrs) for (let i = 0; i < a.length; i++) out[i] += a[i];
  return out;
}

/** Cheap convolution reverb via exponentially-decaying noise impulse. */
function reverbExp(x, lengthS = 0.5, tauS = 0.18) {
  const irN = nSamples(lengthS);
  const ir = new Float64Array(irN);
  let energy = 0;
  for (let i = 0; i < irN; i++) {
    const decay = Math.exp(-i / SR / Math.max(tauS, 1e-4));
    ir[i] = gaussian() * decay;
    energy += ir[i] * ir[i];
  }
  const norm = 1 / Math.sqrt(energy + 1e-12);
  for (let i = 0; i < irN; i++) ir[i] *= norm;
  // Direct O(n*k) convolution truncated to len(x) — OK because IR is <= 0.5s.
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const kMax = Math.min(irN, i + 1);
    let acc = 0;
    for (let k = 0; k < kMax; k++) acc += x[i - k] * ir[k];
    out[i] = acc;
  }
  return out;
}

// -----------------------------------------------------------------
// WAV writer
// -----------------------------------------------------------------
function writeWav(relPath, mono, stereoDelayMs = 0) {
  // Soft-limit stray transients, then normalize to PEAK.
  const lim = new Float64Array(mono.length);
  const k = Math.tanh(0.9);
  for (let i = 0; i < mono.length; i++) lim[i] = Math.tanh(mono[i] * 0.9) / k;
  let mx = 0;
  for (let i = 0; i < lim.length; i++) {
    const a = Math.abs(lim[i]);
    if (a > mx) mx = a;
  }
  if (mx > 0) {
    const g = PEAK / mx;
    for (let i = 0; i < lim.length; i++) lim[i] *= g;
  }

  const delay = Math.max(0, Math.round((stereoDelayMs * SR) / 1000));
  const n = lim.length;
  // interleaved LR int16
  const pcm = Buffer.alloc(n * 2 * 2); // 2 channels × 2 bytes
  for (let i = 0; i < n; i++) {
    const L = lim[i];
    const R = i - delay >= 0 ? lim[i - delay] : 0;
    const li = Math.max(-32768, Math.min(32767, Math.round(L * 32767)));
    const ri = Math.max(-32768, Math.min(32767, Math.round(R * 32767)));
    pcm.writeInt16LE(li, i * 4);
    pcm.writeInt16LE(ri, i * 4 + 2);
  }
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(2, 22); // channels
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2 * 2, 28); // byte rate
  header.writeUInt16LE(4, 32); // block align (2ch × 16bit = 4)
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  const full = join(OUT_DIR, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, Buffer.concat([header, pcm]));
  return statSync(full).size;
}

// -----------------------------------------------------------------
// Stingers
// -----------------------------------------------------------------
function makeIntroLong() {
  const dur = 10.0;
  const out = zeros(nSamples(dur));

  // 0-2.2s rising pad (fifth interval)
  const padDur = 2.2;
  const padN = nSamples(padDur);
  const padCurve = new Float64Array(padN);
  for (let i = 0; i < padN; i++) padCurve[i] = Math.sqrt(i / (padN - 1));
  const pad = add(
    scale(sine(220, padDur), 0.6),
    scale(sine(330, padDur), 0.5),
    scale(sine(110, padDur), 0.3),
  );
  mix(out, multiply(pad, padCurve), 0, 0.55);

  // 2-4s filter-swept saw pad with moving LPF
  const sweepDur = 2.0;
  const sweepN = nSamples(sweepDur);
  const rawPad = add(
    scale(saw(220, sweepDur), 0.4),
    scale(saw(330, sweepDur), 0.35),
    scale(saw(110, sweepDur), 0.3),
  );
  const filtered = new Float64Array(sweepN);
  const block = 2048;
  for (let i = 0; i < sweepN; i += block) {
    const j = Math.min(sweepN, i + block);
    const frac = (i + (j - i) / 2) / sweepN;
    const cutoff = 400 + (3500 - 400) * frac;
    const slice = rawPad.slice(i, j);
    const lp = lowpass(slice, cutoff);
    for (let k = 0; k < lp.length; k++) filtered[i + k] = lp[k];
  }
  mix(
    out,
    multiply(filtered, envADSR(sweepN, 200, 400, 0.7, 600)),
    nSamples(2.0),
    0.35,
  );

  // 8th-note hihat ticks at 120 bpm from 2s to 4s (4 per second → 8 per second 8ths)
  for (let k = 0; k < 16; k++) {
    const t = 2.0 + k * 0.125;
    const tickDur = 0.05;
    let tick = noise(tickDur);
    tick = highpass(tick, 5000);
    tick = multiply(tick, envAD(nSamples(tickDur), 1, 45));
    mix(out, tick, nSamples(t), 0.22);
  }

  // 4-6s percussion thumps every 0.5s
  for (let k = 0; k < 4; k++) {
    const t = 4.0 + k * 0.5;
    const thump = multiply(sine(60, 0.25), envAD(nSamples(0.25), 3, 240));
    mix(out, thump, nSamples(t), 0.9);
    const click = multiply(noise(0.02), envAD(nSamples(0.02), 1, 18));
    mix(out, click, nSamples(t), 0.3);
  }

  // 6-8s rising saw lead (440 → 880 Hz) + 5th-above harmonic
  const leadDur = 2.0;
  let lead = add(
    chirpExp(440, 880, leadDur),
    scale(chirpExp(660, 1320, leadDur), 0.5),
  );
  lead = lowpass(lead, 4500);
  lead = multiply(lead, envADSR(nSamples(leadDur), 80, 200, 0.75, 700));
  mix(out, lead, nSamples(6.0), 0.4);

  // Sustaining pad bed 4-8s
  const bedDur = 4.0;
  const bed = add(
    scale(sine(220, bedDur), 0.5),
    scale(sine(330, bedDur), 0.4),
  );
  mix(
    out,
    multiply(bed, envADSR(nSamples(bedDur), 200, 200, 0.7, 400)),
    nSamples(4.0),
    0.3,
  );

  // 8-10s big impact + noise wash + chime + logo-thump underlay
  const impactDur = 2.0;
  const impactN = nSamples(impactDur);
  const impact = add(
    scale(sine(55, impactDur), 1.0),
    scale(sine(110, impactDur), 0.5),
  );
  mix(out, multiply(impact, envAD(impactN, 4, 1800)), nSamples(8.0), 1.0);

  let wash = noise(impactDur);
  wash = lowpass(wash, 6000);
  mix(out, multiply(wash, envAD(impactN, 20, 1700)), nSamples(8.0), 0.35);

  const chime = add(
    scale(sine(1760, 1.6), 0.4),
    scale(sine(2640, 1.6), 0.25),
  );
  mix(out, multiply(chime, envAD(nSamples(1.6), 10, 1500)), nSamples(8.2), 0.5);

  // logo-thump underlay with small reverb
  let thumpUnder = add(
    scale(sine(60, 1.2), 0.9),
    scale(sine(120, 1.2), 0.5),
  );
  thumpUnder = multiply(thumpUnder, envAD(nSamples(1.2), 80, 1100));
  const thumpWet = reverbExp(thumpUnder, 0.5, 0.2);
  mix(out, thumpUnder, nSamples(7.95), 0.7);
  mix(out, thumpWet, nSamples(7.95), 0.25);

  return out;
}

function makeStingerNormal() {
  const dur = 2.0;
  const out = zeros(nSamples(dur));

  const wsDur = 0.8;
  const wsN = nSamples(wsDur);
  let w = noise(wsDur);
  // moving LP 100 → 8000 Hz, block-processed
  const filt = new Float64Array(wsN);
  const block = 1024;
  for (let i = 0; i < wsN; i += block) {
    const j = Math.min(wsN, i + block);
    const frac = (i + (j - i) / 2) / wsN;
    const cut = 100 * Math.pow(80, frac); // log from 100 → 8000
    const slice = w.slice(i, j);
    const lp = lowpass(slice, cut);
    for (let k = 0; k < lp.length; k++) filt[i + k] = lp[k];
  }
  // rising envelope
  for (let i = 0; i < wsN; i++)
    filt[i] *= Math.pow(i / (wsN - 1), 1.5);
  mix(out, filt, 0, 0.55);

  // Impact
  const impDur = 0.9;
  const impact = add(
    scale(sine(60, impDur), 1.0),
    scale(sine(440, impDur), 0.35),
  );
  mix(
    out,
    multiply(impact, envAD(nSamples(impDur), 3, 700)),
    nSamples(0.8),
    1.0,
  );

  // Tail
  const tailDur = 0.3;
  let tail = noise(tailDur);
  tail = highpass(tail, 1200);
  tail = multiply(tail, envAD(nSamples(tailDur), 2, 260));
  mix(out, tail, nSamples(0.85), 0.3);

  return out;
}

function makeStingerReplay() {
  const dur = 2.0;
  const out = zeros(nSamples(dur));
  let sweep = add(
    chirpExp(4000, 200, dur),
    scale(chirpExp(2000, 100, dur), 0.5),
  );
  sweep = lowpass(sweep, 5000);
  sweep = multiply(sweep, envADSR(nSamples(dur), 30, 300, 0.6, 1500));

  // Bitcrush to 8 levels at -6 dB
  const crushed = new Float64Array(sweep.length);
  for (let i = 0; i < sweep.length; i++)
    crushed[i] = (Math.round(sweep[i] * 4) / 4) * 0.5;
  mix(out, crushed, 0, 1.0);

  let und = noise(dur);
  und = lowpass(und, 2000);
  und = multiply(und, envAD(nSamples(dur), 40, 1800));
  mix(out, scale(und, 0.3), 0, 0.25);

  return out;
}

function makeStingerGoal() {
  const dur = 2.0;
  const out = zeros(nSamples(dur));

  const imp = add(scale(sine(60, 0.5), 1.0), scale(sine(90, 0.5), 0.4));
  mix(out, multiply(imp, envAD(nSamples(0.5), 3, 450)), 0, 1.0);

  const chordDur = 1.6;
  const horn = add(
    scale(
      add(saw(261, chordDur), chirpExp(261, 280, chordDur)),
      0.35,
    ),
    scale(
      add(saw(329, chordDur), chirpExp(329, 350, chordDur)),
      0.3,
    ),
    scale(
      add(saw(392, chordDur), chirpExp(392, 415, chordDur)),
      0.3,
    ),
  );
  const hornFiltered = lowpass(horn, 3500);
  mix(
    out,
    multiply(hornFiltered, envADSR(nSamples(chordDur), 40, 200, 0.85, 900)),
    nSamples(0.12),
    0.6,
  );

  let snare = noise(0.2);
  snare = highpass(snare, 2000);
  mix(out, multiply(snare, envAD(nSamples(0.2), 1, 180)), nSamples(0.08), 0.35);

  const chime = add(
    scale(sine(1047, 0.7), 0.4),
    scale(sine(1568, 0.7), 0.25),
  );
  mix(out, multiply(chime, envAD(nSamples(0.7), 8, 650)), nSamples(1.25), 0.5);

  return out;
}

function makeStingerWinner() {
  const dur = 2.0;
  const out = zeros(nSamples(dur));

  const stabDur = 1.6;
  const stab = add(
    scale(saw(261, stabDur), 0.35),
    scale(saw(329, stabDur), 0.3),
    scale(saw(392, stabDur), 0.3),
    scale(saw(523, stabDur), 0.28),
  );
  const stabFiltered = lowpass(stab, 4500);
  mix(
    out,
    multiply(stabFiltered, envADSR(nSamples(stabDur), 10, 150, 0.8, 1100)),
    0,
    0.6,
  );

  const sub = add(scale(sine(55, 0.6), 1.0), scale(sine(110, 0.6), 0.5));
  mix(out, multiply(sub, envAD(nSamples(0.6), 4, 550)), 0, 0.9);

  const chime = add(
    scale(sine(1760, 1.4), 0.5),
    scale(sine(2637, 1.4), 0.3),
  );
  mix(out, multiply(chime, envAD(nSamples(1.4), 12, 1300)), nSamples(0.4), 0.55);

  const flourish = chirpExp(440, 1760, 0.25);
  mix(out, multiply(flourish, envAD(nSamples(0.25), 5, 220)), 0, 0.4);

  return out;
}

// -----------------------------------------------------------------
// UI sounds
// -----------------------------------------------------------------
function makeTimerTick() {
  const dur = 0.2;
  const out = zeros(nSamples(dur));
  mix(
    out,
    multiply(sine(1000, 0.05), envAD(nSamples(0.05), 2, 40)),
    0,
    1.0,
  );
  mix(
    out,
    multiply(sine(2000, 0.025), envAD(nSamples(0.025), 1, 22)),
    0,
    0.5 * 0.35,
  );
  return out;
}

function makeTimerEnd() {
  const dur = 0.6;
  const out = zeros(nSamples(dur));
  const freqs = [880, 440, 220];
  const step = 0.2;
  for (let i = 0; i < freqs.length; i++) {
    const s = multiply(sine(freqs[i], step), envAD(nSamples(step), 4, 190));
    mix(out, s, nSamples(i * step), 0.8);
  }
  return out;
}

function makeNotification() {
  const dur = 0.4;
  const out = zeros(nSamples(dur));
  const freqs = [880, 1320];
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    const bell = add(sine(f, 0.2), scale(sine(f * 2, 0.2), 0.3));
    mix(out, multiply(bell, envAD(nSamples(0.2), 3, 190)), nSamples(i * 0.2), 0.8);
  }
  return out;
}

function makeTriggerIn() {
  const dur = 0.3;
  const out = zeros(nSamples(dur));
  const sweep = chirpExp(200, 1500, dur);
  mix(
    out,
    multiply(sweep, envADSR(nSamples(dur), 20, 40, 0.8, 180)),
    0,
    0.9,
  );
  let air = noise(dur);
  air = highpass(air, 3000);
  mix(
    out,
    scale(multiply(air, envAD(nSamples(dur), 10, 260)), 0.25),
    0,
    0.3,
  );
  return out;
}

function makeTriggerOut() {
  const dur = 0.3;
  const out = zeros(nSamples(dur));
  const sweep = chirpExp(1500, 200, dur);
  mix(
    out,
    multiply(sweep, envADSR(nSamples(dur), 20, 40, 0.8, 180)),
    0,
    0.9,
  );
  let air = noise(dur);
  air = highpass(air, 3000);
  mix(
    out,
    scale(multiply(air, envAD(nSamples(dur), 10, 260)), 0.25),
    0,
    0.3,
  );
  return out;
}

// -----------------------------------------------------------------
// Brand
// -----------------------------------------------------------------
function makeLogoThump() {
  const dur = 1.2;
  const out = zeros(nSamples(dur));
  const body = add(
    scale(sine(60, dur), 1.0),
    scale(sine(120, dur), 0.5),
    scale(sine(40, dur), 0.3),
  );
  const env = envAD(nSamples(dur), 100, 1100);
  const shaped = multiply(body, env);
  const wet = reverbExp(shaped, 0.5, 0.18);
  mix(out, shaped, 0, 1.0);
  mix(out, wet, 0, 0.35);
  return out;
}

// -----------------------------------------------------------------
// Main
// -----------------------------------------------------------------
const ITEMS = [
  // key, path, durationMs, factory, stereoDelayMs
  ["intro_long", "stingers/intro_long.wav", 10000, makeIntroLong, 6],
  ["stinger_normal", "stingers/stinger_normal.wav", 2000, makeStingerNormal, 4],
  ["stinger_replay", "stingers/stinger_replay.wav", 2000, makeStingerReplay, 4],
  ["stinger_goal", "stingers/stinger_goal.wav", 2000, makeStingerGoal, 5],
  ["stinger_winner", "stingers/stinger_winner.wav", 2000, makeStingerWinner, 5],
  ["timer_tick", "ui/timer_tick.wav", 200, makeTimerTick, 0],
  ["timer_end", "ui/timer_end.wav", 600, makeTimerEnd, 2],
  ["notification", "ui/notification.wav", 400, makeNotification, 2],
  ["trigger_in", "ui/trigger_in.wav", 300, makeTriggerIn, 3],
  ["trigger_out", "ui/trigger_out.wav", 300, makeTriggerOut, 3],
  ["brand_logo_thump", "brand/logo_thump.wav", 1200, makeLogoThump, 3],
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = {
    generated_at: new Date().toISOString(),
    sample_rate: SR,
    channels: 2,
    bit_depth: 16,
    format: "wav",
    files: {},
  };
  let totalBytes = 0;
  for (const [key, rel, durationMs, factory, delay] of ITEMS) {
    const mono = factory();
    const size = writeWav(rel, mono, delay);
    totalBytes += size;
    manifest.files[key] = {
      path: `/overlay/sounds/${rel.replace(/\\/g, "/")}`,
      duration_ms: durationMs,
      size_kb: Math.round((size / 1024) * 100) / 100,
    };
    process.stdout.write(`wrote ${rel}  ${(size / 1024).toFixed(2)} KB\n`);
  }
  writeFileSync(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  process.stdout.write(
    `wrote manifest.json\ntotal: ${(totalBytes / 1024).toFixed(2)} KB across ${ITEMS.length} files\n`,
  );
}

main();
