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
 * -> 66) calls elsewhere in the engine.
 * ⚠️ CORRECTED: this used to export the bare low byte (0x1c), but every
 * other sfx id in this port (combat.js's `KILL_SFX`/`HURT_SFX`,
 * trigger-actions.js's `SFX`, shop.js's `BUY_CONFIRM_SFX`, ...) is the FULL
 * word actually passed to `call 0x22ca`, and `audio/audio-bus.js`'s
 * `SFX_VOICES` is keyed the same way — so the bare byte silently matched no
 * voice and played nothing. */
export const FIRE_SFX = 0x041c;

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

/* The six handlers decoded here, keyed by table index. Each adjusts the
 * muzzle and then writes the same three-entry volley.
 *
 * ⚠️ 13 IS NOT 1 WITH A DIFFERENT Y. Handler 1 begins `add ax,0x10 /
 * sub bx,0xc`; handler 13 jumps PAST both to 0x98d1 after its own `sub bx,8`,
 * so it never applies the +0x10 X offset that its same-facing sibling does.
 * Mirroring 1 to build 13 puts every shot 16 px off.
 *
 * ── 10/11 — the HUNTER, CS:0x9aca (left) / CS:0x9a82 (right) ─────────────
 *
 * Same muzzle-adjust/volley-count shape as 0/1 (`dy=-0xc`, only the left arm
 * touches X, `+0x10`), but the per-entry `dir` is not a small index into
 * `DIRS` — it is the hunter's own PACKED SIGNED VELOCITY (see
 * `unpackHunterVel`), written as a literal per iteration rather than read
 * from a table:
 *
 *   9A99  mov word [di],0xb00     ; entry 0: vx=+11 (0x0b), vy=0    — straight
 *   9AAF  mov word [di],0xb07     ; entry 1: vx=+11, vy=+7          — angled down
 *   9AC5  mov word [di],0xbf9     ; entry 2: vx=+11, vy=-7 (0xf9)   — angled up
 *   (mirrored on the left arm: 0xf500 / 0xf507 / 0xf5f9, vx=-11)
 *
 * a 3-shot fan the hunter then homes out of once its mover starts steering.
 * ⚠️ Neither arm writes weapon `+0x0e` (the facing field handlers 0/1 set) —
 * a genuine asymmetry, not an oversight in this port. */
export const HANDLERS = {
  0:  { facing: -1, dx: 0,    dy: -0x0c, dirs: DIRS.left,  at: 0x9919 },
  1:  { facing: +1, dx: 0x10, dy: -0x0c, dirs: DIRS.right, at: 0x98cb },
  10: { facing: -1, dx: 0x10, dy: -0x0c, dirs: [0xf500, 0xf507, 0xf5f9], at: 0x9aca },
  11: { facing: +1, dx: 0,    dy: -0x0c, dirs: [0x0b00, 0x0b07, 0x0bf9], at: 0x9a82 },
  12: { facing: -1, dx: 0,    dy: -0x08, dirs: DIRS.left,  at: 0x996a },
  13: { facing: +1, dx: 0,    dy: -0x08, dirs: DIRS.right, at: 0x9964 },
  /* 14/15 — the magic axe. `dir` written is {1,0,2} for BOTH facings (it
   * drives nothing — see the state-seeding note near stepMagicAxe), and dx/dy
   * are also NOT mirrored by facing, unlike every other pair: both handlers
   * open `add ax,0x10 / sub bx,0x10`. See `spawnAxeVolley`, not `spawnVolley`
   * — this pair also seeds a companion state slot per entry. */
  14: { facing: -1, dx: 0x10, dy: -0x10, dirs: [1, 0, 2], at: 0x9bc1 },
  15: { facing: +1, dx: 0x10, dy: -0x10, dirs: [1, 0, 2], at: 0x9b15 },
  /* 2/3 — the FIREBALL, CS:0x99D7 (left) / CS:0x996F (right). The ordinary
   * three-entry volley and +0x0e facing write, plus one extra store per
   * entry: DS:0xDEFC[tag - [0x340] - 1] := 0xFFFA (-6) — the wobble word
   * mover 1 (stepFireball) adds to Y and then increments, so a fireball
   * starts climbing 6 px/tick and arcs over. The muzzle adjust is NOT a
   * mirror pair: left `add ax,0x10 / sub bx,6`, right `add bx,5` (no X).
   * [PROVEN] live: PJOYL2 (world 2's shop buys fireballs). */
  2:  { facing: -1, dx: 0x10, dy: -6, dirs: DIRS.left,  at: 0x99d7, wobbleSeed: -6 },
  3:  { facing: +1, dx: 0,    dy: +5, dirs: DIRS.right, at: 0x996f, wobbleSeed: -6 },
  /* 6/7 — the SPEAR, CS:0x9A48 (left: `sub bx,4 / sub ax,0x18 / jmp
   * 0x991c`) and CS:0x9A42 (right: `sub bx,4 / jmp 0x98d1`) — the common
   * left/right bodies with their own muzzle offsets, like 12/13. */
  6:  { facing: -1, dx: -0x18, dy: -4, dirs: DIRS.left,  at: 0x9a48 },
  7:  { facing: +1, dx: 0,     dy: -4, dirs: DIRS.right, at: 0x9a42 },
};

/* Handlers 2/3 and 6/7 are not decoded. Shipped weapons reference 2/3
 * (fireball) and 6/7 (spear). ⚠️ CORRECTION — this line used to read "8/9
 * (hunter), 10/11 (time bomb)", backwards from the table this project's own
 * CLAUDE.md records elsewhere (time bomb 8/9, hunter 10/11) and from what
 * CS:0x9a82/0x9aca actually decode to (the 3-shot fan above, matching the
 * hunter's own documented mover). It also used to list 14/15 (magic axe)
 * here — those are decoded too now, see HANDLERS[14]/[15] above.
 * UNKNOWN_projectile_handlers stands for 2/3, 6/7 only — 8/9 (time bomb) is
 * decoded too, a later pass, but through `spawnTimeBombVolley` rather than
 * this table: its muzzle offset and initial vx differ by facing in a shape
 * `HANDLERS`'s uniform `{dx, dy, dirs}` record can't express (see that
 * function's own citation). */
export const DECODED_HANDLERS = [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

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
 * CS:0x9A82 (right) / CS:0x9ACA (left) — the hunter's OWN spawn, distinct
 * from `spawnVolley` in exactly one respect: the tag is written NEGATIVE
 * from birth (`neg dx` then `dec dx` per entry, CS:0x9A84/0x9A8E/0x9AA3/
 * 0x9AB6 etc.), which is what routes a fresh shot into the ballistic-
 * launch/coast phase (`stepHunterCoast`, below) on its very first tick
 * instead of the search+steer path — `CS:0x9EFA`'s own dispatch reads a
 * negative tag as "not yet homing". Everything else (muzzle, dirs table,
 * volley count) is identical to `spawnVolley`.
 * @returns {{entries:Array, facing:number}}
 */
export function spawnHunterVolley(st, handler, tag, x, y) {
  const h = HANDLERS[handler];
  if (!h || (handler !== 10 && handler !== 11)) {
    throw new Error(`spawnHunterVolley called with non-hunter handler ${handler}`);
  }
  const px = (x + h.dx) & 0xffff;
  const py = (y + h.dy) & 0xffff;
  const entries = [];
  for (let i = 0; i < volleySize(st); i++) {
    entries.push({ tag: -((tag + i) & 0xffff), x: px, y: py, dir: h.dirs[i] });
  }
  return { entries, facing: h.facing };
}

/**
 * CS:0x9b15 (right) / CS:0x9bc1 (left) — the magic axe's own spawn, which
 * ALSO seeds a `{vx, vy, life}` state record per entry (see `stepMagicAxe`).
 * `vy` is read from the LIVE `PROJECTILE_VELOCITY` table (the weapon-arc
 * potions can have swapped it), not a baked constant — the original reads
 * the same mutable `DS:0xdf0e` words the common mover's dir lookup does.
 *
 * @returns {{entries:Array, states:Array<{vx,vy,life}>, facing:number}}
 */
export function spawnAxeVolley(st, handler, tag, x, y) {
  const h = HANDLERS[handler];
  if (!h) throw new Error(`axe handler ${handler} is not 14 or 15`);
  const px = (x + h.dx) & 0xffff;
  const py = (y + h.dy) & 0xffff;
  const entries = [], states = [];
  for (let i = 0; i < volleySize(st); i++) {
    const dir = h.dirs[i];
    entries.push({ tag: (tag + i) & 0xffff, x: px, y: py, dir });
    states.push({ vx: h.facing > 0 ? AXE_BOUNCE_VX : -AXE_BOUNCE_VX,   // 9B52/0x9BFE
                  vy: PROJECTILE_VELOCITY[dir].vy,                     // 9B59 et al.
                  life: 0x32 });                                       // 9B62 — 50
  }
  return { entries, states, facing: h.facing };
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
 *   A7F6  push ax / mov ax,0x21d / call 0x22ca / pop ax   ; play sfx 0x21d
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
/* ⚠️ CORRECTED — this used to be the bare low byte 0x1d, which never
 * matched any SFX_VOICES key and would have silently played nothing the
 * moment it was wired. `CS:0xA7F7 mov ax,0x21d` is the FULL word actually
 * passed to `call 0x22ca`, matching this port's own convention (every
 * other exported id here is the full word — see FIRE_SFX's own citation
 * for the identical bug, caught first). Fixed in Gods/docs/combat-and-
 * projectiles.md's own citation too. */
export const TERRAIN_SFX = 0x021d;
/* Moved to game/destructible.js, which now owns the whole mechanism; re-
 * exported here so the old import path keeps working and there is exactly ONE
 * definition rather than two that can drift apart. */
export { DESTRUCTIBLE_TILE } from './destructible.js';
export const DESTRUCTIBLE_MIN_WORLD = 3;

/* ── CS:0x9d74 — the common mover's OWN sprite-frame stepper `[PROVEN]` ───
 *
 * This is what makes a spinning weapon (the knife, throwing star, axe, mace —
 * anything with a nonzero frameCount) visibly rotate, and it was the one
 * piece of the common mover left unported: UNKNOWN_projectile_frame.
 *
 * ⚠️ IT RUNS ONCE PER CALL TO THE MOVER, NOT ONCE PER LIVE PROJECTILE. The
 * nine-record walk (CS:0x9c70..0x9d6a) loops back on itself via `LOOP`; only
 * once CX reaches 0 does execution fall through to this tail:
 *
 *   9D74  cx = [si+4]                 ; weapon.frame (the CURRENT value —
 *                                      ; every live shot of this weapon drew
 *                                      ; from this SAME shared field a moment
 *                                      ; ago, in the per-record loop above)
 *   9D77  cmp word[si+0xe],0 / js 9D89 ; facing < 0 (left) -> DECREMENT path
 *   9D7D  inc cx
 *   9D7E  cmp cx,[si+0x1c] / jle 9D85  ; <= frameCount -> keep
 *   9D83  xor cx,cx                    ; else wrap to 0
 *   9D85  [si+4] = cx / ret
 *   9D89  dec cx
 *   9D8A  jns 9D85                     ; >= 0 -> keep
 *   9D8C  cx = [si+0x1c]               ; else wrap to frameCount
 *
 * So the weapon's frame free-runs 0..frameCount (inclusive), incrementing
 * while the weapon last fired RIGHT and decrementing while it last fired
 * LEFT (facing is written back by the spawn handler itself, CS:0x98EA /
 * 0x9935 — see spawnVolley's `facing` return and Arsenal.emit in
 * hero-fire.js). It advances EVERY TICK THE MOVER RUNS, whether or not any
 * projectile of this weapon is currently live — there is no gate on it.
 *
 * It runs ONLY for the common mover (weapon +0x1A == 0): CS:0x9D74 sits
 * inside THIS function's own body, reached solely by falling out of ITS
 * loop. The fireball (CS:0x9d97) has its own, unrelated frame stepper
 * (`CL = ([si+4] + [si+0xe]) & 3`, see FIREBALL_FRAMES) and the others are
 * unread — a shared "step the frame" helper across movers would be wrong. */
export function stepMoverFrame(w) {
  if (w.facing < 0) {                          // CS:0x9d7b `js`
    w.frame -= 1;                              // CS:0x9d89
    if (w.frame < 0) w.frame = w.frameCount;   // CS:0x9d8a/0x9d8c
  } else {
    w.frame += 1;                              // CS:0x9d7d
    if (w.frame > w.frameCount) w.frame = 0;   // CS:0x9d7e/0x9d81/0x9d83
  }
}

/**
 * CS:0x9CC9-0x9CE3 — the sprite a live common-mover projectile draws THIS
 * tick, staged inside the same per-record loop that moves it (immediately
 * before the draw-style dispatch), so every port render pass can reproduce
 * it without re-deriving the branch:
 *
 *   9CC9  cmp word[si+0xe],0 / jns 9CDD      ; facing >= 0 (right) -> primary
 *   9CCF  cmp word[si+0x1e],0 / jz 9CDD      ; facing < 0 but NO second
 *                                             ; descriptor -> also primary
 *   9CD5  dx = [si+0x1e] + [si+4]            ; facing < 0 AND sprite2 != 0
 *   9CDD  dx = [si+4] + [si+0xc]             ; primary: sprite + frame
 *
 * Most weapons have no `sprite2` (PINNED_SPRITE2 is 0 for 9 of 11, knife
 * included), so this collapses to `sprite + frame` regardless of facing —
 * consistent with a rotating sprite sheet needing no mirrored half, unlike
 * the two directional weapons (lightning bolt, spear) that DO carry one.
 */
export function projectileSprite(w) {
  if (w.facing < 0 && w.sprite2) return w.sprite2 + w.frame;   // CS:0x9cd5
  return w.sprite + w.frame;                                   // CS:0x9cdd
}

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
  /* CS:0x9d74 — runs ONCE per call, unconditionally, after the nine-record
   * walk above (see stepMoverFrame's own header). ⚠️ Gated on `weapon.mover
   * === 0` rather than assumed: Arsenal.step() (hero-fire.js) currently
   * routes every non-hunter, non-magic-axe slot through THIS function,
   * including weapons whose real mover is the fireball's or the time bomb's
   * own (neither is wired into Arsenal.step() yet) — calling this tail for
   * one of those would advance a frame CS:0x9d74 never actually reaches for
   * them in the original. */
  if (weapon && weapon.mover === 0) stepMoverFrame(weapon);
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
 * CS:0xA7EF-0xA85B, the solid-cell end of CS:0xa7b6, shared by every mover
 * that calls it (the common stamp, the fireball CS:0x9E0B and the hunter
 * CS:0x9FCF/0x9FD6): a 0x6D block in world >= 3 takes the hit (CS:0xA810),
 * the clink 0x21D plays (CS:0xA7F6) and a debris puff spawns (CS:0xA816) —
 * the last two through the caller's `hits` — and the shot is consumed
 * (CS:0xA85B). Returns whether a block was hit.
 */
export function terrainStop(p, row, col, o, hits) {
  let broke = false;
  if (o.blocks && o.planeA) {
    const idx = row * 128 + col;
    if (o.blocks.breakable(o.planeA, idx)) { o.blocks.hit(idx, o.weaponIndex, o.pickupCount); broke = true; }
  }
  p.tag = 0;
  hits.push({ x: p.x, y: p.y });
  return broke;
}

/**
 * CS:0x9d97 — fireball. Same 9 records at stride 8, same velocity table, plus
 * the accumulator. `record` is the projectile's index within its slot.
 */
export function stepFireball(area, cam, wobble, opts = {}) {
  const { grid = null, weapon = null, planeB = null } = opts;
  let moved = 0, culled = 0, stamped = 0, hitTerrain = 0, brokeBlocks = 0;
  const hits = [];
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
      if (planeB[row * 128 + col] === 1) {
        if (terrainStop(p, row, col, opts, hits)) brokeBlocks++;
        hitTerrain++;
        continue;
      }
    }
    if (grid.stamp2x2(sx, sy, p.tag)) stamped++;
  }
  return { moved, culled, stamped, hitTerrain, brokeBlocks, hits };
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
 * CS:0x9e36 then walks that list and takes the entry with the LARGEST key.
 *
 * ⚠️ CORRECTION — an earlier revision of this file (and of the reverse-
 * engineering notes it was ported from) said "the SMALLEST key", read off
 * `cmp dx,[si] / jnl skip`. Re-read with a concrete trace rather than from
 * the mnemonics alone: `dx` (the running best) starts at `0xFFFF` (signed
 * -1), the lowest value any real key can beat, and `JNL`/`JGE` SKIPS
 * (keeps the old best) exactly when `dx >= [si]` — i.e. it REPLACES only
 * when `dx < [si]`, which walks the running best UP toward the largest key
 * seen, not down toward the smallest. Traced concretely against keys
 * `[5, 3]` in scan order: record 1 (key 5) always wins the first compare
 * (`-1 < 5`); record 2 (key 3) then loses (`5 >= 3`, skip) — final best is
 * 5, the larger of the two, not 3.
 *
 *   9E37  cl = [0x33c]              ; count-1
 *   9E3B  si = 0x8c52 ; dx = 0xffff ; best := -1 (beaten by any real key)
 *   9E45  add si,6                  ; advance FIRST, so the first read is 0x8c58
 *   9E48  cmp cl,0 / js done
 *   9E4F  cmp dx,[si] / jge skip    ; skip (keep old) when dx already >= this key
 *   9E53  ax = [si-4] ; bx = [si-2] ; dx = [si]
 *   9E67  cmp dx,0 / js justReturn  ; nothing beat -1 -> no target found
 *   9E6C  mov word [bp],0           ; the WINNING record's own key is ZEROED —
 *                                   ; a second hunter shot searching the same
 *                                   ; tick finds it again but now scores worst
 *                                   ; (0), so it prefers an unclaimed target
 *
 * So the hunter chases whichever creature the scan ranked HIGHEST (per this
 * project's separate finding that the key is the entity's own current
 * sprite id — an authoring-order artifact, not a threat/distance score), and
 * it can only ever chase creatures the scan actually visited THIS frame.
 * Ordering matters: run the mover before the scan and the list is last
 * frame's — which is also what the ORIGINAL does: CS:0x021E (the list-count
 * reset) sits AFTER CS:0x020F (the projectile/hunter step) and BEFORE
 * CS:0x0285 (the scan that rebuilds it), so the hunter always reads the
 * PREVIOUS tick's list by design, not a bug to route around.
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
 * so a more-upgraded hunter turns faster. ⚠️ CORRECTION: `UNKNOWN_hunter_turn`
 * is CLOSED (see the steering section further down this file) — the steering
 * arithmetic past CS:0x9f5b IS ported, as `hunterSteerAxis`/`stepHunter`/
 * `stepHunterArray`, not just the target selection and velocity decode.
 */
export const TARGET_LIST_DS = 0x8c52;
export const TARGET_LIST_START = 0x8c54;
export const TARGET_STRIDE = 6;
export const hunterTurnRate = (st) => Math.min(2, Math.max(1, st.count - st.base - 2));

/**
 * CS:0x9e36 — the creature with the LARGEST key, or null (see the correction
 * above). `list` mutates: the winning entry's key is zeroed in place
 * (CS:0x9e6c), the same "consume the target" step the original does, so a
 * second hunter shot searching the same array this tick scores that entry
 * worst rather than re-picking it.
 */
export function pickTarget(list) {
  let best = null, key = -1;         // CS:0x9e3e — the sentinel any real key beats
  for (const t of list) if (t.key > key) { key = t.key; best = t; }
  if (best) best.key = 0;            // CS:0x9e6c
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
 * Vertical — gravity is `+2`, and a result above 8 has the 2 taken back, so
 * an ODD velocity settles at 7 and an even one at 8 (not a clamp to 8 — the
 * PJOYL2 capture shows a +7 axe). A third distinct rule after the hero's
 * (`4 + v`, cap 10), the enemy's (`v` then `++`, cap 16) and the time bomb's
 * (`++`, cap 4).
 *
 *   A703  add cx,0x2 / cmp cx,8 / jng / sub cx,0x2
 *
 * It also BOUNCES OFF FLOORS [PROVEN] against PJOYL2 (236 -> 240 -> 232 -> 226):
 *   A6DA  vy < 0 -> gravity
 *   A6DF  call 0xa60c   ; cell below the NEW position, (x&~31, y&~15)+0x80 == 1?
 *   A6E4  cmp byte [si],1 / jz gravity   ; not while inside a solid cell
 *   A6EA  y &= 0xfff0 ; dl = 1 ; vy = -vy (0 -> -4) ; sfx 0x209 ; no gravity
 * and `dl` makes that tick's sprite the bare 0x1aa (CS:0xA73F).
 *
 * Lifetime: `A737 dec word [si+0x4] / js` — expiry calls CS:0xa633 and then
 * despawns. Sprite: `0x1aa + ((weaponFrame + phase) mod 6) + 1`, and 0x1aa is
 * 426 — exactly PINNED_SPRITE[9], the magic axe's own descriptor, which is an
 * independent check on the pinned table. Bounces play sfx 0x09 (CS:0xa7ad).
 *
 * ── The wall probes, CS:0xA5A5 (right) / CS:0xA5D9 (left) — decoded ───────
 *
 * Both take X AND Y (the mover passes both — an earlier revision of this
 * port's `wallAt(x, dir)` signature dropped Y, which cannot reproduce this):
 * the tile cell is the usual `0x5004 + (x&~0x1f)>>5 + ((y&~0xf)<<3)`, and
 * which NEIGHBOUR cell gets tested depends on the Y sub-tile position —
 *
 *   A5C6  and bx,0xf / jz 0xa5d2        ; y on a tile boundary -> same row only
 *   A5CB  cmp byte [si+0x81],1 / jz     ; sub-tile y: one row DOWN, one col
 *                                       ;   over first; a hit returns
 *   A5D2  cmp byte [si+0x1],1           ; then the SAME row, one col over
 *   (mirrored on the left at si-1 / si+0x7f)
 *
 * — a diagonal look-ahead AND the same row (the diagonal miss falls through
 * to CS:0xA5D2), not a same-row-only probe. `ZF` on return is the
 * test result (byte == 1 -> wall); the caller's own `jnz` after the call
 * reads "not a wall -> keep flying".
 *
 * ── The spawn handlers, table indices 14 (left, CS:0x9bc1) / 15 (right,
 * CS:0x9b15) — decoded ─────────────────────────────────────────────────
 *
 * Same muzzle/volley-count shape as every other handler, `dy = -0x10` (twice
 * the common `-0xc`), and `dir` written to the projectile is `{1, 0, 2}` for
 * BOTH facings — unlike every other handler pair, which mirrors `dir` by
 * facing. That is because `dir` is otherwise unread here (`stepMagicAxe`
 * never touches `p.dir`; movement comes entirely from the paired state
 * record below), so there is nothing to mirror.
 *
 * What actually matters: each of the (up to 3) entries ALSO seeds a slot in
 * the SAME `DS:0xdec6` state array the mover reads, at an index computed
 * from the entry's own TAG (`(tag - 1) mod 9`-shaped, via two `cmp/sub 9`
 * folds) — which lands on the exact array position the mover will later
 * index by loop position, since the tag numbering and the record's physical
 * slot share the same numbering:
 *
 *   9B40  [di]=tag(dx) / [di+2]=x(stosw) / [di+4]=y(bx) / [di+6]=dir(1/0/2)
 *   9B52  [si]=4               ; state.vx := 4 (RIGHT); LEFT (0x9bfe) writes -4
 *   9B59  cx=[0xdf14] ; [si+2]=cx     ; state.vy := PROJECTILE_VELOCITY[dir].vy
 *   9B62  [si+4]=0x32          ; state.life := 50
 *
 * ⚠️ `DS:0xdf14` etc. are read straight out of the SAME mutable velocity
 * table `PROJECTILE_VELOCITY` already documents (the three weapon-arc
 * potions overwrite it) — so a fired axe's initial arc, not just its later
 * homing... no, the axe never homes, but its initial `vy` genuinely tracks
 * whichever arc potion is active at the moment it's thrown. This port must
 * read the table live at spawn time, not bake a constant.
 *
 * `UNKNOWN_axe_debris` — CLOSED alongside the general debris pass: on
 * expiry (`A737 dec word [si+0x4] / js 0xa799`), `CS:0xA7A1 call 0xa633`
 * drops a debris spark carrying the axe's OWN current velocity (`cx=[si]`,
 * `dx=[si+2]`, the state record's vx/vy) at its current position — a moving
 * spark, like the hunter's no-target one, not a stationary puff. */
export const AXE_STATE_DS = 0xdec6;
export const AXE_STATE_STRIDE = 6;        // CS:0xa77d
export const AXE_BOUNCE_VX = 4;           // CS:0xa6a9 / 0xa6c4
export const AXE_GRAVITY = 2;             // CS:0xa703
export const AXE_VY_CAP = 8;              // CS:0xa706
export const AXE_SPRITE_BASE = 0x1aa;     // 426
export const AXE_SPRITE_PHASES = 6;       // CS:0xa750/0xa758, and the weapon frame mod 6
/* ⚠️ CORRECTED — same bug class as TERRAIN_SFX above (and FIRE_SFX before
 * both): this used to be the bare low byte 0x09. `CS:0xa7ae mov ax,0x209`
 * is the full word `call 0x22ca` actually receives (`CS:0xa7ad` itself is
 * only the `push ax` guarding the call, not the id). Fixed in Gods/docs/
 * combat-and-projectiles.md's own citation too. */
export const AXE_BOUNCE_SFX = 0x0209;

/** Nine `{vx, vy, life}` records, the companion array to a slot's projectiles. */
export const newAxeState = () =>
  Array.from({ length: MOVER_WALK }, () => ({ vx: 0, vy: 0, life: 0 }));

/**
 * CS:0xA5A5 (right, dirSign>0) / CS:0xA5D9 (left, dirSign<0) — the axe's own
 * wall probe. NOT the common mover's floored single-cell test: which
 * neighbour cell is tested depends on the Y sub-tile position, so a probe
 * that only takes X (as an earlier revision of this port's `wallAt` did)
 * cannot reproduce it.
 */
export function axeWallAt(x, y, dirSign, planeB) {
  if (!planeB) return false;
  const col = (x & ~0x1f) >> 5, row = (y & ~0xf) >> 4;
  if (col < 0 || col > 127 || row < 0 || row > 63) return false;
  const idx = row * 128 + col;
  const ySub = y & 0xf;
  const at = (off) => {
    const j = idx + off;
    return j >= 0 && j < planeB.length && planeB[j] === 1;
  };
  /* ⚠️ With a sub-tile Y the diagonal cell is tested FIRST and, if it is
   * not solid, the probe FALLS THROUGH to the same-row cell (CS:0xA5D0 `jz`
   * skips only on a hit). Testing the diagonal alone missed PJOYL2's wall at
   * cursor 1636. */
  return dirSign > 0
    ? ((ySub !== 0 && at(129)) || at(1))     // CS:0xA5CB (+0x81), then 0xA5D2 (+0x1)
    : ((ySub !== 0 && at(127)) || at(-1));   // CS:0xA5FF (+0x7f), then 0xA605 (-0x1)
}

/**
 * CS:0xa678 — magic axe.
 * @param {(x:number,y:number,dirSign:number)=>boolean} wallAt  the diagonal
 *        look-ahead probe above — pass `axeWallAt` bound to a `planeB`, or
 *        an equivalent.
 * @param {?object} debris  the DS:0x8b4c owner — CS:0xA7A1 drops a moving
 *        spark into it on expiry, carrying the axe's own current velocity.
 */
export function stepMagicAxe(area, state, cam, wallAt, opts = {}) {
  const { grid = null, weapon = null, debris = null } = opts;
  let moved = 0, culled = 0, bounced = 0, expired = 0, stamped = 0;
  for (let i = 0; i < MOVER_WALK; i++) {
    const p = area[i], s = state[i];
    if (!p || p.tag === 0) continue;
    const sub = p.x & 0x1f;
    /* ⚠️ The probe is GATED on the sub-tile position — outside that window the
     * axe moves without ever testing for a wall. */
    if (s.vx >= 0) {
      if (sub > 0xc && wallAt(p.x, p.y, +1)) { s.vx = -AXE_BOUNCE_VX; bounced++; }
    } else if (sub < 4 && wallAt(p.x, p.y, -1)) { s.vx = AXE_BOUNCE_VX; bounced++; }

    p.x = (p.x + s.vx) | 0;                               // CS:0xA6CE
    let ny = (p.y + s.vy) | 0;                            // CS:0xA6D0
    p.landed = false;
    const cellAt = (x, y) => {
      const i = ((y & ~0xf) >> 4) * 128 + ((x & ~0x1f) >> 5);
      return opts.planeB && i >= 0 && i < opts.planeB.length ? opts.planeB[i] : 0;
    };
    if (s.vy >= 0 && cellAt(p.x, ny + 16) === 1 && cellAt(p.x, ny) !== 1) {   // A6DA-A6E7
      ny &= 0xfff0;                                       // A6EA
      s.vy = -s.vy;                                       // A6EF
      if (s.vy === 0) s.vy -= 4;                          // A6F7-A6FC
      p.landed = true;                                    // A6ED `mov dl,1`
      bounced++;                                          // A6F1 sfx 0x209
    } else {
      s.vy += AXE_GRAVITY;                                // CS:0xA703
      if (s.vy > AXE_VY_CAP) s.vy -= AXE_GRAVITY;         // CS:0xA706-0xA70B
    }
    p.y = ny;
    const sx = p.x - cam.x, sy = p.y - cam.y;
    if (sx <= CULL.xMin || sy <= CULL.yMin || sx >= CULL.xMax || sy >= CULL.yMax) {
      p.tag = 0; culled++; continue;
    }
    if (--s.life < 0) {                                    // CS:0xa737
      if (debris) debris.spawn(p.x, p.y, s.vx, s.vy);       // CS:0xA7A1
      p.tag = 0; expired++; continue;
    }
    moved++;
    if (grid && weapon && grid.stamp2x2(sx, sy, p.tag)) stamped++;
  }
  return { moved, culled, bounced, expired, stamped };
}

/** CS:0xa73c-0xa762 — the sprite for record `i`; `phase` is the loop counter 8-i. */
export const axeSprite = (weaponFrame, i, landed = false) =>
  landed ? AXE_SPRITE_BASE
         : AXE_SPRITE_BASE + ((weaponFrame + (MOVER_WALK - 1 - i)) % AXE_SPRITE_PHASES) + 1;

/* ── Mover 3, CS:0xa058 — the time bomb, and `dir` is a FUSE `[PROVEN]` ──
 *
 * ⚠️ For this mover the `dir` word is not a direction at all — it is a
 * countdown, decremented once per tick in the shared tail:
 *
 *   A261  dec word [di+0x6]
 *   A06B  cmp dx,0 / jns fly / jmp 0xa273     ; negative -> EXPLODE
 *   A273  cmp dx,-1 / jz  0xa27b              ; exactly -1 is the trigger
 *   A27C  sfx 0x1022 ; si = 0x8eda ; cx = 0x0a  ; ten fragments
 *
 * ⚠️ **CORRECTED, a later session (a Ghidra re-read while wiring this mover
 * into `Arsenal.step()`).** This used to read "sfx 0x22" — unlike every other
 * bare-low-byte citation in this file, that one was never actually re-checked
 * against a fresh `MOV AX,imm` read. `CS:0xA27C` is `mov ax,0x1022`: the FULL
 * word passed to `call 0x22ca` is **`0x1022`**, not `0x22`. Corrected here and
 * in `Gods/docs/combat-and-projectiles.md`.
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
 * per-projectile storage — safe because the time bomb's max-shots is 1. The
 * spawn (CS:0x9A54-0x9A60) sets vx = +-4, vy = 0, [0x1cc] = -1.
 *
 * ⚠️ **Rewritten 2026-09-28 from a read of the whole mover, CS:0xA058-0xA24D**
 * `[STATIC]`. The earlier model applied gravity, vx decay and the ground test
 * on every airborne tick and bounced forever; the bytes split on vx instead:
 *
 * vx != 0 (CS:0xA09E), the throw:
 *   A0A0  g = ((fuse + 2) & 3) == 0 ; if g: vy = min(4, vy + 1)
 *   A0B9  if (y + vy) crosses a 16-px row, test the cells at the OLD (x, y):
 *         two rows below solid and one row below open, or (x & 0x1f >= 0x10)
 *         the same pair one column right (+0x101 solid, +0x81 open) ->
 *   A0F1  LAND: y = (y + vy) & ~0xf, x unmoved, vx = vy = [0x1cc] = 0 (at
 *         rest, no settling bounce) and the thud plays at once
 *   A118  else y += vy, x += vx; vx steps toward 0 on the same g
 *         (A130 / A17D); the wall probe at the new (x, y), column rounded up
 *         when vx was >= 0 (A139 `add cx,0xf`) and down when < 0, solid at
 *         the cell or one row below -> thud, vx = -vx (A165-A16C)
 * vx == 0 (CS:0xA188):
 *   [0x1cc] < 0   A1EC  y += vy with NO gravity step, then the ordinary ground
 *                       test at the new y (A211-A232, bombGroundAt): land
 *                       with y &= ~0xf, vy = 0, [0x1cc] = 0x64 (silent)
 *   [0x1cc] == 0  A191  at rest: nothing moves
 *   [0x1cc] == 0x64     A1D7  thud, y -= 4, [0x1cc] = 1
 *   [0x1cc] 1..23       A1A1  thud when SS:0x5450[n] != 0 (n = 9, 16, 21:
 *                       the first step of arcs 2-4), y += DS:0xdf2c[n], then
 *                       [0x1cc] = n + 1, or 0 (rest) once n reached 0x17. So
 *                       entry 0 is never read and the bounce nets +4, undoing
 *                       the -4 of the landing tick.
 *
 * SS:0x5450 is initialised data in the image (file 0x249B0, the same SS
 * base as guardian4.js's SS:0x5024), not live-only state as this header
 * used to say. What detonation does (fragments, the smoke column, the area
 * kill, the hero damage) is game/bomb-blast.js.
 */
export const FUSE_START = 0x2f;           // 47 ticks ~ 3.1 s
export const FUSE_EXPLODE = -1;           // CS:0xa273 `cmp dx,0xffff / jz`
export const BOMB_FRAGMENTS = 10;         // CS:0xa286 `mov cx,0x0a`
export const BOMB_SPRITE_BASE = 0x153;    // 339 = PINNED_SPRITE[1]
export const BOMB_GRAVITY_CAP = 4;        // CS:0xa0ac
export const BOMB_LANDED = 0x64;          // CS:0xa240
export const BOMB_REST = 0;               // CS:0xa18f `jnz` not taken: nothing moves
/* SS:0x5450 (image file 0x249B0), 24 bytes: a thud on each settling arc's
 * first step. Only nonzero-ness is read (CS:0xA1A6). */
export const BOMB_THUD_AT = Object.freeze([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0,
]);
/* CORRECTED from the bare low byte `0x22` — see the header above. */
export const BOMB_DETONATE_SFX = 0x1022;  // CS:0xa27c
/* The wall bounce (CS:0xA165) and the landed->settling transition
 * (CS:0xA1D7) share this one id. */
export const BOMB_THUD_SFX = 0x0609;      // CS:0xa1d8 / 0xa165

/* DS:0xdf2c — 24 signed bytes, the damped settling bounce after landing.
 * Four arcs of falling amplitude: 9 entries peaking at 4, then 7 at 3, then
 * 5 at 2, then 3 at 1. Indexed by DS:0x1cc = 1..23; entry 0 is never read,
 * and past 23 the bomb rests. */
export const BOMB_BOUNCE = [
  -4, -3, -2, -1, 0, 1, 2, 3, 4,
  -3, -2, -1, 0, 1, 2, 3,
  -2, -1, 0, 1, 2,
  -1, 0, 1,
];

/**
 * CS:0xA1F0 (right-ward rounding) / CS:0xA181 (left-ward, no `+0xf`) —
 * the ordinary per-tick ground probe, and CS:0xA134 — the wall/ledge bounce
 * probe. Both share the `row*128+col` addressing `axeWallAt` already uses.
 */
export function bombCell(x, y, planeB) {
  const col = (x & ~0x1f) >> 5, row = (y & ~0xf) >> 4;
  if (col < 0 || col > 127 || row < 0 || row > 63) return null;
  const idx = row * 128 + col;
  const at = (off) => {
    const j = idx + off;
    return j >= 0 && j < planeB.length && planeB[j] === 1;
  };
  return at;
}

/** CS:0xA134-0xA170 — a wall (or an unsupported ledge below) bounces vx. */
export function bombWallAt(x, y, dirSign, planeB) {
  if (!planeB) return false;
  const wx = dirSign >= 0 ? (x + 0xf) & ~0x1f : x & ~0x1f;   // CS:0xA139 vs 0xA184
  const at = bombCell(wx, y, planeB);
  if (!at) return false;
  return at(0) || at(128);                                   // CS:0xA158 / 0xA15D
}

/** CS:0xA1F0-0xA248 — the ordinary per-tick landing probe. */
export function bombGroundAt(x, y, planeB) {
  if (!planeB) return false;
  const at = bombCell(x, y, planeB);
  if (!at) return false;
  if (at(128) && !at(0)) return true;                        // CS:0xA211-0xA21B
  if ((x & 0x1f) > 0xf && at(129) && !at(1)) return true;     // CS:0xA21D-0xA232
  return false;
}

/**
 * `UNKNOWN_timebomb_refire` — CLOSED, live in DOSBox. After detonation the
 * record stays allocated (so the weapon cannot re-fire) until the tick on
 * which neither a fragment (DS:0x8EDA, 10) nor a smoke puff (DS:0x8F3E, 7)
 * is still live; then `CS:0xA41C mov word [di],0` frees it. `CS:0xA289`
 * kills all 10 fragments at detonation (only the far call at `CS:0xA2A8`,
 * taken when the weapon has extra pickups, can revive them — export 36,
 * modelled in game/bomb-blast.js, which now frees the record itself; this
 * formula stays as the live measurement the simulation is checked against).
 * `CS:0xA2DC`-`0xA2FA` keeps the last n = extra+2 puffs (max 7) and
 * disables the rest; their counters start at 0, -2, -4 ... so the last kept
 * puff is live on detonation-relative ticks 2(n-1)..2(n-1)+6. The record is
 * therefore freed on tick 2(n-1)+7 after the detonation tick — 9 for a
 * plain pickup, measured live (every disabled puff's counter had advanced
 * exactly 10 times, detonation tick included, when the tag cleared).
 * @param {number} extra `st.count - st.base` ([si+8]-[si+6] at CS:0xA2E1)
 * @returns {number} ticks after the detonation tick until the record frees
 */
export function timeBombHoldTicks(extra) {
  const n = Math.min(7, Math.max(0, extra + 2));
  return n === 0 ? 0 : 2 * (n - 1) + 7;
}

/**
 * CS:0xa058 — one tick. `state` carries the three globals for this slot
 * ({phase = DS:0x1cc, vx, vy}); safe as one object per slot (not per record)
 * because the time bomb's max-shots is 1. `wallAt`/`groundAt` are
 * `bombWallAt`/`bombGroundAt`, and `cellAt(x, y)` is `bombCell` (all bound to
 * a `planeB`); each may be null, meaning open air.
 */
export function stepTimeBomb(p, state, cam, wallAt, groundAt, cellAt = null) {
  if (!p || p.tag === 0) return { status: 'empty' };
  if (p.dir < 0) {                                    // CS:0xa06b
    return { status: p.dir === FUSE_EXPLODE ? 'explode' : 'spent',
             fragments: p.dir === FUSE_EXPLODE ? BOMB_FRAGMENTS : 0,
             sfx: p.dir === FUSE_EXPLODE ? BOMB_DETONATE_SFX : null };
  }
  let sfx = null;
  if (state.vx !== 0) {                               // CS:0xa094 -> 0xa09e
    const g = ((p.dir + 2) & 3) === 0;                // CS:0xa0a0-0xa0a6
    if (g) state.vy = Math.min(BOMB_GRAVITY_CAP, state.vy + 1);
    const ny = p.y + state.vy;
    if ((ny & ~0xf) !== (p.y & ~0xf) && cellAt) {     // CS:0xa0b9-0xa0c9
      const at = cellAt(p.x, p.y);                    // SI from the OLD x, y (CS:0xa073)
      const land = at && ((at(256) && !at(128))       // CS:0xa0cb-0xa0d7
        || ((p.x & 0x1f) >= 0x10 && at(257) && !at(129)));   // CS:0xa0d9-0xa0ef
      if (land) {                                     // CS:0xa0f1-0xa115
        p.y = ny & ~0xf;
        state.vx = 0; state.vy = 0; state.phase = BOMB_REST;
        p.dir -= 1;
        return { status: 'fly', sprite: BOMB_SPRITE_BASE + (p.dir & 3), sfx: BOMB_THUD_SFX };
      }
    }
    p.y = ny;                                         // CS:0xa118
    const right = state.vx >= 0;                      // CS:0xa122 `js`, before the decay
    const nx = p.x + state.vx;                        // CS:0xa11e
    if (g) state.vx += right ? -1 : 1;                // CS:0xa130 / 0xa17d
    if (wallAt && wallAt(nx, p.y, right ? 1 : -1)) {  // CS:0xa134-0xa162
      sfx = BOMB_THUD_SFX;
      state.vx = -state.vx;                           // CS:0xa16c
    }
    p.x = nx;
  } else if (state.phase < 0) {                       // CS:0xa1ec, no gravity step
    p.y += state.vy;
    if (groundAt && groundAt(p.x, p.y)) {             // CS:0xa211-0xa232
      p.y &= ~0xf; state.vy = 0; state.phase = BOMB_LANDED;   // CS:0xa234-0xa240
    }
  } else if (state.phase === BOMB_LANDED) {           // CS:0xa1d7
    sfx = BOMB_THUD_SFX; p.y -= 4; state.phase = 1;
  } else if (state.phase !== BOMB_REST) {             // CS:0xa194-0xa1d5
    const n = state.phase;
    if (BOMB_THUD_AT[n]) sfx = BOMB_THUD_SFX;         // CS:0xa1a1-0xa1b3
    p.y += BOMB_BOUNCE[n];
    state.phase = n >= 0x17 ? BOMB_REST : n + 1;      // CS:0xa1c3-0xa1cf
  }
  p.dir -= 1;                                         // CS:0xa261 — the fuse
  return { status: 'fly', sprite: BOMB_SPRITE_BASE + (p.dir & 3), sfx };
}

/**
 * CS:0x9a51 (right) / CS:0x9a7a (left) — the time bomb's own spawn handler
 * (PWEAPONS handler indices 9/8, `Gods/docs/consumables-and-treasure.md`'s
 * "Entries 8/9" closure). Unlike the shared `spawnVolley` table, the muzzle
 * offset and the initial `state.vx` differ by facing, so this weapon needs
 * its own spawner rather than a `HANDLER_TABLE` entry.
 */
export function spawnTimeBombVolley(m, tag, right) {
  const x = right ? m.x + 0x10 : m.x;         // CS:0x9a51 — right-only muzzle nudge
  const y = (m.y - 0x20) & 0xfffc;            // CS:0x9a66/0x9a5a
  return {
    entries: [{ tag, x, y, dir: FUSE_START }],
    vx: right ? 4 : -4,                       // CS:0x9a54 / 0x9a7a
  };
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
 * back.
 *
 * ── `UNKNOWN_hunter_negative_tag` — the STAMP half, CLOSED `[PROVEN]` ────
 *
 * CS:0x9FC8, read in full:
 *
 *   9FC8  cmp word [di],0 / jns 0x9fd6      ; tag non-negative -> just stamp
 *   9FCD  neg word [di]                     ; NEGATIVE -> flip positive...
 *   9FCF  call 0xa7b6                       ; ...stamp (the SAME shared
 *   9FD2  neg word [di]                     ; terrain-aware stamp/collision
 *                                            ; routine every other mover
 *                                            ; uses)...then flip back
 *   9FD6  call 0xa7b6                       ; already non-negative -> stamp
 *
 * So the tag's SIGN is a genuine state flag distinct from its magnitude: the
 * magnitude is the ordinary 1..27 tag the shared damage grid expects, and
 * the sign is flipped to positive only for the instant `0xa7b6` needs to
 * read it, because a negative byte would corrupt the grid write and the
 * `CS:0x9320` tag decode. `CS:0xa7b6` internally re-checks `weapon+0x48`
 * (`breaksTerrain`, false for the hunter) before falling through to the
 * ordinary 2x2/3x3 stamp, so hunter shots pass through terrain and stamp the
 * grid exactly like every other weapon once the sign is normalised.
 *
 * ── The other half — WHY the tag is negative, tied to CS:0x9E9E ──────────
 *
 * `CS:0x9EFA`'s own dispatch (`cmp word [di],0 / jnz` then `js 0x9e9e`) reads
 * as: tag==0 -> empty slot; tag<0 -> `0x9e9e`; tag>=0 -> `0x9f04`, the target
 * SEARCH this file already ports (`CS:0x9e36`/`pickTarget`). The spawn
 * handlers write NEGATIVE tags from birth (`neg dx` then `dec dx` per entry
 * — see the `HANDLERS[10]`/`[11]` note above), so a fresh hunter shot's
 * FIRST tick takes the `0x9e9e` arm, not the search. That arm re-reads the
 * packed `[di+6]` velocity the spawn handler ALSO wrote as a literal (the
 * 3-shot fan), applies it as plain ballistic motion, DAMPS it toward zero
 * one unit per axis per tick (drag), and once both components reach exactly
 * zero writes the sentinel `[di+6] = 0x0f00` (unreachable by any real
 * clamped-to-±6 steered velocity) and does a SINGLE `neg word [di]` —
 * flipping the tag positive for the first time. From the NEXT tick on, tag
 * is positive, `CS:0x9EFA` routes to the search+steer path every tick
 * thereafter (nothing in that path ever re-negates it), and the hunter
 * homes for the rest of its life. So the negative tag is a genuine, but
 * TRANSIENT, "ballistic launch" phase — the 3-shot fan flies its initial
 * spread and decays before homing takes over.
 *
 * ── `UNKNOWN_hunter_ballistic_launch` — CLOSED, and now PORTED ────────────
 *
 * The re-aim/cooldown counter this file previously distrusted its own
 * reading of turned out to be a FIXED delay, not a cyclic one — CLAUDE.md's
 * own later `UNKNOWN_hunter_coast_reaim` closure traces it to the byte: the
 * `dl`-cycling input is a hardcoded literal 9 at this mover's own dispatch
 * entry (`CS:0x9EF7 mov cx,0x9`), never anything else, so `(dl+2)&3` always
 * evaluates to the same constant and the "cycling" framing was an artefact
 * of reading a general-purpose delay helper's shape without noticing its one
 * caller never varies the input. Fresh `disassemble_bytes` reads of
 * `CS:0x9E74`-`0x9E9B` (the counter/flip) and `CS:0x9E9E`-`0x9EF4` (the
 * decay) this pass confirm the exact sequence, byte for byte:
 *
 *   9E9E  ax=[di+2] bx=[di+4] cx=[di+6]        ; position, packed velocity
 *   9EA8  cmp cx,0xf00 / jge 0x9e74             ; AT the sentinel -> the counter (below)
 *   9EAE..9EBB  unpack cx=vx (HIGH), dx=vy (LOW), sign-extended
 *   9EBE  ax += cx  ; 9EC0  bx += dx            ; move FIRST, using PRE-decay velocity
 *   9EC2-9EDA  cl = decay(vx) ; dl = decay(vy)  ; toward 0 by 1, per axis (drag)
 *   9EDC  [di+2]=ax [di+4]=bx [di+7]=cl [di+6]=dl   ; write back position + decayed vel
 *   9EE8  cl|dl == 0 ? [di+6] := 0xf00 : (fall through, still coasting)   ; the sentinel
 *
 *   9E74  cx += 0x100 ; [di+6] = cx             ; the re-aim counter, +0x100/tick
 *   9E8D  cmp cx,0x1b00 / jge 0x9e94            ; 12 ticks past the sentinel (0.8s @ 15Hz)
 *   9E94  [di+6] = 0 ; neg word[di]             ; REACHED -> dir reset to 0, tag flips
 *
 * Both the decay branch and the flip branch fall through to the SAME tail
 * (`0x9fa3`, the cull+stamp code) as the ordinary steer path — a coasting
 * hunter shot is drawn and stamps the damage grid exactly like a homing one,
 * it just isn't steered yet. `stepHunterArray` below now dispatches on the
 * tag's sign every tick, matching the original's own `CS:0x9EFA` gate.
 */
export const HUNTER_COAST_SENTINEL = 0xf00;         // CS:0x9EEF/0x9EA8
export const HUNTER_COAST_TICK = 0x100;             // CS:0x9E74 `add cx,0x100`
export const HUNTER_COAST_REAIM_AT = 0x1b00;        // CS:0x9E8D — 12 ticks past the sentinel
const signed16 = (v) => (v << 16) >> 16;
const decayToZero = (v) => (v > 0 ? v - 1 : v < 0 ? v + 1 : 0);   // CS:0x9EC2-0x9EDA

/**
 * One tick of the hunter's ballistic-launch/coast phase (`p.tag < 0`).
 * @returns {boolean} true the ONE tick the tag flips positive — no motion or
 *   drag applies on that same tick (CS:0x9E94's own "search from next tick").
 */
export function stepHunterCoast(p) {
  const dir = signed16(p.dir);
  if (dir >= HUNTER_COAST_SENTINEL) {                       // CS:0x9EA8
    const next = dir + HUNTER_COAST_TICK;                    // CS:0x9E74
    if (next < HUNTER_COAST_REAIM_AT) { p.dir = next & 0xffff; return false; }   // CS:0x9E8D
    p.dir = 0;                                                // CS:0x9E94
    p.tag = -p.tag;                                           // CS:0x9E99
    return true;
  }
  const vel = unpackHunterVel(p.dir);
  p.x = (p.x + vel.vx) | 0;                                   // CS:0x9EBE
  p.y = (p.y + vel.vy) | 0;                                   // CS:0x9EC0
  const vx = decayToZero(vel.vx), vy = decayToZero(vel.vy);
  p.dir = (vx === 0 && vy === 0)
    ? HUNTER_COAST_SENTINEL                                    // CS:0x9EEF
    : (((vx & 0xff) << 8) | (vy & 0xff)) & 0xffff;              // CS:0x9EE2/0x9EE5
  return false;
}
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

/* ── CS:0xA00D — the no-target arm, and the array walk around it ─────────
 *
 * `CS:0x9F0A cmp dx,0 / jns 0x9f12 / jmp 0xa00d`: when `pickTarget()` finds
 * nothing this tick, the shot does not just idle — it drops a MOVING debris
 * spark (game/debris.js) at its CURRENT position, carrying its CURRENT
 * velocity (the same hi/lo-byte `dir` unpack `stepHunter` uses elsewhere,
 * corroborating that packing independently), and despawns:
 *
 *   A00D  si = 0x8b4c ; walk to a free debris slot ; store {x, y}
 *         then the velocity from the SAME hi/lo split as CS:0x9F41
 *   (the record's own tag is cleared by the caller on return)
 *
 * This bail happens BEFORE any position update this tick, so the spark
 * lands at last tick's resting spot, not a moved one.
 */
export const HUNTER_NO_TARGET_AT = 0xa00d;

/**
 * CS:0x9EF7's outer walk. Dispatches on the tag's sign exactly like
 * `CS:0x9EFA`: negative -> `stepHunterCoast` (the ballistic-launch/coast
 * phase, above); positive -> the ordinary search+steer. BOTH arms fall
 * through to the SAME cull+stamp tail (`0x9fa3` in the original), since a
 * coasting shot is still drawn and still stamps the damage grid — it just
 * hasn't started homing yet.
 *
 * @param {Array} area     the 9-slot projectile area (this weapon's own)
 * @param {{count:number, base:number}} st  for the turn rate
 * @param {Array} targets  the hunter target list — MUTATED (see pickTarget)
 * @param {{x:number,y:number}} cam
 * @param {{grid, weapon, planeB, debris}} opts
 */
export function stepHunterArray(area, st, targets, cam, opts = {}) {
  const { grid = null, weapon = null, planeB = null, debris = null } = opts;
  let moved = 0, stamped = 0, noTarget = 0, coasting = 0, reAimed = 0, brokeBlocks = 0;
  const hits = [];
  const rate = hunterTurnRate(st);
  /* CS:0x9FA3 onward — the cull+stamp tail, shared by the coast and the
   * search+steer arms alike. CS:0x9FC8's own tag-sign-normalise dance
   * (negate, stamp, negate back) is why `Math.abs(p.tag)` is what reaches
   * the grid: the SIGN stays whatever `stepHunterCoast`/the dispatch above
   * just left it at, only the MAGNITUDE (the real 1..27 weapon-slot tag)
   * is ever meaningful to the shared damage grid. */
  const cullAndStamp = (p) => {
    const sx = p.x - cam.x, sy = p.y - cam.y;
    if (sx <= HUNTER_CULL.xMin || sy <= HUNTER_CULL.yMin
        || sx >= HUNTER_CULL.xMax || sy >= HUNTER_CULL.yMax) return;  // CS:0x9FB3-9FC6 — skip, NOT despawn
    if (!grid || !weapon) return;
    const style = DRAW_STYLES[weapon.drawStyle];
    if (!style) return;
    if (style.stamp === 'terrain2x2' && weapon.breaksTerrain && planeB) {
      const wx = (p.x + 8) & ~0x1f, wy = (p.y + 8) & ~0xf;
      if (planeB[(wy >> 4) * 128 + (wx >> 5)] === 1) {        // CS:0x9FCF/0x9FD6 -> 0xa7b6
        if (terrainStop(p, wy >> 4, wx >> 5, opts, hits)) brokeBlocks++;
        return;
      }
    }
    const sy2 = style.at === 0x9d19 ? sy - 0x10 : sy;
    const tag = Math.abs(p.tag);                        // CS:0x9FC8's neg/stamp/neg-back
    const ok = style.stamp === '3x3'
      ? grid.stamp3x3(sx, sy2, tag)
      : grid.stamp2x2(sx, sy2, tag);
    if (ok) stamped++;
  };
  for (let i = 0; i < MOVER_WALK; i++) {
    const p = area[i];
    if (!p || p.tag === 0) continue;                    // CS:0x9EFA
    if (p.tag < 0) {                                      // CS:0x9EFA `js 0x9e9e`
      if (stepHunterCoast(p)) reAimed++; else coasting++;
      cullAndStamp(p);
      continue;
    }
    /* CS:0x9E5D/0x9E61 — the stored SCREEN position plus the camera at pick
     * time: a world position one tick stale in camera terms. */
    const pick = pickTarget(targets);
    const target = pick && { x: pick.x + cam.x, y: pick.y + cam.y };
    if (!target) {                                       // CS:0x9F0A -> 0xA00D
      if (debris) {
        const vel = unpackHunterVel(p.dir);
        debris.spawn(p.x, p.y, vel.vx, vel.vy);
      }
      p.tag = 0;
      noTarget++;
      continue;
    }
    stepHunter(p, target, rate);                          // CS:0x9F12-0x9FA0
    moved++;
    cullAndStamp(p);
  }
  return { moved, stamped, noTarget, coasting, reAimed, brokeBlocks, hits };
}
