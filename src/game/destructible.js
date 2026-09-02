/* destructible.js — CS:0x73EC / CS:0x7500, and UNKNOWN_destructible_tile is
 * closed. This is the mechanism behind "maces break blocks".
 *
 * ── WHY IT WAS OPEN ──────────────────────────────────────────────────────
 * This project once recorded PWEAPONS `+0x48` as "projectile breaks solid
 * terrain — the maces-break-blocks flag", then corrected it on the bytes to
 * "projectile is STOPPED BY solid terrain", because the path it gates writes
 * neither plane. That correction stands. The mace's advantage lives at a
 * COMPLETELY DIFFERENT SITE — a `+50` at CS:0x74AF — and finding it is what
 * closes the loop rather than reopening it.
 *
 * ── THE TRIGGER ──────────────────────────────────────────────────────────
 *     A7EF  cmp byte [ds:bp+0],1 / jnz          ; the cell must be SOLID
 *     A800  cmp byte [di],0x6d / jnz 0xa816     ; plane A must read 0x6d
 *     A806  cmp byte [0x42],3 / jl  0xa816      ; and the world must be >= 3
 *     A810  call 0x73ec
 * `si` is the WEAPON record throughout (CS:0xA7B7 read `[si+0x48]` from it)
 * and `bp` is the plane-B cell pointer.
 *
 * ⚠️ THE WORLD GATE IS NOT ARBITRARY — the shipped maps split on it exactly.
 * Tile 0x6d appears in every level, but its plane-B solidity does not:
 *     PLEV1A/1B   6 /  6 cells,   0 solid
 *     PLEV2A/2B  11 / 14 cells,   0 solid
 *     PLEV3A/3B  15 /  8 cells, ALL solid
 *     PLEV4A/4B 120 /103 cells, ALL solid
 * 246 of 246 solid in worlds 3-4 against 0 of 37 in worlds 1-2. The authors
 * used 0x6d decoratively early and as breakable masonry late, and guarded the
 * code by world to match.
 */

export const DESTRUCTIBLE_TILE = 0x6d;   // CS:0xA800
export const MIN_WORLD = 3;              // CS:0xA806 `cmp byte [0x42],3 / jl`

/* ── The queue, DS:0xd0c6 — 40 records of six bytes ───────────────────────
 * `{ u16 worldX, u16 worldY, i16 hp }`. Free when X is NEGATIVE, the same
 * sign idiom the object and starburst arrays use. Cleared by CS:0x74CD with
 * `mov cx,0x78 / rep stosw` = 120 words = 240 bytes = 40 x 6 exactly.
 *
 * The coordinates are RECONSTRUCTED from the plane-B pointer, not passed in:
 *     7408  ax = bp - 0x5004                ; the cell index
 *     740D  bx = ax & 0xff80                ; row * 128
 *     7412  ax &= 0x7f                      ; col
 *     7415  shl ax,1 (x5)                   ; -> world X = col * 32
 *     741F  shr bx,1 (x3)                   ; -> world Y = row * 16
 * ⚠️ Note `shr` here and `sar` in the removal at CS:0x7574 for the same
 * quantity. Both operands are non-negative so nothing diverges, but a reader
 * diffing the two routines will wonder which is right: neither, they agree.
 */
export const QUEUE_SLOTS = 40;           // CS:0x73F6 `mov cx,0x28`
export const QUEUE_STRIDE = 6;
export const QUEUE_DS = 0xd0c6;
export const HP_FRESH = -1;              // CS:0x742A `mov word [si+4],0xffff`

/* ── The damage, CS:0x743E ────────────────────────────────────────────────
 * CS:0x73EC calls this FIRST. It rebuilds the same coordinates, scans the
 * queue for a matching cell whose hp is still negative, and if it finds one:
 *
 *     747E  pop cx / pop bx / pop ax
 *     7481  pop dx            ; dx = the CALLER's si (the weapon record)
 *     7482  xchg dx,si        ; si = weapon record
 *     7484  mov ax,[si+8]     ; the weapon's PICKUP COUNT = its damage
 *     7487  xchg dx,si        ; si = the QUEUE record again  <-- swapped BACK
 *     7489  ...DS:0x33f picks which slot fired, -> bx = that weapon index
 *     74AA  cmp bl,0xa / jnz / 74AF add ax,0x32     ; THE MACE BONUS
 *     74B2  sub [si+4],ax                           ; hp -= damage
 *     74B5  cmp word [si+4],0xff38 / jl 0x74c2      ; hp < -200 ?
 *     74C2  mov word [si+4],0                       ;   -> clamp to ZERO
 *     74BE  pop ax / jmp 0x7439    ; DISCARD the return address and unwind
 *                                  ; straight out of CS:0x73EC, skipping the
 *                                  ; append. Same hand-rolled-stack idiom as
 *                                  ; the starburst's CS:0xA557.
 *
 * ⚠️ The two `xchg`es cancel, so CS:0x74B2 lands on the QUEUE record, not the
 * weapon. Corroborated at the use site: the updater at CS:0x752C reads
 * `[si+4]` with `si` walking DS:0xd0c6 at stride 6 — the same field. Reading
 * one `xchg` and not the other puts the subtract on PWEAPONS `+0x04`, the
 * projectile animation frame, and the whole model is wrong.
 *
 * ⚠️ hp counts DOWN from -1 and "breaking" is hp >= 0. So a block absorbs
 * 200 cumulative damage: -1 - 200 = -201 < -200 clamps to 0.
 */
export const BREAK_THRESHOLD = -200;     // 0xff38, a SIGNED compare
export const MACE_INDEX = 10;            // CS:0x74AA `cmp bl,0xa`
export const MACE_BONUS = 0x32;          // CS:0x74AF `add ax,0x32` — 50

/* ⚠️ CORRECTION — CS:0x7484 IS POLYMORPHIC, and CS:0x33f IS NOT THE DAMAGE.
 *
 * An earlier revision of this module said "CS:0x7489 picks which weapon
 * supplies the damage". It does not. The two reads are independent:
 *
 *     7484  mov ax,[si+0x8]      ; THE DAMAGE — +0x08 of whatever struct the
 *                                ; CALLER of CS:0x73EC held in SI
 *     7489  ...DS:0x33f 0/1/2 -> bx = [0xdd10] / [0xdda2] / [0xde34]
 *     74AA  cmp bl,0x0a          ; BX's ONLY consumer, image-wide
 *     74AF  add ax,0x32
 *
 * So DS:0x33f selects which SLOT is tested for holding weapon 10, and nothing
 * else. On the projectile path the two happen to agree — SI is the PWEAPONS
 * record (pinned by CS:0xA7B7 reading `[si+0x48]` through the same SI), so
 * `[si+8]` is that weapon's pickup count and DS:0x33f is the slot that fired
 * it. The equivalence breaks on the OTHER caller: CS:0x8BCA hands SI a
 * DS:0xcfcc hazard record whose `+0x08` it set to 250 four instructions
 * earlier (CS:0x8BBA), and forces DS:0x33f to 0 purely to test slot A.
 */

/** CS:0x74AA/0x74AF. `damage` is the caller's own `+0x08`; `slotWeapon` is
 *  the weapon index in the slot DS:0x33f selects — they are separate inputs
 *  and only coincide on the projectile path. */
export const blockDamage = (slotWeapon, damage) =>
  damage + (slotWeapon === MACE_INDEX ? MACE_BONUS : 0);

/**
 * How many hits that weapon needs. Only the six weapons whose PWEAPONS
 * `+0x48` BYTE is nonzero ever reach this path at all — the other five fly
 * straight through terrain and can never break anything.
 *
 * ⚠️ `+0x48` is a BYTE (`cmp byte [si+0x48],0`). Read as a big-endian WORD it
 * picks up `+0x49` too, and the hunter and magic axe wrongly appear to
 * collide — a mistake made and caught while writing this module.
 *
 * With the shipped Powers in worlds 3-4 (damage = the pickup count, which a
 * fresh pickup sets to Power):
 *     mace 3+50 = 53 ->   4 hits          flame        4 ->  50
 *     time bomb    20 ->  10 hits          throwing star 2 -> 100
 *     fireball      5 ->  40 hits          knife         1 -> 200
 * The mace is an order of magnitude better than anything else, which is the
 * folklore — now mechanised, and located at a site that has nothing to do
 * with `+0x48`.
 */
/* hp = -1 - n*dmg, and the clamp fires at hp < -200, i.e. n*dmg > 199.
 * ⚠️ That is `floor(199 / dmg) + 1`, NOT `ceil(201 / dmg)` — the two agree for
 * the mace and disagree for the knife (200 vs 201), the time bomb (10 vs 11)
 * and the fireball (40 vs 41). The closed form was written wrong here first
 * and caught by simulating the real `hit()` loop against it. */
export const hitsToBreak = (damagePerHit) =>
  damagePerHit <= 0 ? Infinity
    : Math.floor((Math.abs(BREAK_THRESHOLD) - 1) / damagePerHit) + 1;

/* ⚠️ AND THE FIRST SHOT DOES NO DAMAGE. CS:0x73EC calls CS:0x743E *before*
 * appending, and on an unqueued cell that scan finds nothing — so the first
 * hit only creates the record at hp = -1 and returns. Damage starts on the
 * SECOND. So a mace takes 4 damaging hits but FIVE shots, and a knife 200 and
 * 201. Quoting `hitsToBreak` as "shots" is off by one on every weapon. */
export const shotsToBreak = (damagePerHit) =>
  damagePerHit <= 0 ? Infinity : hitsToBreak(damagePerHit) + 1;

/* ── The restore list, SS:0x46b0 — 100 entries of four bytes ──────────────
 * ⚠️ IT IS `SS`-RELATIVE, NOT `DS`, and two independent things say so: every
 * access is `[bp+0]` (CS:0x74E1, CS:0x758D, CS:0x759B), which defaults to SS;
 * and the clear at CS:0x75E1 does `push ss / pop es` before its `rep stosw`.
 * This document warns generally that an offset must be resolved against the
 * right segment before it means anything — here is a case where it matters.
 *
 * Only the first word of each 4-byte entry is used: the plane-B pointer of a
 * broken cell. Cleared with `mov cx,0xc8 / rep stosw` = 200 words = 400 bytes
 * = 100 x 4 exactly.
 */
export const RESTORE_SLOTS = 100;        // CS:0x7588 `mov bl,0x63`, `dec/jns`
export const RESTORE_SS = 0x46b0;

/* ── Removal, CS:0x7566, and the two capacity quirks ──────────────────────
 *     7566  bx = [si] ; dx = [si+2]
 *     756B  bx &= 0xffe0 ; dx &= 0xfff0     ; snap to the tile
 *     7574  sar bx,1 (x5) ; shl dx,1 (x3)   ; -> col, row*128
 *     7584  di = 0x5004 + col + row*128     ; the plane-B pointer
 *     758A  ...first-fit over the 100-entry restore list...
 *     759A  ret                             ; ⚠️ FULL -> RETURN, no removal
 *     759B  [bp+0] = di
 *     759E  mov byte [di],0                 ; plane B := 0, PASSABLE
 *     75A1  sub di,0x2000 / mov byte [di],1 ; plane A := 1
 *
 * ⚠️ PLANE A BECOMES 1, NOT 0. Under this project's proven 1-based plane-A
 * rule (`tile = planeA - 1`) that is tile index 0, the first tile in the
 * sheet — not "empty". The natural port writes 0 and draws the wrong tile.
 *
 * ⚠️ AND A FULL RESTORE LIST LEAVES THE BLOCK SOLID. The routine returns
 * before touching either plane, while its caller still frees the queue slot
 * — so the block finishes its break animation and then stays put. PLEV4A
 * places 120 destructible cells against 100 restore entries, so this is
 * reachable in shipped data, not a hypothetical.
 *
 * The queue has the matching quirk at the other end: CS:0x7403 drops a hit
 * silently when all 40 slots are busy.
 */
export const BROKEN_PLANE_A = 1;         // CS:0x75A5
export const BROKEN_PLANE_B = 0;         // CS:0x759E
export const RESTORED_PLANE_A = DESTRUCTIBLE_TILE;   // CS:0x74EF
export const RESTORED_PLANE_B = 1;                   // CS:0x74F2

/* ── The per-frame updater, CS:0x7500 ─────────────────────────────────────
 * Called at CS:0x01DF — EARLY, before the mode dispatch at CS:0x01E5 and so
 * before the object pass, the projectiles and the player.
 *
 *     7500  C3                          ; RET, patched to 0x90 (NOP) by
 *                                       ; CS:0x7433 when the first block is
 *                                       ; queued — the same self-modifying
 *                                       ; enable the player state machine's
 *                                       ; [cs:0x71d] gate uses
 *     7501  cmp byte [0x3c0],0 / jnz
 *     7508  mov byte [cs:0x7500],0xc3   ; nothing queued -> disable again
 *     7514  cmp word [si],0 / js next   ; free slot
 *     752C  ax = [si+4] / or ax,ax / js next   ; hp still NEGATIVE -> not
 *                                              ; breaking yet, draw nothing
 *     7533  ax += [0x158] / draw
 *     7545  cmp byte [0x36c],0 / jz next      ; the every-other-frame gate
 *     754C  inc word [si+4] / cmp 3 / jng next
 *     7555  call 0x7566 / [si] = 0xffff / dec [0x3c0]
 *
 * DS:0x36c is toggled by `not byte [0x36c]` at CS:0x0172, once per frame, so
 * the four break frames take EIGHT ticks — about 0.53 s at the proven 15 Hz.
 *
 * ⚠️ DS:0x158, the sprite base, IS NEVER WRITTEN. Held to the same standard
 * as the shield no-op: the immediate `58 01` occurs twice in the image and
 * once in a driver-searchable form — one is this read, the other is
 * `cmp ax,0x158`, an immediate compare, not an address; and `57 01`, which a
 * word access one byte low would encode, is instruction bytes in all three of
 * its occurrences. So the base is whatever BSS holds, i.e. 0 on a fresh load,
 * and the drawn sprite is the frame index itself: 0, 1, 2, 3.
 *
 * A port reproducing that is reproducing an UNINITIALISED READ, exactly as
 * this project's plane-A note does for out-of-range tile-cache indices. It is
 * recorded as such rather than dressed up as a designed sprite base.
 */
export const BREAK_FRAMES = 4;           // CS:0x754F `cmp word [si+4],3 / jng`
export const ANIM_EVERY_OTHER_FRAME = true;   // DS:0x36c, CS:0x0172 `not`
export const SPRITE_BASE_DS = 0x158;
export const SPRITE_BASE_VALUE = 0;      // never written; BSS

/** The second caller of the queue. CS:0x8BCA reaches it with a plane-B
 *  pointer and then damages the hero through CS:0xac59 with a 5 x 16 box at
 *  strength 3 — so something other than a projectile also breaks blocks.
 *  `UNKNOWN_block_breaker_8bca`: what that entity is, is not established. */
export const OTHER_BREAKER = 0x8bca;

/**
 * The whole subsystem. `planeA`/`planeB` are the live 8192-byte maps; this
 * WRITES them, which is the point — a broken block is a permanent change to
 * the level until the restore runs.
 */
export class Destructibles {
  constructor(world) {
    this.world = world;
    this.queue = Array.from({ length: QUEUE_SLOTS },
                            () => ({ x: -1, y: 0, hp: HP_FRESH }));
    this.restore = [];                   // plane-B indices, max RESTORE_SLOTS
    this.enabled = false;                // the [cs:0x7500] patch
    this.animGate = false;               // DS:0x36c
    this.droppedHits = 0;                // queue full  — CS:0x7403
    this.strandedSolid = 0;              // restore full — CS:0x759A
    this.broken = 0;
  }

  /** CS:0xA800/0xA806 — is this cell breakable at all? */
  breakable(planeA, cell) {
    return this.world >= MIN_WORLD && planeA[cell] === DESTRUCTIBLE_TILE;
  }

  /**
   * CS:0x73EC. `cell` is the plane-B index; `weaponIndex`/`pickupCount`
   * describe the projectile that hit.
   * @returns {'damaged'|'queued'|'dropped'}
   */
  hit(cell, slotWeapon, damage) {
    const x = (cell & 0x7f) * 32;                       // CS:0x7415
    const y = ((cell & 0xff80) >> 7) * 16;              // CS:0x741F
    const dmg = blockDamage(slotWeapon, damage);

    /* CS:0x743E runs FIRST, and on a match it unwinds past the append. */
    for (const q of this.queue) {
      if (q.x !== x || q.y !== y || q.hp >= 0) continue;
      q.hp -= dmg;                                      // CS:0x74B2
      if (q.hp < BREAK_THRESHOLD) q.hp = 0;             // CS:0x74C2
      return 'damaged';
    }
    const free = this.queue.find((q) => q.x < 0);
    if (!free) { this.droppedHits++; return 'dropped'; } // CS:0x7403
    free.x = x; free.y = y; free.hp = HP_FRESH;
    this.enabled = true;                                 // CS:0x7433
    return 'queued';
  }

  /** CS:0x7500. One tick. Returns the frames to draw. */
  step(planeA, planeB) {
    const drawn = [];
    if (!this.enabled) return drawn;                     // the RET patch
    this.animGate = !this.animGate;                      // CS:0x0172 `not`
    const live = this.queue.filter((q) => q.x >= 0);
    if (live.length === 0) { this.enabled = false; return drawn; }  // CS:0x7508

    for (const q of this.queue) {
      if (q.x < 0) continue;                             // CS:0x7514
      if (q.hp < 0) continue;                            // CS:0x752C — not yet
      drawn.push({ x: q.x, y: q.y, sprite: q.hp + SPRITE_BASE_VALUE });
      if (!this.animGate) continue;                      // CS:0x7545
      q.hp += 1;                                         // CS:0x754C
      if (q.hp <= BREAK_FRAMES - 1) continue;            // CS:0x754F `jng`
      this.remove(q, planeA, planeB);                    // CS:0x7555
      q.x = -1;                                          // CS:0x7558
    }
    return drawn;
  }

  /** CS:0x7566. */
  remove(q, planeA, planeB) {
    const cell = ((q.x & 0xffe0) >> 5) + ((q.y & 0xfff0) >> 4) * 128;
    if (this.restore.length >= RESTORE_SLOTS) {          // CS:0x759A
      this.strandedSolid++;
      return;                                           // the block STAYS SOLID
    }
    this.restore.push(cell);
    planeB[cell] = BROKEN_PLANE_B;                      // CS:0x759E
    planeA[cell] = BROKEN_PLANE_A;                      // CS:0x75A5 — 1, not 0
    this.broken++;
  }

  /** CS:0x74DB, then CS:0x74CD — level load and restart put every block back
   *  and empty the queue. The two callers (CS:0x69B1 and CS:0x8E40) each do
   *  the restore immediately before the clear. */
  restoreAll(planeA, planeB) {
    for (const cell of this.restore) {
      planeA[cell] = RESTORED_PLANE_A;                  // CS:0x74EF
      planeB[cell] = RESTORED_PLANE_B;                  // CS:0x74F2
    }
    const n = this.restore.length;
    this.restore = [];
    for (const q of this.queue) { q.x = -1; q.hp = HP_FRESH; }  // CS:0x74CD
    this.enabled = false;
    return n;
  }
}
