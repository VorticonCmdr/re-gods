/* bomb-blast.js — what a time bomb does when its fuse reaches -1.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────
 * The port stepped the bomb's flight faithfully and then, on detonation,
 * only counted "ten fragments" and held the record for a formula-derived
 * number of ticks. Nothing was drawn, nothing was damaged, no hazard was
 * destroyed, and the blast never hurt the hero. CS:0xA273-0xA420 (the tail
 * of mover 3, CS:0xA058) is all of that, read in full here `[STATIC]`.
 *
 * ── DETONATION, CS:0xA27B-0xA325 (fuse == -1, once) ──────────────────────
 *     A27C  sfx 0x1022
 *     A283  10 fragments at DS:0x8EDA, stride 10: [+8] = -1 (all dead)
 *     A297  cx = extra (weapon [+8] - [+6], via SS:0x424) ; if cx != 0:
 *     A2A8    CALLF export 36 (VGA:0x024C) — revive 2*min(cx,5) fragments
 *     A2AD  7 smoke puffs at DS:0x8F3E, stride 6, {x, y, counter}:
 *             x = bx - 8, y = by - 0x10 - 0x7e + 0x15*i, counter = -12 + 2i
 *           (a column above the bomb; the bottom one starts at once, each
 *           higher one two ticks later)
 *     A2D8  dec fuse (-> -2: the loops below run on every later tick)
 *     A2E1  n = extra + 2 ; from the LAST puff backwards, every puff past
 *           the first n gets counter 0xD8F0 (never becomes live)
 *     A2FC  the area kill: JMP into ACT6 at CS:0x3BE8 with the box
 *           (bx-16, by-20)-(bx+16, by+4) — see trigger-actions.js
 *           killCategory4InBox. ACT6's own `push cx` is stood in for by a
 *           second copy of the return address (CS:0xA305-0xA309).
 *   and then falls straight into the per-tick loops, on this same tick.
 *
 * ── EXPORT 36, VGA:0x024C-0x0391 ─────────────────────────────────────────
 * Unrolled: pair k writes {bx, by, +5, vy_k, 0} and {bx, by, -5, vy_k, 0},
 * `dec cx / jz done` after each pair, five pairs at most:
 *     vy = -8, -6, -4, -2, -10          (VGA:0x025D / 02A1 / 02E5 / 0326 / 0367)
 * (Ghidra mis-decodes pair 4; its bytes at VGA:0x031F are C7 04 05 00 ...
 *  C7 04 FE FF.)
 *
 * ── THE FRAGMENTS, CS:0xA326-0xA3BD (every tick) ─────────────────────────
 *     frame += 1 ; if frame >= 3: frame = 0, vy += 1     (gravity every 3rd)
 *     x += vx ; y += vy
 *     off screen (sx > 0x15F, sx < -8, sy < -8, sy > 0xBF) -> dead
 *     else CS:0xA7B6 (the shared terrain probe, with the WEAPON record):
 *       solid cell -> clink, debris, maybe a block hit, and [di] = 0; the
 *                    loop then writes [di] = 1 (!) and kills the fragment
 *       otherwise  -> the 2x2 grid stamp (CS:0xA860) with the bomb's tag,
 *                    and the draw: sprite 0x4D + frame, export 2
 * ⚠️ CS:0xA3A2 `mov word [di],1`: after a fragment hits a wall the bomb's
 * tag is 1, not what it was — every later stamp by this blast uses tag 1.
 *
 * ── THE PUFFS, CS:0xA3C0-0xA414 (every tick) ─────────────────────────────
 *     counter >= 0: sprite 0x6C + counter (the same art as ACT6's smoke),
 *                   the 3x3 grid stamp (CS:0xA8B8), then if DS:0x172 == 0
 *                   CS:0xA421, then the draw through export 1
 *     every puff:   counter += 1 ; if >= 7 -> 0xFF9C (dead)
 * CS:0xA421 — the blast hurts the hero: only on sprites whose low two bits
 * are 0 (0x6C and 0x70), and only with the hero's (x+16, y+25) inside
 * [px-11, px+43] x [py-20, py+52] (screen), `dec word [0x192]`.
 *
 * ── THE RECORD, CS:0xA416-0xA41C ─────────────────────────────────────────
 * Freed once a tick passes with no live fragment and no live puff. For a
 * plain pickup that is 9 ticks after detonation — the figure measured live
 * for UNKNOWN_timebomb_refire, which this module reproduces by simulation.
 */

export const FRAGMENTS = 10;               // CS:0xA286
export const PUFFS = 7;                    // CS:0xA2B6
export const FRAGMENT_SPRITE = 0x4d;       // CS:0xA383
export const PUFF_SPRITE = 0x6c;           // CS:0xA3DF
export const PUFF_DEAD = -100;             // CS:0xA40E 0xFF9C
export const PUFF_DISABLED = -10000;       // CS:0xA2EE 0xD8F0
/** Export 36's vy for pair k (VGA:0x024C-0x0391). */
export const REVIVE_VY = Object.freeze([-8, -6, -4, -2, -10]);
export const REVIVE_VX = 5;

export class BombBlast {
  constructor() {
    this.fragments = Array.from({ length: FRAGMENTS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, frame: -1 }));
    this.puffs = Array.from({ length: PUFFS }, () => ({ x: 0, y: 0, counter: PUFF_DEAD }));
  }

  /**
   * CS:0xA283-0xA2FA. `x`/`y` are the bomb's world position ([di+2]/[di+4]).
   * @returns {{x0:number,y0:number,x1:number,y1:number}} the area-kill box
   */
  detonate(x, y, extra) {
    for (const f of this.fragments) f.frame = -1;                 // A289
    const pairs = Math.min(extra, REVIVE_VY.length);              // A2A3 `jz`: none when 0
    for (let k = 0; k < pairs; k++) {                             // export 36
      Object.assign(this.fragments[2 * k],     { x, y, vx:  REVIVE_VX, vy: REVIVE_VY[k], frame: 0 });
      Object.assign(this.fragments[2 * k + 1], { x, y, vx: -REVIVE_VX, vy: REVIVE_VY[k], frame: 0 });
    }
    for (let i = 0; i < PUFFS; i++) {                             // A2BF-A2D4
      const p = this.puffs[i];
      p.x = x - 8; p.y = y - 0x10 - 0x7e + 0x15 * i; p.counter = -12 + 2 * i;
    }
    let keep = extra + 2;                                         // A2E8
    for (let i = PUFFS - 1; i >= 0; i--) {                        // A2F1-A2FA
      keep -= 1;
      if (keep < 0) this.puffs[i].counter = PUFF_DISABLED;
    }
    return { x0: x - 0x10, y0: y - 0x14, x1: x + 0x10, y1: y + 4 };   // A30A-A317
  }

  /**
   * CS:0xA326-0xA416 — one tick of both loops.
   * @param {object} p      the bomb's projectile record (its `tag` is read,
   *                        and set to 1 by a fragment that hits a wall)
   * @param {object} ctx    { cam, grid, weapon, planeB, hero:{x,y}, health,
   *                          invuln, terrainStop(fragment, row, col) }
   * @returns {{live:number, drawn:Array, heroHits:number}}
   */
  step(p, ctx) {
    const { cam, grid = null, weapon = null, planeB = null } = ctx;
    const drawn = [];
    let live = 0, heroHits = 0;

    for (const f of this.fragments) {
      if (f.frame < 0) continue;                                  // A338
      live++;                                                     // A33A
      f.frame += 1;
      if (f.frame >= 3) { f.frame = 0; f.vy += 1; }               // A33C-A343
      f.x += f.vx; f.y += f.vy;                                   // A34A-A356
      const sx = f.x - cam.x, sy = f.y - cam.y;
      if (sx > 0x15f || sx < -8 || sy < -8 || sy > 0xbf) { f.frame = -1; continue; }   // A361-A376
      /* CS:0xA7B6 */
      if (weapon && weapon.breaksTerrain && planeB) {
        const col = ((f.x + 8) & ~0x1f) >> 5, row = ((f.y + 8) & ~0xf) >> 4;
        if (row >= 0 && row < 64 && col >= 0 && col < 128 && planeB[row * 128 + col] === 1) {
          if (ctx.terrainStop) ctx.terrainStop(f, row, col);      // A7F6-A85B
          p.tag = 1;                                              // A3A2 — not the old tag
          f.frame = -1;                                           // A3A8
          continue;
        }
      }
      if (grid) grid.stamp2x2(sx, sy, p.tag & 0xff);              // A860
      drawn.push({ x: sx, y: sy, sprite: FRAGMENT_SPRITE + f.frame, gfxExport: 2 });   // A3AF
    }

    for (const u of this.puffs) {
      if (u.counter >= 0) {                                       // A3D1
        live++;
        const sx = u.x - cam.x, sy = u.y - cam.y;
        const sprite = PUFF_SPRITE + u.counter;
        if (grid) grid.stamp3x3(sx, sy, p.tag & 0xff);            // A3F1
        if (!ctx.invuln && ctx.health && ctx.hero && (sprite & 3) === 0) {   // A3F4 / A421
          const hx = ctx.hero.x - cam.x + 0x10, hy = ctx.hero.y - cam.y + 0x19;
          if (sx - 0xb <= hx && sy - 0x14 <= hy && sx + 0x2b >= hx && sy + 0x34 >= hy) {
            ctx.health.target -= 1;                               // A45C `dec word [0x192]`
            heroHits++;
          }
        }
        drawn.push({ x: sx, y: sy, sprite, gfxExport: 1 });       // A3FE
      }
      u.counter += 1;                                             // A405
      if (u.counter >= 7) u.counter = PUFF_DEAD;                  // A408-A40E
    }
    return { live, drawn, heroHits };
  }
}
