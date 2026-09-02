/* enemy-shots.js — DS:0x8954, the enemies' own projectiles.
 *
 * Found while closing UNKNOWN_nest_shot: the world-2 nest creature fires
 * through CS:0x2039 (right) and CS:0x1FE7 (left), and those write here. The
 * array is NOT nest-specific — CS:0xE99F and CS:0xEFA2 reach it too — so it
 * lives in its own module.
 *
 * ── SIX EMITTER PAIRS, so SHOOTING ENEMIES ARE WIDESPREAD ────────────────
 * `call 0x1fe7` / `call 0x2039` appear as six left/right pairs:
 *      CS:0x8725 / 0x86F7   the world-2 nest creature (nest.js)
 *      CS:0xB07D / 0xB08F   \
 *      CS:0xB6C8 / 0xB6EA    | five further handlers in the System-A and
 *      CS:0xBCBE / 0xBCCA    | System-B behaviour families
 *      CS:0xBDC5 / 0xBDD6    |
 *      CS:0xE6BB / 0xE6CF   /
 * So this is not a one-creature curiosity: it is the mechanism by which any
 * enemy in the game shoots, and the port had no model of it at all.
 * UNKNOWN_enemy_shot_other_emitters covers the five that are not read here.
 *
 * ── ⚠️ THEY STEP IN THE SAME FRAME THEY ARE FIRED ────────────────────────
 * The updater is called from the main loop at CS:0x02BA, which is AFTER the
 * nest walker (CS:0x0282), the entity step (CS:0x0285) and the player
 * (CS:0x0254). The hero's own projectiles are the other way round — CS:0x020F
 * runs BEFORE CS:0x0254, so a hero shot cannot hit anything on its spawn
 * tick. An enemy shot can. Reusing the hero's ordering gives every enemy shot
 * a free frame of delay.
 *
 * ── ⚠️ THIS IS A SECOND, COMPLETELY SEPARATE DAMAGE PATH ─────────────────
 *
 * Everything this project has documented about hurting the hero runs through
 * CS:0xac59 (the box test with the BP-in-BP-out convention) reached via the
 * CS:0xa9e4 thunk, and through the 8x8 occupancy grid at DS:0x16ca. An enemy
 * shot uses NEITHER. CS:0x4501 is a bespoke inline box test with its own
 * constants, its own crouch adjustment and its own flat damage, and it never
 * touches the grid.
 *
 * Three consequences that a port reusing the hero-contact path would get
 * wrong, all of them gameplay-visible:
 *
 *   1. THE DIFFICULTY SCALAR DOES NOT APPLY. DS:0x365 is consumed at exactly
 *      two instructions, CS:0xab56/0xab63, inside the CS:0xac59 resolution
 *      path. CS:0x4501 subtracts a flat 2 and never goes near it. So enemy
 *      shots hit for the same amount in world 1 and world 4.
 *   2. IT WRITES THE TARGET, NOT THE BAR. `sub word [0x192],2` — so the
 *      displayed bar at DS:0x19a chases down over the following frames, as
 *      the chase routine CS:0x0dff does for every other damage source.
 *   3. INVULNERABILITY MAKES THE SHOT PASS THROUGH. CS:0x4547's `jnz` skips
 *      BOTH the subtract and the `[si+6] = 0xffff` that consumes the shot, so
 *      while DS:0x172 is set the projectile flies on through the hero. That is
 *      the opposite of the contact path, where CS:0xACCC's `jnz` skips only
 *      the subtract and the creature still dies.
 */

export const ARRAY_DS = 0x8954;
export const SLOTS = 20;              // CS:0x200F / CS:0x2061 `mov cx,0x14`
export const STRIDE = 8;              // CS:0x2018 `add si,0x8`

/* ── The record, 8 bytes ──────────────────────────────────────────────────
 *   +0x00  i16  world X
 *   +0x02  i16  world Y
 *   +0x04  i16  X velocity — copied verbatim from DS:0x206 by the emitter
 *   +0x06  i16  STATE: negative = FREE; 0 = flying; 1..5 = the impact fade
 *
 * ⚠️ Free is `+6 < 0`, and a live shot is seeded with 0. Both the emitter
 * (CS:0x2012 `js`) and the updater (CS:0x2065 `jns`) agree, in opposite
 * senses — read either one alone and it is easy to invert. */
export const FREE = -1;

/* ── The emitter, CS:0x1FE7 (left) and CS:0x2039 (right) ──────────────────
 * One routine reached two ways. Both convert to screen space, cull, then
 * `pop bx / pop ax` to recover the UNCONVERTED world coordinates before
 * storing — so the record holds world x/y and the cull is a screen test.
 *
 * ⚠️ THE TWO CULL RECTANGLES DIFFER, and not by mirroring. Y is identical:
 *      cmp bx,0xc0 / jnl reject      -> screenY <  192
 *      cmp bx,0xfffc / jl reject     -> screenY >= -4
 * X is not:
 *      left  (CS:0x2000)  screenX in [   8, 328]
 *      right (CS:0x2052)  screenX in [  -8, 312]
 * Each window is shifted 16 px AWAY from the direction of travel, so a muzzle
 * just off the near edge is allowed and one just off the far edge is not.
 * Reusing one rectangle for both loses shots at one edge and invents them at
 * the other. This is an EIGHTH and NINTH distinct cull rectangle in a game
 * that already had seven. */
export const CULL_LEFT  = Object.freeze({ xMin: 8,  xMax: 0x148, yMin: -4, yMax: 0xbf });
export const CULL_RIGHT = Object.freeze({ xMin: -8, xMax: 0x138, yMin: -4, yMax: 0xbf });

/* ── Flight, CS:0x20A8 ────────────────────────────────────────────────────
 * `ax = [si] + [si+4]`, then the sign of the velocity picks the branch —
 * and a velocity of ZERO is not "stationary", it is the IMPACT state:
 *      cx <  0  -> CS:0x20E8, the left flight path
 *      cx == 0  -> CS:0x2072, the fade
 *      cx >  0  -> CS:0x20B8, the right flight path
 * ⚠️ CS:0x216A `mov word [si+4],0` IS that writer — the terrain stop zeroes
 * the velocity as it seeds the fade state. So the `jz` arm is not a dangling
 * branch; it is how a stopped shot re-enters the walker on later ticks.
 * (This closes what an earlier draft of this file called
 * UNKNOWN_enemy_shot_impact_writer.) */

/** Off-screen despawn, applied AFTER the step, in screen space. Asymmetric
 *  again: 0x140 exclusive on the right, 0xfff0 exclusive on the left. */
export const DESPAWN_RIGHT_X = 0x140;   // CS:0x20C2 `cmp ax,0x140 / jl` keeps
export const DESPAWN_LEFT_X = -0x10;    // CS:0x20F2 `cmp ax,0xfff0 / jg` keeps

/* ── Sprites ──────────────────────────────────────────────────────────────
 * ⚠️ The sprite depends on the DIRECTION OF TRAVEL, and the two are not the
 * same frame flipped — they are different descriptors:
 *      flying right  0x48 = 72   (CS:0x20D2)
 *      flying left   0x45 = 69   (CS:0x2103)
 * The fade then draws 0x45 + state, i.e. 69, 70, 71 — so the LEFT flight
 * sprite and the FIRST fade sprite are the same frame. */
export const SPRITE_RIGHT = 0x48;
export const SPRITE_LEFT = 0x45;
export const SPRITE_FADE_BASE = 0x45;
export const DRAW_EXPORT = 2;          // CS:0x356E, the same blitter debris uses

/* ── The fade, CS:0x2072, and why there are TWO free tests ────────────────
 *   inc [si+6]
 *   if [si+6] == 3 -> free     (CS:0x2079)
 *   if [si+6] == 6 -> free     (CS:0x207F)
 *   else draw 0x45 + [si+6]
 *
 * ⚠️ I FIRST WROTE THAT 3 ALWAYS FIRES AND 6 IS DEAD. Wrong — and the reason
 * is the nicest thing in this subsystem. The terrain stop at CS:0x2158 seeds
 * the state BY DIRECTION:
 *      flying right (vx >= 0) -> state 4   (CS:0x215E)
 *      flying left  (vx <  0) -> state 1   (CS:0x2165)
 * so a left-stopped shot fades 1, 2 and frees at 3, and a right-stopped one
 * fades 4, 5 and frees at 6. BOTH tests are live, and they are why the fade
 * cannot be written as a single `>=`.
 *
 * The sprite numbering falls straight out of it and is self-checking:
 *      0x45, 0x46, 0x47  left  flight + two fade frames
 *      0x48, 0x49, 0x4A  right flight + two fade frames
 * Six consecutive descriptors, three per direction — which is also why the
 * left flight sprite and the fade base are the same number. */
export const FADE_FREE_AT = Object.freeze([3, 6]);
export const STOP_STATE_RIGHT = 4;     // CS:0x215E
export const STOP_STATE_LEFT = 1;      // CS:0x2165

/* ── Terrain, CS:0x211A ───────────────────────────────────────────────────
 * The plane-B cursor is built from `(x & ~0x1f, (y + 2) & ~0xf)` — note the
 * +2 on Y, which no other probe in this game applies.
 *
 * ⚠️ THE STRADDLE DOES NOT GATE THE PRIMARY TEST, IT ADDS A SECOND CELL.
 * I first wrote this as "gated by a straddle test", which inverts it and lets
 * a shot fly through a wall it entered head-on:
 *      2143  cmp byte [di],1   / jz  stop        <- ALWAYS tested
 *      2148  dx = x & 0x1f
 *      214D  cmp dl,0x18       / jng fly         <- STRICTLY greater
 *      2152  cmp byte [di+1],1 / jnz fly         <- the NEXT cell right
 * i.e. stop when `[di] == 1`, OR when the shot straddles past 24 px into its
 * cell AND `[di+1] == 1`. Note `jng`, so 0x18 exactly does NOT straddle.
 *
 * That makes at least FOUR distinct rounding rules now in play for turning a
 * position into a map cell: floored (entity), rounded-to-nearest (hero and
 * export 40), +8 on both axes (the projectile terrain stop), and +2 on Y
 * only (here). One shared helper is wrong three times. */
export const TERRAIN_Y_BIAS = 2;       // CS:0x2124 `add bx,0x2`
export const TERRAIN_STRADDLE = 0x18;  // CS:0x214D `cmp dl,0x18 / jng` — STRICT

/* ── The hero hit, CS:0x4501 ──────────────────────────────────────────────
 *
 *   4504  ax += 0x0a ; bx += 0x04          ; the shot's hot point
 *   450A  ax += [0xa] ; bx += [0xc]        ; -> WORLD
 *   4512  cx = [0x17c]                     ; the hero box TOP
 *   4516  cmp byte [0x377],0x12 / jl / cmp 0x13 / jg
 *   4524  add cx,0x18                      ; CROUCHING -> raise it 24
 *   4527  cmp bx,cx / jl reject
 *   452B  cmp ax,[0x17a] / jl reject
 *   4538  cmp ax,[0x17a] + 0x20 / jg reject
 *   4543  cmp bx,[0x17c] + 0x30 / jg reject
 *   4547  cmp word [0x172],0 / jnz reject  ; INVULNERABLE -> pass through
 *   454E  sub word [0x192],2               ; flat 2, off the TARGET
 *   4553  mov word [si+6],0xffff           ; the shot is consumed
 *   4561  call 0xa633 with cx = dx = 0     ; a STATIONARY debris puff
 */
export const HERO_BOX = Object.freeze({ w: 0x20, h: 0x30 });   // 32 x 48
export const HOT_POINT = Object.freeze({ dx: 0x0a, dy: 0x04 });
export const DAMAGE = 2;               // CS:0x454E — flat, no scalar
export const CROUCH_RAISE = 0x18;      // CS:0x4524 — 24

/* ⚠️ CLAUDE.md lists three sites that run the identical crouch range test and
 * then raise the hero's box top — CS:0x4516(+0x18), CS:0xAC92(+0x14),
 * CS:0xDB68(+0x18) — without attributing them. CS:0x4516 is THIS one, and it
 * belongs to the enemy-SHOT path, not the CS:0xac59 contact path. The raises
 * also differ: 24 here against 20 at CS:0xACA0, so the two damage systems
 * genuinely disagree about how much crouching helps. */

/** CS:0x4527-0x4545. All four compares are signed and the box is inclusive at
 *  every edge (`jl` / `jg` reject, so equality passes). */
export function hitsHero(shotX, shotY, heroX, heroY, crouching) {
  const ax = shotX + HOT_POINT.dx, bx = shotY + HOT_POINT.dy;
  const top = heroY + (crouching ? CROUCH_RAISE : 0);
  return bx >= top && ax >= heroX
      && ax <= heroX + HERO_BOX.w && bx <= heroY + HERO_BOX.h;
}

/** CS:0x4516 — the crouch pair, states 18 and 19, tested as a closed range. */
export const isCrouching = (playerState) => playerState >= 0x12 && playerState <= 0x13;

export class EnemyShots {
  constructor() {
    this.slots = Array.from({ length: SLOTS },
                            () => ({ x: 0, y: 0, vx: 0, state: FREE }));
    this.fired = 0;
    this.culled = 0;        // emissions refused by the muzzle window
    this.refused = 0;       // emissions lost to a full array
    this.hits = 0;
    this.passedThrough = 0; // hits skipped because the hero was invulnerable
  }

  get live() { return this.slots.reduce((n, s) => n + (s.state >= 0 ? 1 : 0), 0); }

  /**
   * CS:0x1FE7 / CS:0x2039. `worldX/worldY` are the muzzle; `vx` is DS:0x206.
   * @returns {boolean} whether a shot was created.
   */
  fire(worldX, worldY, vx, cam) {
    const cull = vx < 0 ? CULL_LEFT : CULL_RIGHT;
    const sx = worldX - cam.x, sy = worldY - cam.y;
    if (sy >= 0xc0 || sy < -4 || sx < cull.xMin || sx > cull.xMax) {
      this.culled++; return false;
    }
    const free = this.slots.find((s) => s.state < 0);      // CS:0x2012 `js`
    if (!free) { this.refused++; return false; }
    free.x = worldX; free.y = worldY;                      // CS:0x2026 — WORLD
    free.vx = vx;                                          // CS:0x202B, DS:0x206
    free.state = 0;                                        // CS:0x2032
    this.fired++;
    return true;
  }

  /** CS:0x1FD8 — level init. */
  clear() { for (const s of this.slots) s.state = FREE; return this; }

  /**
   * CS:0x205E. One tick over all 20 records.
   * @param {{x:number,y:number}} cam
   * @param {{x:number,y:number,state:number}} hero  world position + DS:0x377
   * @param {Uint8Array} planeB
   * @param {{invulnerable:boolean, hurt:(n:number)=>void}} health
   * @param {?object} debris  the DS:0x8b4c owner, for the impact puff
   */
  step(cam, hero, planeB, health, debris = null) {
    const drawn = [];
    for (const s of this.slots) {
      if (s.state < 0) continue;                           // CS:0x2065 `jns`

      if (s.state > 0) {                                   // CS:0x2072, the fade
        s.state += 1;
        if (FADE_FREE_AT.includes(s.state)) { s.state = FREE; continue; }
        drawn.push({ x: s.x - cam.x, y: s.y - cam.y,
                     sprite: SPRITE_FADE_BASE + s.state, gfxExport: DRAW_EXPORT });
        continue;
      }

      s.x += s.vx;                                         // CS:0x20B0
      const sx = s.x - cam.x;
      /* ⚠️ Direction-dependent despawn, and the constants are not mirrored. */
      if (s.vx > 0 ? sx >= DESPAWN_RIGHT_X : sx <= DESPAWN_LEFT_X) {
        s.state = FREE; continue;                          // CS:0x20C7 / 0x20F7
      }

      /* CS:0x211A -> CS:0x2158. The stop state depends on the DIRECTION, and
       * the velocity is zeroed so later ticks take the fade branch. */
      if (planeB && this.#blocked(s, planeB)) {
        s.state = s.vx >= 0 ? STOP_STATE_RIGHT : STOP_STATE_LEFT;   // CS:0x215E/0x2165
        s.vx = 0;                                                   // CS:0x216A
        continue;
      }

      /* CS:0x4501 — the hero. */
      if (hitsHero(s.x, s.y, hero.x, hero.y, isCrouching(hero.state))) {
        if (health && health.invulnerable) this.passedThrough++;   // CS:0x4547
        else {
          if (health) health.hurt(DAMAGE);                 // CS:0x454E
          s.state = FREE;                                  // CS:0x4553
          this.hits++;
          if (debris) debris.spawn(s.x, s.y, 0, 0);        // CS:0x4561, cx=dx=0
          continue;
        }
      }

      drawn.push({ x: sx, y: s.y - cam.y,
                   sprite: s.vx > 0 ? SPRITE_RIGHT : SPRITE_LEFT,
                   gfxExport: DRAW_EXPORT });
    }
    return drawn;
  }

  /** CS:0x211A. The shot's own cell, plus the next one right when it
   *  straddles STRICTLY past 24 px. */
  #blocked(s, planeB) {
    const col = (s.x & 0xffe0) >> 5;
    const row = ((s.y + TERRAIN_Y_BIAS) & 0xfff0) >> 4;
    if (col < 0 || col > 127 || row < 0 || row > 63) return false;
    const at = (c) => (c >= 0 && c <= 127 ? planeB[row * 128 + c] : 0);
    if (at(col) === 1) return true;                        // CS:0x2143, always
    if ((s.x & 0x1f) <= TERRAIN_STRADDLE) return false;    // CS:0x2150 `jng`
    return at(col + 1) === 1;                              // CS:0x2152
  }
}

/* ── UNKNOWN_enemy_shot_other_emitters ────────────────────────────────────
 * CS:0xE99F and CS:0xEFA2 also load DS:0x8954, and five of the six left/right
 * emitter pairs belong to behaviour handlers this project has not read.
 */
export const UNKNOWN_enemy_shot_other_emitters =
  'five of the six emitter pairs belong to unread behaviour handlers';
