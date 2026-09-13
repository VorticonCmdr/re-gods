/* levers.js — the idle+FIRE lever/switch toggle.
 *
 * PROVENANCE
 *   `hero-fire.js` already established that fire means three different things
 *   depending on the hero's state: shoot while moving, THROW A LEVER while
 *   standing (state 26, `CS:0x49EA -> CS:0x1045`), use an item while
 *   crouching. `pickup.js` already corrected `CS:0x1045` away from "object
 *   pickup" to "the lever toggle". Neither module implements it — this one
 *   does, from a fresh, complete disassembly of `CS:0x1045`-`0x10D6` plus its
 *   two callees `CS:0x115b` (the lever-table lookup) and `CS:0x10dd` (the
 *   hero-proximity box), none of which had been read before this pass.
 *
 *   THE THREE GATES, `CS:0x1045`-`0x1060`:
 *
 *     1045  cmp byte[0x346],0 / jz 104f     ; the DEBOUNCE latch — see below
 *     104c    jmp 10dc (return)
 *     104f  cmp byte[0x361],0 / jz 1059     ; a special-UI-mode gate — NOT
 *     1056    jmp 10dc (return)             ;   MODELLED, see below
 *     1059  cmp byte[0x3a2],0 / jns 10dc    ; an ANIMATED toggle already
 *                                           ;   in progress -> bail
 *     1060  mov byte[0x346],1               ; latch SET — unconditionally,
 *                                           ;   whether or not a lever is
 *                                           ;   actually found below
 *
 *   `DS:0x346` is the exact same "one action per press" shape this project's
 *   own `Arsenal.latch`/`allocate()` already implements for weapon fire
 *   (`CS:0x351`): cleared every tick fire is NOT held (`CS:0x49F9`), set the
 *   instant the scan below is even ATTEMPTED (not merely on success) — so
 *   holding fire while idle scans (at most) once per press, exactly like the
 *   original.
 *
 *   `DS:0x361` gates on a dedicated full-screen UI mode this port does not
 *   implement — tracing its OWN writers (`CS:0x8D00`, inside the already-
 *   documented level-load/respawn routine `FUN_1000_8c34`, and `CS:0x6C30`,
 *   inside a function that caches the money total and runs an interactive
 *   grid-cursor loop with its own `FUN_1000_0dff`/`FUN_1000_35ad` per-tick
 *   calls — i.e. a SHOP-STYLE full-screen UI) shows it is 0 whenever real
 *   gameplay is running normally. Since this port has no such screen, the
 *   gate is always open here — disclosed, not silently dropped.
 *
 *   `DS:0x3a2` is the already-documented delayed-animated-toggle progress
 *   counter (`UNKNOWN_lever_special_types`, CLOSED elsewhere in this
 *   project's own notes) — negative means idle, 0..5 mid-animation.
 *
 *   THE SCAN, `CS:0x1065`-`0x10C9` — all 200 live map objects, first match
 *   wins, then RETURN (one toggle per press, confirmed: `CS:0x10D6 ret`
 *   immediately after the sound call, no loop-continue):
 *
 *     106b  cmp word[si+6],0 / jz next        ; +6 (flag6) must be nonzero —
 *                                              ;   "on screen right now"
 *     1071  cmp word[si+4],0 / js next        ; +4 (type) must be live
 *     1077  type = [si+4]
 *     1087  cmp descriptor(type).category,3 / jnz next   ; CATEGORY 3 ONLY
 *     1094  call 0x115b                       ; lever-table lookup, below
 *     1099  or dx,dx / js next                ; NOT a real lever -> skip
 *     109d  call 0x10dd                       ; hero-proximity box, below
 *     10a0  jc next                           ; too far -> skip
 *     10a2..10b8  sprite in {0x120,0x122,0x124,0xe8}? -> the delayed anim
 *     10c5  else: xor byte[obj.type],1  AND  xor byte[lever.type],1
 *     10ce  play sfx 0x62b
 *     10d6  ret                               ; ONE toggle per press
 *
 *   `CS:0x115b` — searches the 64-entry `DS:0xa5f8` lever table (already
 *   parsed by `events.js`'s `parsePalfils`) for an EXACT `{x,y}` match against
 *   the candidate object. This is the cross-reference that makes a category-3
 *   object a REAL lever the trigger system can see — a category-3 object with
 *   no matching lever-table entry cannot be toggled by this routine at all
 *   (though nothing stops the ordinary object-fall/draw code from treating it
 *   as an inert category-3 sprite).
 *
 *   `CS:0x10dd` — the hero-proximity box, WORLD-space (camera cancels on the
 *   X side since both operands get -camX; Y is compared directly, since the
 *   caller preserves the object's own WORLD Y rather than converting it — see
 *   `UNKNOWN_ss432_indirect` elsewhere in this project for why category>=3
 *   objects keep their Y in world space through this part of the walk):
 *
 *     10df  bx = heroWorldX ; ax = objWorldX + 4
 *     10e6  cmp bx,ax / jg reject        ; heroX >  objX+4        -> reject
 *     10ea  bx += 0x18
 *     10ed  cmp bx,ax / jl reject        ; heroX+24 < objX+4      -> reject
 *                                        ; => heroX in [objX-20, objX+4]
 *     10f4  bx = heroWorldY ; ax = objWorldY + 0x10
 *     10fb  cmp bx,ax / jg reject        ; heroY >  objY+16       -> reject
 *     10ff  bx += 0x30
 *     1102  cmp bx,ax / jl reject        ; heroY+48 < objY+16     -> reject
 *                                        ; => heroY in [objY-32, objY+16]
 *     1106  clc / ret                    ; accept
 *
 *   THE FOUR SPECIAL SPRITES, `CS:0x10A2`-`0x10B8` (sprite = 170+type, so
 *   POBJECTS types 118/120/122/62): these get a DELAYED, ANIMATED toggle
 *   instead of the instant one, consumed by the object-DRAW routine
 *   (`FUN_1000_1d01`, already documented) rather than here:
 *
 *     10ba  [0x20e] = the touched object    ; arm it
 *     10be  [0x3a2] = 0                     ; start the 6-phase animation
 *
 *   The draw routine then advances `DS:0x3a2` once per FRAME (not once per
 *   press), picking a sprite from a per-WORLD 5-entry table at `DS:0xe01e`
 *   (read live: world1 `{410,411,289,411,410}`, world2 `{329,330,233,330,
 *   329}`, world3 `{412,413,291,413,412}`, world4 `{414,415,293,415,414}`),
 *   flips the object's own type at phase 3 of 5 (the table's own MIDDLE
 *   entry is exactly that object's own post-toggle sprite id, 170+(type^1) —
 *   confirmed for all four worlds), and re-arms (`[0x3a2]=0xff`, i.e.
 *   negative/idle) once the 6th phase (0..5) completes. Placed 18 times
 *   across the 8 shipped maps (5/4/2/2/0/3/0/2) — a real, if minor, mechanic.
 *
 *   Shipped census (`node`, this project's own maps): ordinary lever/switch
 *   objects (types 24-27) place 27/28/22/16/0/0/1/0 times across the eight
 *   levels — heavily worlds 1-2, nearly absent from 3-4.
 */

import { CATEGORY } from './objects.js';

/** CS:0x10A2-0x10B8 — sprite = 170+type for POBJECTS types 118/120/122/62. */
export const SPECIAL_LEVER_SPRITES = Object.freeze([0x120, 0x122, 0x124, 0xe8]);

/** CS:0xe01e, read live — per-world {before, mid-left, TOGGLED, mid-right,
 *  after} sprite ids for the delayed animation's 5 real frames (phase 0 is
 *  the arm-tick with nothing drawn yet, matching `DS:0x3a2`'s own 0..5 range
 *  one tick ahead of the table's own 0..4 index). */
export const SPECIAL_LEVER_ANIM = Object.freeze({
  1: [410, 411, 289, 411, 410],
  2: [329, 330, 233, 330, 329],
  3: [412, 413, 291, 413, 412],
  4: [414, 415, 293, 415, 414],
});

/** CS:0xac57 sfx id "0x62b" — no audio layer exists yet; exposed as an event
 *  flag, matching player.js's own `footstep`/`climbStep` convention. */
export const SFX_LEVER_TOGGLE = 0x62b;

/**
 * CS:0x10dd. World-space hero-proximity box around a category-3 object.
 * @param {{x:number,y:number}} hero
 * @param {{x:number,y:number}} obj
 */
export function heroNearLever(hero, obj) {
  return hero.x >= obj.x - 20 && hero.x <= obj.x + 4 &&
         hero.y >= obj.y - 32 && hero.y <= obj.y + 16;
}

/**
 * CS:0x1045's own state — the debounce latch and the delayed-animation
 * progress counter, plus the mutation itself.
 */
export class LeverToggle {
  constructor() {
    this.latch = false;        // DS:0x346
    this.anim = null;          // DS:0x3a2 >= 0 while set: { obj, lever, world, phase }
    this.lastToggle = null;    // the object just toggled, or armed — event only
  }

  /** CS:0x49F9 — call once per tick, BEFORE anything reads the latch. */
  latchTick(fireHeld) { if (!fireHeld) this.latch = false; }

  animating() { return this.anim !== null; }

  /**
   * CS:0x1045-0x10D6. Call when the hero is truly idle (state 26) and fire
   * is held — the caller's job to gate on state, exactly as `_tryFire`
   * separates entry from allocation elsewhere in this port.
   *
   * ⚠️ THIS IS THE SCAN ONLY. The delayed animation it can ARM is advanced
   * by `step()`, below, called unconditionally every tick from the object-
   * draw pass — NOT from here — because the original's own animation lives
   * in the DRAW routine (`FUN_1000_1d01`) and keeps running for as long as
   * the object stays on screen, whether or not the hero is still idle or
   * even still holding fire. A version that advanced the animation only
   * while this scan runs would freeze it the instant the player moves away.
   *
   * @param {Array<{x:number,y:number,type:number,dead:boolean,flag6:number}>} objects
   *   the live 200-record object array (drawObjects).
   * @param {Uint8Array|number[]} cats  POBJECTS category table, by type.
   * @param {Array<{x:number,y:number,type:number}>} levers  the parsed
   *   PALFILS lever table (`events.js`'s `parsePalfils(...).levers`) —
   *   MUTATED in place: bit 0 of `.type` is flipped on an ordinary toggle.
   * @param {{x:number,y:number}} hero  world position.
   * @returns {boolean} true if a toggle happened or a delayed one was armed.
   */
  tick(objects, cats, levers, hero) {
    this.lastToggle = null;
    if (this.animating()) return false;      // CS:0x1059 — one at a time
    if (this.latch) return false;            // CS:0x1045
    this.latch = true;                       // CS:0x1060 — unconditional past here

    for (const o of objects) {
      if (!o.flag6) continue;                    // CS:0x106b — must be on-screen
      if (o.dead || o.type < 0) continue;         // CS:0x1071 — must be live
      if ((cats[o.type] ?? -1) !== CATEGORY.LEVER) continue;   // CS:0x1087
      const lever = levers.find((l) => l.x === o.x && l.y === o.y);   // CS:0x115b
      if (!lever) continue;                        // CS:0x1099
      if (!heroNearLever(hero, o)) continue;        // CS:0x10dd/0x10a0
      const sprite = 170 + o.type;
      if (SPECIAL_LEVER_SPRITES.includes(sprite)) {
        this.anim = { obj: o, lever, phase: 0 };     // CS:0x10ba/0x10be
      } else {
        o.type ^= 1;                                  // CS:0x10c5
        lever.type ^= 1;                                // CS:0x10c9
      }
      this.lastToggle = o;
      return true;
    }
    return false;
  }

  /** The delayed toggle's own sprite for the current phase, or null when no
   *  animation is running, or this isn't the object it's running on —
   *  `main.js` draws this INSTEAD OF the object's own ordinary sprite while
   *  it's non-null (`FUN_1000_1d01`'s own "does this match the object
   *  currently being drawn" gate). */
  spriteFor(obj, world) {
    if (!this.anim || this.anim.obj !== obj) return null;
    const table = SPECIAL_LEVER_ANIM[world];
    return table ? table[this.anim.phase] : null;
  }

  /** CS:0x1D67-0x1D81 — advances once per FRAME (not per press, and not
   *  gated on the hero's state at all), toggling at phase 3 of 5 and
   *  re-arming (idle) after phase 5 completes. Call unconditionally, every
   *  tick, regardless of `tick()` above ever having been called this frame. */
  step() {
    if (!this.anim) return;
    this.anim.phase += 1;
    if (this.anim.phase === 3) {                 // CS:0x1D6B/0x1D72
      this.anim.obj.type ^= 1;
      this.anim.lever.type ^= 1;
    }
    if (this.anim.phase >= 5) this.anim = null;    // CS:0x1D7A/0x1D81
  }
}
