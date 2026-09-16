/* audio-bus.js — #11's missing piece.
 *
 * This port has been carrying real SFX ids for a long time without anywhere
 * to send them: `shop.js`'s `BUY_CONFIRM_SFX`, `pickup.js`'s `PICKUP_SFX`,
 * `treasure.js`'s `TREASURE_SFX`/`CHEST_SFX`, `levers.js`'s
 * `SFX_LEVER_TOGGLE`, `starburst.js`'s `SPAWN_SFX`, `trigger-actions.js`'s
 * `SFX` enum (fed through its own `ctx.sfx` callback slot, which
 * `makeActionContext`'s default silently no-ops — the exact `NOT_WIRED_
 * REASON`-shaped trap this project's own memory warns about), `death.js`'s
 * `DEATH_SFX` (its own comment: "not played, no audio engine yet"), and
 * `tally.js`'s `sfxPending` flag ("exposed for a future audio layer to hook
 * rather than played here"). This module is that layer. `main.js` wires
 * every one of those existing signals into it; see its own citations at each
 * call site for which CS: address each id traces back to.
 *
 * ⚠️ NOT a chip-accurate reproduction, and this is a scope decision, not a
 * shortcut: Gods/docs/drivers-and-memory.md's "13-slot sound interface"
 * section documents the DISPATCH mechanism (which driver, which id ranges,
 * the Roland-only id-0x49 quirk) but nobody has decoded what any individual
 * id actually sounds like — there is no decoded per-id OPL2/SB/Beeper/Tandy
 * command stream, and the DOSBox bridge this project uses has no audio-
 * capture tool to extract one live. `SFX_VOICES` below is a STYLIZED
 * reproduction, keyed by the real ids purely for citation and so a future
 * session can replace a voice without touching any call site — the same
 * disclosed-simplification spirit as shop.js's text-only item grid or
 * tally.js's font substitution. Each voice exists to make one game event
 * audibly distinct from its neighbours (a purchase does not sound like a
 * kill), not to match AdLib/Beeper timbre.
 *
 * Two implementations, so the DISPATCH stays checkable under plain Node
 * (`tools/verify-node.mjs` has no `AudioContext`):
 *   - `RecordingAudioBus` — `.play(id)` appends to `.played`. What checks.js
 *     uses to assert the right id fires for the right game event.
 *   - `WebAudioBus` — real playback, browser-only. `AudioContext` is created
 *     (and resumed) lazily on the FIRST `.play()` call, never at module load
 *     or construction: browsers refuse to start an audio context before a
 *     user gesture, and the first sound this port ever plays (a title-menu
 *     cursor click) fires from inside a real keydown handler — lazy-start
 *     there is what makes any sound audible at all.
 *
 * VERIFICATION LEVEL, precisely, not blurred into one "verified in browser"
 * claim: the MENU path (`MENU_CLICK_SFX`/`MENU_CONFIRM_SFX`) was driven live
 * in a real Chrome tab with genuine keydown events (not synthetic dispatch,
 * which browsers don't count as a user gesture) — confirmed `AudioContext`
 * is created lazily, comes up `state: "running"`, and schedules the right
 * oscillator count per id. The GAMEPLAY-side hooks (shop, pickups, treasure,
 * levers, starburst, the seven trigger-action ids, death, tally) are
 * Node-verified for DISPATCH only (checks.js's own "#11 audio" block:  the
 * right id reaches the right game event) — not personally heard, since
 * gods-web's own automated-Chrome tick throttle (see project memory) makes
 * driving real gameplay through this harness unreliable for anything beyond
 * a few ticks.
 *
 * ⚠️ A later pass wired the rest of the combat-sound family (reported here
 * because it was found while chasing "no sound on hitting an enemy" —
 * `combat.js`'s `KILL_SFX`/`HURT_SFX`, and `projectiles.js`'s `FIRE_SFX`,
 * whose own exported value was ALSO corrected: it used to be the bare low
 * byte `0x1c`, which matches no key here and so silently played nothing —
 * the exact bug reported). Read live off `FUN_1000_a9e4` in Ghidra: a weapon
 * hit that damages a creature and it SURVIVES is silent in the original —
 * only the debris hit-spark plays, no sound at all — for every creature
 * EXCEPT the world-3 `DS:0xce64` type, where a `DS:0x34` bracket
 * (`CS:0x7FD4`) makes the tag decoder's own third `0x0f22` emitter
 * (`CS:0x936D`, inside `FUN_1000_9320`) fire on every damaging hit, lethal
 * or not — see Gods/docs/combat-and-projectiles.md's own correction under
 * "Weapon +0x49". This port does not model `DS:0x34`, so its ce64 creature
 * is silent on a non-lethal hit like every other creature — a disclosed
 * simplification, not an oversight — so "nothing plays on every hit" is
 * correct porting everywhere in `gods-web`, even though it is not what the
 * original does for that one creature.
 *
 * Still deliberately NOT wired (disclosed, not silently dropped):
 * `projectiles.js`'s `TERRAIN_SFX`/`AXE_BOUNCE_SFX` are real exported ids but
 * never attached to any per-tick result `frame.js` surfaces — wiring them
 * needs new signal-carrying, not just reading one, so it is left for a
 * follow-up. `player.js`'s per-tick `footstep`/`climbStep` flags (SFX
 * `0x0e`/`0x5931` per that module's own comments) are real signals but fire
 * every footfall — playing them well needs cadence tuning against the actual
 * footfall interval, not just a bare per-tick trigger, so they are left
 * silent rather than shipped sounding wrong. Also unwired: the Roland-only
 * alternate kill sound `0x0e49` (CS:0xABB7/0xABD1, gated on `DS:0x35e`,
 * audible on only 3 specific creature classes and only under that one
 * driver — see Gods/docs/drivers-and-memory.md's "Sound: a 13-slot
 * interface"), and `0x22` bomb detonation (CS:0xA27C).
 * See checks.js's own "sound ids" note for the same list kept in sync.
 */

function scheduleTone(ctx, dest, t0, { freq, dur, type = 'square', gain = 0.2, slideTo, delay = 0 }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0 + delay);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + delay + dur);
  g.gain.setValueAtTime(0, t0 + delay);
  g.gain.linearRampToValueAtTime(gain, t0 + delay + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
  osc.connect(g).connect(dest);
  osc.start(t0 + delay);
  osc.stop(t0 + delay + dur + 0.02);
}

function scheduleNoise(ctx, dest, t0, { dur, gain = 0.2, filterFreq, delay = 0 }) {
  const n = Math.max(1, Math.round(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0 + delay);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
  let node = src;
  if (filterFreq) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(dest);
  src.start(t0 + delay);
}

/**
 * One voice per real SFX id this port currently plays. Every id is cited at
 * its own call site in main.js (or the game-logic module that already named
 * it); the comment here just says which game moment it is, for readability.
 */
export const SFX_VOICES = {
  0x119: (ctx, dest, t0) => scheduleTone(ctx, dest, t0, { freq: 880, dur: 0.035, type: 'square', gain: 0.12 }),
  0x233: (ctx, dest, t0) => {
    scheduleTone(ctx, dest, t0, { freq: 660, dur: 0.05, type: 'square', gain: 0.15 });
    scheduleTone(ctx, dest, t0, { freq: 990, dur: 0.07, type: 'square', gain: 0.15, delay: 0.05 });
  },
  0x333: (ctx, dest, t0) => {
    scheduleTone(ctx, dest, t0, { freq: 523, dur: 0.05, type: 'triangle', gain: 0.18 });
    scheduleTone(ctx, dest, t0, { freq: 659, dur: 0.05, type: 'triangle', gain: 0.18, delay: 0.05 });
    scheduleTone(ctx, dest, t0, { freq: 784, dur: 0.09, type: 'triangle', gain: 0.18, delay: 0.10 });
  },
  0x0638: (ctx, dest, t0) => {
    scheduleTone(ctx, dest, t0, { freq: 440, dur: 0.04, type: 'triangle', gain: 0.16 });
    scheduleTone(ctx, dest, t0, { freq: 660, dur: 0.05, type: 'triangle', gain: 0.16, delay: 0.04 });
  },
  0x052d: (ctx, dest, t0) => {
    scheduleNoise(ctx, dest, t0, { dur: 0.08, gain: 0.25, filterFreq: 600 });
    scheduleTone(ctx, dest, t0, { freq: 880, dur: 0.07, type: 'triangle', gain: 0.15, delay: 0.09 });
  },
  0x62b: (ctx, dest, t0) => scheduleTone(ctx, dest, t0, { freq: 220, dur: 0.09, type: 'square', gain: 0.18, slideTo: 110 }),
  0x1427: (ctx, dest, t0) => scheduleTone(ctx, dest, t0, { freq: 300, dur: 0.18, type: 'sawtooth', gain: 0.15, slideTo: 1000 }),
  0x1e15: (ctx, dest, t0) => scheduleTone(ctx, dest, t0, { freq: 440, dur: 0.07, type: 'sine', gain: 0.15, slideTo: 660 }),
  0x0537: (ctx, dest, t0) => scheduleTone(ctx, dest, t0, { freq: 200, dur: 0.22, type: 'sine', gain: 0.14, slideTo: 520 }),
  0x053f: (ctx, dest, t0) => {
    scheduleNoise(ctx, dest, t0, { dur: 0.05, gain: 0.2, filterFreq: 400 });
    scheduleTone(ctx, dest, t0, { freq: 110, dur: 0.08, type: 'square', gain: 0.15 });
  },
  0x0548: (ctx, dest, t0) => scheduleTone(ctx, dest, t0, { freq: 150, dur: 0.25, type: 'sawtooth', gain: 0.14, slideTo: 320 }),
  0x052e: (ctx, dest, t0) => scheduleTone(ctx, dest, t0, { freq: 320, dur: 0.25, type: 'sawtooth', gain: 0.14, slideTo: 130 }),
  0x0f22: (ctx, dest, t0) => scheduleNoise(ctx, dest, t0, { dur: 0.12, gain: 0.28, filterFreq: 1800 }),
  0x7f3c: (ctx, dest, t0) => {
    scheduleTone(ctx, dest, t0, { freq: 523, dur: 0.15, type: 'triangle', gain: 0.18 });
    scheduleTone(ctx, dest, t0, { freq: 392, dur: 0.15, type: 'triangle', gain: 0.18, delay: 0.15 });
    scheduleTone(ctx, dest, t0, { freq: 262, dur: 0.28, type: 'triangle', gain: 0.18, delay: 0.30 });
  },
  0x52f: (ctx, dest, t0) => {
    scheduleTone(ctx, dest, t0, { freq: 1046, dur: 0.06, type: 'sine', gain: 0.15 });
    scheduleTone(ctx, dest, t0, { freq: 1568, dur: 0.10, type: 'sine', gain: 0.15, delay: 0.04 });
  },
  /* combat.js's HURT_SFX — the hero's own hurt sound. Distinct from the kill
   * noise above (0x0f22): a short descending tone, not filtered noise, so a
   * player can tell "I got hit" from "something died" by ear alone. */
  0x0e42: (ctx, dest, t0) =>
    scheduleTone(ctx, dest, t0, { freq: 300, dur: 0.09, type: 'sawtooth', gain: 0.18, slideTo: 120 }),
  /* projectiles.js's FIRE_SFX — a weapon leaving the hero's hand. Short and
   * bright so it reads as a "shot", not a hit or a pickup. */
  0x041c: (ctx, dest, t0) =>
    scheduleTone(ctx, dest, t0, { freq: 700, dur: 0.045, type: 'square', gain: 0.12, slideTo: 1200 }),
};

/** Node-testable: records ids instead of making sound. */
export class RecordingAudioBus {
  constructor() { this.played = []; }
  play(id) { this.played.push(id); }
}

/** Browser-only: real Web Audio playback, lazy-started on the first play(). */
export class WebAudioBus {
  #ctx = null;

  #ensureContext() {
    if (!this.#ctx) {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.#ctx = new Ctor();
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume();
    return this.#ctx;
  }

  play(id) {
    const voice = SFX_VOICES[id];
    if (!voice) return;
    const ctx = this.#ensureContext();
    voice(ctx, ctx.destination, ctx.currentTime);
  }
}
