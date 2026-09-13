/* line-hazard.js — DS:0xd2be, the last of debris.js's five CS:0xA633 callers,
 * and CLOSES CLAUDE.md's `UNKNOWN_d2be_pool`.
 *
 * ── WHAT THIS IS ──────────────────────────────────────────────────────────
 * A 20-slot pool of flying fragments, each following an integer Bresenham
 * line seeded from an entity's position toward the hero. It is fed by a
 * previously-undocumented divert inside the shared System-A/B facing-and-fire
 * routine (CLAUDE.md's `CS:0xE659`, ported in this repo as the muzzle logic
 * in `combat.js`'s stage-6 equivalent — NOT YET PORTED, see the note at the
 * bottom): when a group descriptor's `+0x4` word has bits [5:4] set (1, 2 or
 * 3 — never 0, which means "fire a normal shot"), `CS:0xE659` calls
 * `CS:0xE5E4` INSTEAD of the ordinary `CS:0x1FE7`/`CS:0x2039` emitter this
 * port already models in `enemy-shots.js`. A shipped-data census (all 8
 * `PALFILS` files, both entity systems, both group-descriptor windows) found
 * this genuinely reachable: 89 of 344 live descriptors set nonzero attack
 * bits AND a nonzero fire-rate nibble — real, shipped content, not cut.
 *
 * ── THE RAY-NOT-SEGMENT CORRECTION ───────────────────────────────────────
 * The most important finding, and the one that would have made a port wrong
 * in a way that "looked right": there are FOUR near-identical copies of a
 * classic Bresenham line stepper in `GAME.EXE`, glued together with a
 * "resume address" trick — CS:0xdce1 (the SEED, called once at spawn) writes
 * one of `{0xdd04, 0xdd43, 0xdd95, 0xddd3}` (its OWN four loop-entry
 * addresses, one per x-major/y-major x leftward/rightward combination) into
 * the record's own `+0x00` word, and the per-tick WALKER (`CS:0x7a0b`) loads
 * saved register state from the record and does `DI = [DI+0] / JMP DI` to
 * resume mid-loop.
 *
 * The seed's four loop bodies and 7A0B's four loop bodies are BYTE-IDENTICAL
 * in their relative encoding (verified instruction-for-instruction) — EXCEPT
 * for one thing: **7A0B's loops also test whether the major-axis distance
 * counter (`[0x1ee]`, decremented once per Bresenham step) has gone negative,
 * and exit early if so — the SEED's loops do not.** Since `JMP DI` always
 * lands in the SEED's copy (the seed's own finalize re-writes the SAME
 * `0xdd04`-family constant every time, so the record is pinned to that copy
 * forever), **every actual per-tick resume runs the SEED's unconditional
 * loop, which burns exactly `n` steps and stops — with NO destination check
 * at all.** `[0x1ee]` is loaded, decremented, and stored back every call, and
 * nothing ever branches on it.
 *
 * So the fragment is a RAY along the source->target DIRECTION, not a segment
 * that stops when it reaches the target. It keeps flying at `n` grid-steps
 * per frame forever, until solid terrain, the hero, or the off-screen cull
 * stops it. A port that halts it at the destination looks plausible and is
 * wrong — this was caught by a second read of the four finalize sites before
 * any code was written, not empirically.
 *
 * ── THE TWO SPAWN VARIANTS, CS:0xE5E4 ────────────────────────────────────
 *   attackBits (descriptor `+0x4`, bits [5:4]) selects:
 *     1        source = entity position exactly (no muzzle offset)
 *              target = hero position +/- an asymmetric jitter, TWO
 *              independent CS:0x3836 draws: `(rand() & 0x3f) - 0x1f`, range
 *              [-31, +32] per axis — note the asymmetry, `0x3f - 0x1f = 0x20`.
 *     2 or 3   source = entity position, X muzzle +0x10 (a THIRD muzzle
 *              offset in this game, next to the shared emitter's -8/+32)
 *              target = the hero's EXACT position, `(heroX+8, heroY+6)`
 *   n (the per-frame/per-spawn step count) is the SAME in both variants:
 *   the HIGH nibble of descriptor `+0x6` (`(byte >> 4) & 0xf`). The LOW
 *   nibble of that byte is the ordinary fire-rate divisor this port's shared
 *   emitter code already reads; CLAUDE.md's own field table had marked the
 *   high nibble `[WF]` — this closes it.
 *
 *   ⚠️ `attackBits === 3` never occurs in any of the 89 live shipped
 *   descriptors (only 1 and 2 do) — recorded here because it is a genuine
 *   negative result from an exhaustive census, not an oversight.
 *
 * ── N == 0 — CENSUS, NOT ASSUMPTION ───────────────────────────────────────
 * `DEC [0x1f0] / JNZ`-style loops wrap on an input of 0 (0 - 1 = 0xFFFF,
 * ~65536 iterations) — a real hang risk in the original if it were ever fed
 * a zero step count, since the low nibble of `+0x6` has its own zero-guard
 * (`CS:0xe666 al&=0xf / jz e6be`) but the HIGH nibble does not. A shipped-data
 * census (all 89 reachable descriptors, decompressed via `blast.py`) found
 * `n` only ever 2, 3, 4, 5, 6, 8 or 10 — NEVER 0 or 1. This port still guards
 * against it defensively (a spawn request with `n <= 0` is refused rather
 * than looping), since nothing here should ever hang a browser tab even on
 * data this project hasn't census-checked (a custom level, a future patch).
 *
 * ── THE PER-RECORD BODY, CS:0xdc49-0xdcd0 (the walker) + CS:0xdb4e ────────
 * Per active record, per tick:
 *   1. Advance `n` Bresenham steps (see above — always `n`, the seed's own
 *      loop never exits early).
 *   2. Solid-terrain probe, CS:0xdc68-0xdc8d: `col = floor((x+3)/32)`,
 *      `row = floor((y+3)/16)` — a FIFTH distinct pixel-to-cell rounding rule
 *      in this game (+3 on BOTH axes; CLAUDE.md's collection so far has
 *      floored/rounded-nearest/+8-both/+2-Y-only). Solid -> consume, drop a
 *      STATIONARY debris puff at world `(x-3, y-3)` (CS:0xdc1b/0xdc1e — note
 *      this -3 bias is NOT "undo the +3 probe bias", it is its own separate
 *      constant, verbatim from the bytes), no draw this tick.
 *   3. Screen-space cull, CS:0xdca2/0xdca7: `screenX < 0x13c(316)` AND
 *      `screenY < 0xbc(188)`, both lower-bounded at 0 via a sign test. Outside
 *      it -> consume WITHOUT debris (CS:0xdcdb), no draw.
 *   4. Else: hero-hit test, CS:0xdb4e — hot point `(x+6, y+4)` world, against
 *      a `HERO_BOX`-shaped box (0x20 x 0x30, the SAME box `enemy-shots.js`
 *      uses) with the SAME crouch-raise magnitude as that module (0x18, NOT
 *      combat.js's 0x14 for the contact path — CLAUDE.md's three-sites note
 *      now has all three attributed). Hit -> consume, flat -2 damage to the
 *      TARGET (chases down over following frames, same as every other
 *      damage source), a STATIONARY debris puff at world `(x-2, y-2)` — yet
 *      ANOTHER distinct constant, not the wall-hit path's -3.
 *      ⚠️ INVULNERABLE -> PASS THROUGH, exactly like `enemy-shots.js`'s own
 *      hero-hit (CS:0x4547's `jnz`): no consume, no damage, no debris, the
 *      fragment keeps flying.
 *   5. Draw, REGARDLESS of whether step 4 just consumed the record — the
 *      sprite/position were staged BEFORE the hero-hit call, and the draw
 *      call (CS:0xdccb, export 2, the same blitter `debris.js` uses) runs
 *      unconditionally once a record survives steps 2-3. So a fragment that
 *      hits the hero this tick still renders its last frame before freeing.
 *      Sprite = `0x4b + (tock & 1)` — 75/76, the SAME every-other-frame
 *      toggle (`DS:0x36c`) the world-2 nest's hatch animation reads
 *      (`nest.js`), immediately after the enemy-shot sprite range (0x45-0x4A)
 *      in the atlas — a discriminating, not decorative, corroboration.
 *
 * ── THE SPAWNING SIDE — CLOSED, a later session ───────────────────────────
 * CLAUDE.md's `CS:0xE659` (the shared System-A/System-B facing-and-fire
 * routine)'s `attackBits != 0` divert to `CS:0xE5E4` is now wired for BOTH
 * entity systems: `entity-a.js`'s `stageFacingAndFire` (System A, stage 6)
 * and `entity.js`'s `fireB` (System B) both return `{hazard:true, ...}` on a
 * nonzero `attackBits`, and `main.js`'s own per-entity loops for both
 * systems route that straight into `spawnJittered`/`spawnAtHero` below
 * (counted as `firedHazardsByA`/`firedHazardsByB`).
 *
 * ⚠️ `FUN_1000_b1c2` is `db4e`'s OTHER caller (CS:0xb236, per CLAUDE.md's
 * debris.js note) and is NOT this pool. `UNKNOWN_b1c2`'s "DO NOT PORT IT,
 * sixth proven-cut feature" reading below was ITSELF corrected in a later
 * CLAUDE.md session: `CS:0xB144`/`0xB290` (world 2 selector-2 class 2/5/6/7)
 * and `CS:0xB2C7`/`0xB2F3` (world 3 class 3) — both live in shipped
 * `PALFILS +0x0718` dispatches — genuinely feed `DS:0xaccc`/`DS:0xad1c`+
 * `DS:0xad94` and arm their self-modifying `RET` gates; the original
 * "exhaustive operand search" missed this because both handlers load the
 * pool base into a register first and write through `[SI+n]`, one
 * indirection past a literal-address search. Ported as `rockfall.js` (see
 * its own header for what it still doesn't model — ground-probe landing and
 * the shatter-into-3 recursion, both needing a `map`/terrain object this
 * call chain doesn't yet receive).
 *
 * `CS:0xAD88` (the three call sites this note used to point at) — the
 * selector-2 spawn driver, `DS:0xaec0`, PALFILS `+0x0718` — is also ported
 * now, as `selector2.js`'s own `handlerA_b03c`/`b670` (and sibling) handler
 * families, which drain their own fire/hazard output the same way as the
 * two entity systems above.
 */

export const SLOTS = 20;                 // CS:0xdbd4 `mov bp,0x13` (0..19)
export const STRIDE = 0x16;              // CS:0xdbe0 `add si,0x16`
export const ARRAY_DS = 0xd2be;

export const TARGET_JITTER_MASK = 0x3f;  // CS:0xe631 `and ax,0x3f`
export const TARGET_JITTER_BIAS = 0x1f;  // CS:0xe634 `sub ax,0x1f` -> [-31, +32]
export const MUZZLE_X_OFFSET = 0x10;     // CS:0xe5fe / CS:0xe649 — a THIRD muzzle offset
export const HERO_HOT_POINT = Object.freeze({ dx: 6, dy: 4 });   // CS:0xdb51/0xdb56
export const HERO_BOX = Object.freeze({ w: 0x20, h: 0x30 });     // CS:0xdb87/0xdb92
export const CROUCH_RAISE = 0x18;        // CS:0xdb76 — matches enemy-shots.js, not combat.js
export const CROUCH_STATES = Object.freeze([0x12, 0x13]);
export const DAMAGE = 2;                 // CS:0xdba0 `sub word [0x192],2`
export const PROBE_BIAS = 3;             // CS:0xdc68/0xdc6b — a FIFTH cell rounding rule
export const WALL_DEBRIS_BIAS = 3;       // CS:0xdc1b/0xdc1e — world -3, own constant
export const HERO_HIT_DEBRIS_BIAS = 2;   // CS:0xdbb2/0xdbb5 — world -2, a DIFFERENT constant
export const CULL = Object.freeze({ xMax: 0x13c, yMax: 0xbc }); // CS:0xdca2/0xdca7, >=0 both
export const SPRITE_BASE = 0x4b;         // CS:0xdcb6 `add dx,0x4b` -- 75/76

/** CS:0x4516/CS:0xdb68 shape, reused verbatim. */
export const isCrouching = (playerState) =>
  playerState >= CROUCH_STATES[0] && playerState <= CROUCH_STATES[1];

/**
 * A single Bresenham line's persistent state. `dx`/`dy` are UNSIGNED
 * magnitudes, `sx`/`sy` are the per-step signs (+-1), `xMajor` picks which
 * axis increments every step vs. only on error carry, and `err` is the
 * running error term, seeded to `major >> 1` — CS:0xdd02/CS:0xdd41.
 */
function newLine(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x1 >= x0 ? 1 : -1;
  const sy = y1 >= y0 ? 1 : -1;
  const xMajor = dx >= dy;               // CS:0xdcf8/0xdd88 `cmp cx,dx / jc` — unsigned
  return { x: x0, y: y0, dx, dy, sx, sy, xMajor, err: (xMajor ? dx : dy) >> 1 };
}

/**
 * Advance one line `n` Bresenham steps IN PLACE. This is the seed's own loop
 * body (CS:0xdd04/CS:0xdd43/CS:0xdd95/CS:0xddd3) — no destination check, by
 * the ray-not-segment finding above. `n <= 0` is a no-op (see the N==0 note).
 */
function stepLine(line, n) {
  for (let i = 0; i < n; i++) {
    if (line.xMajor) {
      line.err -= line.dy;                                    // CS:0xdd04
      if (line.err < 0) { line.err += line.dx; line.y += line.sy; } // CS:0xdd08/0xdd0a
      line.x += line.sx;                                       // CS:0xdd0c, ALWAYS
    } else {
      line.y += line.sy;                                       // CS:0xdd43, ALWAYS (first)
      line.err -= line.dx;                                      // CS:0xdd45
      if (line.err < 0) { line.err += line.dy; line.x += line.sx; } // CS:0xdd49/0xdd4b
    }
  }
  return line;
}

/** CS:0xe631-0xe642 — two independent `CS:0x3836` draws, one per axis. */
export function jitterTarget(rngNext) {
  const jx = (rngNext() & TARGET_JITTER_MASK) - TARGET_JITTER_BIAS;
  const jy = (rngNext() & TARGET_JITTER_MASK) - TARGET_JITTER_BIAS;
  return { dx: jx, dy: jy };
}

export class LineHazards {
  constructor() {
    this.slots = Array.from({ length: SLOTS }, () => ({ active: false, line: null, n: 0 }));
    this.spawned = 0;
    this.refused = 0;        // CS:0xdbe7 — all 20 busy, silent failure
    this.wallHits = 0;
    this.culled = 0;
    this.heroHits = 0;
    this.passedThrough = 0;  // invulnerable — CS:0xdb99/0xdb9e
  }

  get live() { return this.slots.reduce((n, s) => n + (s.active ? 1 : 0), 0); }

  /**
   * CS:0xdbc6 (exact-hero target) / CS:0xdbd4 (pre-jittered target, the entry
   * BOTH the allocator's own top AND `CS:0xE60F`'s jitter branch use). Runs
   * `n` steps immediately, matching the SEED executing its first pass at
   * spawn time — so a fragment is already `n` steps out on the frame it
   * appears, not sitting at the muzzle. Silently refuses when all 20 slots
   * are busy (CS:0xdbe7), same convention as this game's other first-fit
   * pools.
   * @returns {?object} the new slot's internal state, or null if refused/n<=0.
   */
  spawn(sourceX, sourceY, targetX, targetY, n) {
    if (n <= 0) return null;                 // defensive — see the N==0 note
    const free = this.slots.find((s) => !s.active);
    if (!free) { this.refused++; return null; }
    free.active = true;
    free.line = newLine(sourceX, sourceY, targetX, targetY);
    free.n = n;
    stepLine(free.line, n);                  // the seed's own immediate pass
    this.spawned++;
    return free;
  }

  /** CS:0xE5E4, attackBits==1: source = entity exactly, target = hero+jitter. */
  spawnJittered(entityX, entityY, heroX, heroY, n, rngNext) {
    const j = jitterTarget(rngNext);
    return this.spawn(entityX, entityY, heroX + 8 + j.dx, heroY + 6 + j.dy, n);
  }

  /** CS:0xE5E4, attackBits==2 or 3: source = entity +0x10 X, target = hero exactly. */
  spawnAtHero(entityX, entityY, heroX, heroY, n) {
    return this.spawn(entityX + MUZZLE_X_OFFSET, entityY, heroX + 8, heroY + 6, n);
  }

  /** CS:0xdbfb — level init. */
  clear() { for (const s of this.slots) s.active = false; return this; }

  /**
   * CS:0xdc49-0xdcd0, one full pass. Argument order matches `EnemyShots.step`
   * (cam, hero, planeB, health, debris) with `tock` appended, so both
   * enemy-related steppers in `main.js` read the same way. `hero` is
   * `{x,y,state}` world coords; `health` is the `{invulnerable, hurt(n)}`
   * shape `enemy-shots.js` uses; `tock` is the raw 0/1 every-other-frame
   * toggle `nest.js` already owns (threaded positionally, matching that
   * convention).
   * @returns {Array<{x:number,y:number,sprite:number}>} screen-space draws.
   */
  step(cam, hero, planeB, health, debris, tock = 0) {
    const drawn = [];
    const crouch = isCrouching(hero.state);
    for (const s of this.slots) {
      if (!s.active) continue;
      stepLine(s.line, s.n);                                    // CS:0xdc58-0xdc5f
      const { x, y } = s.line;

      const col = ((x + PROBE_BIAS) & ~0x1f) >> 5;               // CS:0xdc68-0xdc7c
      const row = ((y + PROBE_BIAS) & ~0xf) >> 4;                // CS:0xdc71-0xdc84
      const inGrid = col >= 0 && col <= 127 && row >= 0 && row <= 63;
      if (inGrid && planeB[row * 128 + col] === 1) {             // CS:0xdc8d
        s.active = false;                                        // CS:0xdc17
        if (debris) debris.spawn(x - WALL_DEBRIS_BIAS, y - WALL_DEBRIS_BIAS, 0, 0); // CS:0xdc2f
        this.wallHits++;
        continue;
      }

      const screenX = x - cam.x, screenY = y - cam.y;             // CS:0xdc92/0xdc96
      if (screenX < 0 || screenY < 0 || screenX >= CULL.xMax || screenY >= CULL.yMax) {
        s.active = false;                                         // CS:0xdcdb, NO debris
        this.culled++;
        continue;
      }

      const sprite = SPRITE_BASE + (tock & 1);                    // CS:0xdcad-0xdcb6

      const hotX = x + HERO_HOT_POINT.dx, hotY = y + HERO_HOT_POINT.dy; // CS:0xdb51/0xdb56
      const top = hero.y + (crouch ? CROUCH_RAISE : 0);           // CS:0xdb68-0xdb76
      const hit = hotY >= top && hotX >= hero.x
        && hotX <= hero.x + HERO_BOX.w && hotY <= hero.y + HERO_BOX.h; // CS:0xdb79-0xdb97
      if (hit) {
        if (health && health.invulnerable) {                      // CS:0xdb99/0xdb9e
          this.passedThrough++;                                   // pass through, keeps flying
        } else {
          s.active = false;                                       // CS:0xdba6
          if (health) health.hurt(DAMAGE);                         // CS:0xdba0
          if (debris) debris.spawn(x - HERO_HIT_DEBRIS_BIAS, y - HERO_HIT_DEBRIS_BIAS, 0, 0); // CS:0xdbbb
          this.heroHits++;
        }
      }

      drawn.push({ x: screenX, y: screenY, sprite });               // CS:0xdccb, ALWAYS reached
    }
    return drawn;
  }
}
