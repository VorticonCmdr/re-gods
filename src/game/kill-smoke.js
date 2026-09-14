/* kill-smoke.js — DS:0x8c3c, the puff ACT6 leaves where a hazard was.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────
 * trigger-actions.js's `act6` already seeded this four-slot array, and
 * NOTHING ever read it back: the port filled the slots and drew nothing, so
 * a lever-neutralised spike blinked out of existence instead of going up in
 * smoke. checks.js even carried the gap as a note — "list at DS:0x8c3c is
 * filled and never drawn (CS:0x3cc7 is its walker)". CS:0x3CC7 is that
 * walker, and this module is it.
 *
 * Reported from play, not from the disassembly: "spike hazards go up in
 * smoke and disappear when shut off".
 *
 * ── THE WALKER, CS:0x3CC7-0x3D07 `[PROVEN]` ──────────────────────────────
 *     3CC7  si = 0x8c3c ; cx = 4
 *     3CCD  cmp word [si],0 / js next     ; NEGATIVE word = free slot
 *     3CD2  ax = [si+2] ; bx = [si+4]     ; the stored point — WORLD space
 *     3CD8  ax -= [0xa] ; bx -= [0xc]     ; -> screen, every tick
 *     3CE0  dx = [si] ; add dx,0x6c       ; sprite = 108 + frame
 *     3CE5  [0x4]=ax [0x6]=bx [0x8]=dx    ; the export's argument slots
 *     3CF2  call 0x3569                   ; graphics EXPORT 1
 *     3CF7  inc byte [si]                 ; frame++ — AFTER the draw
 *     3CF9  cmp byte [si],0x7 / jl next
 *     3CFE  mov word [si],0xffff          ; spent -> free
 *     3D02  add si,0x6 / loop 0x3ccd      ; a FULL 4-slot pass
 *
 * So a slot draws sprites 108..114 on seven consecutive ticks and then frees
 * itself. Three absences are load-bearing, and all three are the opposite of
 * what the sibling debris pool does:
 *
 *   - NO fast-out counter. debris.js has DS:0x33b and returns immediately
 *     when nothing is live; this walks all four slots unconditionally.
 *   - NO off-screen cull, NO terrain test, NO contact test. The only CALL in
 *     the whole body is the blit, so a puff cannot touch anything.
 *   - EXPORT 1, not export 2. CS:0x3569 is the same blitter the live-object
 *     draw uses; debris draws through CS:0x356E (export 2) instead.
 *
 * ── WHAT SPRITES 108..114 ACTUALLY ARE ───────────────────────────────────
 * Cut out of the shipped atlases rather than assumed: PALWAYS2[69..71] then
 * PALWAYS3[0..3], at 32x32, 32x32, 32x32, 32x32, 32x29, 32x18, 32x17 — a
 * pale dome that swells into a cloud, browns, then flattens and scatters.
 * The shrinking heights ARE the dispersal.
 *
 * Sprite 115 is an unrelated green box, which makes the art an independent
 * check on `cmp 7`: an off-by-one in the bound would draw furniture, so the
 * seven-frame reading is confirmed twice over — by the compare and by the
 * atlas.
 *
 * ── THE SEEDING SIDE LIVES IN act6, AND ITS SHAPE MATTERS ────────────────
 * CS:0x3C02-0x3C18 searches for a free slot ONCE, before the object scan:
 *
 *     3C03  cx = 4 ; bp = 0x8c3c
 *     3C09  cmp word [bp],0 / js 0x3c18      ; free -> use this slot
 *     3C10  add bp,6 / loop
 *     3C15  sub bp,6                         ; NONE free -> back off to the LAST
 *
 * and then each kill writes at `bp` and does `add bp,6` (CS:0x3C86/0x3CAB)
 * WITHOUT searching again. Two consequences a "find a free slot per kill"
 * port gets wrong:
 *
 *   1. With every slot busy the original OVERWRITES slot 3 rather than
 *      dropping the puff. A port that skips leaves the kill silent.
 *   2. The second kill of one invocation takes the NEXT slot whether or not
 *      it is free — so with free slots at 1 and 3 and busy ones at 0 and 2,
 *      the original clobbers slot 2; a re-search would pick slot 3.
 *
 * ⚠️ ONE STORE IS CLAMPED, NOT REPRODUCED. If the cursor is already on the
 * last slot and a SECOND kill lands, `add bp,6` walks one record past the
 * array and the original writes six bytes at DS:0x8c54 — which is not
 * spare: the main loop parks a pointer there every frame (CS:0x0218 `mov
 * word [0x1d2],0x8c54`). `seedAt` counts that case in `dropped` instead of
 * corrupting a neighbour, the same call this port already made for ACT8's
 * own out-of-array store.
 */

export const ARRAY_DS    = 0x8c3c;
export const SLOTS       = 4;      // CS:0x3CCA `mov cx,0x4`
export const STRIDE      = 6;      // CS:0x3D02 `add si,0x6`
export const SPRITE_BASE = 0x6c;   // CS:0x3CE2 `add dx,0x6c` — 108
export const EXPIRE_AT   = 7;      // CS:0x3CF9 `cmp byte [si],0x7`
export const DRAW_EXPORT = 1;      // CS:0x3CF2 `call 0x3569` -> SS:0x5256

/** Frames a puff draws. The blit at CS:0x3CF2 PRECEDES the `inc` at
 *  CS:0x3CF7, so frames 0..6 — sprites 108..114 — are all drawn. */
export const FRAMES = EXPIRE_AT;   // 7

/** The last sprite drawn, for checks that want the far end of the run. */
export const SPRITE_LAST = SPRITE_BASE + FRAMES - 1;   // 114

/* ⚠️ THE PUFF IS ONE TICK LATE, and that is the original's own ordering, not
 * a port artifact. The walker runs at CS:0x0239, while a trigger reaches
 * ACT6 from the plane-B probe at CS:0x5FAB — which hangs off the player
 * state machine at CS:0x0254, LATER in the same frame. So a slot seeded this
 * frame is first drawn on the next one. Nothing here compensates for it. */
export const SEEDED_AFTER_WALKER = 0x0239;

export class KillSmoke {
  constructor() {
    /* `frame` is the record's first word: a counter when live, 0xFFFF (i.e.
     * negative) when free. One field, both jobs, exactly like debris's
     * sprite/lifetime word. */
    this.slots = Array.from({ length: SLOTS }, () => ({ frame: -1, x: 0, y: 0 }));
    this.clobbered = 0;   // seeds that landed on a still-live slot
    this.dropped = 0;     // the clamped one-past-the-end store
  }

  /**
   * CS:0x3C02-0x3C18 — the ONE free-slot search ACT6 does per invocation.
   * @returns {number} the slot index to start writing at; `SLOTS - 1` when
   *   every slot is busy (the `sub bp,6` fallback).
   */
  openCursor() {
    for (let i = 0; i < SLOTS; i++) if (this.slots[i].frame < 0) return i;
    return SLOTS - 1;                                  // CS:0x3C15
  }

  /**
   * CS:0x3C78/0x3C9D — seed one puff and advance the cursor. The caller
   * passes the cursor back in for a second kill; there is no re-search.
   * @param {number} i cursor from `openCursor`
   * @param {number} worldX the object's x MINUS 8 (CS:0x3C75 `sub ax,8`)
   * @param {number} worldY the object's y, minus a further 8 for type 0x60
   * @returns {number} the next cursor
   */
  seedAt(i, worldX, worldY) {
    if (i < 0 || i >= SLOTS) { this.dropped++; return i + 1; }   // clamped
    const s = this.slots[i];
    if (s.frame >= 0) this.clobbered++;
    s.frame = 0;                                       // CS:0x3C78 `mov [bp],0`
    s.x = worldX & 0xffff;
    s.y = worldY;
    return i + 1;                                      // CS:0x3C86 `add bp,6`
  }

  /** CS:0x3CC7. One tick. Returns the puffs to draw, in screen space. */
  step(cam) {
    const drawn = [];
    for (const s of this.slots) {
      if (s.frame < 0) continue;                       // CS:0x3CD0 `js`
      drawn.push({ x: s.x - cam.x, y: s.y - cam.y,     // CS:0x3CD8/0x3CDC
                   sprite: SPRITE_BASE + s.frame });   // CS:0x3CE2
      s.frame += 1;                                    // CS:0x3CF7 — after the draw
      if (s.frame >= EXPIRE_AT) s.frame = -1;          // CS:0x3CFE
    }
    return drawn;
  }

  /** CS:0x8EC2 and its three siblings — level load and respawn free all four
   *  slots. Unlike leverToggle/spikeClock, this one IS reset per level. */
  clear() {
    for (const s of this.slots) s.frame = -1;
    return this;
  }

  get live() { return this.slots.reduce((n, s) => n + (s.frame >= 0 ? 1 : 0), 0); }
}
