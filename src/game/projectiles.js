/* projectiles.js — the hero's projectile records and the spawn handlers.
 *
 * SCOPE WARNING, read this before using the module. This covers ALLOCATE and
 * SPAWN only. Nothing here moves a projectile, collides it, or reaps it, so
 * the hero still cannot kill anything. See UNKNOWN_projectile_mover at the
 * bottom for exactly what is missing and what is already ruled out.
 *
 * ── Memory layout, CS:0x95ca and CS:0x9734 ───────────────────────────────
 *
 * Three weapon slots, uniform stride 0x92 = 146 bytes:
 *
 *     0xdd10  slot A   u16 weapon index, then 144 bytes of projectile area
 *     0xdda2  slot B   same
 *     0xde34  slot C   same
 *     0xdec6  <a different array — handlers 14/15/21 load it, not ours>
 *
 * The stride is proven by subtraction on the three bases the allocator and
 * the trigger predicates COND3/COND4 (CS:0x3ea8/0x3ec1) both name:
 * 0xdda2 - 0xdd10 == 0xde34 - 0xdda2 == 0x92. 146 - 2 = 144 = 18 * 8.
 *
 * ── The record ───────────────────────────────────────────────────────────
 *
 * A projectile is EIGHT bytes:
 *
 *     +0  u16  tag     nonzero when live; 0 marks the entry free
 *     +2  u16  x       world pixels
 *     +4  u16  y       world pixels
 *     +6  u16  dir     0..5, see DIRS below
 *
 * The allocator probes at stride 0x18 and the free test (CS:0x9724) reads
 * [di], [di+8] and [di+0x10] — i.e. the tag word of THREE CONSECUTIVE 8-byte
 * entries. That is what makes the record 8 bytes rather than 24: a spawn
 * writes one, two or three adjacent entries as a single volley, and the
 * "sub-slot" the allocator hands out is a group of three.
 *
 * ⚠️ The allocator only ever probes groups at +0x00, +0x18 and +0x30 — the
 * first NINE of the eighteen entries. Bytes 72..143 of every slot are touched
 * by nothing this project has read. The unrolled loop is three deep because
 * shipped maxShots caps at 3; whether the upper half is headroom or belongs
 * to something else is open (UNKNOWN_projectile_area_upper).
 */

export const SLOT_STRIDE = 0x92;          // 0xdda2 - 0xdd10, and again for C
export const PROJECTILE_SIZE = 8;         // { tag, x, y, dir }
export const GROUP_STRIDE = 0x18;         // CS:0x9616 `add di,0x18` — 3 entries
export const GROUP_ENTRIES = 3;           // CS:0x9724 tests [di], [di+8], [di+0x10]
export const GROUPS_PROBED = 3;           // the unrolled loop's depth
export const AREA_BYTES = SLOT_STRIDE - 2;              // 144
export const AREA_ENTRIES = AREA_BYTES / PROJECTILE_SIZE; // 18
export const ENTRIES_REACHABLE = GROUPS_PROBED * GROUP_ENTRIES; // 9 of 18

/* The dir word. The right-facing handler writes 1, 0, 2 into its three
 * entries and the left-facing one writes 4, 3, 5 — so the middle entry of a
 * volley gets the low code of each triple and the outer two straddle it.
 * Right and left are a clean +3 apart. What dir MEANS to the mover is not
 * established here; these are the values the spawn writes. */
export const DIRS = { right: [1, 0, 2], left: [4, 3, 5] };

/* CS:0x985f / 0x9895 both open with `mov ax,0x41c / call 0x22ca`. The low
 * byte is the sfx id, matching the footstep (0x020e -> 14) and hurt (0x0e42
 * -> 66) calls elsewhere in the engine. */
export const FIRE_SFX = 0x1c;

/* ── The handler table, DS:0xd88c ─────────────────────────────────────────
 *
 * The emitter reads a BYTE from the weapon record — +0x16 when firing right,
 * +0x12 when firing left — doubles it, and `call`s through this table. So a
 * weapon's projectile behaviour is data, one handler per facing.
 *
 * Table contents read straight out of the EXE image. Even indices are
 * left-facing and odd are right-facing: entry 12 is `sub bx,8 / jmp 0x991c`
 * (into the LEFT body) and entry 13 is `sub bx,8 / jmp 0x98d1` (into the
 * RIGHT body), which pins the parity without relying on the weapon data.
 *
 * ⚠️ Size is [STATIC], not proven from a loop immediate. The highest index
 * any shipped weapon references is 15, so the table is at least 16 wide. The
 * 22 below comes from entries 22+ holding 0x61cf..0x6350 — addresses this
 * project independently recorded as the POTION effect handlers — i.e. a
 * different table starts there. That is inference from a discontinuity.
 * There is no bounds check on the index in the original. */
export const HANDLER_TABLE_DS = 0xd88c;
export const HANDLER_TABLE = [
  0x9919, 0x98cb, 0x99d7, 0x996f, 0x0000, 0x0000, 0x9a48, 0x9a42,
  0x9a7a, 0x9a51, 0x9aca, 0x9a82, 0x996a, 0x9964, 0x9bc1, 0x9b15,
  0x9c6d, 0x9d97, 0x0000, 0xa058, 0x9ef7, 0xa678,
];

/* ⚠️ ENTRIES 4 AND 5 ARE NULL, and weapon 3 ("flame") points at them.
 * `call cx` with cx = 0 would jump to CS:0x0000. It is not reachable in the
 * shipped game: a census of all 200 object records in all eight maps finds 55
 * weapon pickups of 9 distinct types, and type 3 is not among them — flame is
 * placed in no level. (Type 9, "magic axe", is also unplaced but its handlers
 * 14/15 are real code.) The consistent reading is a cut weapon whose handler
 * was never written. This port refuses rather than emulating a wild jump. */
export const NULL_HANDLERS = [4, 5, 18];
export const CUT_WEAPON = 3;              // "flame"

/* The four handlers decoded here, keyed by table index. Each adjusts the
 * muzzle and then writes the same three-entry volley.
 *
 * ⚠️ 13 IS NOT 1 WITH A DIFFERENT Y. Handler 1 begins `add ax,0x10 /
 * sub bx,0xc`; handler 13 jumps PAST both to 0x98d1 after its own `sub bx,8`,
 * so it never applies the +0x10 X offset that its same-facing sibling does.
 * Mirroring 1 to build 13 puts every shot 16 px off. */
export const HANDLERS = {
  0:  { facing: -1, dx: 0,    dy: -0x0c, dirs: DIRS.left,  at: 0x9919 },
  1:  { facing: +1, dx: 0x10, dy: -0x0c, dirs: DIRS.right, at: 0x98cb },
  12: { facing: -1, dx: 0,    dy: -0x08, dirs: DIRS.left,  at: 0x996a },
  13: { facing: +1, dx: 0,    dy: -0x08, dirs: DIRS.right, at: 0x9964 },
};

/* Handlers 2/3, 6/7, 8/9, 10/11, 14/15 and 16..21 are not decoded. Shipped
 * weapons reference 2/3 (fireball), 6/7 (spear), 8/9 (hunter), 10/11 (time
 * bomb) and 14/15 (magic axe). UNKNOWN_projectile_handlers. */
export const DECODED_HANDLERS = [0, 1, 12, 13];

/**
 * CS:0x98d1 — how many of the three entries a volley fills.
 *
 * The original computes `bp = [si+8] - [si+6] + 1` and then `dec bp / jz`
 * twice, so only 1 and 2 are distinguishable and everything else falls
 * through to three. Ported as that branch, never as a clamped subtraction.
 *
 * ⚠️ THIS IS RUNTIME STATE, NOT A WEAPON PROPERTY. +0x08 is the weapon's
 * pickup count and +0x06 its immutable base (see UNKNOWN_weapon_08 — CLOSED,
 * in weapons.js), so `bp` is `1 + extra pickups`. A weapon fires ONE
 * projectile when first picked up and gains one per duplicate, to a maximum
 * of three. Deriving the volley from the shipped file or the pinned EXE table
 * gives the LOADED state, which CS:0x9115 overwrites before the weapon can
 * ever be fired — a port that does so has every weapon firing its end-game
 * spread from the moment it is collected.
 *
 * @param {{count:number, base:number}} st  from armWeapon()/pickUpAgain()
 */
export function volleySize(st) {
  const bp = (st.count - st.base + 1) | 0;
  if (bp === 1) return 1;
  if (bp === 2) return 2;
  return 3;
}

/** The volley the LOADED table would produce — never observed in play, kept
 *  only to keep the pinning claim checkable. See volleySize() above. */
export function volleySizeAtLoad(w) {
  return volleySize({ count: w.unknown08, base: w.power });
}

/**
 * Fill a volley, reproducing CS:0x98cb (right) / CS:0x9919 (left).
 *
 * @param {object} st       runtime weapon state {count, base}
 * @param {number} handler  table index from w.handlerRight / w.handlerLeft
 * @param {number} tag      the allocator's tag for this sub-slot
 * @param {number} x,y      muzzle position (see muzzle() below)
 * @returns {{entries:Array, facing:number}}
 */
export function spawnVolley(st, handler, tag, x, y) {
  const h = HANDLERS[handler];
  if (!h) {
    throw new Error(
      NULL_HANDLERS.includes(handler)
        ? `projectile handler ${handler} is NULL in the shipped table ` +
          `(weapon ${CUT_WEAPON} "flame" — cut, placed in no level)`
        : `projectile handler ${handler} is not decoded (UNKNOWN_projectile_handlers)`);
  }
  const px = (x + h.dx) & 0xffff;
  const py = (y + h.dy) & 0xffff;
  const entries = [];
  for (let i = 0; i < volleySize(st); i++) {
    entries.push({ tag: (tag + i) & 0xffff, x: px, y: py, dir: h.dirs[i] });
  }
  return { entries, facing: h.facing };
}

/**
 * CS:0x9734 (right) / CS:0x97ce (left) — where the shot comes out.
 *
 * The default muzzle is the hero's own position with Y pushed down 0x18. When
 * DS:0x33d names this slot, the origin switches to the pair at DS:0x16a/0x16c
 * — a second emitter position whose owner is UNKNOWN_alt_emitter. DS:0x33d is
 * written by CS:0xc389 (0xff) and the routine after it, which ranks the three
 * equipped weapons by Power; it is only meaningful with 2+ weapons equipped.
 *
 * ⚠️ The +8 on the alternate path exists ONLY when firing right (CS:0x975e).
 * The hero-relative path is identical for both facings.
 */
export function muzzle(hero, right, { slot = null, sel = -1, alt = null } = {}) {
  if (alt && sel === slot) {
    return { x: (alt.x + (right ? 8 : 0)) & 0xffff, y: (alt.y + 0x10) & 0xffff };
  }
  return { x: hero.x, y: (hero.y + 0x18) & 0xffff };
}

/* ── UNKNOWN_projectile_mover ─────────────────────────────────────────────
 *
 * Nothing in this project has located the code that advances a live
 * projectile, tests it against terrain or creatures, or clears its tag. Two
 * negative results bound where it is NOT, so the next pass need not repeat
 * them:
 *
 *   1. A scan of every immediate in the whole GAME.EXE disassembly that lands
 *      inside 0xdd10..0xdec6 finds the arrays referenced by exactly three
 *      instructions — `mov di,0xdd12` (CS:0x95df), `mov di,0xdda4`
 *      (CS:0x9645) and `mov di,0xde36` (CS:0x96b0), all inside the allocator.
 *      So the mover cannot be reaching them by absolute address.
 *
 *   2. The handler table 0xd88c is loaded at exactly two sites, CS:0x9886 and
 *      CS:0x98bc — the two emitters. So the handlers are spawn-time only and
 *      the mover is not a per-frame dispatch through that table.
 *
 * The live pointers DS:0x1bc/0x1be/0x1c0 flow only allocator -> spawner and
 * are cleared at the top of every allocation, so they are not a handle the
 * mover could hold either. The remaining candidates are the main-loop calls
 * at CS:0x0279..0x02e1 that this project has not yet opened.
 */
export const UNKNOWN_projectile_mover = true;

/* ── UNKNOWN_projectile_mover — CLOSED ────────────────────────────────────
 *
 * The chain, from the main loop down:
 *
 *   CS:0x020F  call 0x9455                  (also CS:0x09e4, CS:0x927d)
 *   CS:0x9455  for each of the three slots: DS:0x33f := slot index, call 0x9477
 *   CS:0x9477  if the slot's weapon word is negative -> skip
 *              si := weapon record;  di := slot base + 2, the projectile area
 *              jmp MOVER_TABLE[weapon +0x1A]        (DS:0xd8ac, SIX entries)
 *
 * ⚠️ THIS IS A DIFFERENT TABLE FROM THE SPAWN HANDLERS. DS:0xd88c is 16
 * entries loaded only by the two emitters; DS:0xd8ac is 6 entries loaded only
 * here; DS:0xd8b8 is the potion table. An earlier revision of this file read
 * them as one 22-entry table — that was wrong, and it made the movers look
 * like unreachable spawn handlers. 16 is also exactly right: shipped weapons
 * reference spawn handlers 0..15 with no unused tail.
 *
 * The mover was invisible to an address scan because CS:0x9477 reaches the
 * array as `di = 0xdd10 / add di,2`, never by its own address.
 */
export const MOVER_TABLE_DS = 0xd8ac;
export const MOVER_TABLE = [0x9c6d, 0x9d97, 0x0000, 0xa058, 0x9ef7, 0xa678];
export const MOVER_NULL = 2;              // flame again — the same cut weapon

/* DS:0xdf0e, six {i16 vx, i16 vy} entries, copied from SS:0x3612 by CS:0x95bc
 * (`mov cx,0xc` = 12 words = 6 entries). Indexed by the projectile's `dir`.
 *
 * This is the 3-way spread, and it closes the loop on the spawn order: the
 * right-facing handler writes dirs 1, 0, 2 and the left-facing one 4, 3, 5 —
 * LEVEL first, then up, then down. So a single-projectile volley flies
 * straight and the extras fan out around it. */
export const PROJECTILE_VELOCITY = [
  { vx:  12, vy: -3 },   // 0  right, up
  { vx:  12, vy:  0 },   // 1  right, level
  { vx:  12, vy:  3 },   // 2  right, down
  { vx: -12, vy: -3 },   // 3  left,  up
  { vx: -12, vy:  0 },   // 4  left,  level
  { vx: -12, vy:  3 },   // 5  left,  down
];

/* ⚠️ THIS TABLE IS MUTABLE AT RUNTIME, and that is faithful rather than
 * sloppy: the three "weapon arc" potions (types 51/52/53) all call CS:0x95BC,
 * which OVERWRITES DS:0xdf0e with twelve words from one of three adjacent SS
 * tables. There is one velocity table in the original and swapping it is the
 * whole effect, so the port swaps one table too. `resetWeaponArc` exists
 * because a module-level global is order-dependent in a test suite where the
 * original's is not — the original re-copies the standard arc on any level
 * that places a type-51 stone. */
const STANDARD_ARC = PROJECTILE_VELOCITY.map((v) => ({ ...v }));

/** CS:0x95BC — `mov cx,0xc / ss lodsw / stosw`, twelve words, in place. */
export function setWeaponArc(dirs) {
  for (let i = 0; i < PROJECTILE_VELOCITY.length; i++) {
    PROJECTILE_VELOCITY[i].vx = dirs[i][0];
    PROJECTILE_VELOCITY[i].vy = dirs[i][1];
  }
}

/** Put SS:0x3612 back — what a type-51 "weapon arc / standard" stone does. */
export const resetWeaponArc = () => setWeaponArc(STANDARD_ARC.map((v) => [v.vx, v.vy]));

/** CS:0x9c6d walks exactly NINE records — the same nine the allocator reaches. */
export const MOVER_WALK = 9;

/* CS:0x9ca8-0x9cc6, in SCREEN space. Alive iff strictly inside; the tests are
 * `jg`/`jl` against -32/-32/320/192, so the bounds are exclusive. */
export const CULL = { xMin: -32, yMin: -32, xMax: 320, yMax: 192 };

/**
 * CS:0x9c6d — the common straight-line mover, used by 6 of the 11 weapons
 * (knife, lightning bolt, throwing star, spear, axe, mace).
 *
 * Despawn is `mov word [di],0` (CS:0x9d91) — it zeroes the TAG, which is the
 * same word the allocator's free test reads, so a culled projectile's slot
 * becomes available immediately.
 *
 * @param {Array} area   the slot's projectile records, index 0..8 used
 * @param {{x:number,y:number}} cam  the scroll origin DS:0x0a / DS:0x0c
 * @returns {{moved:number, culled:number, outOfRange:number}}
 *
 * ⚠️ DS:0x33f — CS:0x9455 stores the slot index (0/1/2) there before each
 * call. This mover never reads it, but the other five are unread, so it is
 * UNMODELLED here rather than known-unnecessary.
 */
export const DRAW_STYLE_TABLE_DS = 0xdf26;
/* Exactly THREE entries — DS:0xdf2c onward holds signed byte pairs
 * (-4,-3 / -2,-1 / 0,1 ...), a different table. Weapon +0x02 is 0..2 across
 * all 44 shipped records, the table's precise width, which is also why the
 * pickup path zeroes it when it reads 3 (CS:0x9118): that is a RANGE GUARD,
 * not a second meaning for the field. */
export const DRAW_STYLES = [
  { at: 0x9cff, stamp: 'terrain2x2', note: 'CS:0x9d01 call 0xa7b6 — the only style that can hit terrain' },
  { at: 0x9d0c, stamp: '3x3',        note: 'CS:0x9d0e call 0xa8b8, then one blit' },
  { at: 0x9d19, stamp: '3x3',        note: 'CS:0x9d24/0x9d4b call 0xa8b8 at y-0x10; TWO blits, branching on facing' },
];

/* ── CS:0xa7b6 — stamp, and maybe stop on terrain ────────────────────────
 *
 * ⚠️ WEAPON +0x48 IS "STOPPED BY TERRAIN", NOT "BREAKS BLOCKS".
 *
 * This project's notes had it as "projectile breaks solid terrain — the
 * maces break blocks flag", inferred from position. The bytes say otherwise:
 *
 *   A7B7  cmp byte [si+0x48],0 / jnz
 *   A7BD  jmp 0xa860              ; flag CLEAR -> just stamp, keep flying
 *   A7C0  ... bp = plane-B cell for (x + cam + 8) rounded to the tile
 *   A7EF  cmp byte [ds:bp+0],1 / jnz 0xa860    ; not solid -> stamp, keep flying
 *   A7F6  play sfx 0x1d
 *   A816  append a debris record to the 20-slot array at DS:0x8b4c
 *   A85B  mov word [di],0         ; DESPAWN THE PROJECTILE
 *
 * There is NO write to plane A or plane B on this path. The projectile is
 * consumed by the wall; the wall is untouched. So the flag means the shot
 * COLLIDES with terrain, and a weapon with +0x48 == 0 flies straight through
 * walls. Shipped: knife, time bomb, fireball, flame, throwing star and mace
 * collide; lightning bolt, spear, axe, hunter and magic axe pass through.
 *
 * Block destruction is a much narrower, separate mechanism: only when the
 * plane-A tile is 0x6d AND the world is >= 3 does CS:0xA810 call 0x73ec,
 * which appends the cell to a 40-entry queue at DS:0xd0c6.
 * UNKNOWN_destructible_tile — what that queue then does is not decoded.
 */
export const TERRAIN_SFX = 0x1d;
/* Moved to game/destructible.js, which now owns the whole mechanism; re-
 * exported here so the old import path keeps working and there is exactly ONE
 * definition rather than two that can drift apart. */
export { DESTRUCTIBLE_TILE } from './destructible.js';
export const DESTRUCTIBLE_MIN_WORLD = 3;

export function stepProjectiles(area, cam, opts = {}) {
  const { grid = null, weapon = null, planeB = null, world = 1,
          planeA = null, blocks = null, weaponIndex = -1,
          pickupCount = 0 } = opts;
  let moved = 0, culled = 0, outOfRange = 0, stamped = 0, hitTerrain = 0;
  let brokeBlocks = 0;
  /* CS:0xA816 — a shot stopped by terrain drops a stationary debris puff
   * (game/debris.js), independent of whether the cell also broke a block.
   * World coords: that's what `p.x`/`p.y` already are at the point it stops. */
  const hits = [];
  for (let i = 0; i < MOVER_WALK; i++) {
    const p = area[i];
    if (!p || p.tag === 0) continue;               // CS:0x9c70
    const v = PROJECTILE_VELOCITY[p.dir];
    /* ⚠️ DELIBERATE DIVERGENCE, and it must NOT be a throw.
     *
     * CS:0x9c88 shifts `dir` left twice and adds, with no bounds check — a
     * dir of 0x2f indexes 188 bytes past DS:0xdf0e and reads whatever is
     * there. Since `dir` is PER-MOVER (time bomb's handler 9 writes 0x2f) and
     * the three weapon slots are independent, a record carrying another
     * mover's dir can reach this walk. The original draws garbage; a throw
     * here would kill the frame instead, which is a strictly worse failure
     * mode on a path that runs every tick.
     *
     * So: skip the record and COUNT it, the same way the trigger port clamps
     * the unbounded cond_kind dispatch rather than reproducing a wild jump.
     * A nonzero `outOfRange` means the port has routed a projectile to the
     * wrong mover — surface it, don't crash on it. */
    if (!v) { outOfRange++; continue; }
    p.x = (p.x + v.vx) | 0;                        // CS:0x9c93
    p.y = (p.y + v.vy) | 0;                        // CS:0x9c95
    const sx = p.x - cam.x, sy = p.y - cam.y;      // CS:0x9ca0
    if (sx <= CULL.xMin || sy <= CULL.yMin || sx >= CULL.xMax || sy >= CULL.yMax) {
      p.tag = 0;                                   // CS:0x9d91 — despawn
      culled++;
      continue;
    }
    moved++;

    /* ── The STAMP. This is what connects the projectile to collision, and
     * it lives on the DRAW path (CS:0x9cf1 tail-jumps into the draw-style
     * table), NOT in the move loop — which is why a port that only moves
     * projectiles leaves the damage grid empty and nothing is ever hit. */
    if (!grid || !weapon) continue;
    const style = DRAW_STYLES[weapon.drawStyle];
    if (!style) { outOfRange++; continue; }

    if (style.stamp === 'terrain2x2' && weapon.breaksTerrain && planeB) {
      /* CS:0xA7C0 — the cell is taken from the WORLD position, rounded to the
       * tile: (x + 8) & ~0x1f for the column, (y + 8) & ~0xf for the row. */
      const wx = (p.x + 8) & ~0x1f, wy = (p.y + 8) & ~0xf;
      const col = wx >> 5, row = wy >> 4;
      const cell = planeB[row * 128 + col];
      if (cell === 1) {                       // CS:0xA7EF — solid
        /* CS:0xA800/0xA806 — before the projectile is consumed, a solid cell
         * whose PLANE-A tile reads 0x6d in world >= 3 takes damage. That is
         * a separate mechanism from `breaksTerrain` (+0x48), which only says
         * the shot STOPS here — see game/destructible.js. */
        if (blocks && planeA) {
          const idx = row * 128 + col;
          if (blocks.breakable(planeA, idx)) {
            /* CS:0x7484 reads the damage from the WEAPON record (`[si+8]`,
             * the pickup count), and CS:0x7489 picks which slot fired
             * through DS:0x33f — so both come from the slot, not the
             * projectile record, which has no weapon field. */
            blocks.hit(idx, weaponIndex, pickupCount);   // CS:0xA810
            brokeBlocks++;
          }
        }
        p.tag = 0;                            // CS:0xA85B — consumed by the wall
        hitTerrain++;
        hits.push({ x: p.x, y: p.y });        // CS:0xA816
        continue;
      }
    }
    /* Style 2 stamps 0x10 higher (CS:0x9d21 `sub bx,0x10`). */
    const sy2 = style.at === 0x9d19 ? sy - 0x10 : sy;
    /* ⚠️ ONLY STYLE 0 STAMPS 2x2. Styles 1 and 2 call CS:0xA8B8, the 3x3
     * variant — 24x24 px against 16x16, so more than twice the grid area.
     * This port called stamp2x2 for all three until the 3x3 was decoded,
     * which made the AXE and the LIGHTNING BOLT (both draw style 1, and both
     * among the five spawnable weapons) under-hit on every shot. Route on the
     * table, not on a default. */
    const ok = style.stamp === '3x3'
      ? grid.stamp3x3(sx, sy2, p.tag)
      : grid.stamp2x2(sx, sy2, p.tag);
    if (ok) stamped++;
  }
  return { moved, culled, outOfRange, stamped, hitTerrain, brokeBlocks, hits };
}

/* Still open here: the other five movers. 0xa058 (time bomb) is a gravity and
 * bounce arc driven by the globals DS:0x1c8/0x1ca/0x1cc rather than the
 * velocity table, and it reads a `dir` of 0x2f that this table cannot index —
 * so `dir`'s meaning is per-mover, not global. 0x9d97 (fireball), 0x9ef7
 * (hunter) and 0xa678 (magic axe) are unread. UNKNOWN_projectile_movers. */
export const DECODED_MOVERS = [0];


/* ── Mover 1, CS:0x9d97 — fireball `[PROVEN]` ────────────────────────────
 *
 * The common mover plus a per-projectile Y wobble that ACCELERATES:
 *
 *   9DBF  si = 0xdefc
 *   9DC2  dx = [di]                 ; the tag
 *   9DC4  sub dl,[0x340] / dec dl   ; -> index within the slot, 0..8
 *   9DCA  shl dx,1 / add si,dx
 *   9DCE  add bx,[si]               ; add the accumulator to Y
 *   9DD0  inc word [si]             ; AND BUMP IT
 *
 * DS:0xdefc is NINE words — one per projectile record — sitting immediately
 * below the velocity table (0xdf0e - 0xdefc = 0x12 = 9 words), which is what
 * pins its size. Because the entry is incremented every tick the downward
 * drift grows linearly, giving the fireball its arc.
 *
 * Two other differences from the common mover: it calls the terrain-aware
 * stamp CS:0xa7b6 DIRECTLY (no draw-style dispatch), and it re-tests the tag
 * afterwards so a projectile the wall just consumed is not also drawn. Its
 * tail animates the weapon frame `[si+4] += [si+0xe]` masked to 4 phases.
 */
export const WOBBLE_TABLE_DS = 0xdefc;
export const WOBBLE_ENTRIES = 9;          // (0xdf0e - 0xdefc) / 2
export const FIREBALL_FRAMES = 4;         // CS:0x9e29 `and cl,0x3`

/** Per-slot wobble accumulators, reset when a slot's projectiles are cleared. */
export const newWobble = () => new Int16Array(WOBBLE_ENTRIES);

/**
 * CS:0x9d97 — fireball. Same 9 records at stride 8, same velocity table, plus
 * the accumulator. `record` is the projectile's index within its slot.
 */
export function stepFireball(area, cam, wobble, opts = {}) {
  const { grid = null, weapon = null, planeB = null } = opts;
  let moved = 0, culled = 0, stamped = 0, hitTerrain = 0;
  for (let i = 0; i < MOVER_WALK; i++) {
    const p = area[i];
    if (!p || p.tag === 0) continue;
    const v = PROJECTILE_VELOCITY[p.dir];
    if (!v) continue;
    p.x = (p.x + v.vx) | 0;
    p.y = (p.y + v.vy + wobble[i]) | 0;     // CS:0x9dce
    wobble[i] += 1;                          // CS:0x9dd0 — the drift accelerates
    const sx = p.x - cam.x, sy = p.y - cam.y;
    if (sx <= CULL.xMin || sy <= CULL.yMin || sx >= CULL.xMax || sy >= CULL.yMax) {
      p.tag = 0; culled++; continue;
    }
    moved++;
    if (!grid || !weapon) continue;
    if (weapon.breaksTerrain && planeB) {     // CS:0x9e0b -> 0xa7b6
      const col = ((p.x + 8) & ~0x1f) >> 5, row = ((p.y + 8) & ~0xf) >> 4;
      if (planeB[row * 128 + col] === 1) { p.tag = 0; hitTerrain++; continue; }
    }
    if (grid.stamp2x2(sx, sy, p.tag)) stamped++;
  }
  return { moved, culled, stamped, hitTerrain };
}

/* ── Mover 4, CS:0x9ef7 — hunter, and it DOES home `[PROVEN]` ────────────
 *
 * ⚠️ THE TARGET LIST IS BUILT BY THE COLLISION SCANNER, NOT BY THE WEAPON.
 * This is the engine finding, not the weapon one. During the per-frame
 * creature scan, CS:0xAA8D appends `{x, y, key}` — six bytes — to a list that
 * grows from DS:0x8c54 (`mov word [0x1d2],0x8c54` at CS:0x0218) and bumps the
 * count DS:0x33c (initialised to 0xFF = -1 at CS:0x021E, so N creatures leave
 * it at N-1).
 *
 * CS:0x9e36 then walks that list and takes the entry with the SMALLEST key:
 *
 *   9E37  cl = [0x33c]              ; count-1
 *   9E3B  si = 0x8c52 ; dx = 0xffff ; best := +inf
 *   9E45  add si,6                  ; advance FIRST, so the first read is 0x8c58
 *   9E48  cmp cl,0 / js done
 *   9E4F  cmp dx,[si] / jnl skip    ; keep only a strictly smaller key
 *   9E53  ax = [si-4] ; bx = [si-2] ; dx = [si]
 *
 * So the hunter chases whichever creature the scan ranked lowest, and it can
 * only ever chase creatures the scan actually visited THIS frame. Ordering
 * matters: run the mover before the scan and the list is last frame's.
 *
 * ⚠️ For this mover `dir` is NOT a velocity-table index — it is a PACKED
 * SIGNED VELOCITY PAIR, and the halves are the reverse of the obvious:
 *
 *   9F3E  cx = [di+6]
 *   9F41  dl = cl (LOW) ; cl = ch (HIGH)
 *   9F46  al = cl / cbw / cx = ax        ; cx = sign_extend(HIGH)
 *   9F4B  al = dl / cbw / dx = ax        ; dx = sign_extend(LOW)
 *   9F51  ax += cx                       ; X += the HIGH byte
 *   9F53  bx += dx                       ; Y += the LOW byte
 *
 * X comes from the high byte and Y from the low one. The debris spawner at
 * CS:0xA039 reads the same word the same way round, which corroborates it.
 * This is why dir 0x2f is meaningful for another mover and meaningless here.
 *
 * The turn rate is another use of the pickup count:
 *   9F12  dx = [si+8] - [si+6] - 2      ; extras - 2
 *   9F1B  clamp to [1, 2]
 * so a more-upgraded hunter turns faster. UNKNOWN_hunter_turn — the steering
 * arithmetic past CS:0x9f5b is not read, so this port models the target
 * selection and the packed-velocity decode but not the turn itself.
 */
export const TARGET_LIST_DS = 0x8c52;
export const TARGET_LIST_START = 0x8c54;
export const TARGET_STRIDE = 6;
export const hunterTurnRate = (st) => Math.min(2, Math.max(1, st.count - st.base - 2));

/** CS:0x9e36 — the creature with the smallest key, or null. */
export function pickTarget(list) {
  let best = null, key = 0xffff;
  for (const t of list) if (t.key < key) { key = t.key; best = t; }
  return best;
}

/** The packed signed velocity a hunter projectile carries in its `dir` word. */
export const unpackHunterVel = (dir) => ({
  vx: (dir >> 8) << 24 >> 24,      // HIGH byte, sign-extended
  vy: (dir & 0xff) << 24 >> 24,    // LOW byte
});

/* ── Mover 5, CS:0xa678 — magic axe: it BOUNCES `[PROVEN]` ───────────────
 *
 * The only mover with per-projectile velocity STATE. `DS:0xdec6` — which sits
 * exactly where slot C's projectile area ends (0xde34 + 0x92) — holds NINE
 * 6-byte records `{i16 vx, i16 vy, i16 lifetime}`, walked in lockstep with
 * the 8-byte projectile records:
 *
 *   A77A  add di,0x8      ; the projectile record
 *   A77D  add si,0x6      ; its velocity/lifetime record
 *   A780  dec bp / js     ; bp starts at 8, so NINE iterations
 *
 * Horizontal — a wall flips vx to a fixed +/-4, it is not a reflection of the
 * incoming speed, and the probe is gated on the sub-tile position so it only
 * fires near a boundary:
 *
 *   A69D  cmp dx,0xc / jng move    ; moving right: only when (x & 0x1f) > 12
 *   A6A9  mov cx,0xfffc            ; vx := -4
 *   A6B8  cmp dx,4 / jnl move      ; moving left: only when (x & 0x1f) < 4
 *   A6C4  mov cx,0x4               ; vx := +4
 *
 * Vertical — gravity is `+2` clamped at `8`, a THIRD distinct rule after the
 * hero's (`4 + v`, cap 10), the enemy's (`v` then `++`, cap 16) and the time
 * bomb's (`++`, cap 4). Four gravity implementations, no two alike.
 *
 *   A703  add cx,0x2 / cmp cx,8 / jng / sub cx,0x2
 *
 * Lifetime: `A737 dec word [si+0x4] / js` — expiry calls CS:0xa633 and then
 * despawns. Sprite: `0x1aa + ((weaponFrame + phase) mod 6) + 1`, and 0x1aa is
 * 426 — exactly PINNED_SPRITE[9], the magic axe's own descriptor, which is an
 * independent check on the pinned table. Bounces play sfx 0x09 (CS:0xa7ad).
 */
export const AXE_STATE_DS = 0xdec6;
export const AXE_STATE_STRIDE = 6;        // CS:0xa77d
export const AXE_BOUNCE_VX = 4;           // CS:0xa6a9 / 0xa6c4
export const AXE_GRAVITY = 2;             // CS:0xa703
export const AXE_VY_CAP = 8;              // CS:0xa706
export const AXE_SPRITE_BASE = 0x1aa;     // 426
export const AXE_SPRITE_PHASES = 6;       // CS:0xa750/0xa758, and the weapon frame mod 6
export const AXE_BOUNCE_SFX = 0x09;

/** Nine `{vx, vy, life}` records, the companion array to a slot's projectiles. */
export const newAxeState = () =>
  Array.from({ length: MOVER_WALK }, () => ({ vx: 0, vy: 0, life: 0 }));

/**
 * CS:0xa678 — magic axe.
 * @param {(x:number,dir:number)=>boolean} wallAt  probe: is there a wall in
 *        that direction from world x? (CS:0xa5a5 right / 0xa5d9 left)
 */
export function stepMagicAxe(area, state, cam, wallAt, opts = {}) {
  const { grid = null, weapon = null } = opts;
  let moved = 0, culled = 0, bounced = 0, expired = 0, stamped = 0;
  for (let i = 0; i < MOVER_WALK; i++) {
    const p = area[i], s = state[i];
    if (!p || p.tag === 0) continue;
    const sub = p.x & 0x1f;
    /* ⚠️ The probe is GATED on the sub-tile position — outside that window the
     * axe moves without ever testing for a wall. */
    if (s.vx >= 0) {
      if (sub > 0xc && wallAt(p.x, +1)) { s.vx = -AXE_BOUNCE_VX; bounced++; }
    } else if (sub < 4 && wallAt(p.x, -1)) { s.vx = AXE_BOUNCE_VX; bounced++; }

    p.x = (p.x + s.vx) | 0;
    p.y = (p.y + s.vy) | 0;
    s.vy = Math.min(AXE_VY_CAP, s.vy + AXE_GRAVITY);      // CS:0xa703

    const sx = p.x - cam.x, sy = p.y - cam.y;
    if (sx <= CULL.xMin || sy <= CULL.yMin || sx >= CULL.xMax || sy >= CULL.yMax) {
      p.tag = 0; culled++; continue;
    }
    if (--s.life < 0) { p.tag = 0; expired++; continue; }  // CS:0xa737
    moved++;
    if (grid && weapon && grid.stamp2x2(sx, sy, p.tag)) stamped++;
  }
  return { moved, culled, bounced, expired, stamped };
}

/** CS:0xa73c-0xa762 — the sprite for record `i`; `phase` is the loop counter 8-i. */
export const axeSprite = (weaponFrame, i) =>
  AXE_SPRITE_BASE + ((weaponFrame + (MOVER_WALK - 1 - i)) % AXE_SPRITE_PHASES) + 1;

/* ── Mover 3, CS:0xa058 — the time bomb, and `dir` is a FUSE `[PROVEN]` ──
 *
 * ⚠️ For this mover the `dir` word is not a direction at all — it is a
 * countdown, decremented once per tick in the shared tail:
 *
 *   A261  dec word [di+0x6]
 *   A06B  cmp dx,0 / jns fly / jmp 0xa273     ; negative -> EXPLODE
 *   A273  cmp dx,-1 / jz  0xa27b              ; exactly -1 is the trigger
 *   A27C  sfx 0x22 ; si = 0x8eda ; cx = 0x0a  ; ten fragments
 *
 * Its spawn handler seeds 0x2f = 47, so the fuse is 47 ticks ~ 3.1 s at 15 Hz.
 * The sprite is `0x153 + (fuse & 3)` and 0x153 is 339 = PINNED_SPRITE[1], the
 * time bomb's own descriptor — a second routine agreeing with the pinned
 * table without reading it.
 *
 * This is why `dir` cannot have a global meaning: 0x2f is a fuse here, an
 * index into a 6-entry velocity table for the common mover, and a packed
 * signed velocity pair for the hunter. Three encodings, one field.
 *
 * Flight uses the globals DS:0x1c8 (vx), DS:0x1ca (vy), DS:0x1cc (state), not
 * per-projectile storage — safe because the time bomb's max-shots is 1.
 *
 *   gravity   A0A8  inc [0x1ca] capped at 4, ONLY when (fuse + 2) & 3 == 0
 *   vx decay  A130  dec [0x1c8] every 4th tick, toward zero
 *   wall      A16C  neg word [0x1c8]      <- NEGATES, unlike the axe's fixed 4
 *   land      A234  and bx,~0xf ; [0x1ca] = 0 ; [0x1cc] = 0x64
 *
 * ⚠️ The wall probe rounds x with `add cx,0xf` (CS:0xA139), not the `+8` the
 * terrain-stop path uses and not a plain floor. Three roundings in this file.
 */
export const FUSE_START = 0x2f;           // 47 ticks ~ 3.1 s
export const FUSE_EXPLODE = -1;           // CS:0xa273 `cmp dx,0xffff / jz`
export const BOMB_FRAGMENTS = 10;         // CS:0xa286 `mov cx,0x0a`
export const BOMB_SPRITE_BASE = 0x153;    // 339 = PINNED_SPRITE[1]
export const BOMB_GRAVITY_CAP = 4;        // CS:0xa0ac
export const BOMB_LANDED = 0x64;          // CS:0xa240

/* DS:0xdf2c — 24 signed bytes, the damped settling bounce after landing.
 * Four arcs of falling amplitude: 9 entries peaking at 4, then 7 at 3, then
 * 5 at 2, then 3 at 1. Indexed by DS:0x1cc, which resets to 0 past 23. */
export const BOMB_BOUNCE = [
  -4, -3, -2, -1, 0, 1, 2, 3, 4,
  -3, -2, -1, 0, 1, 2, 3,
  -2, -1, 0, 1, 2,
  -1, 0, 1,
];

/** CS:0xa058 — one tick. `state` carries the three globals for this slot. */
export function stepTimeBomb(p, state, cam, wallAt) {
  if (!p || p.tag === 0) return { status: 'empty' };
  if (p.dir < 0) {                                    // CS:0xa06b
    return { status: p.dir === FUSE_EXPLODE ? 'explode' : 'spent',
             fragments: p.dir === FUSE_EXPLODE ? BOMB_FRAGMENTS : 0 };
  }
  if (state.phase < 0) {                              // still flying
    if (((p.dir + 2) & 3) === 0) {                    // CS:0xa0a0 — every 4th tick
      state.vy = Math.min(BOMB_GRAVITY_CAP, state.vy + 1);
    }
    p.y += state.vy;
    if (((p.dir) & 3) === 0) {                        // CS:0xa12b — vx decays
      state.vx += state.vx > 0 ? -1 : (state.vx < 0 ? 1 : 0);
    }
    p.x += state.vx;
    if (wallAt && wallAt(p.x, p.y)) { state.vx = -state.vx; }   // CS:0xa16c
    if (state.landed) {                               // CS:0xa234
      p.y &= ~0xf; state.vy = 0; state.phase = BOMB_LANDED;
    }
  } else if (state.phase === BOMB_LANDED) {           // CS:0xa1d7 — just landed
    state.phase = 0; p.y -= 4;
  } else {                                            // the settling bounce
    p.y += BOMB_BOUNCE[state.phase];
    state.phase = state.phase + 1 >= BOMB_BOUNCE.length ? 0 : state.phase + 1;
  }
  p.dir -= 1;                                         // CS:0xa261 — the fuse
  return { status: 'fly', sprite: BOMB_SPRITE_BASE + (p.dir & 3) };
}

/* ── The hunter's steering, CS:0x9f61 — `UNKNOWN_hunter_turn` CLOSED ─────
 *
 * Per axis, per tick: step the velocity by the turn rate toward the target
 * and clamp to [-6, +6]. The target is offset by +6 on both axes first
 * (CS:0x9f55/0x9f5b), so the hunter aims at a point inside the creature.
 *
 *   9F61  cmp ax,[ss:0x420] / jl 0x9f72     ; left of target -> accelerate right
 *   9F68  sub cx,bp                          ; else decelerate
 *   9F6A  cmp cx,-6 / jnl done
 *   9F6F  mov cx,-6
 *   9F72  add cx,bp                          ; <-- FALLS THROUGH from the clamp
 *   9F74  cmp cx,6 / jng done / mov cx,6
 *
 * ⚠️ THE LOW CLAMP FALLS THROUGH INTO THE INCREMENT. Writing this as a plain
 * `clamp(v - rate, -6, 6)` is wrong: when the subtraction would pass -6 the
 * original pins it to -6 and then ADDS the rate back, landing on -6 + rate.
 * With rate 1 the leftward speed alternates -6, -5, -6, -5 forever rather
 * than sitting at -6. Same on the Y axis (CS:0x9f83-0x9f94).
 *
 * The write-back independently confirms the packed layout decoded earlier
 * from the read side: `9F9D mov [di+7],cl` puts vx in the HIGH byte and
 * `9FA0 mov [di+6],dl` puts vy in the LOW one.
 *
 * ⚠️ Its cull is NOT the common mover's, on either bound or effect:
 *   9FB3  cmp ax,0x140 / jg      ; (-16, 320], vs the common (-32, 320)
 *   9FC3  cmp bx,-16  / jl
 * and off-screen only SKIPS the stamp and draw (jumps to 0x9fd9) — it does
 * not despawn. A hunter that leaves the screen keeps flying and can come
 * back. UNKNOWN_hunter_negative_tag: CS:0x9fc8 negates a negative tag around
 * the stamp and restores it, which is not modelled here.
 */
export const HUNTER_VEL_CLAMP = 6;        // CS:0x9f6a / 0x9f74
export const HUNTER_TARGET_BIAS = 6;      // CS:0x9f55 / 0x9f5b
export const HUNTER_CULL = { xMin: -16, yMin: -16, xMax: 320, yMax: 192 };

/**
 * CS:0x9f61 — one axis of the hunter's turn. Reproduces the fall-through.
 * @param {number} v     current velocity on this axis
 * @param {number} pos   projectile position
 * @param {number} goal  target position (already biased by +6)
 * @param {number} rate  turn rate, 1 or 2
 */
export function hunterSteerAxis(v, pos, goal, rate) {
  let cx = v;
  if (pos >= goal) {                       // CS:0x9f66 `jl` skips this arm
    cx -= rate;
    if (cx >= -HUNTER_VEL_CLAMP) return cx;   // CS:0x9f6d `jnl` — done
    cx = -HUNTER_VEL_CLAMP;                   // CS:0x9f6f
    /* falls through — this is the quirk, not an oversight */
  }
  cx += rate;                              // CS:0x9f72
  return cx > HUNTER_VEL_CLAMP ? HUNTER_VEL_CLAMP : cx;
}

/** One hunter tick: steer both axes, apply, and repack into `dir`. */
export function stepHunter(p, target, rate) {
  const vel = unpackHunterVel(p.dir);
  p.x = (p.x + vel.vx) | 0;                // CS:0x9f51 — X gets the HIGH byte
  p.y = (p.y + vel.vy) | 0;                // CS:0x9f53
  const gx = target.x + HUNTER_TARGET_BIAS, gy = target.y + HUNTER_TARGET_BIAS;
  const vx = hunterSteerAxis(vel.vx, p.x, gx, rate);
  const vy = hunterSteerAxis(vel.vy, p.y, gy, rate);
  p.dir = ((vx & 0xff) << 8) | (vy & 0xff);   // CS:0x9f9d / 0x9fa0
  return { vx, vy };
}
