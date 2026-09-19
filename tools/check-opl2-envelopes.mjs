/* check-opl2-envelopes.mjs — holds src/audio/opl2-core.js's envelope to the
 * real OPL2's measured behaviour.
 *
 * `opl2-calibration.json` records what DOSBox's own OPL2 actually did when
 * driven directly through ports 0x388/0x389 with nothing else running: six
 * key-ons, three varying the attack rate and three the decay rate, each a
 * clean 440 Hz carrier, measured from captured audio. This renders the SAME
 * register settings through this port's core and checks the envelope times
 * match.
 *
 * Without this, the two fitted constants in opl2-core.js are unfalsifiable
 * numbers someone could "improve" in either direction forever. With it they
 * are pinned to a measurement, and a future edit that drifts the envelope
 * fails here.
 */

import fs from 'fs';
import { renderNote, OPL_RATE } from '../src/audio/opl2-core.js';

const cal = JSON.parse(fs.readFileSync(new URL('./opl2-calibration.json', import.meta.url)));

/** RMS envelope in 2 ms frames — the same measurement the reference used. */
function envelope(x, frameSec = 0.002) {
  const W = Math.max(1, Math.round(OPL_RATE * frameSec));
  const env = [];
  for (let i = 0; i + W <= x.length; i += W) {
    let s = 0;
    for (let j = 0; j < W; j++) s += x[i + j] * x[i + j];
    env.push(Math.sqrt(s / W));
  }
  return env;
}

function riseMs(env, frameSec = 0.002) {
  const pk = Math.max(...env);
  const pkIdx = env.indexOf(pk);
  let i10 = 0, i90 = 0;
  for (let i = 0; i <= pkIdx; i++) {
    if (!i10 && env[i] >= 0.1 * pk) i10 = i;
    if (!i90 && env[i] >= 0.9 * pk) { i90 = i; break; }
  }
  return (i90 - i10) * frameSec * 1000;
}

function decayMs(env, frameSec = 0.002) {
  const pk = Math.max(...env);
  const pkIdx = env.indexOf(pk);
  for (let i = pkIdx; i < env.length; i++) if (env[i] <= 0.1 * pk) return (i - pkIdx) * frameSec * 1000;
  return NaN;
}

/** Reproduces the reference rig: carrier alone, modulator silenced, 440 Hz. */
function renderCarrier({ ar, dr, sl = 0, rr = 15, holdSec = 2.0 }) {
  const registers = {
    op1: { reg20: 0x01, reg40: 0x3f, reg60: 0xf0, reg80: 0x0f, regE0: 0 },  // TL=63, silent
    op2: { reg20: 0x01, reg40: 0x00, reg60: (ar << 4) | dr, reg80: (sl << 4) | rr, regE0: 0 },
    regC0: 0x00,   // FM, feedback 0
  };
  const buf = new Float32Array(Math.round(OPL_RATE * (holdSec + 1.0)));
  renderNote(buf, 0, Math.round(OPL_RATE * holdSec), registers, 440, 1, 4);
  return buf;
}

let failures = 0;
const TOL = 0.35;   // 35% — these are envelope timings measured through RMS frames, not exact clocks

console.log('attack (10%->90% rise), carrier alone at 440 Hz:');
for (const row of cal.attack) {
  if (row.at_resolution_floor) {
    const got = riseMs(envelope(renderCarrier({ ar: row.ar, dr: row.dr })));
    const ok = got <= 4.0;
    console.log(`  AR=${String(row.ar).padStart(2)}  DOSBox <=2ms (floor)   port ${got.toFixed(1).padStart(6)}ms  ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failures++;
    continue;
  }
  const got = riseMs(envelope(renderCarrier({ ar: row.ar, dr: row.dr })));
  const ratio = got / row.attack_ms;
  const ok = ratio > 1 - TOL && ratio < 1 + TOL;
  console.log(`  AR=${String(row.ar).padStart(2)}  DOSBox ${row.attack_ms.toFixed(1).padStart(6)}ms   port ${got.toFixed(1).padStart(6)}ms  (x${ratio.toFixed(2)})  ${ok ? 'ok' : 'FAIL'}`);
  if (!ok) failures++;
}

console.log('decay (peak->10%), SL=15 so it falls to silence:');
for (const row of cal.decay) {
  if (row.at_resolution_floor) {
    const got = decayMs(envelope(renderCarrier({ ar: row.ar, dr: row.dr, sl: row.sl })));
    const ok = got <= 12.0;
    console.log(`  DR=${String(row.dr).padStart(2)}  DOSBox ~${row.decay_ms}ms (floor)  port ${got.toFixed(1).padStart(6)}ms  ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failures++;
    continue;
  }
  const got = decayMs(envelope(renderCarrier({ ar: row.ar, dr: row.dr, sl: row.sl })));
  const ratio = got / row.decay_ms;
  const ok = ratio > 1 - TOL && ratio < 1 + TOL;
  console.log(`  DR=${String(row.dr).padStart(2)}  DOSBox ${row.decay_ms.toFixed(1).padStart(6)}ms   port ${got.toFixed(1).padStart(6)}ms  (x${ratio.toFixed(2)})  ${ok ? 'ok' : 'FAIL'}`);
  if (!ok) failures++;
}

/* The rate law itself, independent of either absolute constant: +4 of
 * internal rate must halve the time, so a 4-step AR difference is 16x.
 * Measured on AR=2 vs AR=6 with a fine frame, deliberately NOT on the
 * AR=4/AR=8 pair the reference used: 8 ms is four 2 ms frames, so that
 * pair's ratio is dominated by frame quantization here (the reference
 * capture had the same limit, which is why its own 16.25 is quoted as
 * confirmation of the law rather than as a precise constant). */
const FINE = 0.0005;
const a2 = riseMs(envelope(renderCarrier({ ar: 2, dr: 0, holdSec: 4.0 }), FINE), FINE);
const a6 = riseMs(envelope(renderCarrier({ ar: 6, dr: 0, holdSec: 4.0 }), FINE), FINE);
const lawRatio = a2 / a6;
const lawOk = lawRatio > 14 && lawRatio < 18;
console.log(`rate law: AR=2 (${a2.toFixed(1)}ms) / AR=6 (${a6.toFixed(1)}ms) = ${lawRatio.toFixed(2)}x  (theory 16, DOSBox measured 16.25 on its own pair)  ${lawOk ? 'ok' : 'FAIL'}`);
if (!lawOk) failures++;

console.log(failures === 0 ? '\nALL OPL2 ENVELOPE CHECKS PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
