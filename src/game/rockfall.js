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
 * WHAT THIS MODULE DOES NOT MODEL, flagged rather than guessed:
 *   - Ground-probe-based landing. `CS:0xB480`/`CS:0xB3CE`'s own use of the
 *     plane-B "one row below" probe requires a terrain/`map` object this
 *     port's selector-2/rockfall call chain does not currently receive
 *     (only camera/hero/health/damage-grid are threaded through). A rock
 *     falls until it culls off-screen or (the AD pool) its 5x5 hero-hit
 *     test lands, rather than landing on solid ground and — per
 *     `CS:0xB38F` — SHATTERING into 3 more pieces via a table at
 *     `DS:0xdf5c` (not read this pass; a genuine, un-modeled recursion).
 *   - The AD pool's own recursive landing-shatter (see above) — a landed
 *     rock in the original simply frees itself after spawning 3 children;
 *     without ground detection this port cannot reach that branch at all.
 */

import { attackHero } from './combat.js';

const ACC_SLOTS = 10;
const AD_SLOTS = 42;             // 12 (DS:0xad1c) + 30 (DS:0xad94), contiguous

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

  /** CS:0xB1C2-0xB236. `worldY += 2` every tick (no ground stop modelled —
   *  see the file header); `type` cycles 0..3 on the shared tock, selecting
   *  `ACC_SPRITES`; `lifetime` counts down and frees the slot at negative. */
  step(cam, tock, drawn) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.y += 2;
      if (tock === 0) s.type = (s.type + 1) & 3;
      s.lifetime -= 1;
      if (s.lifetime < 0) { this.slots[i] = null; continue; }
      drawn.push({ x: s.x - cam.x, y: s.y - cam.y, sprite: ACC_SPRITES[s.type], gfxExport: 2 });
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

  /**
   * CS:0xB3DB-0xB4D2. Position update, screen-space cull (`x∈(-16,352)`,
   * `y∈(-16,192)`, `CS:0xB3FF-B421`), a tock-gated (`DS:0x36d`) frame cycle
   * doubling as gravity (`vy++`) and drag (`vx` decays toward 0 by 1), then
   * — every tick — a flat, 5x5, zero-strength hero-hit test (`CS:0xB49F`
   * `call 0x1000:ac59` with `bp:=0`, i.e. `attackHero`'s own `(raw+1>>5)+5`
   * formula collapses to a flat 5 damage) that consumes the record and
   * drops a MOVING debris spark carrying its own current velocity on a hit.
   * @param {{invuln?:boolean}} [opts]
   */
  step(cam, hero, health, tock, opts, drawn, debris) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.x += s.vx; s.y += s.vy;                                    // CS:0xB3F0-B3F8

      const sx = s.x - cam.x, sy = s.y - cam.y;
      if (sx <= -16 || sy <= -16 || sx >= 0x160 || sy >= 0xc0) {    // CS:0xB3FF-B421
        this.slots[i] = null;                                        // CS:0xB4BF, no hit, no debris
        continue;
      }

      if (tock === 0) {                                             // CS:0xB43A
        s.type = (s.type + 1) & 3;                                   // CS:0xB441/B444 — animation
        s.vy += 1;                                                    // CS:0xB448 — GRAVITY
        if (s.vx !== 0) s.vx += s.vx > 0 ? -1 : 1;                    // CS:0xB44B-B458 — DRAG
      }

      drawn.push({ x: sx, y: sy, sprite: 0x213 + s.type, gfxExport: 2 });   // CS:0xB424, export 2

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
}
