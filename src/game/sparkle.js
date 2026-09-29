/* sparkle.js — DS:0xb578, the sparkle a collected pickup leaves behind.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────
 * treasure.js carried this as "NOT PORTED (cosmetic)": every walk-in pickup
 * seeds a slot in a 10-record effect array, and a main-loop walker draws a
 * seven-frame sparkle there. The port collected the object and drew nothing.
 *
 * ── THE CLEAR, CS:0x1221-0x1238 `[STATIC]` ───────────────────────────────
 *     1221  di = 0xb578 ; cx = 10 ; ax = 0xffff
 *     122C  stosw / stosw / add di,6 / loop   ; x AND y = 0xFFFF, stride 10
 *     1233  mov byte [0x396],0                ; nothing live
 * Called from the level load (CS:0x8E3A, inside FUN_1000_8c34) and from the
 * level-three pool reset (CS:0x69A4, FUN_1000_6992). Nothing else.
 *
 * ── THE SPAWN, CS:0x1239-0x127E `[STATIC]` ───────────────────────────────
 *     123B  si = 0xb578
 *     123E  cmp byte [0x396],0 / jz 1255     ; nothing live: take slot 0
 *     1245  cx = 10
 *     1248  cmp word [si],0 / js 1255        ; first free slot (x < 0)
 *     124D  add si,10 / loop                 ; none free: RETURN, no sparkle
 *     1255  ax += [0xa] ; bx += [0xc]        ; screen -> WORLD
 *     125D  [si]=ax [si+2]=bx [si+4]=cx [si+6]=6 [si+8]=0xfff4
 *     1277  mov byte [0x396],1
 * AX/BX are the object's screen position, the same pair the object walk
 * hands the contact test at CS:0x168E; adding the scroll back gives the
 * object's own world position. The `[0x396] == 0` shortcut is only a fast
 * path: the walker below leaves [0x396] non-zero whenever any slot was live
 * at the start of its pass, so "zero" really does mean every slot is free,
 * and the result is always the first free slot.
 *
 * ── THE WALKER, CS:0x1280-0x12CE `[STATIC]` ──────────────────────────────
 *     1280  cmp byte [0x396],0 / jz ret      ; fast out
 *     1287  cx = 10 ; si = 0xb578 ; [0x396] = 0
 *     1292  cmp word [si],0 / js next
 *     1297  inc byte [0x396]                 ; counts slots live at entry
 *     129B  ax = [si]-[0xa] ; bx = [si+2]-[0xc]   ; -> screen, every tick
 *     12A9  cx = [si+6] + 0x50               ; sprite = 80 + counter
 *     12B0  [0x4]=ax [0x6]=bx [0x8]=cx
 *     12BB  call 0x356e                      ; graphics EXPORT 2
 *     12C0  dec word [si+6] / jns next       ; AFTER the draw
 *     12C5  mov word [si],0xffff             ; spent -> free
 * The counter starts at 6, so a slot draws sprites 86, 85, ..., 80 on seven
 * consecutive ticks and then frees itself. `[si+4]` (the collected object's
 * `0xaa + type` sprite) and `[si+8]` (-12) are stored and never read here —
 * see treasure.js's UNKNOWN_sparkle_fields for how far that is established.
 *
 * ── WHO SPAWNS ONE — FUN_1000_177d, THREE CALLS ──────────────────────────
 *     CS:0x1848  category 0, after the consumable handler (CS:0x1829)
 *     CS:0x18D0  category 1, ORDINARY treasure only (after CS:0x18C0)
 *     CS:0x1949  a weapon pickup, after CS:0x94A7, whatever it returned
 * Not a chest (locked, unlocked or already open — CS:0x1910 bursts loot
 * instead), and not the crouch key pickup (CS:0x6069, a different routine).
 *
 * ── WHERE THE WALKER RUNS ────────────────────────────────────────────────
 * CS:0x0236 in the main loop, CS:0x0A0B in the death driver and CS:0x92A4 in
 * the respawn tick — each time right before ACT6's smoke (CS:0x3CC7), and
 * each time behind the same `cmp [0x34],0 / jnz` gate, so it is skipped
 * during a guardian fight. The pickup walk (CS:0x0206) runs earlier in the
 * same frame, so a sparkle first draws on the tick its object is collected.
 */

export const ARRAY_DS     = 0xb578;
export const SLOTS        = 10;     // CS:0x1245 `mov cx,0xa`
export const STRIDE       = 10;     // CS:0x124D `add si,0xa`
export const START        = 6;      // CS:0x126C `mov word [si],0x6`
export const SPRITE_BASE  = 0x50;   // CS:0x12AC `add cx,0x50` — 80
export const DRAW_EXPORT  = 2;      // CS:0x12BB `call 0x356e`

/** Frames a sparkle draws: counters 6..0, the draw preceding the `dec`. */
export const FRAMES = START + 1;    // 7

/** The first sprite drawn (counter 6) and the last (counter 0). */
export const SPRITE_FIRST = SPRITE_BASE + START;   // 86
export const SPRITE_LAST  = SPRITE_BASE;           // 80

/** The three FUN_1000_177d exits that call CS:0x1239. */
export const SPAWN_SITES = Object.freeze({ consumable: 0x1848, treasure: 0x18d0, weapon: 0x1949 });

export class Sparkles {
  constructor() {
    /* `x` doubles as the free flag: negative = free (CS:0x1248 `js`). */
    this.slots = Array.from({ length: SLOTS }, () => ({ x: -1, y: -1, counter: 0 }));
    this.dropped = 0;   // spawns that found all ten slots busy
  }

  /** CS:0x1239. `x`/`y` are the collected object's WORLD position. */
  spawn(x, y) {
    const s = this.slots.find((r) => r.x < 0);
    if (!s) { this.dropped++; return null; }      // CS:0x1252 — no sparkle
    s.x = x; s.y = y;
    s.counter = START;                            // CS:0x126C
    return s;
  }

  /** CS:0x1280. One tick. Returns the sparkles to draw, in screen space. */
  step(cam) {
    const drawn = [];
    for (const s of this.slots) {
      if (s.x < 0) continue;                      // CS:0x1295 `js`
      drawn.push({ x: s.x - cam.x, y: s.y - cam.y,           // CS:0x12A0/0x12A4
                   sprite: SPRITE_BASE + s.counter });       // CS:0x12AC
      s.counter -= 1;                             // CS:0x12C0 — after the draw
      if (s.counter < 0) s.x = -1;                // CS:0x12C5
    }
    return drawn;
  }

  /** CS:0x1221 — level load (CS:0x8E3A) and the level-three pool reset
   *  (CS:0x69A4). */
  clear() {
    for (const s of this.slots) { s.x = -1; s.y = -1; }
    return this;
  }

  get live() { return this.slots.reduce((n, s) => n + (s.x >= 0 ? 1 : 0), 0); }
}
