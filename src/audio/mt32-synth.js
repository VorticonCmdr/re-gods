/* mt32-synth.js — a Web Audio stand-in for the Roland MT-32.
 *
 * WHAT IS REAL: the routing and the data. Parts 1-8 on MIDI channels 1-8 and
 * the rhythm part on 9 (the bank's system area, `01 02 .. 09`), program
 * changes resolved through the bank's 128 patches to its 64 custom timbres
 * (or a ROM timbre), the rhythm keys through its 85-key setup, and every
 * synth partial's own parameters — waveform, pulse width, pitch, the TVF
 * cutoff/resonance/envelope, the TVA level/envelope, the pitch envelope and
 * LFO — read from mt32-bank.js.
 *
 * WHAT IS NOT: the MT-32's LA synthesis itself. Its "PCM" partials play
 * samples from the synth's ROM, which this port does not have (and must not
 * ship), and its ROM timbres are ROM data too. Those get stand-ins: a PCM
 * partial becomes band-passed noise with a little of its pitch, a ROM timbre
 * a simple voice chosen from its name. The parameter-to-time/level curves
 * below are approximations of the MT-32's, not measurements. Ring
 * modulation (partial structures 2, 4, 5, 7, ...) is mixed instead. The
 * reverb follows the bank's own settings — the system area's mode, time and
 * level (PTITLE.RL: 1 Hall, 5, 3) and each patch's / rhythm key's reverb
 * switch — but its sound is a generated impulse response (a decaying noise
 * tail, or taps for mode 3), not the MT-32's reverb chip; the time and level
 * curves are guesses. So this sounds LIKE the Roland version, played from
 * its real notes and instrument settings; it is not an emulation of the chip.
 */

import { MT32_PRESET_NAMES } from './mt32-bank.js';

/* MT-32 partial structures 1-13 (stored 0-12): which partial of each pair is
 * PCM. Bit 1 = the first partial, bit 0 = the second (Munt's PartialStruct). */
const PARTIAL_STRUCT = [0, 0, 2, 2, 1, 3, 3, 0, 3, 0, 2, 1, 3];
/* Pitch/TVF key follow, values 0-16. */
const KEY_FOLLOW = [-1, -0.5, -0.25, 0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 2, 1, 1];
/* P-ENV depth 0-10 -> the semitones a full-scale level swing spans (approx.). */
const PENV_RANGE = [0, 0.5, 1, 2, 3, 4, 6, 8, 12, 18, 24];

const envTime = (t) => 0.001 * 2 ** (t / 9);                 // 0 -> 1 ms, 50 -> 47 ms, 100 -> 2.2 s
const levelAmp = (l) => (l <= 0 ? 0 : 10 ** (((l - 100) * 0.5) / 20));   // 0.5 dB a step
const midiHz = (n) => 440 * 2 ** ((n - 69) / 12);
const OUT_GAIN = 0.32;

/** Piecewise-linear envelope: [[time, value], ...] from t0. */
function envPoints(t0, times, levels, start = 0) {
  const pts = [[t0, start]];
  let t = t0;
  for (let i = 0; i < levels.length; i++) { t += times[i]; pts.push([t, levels[i]]); }
  return pts;
}
function valueAt(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [ta, va] = pts[i - 1], [tb, vb] = pts[i];
      return tb === ta ? vb : va + ((vb - va) * (t - ta)) / (tb - ta);
    }
  }
  return pts[pts.length - 1][1];
}
function schedule(param, pts, map = (x) => x) {
  param.setValueAtTime(map(pts[0][1]), pts[0][0]);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(map(pts[i][1]), pts[i][0]);
}

/* ROM rhythm timbres (64 + R1..R30) as tiny drum recipes: [kind, freq, decay]. */
const DRUMS = {
  64: ['kick', 55, 0.35], 65: ['snare', 190, 0.2], 66: ['tom', 200, 0.3], 67: ['tom', 150, 0.3],
  68: ['tom', 110, 0.35], 69: ['snare', 220, 0.15], 70: ['hat', 0, 0.05], 71: ['hat', 0, 0.35],
  72: ['cymbal', 0, 1.4], 73: ['cymbal', 0, 0.9], 74: ['click', 1700, 0.04], 75: ['clap', 0, 0.15],
  76: ['bell', 560, 0.18], 77: ['tom', 330, 0.12], 78: ['tom', 300, 0.18], 79: ['tom', 210, 0.22],
  80: ['tom', 420, 0.15], 81: ['tom', 320, 0.18], 82: ['tom', 480, 0.1], 83: ['tom', 360, 0.12],
  84: ['bell', 900, 0.12], 85: ['bell', 650, 0.14], 86: ['shaker', 0, 0.2], 87: ['click', 2500, 0.05],
  88: ['shaker', 0, 0.07], 89: ['whistle', 2100, 0.45], 90: ['whistle', 2300, 0.12], 91: ['shaker', 0, 0.1],
  92: ['shaker', 0, 0.6], 93: ['hat', 0, 0.2],
};

/* ROM melodic timbres: a stand-in voice per family (preset index ranges). */
function presetVoice(index) {
  const name = MT32_PRESET_NAMES[index] || '';
  if (index < 8) return { wave: 'triangle', attack: 0.004, decay: 1.4, sustain: 0.25, release: 0.3, name };
  if (index < 16) return { wave: 'square', attack: 0.01, decay: 0, sustain: 1, release: 0.08, lp: 3000, name };
  if (index < 24) return { wave: 'sawtooth', attack: 0.002, decay: 0.6, sustain: 0.1, release: 0.15, lp: 4000, name };
  if (index < 32) return { wave: 'sawtooth', attack: 0.01, decay: 0.4, sustain: 0.6, release: 0.1, lp: 1800, name };
  if (index < 48) return { wave: index === 47 ? 'square' : 'sawtooth', attack: index === 47 ? 0.005 : 0.15, decay: 0, sustain: 1, release: 0.4, lp: 2500, name };
  if (index < 57) return { wave: 'sawtooth', attack: 0.08, decay: 0, sustain: 1, release: 0.3, lp: 2800, name };
  if (index < 64) return { wave: 'triangle', attack: 0.003, decay: 0.9, sustain: 0.15, release: 0.2, lp: 3500, name };
  if (index < 72) return { wave: 'triangle', attack: 0.004, decay: 0.8, sustain: 0.3, release: 0.1, name };
  if (index < 78) return { wave: 'sine', attack: 0.04, decay: 0, sustain: 1, release: 0.12, name };
  if (index < 88) return { wave: 'square', attack: 0.03, decay: 0, sustain: 1, release: 0.1, lp: 1600, name };
  if (index < 97) return { wave: 'sawtooth', attack: 0.03, decay: 0, sustain: 1, release: 0.12, lp: 2200, name };
  if (index < 112) return { wave: 'sine', attack: 0.002, decay: 0.8, sustain: 0.05, release: 0.3, name };
  return { wave: 'triangle', attack: 0.002, decay: 0.3, sustain: 0, release: 0.1, name };
}

export class Mt32Synth {
  /**
   * @param {AudioContext} ctx
   * @param {object} bank parseMt32Bank's result
   * @param {AudioNode} [destination]
   */
  constructor(ctx, bank, destination = ctx.destination) {
    this.ctx = ctx;
    this.bank = bank;
    this.out = ctx.createGain();
    this.out.gain.value = OUT_GAIN * ((bank.system.masterVolume ?? 100) / 100);
    this.out.connect(destination);
    this.reverbIn = this.#makeReverb(destination);
    this.wet = false;                               // the note being built: reverb switch
    this.noise = this.#makeNoise();
    this.waves = new Map();
    this.parts = [];
    for (let ch = 0; ch < 16; ch++) {
      const bend = ctx.createConstantSource();
      bend.offset.value = 0;
      bend.start();
      this.parts.push({ patch: null, volume: 100, expression: 127, pan: 0, bendRange: 12,
        keyShift: 0, fine: 0, bend, voices: new Map() });
    }
    this.reset();
  }

  /** The bank's patch-temp area: each part's patch at power-on. */
  reset() {
    const { channels } = this.bank.system;
    this.bank.patchTemp.forEach((pt, i) => {
      const part = this.parts[channels[i]];
      if (!part) return;
      part.patch = { timbreGroup: pt.timbreGroup, timbreNumber: pt.timbreNumber,
        keyShift: pt.keyShift, fineTune: pt.fineTune, benderRange: pt.benderRange,
        reverb: pt.reverb };
      part.pan = (pt.panpot - 7) / 7;
    });
    this.rhythmChannel = channels[8];
  }

  /* The system area's reverb: mode 0 Room, 1 Hall, 2 Plate, 3 Tap delay;
   * time and level 0-7. Returns the send input (null when the level is 0). */
  #makeReverb(destination) {
    const { reverbMode: mode = 0, reverbTime: time = 0, reverbLevel: level = 0 } = this.bank.system;
    if (!level) return null;
    const ctx = this.ctx, rate = ctx.sampleRate;
    const seconds = [0.35 + 0.15 * time, 0.8 + 0.3 * time, 0.5 + 0.2 * time, 0.12 + 0.08 * time][mode & 3];
    const pre = [0.008, 0.02, 0.004, 0][mode & 3];
    const len = Math.ceil((pre + seconds) * rate);
    const ir = ctx.createBuffer(2, len, rate);
    let s = 0x2468ace;
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      if ((mode & 3) === 3) {                       // tap delay: a few decaying echoes
        for (let k = 1; k <= 6; k++) {
          const i = Math.floor((k * seconds / 3 + c * 0.011) * rate);
          if (i < len) d[i] = 0.7 ** k;
        }
        continue;
      }
      for (let i = Math.floor(pre * rate); i < len; i++) {
        s = (s * 1103515245 + 12345) >>> 0;
        const age = i / rate - pre;
        d[i] = ((s / 0x80000000) - 1) * Math.exp(-6.9 * age / seconds);   // -60 dB at `seconds`
      }
    }
    for (let c = 0; c < 2; c++) {                   // unit energy per channel, so `level` is the wet level
      const d = ir.getChannelData(c);
      let e = 0;
      for (let i = 0; i < len; i++) e += d[i] * d[i];
      const k = e > 0 ? 1 / Math.sqrt(e) : 0;
      for (let i = 0; i < len; i++) d[i] *= k;
    }
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = ir;
    const input = ctx.createGain();
    input.gain.value = OUT_GAIN * ((this.bank.system.masterVolume ?? 100) / 100);
    const wet = ctx.createGain();
    wet.gain.value = 0.12 * level;
    input.connect(conv).connect(wet).connect(destination);
    return input;
  }

  #makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 0x1234567;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 0x80000000) - 1; }
    return buf;
  }

  #pulse(width) {
    const duty = Math.round((0.5 - (width / 100) * 0.47) * 100) / 100;
    if (!this.waves.has(duty)) {
      const n = 48, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) {
        re[k] = (2 / (k * Math.PI)) * Math.sin(2 * Math.PI * k * duty);
        im[k] = (2 / (k * Math.PI)) * (1 - Math.cos(2 * Math.PI * k * duty));
      }
      this.waves.set(duty, this.ctx.createPeriodicWave(re, im));
    }
    return this.waves.get(duty);
  }

  /** One MIDI message at audio time `t`. */
  message({ status, a, b }, t) {
    const hi = status & 0xf0, ch = status & 0x0f;
    const part = this.parts[ch];
    if (!part) return;
    switch (hi) {
      case 0x90: if (b > 0) { this.#noteOn(ch, a, b, t); return; }
        this.#noteOff(part, a, t); return;                 // velocity 0 is a note off
      case 0x80: this.#noteOff(part, a, t); return;
      case 0xc0: {
        const p = this.bank.patches[a];
        if (p) { part.patch = p; part.bendRange = p.benderRange; }
        return;
      }
      case 0xb0:
        if (a === 7) part.volume = b;
        else if (a === 11) part.expression = b;
        else if (a === 10) part.pan = (b - 64) / 64;
        else if (a === 121) { part.expression = 127; part.bend.offset.setValueAtTime(0, t); }
        else if (a === 123) for (const note of [...part.voices.keys()]) this.#noteOff(part, note, t);
        return;
      case 0xe0: {
        const v = ((b << 7) | a) - 8192;
        part.bend.offset.setValueAtTime((v / 8192) * part.bendRange * 100, t);
        return;
      }
      default:
    }
  }

  #noteOff(part, note, t) {
    const list = part.voices.get(note);
    if (!list || !list.length) return;
    const v = list.shift();
    if (!list.length) part.voices.delete(note);
    v.release(t);
  }

  #noteOn(ch, note, vel, t) {
    const part = this.parts[ch];
    let timbre = null, key = note, level = 1, pan = part.pan, preset = -1, drum = null;
    if (ch === this.rhythmChannel) {
      const r = this.bank.rhythm.get(note);
      if (!r) return;
      if (r.timbre < 64) timbre = this.bank.timbres[r.timbre];
      else if (DRUMS[r.timbre]) drum = DRUMS[r.timbre];
      else return;                                  // 94+: not an MT-32 rhythm timbre
      key = 60; level = levelAmp(r.outputLevel); pan = (r.panpot - 7) / 7;
    } else {
      const p = part.patch;
      if (!p) return;
      key = note + (p.keyShift - 24);
      if (p.timbreGroup === 2) timbre = this.bank.timbres[p.timbreNumber];
      else if (p.timbreGroup < 2) preset = p.timbreGroup * 64 + p.timbreNumber;
      else if (DRUMS[64 + p.timbreNumber]) drum = DRUMS[64 + p.timbreNumber];
    }
    const gain = level * (part.volume / 127) ** 2 * (part.expression / 127) ** 2;
    this.wet = !!(ch === this.rhythmChannel ? this.bank.rhythm.get(note)?.reverb : part.patch?.reverb);
    const voice = timbre ? this.#timbreVoice(timbre, key, vel, gain, pan, part, t)
      : drum ? this.#drumVoice(drum, vel, gain, pan, t)
        : preset >= 0 ? this.#presetVoice(presetVoice(preset), key, vel, gain, pan, part, t) : null;
    if (!voice) return;
    if (!part.voices.has(note)) part.voices.set(note, []);
    part.voices.get(note).push(voice);
  }

  #panner(pan, gainNode) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    gainNode.connect(p).connect(this.out);
    if (this.wet && this.reverbIn) p.connect(this.reverbIn);
    return p;
  }

  #timbreVoice(timbre, key, vel, gain, pan, part, t0) {
    const ctx = this.ctx;
    const mix = ctx.createGain();
    mix.gain.value = gain;
    this.#panner(pan, mix);
    const pcmPair = [PARTIAL_STRUCT[timbre.structure12] ?? 0, PARTIAL_STRUCT[timbre.structure34] ?? 0];
    const parts = [];
    timbre.partials.forEach((pp, k) => {
      if (!pp.enabled) return;
      const isPcm = ((pcmPair[k >> 1] >> ((k & 1) ? 0 : 1)) & 1) === 1;
      parts.push(this.#partial(pp, isPcm, timbre.noSustain, key, vel, part, mix, t0));
    });
    if (!parts.length) return null;
    return {
      release: (t) => { let end = t; for (const p of parts) end = Math.max(end, p.release(t)); },
    };
  }

  #partial(pp, isPcm, noSustain, key, vel, part, mix, t0) {
    const ctx = this.ctx;
    const kf = KEY_FOLLOW[pp.pitchKeyfollow] ?? 1;
    const semis = 60 + (pp.pitchCoarse - 36) + (pp.pitchFine - 50) / 100 + kf * (key - 60);
    const freq = Math.min(16000, Math.max(8, midiHz(semis)));
    const velo = (sens) => Math.max(0, 1 + ((sens - 50) / 50) * (vel / 127 - 1));
    const amp = levelAmp(pp.tvaLevel) * velo(pp.tvaVeloSens);
    const env = ctx.createGain();
    env.connect(mix);
    const sources = [];
    let freqParam = null;                       // for bend / P-ENV / LFO (cents)
    if (isPcm) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = Math.min(12000, Math.max(80, freq * 2)); bp.Q.value = 0.9;
      src.connect(bp).connect(env);
      const body = ctx.createOscillator();
      body.type = 'triangle'; body.frequency.value = freq;
      const bodyGain = ctx.createGain(); bodyGain.gain.value = 0.35;
      body.connect(bodyGain).connect(env);
      sources.push(src, body);
      src.start(t0, Math.random() * 1.5);
      body.start(t0);
      freqParam = [bp.detune, body.detune];
    } else {
      const osc = ctx.createOscillator();
      if (pp.isSaw) osc.type = 'sawtooth'; else osc.setPeriodicWave(this.#pulse(pp.pulseWidth));
      osc.frequency.value = freq;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.5 + pp.tvfResonance * 0.6;
      const tkf = KEY_FOLLOW[pp.tvfKeyfollow] ?? 1;
      const fc0 = 20 * 2 ** (pp.tvfCutoff / 10) * 2 ** ((tkf * (key - 60)) / 12);
      const depth = (pp.tvfEnvDepth / 100) * 7 * Math.max(0, 1 - (pp.tvfEnvVeloSens / 100) * (1 - vel / 127));
      const fts = pp.tvfEnvTime.map(envTime);
      const fpts = envPoints(t0, fts.slice(0, 4), pp.tvfEnvLevel.map((l) => l / 100));
      schedule(lp.frequency, fpts, (x) => Math.min(20000, Math.max(20, fc0 * 2 ** (depth * x))));
      osc.connect(lp).connect(env);
      sources.push(osc);
      osc.start(t0);
      freqParam = [osc.detune];
    }
    /* Bend, pitch envelope and LFO, all in cents. */
    for (const prm of freqParam) part.bend.connect(prm);
    if (pp.penvDepth > 0) {
      const range = PENV_RANGE[pp.penvDepth] || 0;
      const cents = (l) => ((l - 50) / 50) * range * 100;
      const pts = envPoints(t0, pp.penvTime.slice(0, 3).map(envTime), [pp.penvLevel[1], pp.penvLevel[2], pp.penvLevel[3]].map(cents), cents(pp.penvLevel[0]));
      const pc = ctx.createConstantSource();
      schedule(pc.offset, pts);
      for (const prm of freqParam) pc.connect(prm);
      pc.start(t0);
      sources.push(pc);
    }
    if (pp.lfoDepth > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.2 * 2 ** (pp.lfoRate / 16);
      const lg = ctx.createGain(); lg.gain.value = pp.lfoDepth * 0.6;
      lfo.connect(lg);
      for (const prm of freqParam) lg.connect(prm);
      lfo.start(t0);
      sources.push(lfo);
    }
    /* TVA: T1..T4 to L1, L2, L3, sustain; T5 to 0 at release (or at once
     * when the timbre has no sustain). */
    const ts = pp.tvaEnvTime.map(envTime);
    const lv = pp.tvaEnvLevel.map((l) => levelAmp(l) * amp);
    const pts = envPoints(t0, ts.slice(0, 4), lv);
    let naturalEnd = Infinity;
    if (noSustain) {
      const tEnd = pts[pts.length - 1][0] + ts[4];
      pts.push([tEnd, 0]);
      naturalEnd = tEnd;
    }
    schedule(env.gain, pts);
    if (naturalEnd < Infinity) for (const s of sources) s.stop(naturalEnd + 0.05);
    const cleanup = () => { for (const prm of freqParam) { try { part.bend.disconnect(prm); } catch { /* gone */ } } };
    sources[0].onended = cleanup;
    return {
      release: (t) => {
        if (naturalEnd < Infinity) return naturalEnd;
        const v = valueAt(pts, t);
        const rel = Math.max(0.01, ts[4]);
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(v, t);
        env.gain.linearRampToValueAtTime(0, t + rel);
        for (const s of sources) s.stop(t + rel + 0.05);
        return t + rel;
      },
    };
  }

  #presetVoice(pv, key, vel, gain, pan, part, t0) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = pv.wave;
    osc.frequency.value = midiHz(key);
    const env = ctx.createGain();
    let node = osc;
    if (pv.lp) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = pv.lp; osc.connect(lp); node = lp; }
    node.connect(env);
    const mix = ctx.createGain(); mix.gain.value = gain * 0.5 * (vel / 127);
    env.connect(mix);
    this.#panner(pan, mix);
    part.bend.connect(osc.detune);
    const pts = [[t0, 0], [t0 + pv.attack, 1]];
    if (pv.decay > 0) pts.push([t0 + pv.attack + pv.decay, pv.sustain]);
    schedule(env.gain, pts);
    osc.start(t0);
    osc.onended = () => { try { part.bend.disconnect(osc.detune); } catch { /* gone */ } };
    let natural = Infinity;
    if (pv.sustain === 0) { natural = t0 + pv.attack + pv.decay; osc.stop(natural + 0.05); }
    return {
      release: (t) => {
        if (natural < Infinity) return natural;
        const v = valueAt(pts, t);
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(v, t);
        env.gain.linearRampToValueAtTime(0, t + pv.release);
        osc.stop(t + pv.release + 0.05);
        return t + pv.release;
      },
    };
  }

  #drumVoice([kind, f, decay], vel, gain, pan, t0) {
    const ctx = this.ctx;
    const mix = ctx.createGain();
    mix.gain.value = gain * (vel / 127) * 0.9;
    this.#panner(pan, mix);
    const env = ctx.createGain();
    env.connect(mix);
    env.gain.setValueAtTime(1, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
    const end = t0 + decay + 0.05;
    const tone = (type, from, to) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(from, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + decay);
      o.connect(env); o.start(t0); o.stop(end);
    };
    const noise = (type, freq, q = 0.8, g = 1) => {
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
      const ng = ctx.createGain(); ng.gain.value = g;
      s.connect(fl).connect(ng).connect(env); s.start(t0, Math.random()); s.stop(end);
    };
    switch (kind) {
      case 'kick': tone('sine', 150, f); break;
      case 'snare': tone('triangle', f); noise('bandpass', 2500, 0.7, 1.2); break;
      case 'tom': tone('sine', f * 1.5, f); break;
      case 'hat': noise('highpass', 7000, 0.7); break;
      case 'cymbal': noise('highpass', 5000, 0.5); break;
      case 'click': tone('square', f); break;
      case 'clap': noise('bandpass', 1200, 1.5, 1.5); break;
      case 'bell': tone('square', f); tone('square', f * 1.48); break;
      case 'shaker': noise('highpass', 5500, 1); break;
      case 'whistle': tone('sine', f); break;
      default: tone('triangle', f || 440);
    }
    return { release: () => end };
  }
}
