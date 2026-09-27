/* markers.js — DS:0xb5dc, the "attracts monsters" marker list.
 *
 * Feeds System-B pathfinder strategy 2 (pathfind-producers.js, SEED_STRATEGIES
 * n=2) and System-A's own marker-seek strategy (CS:0xe88c). Both read this
 * same list; only the append side lives here.
 *
 * ── WHERE THIS RUNS, AND WHY IT IS NOT GATED ON HERO CONTACT ────────────
 *
 * This was the one genuinely ambiguous point in this project's own prose
 * (CLAUDE.md's own closure calls it "every category 0/1/2 TOUCH", which reads
 * either way), so it was disassembled fresh rather than guessed:
 *
 *     CS:0x1511  the per-object body: ax=[si] (world X), bx=[si+2] (world Y),
 *                cx=[si+4] (type), dl=[bp+0] (the object's OWN fall-dirty
 *                byte, SS:0x438+slotIndex — objects.js's `fallDirty`)
 *     CS:0x152B  cmp byte [bp+0],0 / js       ; branches into the FALL
 *                physics (objects.js stepObjectFall) — unrelated to markers
 *     CS:0x15EC  ax=[si] ; bx=[si+2]           ; reload, fall-physics done
 *     CS:0x15F1  ax -= [0xa]                    ; -> SCREEN X
 *     CS:0x15F5  cmp cx,0xc0 / jl               ; type >= 0xC0 (weapon) ->
 *                jumps to 0x1da0, which appends a marker of its own (no
 *                category test) — an earlier revision said weapons never do.
 *     CS:0x1600  di = 0x2a4e + type*10          ; the runtime descriptor
 *     CS:0x160D  cmp byte [di+4],3 / jl 0x162e  ; CATEGORY < 3 -> marker path
 *     CS:0x162E  bx -= [0xc]                    ; -> SCREEN Y
 *     CS:0x1632  inc byte [0x398] ...           ; the append itself, below
 *
 * THIS IS THE SAME PER-OBJECT WALK THAT DRIVES FALL PHYSICS (objects.js),
 * gated the SAME way (o.flag6, on-screen) — NOT on `heroTouches`. So a
 * potion, treasure item, or key simply SITTING on screen appends a marker
 * every frame it is active, whether or not the hero is anywhere near it.
 * "Attracts monsters" does not attract them to what the hero just picked up;
 * it points them at whatever the marker buffer already holds — see below.
 *
 * ── THE APPEND, CS:0x1632-0x1668 `[PROVEN]` ─────────────────────────────
 *
 *     1632  inc byte [0x398]              ; the running count
 *     1636  cmp byte [0x398],0x14 / jg    ; > 20 -> SKIP THE WRITE (0x1669)
 *     163d  cmp dx,0x2d / jnz 0x1652       ; TYPE 45 ("attracts monsters")?
 *     1642  mov word [0x208],0xb5dc        ;   reset the cursor to the base
 *     1648  mov byte [0x398],0x14           ;   force the count to EXACTLY 20
 *     164d  mov byte [0x399],0x1             ;   force strategy 2, globally
 *     1652  di = [0x208]  (ES := DS)
 *     1659  stosw es:di                    ; write SCREEN X
 *     165e  stosw es:di                    ; write SCREEN Y
 *     1661  stosw es:di                    ; write the OBJECT'S OWN TYPE
 *     1664  [0x208] = di                   ; cursor advances 6 bytes, for good
 *
 * ⚠️ THE RECORD IS THREE FIELDS, NOT TWO. This closes UNKNOWN_marker_record —
 * pathfind.js's own note ("what the six bytes hold beyond {x,y} … is not
 * established") is answered: the third word is the touched object's TYPE.
 * Nothing in this port currently reads it back; it is carried anyway so a
 * future consumer does not need to re-derive the format.
 *
 * ⚠️⚠️ THE CAP DOES NOT WRAP, AND A TYPE-45 RESET ARMS EXACTLY ONE WRITE.
 * The increment happens FIRST, so on the frame a type-45 potion is touched:
 * the count is forced to 20 (not 0) and the write body runs UNCONDITIONALLY
 * right after — writing the POTION'S OWN position at slot 0. The very next
 * category<3 touch (this frame or any later one) increments the count to 21,
 * which exceeds 20, so the write is skipped — permanently, because nothing
 * ever decrements the count back down. So one type-45 pickup does not seed an
 * accumulating trail; it plants exactly ONE marker (its own spot) and then
 * the list is frozen until the NEXT type-45 pickup replants it.
 *
 * The other, more common way to have live markers needs no potion at all:
 * DS:0x398 starts at 0 on level load (cleared at CS:0x1437), so the first
 * ~20 category<3 objects the camera ever activates get recorded in the
 * ordinary course of play — and then the list freezes at whatever screen
 * offsets those objects had AT THAT MOMENT, forever, until a type-45 potion
 * resets it. Strategy 2, when rolled by the ordinary weighted-nibble picker
 * (CS:0xf6db) rather than the DS:0x399 override, paints THESE stale
 * screen-frozen positions — which can be nowhere near where those objects
 * or the hero are by the time an enemy actually acts on them.
 *
 * ── COORDINATES ARE SCREEN-RELATIVE, FROZEN AT WRITE TIME `[PROVEN]` ────
 *
 * The reader, CS:0xf7bb (pathfind.js's own SEED_STRATEGIES n=2), does:
 *     f7bb  mov cx,[si] / mov dx,[si+2] / call 0xf7dd
 * and 0xf7dd is graphics EXPORT 39 — the pixel -> visited-grid index, which
 * takes SCREEN coordinates with NO further camera subtraction anywhere in
 * its body. So the reader treats the stored bytes as screen coordinates
 * DIRECTLY, exactly matching how the writer produced them (CS:0x15F1/0x162E,
 * both a plain `sub ax,[0xa]` / `sub bx,[0xc]` against the camera AT WRITE
 * TIME). If the camera has scrolled since a marker was written, painting it
 * against the CURRENT camera reproduces exactly this staleness — which is
 * what the original does, not a bug to route around.
 *
 * A port must therefore NOT convert these back to world space and then let a
 * world-aware painter re-subtract the current camera (that silently drops
 * the staleness this mechanism actually has). pathfind-producers.js's own
 * `paintExport39(st, x, y)` takes WORLD coordinates for its other two callers
 * (idx 0/1, which genuinely are hero-relative); markers need the SCREEN-space
 * sibling, `paintExport39Screen`, added there for exactly this reason.
 */

/* MARKER_MAX and the type-45 constant are already owned by pathfind.js (its
 * own CS:0xf7ab/0xf799 clamp reads the SAME DS:0x398/0xb5dc this module
 * writes) — imported and re-exported here under this file's own name so a
 * caller of EITHER module gets the identical value, not two constants that
 * happen to agree today. */
import { MARKER_MAX, ATTRACT_POTION_TYPE as ATTRACT_TYPE } from './pathfind.js';
export { MARKER_MAX, ATTRACT_TYPE };

export const MARKER_ARRAY_DS = 0xb5dc;     // CS:0xf7b3 / CS:0x1642
export const MARKER_STRIDE = 6;            // {i16 screenX, i16 screenY, i16 type}
export const COUNTER_CLEAR_SITE = 0x1437;  // level load
export const DISTRACT_TYPE = 0x2e;         // 46 — "distracts monsters" — same append, no reset

export class MarkerList {
  constructor() {
    this.entries = [];      // DS:0xb5dc, up to MARKER_MAX {x, y, type} records
    this.count = 0;         // DS:0x398 — an unbounded counter, NOT entries.length
    this.override = false;  // DS:0x399 — force every System-B enemy onto strategy 2
  }

  /** CS:0x1432-0x1441 — cleared at the head of every object walk. */
  reset() {
    this.entries = [];
    this.count = 0;
    this.override = false;
  }

  /**
   * CS:0x1632-0x1668. Call once per on-screen (flag6) category<3 object,
   * every frame it is active — NOT gated on the hero touching it.
   * @param {number} screenX  world X minus the CURRENT camera (CS:0x15F1)
   * @param {number} screenY  world Y minus the CURRENT camera (CS:0x162E)
   * @param {number} type     the object's own POBJECTS type
   */
  append(screenX, screenY, type) {
    this.count++;                                    // 1632
    if (this.count > MARKER_MAX) return;              // 1636/163b — permanently
                                                       // blocked until a reset
    if (type === ATTRACT_TYPE) {                      // 163d
      this.entries = [];                              // 1642 — cursor := base
      this.count = MARKER_MAX;                        // 1648 — NOT zero
      this.override = true;                           // 164d
    }
    /* 1652-1664 — the write always runs here, including on the SAME object
     * that just triggered the type-45 reset above: a potion's own position
     * becomes marker[0]. Beyond MARKER_MAX entries the original would still
     * advance its raw byte pointer forever; this port just stops appending,
     * which is observationally identical since count can never legally
     * re-enter [0, MARKER_MAX] without another type-45 reset. */
    this.entries.push({ x: screenX, y: screenY, type });
  }
}

/**
 * CS:0x1511-0x1668, the category<3 half of the per-object walk. Runs BEFORE
 * `stepPickups`' own hero-contact tests (matching the original's own
 * instruction order — this dispatch sits ahead of CS:0x177D in the same
 * per-object body), over every on-screen object regardless of hero
 * proximity. Weapons (type >= 0xC0, CS:0x15F5) and dead/off-screen records
 * never reach this — same `o.flag6 & 1` gate objects.js's fall physics uses.
 *
 * @param {Array} objects   level.drawObjects
 * @param {Uint8Array} cats level.cats — POBJECTS category per type
 * @param {MarkerList} markerList
 * @param {{x:number,y:number}} cam  the SNAPPED camera (DS:0xa / DS:0xc)
 */
export function stepMarkers(objects, cats, markerList, cam) {
  /* CS:0x1432-0x1441 — the object walk's own head clears DS:0x398/0x399/
   * 0x39a and rewinds the write pointer DS:0x208 to 0xb5dc on EVERY tick, so
   * the list holds only this tick's on-screen objects. [PROVEN] live against
   * PJOYL2 2092 (DS:0x398 = 1, one marker). The port used to clear it only
   * on level load, and the pathfinder chased 20 stale copies of one object. */
  markerList.reset();
  if (!cats) return;
  for (const o of objects) {
    if (o.dead || !(o.flag6 & 1)) continue;             // CS:0x1554-ish gate
    if (o.type < 0) continue;
    /* CS:0x15F5 sends weapons (type >= 0xC0) to CS:0x1DA0, which appends a
     * marker too — with NO category test (an earlier revision skipped them).
     * [PROVEN] live against PJOYL3 736: DS:0x398 = 5 with a weapon on screen
     * where the port had counted 4. */
    if (o.type < 0xC0) {
      const cat = cats[o.type];
      if (cat === undefined || cat >= 3) continue;      // 160D `jl`
    }
    markerList.append(o.x - cam.x, o.y - cam.y, o.type); // 15F1/162E/1632
  }
  /* CS:0x14B8-0x14BF — after the walk an "attracts monsters" override
   * leaves the count at 1: only the potion itself (marker 0) is read. */
  if (markerList.override) markerList.count = 1;
}
