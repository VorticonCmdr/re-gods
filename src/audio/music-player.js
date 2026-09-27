/* music-player.js — browser-only playback of PGODS.MUS's real SMF blobs.
 *
 * SCHEDULING: deliberately NOT driven by the rAF `Clock` (`engine/clock.js`'s
 * own header, in bold: the 50 Hz music clock "must not be driven from" the
 * 15 Hz logic clock) — and this session directly measured the rAF loop
 * stalling entirely (FPS stuck at "–") in an automated Chrome tab, which
 * would silently drop every note on a rAF-scheduled player. This uses the
 * standard Web Audio look-ahead pattern instead: a plain `setInterval`
 * repeatedly schedules any note starting within the next `LOOKAHEAD_S`
 * seconds via `AudioContext.currentTime`-relative absolute start times —
 * once `osc.start(t)` is called, the browser's own audio thread renders it
 * sample-accurately regardless of whether the JS scheduler runs late.
 *
 * SYNTHESIS: no OPL2/SB/Beeper/Tandy emulation — see `audio-bus.js`'s own
 * header for why (nobody has decoded a real per-id/per-instrument command
 * stream, and there is no tool to capture one live). Per the user's own
 * explicit decision, also no external GM soundfont: this port ships nothing
 * but GODS's own shipped bytes plus small amounts of from-scratch code, and
 * a multi-megabyte third-party soundfont would be the first asset in the
 * whole port that isn't derived from the game itself. Each MIDI channel
 * gets one of a small, fixed set of built-in oscillator voices (the same
 * scheduleTone/envelope idiom `audio-bus.js` already uses for SFX), chosen
 * by channel number purely so simultaneous channels stay distinguishable —
 * NOT an attempt to guess the real instrument. The inline `FF 7F` OPL
 * instrument meta-events `smf-parser.js` skips over are real data this
 * module does not interpret for timbre.
 *
 * PLACEMENT: deliberately NOT wired to any level/world/event. `GAME.EXE`
 * itself opens only `PGODS.MUS` (see `mus-container.js`'s own header for the
 * full citation), but which of its 70 real tracks plays at which moment in
 * play is UNKNOWN — no code path selecting a blob index was found this
 * session (`UNKNOWN_pgods_mus_cue_dispatch`, Gods/docs/drivers-and-memory.md).
 * `main.js` exposes every track through a dev picker instead of inventing a
 * mapping — the same disclosed-affordance spirit as its own weapon picker
 * ("a CHEAT rather than the only way to arm").
 */

import { parseSmf, notesFromEvents, buildTempoMap, ticksToSeconds } from './smf-parser.js';

const LOOKAHEAD_S = 0.1;
const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_DELAY_S = 0.1;   // time between play() and the first note, so the very first note isn't missed

/** One voice per MIDI channel, cycling if a track uses more channels than this. */
const CHANNEL_VOICES = [
  { type: 'square', gain: 0.11 },
  { type: 'triangle', gain: 0.14 },
  { type: 'sawtooth', gain: 0.09 },
  { type: 'sine', gain: 0.13 },
];

const midiNoteToFreq = (note) => 440 * 2 ** ((note - 69) / 12);

export class MusicPlayer {
  #ctx = null;
  #notes = [];
  #cursor = 0;
  #startTime = 0;
  #timer = null;
  #liveOscillators = new Set();

  #ensureContext() {
    if (!this.#ctx) {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.#ctx = new Ctor();
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume();
    return this.#ctx;
  }

  /**
   * True while the SCHEDULER is still queuing notes — NOT while audio is
   * still audibly sounding. `#scheduleAhead` clears the scheduling timer
   * itself (not via `stop()`, which would also cut off the still-legitimate
   * tail notes it just finished queuing) the instant the note list is
   * exhausted, so `playing` goes false while those already-scheduled notes
   * are still playing out. Nothing in this port currently reads `playing`
   * to mean "is silent right now".
   */
  get playing() { return this.#timer != null; }

  /** @param {Uint8Array} blob one SMF blob from `mus-container.js`'s `parseMusContainer`, already checked with `isSmf`
   * @param {number} [offsetSeconds=0] start this far into the piece (notes before it are skipped) */
  play(blob, offsetSeconds = 0) {
    this.stop();
    const { division, events } = parseSmf(blob);
    const tempoMap = buildTempoMap(events, division);
    const toSeconds = (tick) => ticksToSeconds(tick, tempoMap, division);
    this.#notes = notesFromEvents(events)
      .map((n) => {
        const time = toSeconds(n.tick);
        return { time, duration: Math.max(0.03, toSeconds(n.tick + n.durationTicks) - time), channel: n.channel, note: n.note, velocity: n.velocity };
      })
      .sort((a, b) => a.time - b.time);
    this.#cursor = 0;
    while (this.#cursor < this.#notes.length && this.#notes[this.#cursor].time < offsetSeconds) this.#cursor++;
    const ctx = this.#ensureContext();
    this.#startTime = ctx.currentTime + SCHEDULE_DELAY_S - offsetSeconds;
    this.#scheduleAhead();
    this.#timer = setInterval(() => this.#scheduleAhead(), SCHEDULER_INTERVAL_MS);
  }

  #scheduleAhead() {
    const ctx = this.#ctx;
    const horizon = (ctx.currentTime - this.#startTime) + LOOKAHEAD_S;
    while (this.#cursor < this.#notes.length && this.#notes[this.#cursor].time <= horizon) {
      this.#scheduleNote(this.#notes[this.#cursor++]);
    }
    /* Only stop SCHEDULING more notes — the ones already handed to Web Audio
     * still have to play out. This is NOT the same as `stop()`: that one is
     * for a caller-requested hard stop (a new play() superseding this one,
     * or the UI's own stop button), where cutting already-scheduled audio
     * off immediately is exactly the point. */
    if (this.#cursor >= this.#notes.length && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  #scheduleNote(n) {
    const ctx = this.#ctx;
    const voice = CHANNEL_VOICES[n.channel % CHANNEL_VOICES.length];
    const t0 = this.#startTime + n.time;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    this.#liveOscillators.add(osc);
    osc.addEventListener('ended', () => this.#liveOscillators.delete(osc));
    osc.type = voice.type;
    osc.frequency.setValueAtTime(midiNoteToFreq(n.note), t0);
    const peak = voice.gain * Math.max(0.15, Math.min(1, n.velocity / 100));
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + n.duration + 0.05);
  }

  /**
   * A hard stop: cancels the scheduler AND every oscillator already handed
   * to Web Audio, immediately. Called at the top of every `play()` so a
   * rapid track switch (the dev picker's own `change` handler) cannot leave
   * the OLD track's still-pending notes sounding underneath the new one —
   * `.stop(0)` on a node already past its own start time stops it at once;
   * on one not yet started, it cancels it before it ever sounds.
   */
  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const osc of this.#liveOscillators) { try { osc.stop(0); } catch { /* already stopped */ } }
    this.#liveOscillators.clear();
  }
}
