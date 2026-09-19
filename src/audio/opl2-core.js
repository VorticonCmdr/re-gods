/* opl2-core.js — a compact YM3812 (OPL2) voice model that renders samples
 * directly, instead of wiring Web Audio nodes together.
 *
 * Why this replaced the old `opl2-synth.js` node graph: three of the chip's
 * defining behaviours cannot be expressed as a graph of Web Audio nodes at
 * all.
 *   1. FEEDBACK is an operator modulating ITS OWN phase from its previous
 *      output. Web Audio has no cheap same-block feedback path, so the old
 *      code faked it as extra op1->op2 modulation depth — a different
 *      effect entirely. It matters here: several of this game's own sounds
 *      (the kill/explosion blob 34, the weapon-fire blob 28) run feedback
 *      at or near maximum with a very low carrier, which on real OPL2
 *      degenerates into the noisy crunch those effects are made of.
 *   2. The four OPL2 WAVEFORMS are exact functions, not curve-shaped sine.
 *   3. The ENVELOPE is linear in ATTENUATION (i.e. exponential in
 *      amplitude, in dB steps), with a rate that scales by key-scale-rate.
 *
 * Rendering happens once per sound, offline, into a buffer — so the cost is
 * paid at decode time, not on every trigger.
 *
 * ⚠️ APPROXIMATION, stated precisely. This is a model of the chip's
 * DOCUMENTED behaviour, not a gate-level emulation and not a port of one.
 * The waveform shapes, the operator topology (FM vs. additive), the
 * multiplier table, the attenuation scale (0.75 dB per total-level step)
 * and the key-scale-rate derivation are all exact. What is FITTED rather
 * than derived: the absolute envelope time constants and the two modulation
 * depth scales below.
 *
 * WHAT THAT FIT WAS MEASURED AGAINST, and how well it holds. DOSBox's own
 * OPL2 was driven directly through ports 0x388/0x389 from a bare DOS prompt
 * with no program running, and the resulting audio captured and measured —
 * first with synthetic single-parameter sweeps (`tools/opl2-calibration.
 * json`, checked by `tools/check-opl2-envelopes.mjs`), then by playing two
 * of this game's OWN instruments through the real chip and comparing
 * against this renderer (`tools/compare-dos-audio.mjs`):
 *
 *   blob 28 (weapon fire, note 37, FM, feedback 7)
 *     spectral centroid  1743 Hz chip / 1752 Hz here   (0.5%)
 *     decay to 25%       0.125 s chip / 0.130 s here   (4%)
 *   blob 25 (menu cursor, note 104, FM, feedback 6)
 *     spectral centroid  2265 Hz chip / 2105 Hz here   (7%)
 *     -6 dB bandwidth    3296 Hz chip / 3212 Hz here   (2.5%)
 *
 * KNOWN REMAINING GAPS, measured rather than suspected:
 *   - EG-type 1 (the "sustaining" envelope, register 0x20 bit 5). Measured
 *     back to back against EG-type 0 on the real chip with every other
 *     setting identical: the chip holds the note for as long as the key is
 *     down (16.8 s in the test) but decays roughly 20 dB on the way, where
 *     this model holds at the stored sustain level instead. It affects only
 *     3 of the 70 SFX blobs (18, 21, 22 — 24 of 248 per-channel operators),
 *     which is why it is recorded here rather than chased.
 *   - Short sounds decay somewhat faster here than on the chip (blob 25
 *     dies in ~20 ms against the chip's ~65 ms) even though an isolated
 *     carrier with the same envelope settings matches the chip exactly
 *     (28.0 ms against 28 ms). The cause was not identified.
 */

export const OPL_RATE = 49716;   // the real YM3812 sample rate (3.579545 MHz / 72)

/* Frequency multiplier per operator, register 0x20 bits 0-3. Index 0 is
 * x0.5 and 11/13/14/15 repeat their neighbours — the chip's own table. */
const MULT = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];

/* Envelope time constants, in seconds, for internal rate 0. Every +4 of the
 * 6-bit internal rate halves the time.
 *
 * MEASURED, not guessed. `tools/opl2-calibration.json` holds the reference:
 * DOSBox's own OPL2 was driven directly through ports 0x388/0x389 at a bare
 * DOS prompt (nothing else touching the chip), one clean 440 Hz carrier per
 * test, and the resulting audio captured and measured. The rate law came out
 * of that data rather than being assumed — attack rate 4 rose in 130 ms and
 * rate 8 in 8 ms, a ratio of 16.25 against the 16 the "+4 internal rate
 * halves the time" law predicts. These two constants are then the single
 * free scale each curve needs, back-solved from those same measurements
 * (see tools/check-opl2-envelopes.mjs, which re-derives and asserts them). */
const T_ATTACK = 7.07;    // s; yields a 10%->90% rise of 2.05 s at internal rate 0
const T_DECAY = 75.3;     // s; yields a peak->10% fall of 11.0 s at internal rate 0

/* Phase modulation depth. PHASE_MOD is how many full cycles of phase a
 * full-amplitude modulator displaces its carrier by; FEEDBACK_MOD is the
 * same for an operator feeding back into itself, before the per-channel
 * feedback shift. Both FITTED — see the header. */
const PHASE_MOD = 2.0;
const FEEDBACK_MOD = 0.75;

/** Attenuation in 0.75 dB steps (the total-level scale) -> linear gain. */
function attenToGain(steps) {
  return Math.pow(10, -(steps * 0.75) / 20);
}

/** One OPL2 waveform, phase in turns (0..1). */
function waveform(sel, phase) {
  const p = phase - Math.floor(phase);
  const s = Math.sin(2 * Math.PI * p);
  switch (sel & 3) {
    case 0: return s;                               // full sine
    case 1: return p < 0.5 ? s : 0;                 // half sine (negative half muted)
    case 2: return Math.abs(s);                     // absolute sine
    default: return (p < 0.25 || (p >= 0.5 && p < 0.75)) ? Math.abs(s) : 0;  // pulse sine
  }
}

/* Envelope phases. Attack rises toward full amplitude; decay falls to the
 * sustain level; sustain either holds (EG-type 1) or keeps falling like a
 * release (EG-type 0, "percussive"); release falls to silence after key-off. */
const ATTACK = 0, DECAY = 1, SUSTAIN = 2, RELEASE = 3, DONE = 4;

class Operator {
  constructor(regs, blockFnumMsb) {
    this.mult = MULT[regs.reg20 & 0x0f];
    this.ksr = (regs.reg20 & 0x10) !== 0;
    this.egTypeHold = (regs.reg20 & 0x20) !== 0;   // 1 = hold at sustain, 0 = keep decaying
    this.tl = regs.reg40 & 0x3f;                    // total level, 0.75 dB steps
    this.ksl = (regs.reg40 >> 6) & 3;
    this.ar = (regs.reg60 >> 4) & 0x0f;
    this.dr = regs.reg60 & 0x0f;
    this.sl = (regs.reg80 >> 4) & 0x0f;
    this.rr = regs.reg80 & 0x0f;
    this.wave = regs.regE0 & 3;

    /* Key-scale-rate: higher notes run their envelopes faster. The chip
     * derives it from the block and the F-number's top bit; KSR selects
     * whether all 4 bits or only the top 2 are used. */
    this.rof = this.ksr ? blockFnumMsb : (blockFnumMsb >> 2);

    this.phase = 0;
    this.atten = 511;            // start silent, in 0.1875 dB units
    this.state = DONE;
    this.out = 0;
    this.prev1 = 0;
    this.prev2 = 0;
  }

  /** Seconds for a full 0<->96 dB sweep at the given 4-bit rate field. */
  #sweepSeconds(rateField, base) {
    if (rateField === 0) return Infinity;
    const r = Math.min(63, rateField * 4 + this.rof);
    return base * Math.pow(2, -r / 4);
  }

  keyOn() {
    this.state = ATTACK;
    this.phase = 0;
    this.prev1 = 0;
    this.prev2 = 0;
  }

  keyOff() {
    if (this.state !== DONE) this.state = RELEASE;
  }

  /** Advance the envelope by one sample; returns linear output gain. */
  #stepEnvelope(dt) {
    const sustainAtten = this.sl === 15 ? 511 : this.sl * 16;   // 3 dB per step
    switch (this.state) {
      case ATTACK: {
        const t = this.#sweepSeconds(this.ar, T_ATTACK);
        if (!isFinite(t)) { this.atten = 511; break; }
        /* The chip's attack approaches full amplitude rather than ramping
         * linearly, so step proportionally to the remaining distance. */
        this.atten -= Math.max(1, this.atten) * (dt / t) * 8;
        if (this.atten <= 0) { this.atten = 0; this.state = DECAY; }
        break;
      }
      case DECAY: {
        const t = this.#sweepSeconds(this.dr, T_DECAY);
        if (!isFinite(t)) break;
        this.atten += 511 * (dt / t);
        if (this.atten >= sustainAtten) { this.atten = sustainAtten; this.state = SUSTAIN; }
        break;
      }
      case SUSTAIN: {
        if (this.egTypeHold) break;                  // hold until key-off
        const t = this.#sweepSeconds(this.rr, T_DECAY);
        if (!isFinite(t)) break;
        this.atten += 511 * (dt / t);
        break;
      }
      case RELEASE: {
        const t = this.#sweepSeconds(this.rr, T_DECAY);
        if (!isFinite(t)) break;
        this.atten += 511 * (dt / t);
        break;
      }
      default: return 0;
    }
    if (this.atten >= 511) { this.atten = 511; this.state = DONE; return 0; }
    if (this.atten < 0) this.atten = 0;
    /* Envelope attenuation (0.1875 dB units) plus the static total level
     * (0.75 dB units), both applied as attenuation. */
    return attenToGain(this.atten * 0.25 + this.tl);
  }

  /**
   * @param {number} freq    carrier base frequency in Hz
   * @param {number} phaseMod modulation input, in turns
   * @param {number} dt      seconds per sample
   */
  step(freq, phaseMod, dt) {
    const gain = this.#stepEnvelope(dt);
    if (gain === 0 && this.state === DONE) { this.out = 0; return 0; }
    this.phase += freq * this.mult * dt;
    if (this.phase > 1e6) this.phase -= Math.floor(this.phase);
    const v = waveform(this.wave, this.phase + phaseMod) * gain;
    this.prev2 = this.prev1;
    this.prev1 = v;
    this.out = v;
    return v;
  }

  get finished() { return this.state === DONE; }
}

/**
 * Renders one note of a 2-operator OPL2 channel into `dest`, mixing additively.
 * @param {Float32Array} dest       output buffer
 * @param {number} startSample      where in `dest` the key-on happens
 * @param {number} holdSamples      how long the key is held before key-off
 * @param {{op1,op2,regC0}} registers `sfx-instrument.js`'s own decoded output
 * @param {number} freq             note frequency in Hz
 * @param {number} velocityGain     extra linear gain (MIDI velocity, an approximation)
 * @param {number} block            OPL2 block, for key-scale-rate
 */
export function renderNote(dest, startSample, holdSamples, registers, freq, velocityGain, block = 4) {
  const { op1, op2, regC0 } = registers;
  const feedback = (regC0 >> 1) & 7;
  const additive = (regC0 & 1) === 1;
  const blockFnumMsb = Math.min(15, block * 2);
  const mod = new Operator(op1, blockFnumMsb);
  const car = new Operator(op2, blockFnumMsb);
  mod.keyOn();
  car.keyOn();

  const dt = 1 / OPL_RATE;
  const fbScale = feedback === 0 ? 0 : FEEDBACK_MOD * Math.pow(2, feedback) / 128;
  const maxSamples = dest.length - startSample;

  for (let i = 0; i < maxSamples; i++) {
    if (i === holdSamples) { mod.keyOff(); car.keyOff(); }
    /* Feedback uses the average of the operator's own last two outputs —
     * the chip's own anti-instability measure, not an approximation. */
    const fb = fbScale * (mod.prev1 + mod.prev2) * 0.5;
    const m = mod.step(freq, fb, dt);
    const c = car.step(freq, additive ? 0 : m * PHASE_MOD, dt);
    const sample = additive ? (m + c) : c;
    dest[startSample + i] += sample * velocityGain;
    if (i >= holdSamples && mod.finished && car.finished) break;
  }
}

/**
 * Renders a whole decoded SFX sequence (audio/sfx-sequence.js) to a mono
 * buffer at `OPL_RATE`.
 * @param {{notes:Array, durationSec:number}} sequence
 * @returns {Float32Array}
 */
export function renderSequence(sequence) {
  const tailSec = 0.5;   // room for releases to finish
  const n = Math.max(1, Math.ceil((sequence.durationSec + tailSec) * OPL_RATE));
  const out = new Float32Array(n);
  for (const note of sequence.notes) {
    if (!note.registers) continue;
    const start = Math.round(note.timeSec * OPL_RATE);
    const hold = Math.max(1, Math.round(note.durSec * OPL_RATE));
    const freq = 440 * Math.pow(2, (note.note - 69) / 12);
    const block = Math.max(0, Math.min(7, Math.floor(Math.log2(Math.max(freq, 1) / 24.5))));
    renderNote(out, start, hold, note.registers, freq, note.velocity / 127, block);
  }
  /* Remove DC. Three of the four OPL2 waveforms are rectified (half-sine,
   * absolute-sine, pulse-sine) and so carry a large DC component; on real
   * hardware the output stage is AC-coupled and it never reaches the
   * speaker. Without this the offset wastes headroom and turns each
   * key-on/key-off into an audible thump. A one-pole high-pass at a few Hz
   * is what the coupling capacitor does. */
  const R = 0.9995;   // ~4 Hz corner at 49716 Hz
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < n; i++) {
    const x = out[i];
    prevOut = x - prevIn + R * prevOut;
    prevIn = x;
    out[i] = prevOut;
  }
  /* Normalize only if the mix actually clips — several of these sounds are
   * genuinely quiet relative to others and that balance is part of them. */
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1) for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}
