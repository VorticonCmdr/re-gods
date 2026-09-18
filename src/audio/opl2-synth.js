/* opl2-synth.js — a from-scratch, approximate 2-operator FM synthesizer in
 * Web Audio, driven by real OPL2 register values (`formats/sfx-instrument.js`'s
 * `instrumentToRegisters` output — themselves decoded from the shipped
 * `PGODS.MUS`, not invented; see that module's own header).
 *
 * NOT chip-accurate — this is a disclosed approximation of real OPL2
 * register semantics, not an emulator:
 *   - Envelope (attack/decay/sustain/release) uses a simple exponential
 *     mapping from each 4-bit register field to a time in seconds, not
 *     OPL2's real internal envelope-generator clock/rate tables.
 *   - Waveforms 1–3 (half-sine / full-sine / "quarter") are approximated
 *     with a WaveShaperNode on a sine oscillator, not the exact per-sample
 *     OPL2 wave lookup tables.
 *   - Feedback (op1 self-modulation) is approximated as extra modulation
 *     depth from op1 into op2, not true self-feedback (Web Audio has no
 *     cheap same-tick feedback loop without an AudioWorklet).
 *   - Pitch is NOT decoded from any file — the real per-note F-Number/
 *     octave/key-on registers are runtime state GAME.EXE supplies per
 *     event, not stored instrument data, so callers must supply a
 *     frequency themselves (a reasonable default is provided).
 * Every other field (multiplier, attack/decay/sustain/release *rates*,
 * connection, base waveform id) comes directly from the decoded register
 * values, so this is far closer to the original instrument's TIMBRE than
 * `audio-bus.js`'s older hand-picked oscillator voices, even though it
 * isn't sample-accurate.
 */

const MULT_TABLE = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];

// 4-bit register value -> seconds. OPL2 rates are exponential (higher =
// faster); these constants are tuned for short, punchy SFX envelopes, not
// derived from the real hardware's own rate tables.
function attackSeconds(ar) { return ar === 0 ? 2 : 0.6 / (1 << ar); }
function decaySeconds(dr) { return dr === 0 ? 2 : 1.2 / (1 << dr); }
function releaseSeconds(rr) { return rr === 0 ? 2 : 1.2 / (1 << rr); }
function sustainGain(sl) { return Math.pow(10, -(sl * 3) / 20); } // sl: 0=loud, 15=quiet, ~3dB/step

function levelToGain(reg40) {
  const attenuation = reg40 & 0x3f; // 0..63, 0.75dB/step
  return Math.pow(10, -(attenuation * 0.75) / 20);
}

let sharedWaveShapers = null;
function getWaveShaper(ctx, waveId) {
  if (!sharedWaveShapers) sharedWaveShapers = new Map();
  const key = ctx;
  if (!sharedWaveShapers.has(key)) sharedWaveShapers.set(key, new Map());
  const perCtx = sharedWaveShapers.get(key);
  if (perCtx.has(waveId)) return perCtx.get(waveId);
  if (waveId === 0) { perCtx.set(waveId, null); return null; } // plain sine, no shaping needed
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1; // -1..1, represents sin(theta) already
    let y;
    if (waveId === 1) y = x > 0 ? x : 0;               // half-sine
    else if (waveId === 2) y = Math.abs(x);            // full (abs) sine
    else y = (x > 0 && i < 512) ? x : 0;                // waveId 3: crude "quarter" approximation
    curve[i] = y;
  }
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  perCtx.set(waveId, shaper);
  return shaper;
}

function scheduleOperatorEnvelope(gainNode, t0, { reg60, reg80, reg40 }) {
  const ar = (reg60 >> 4) & 0xf;
  const dr = reg60 & 0xf;
  const sl = (reg80 >> 4) & 0xf;
  const rr = reg80 & 0xf;
  const peak = levelToGain(reg40);
  const sustain = Math.min(peak, peak * sustainGain(sl));
  const atk = attackSeconds(ar);
  const dec = decaySeconds(dr);
  const g = gainNode.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + atk);
  g.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t0 + atk + dec);
  return { rr, sustainEnd: t0 + atk + dec };
}

function releaseOperatorEnvelope(gainNode, atTime, rr) {
  const rel = releaseSeconds(rr);
  const g = gainNode.gain;
  const v = Math.max(g.value, 0.0001);
  g.cancelScheduledValues(atTime);
  g.setValueAtTime(v, atTime);
  g.exponentialRampToValueAtTime(0.0001, atTime + rel);
  return atTime + rel;
}

/**
 * Plays one OPL2-style FM note. Fire-and-forget: schedules attack/decay
 * immediately and release after `sustainMs`.
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {number} t0  ctx.currentTime-relative start time.
 * @param {{op1, op2, regC0}} registers  `instrumentToRegisters`'s own output.
 * @param {number} [freqHz]  Carrier base frequency — NOT decoded from any
 *   file (see module header); defaults to a mid-range tone.
 * @param {number} [sustainMs]  How long to hold before release; SFX are
 *   short, so this defaults small.
 */
export function playOpl2Note(ctx, dest, t0, registers, freqHz = 440, sustainMs = 60) {
  const { op1, op2, regC0 } = registers;
  const feedback = (regC0 >> 1) & 7;
  const connection = regC0 & 1; // 0 = FM (serial), 1 = additive (both audible)

  const modOsc = ctx.createOscillator();
  modOsc.type = 'sine';
  modOsc.frequency.value = freqHz * MULT_TABLE[op1.reg20 & 0xf];
  const modShaper = getWaveShaper(ctx, op1.regE0);
  const modGain = ctx.createGain();
  modGain.gain.value = 0;
  if (modShaper) { modOsc.connect(modShaper); modShaper.connect(modGain); }
  else modOsc.connect(modGain);

  const carOsc = ctx.createOscillator();
  carOsc.type = 'sine';
  carOsc.frequency.value = freqHz * MULT_TABLE[op2.reg20 & 0xf];
  const carShaper = getWaveShaper(ctx, op2.regE0);
  const carGain = ctx.createGain();
  carGain.gain.value = 0;
  if (carShaper) { carOsc.connect(carShaper); carShaper.connect(carGain); }
  else carOsc.connect(carGain);

  // Modulation depth: feedback (0-7) approximates op1's own self-feedback
  // as extra FM depth into op2 instead (see module header's own caveat).
  const modDepth = ctx.createGain();
  modDepth.gain.value = (freqHz * MULT_TABLE[op1.reg20 & 0xf]) * (0.3 + feedback / 3);
  modGain.connect(modDepth);
  if (connection === 0) {
    // FM: op1 modulates op2's frequency; only op2 is audible.
    modDepth.connect(carOsc.frequency);
  } else {
    // Additive: both operators heard directly, op1 also still modulates op2 (a
    // simplification — real OPL2 additive mode uses op1's OWN output, not FM).
    modDepth.connect(carOsc.frequency);
    modGain.connect(dest);
  }
  carGain.connect(dest);

  const { rr: rr1, sustainEnd: sEnd1 } = scheduleOperatorEnvelope(modGain, t0, op1);
  const { rr: rr2, sustainEnd: sEnd2 } = scheduleOperatorEnvelope(carGain, t0, op2);

  const releaseAt = t0 + sustainMs / 1000;
  const stopAt1 = Math.max(releaseAt, sEnd1) + releaseSeconds(rr1) + 0.02;
  const stopAt2 = Math.max(releaseAt, sEnd2) + releaseSeconds(rr2) + 0.02;
  releaseOperatorEnvelope(modGain, Math.max(releaseAt, sEnd1), rr1);
  releaseOperatorEnvelope(carGain, Math.max(releaseAt, sEnd2), rr2);

  modOsc.start(t0);
  carOsc.start(t0);
  modOsc.stop(Math.max(stopAt1, stopAt2));
  carOsc.stop(Math.max(stopAt1, stopAt2));
}
