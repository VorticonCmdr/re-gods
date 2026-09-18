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
 * `player.js`'s per-tick `footstep`/`climbStep` flags (`FOOTSTEP_SFX` =
 * `0x020e`, `CLIMB_STEP_SFX` = `0x0240`) are wired too, as of a later pass.
 * The "needs cadence tuning against the actual footfall interval" caveat
 * this comment used to carry here was checked, not assumed, and turned out
 * to be unnecessary: `footstep` is already gated to exactly
 * `WALK_FOOTSTEP_PHASES` (2 of every 8 walking ticks — the same gate
 * CS:0x5AAD/0x5ABA apply) and `climbStep` only fires at the ping-pong
 * turn-arounds behind `_climb`'s own `tock===0` early return, so
 * `if (fr.footstep) audio.play(FOOTSTEP_SFX)` at the per-tick call site IS
 * the tuned version — there is no separate real-time cadence to build.
 * `CLIMB_STEP_SFX`'s id is also a correction: `Gods/docs/player-state-
 * machine.md` used to cite it as "the climb-step sound 0x5931", but 0x5931
 * is the CS: address of the 9-byte thunk that plays it
 * (`push ax / mov ax,0x240 / call 0x22ca / pop ax / ret`), not the id —
 * see that doc's own correction and player.js's `CLIMB_STEP_SFX` comment.
 * Dispatch (the right flag reaches the right id) is Node-verified in
 * checks.js; like every other gameplay SFX in this file, it has not been
 * personally heard — see the VERIFICATION LEVEL paragraph above. Footsteps
 * fire far more often than any one-shot event voice in this game, so its
 * gain is deliberately kept low to avoid swamping the mix under sustained
 * walking.
 *
 * `projectiles.js`'s `TERRAIN_SFX`/`AXE_BOUNCE_SFX` are wired too, as of a
 * still later pass. Both needed real signal-carrying, not just a read:
 * `Arsenal.step()` (`game/hero-fire.js`) already collected `hits` (one
 * entry per projectile the terrain stopped this tick, CS:0xA7F6) into its
 * returned `projectiles` object for the debris puff frame.js drops at each
 * one — `main.js` now also plays `TERRAIN_SFX` once per entry, same array.
 * `axeBounced` (CS:0xa7ad) needed a genuinely new field: `Arsenal.step()`
 * already kept a LIFETIME total (`this.axeBounced`, for the HUD) but never
 * returned the per-tick delta, so there was nothing for a hook to read —
 * `step()` now also returns that tick's own count.
 *
 * Still deliberately NOT wired (disclosed, not silently dropped): the
 * Roland-only alternate kill sound `0x0e49`
 * (CS:0xABB7/0xABD1, gated on `DS:0x35e`, audible on only 3 specific
 * creature classes and only under that one driver — see
 * Gods/docs/drivers-and-memory.md's "Sound: a 13-slot interface").
 * See checks.js's own "sound ids" note for the same list kept in sync.
 *
 * ⚠️ A still later pass wired the time bomb (`hero-fire.js`'s
 * `TIME_BOMB_WEAPON`, previously dead code — its spawn handler was
 * undecoded and its mover was never dispatched from `Arsenal.step()`).
 * That pass also caught and fixed a citation bug: this file used to list
 * `0x22` bomb detonation as a disclosed non-wire, taking `Gods/docs/
 * combat-and-projectiles.md`'s own citation at face value — but unlike
 * every OTHER bare-low-byte id already corrected in this project
 * (`0x1c`→`0x041c`, `0x1d`→`0x21d`, `0x09`→`0x209`), that one had never
 * actually been re-checked against a fresh `MOV AX,imm` read. It wasn't a
 * full word missed by convention; it was simply never verified. A Ghidra
 * read of `CS:0xA27C` found `mov ax,0x1022` — the real id is `0x1022`, not
 * `0x22` — corrected here and in that doc. The time bomb's OTHER sound,
 * the bounce/land thud `0x0609` (`CS:0xA165`/`0xA1D7`), is wired too.
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
  /* player.js's FOOTSTEP_SFX. Plays twice per 8-tick walk cycle — the most
   * frequent sound in the game by a wide margin — so gain is deliberately
   * well below every one-shot event voice above; a short filtered thump,
   * not a tone, so it reads as a footfall rather than a UI blip. */
  0x020e: (ctx, dest, t0) =>
    scheduleNoise(ctx, dest, t0, { dur: 0.035, gain: 0.07, filterFreq: 220 }),
  /* player.js's CLIMB_STEP_SFX, fired at the two ends of the climb ping-pong
   * (see that constant's own citation for the 0x5931 id correction). A
   * short, higher click distinguishes it from a footstep by ear. */
  0x0240: (ctx, dest, t0) =>
    scheduleNoise(ctx, dest, t0, { dur: 0.03, gain: 0.09, filterFreq: 500 }),
  /* projectiles.js's TERRAIN_SFX — a shot stopped by a wall. A dull, low
   * thud, distinct from the fire/kill voices above, so a wall stop reads
   * as "blocked" rather than "hit something". */
  0x021d: (ctx, dest, t0) =>
    scheduleNoise(ctx, dest, t0, { dur: 0.06, gain: 0.18, filterFreq: 300 }),
  /* projectiles.js's AXE_BOUNCE_SFX — the magic axe ricocheting off a wall.
   * A short bright ping, distinct from the dull terrain-stop thump above:
   * the axe keeps flying, it hasn't stopped. */
  0x0209: (ctx, dest, t0) =>
    scheduleTone(ctx, dest, t0, { freq: 1200, dur: 0.04, type: 'triangle', gain: 0.14, slideTo: 700 }),
  /* projectiles.js's BOMB_THUD_SFX — the time bomb bouncing off a wall, or
   * settling onto the ground the tick after it lands. A low, damped thump —
   * heavier than the projectile terrain-stop above, since this is a whole
   * bomb landing, not a shot. */
  0x0609: (ctx, dest, t0) =>
    scheduleNoise(ctx, dest, t0, { dur: 0.09, gain: 0.22, filterFreq: 200 }),
  /* projectiles.js's BOMB_DETONATE_SFX — the time bomb's own fuse running
   * out. A sharp burst, distinct from every other voice here: this is the
   * loudest, lowest one-shot event in the game. */
  0x1022: (ctx, dest, t0) => {
    scheduleNoise(ctx, dest, t0, { dur: 0.22, gain: 0.32, filterFreq: 900 });
    scheduleTone(ctx, dest, t0, { freq: 90, dur: 0.3, type: 'sawtooth', gain: 0.22, slideTo: 40 });
  },
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
