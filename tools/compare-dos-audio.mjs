/* compare-dos-audio.mjs — measures this port's OPL2 renderer against a real
 * DOSBox audio capture of GODS itself.
 *
 * This exists because "sounds right" is otherwise unfalsifiable. The port's
 * OPL2 core (src/audio/opl2-core.js) models the chip's documented behaviour
 * exactly where it is documented, but its absolute envelope time constants
 * and its two phase-modulation depth scales are fitted, and this is what
 * they were fitted against.
 *
 * How to make a reference, and why it is made this way. An early attempt
 * captured attract-mode gameplay and picked out an isolated event — but
 * which blob produced it was a GUESS, so any fit against it would have been
 * fitting to an assumption. (That guess was in fact wrong about the sound's
 * character: the attract event measured a spectral centroid of 510 Hz where
 * blob 28, played deliberately, measures 1743 Hz.) The reference is instead
 * produced with no attribution step at all:
 *
 *   1. Start DOSBox with sound (bridge config mute=false, headless=false)
 *      and leave it at a bare DOS prompt — no program running, so nothing
 *      else can touch the chip.
 *   2. Write the blob's OWN decoded registers straight to ports 0x388/0x389,
 *      followed by its own F-number/block and a key-on. Key OFF first: the
 *      key-on bit must transition 0->1 to retrigger, and a previous test
 *      leaving it set is silent in a way that looks like a broken rig.
 *   3. Capture with DOSBox's own video capture, extract the audio track with
 *      ffmpeg, and trim to the one event.
 *
 * That makes the reference DOSBox's own OPL2 rendering the exact same
 * instrument this port is rendering — the comparison has no unknowns left
 * in it.
 *
 * Usage: node tools/compare-dos-audio.mjs <reference.wav> [blobIndex]
 * The reference wav must be a mono PCM16 extract of just that one event.
 */

import fs from 'fs';
import { dclDecompress } from '../src/formats/dcl.js';
import { parseMusContainer } from '../src/audio/mus-container.js';
import { buildSfxSequence } from '../src/audio/sfx-sequence.js';
import { renderSequence, OPL_RATE } from '../src/audio/opl2-core.js';

function readWavMono(path) {
  const buf = fs.readFileSync(path);
  let p = 12, rate = 48000, dataOff = 0, dataLen = 0, channels = 1;
  while (p < buf.length - 8) {
    const id = buf.toString('ascii', p, p + 4);
    const sz = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(p + 10); rate = buf.readUInt32LE(p + 12); }
    if (id === 'data') { dataOff = p + 8; dataLen = sz; break; }
    p += 8 + sz + (sz & 1);
  }
  const frames = Math.floor(dataLen / 2 / channels);
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = buf.readInt16LE(dataOff + i * channels * 2) / 32768;
  return { x, rate };
}

/** Amplitude envelope in fixed-length frames, normalized to its own peak. */
function envelope(x, rate, frameSec = 0.005) {
  const W = Math.max(1, Math.round(rate * frameSec));
  const env = [];
  for (let i = 0; i + W <= x.length; i += W) {
    let s = 0;
    for (let j = 0; j < W; j++) s += x[i + j] * x[i + j];
    env.push(Math.sqrt(s / W));
  }
  const pk = Math.max(...env, 1e-12);
  return env.map((v) => v / pk);
}

/** Spectral centroid and the -6 dB bandwidth around the dominant peak. */
function spectrum(x, rate, fromHz = 20, toHz = 4000, stepHz = 2) {
  const N = Math.min(x.length, Math.round(rate * 0.06));
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const bins = [];
  for (let f = fromHz; f <= toHz; f += stepHz) {
    let re = 0, im = 0;
    const k = (2 * Math.PI * f) / rate;
    for (let i = 0; i < N; i++) { re += w[i] * Math.cos(k * i); im -= w[i] * Math.sin(k * i); }
    bins.push([f, Math.hypot(re, im) / N]);
  }
  const peak = bins.reduce((a, b) => (b[1] > a[1] ? b : a));
  const half = peak[1] * 0.5;
  const above = bins.filter(([, m]) => m >= half);
  const totalMag = bins.reduce((s, [, m]) => s + m, 0) || 1;
  const centroid = bins.reduce((s, [f, m]) => s + f * m, 0) / totalMag;
  return {
    peakHz: peak[0],
    centroidHz: centroid,
    bandwidthHz: above.length ? above[above.length - 1][0] - above[0][0] : 0,
  };
}

/** Time in seconds for the envelope to fall to 25% of peak and stay there. */
function decayToQuarter(env, frameSec = 0.005) {
  let last = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > 0.25) last = i;
  return last * frameSec;
}

const refPath = process.argv[2];
const blobIndex = Number(process.argv[3] ?? 28);
if (!refPath) {
  console.error('usage: node tools/compare-dos-audio.mjs <reference.wav> [blobIndex]');
  process.exit(2);
}

const musPath = new URL('../game/PGODS.MUS', import.meta.url);
const blobs = parseMusContainer(dclDecompress(fs.readFileSync(musPath)).data);
const seq = buildSfxSequence(blobs[blobIndex]);
const mine = renderSequence(seq);
const ref = readWavMono(refPath);

const refEnv = envelope(ref.x, ref.rate);
const myEnv = envelope(mine, OPL_RATE);
const refSpec = spectrum(ref.x, ref.rate);
const mySpec = spectrum(mine, OPL_RATE);

const notes = seq.notes.map((n) => `n${n.note}@${n.timeSec.toFixed(3)}s/${n.durSec.toFixed(3)}s`).join(' ');
console.log(`blob ${blobIndex}: ${seq.notes.length} note(s) — ${notes}`);
console.log('');
console.log(`                      DOSBox      this port`);
console.log(`  dominant peak    ${refSpec.peakHz.toFixed(0).padStart(7)} Hz  ${mySpec.peakHz.toFixed(0).padStart(7)} Hz`);
console.log(`  spectral centroid${refSpec.centroidHz.toFixed(0).padStart(7)} Hz  ${mySpec.centroidHz.toFixed(0).padStart(7)} Hz`);
console.log(`  -6dB bandwidth   ${refSpec.bandwidthHz.toFixed(0).padStart(7)} Hz  ${mySpec.bandwidthHz.toFixed(0).padStart(7)} Hz`);
console.log(`  decay to 25%     ${decayToQuarter(refEnv).toFixed(3).padStart(7)} s   ${decayToQuarter(myEnv).toFixed(3).padStart(7)} s`);
console.log('');
console.log(`  DOSBox envelope: ${refEnv.slice(0, 40).map((v) => v.toFixed(1)).join(' ')}`);
console.log(`  this port      : ${myEnv.slice(0, 40).map((v) => v.toFixed(1)).join(' ')}`);
