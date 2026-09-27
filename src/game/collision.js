/* collision.js — how a hero projectile hurts a creature.
 *
 * ⚠️ THERE IS NO PAIRWISE PROJECTILE-VS-CREATURE TEST IN GAME.EXE.
 *
 * Collision is mediated by a shared **8x8-pixel occupancy grid in SCREEN
 * space**. Every live projectile stamps its own tag byte into the grid on its
 * draw path; every creature then scans the grid over its own bounding box and
 * reacts to the first nonzero cell it finds. Nothing ever compares a
 * projectile to a creature directly.
 *
 * That shape is why searching for "the projectile hit test" found nothing: the
 * two halves never reference each other, only the grid.
 *
 * Per frame, in order:
 *   CS:0x01CC  call 0xACF6    clear the grid
 *   CS:0x020F  call 0x9455    projectiles move and DRAW -> each stamps its tag
 *   CS:0x0285  call 0xED15    System-B entities -> CS:0xFF93 -> CS:0xA9E4 scan
 *
 * ── The grid `[PROVEN — bytes re-read in this project]` ──────────────────
 *
 * CS:0xACF6:  mov cx,0x320 / mov di,0x1666 / rep stosw   = 1600 bytes zeroed.
 * One byte per 8x8 screen pixels; row stride 0x30 = 48 bytes = 384 px.
 * DS:0x16ca is screen (0,0) — 100 bytes into the cleared region, so there is
 * a margin above and to the left.
 */

export const CELL = 8;
export const GRID_ORIGIN = 0x16ca;      // screen (0,0)
export const GRID_LO = 0x1666;          // start of the cleared region
export const GRID_BYTES = 0x320 * 2;    // 1600
export const GRID_HI = GRID_LO + GRID_BYTES;   // 0x1CA6
export const ROW_STRIDE = 0x30;         // 48 bytes = 384 px per row

/* The WRITE window, checked by every stamp (CS:0xA87A / 0xA880). Note it is
 * narrower than the cleared region at both ends. */
export const WRITE_LO = 0x1696;
export const WRITE_HI = 0x1c42;

/* The unrolled compare chain at CS:0xAAF7..0xAB32 is 60 bytes of
 * `cmp byte [si],0 / jnz / inc si` — 6 bytes each, so TEN columns maximum
 * (80 px). The scanner enters it at `0xab33 - 6*cols`, which is how a
 * variable column count runs on a fixed unrolled chain. */
export const MAX_SCAN_COLS = 10;

/**
 * ⚠️ THE TWO INDEX RULES ROUND DIFFERENTLY. Do not factor them together.
 *
 *   stamp  CS:0xA863  `sar cx,1` x3 on x, `and cx,0xfff8` on y   -> FLOOR
 *   scan   CS:0xAA09  `add 4 / and 0xfff8` on BOTH first          -> ROUND half-up
 *
 * Both then compute si = 0x16ca + (x>>3) + 6*(y & ~7), and 6*(y&~7) is
 * 48*(y>>3) — the row stride. A port that uses one helper for both puts every
 * stamp up to half a cell away from where the scan looks for it.
 */
export const cellIndex = (x, y) => GRID_ORIGIN + (x >> 3) + 6 * (y & ~7);
export const stampIndex = (x, y) => cellIndex(x, y);
export const scanIndex  = (x, y) => cellIndex((x + 4) & ~7, (y + 4) & ~7);

/* ── The scan's CLIP PROLOGUE, CS:0xA9EF-0xAA83 `[PROVEN]` ───────────────
 *
 * Formerly UNKNOWN_scan_clip. It sits between the half-up round and the scan
 * loop and shrinks the box against the screen edges, and it is emphatically
 * not a no-op: without it a creature straddling an edge is scanned over a
 * larger area than the original uses.
 *
 * ⚠️ EACH AXIS DOES ONE CLIP OR THE OTHER, NEVER BOTH. The near-edge path
 * ends `mov bx,0xfff0 / jmp 0xaa4e` (CS:0xAA2B) and `mov ax,0xfff0 /
 * jmp 0xaa86` (CS:0xAA64), jumping PAST the far-edge test. So it is an
 * if/else per axis, not two sequential clamps — applying both diverges on any
 * box big enough to exceed both edges of one axis.
 *
 * ⚠️ AND THE TWO AXES ARE NOT WRITTEN THE SAME WAY. Read the encodings, not
 * the mnemonics:
 *
 *     AA36  81 F9 D0 00   cmp cx,0xd0     ; cx = y + height -> the BOTTOM EDGE
 *     AA6F  3D    50 01   cmp ax,0x150    ; ax = x          -> the LEFT EDGE
 *
 * `81 F9` is `cmp cx,imm16`; `3D` is `cmp ax,imm16`. The vertical test uses
 * the computed far edge, the horizontal one uses the near edge — even though
 * CS:0xAA6D has just computed the right edge into CX and then ignores it.
 * The consequence is concrete: the right-edge clip engages only once the box's
 * LEFT edge has passed x=336, which for a 32-wide creature means the whole
 * thing is already off-screen. It is effectively dead code. Reproduced
 * verbatim — "fixing" it to `cmp cx` starts clipping boxes the original scans
 * in full, and this project has been burned twice by tidying an asymmetry.
 *
 * The -16 clamp is exactly the grid's own margin: DS:0x16ca is 100 bytes into
 * the cleared region and the row stride is 48, so 100 = 2*48 + 4 — two rows
 * and four columns of slack, and -16 px is two rows.
 */
export const CLIP_NEAR = -16;        // 0xfff0, both axes
export const CLIP_BOTTOM = 0xd0;     // 208 — CS:0xAA36, against the FAR edge
export const CLIP_RIGHT = 0x150;     // 336 — CS:0xAA6F, against the NEAR edge

/**
 * @returns {{x,y,w,h,hit:boolean}} `hit: false` reproduces the jumps to
 * CS:0xAB3B, which return "no hit" without scanning a single cell.
 */
export function clipScanBox(x, y, w, h) {
  /* CS:0xAA15 `cmp bx,0xfff0 / jg` — the vertical if/else. */
  if (y <= CLIP_NEAR) {
    h += y + 16;                              // CS:0xAA1A/0xAA1D
    if (h <= 0) return { x, y, w, h, hit: false };   // CS:0xAA21/0xAA26
    y = CLIP_NEAR;                            // CS:0xAA2B, then `jmp 0xaa4e`
  } else {
    const bottom = h + y;                     // CS:0xAA30/0xAA34
    if (bottom >= CLIP_BOTTOM) {              // CS:0xAA36 `jl` skips
      h -= bottom - CLIP_BOTTOM;              // CS:0xAA3C/0xAA40
      if (h <= 0) return { x, y, w, h, hit: false };
    }
  }
  /* CS:0xAA4E `cmp ax,0xfff0 / jg` — the horizontal if/else. */
  if (x <= CLIP_NEAR) {
    w += x + 16;                              // CS:0xAA53/0xAA56
    if (w <= 0) return { x, y, w, h, hit: false };
    x = CLIP_NEAR;                            // CS:0xAA64, then `jmp 0xaa86`
  } else if (x >= CLIP_RIGHT) {               // ⚠️ the NEAR edge — see above
    w -= (w + x) - CLIP_RIGHT;                // CS:0xAA74/0xAA78
    if (w <= 0) return { x, y, w, h, hit: false };
  }
  return { x, y, w, h, hit: true };
}

/* CS:0xA9F0/0xA9F6 save the box into DS:0x1e6/0x1e8 because the clip above
 * MUTATES the globals it reads. Those two are read back only at CS:0xABEE and
 * CS:0xAC14, in the post-hit debris tail — nowhere that this port models — so
 * taking w/h by value here is equivalent rather than a shortcut. */

export class DamageGrid {
  constructor() { this.buf = new Uint8Array(GRID_BYTES); }

  /** CS:0xACF6 — once per frame, before anything moves. */
  clear() { this.buf.fill(0); }

  _at(si) { return si - GRID_LO; }

  /**
   * CS:0xA860 — the 2x2 (16x16 px) stamp, used by most projectile draw paths.
   *
   * ⚠️ The half-band nudge: `mov dl,bl / and dl,4 / jnz` shifts the whole 2x2
   * block down one row when the source y has bit 2 set. It is applied AFTER
   * the bounds check here, and BEFORE it in the 3x3 variant (CS:0xA8B8) — so
   * the two clip differently at the grid edge. Reproduced, not unified.
   */
  stamp2x2(x, y, tag) {
    let si = stampIndex(x, y);
    if (si < WRITE_LO || si >= WRITE_HI) return false;   // CS:0xA87A/0xA880
    if (y & 4) si += ROW_STRIDE;                          // CS:0xA88A — AFTER
    for (const o of [0, 1, ROW_STRIDE, ROW_STRIDE + 1]) {
      const i = this._at(si + o);
      if (i >= 0 && i < GRID_BYTES) this.buf[i] = tag;
    }
    return true;
  }

  /**
   * CS:0xA8B8 — the 3x3 (24x24 px) stamp, used by draw styles 1 and 2.
   *
   * ⚠️ THIS IS NOT stamp2x2 WITH A BIGGER LOOP. The nudge and the bounds check
   * are in the OPPOSITE ORDER:
   *
   *   2x2  CS:0xA87A  cmp si,0x1696 ... 0xA88A  and dl,4 / jnz   bounds, THEN nudge
   *   3x3  CS:0xA8DA  and dl,4 / jz  ... 0xA8DF  cmp si,0x1696   nudge, THEN bounds
   *
   * So a 3x3 whose NUDGED index falls outside the window is rejected whole,
   * while a 2x2 in the same position passes on its pre-nudge index and then
   * writes nudged. Factoring these into one size-parameterised helper gets one
   * of them wrong at the grid edge, which is why they are two methods.
   */
  stamp3x3(x, y, tag) {
    let si = stampIndex(x, y);
    if (y & 4) si += ROW_STRIDE;                          // CS:0xA8DA — BEFORE
    if (si < WRITE_LO || si >= WRITE_HI) return false;    // CS:0xA8DF/0xA8E5
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const i = this._at(si + r * ROW_STRIDE + c);
        if (i >= 0 && i < GRID_BYTES) this.buf[i] = tag;
      }
    }
    return true;
  }

  /**
   * CS:0xAAAC-0xAB3F — scan a box, return the first nonzero tag or 0.
   *
   * ⚠️ THIS IS NOT A PIXEL MASK. An earlier revision of this project's notes
   * called CS:0xaad1-0xab3f "the pixel-mask collision scan". Every one of the
   * 60 bytes in the compare chain is `cmp byte [si],0 / jnz / inc si` — no
   * TEST, no AND, no shift, no bit index. It is rectangle-vs-rasterised-
   * occupancy at 8x8 granularity, and sub-cell precision does not exist
   * anywhere in this system.
   *
   * Column and row counts come from the caller's globals DS:0x1e2 (width) and
   * DS:0x1e4 (height), which System-B sets to 0x20/0x20 at CS:0xFF93.
   */
  scan(x, y, w, h) {
    /* CS:0xAA09-0xAA12 — the half-up round comes FIRST, and the clip works on
     * the ROUNDED position. Clipping the raw one loses a column: a 32-wide box
     * at screen x = -28 keeps 24 px in the original (rounded -24 -> +8) and
     * only 20 here, so a shot in the second column went unseen. [PROVEN]
     * against PJOYL2 cursor 1423, where DOSBox's turret finds the fireball. */
    x = (x + 4) & ~7;
    y = (y + 4) & ~7;
    /* CS:0xA9EF-0xAA83 — the clip prologue, ported. See clipScanBox below. */
    const c = clipScanBox(x, y, w, h);
    if (!c.hit) return 0;                       // CS:0xAB3B — it shrank away
    x = c.x; y = c.y; w = c.w; h = c.h;
    const si0 = scanIndex(x, y);

    let rows = (h >> 3) - 1;                    // CS:0xAAC2..0xAACF
    if (rows < 0) rows = 0;
    let cols = (w >> 3) - 1;                    // CS:0xAAD3..0xAAE2
    if (cols <= 0) cols = 1;                    // `js`/`jnz` both land on 1
    if (cols > MAX_SCAN_COLS) cols = MAX_SCAN_COLS;   // the chain's own limit

    const advance = ROW_STRIDE - cols;          // CS:0xAAE8 `mov dx,0x30 / sub dx,cx`
    let si = si0;
    for (let r = 0; r <= rows; r++) {           // `dec al / jns` -> rows+1 passes
      for (let c = 0; c < cols; c++, si++) {
        const i = this._at(si);
        if (i >= 0 && i < GRID_BYTES && this.buf[i] !== 0) { this.lastHitSi = si; return this.buf[i]; }
      }
      si += advance;
    }
    return 0;                                   // CS:0xAB3F — no hit
  }
}

/* ⚠️ The scanner has NO bounds check of its own — there is no compare against
 * the buffer limits anywhere in CS:0xAAAA-0xAB3F. It stays inside only
 * because the caller's clips and the largest shipped creature box happen to
 * keep it there. This port clamps instead, the same way the trigger port
 * clamps its unbounded cond_kind dispatch: a wild read is not a behaviour
 * worth reproducing, and the clamp cannot change a verdict that the original
 * would have reached legitimately. */

/* ── Tag -> damage, CS:0x9320 `[PROVEN]` ─────────────────────────────────
 *
 *   9323  al = [si]                  the grid cell = the projectile's tag
 *   9325  cbw / or ax,ax / js        NEGATIVE -> a non-projectile source
 *   932A  si = 0xdd10                slot A
 *   932D  cmp al,9 / jng found       ... so each slot owns NINE tags
 *   9331  si = 0xdda2 ; al -= 9      slot B
 *   933A  si = 0xde34 ; al -= 9      slot C
 *   933F  dec al / shl ax,1 x3       (tag-1) * 8 = the record's byte offset
 *   9347  bx = [si]                  the slot's weapon index
 *   934B  di = 0xe2b6 + weapon*0x50  the weapon record
 *   935E  ax = [di+0x8]              <-- THE DAMAGE
 *   9361  [0x1ea] = ax
 *
 * ⚠️ **DAMAGE IS WEAPON +0x08 — THE PICKUP COUNT — NOT POWER (+0x06).**
 *
 * This enlarges what +0x08 means. It was established here as the pickup
 * counter that raises the projectile volley 1->2->3; it is ALSO the damage
 * per hit, read straight out of the record. Since a new pickup sets
 * count := Power (CS:0x9115), **Power is the weapon's STARTING damage** and
 * every duplicate pickup adds exactly 1 to it — which is why the shop labels
 * +0x06 "Power" and refunds on (count - base).
 *
 * So a duplicate pickup buys BOTH more projectiles and more damage each.
 *
 * The `cmp al,9` split is independent confirmation of the tag layout: 9 tags
 * per slot, and (tag-1)*8 addressing 8-byte records means records 0..8 — the
 * same NINE the allocator reaches and the mover walks.
 */
export const TAGS_PER_SLOT = 9;

/* Non-projectile grid sources, distinguished by a negative (>=0x80) tag.
 *
 * ⚠️ TWO CORRECTIONS. An earlier revision of this table came from a workflow
 * lane marked [WF] — "not re-read here" — and had 0xFC as a "debris particle
 * (CS:0xA549)". CS:0xA549 is inside the STARBURST updater (see
 * game/starburst.js); debris is a different, 20-record array at DS:0x8b4c,
 * cleared at CS:0x8E91 and appended at CS:0xA816 on the projectile's
 * terrain-stop path. The tag value was right and the source was wrong.
 *
 * And every one of these returned `damage: 0`, which is wrong for three of
 * the four. The ladder at CS:0x938B peels one `inc ax` per tag: */
export const SPECIAL_TAGS = {
  0xfc: 'STARBURST particle (CS:0xA549; the tag byte is at DS:0xdcfe)',
  0xfd: 'UNKNOWN_tag_fd — consumed at CS:0x93C2 and CS:0xE5B9, no producer found',
  0xfe: 'invulnerability aura, gated [0x172]==1 (CS:0xA9DA)',
  0xff: 'the FAMILIAR\'s attack (CS:0xC2E7)',
};

/* CS:0x938B onward. `mode` is DS:0x34, which is 0 in normal play — see the
 * evidence in game/starburst.js. A tag whose damage VARIES (0xFF carries the
 * familiar's power, DS:0x210) reports `varies` instead of a number. */
export const SPECIAL_TAG_DAMAGE = {
  0xff: { at: 0x938e, varies: 'DS:0x210, the familiar\'s power' },
  0xfe: { at: 0x93a8, mode0: 10000, other: 0 },
  0xfd: { at: 0x93c2, mode0: 0,     other: 0 },
  0xfc: { at: 0x93cc, mode0: 10000, other: 50 },
};

/**
 * CS:0x9320 — decode a grid tag into the damage it carries.
 * @param {number} tag        the nonzero grid cell
 * @param {Array} slotWeapons the three slots' weapon indices (<0 = empty)
 * @param {Array} weaponState per-weapon runtime {count, base} from weapons.js
 * @param {number} mode       DS:0x34 — 0 in normal play; 1 and 2 change what
 *                            the two AREA tags (0xFC, 0xFE) deal.
 */
export function damageForTag(tag, slotWeapons, weaponState, mode = 0) {
  if (tag & 0x80) {
    const e = SPECIAL_TAG_DAMAGE[tag];
    if (!e) return { special: 'unknown', damage: 0 };
    return {
      special: SPECIAL_TAGS[tag],
      at: e.at,
      /* DS:0x34 = 0 is normal play. A caller that does not model the mode
       * gets the normal-play answer, which is the one that ships. */
      damage: e.varies ? 0 : (mode === 0 ? e.mode0 : e.other),
      varies: e.varies || undefined,
    };
  }
  let t = tag, slot = 0;
  while (t > TAGS_PER_SLOT && slot < 2) { t -= TAGS_PER_SLOT; slot++; }
  const weapon = slotWeapons[slot];
  if (weapon === undefined || weapon < 0) return { slot, damage: 0, empty: true };
  const st = weaponState[weapon];
  return {
    slot,
    record: t - 1,                       // (tag-1)*8 / 8
    weapon,
    damage: st ? st.count : 0,           // [di+0x8] — the pickup count
  };
}

/**
 * CS:0x937C `cmp byte ptr [di+0x49],0x0` — does a decoded hit despawn the
 * projectile that scored it? True only for an ordinary weapon-tag hit (not
 * a special FF/FE/FD/FC source, and not an empty slot) whose weapon has
 * +0x49 set (weapons.js's `consumedOnHit`). See despawnConsumedHit below
 * for the actual write, and weapons.js's own field comment for the full
 * provenance and the shipped-data census (knife/fireball/flame/hunter/
 * magic axe set; time bomb/lightning bolt/throwing star/spear/axe/mace
 * clear).
 * @param {ReturnType<typeof damageForTag>} decoded
 * @param {Array} weapons  the parsed PWEAPONS records for the current world
 */
export function hitConsumesProjectile(decoded, weapons) {
  return decoded.weapon !== undefined && decoded.weapon >= 0
    && !!(weapons[decoded.weapon] && weapons[decoded.weapon].consumedOnHit);
}

/**
 * CS:0x9382 `mov word ptr [si+0x2],0x0` — inside the SAME decode that just
 * computed the hit's damage, zero the exact projectile record that scored
 * it, unconditionally (whether or not the target dies). This is what makes
 * the knife (and fireball/flame/hunter/magic axe) single-hit and every
 * other weapon persist through a hit exactly as this port already modelled.
 * @param {ReturnType<typeof damageForTag>} decoded
 * @param {Array} weapons    the parsed PWEAPONS records for the current world
 * @param {Array} slotAreas  the three slots' own projectile-record arrays,
 *   `[slotA.area, slotB.area, slotC.area]` — index by `decoded.slot`.
 * @returns {boolean} whether a despawn happened
 */
export function despawnConsumedHit(decoded, weapons, slotAreas) {
  if (!hitConsumesProjectile(decoded, weapons)) return false;
  slotAreas[decoded.slot][decoded.record].tag = 0;   // CS:0x9382
  return true;
}
