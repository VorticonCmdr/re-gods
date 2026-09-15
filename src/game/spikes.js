/* spikes.js — the retracting spike hazard, POBJECTS types 50/117/130.
 *
 * PROVENANCE
 *   Undocumented before this pass. Found by reading the category-4 object-
 *   array dispatch (`FUN_1000_1b5b`, reached from the same per-object walk
 *   that dispatches the world-2 nest (type 115) and the world-3 `ce64`
 *   creature (type 96) — CLAUDE.md's own "What category 4 is, from the data
 *   side" section only ever chased those two) all the way through, rather
 *   than stopping once the already-known types were matched.
 *
 *   `CS:0x1B5D`-`0x1B6F` dispatches by SPRITE id (170+type, since these are
 *   ordinary map objects, sprite-stamped like any other):
 *
 *     cmp cx,0x11f / jz 1b72     ; type 117 -> the SHARED animated body
 *     cmp cx,0x12c / jz 1af6     ; type 130 -> its OWN, simpler body
 *     cmp cx,0xdc  / jz 1b72     ; type  50 ("spike") -> the SAME shared body
 *     else -> the other category-4 dispatch (nest/ce64/etc.)
 *
 *   SHIPPED CENSUS (this project's own maps): type 50 places 13/13/11/11
 *   across worlds 1-2 (48 total — very common); type 117 places 4 times
 *   (world 3B only); type 130 places 9/8 across world 4 (17 total). Type 73
 *   places ZERO times anywhere and is not modelled (matching this project's
 *   own established convention for unreachable shipped data).
 *
 *   ── TYPES 50/117 — THE SHARED ANIMATED BODY, `CS:0x1B72`-`0x1C72` ──────
 *
 *   The retract/extend motion is a GLOBAL ping-pong counter, `DS:0x39b`,
 *   shared by EVERY type-50/117 object in the level at once — they animate
 *   in lockstep, not independently:
 *
 *     CS:0x1447  inc byte[0x39b] / and byte[0x39b],0x1f   ; 0..31, once per tick
 *     CS:0x1B83  dl = [0x39b] ; test dl,0x10
 *                if SET:   dl &= 0xef ; result = 15 - dl      (16..31 -> 15..0)
 *                if CLEAR: dl &= 0xef ; result = dl            ( 0..15 ->  0..15)
 *
 *   i.e. a 0..15..0 triangle wave over 32 ticks (~2.1s at 15Hz) — see
 *   `spikePingpong()` below, `[PROVEN]` against the raw `AND 0x1f` wrap.
 *
 *   The hazard's own "tip" Y (world space) is `obj.y + 15 - pingpong`
 *   (`CS:0x1BA3-0x1BA8`: `+0x1f`, `-pingpong`, `-0x10`). The BASE sprite
 *   (170+type) draws 16px below that (`CS:0x1BE1 add bx,0x10` undoes the
 *   `-0x10` for the draw only, not the hitbox test), and the OVERLAY sprite
 *   draws AT the tip Y (`CS:0x1C10 sub word[0x6],0x10`, back down to the
 *   hitbox's own value) — the overlay is what visually reaches toward the
 *   hero as the hazard extends.
 *
 *   THE HITBOX, `CS:0x1BAB`-`0x1BD8`, world space (X genuinely cancels the
 *   camera on both sides; Y is compared directly because this whole walk
 *   keeps category>=3/4 objects' Y in world space — see `UNKNOWN_ss432_
 *   indirect` elsewhere in this project):
 *
 *     heroX in [objX - 24, objX + 8]
 *     heroY in [tipY  - 40, tipY]
 *
 *   `CS:0x1BD1 cmp word[0x172],0 / jnz reject ; CS:0x1BD8 sub word[0x192],2`
 *   — a FLAT 2 HEALTH TARGET (`DS:0x192`) EVERY TICK the hero overlaps and
 *   is not invulnerable. There is no debounce, no one-touch-and-consume: a
 *   hero who lingers takes 2 damage per 15Hz tick (30/s), a genuinely
 *   different threat model from every creature's own one-touch-kill contact
 *   (`CS:0xac59`) — this hazard does not even go through that shared routine.
 *
 *   THE OVERLAY SPRITE — a SECOND, per-type animation, on its OWN global
 *   counter, drawn 16px above the base sprite (`CS:0x1C1B` branches by the
 *   ORIGINAL sprite id, not the just-computed draw position):
 *
 *     type 50  (0xdc):  DS:0x39c, wraps mod 4 (`AND 0x3`) -> table `DS:0xdffe`
 *                        {220, 313, 314, 315}  (170+50, then 3 more frames)
 *     type 117 (0x11f): DS:0x39f, wraps mod 6 (`AND`, `CMP ...,6`) -> table
 *                        `DS:0xe006` {287, 416, 417, 418, 419, 420}
 *
 *   Both tables read live (`read_memory("1ffd:dffe", 36)`); `DS:0xe012`
 *   (type 130's own table, below) sits immediately after `DS:0xe006`'s 6
 *   words, and `DS:0xe01e` (the already-documented special-lever animation,
 *   `levers.js`) sits immediately after THAT — three tables end to end with
 *   zero slack, cross-checking all three boundaries at once.
 *
 *   ── TYPE 130 — ITS OWN, SIMPLER BODY, `CS:0x1AF6`-`0x1B58` ─────────────
 *
 *   No ping-pong on the hitbox at all — it is FIXED at `obj.y + 16`. A
 *   single sprite, from its own 6-entry table (`DS:0xe012`, SHARES `DS:0x39f`
 *   with type 117's overlay above — both wrap mod 6, and type 130 reads it
 *   independently since it has no ordinary/overlay split of its own):
 *
 *     {300, 421, 422, 423, 424, 425}   (170+130, then 5 more frames)
 *
 *   THE HITBOX, `CS:0x1B12`-`0x1B41` (screen-space X this time — both
 *   operands share the SAME camera-relative frame, so it's equivalent to
 *   world space exactly like the shared body above):
 *
 *     heroX in [objX - 20, objX + 20]
 *     heroY in [objY - 40, objY + 24]
 *
 *   Same flat -2 health, same invulnerability gate, same total absence of
 *   any debounce — `CS:0x1B41 sub word[0x192],2`.
 */

/** CS:0x1447 — the shared retract/extend driver for types 50 and 117. */
export function spikePingpong(raw39b) {
  return (raw39b & 0x10) ? (15 - (raw39b & 0xf)) : (raw39b & 0xf);
}

/** CS:0xdffe, read live: type 50's own 4-frame overlay, `DS:0x39c` mod 4. */
export const SPIKE_OVERLAY = Object.freeze([220, 313, 314, 315]);
/** CS:0xe006, read live: type 117's own 6-frame overlay, `DS:0x39f` mod 6. */
export const SPIKE117_OVERLAY = Object.freeze([287, 416, 417, 418, 419, 420]);
/** CS:0xe012, read live: type 130's own 6-frame animation, ALSO `DS:0x39f`. */
export const SPIKE130_ANIM = Object.freeze([300, 421, 422, 423, 424, 425]);

export const SPIKE_TYPE = 50;
export const SPIKE117_TYPE = 117;
export const SPIKE130_TYPE = 130;

/** All three global counters this file's animations share, plus the tick
 *  that advances them (`CS:0x1447`-`0x147F`, all three in the SAME
 *  once-per-frame object pass — every spike/117/130 in a level animates in
 *  lockstep, not independently). */
export class SpikeClock {
  constructor() {
    this.raw39b = 0;    // 0..31, spikePingpong() input
    this.frame39c = 0;  // 0..3
    this.frame39f = 0;  // 0..5
  }

  get pingpong() { return spikePingpong(this.raw39b); }

  step() {
    this.raw39b = (this.raw39b + 1) & 0x1f;
    this.frame39c = (this.frame39c + 1) & 3;
    this.frame39f = (this.frame39f + 1) % 6;
  }
}

/**
 * CS:0x1BAB-0x1BD8. World-space hero-vs-spike box for types 50/117.
 * @param {{x:number,y:number}} hero
 * @param {{x:number,y:number}} obj
 * @param {number} pingpong  0..15, `clock.pingpong`
 */
export function heroInSpikeBox(hero, obj, pingpong) {
  const tipY = obj.y + 15 - pingpong;
  return hero.x >= obj.x - 24 && hero.x <= obj.x + 8 &&
         hero.y >= tipY - 40 && hero.y <= tipY;
}

/** CS:0x1B12-0x1B41. Type 130's own FIXED (unanimated) hitbox. */
export function heroInSpike130Box(hero, obj) {
  return hero.x >= obj.x - 20 && hero.x <= obj.x + 20 &&
         hero.y >= obj.y - 40 && hero.y <= obj.y + 24;
}

/**
 * One tick for ALL type-50/117/130 objects in `objects`. Applies the flat,
 * undebounced -2 health hit (`CS:0x1BD8`/`0x1B41`) and returns draw records
 * for the renderer — base+overlay for 50/117, one sprite for 130.
 *
 * @param {Array<{x:number,y:number,type:number,dead:boolean,flag6:number}>} objects
 * @param {SpikeClock} clock
 * @param {{x:number,y:number}} hero  world position
 * @param {object} health  `combat.js`'s `Health` — `.damage(n)`
 * @param {{invuln?:boolean}} [opts]
 * @returns {Array<{x:number,y:number,type:number,pingpong:?number}>} the live
 *   spike/117/130 objects this tick, each carrying its own current
 *   animation state for the caller's own sprite lookup (this module knows
 *   the SPRITE IDS but not the renderer's atlas, so it hands back state,
 *   not a sprite id, matching `rockfall.js`'s own division of labour where
 *   the sprite table itself is simple enough to inline — here there are
 *   three interacting tables plus a two-sprite overlay, so the renderer is
 *   left to call `spikeSprites()`/`spike130Sprite()` below.).
 */
export function stepSpikes(objects, clock, hero, health, opts = {}) {
  const live = [];
  for (const o of objects) {
    if (o.dead || o.type < 0 || !o.flag6) continue;
    if (o.type === SPIKE_TYPE || o.type === SPIKE117_TYPE) {
      live.push(o);
      if (heroInSpikeBox(hero, o, clock.pingpong) && !opts.invuln) {
        health.damage(2);                       // CS:0x1BD8
      }
    } else if (o.type === SPIKE130_TYPE) {
      live.push(o);
      if (heroInSpike130Box(hero, o) && !opts.invuln) {
        health.damage(2);                       // CS:0x1B41
      }
    }
  }
  return live;
}

/**
 * The base sprite (170+type: 220/287, both shipped as 16x32) is drawn from
 * only its BOTTOM 16 rows, not the full frame. Both the overlay (16 tall,
 * `CS:0x1C10`) and the base (32 tall, `CS:0x1BE1`) are drawn at ADJACENT,
 * non-overlapping world Y ranges — `[tipY, tipY+16)` then `[tipY+16,
 * tipY+48)` — so a full-height base composites as overlay-crown, then a
 * SECOND static crown (the base frame's own top 16 rows — sprite 220/287
 * draw a complete standalone crown+shaft, not a shaft alone), then shaft.
 * Live-verified against a DOSBox reference screenshot of this exact scene
 * (PLEV1A, the two spikes beside the lever at 416,928): the "bottom 16 rows
 * only" composite (one crown, then shaft, total 32px) matches it pixel-for-
 * pixel; the full-32-row composite shows the extra duplicate crown the
 * reference does not have — see the `buildDrawSequence`/draw-order fix this
 * accompanies for how that duplicate was first mistaken for a z-order bug.
 * The exact register-level mechanism in `CS:0x1BF0`'s `byte[0x411]=0x40`
 * override (export 2, `VGA:0x1B86`) was traced and ruled out as its cause —
 * it is a numeric no-op for a naturally-32-tall sprite — so what in the
 * original actually produces the 16-row crop remains open
 * (`UNKNOWN_spike_base_crop_mechanism`); the CROPPED RESULT itself is
 * `[PROVEN]` by the screenshot match, independent of the mechanism.
 */
export const BASE_VISIBLE_ROWS = 16;

/**
 * CS:0x1BE1-0x1C6C. The two sprites (base, overlay) and their world
 * positions for a type-50/117 object at the clock's current phase. The
 * base record's `visibleRows` tells the renderer to draw only that many
 * rows, taken from the BOTTOM of the base sprite's frame (skipping
 * `f.h - visibleRows` rows off the top before blitting) — see
 * `BASE_VISIBLE_ROWS` above.
 */
export function spikeSprites(obj, clock) {
  const pingpong = clock.pingpong;
  const baseY = obj.y + 31 - pingpong;          // CS:0x1BE1 undoes the -0x10
  const overlayY = obj.y + 15 - pingpong;       // CS:0x1C10 — the hitbox's own tipY
  const overlay = obj.type === SPIKE_TYPE
    ? SPIKE_OVERLAY[clock.frame39c]
    : SPIKE117_OVERLAY[clock.frame39f];
  return {
    base: { x: obj.x, y: baseY, sprite: 170 + obj.type, visibleRows: BASE_VISIBLE_ROWS },
    overlay: { x: obj.x, y: overlayY, sprite: overlay },
  };
}

/** CS:0x1AFF-0x1B4F. Type 130's own single sprite at the clock's phase.
 *  ⚠️ The `+0x10` at CS:0x1B0F is a HITBOX-ONLY mutation: `CS:0x1B0B push bx`
 *  saves the object's own plain Y first, and `CS:0x1B46 pop bx` restores it
 *  before the draw — the sprite itself renders at the object's own ordinary
 *  `(x, y)`, not offset, unlike the hitbox test in `heroInSpike130Box` above. */
export function spike130Sprite(obj, clock) {
  return { x: obj.x, y: obj.y, sprite: SPIKE130_ANIM[clock.frame39f] };
}
