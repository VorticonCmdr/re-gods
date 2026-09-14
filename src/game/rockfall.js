/* rockfall.js — the "falling rock" hazard pools, `DS:0xaccc` (settle/idle,
 * fed by `CS:0xB144`) and `DS:0xad1c`+`DS:0xad94` (burst-with-physics, fed
 * by `CS:0xB2C7`, combined into one 42-slot array since the two are
 * contiguous — `0xad1c + 12*10 == 0xad94`).
 *
 * ⚠️⚠️ CORRECTS CLAUDE.md's OWN PRIOR CLOSURE. `UNKNOWN_b1c2` originally
 * closed these three walkers (`FUN_1000_b1c2`, `FUN_1000_b3ce`,
 * `FUN_1000_b4e7`) as "the sixth identified cut feature" — an exhaustive
 * operand search for direct writes to `DS:0xaccc`/`DS:0x1f8`/`CS:0xb3ce`/
 * `CS:0xb4e7` found nothing, so the pools were believed permanently dead.
 * That search method has a real blind spot: `CS:0xB16B`/`CS:0xB317` both
 * load the pool's BASE ADDRESS into `SI` first (`MOV SI,0xaccc` /
 * `MOV SI,0xad1c`), then write through `[SI+n]` — one register-indirection
 * away from the literal address, invisible to a search for the immediate
 * operand. A fresh read of `CS:0xB144`/`CS:0xB290` (world 2's own selector-2
 * class 2/5/6/7 handler pair) and `CS:0xB2C7`/`CS:0xB2F3` (world 3's own
 * class 3) — both LIVE in shipped `PALFILS +0x0718` dispatches — shows both
 * pairs genuinely feed these pools, and `CS:0xB354`/`CS:0xB359` genuinely
 * arm `b3ce`'s/`b4e7`'s self-modifying `RET` gates by writing `0x90` (NOP)
 * over them. See `selector2.js`'s own header and CLAUDE.md's correction
 * under `UNKNOWN_b1c2` for the full trace.
 *
 * GROUND-PROBE LANDING AND THE SHATTER CHAIN — fresh disassembly this pass,
 * closing the gap the module's own prior header flagged. Both pools' full
 * ground-detection bodies were read (`FUN_1000_b1c2` in full; `FUN_1000_b3cf`
 * from its entry through the shatter tail at `CS:0xB38F`-`0xB38E`, plus the
 * shared `CS:0xB33D`-`0xB34E` free-slot-search/write loop it JMPs into with
 * a manually pushed return address — an 8086 tail-call idiom, not a bug):
 *
 *   - SETTLE pool (`FUN_1000_b1c2`, `CS:0xB1EB call 0x1000:b27f`): every
 *     tick, `y += 2` is written to the record FIRST, then `b27f` computes
 *     `col = x >> 5` (no bias), `row = (y + 8) & 0xfff0` (Y biased +8,
 *     THEN floored to 16 — a round-to-nearest, not a lookahead), and the
 *     SAME (just-updated) cell is tested — `cmp byte[di],1`. Solid -> the
 *     `+2` step is REVERTED (`y -= 2`, written back): the rock simply stops
 *     sinking and holds its Y forever after, still cycling its idle sprite.
 *     No shatter, no despawn-on-landing for this pool.
 *   - BURST pool (`FUN_1000_b3cf`, `CS:0xB45B`-`0xB480`): after this tick's
 *     `x+=vx,y+=vy` and the draw, `col = (x+8) >> 5`, `row = (y+4)&0xfff0`,
 *     and the cell ONE ROW BELOW (`[di+0x80]`, `+MAP_COLS` in index terms)
 *     is tested — a genuine one-row lookahead, not the settle pool's same-
 *     cell round. Solid -> `CS:0xB38F` fires: 3 children are written into
 *     the `DS:0xad94` half specifically (first-fit over its own 30 slots,
 *     never `DS:0xad1c`), each seeded at `(parentX+5, parentY+13)` — the
 *     landed parent's OWN post-move position, +2 (`CS:0xB3A4/B3A7`) then a
 *     further +3/+0xb (`CS:0xB35E/B361`) applied inside the shared write —
 *     with velocity from `DS:0xdf5c`'s own 3-entry `{vx,vy}` table (read
 *     live: `{-1,-6},{0,-7},{1,-6}}`, a gentle upward-and-outward pop). The
 *     parent is then freed (`CS:0xB4BF`) WITHOUT ever reaching the 5x5
 *     hero-hit test that tick — landing and being hit are mutually
 *     exclusive on the same tick, matching the bytes' own control flow
 *     (the shatter jump bypasses `CS:0xB48A` entirely).
 *
 * ⚠️⚠️ CORRECTION, a later pass — THE TWO HALVES ARE TWO SEPARATE WALKER
 * FUNCTIONS, NOT ONE COMBINED LOOP, AND THE MAIN-LOOP CALL ORDER IS NOW
 * CONFIRMED. `CS:0x022D`-`0x0233` (all three gated together behind
 * `cmp byte[0x34],0 / jnz 0x23c` — the scripted-cutscene engine, NOT
 * `DS:0x2fa` "freezes aliens" as an earlier pass of `selector2.js` guessed):
 *
 *     CS:0x022D  CALL 0x1000:b1c2    ; the settle pool (above)
 *     CS:0x0230  CALL 0x1000:b3ce    ; FUN_1000_b3cf — 12 `DS:0xad1c` slots
 *     CS:0x0233  CALL 0x1000:b4e7    ; FUN_1000_b4e7 — 30 `DS:0xad94` slots
 *
 * Three SEPARATE, sequential calls, each one running to completion before
 * the next starts. So a child the `b3ce` pass shatters into `DS:0xad94`
 * THIS tick is walked, moved and drawn by the `b4e7` pass LATER IN THE SAME
 * TICK — that is the original's own behaviour, confirmed by this call
 * order, not an artefact a port needs to route around. (An earlier pass of
 * this module's own test suite encoded the opposite assumption — that a
 * freshly-shattered child should render at its exact spawn position on the
 * tick it's created — and that assumption is what was wrong, not the code.)
 *
 * `FUN_1000_b4e7` itself was fully disassembled this pass (`1000:b4e7`-
 * `1000:b5e4`, 94 instructions) and turns out to differ from `b3ce` in five
 * concrete ways, none of them safe to infer from the settle/ad1c pair by
 * analogy:
 *
 *   1. `x += vx; y += vy` runs EVERY tick (`CS:0xB509/B50C`), not gated
 *      behind the tock byte the way `b3ce`'s gravity/drag block is.
 *   2. The screen-space cull (`x∈(-16,352)`, `y∈(-16,192)`, identical bounds
 *      to `b3ce`'s own) and a solid-ground landing both funnel into the
 *      SAME shared code at `CS:0xB5C2` — there is no silent "cull, no
 *      debris" case here the way `b3ce`'s own cull has: EVERY exit from
 *      this pass, landed or scrolled-off, frees the record and drops a
 *      MOVING debris spark carrying the fragment's own current velocity.
 *   3. The ground probe is `col=(x+5)>>5` (an arithmetic shift, sign-
 *      preserving), `row=(y-2)&~0xf`, testing the SAME cell — not `b3ce`'s
 *      `(x+8)>>5`/`(y+4)&~0xf`/one-row-below.
 *   4. Landing NEVER shatters — it is the same free-and-moving-spark exit
 *      as a screen-cull, per point 2.
 *   5. The hero-hit test is `db4e` (see `combat.js`), not `ac59` — a flat
 *      -2 off the health TARGET rather than `ac59`'s `damageFor(0)==5`, and
 *      invulnerability makes the fragment pass straight THROUGH (no
 *      consume) rather than merely suppressing the damage the way `ac59`
 *      does. `db4e` always zeroes the velocity it hands to its own debris
 *      spawn, so a `db4e` hit's spark is STATIONARY, unlike the moving
 *      spark on landing/cull above.
 *
 * Gravity (`vy++`, `CS:0xB561`) and the 4-frame animation cycle share the
 * same `cmp byte[0x36d],0 / jnz <skip>` polarity as `b3ce`'s own (advance
 * when `0x36d===0`) — no cap on `vy`, and no drag on `vx` (nothing ever
 * touches it again after the initial move).
 *
 * `db4e`'s own hot point is caller-specific — each caller pre-adjusts its
 * AX/BX before the call, and `db4e` itself adds a further `+6,+4` plus the
 * scroll origin (see `combat.js`'s own header). Resolved per caller, in
 * world space:
 *
 *   - settle pool  (`CS:0xB236`): hot point = `(worldX, worldY+6)`, and the
 *     record pointer `db4e` writes its consume-sentinel into is this
 *     pool's own X field — matching the pool's existing free-when-X<0
 *     convention. On a hit, `db4e`'s own debris spawn lands at
 *     `(worldX-8, worldY)`.
 *   - ad94 fragment (`CS:0xB5A6`): hot point = `(worldX+8, worldY+6)`. On a
 *     hit, `db4e`'s own debris spawn lands at the fragment's plain current
 *     world position, `(worldX, worldY)`, exactly.
 *
 * A genuine, previously-unreported bug found reading the settle pool's own
 * frame-advance gate while chasing this: `CS:0xB205 cmp byte[0x36c],0 /
 * CS:0xB20A jz <skip-the-increment>` is a `cmp/jz-skip` shape, which this
 * project's own `selector2.js` header already establishes means "advance
 * only when the tock byte is NONZERO" (its own `CS:0xB725-B73E` note, and
 * the "an earlier draft of this port used tock===0, inverting which of
 * every pair..." warning at line 522) — this module's own settle-pool type
 * advance had exactly that inversion (`tock === 0`, should be `tock !== 0`).
 * The burst pool's own gate (`CS:0xB43A cmp byte[0x36d],0 / CS:0xB43F jnz
 * <skip>`) is the OPPOSITE shape (`cmp/jnz-skip` = "advance when zero") and
 * was already correct. `DS:0x36c`/`DS:0x36d` are provably in lockstep for
 * the whole life of a level regardless: both are zeroed together at every
 * level load/respawn (`FUN_1000_8c34`, `CS:0x8CAF-B5` `mov [0x36b/c/d/e],al`
 * with `al:=0`, alongside a previously-uncited fourth byte `DS:0x36e`) and
 * both update in the SAME unconditional instruction block every real-
 * gameplay tick (`FUN_1000_006f`, `CS:0x0172` `not [0x36c]` immediately
 * followed by `CS:0x0176-0181`'s own inc/wrap-at-2 on `[0x36d]` — the wrap
 * means readers only ever observe 0/1, never 2, so it is period-2 and in
 * phase with `0x36c` for the whole level) — so reusing this module's single
 * `tock` parameter for both reads, as this project already does throughout,
 * is verified correct, not merely convenient. (The attract-mode joystick-
 * playback loop, `FUN_1000_6c19`, toggles `0x36c` alone without touching
 * `0x36d` — irrelevant here since this port has no attract-mode system.)
 */

import { attackHero, db4eHit } from './combat.js';
import { MAP_COLS } from './statue.js';

const ACC_SLOTS = 10;
const AD_SLOTS = 42;             // 12 (DS:0xad1c) + 30 (DS:0xad94), contiguous
const AD1C_SLOTS = 12;           // the shatter's own search NEVER touches these

/** `DS:0xdf5c`, read live: the burst pool's own landing-shatter velocities —
 *  3 children, a gentle upward-and-outward pop. `CS:0xB39C mov bp,0xdf5c`. */
const SHATTER_VELOCITIES = Object.freeze([
  { vx: -1, vy: -6 }, { vx: 0, vy: -7 }, { vx: 1, vy: -6 },
]);

/** `FUN_1000_b27f` — SETTLE pool's own ground probe: `col=x>>5` (no bias),
 *  `row=(y+8)&~0xf` (biased then floored — rounds to nearest tile row, not
 *  a lookahead), tests THAT cell directly. @returns {boolean} solid */
function settleGroundSolid(x, y, planeB) {
  if (!planeB) return false;
  const col = x >> 5;
  const row = (y + 8) & 0xfff0;
  const idx = (row >> 4) * MAP_COLS + col;
  return idx >= 0 && idx < planeB.length && planeB[idx] === 1;
}

/** `CS:0xB45B-0xB480` — BURST pool's own ground probe: `col=(x+8)>>5`,
 *  `row=(y+4)&~0xf`, tests the cell ONE ROW BELOW (`+MAP_COLS`) — a genuine
 *  one-tick lookahead, unlike the settle pool's same-cell round.
 *  @returns {boolean} solid one row below */
function burstGroundSolid(x, y, planeB) {
  if (!planeB) return false;
  const col = (x + 8) >> 5;
  const row = (y + 4) & 0xfff0;
  const idx = (row >> 4) * MAP_COLS + col + MAP_COLS;
  return idx >= 0 && idx < planeB.length && planeB[idx] === 1;
}

/** `FUN_1000_b4e7`, `CS:0xB564-B58C` — the AD94 fragment pool's OWN ground
 *  probe: `col=(x+5)>>5` (arithmetic, sign-preserving), `row=(y-2)&~0xf`,
 *  tests THAT SAME cell — not one row below like `burstGroundSolid`.
 *  @returns {boolean} solid at the fragment's own (rounded) cell */
function fragmentGroundSolid(x, y, planeB) {
  if (!planeB) return false;
  const col = (x + 5) >> 5;
  const row = (y - 2) & 0xfff0;
  const idx = (row >> 4) * MAP_COLS + col;
  return idx >= 0 && idx < planeB.length && planeB[idx] === 1;
}

/** `CS:0xB53D` — `DS:0xad94` fragments' own sprite base (`0x217` = 535),
 *  four apart from the ad1c half's own `0x213` (531). Same `type&3` cycle,
 *  same shared `gfxExport: 2` blitter. */
export const AD94_SPRITE_BASE = 0x217;

/** CS:0xB16B/0xB1A8-0xB1B7 — world2's `b144` rock-drop trigger. Sprite table
 *  read live: `DS:0xdf44 = {531, 532, 533, 532}` — the settle/idle wobble. */
export const ACC_SPRITES = Object.freeze([531, 532, 533, 532]);

/** The single-piece "settle" pool, `DS:0xaccc`. */
export class RockSettlePool {
  constructor() {
    this.slots = Array.from({ length: ACC_SLOTS }, () => null);
    this.refused = 0;
  }

  get live() { return this.slots.filter(Boolean).length; }

  /** CS:0xB1A2-0xB1B7. `worldX`/`worldY` is the TRIGGERING entity's own
   *  position; the `+0xa,+0x12` muzzle offset is applied by the caller
   *  (`selector2.js`'s own `handlerA_b144`), matching the original's own
   *  call-site arithmetic rather than baking the offset in here. */
  spawn(worldX, worldY) {
    const free = this.slots.findIndex((s) => s === null);
    if (free < 0) { this.refused++; return false; }
    this.slots[free] = { x: worldX, y: worldY, type: 0, lifetime: 0x37 };   // CS:0xB1AD/B1B2
    return true;
  }

  clear() { this.slots.fill(null); return this; }

  /** CS:0xB1C2-0xB236. `worldY += 2` every tick, REVERTED when the ground
   *  probe (`settleGroundSolid`, `FUN_1000_b27f`) finds the landed cell
   *  solid — the rock simply stops sinking and holds there, no shatter.
   *  `type` cycles 0..3 on the shared tock (advances when `tock !== 0` —
   *  `CS:0xB205/B20A`'s own `cmp/jz-skip` shape), selecting `ACC_SPRITES`;
   *  `lifetime` counts down and frees the slot at negative.
   *
   *  `CS:0xB236 call 0x1000:db4e` — every surviving record also runs the
   *  flat -2 hero-hit test (see `combat.js`), UNCONDITIONALLY, right before
   *  the draw the original stages alongside it (`CS:0xB23A call 0x356e`
   *  runs regardless of whether `db4e` just consumed the record THIS same
   *  tick — the original draws a rock the instant it's hit, one last time).
   *  Hot point `(worldX, worldY+6)`; a hit's own debris spark lands at
   *  `(worldX-8, worldY)`, stationary (`db4e` always zeroes velocity).
   *
   *  @param {{x:number,y:number,state:number}} [hero] omit to skip the
   *    `db4e` hit test entirely (matches the pre-this-pass behaviour).
   *  @param {import('./combat.js').Health} [health]
   *  @param {{invuln?:boolean}} [opts]
   *  @param {{spawn:Function}} [debris]
   *  @param {Uint8Array} [planeB] omit to keep the pre-ground-probe
   *    behaviour (falls until culled by lifetime alone). */
  step(cam, tock, drawn, planeB, hero, health, opts = {}, debris) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      const nextY = s.y + 2;                                        // CS:0xB1E5, written first
      s.y = settleGroundSolid(s.x, nextY, planeB) ? s.y : nextY;      // CS:0xB1EE-B1F6: revert if solid
      if (tock !== 0) s.type = (s.type + 1) & 3;                      // CS:0xB20C-B210
      s.lifetime -= 1;
      if (s.lifetime < 0) { this.slots[i] = null; continue; }
      drawn.push({ x: s.x - cam.x, y: s.y - cam.y, sprite: ACC_SPRITES[s.type], gfxExport: 2 });

      if (hero && health) {
        const r = db4eHit(s.x, s.y + 6, hero, health, opts);          // CS:0xB228-B236
        if (r.hit) {
          this.slots[i] = null;
          if (debris) debris.spawn(s.x - 8, s.y, 0, 0);                // CS:0xDBB2/DBB5, stationary
        }
      }
    }
  }
}

/** The two-piece "burst" pool, `DS:0xad1c` (12) + `DS:0xad94` (30) treated
 *  as one contiguous 42-slot array, matching the original's own combined
 *  search bound (`CS:0xB31A mov cx,0xc` searches only the first 12 — the
 *  original's own `CS:0xB2C7` producer never reaches past slot 12 either,
 *  so 42 total slots is modelled for parity with the walker's own capacity,
 *  not because the producer can fill them all). */
export class RockBurstPool {
  constructor() {
    this.slots = Array.from({ length: AD_SLOTS }, () => null);
    this.refused = 0;
  }

  get live() { return this.slots.filter(Boolean).length; }

  /** CS:0xB311-0xB388. Writes up to `n` records (world 3's own trigger
   *  always passes 2 — `DS:0xdf54`'s own 2-entry `{vx,vy}` table, read
   *  live: `{4,4}` and `{-4,4}`), searching only the first 12 slots exactly
   *  like the original. `worldX`/`worldY` is the triggering entity's own
   *  position; the `+3,+0xb` offset is CS:0xB35E/B361's own arithmetic. */
  spawn(worldX, worldY, velocities) {
    let written = 0;
    for (let i = 0; i < 12 && written < velocities.length; i++) {
      if (this.slots[i] !== null) continue;
      const { vx, vy } = velocities[written];
      this.slots[i] = { x: worldX + 3, y: worldY + 0xb, vx, vy, type: 0 };   // CS:0xB364-B379
      written++;
    }
    if (written < velocities.length) this.refused += velocities.length - written;
    return written > 0;
  }

  clear() { this.slots.fill(null); return this; }

  /** CS:0xB33D-0xB388's own write body, restricted to the `DS:0xad94` half
   *  (indices 12..41) exactly as the original's `SI:=0xad94` addressing
   *  does — the shatter NEVER writes into the `DS:0xad1c` (0..11) half.
   *  First-fit, up to `SHATTER_VELOCITIES.length` (3) children; a search
   *  that runs out of free slots partway simply writes fewer, matching the
   *  original's own capacity-exhaustion behaviour (the loop just stops). */
  #shatter(parentX, parentY) {
    let written = 0;
    for (let i = AD1C_SLOTS; i < this.slots.length && written < SHATTER_VELOCITIES.length; i++) {
      if (this.slots[i] !== null) continue;
      const { vx, vy } = SHATTER_VELOCITIES[written];
      // CS:0xB3A4/B3A7 (+2) then CS:0xB35E/B361 (+3,+0xb) — applied together here
      this.slots[i] = { x: parentX + 5, y: parentY + 13, vx, vy, type: 0 };
      written++;
    }
    if (written < SHATTER_VELOCITIES.length) this.refused += SHATTER_VELOCITIES.length - written;
  }

  /**
   * `CS:0x0230/0x0233` — TWO SEPARATE WALKER PASSES, run in this exact
   * order every tick (`FUN_1000_b3ce` completes in full before
   * `FUN_1000_b4e7` begins) — NOT one unified loop over all 42 slots. A
   * child the ad1c pass shatters into the ad94 half THIS tick is therefore
   * walked, moved and drawn by the ad94 pass in the SAME tick — see this
   * module's own header.
   * @param {{invuln?:boolean}} [opts]
   * @param {Uint8Array} [planeB] omit to keep the pre-ground-probe
   *   behaviour (falls/hits/culls, never lands or shatters).
   */
  step(cam, hero, health, tock, opts, drawn, debris, planeB) {
    this.#stepAd1c(cam, hero, health, tock, opts, drawn, debris, planeB);
    this.#stepAd94(cam, hero, health, tock, opts, drawn, debris, planeB);
  }

  /**
   * `FUN_1000_b3cf`/`FUN_1000_b3ce`, `CS:0xB3DB-0xB4D2` — the 12
   * `DS:0xad1c` slots. Position update, screen-space cull (`x∈(-16,352)`,
   * `y∈(-16,192)`, `CS:0xB3FF-B421`), draw, a tock-gated (`DS:0x36d`) frame
   * cycle doubling as gravity (`vy++`) and drag (`vx` decays toward 0 by 1),
   * THEN the ground probe (`burstGroundSolid`, `CS:0xB45B-B480`) — solid one
   * row below shatters into 3 children (`#shatter`, `CS:0xB38F`) and frees
   * this record WITHOUT reaching the hit test this tick (`CS:0xB487` jumps
   * past `CS:0xB48A` entirely — landing and being hit are mutually
   * exclusive on the same tick). Only when NOT landed does the flat, 5x5,
   * zero-strength hero-hit test (`CS:0xB49F` `call 0x1000:ac59` with
   * `bp:=0`, i.e. `attackHero`'s own `(raw+1>>5)+5` formula collapses to a
   * flat 5 damage) run, consuming the record and dropping a MOVING debris
   * spark carrying its own current velocity on a hit.
   */
  #stepAd1c(cam, hero, health, tock, opts, drawn, debris, planeB) {
    for (let i = 0; i < AD1C_SLOTS; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.x += s.vx; s.y += s.vy;                                    // CS:0xB3F0-B3F8

      const sx = s.x - cam.x, sy = s.y - cam.y;
      if (sx <= -16 || sy <= -16 || sx >= 0x160 || sy >= 0xc0) {    // CS:0xB3FF-B421
        this.slots[i] = null;                                        // CS:0xB4BF, no hit, no debris
        continue;
      }

      drawn.push({ x: sx, y: sy, sprite: 0x213 + s.type, gfxExport: 2 });   // CS:0xB424, export 2

      if (tock === 0) {                                             // CS:0xB43A
        s.type = (s.type + 1) & 3;                                   // CS:0xB441/B444 — animation
        s.vy += 1;                                                    // CS:0xB448 — GRAVITY
        if (s.vx !== 0) s.vx += s.vx > 0 ? -1 : 1;                    // CS:0xB44B-B458 — DRAG
      }

      if (burstGroundSolid(s.x, s.y, planeB)) {                      // CS:0xB45B-B480/B487
        this.#shatter(s.x, s.y);
        this.slots[i] = null;                                        // CS:0xB4BF — the parent frees
        continue;                                                      // no hit test this tick
      }

      /* CS:0xB48A/B49F — a flat, zero-strength hit (`bp:=0` before the shared
       * `CS:0xac59` box test, so `combat.js`'s own `damageFor(0)` formula
       * collapses to a flat 5 damage): 5x5 box, no world-4/difficulty scalar
       * modelled here since `ac59` never applies one to hero contact. */
      const r = attackHero({ x: s.x, y: s.y, w: 5, h: 5, strength: 0 }, hero, health, opts);
      if (r.hit) {
        this.slots[i] = null;                                        // CS:0xB4C6
        if (debris) debris.spawn(s.x, s.y, s.vx, s.vy);               // the moving spark
      }
    }
  }

  /**
   * `FUN_1000_b4e7`, `CS:0xB4E7-0xB5E4` — the 30 `DS:0xad94` slots. Read
   * fresh this pass; see this module's own header for the five ways it
   * genuinely differs from `#stepAd1c` rather than mirroring it. `x += vx;
   * y += vy` runs unconditionally every tick; a screen-cull OR a solid
   * landing both fall into the SAME exit (`CS:0xB5C2`) — free the record
   * and drop a MOVING spark carrying its own current velocity, no shatter
   * ever. Only when neither fires does the `db4e` hero-hit test run (flat
   * -2 off the health target, invuln passes straight through with no
   * consume, a hit's own spark is STATIONARY).
   */
  #stepAd94(cam, hero, health, tock, opts, drawn, debris, planeB) {
    for (let i = AD1C_SLOTS; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.x += s.vx; s.y += s.vy;                                    // CS:0xB509/B50C, unconditional

      const sx = s.x - cam.x, sy = s.y - cam.y;
      if (sx <= -16 || sy <= -16 || sx >= 0x160 || sy >= 0xc0) {    // CS:0xB518-B53A
        this.slots[i] = null;                                        // CS:0xB5C2 — SAME exit as landing
        if (debris) debris.spawn(s.x - 2, s.y - 2, s.vx, s.vy);       // moving spark
        continue;
      }

      drawn.push({ x: sx, y: sy, sprite: AD94_SPRITE_BASE + s.type, gfxExport: 2 });   // CS:0xB53D/B54E

      if (tock === 0) {                                             // CS:0xB553/B558
        s.type = (s.type + 1) & 3;                                   // CS:0xB55A-B55D
        s.vy += 1;                                                    // CS:0xB561 — gravity, no cap, no drag
      }

      if (fragmentGroundSolid(s.x, s.y, planeB)) {                   // CS:0xB564-B58C
        this.slots[i] = null;                                        // CS:0xB5C2
        if (debris) debris.spawn(s.x - 2, s.y - 2, s.vx, s.vy);       // moving spark
        continue;
      }

      /* CS:0xB58E-B5A6 — db4e's own hot point for THIS caller is
       * (worldX+8, worldY+6); see combat.js's own header for the arithmetic.
       * A hit's own debris spark lands at the fragment's plain current
       * world position, exactly, stationary. */
      const r = db4eHit(s.x + 8, s.y + 6, hero, health, opts);
      if (r.hit) {
        this.slots[i] = null;
        if (debris) debris.spawn(s.x, s.y, 0, 0);
      }
    }
  }
}
