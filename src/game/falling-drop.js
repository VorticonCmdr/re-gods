/* falling-drop.js — the DS:0xcfcc drops world 4's PAT class 3 lets fall.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────
 * This project filed world 4's class-3 record (DS:0xe23e, handlers
 * CS:0xBD38/0xBD0B, sprite 0x213) as a CUT hazard: "System A in world 4 uses
 * class 0 and nothing else". True, and beside the point — the class table
 * behind DS:0x1fe is also the SELECTOR-1 (PGOD0x.PAT) class table, and
 * PALFILS +5 selects class 3 in seven placed descriptors of PLEV4A and
 * PLEV4B each (9, 10, 11, 12, 17, 18, 23 — tools/wf-census.mjs). The port
 * spawned those groups and gave them no behaviour. pat-objects.js now runs
 * the handlers; this module is the pool they feed, read in full `[STATIC]`.
 *
 * ── THE ALLOCATOR, CS:0x8B0E-0x8B49 ──────────────────────────────────────
 *     8B10  si = 0xcfcc ; cx = 10 ; first slot with [si] < 0, else RET
 *     8B23  mov byte [cs:0x8b56],0x90        ; arm the walker's RET gate
 *     8B2B  ax += [0xa] + 0xb ; bx += [0xc]  ; AX/BX = the sub-record's
 *                                            ;   SCREEN position (CS:0xBB00)
 *     8B36  [si]=ax [si+2]=bx [si+4]=0 [si+6]=4
 * So a drop starts at the creature's world (x + 11, y), falling at 4.
 *
 * ── THE WALKER, CS:0x8B57-0x8C33 (gate byte CS:0x8B56) ───────────────────
 *     8B5D  [0x3b2] = 0 ; per slot with [si] >= 0: inc [0x3b2]
 *     8B6D  y += vy ; if [0x36d] == 0: vy += 1, capped at 0x10
 *     8B8D  plane A at ((x+5) & ~31) >> 5, (y & ~15) * 8, + 0x100 (two rows
 *           down): a 0x6D tile -> [si+8] = 250, [0x33f] = 0, CALL 0x73EC
 *           with the plane-B cell (destructible.js `hit`). The drop is NOT
 *           stopped: there is no plane-B probe at all, it falls through.
 *     8BCD  CS:0xAC59 with a 5 x 16 box at (x, y + 8), strength 3 (BP = 3
 *           overwrites the [si+4] load); a reported hit (BP < 0) frees it
 *     8BEF  screen y (of y + 8) >= 0xC0 frees it; there is no x cull
 *     8C03  draw sprite 0x21F + [si+4] (always 0 here: 543) via export 2
 *     8C26  nothing live at entry -> mov byte [cs:0x8b56],0xc3 (disarm)
 * Called at CS:0x0291 (main loop, inside the DS:0x34 gate, just before the
 * PAT walk at 0x0294) and CS:0x92D8 (respawn tick, before 0x92DB). Not from
 * the death driver. Level load: CS:0x8E52 -> 0x8B4A (disarm) -> 0x7F48.
 *
 * ── ONE POOL, TWO TENANTS ────────────────────────────────────────────────
 * DS:0xcfcc is shared with the world-2 nest (nest.js, allocator CS:0x8619),
 * and each walker walks all ten slots. The nest's allocator refuses outside
 * world 2 (CS:0x8611) and class 3 exists only in world 4's table, so in
 * shipped data the two never share a level; a separate pool is equivalent.
 *
 * DS:0x33f (the "slot that fired" byte CS:0x7489 reads) is forced to 0 by
 * CS:0x8BBF; `hit` takes slot A's weapon directly, which is what that reads.
 */

import { attackHero } from './combat.js';

export const POOL_DS = 0xcfcc;
export const SLOTS = 10;                 // CS:0x8B13 `mov cx,0xa`
export const X_OFFSET = 0xb;             // CS:0x8B2F
export const VY_START = 4;               // CS:0x8B40
export const VY_MAX = 0x10;              // CS:0x8B82
export const BLOCK_TILE = 0x6d;          // CS:0x8BB5
export const BLOCK_DAMAGE = 0xfa;        // CS:0x8BBA — 250
export const HIT_BOX = Object.freeze({ w: 5, h: 0x10, dy: 8 });   // CS:0x8BCD-0x8BDC
export const STRENGTH = 3;               // CS:0x8BDF
export const CULL_Y = 0xc0;              // CS:0x8BF7
export const SPRITE = 0x21f;             // CS:0x8C06 — 543

export class FallingDrops {
  constructor() {
    this.slots = Array.from({ length: SLOTS }, () => ({ x: -1, y: 0, frame: 0, vy: 0 }));
    this.armed = false;                  // the CS:0x8B56 gate
    this.dropped = 0;                    // allocations that found no free slot
  }

  /** CS:0x8B0E. `x`/`y` are the creature's WORLD position. */
  spawn(x, y) {
    const s = this.slots.find((r) => r.x < 0);
    if (!s) { this.dropped++; return null; }
    this.armed = true;                                   // CS:0x8B23
    s.x = x + X_OFFSET; s.y = y; s.frame = 0; s.vy = VY_START;
    return s;
  }

  /**
   * CS:0x8B56/0x8B57, one tick.
   * @param {{x:number,y:number}} cam
   * @param {object} ctx { tock36d, planeA, blocks, slotAWeapon, hero, health,
   *                       invuln, sfx }
   * @returns {Array<{x:number,y:number,sprite:number,gfxExport:number}>}
   */
  step(cam, ctx) {
    const drawn = [];
    if (!this.armed) return drawn;                       // the RET gate
    let live = 0;
    for (const s of this.slots) {
      if (s.x < 0) continue;                             // 8B64
      live++;                                            // 8B69
      s.y += s.vy;                                       // 8B6D-8B75
      if (!ctx.tock36d) { s.vy += 1; if (s.vy > VY_MAX) s.vy = VY_MAX; }   // 8B78-8B88
      if (ctx.planeA && ctx.blocks) {
        const cell = (((s.x + 5) & 0xffe0) >> 5) + (s.y & 0xfff0) * 8 + 0x100;   // 8B8D-8BB1
        if (cell >= 0 && cell < ctx.planeA.length && ctx.planeA[cell] === BLOCK_TILE) {
          ctx.blocks.hit(cell, ctx.slotAWeapon, BLOCK_DAMAGE);  // 8BBA-8BCA
        }
      }
      if (ctx.health && ctx.hero) {
        const r = attackHero({ x: s.x, y: s.y + HIT_BOX.dy, w: HIT_BOX.w, h: HIT_BOX.h, strength: STRENGTH },
                             ctx.hero, ctx.health, { invuln: ctx.invuln, sfx: ctx.sfx });
        if (r.strengthOut < 0) { s.x = -1; continue; }   // 8BE5-8BE9
      }
      const sx = s.x - cam.x, sy = s.y + HIT_BOX.dy - cam.y;   // 8BEF-8BF3
      if (sy >= CULL_Y) { s.x = -1; continue; }           // 8BF7-8BFD
      drawn.push({ x: sx, y: sy, sprite: SPRITE + s.frame, gfxExport: 2 });   // 8C03-8C17
    }
    if (live === 0) this.armed = false;                  // 8C26-8C2D
    return drawn;
  }

  /** CS:0x8B4A -> 0x7F48 — level load. */
  clear() {
    for (const s of this.slots) s.x = -1;
    this.armed = false;
    return this;
  }

  get live() { return this.slots.reduce((n, s) => n + (s.x >= 0 ? 1 : 0), 0); }
}
