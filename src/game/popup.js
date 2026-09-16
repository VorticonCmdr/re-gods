/* popup.js — the floating item-icon popup, CS:0xBF5F/0xBF80.
 *
 * A SINGLE-SLOT effect (`DS:0x1a0` holds the active id or a negative sentinel
 * when free — there is exactly one popup on screen at a time in the original,
 * never a list). It is the shared landing spot for every "award an item icon
 * that floats up from a kill" mechanic this project documents:
 *   - the world-2 nest's own death award (CLAUDE.md's `game/nest.js`, id 0x2D)
 *   - System-B's per-GROUP elimination reward (`UNKNOWN_f030_item_drop`,
 *     descriptor +0x10 — see spawn.js's own `rewardId` field)
 *   - the selector-2 spawner's own per-GROUP elimination reward
 *     (`CS:0xAED0`-`0xAF0F`, `game/selector2.js`'s own `rewards` array)
 *
 * THE ID ENCODING, CS:0xBF5F/0xBF96 — verbatim from CLAUDE.md's own decode:
 *   negative        -> (handled by the CALLER: "no reward", never reaches
 *                        this module at all)
 *   0 .. 0xA        -> ⚠️ NOT a "plain numeric popup". That reading — which
 *                       this header, spawn.js and CLAUDE.md all carried, and
 *                       which called the branch "a genuine UNKNOWN" — is
 *                       WRONG, and it is why the port dropped no weapons.
 *                       CS:0xC004 is `ADD CX,0x12E`: the id IS a WEAPON
 *                       INDEX and the popup sprite is `0x12E + id`. The
 *                       confirmation is that CS:0x1DC6, the weapon-object
 *                       DRAW path, computes the identical sprite the long
 *                       way round — `SUB CX,0xC0 / ADD CX,0x12E` — so both
 *                       sites agree that weapon index i draws as 0x12E + i.
 *                       And CS:0xC075, where the arc finally lands, creates
 *                       the real object as `type = id + 0xC0`: object type
 *                       192 for id 0, which POBJECTS/PWEAPONS both name
 *                       "knife". PLEV1A's class-2 flying monster carries
 *                       id 0 — the second knife that takes the hero's
 *                       volley from one to two.
 *   0xB and above   -> a POBJECTS icon, `sprite = 170 + (id - 0xB)`
 *                       (CS:0xBF9B/0xBFAB, this project's own already-
 *                       established `170 + type` object-sprite formula).
 *                       Two special-cased sprites (279/280, `"magical gem"`/
 *                       `"treasure chest"`, drawn 8px higher through a
 *                       SIBLING blitter) are documented but not modelled
 *                       here — this project's own census found them
 *                       unreachable in every shipped call site anyway
 *                       (`UNKNOWN_bf5f_special_sprite_callers` — CLOSED
 *                       negative, exhaustive).
 *
 * MOTION — ⚠️ ALSO CORRECTED, and the correction changes what this effect
 * IS. The velocity at DS:0x22a is seeded to -6 (CS:0xBF75) but then
 * INCREMENTED once per tick (CS:0xBFD3 `INC word [0x22a]`), so the item
 * arcs: up, over, down. It is not an icon floating away forever. When the
 * velocity reaches +5 (CS:0xBFD7 `CMP [0x22a],5 / JL`), the slot is freed
 * (`[0x1a0] := 0xFFFF`) and CS:0xC041 runs at the landing point, allocating
 * a REAL, COLLECTABLE OBJECT — a dead-slot reuse via CS:0x38D7, `flag6 := 1`
 * and the fall sentinel armed. `UNKNOWN_popup_cull` is therefore CLOSED: the
 * lifetime is the arc, and the arc terminates in an object.
 *
 * ⚠️ WHAT THIS PORT STILL DOES NOT DO. This module renders the arc as a
 * transient icon only; it does not run CS:0xC041 at the end of it, so a
 * System-A/System-B/selector-2/nest group-elimination reward is still a
 * visual that vanishes rather than an item the hero can pick up. The
 * selector-1 PAT group drop DOES land as a real object — see main.js's own
 * `patGroups.drops` drain, which calls objects.js's `dropCarriedItem`
 * directly. Bringing the other three callers onto that same path is a
 * separate, larger change: `UNKNOWN_popup_reward_not_collectable`.
 *
 * THE BUSY-SLOT DIVERT, CS:0xBF6B — CLOSED. A second `spawn()` call while
 * the slot is busy diverts, in the original, straight to `CS:0xC041` — the
 * SAME "drop a real, solid object back into the world" allocator
 * steal-and-carry's own periodic/death-time drops use (`objects.js`'s
 * `dropCarriedItem`). Wired here as an OPTIONAL 4th argument (`objects`):
 * every existing caller that doesn't pass one keeps the old "drop the
 * request" behaviour, since C041 needs the live 200-slot runtime array this
 * module has no reference to on its own.
 */

import { dropCarriedItem } from './objects.js';

export const POPUP_VY = -6;                 // CS:0xBF7B, the seeded Y-velocity
export const POPUP_SPRITE_BASE = 170;        // the object-sprite formula, `170 + type`
export const POPUP_OFFSCREEN_CULL = 400;     // a disclosed safety valve, see the header

export class Popup {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.itemType = null;    // POBJECTS type, or null for the unrendered numeric branch
  }

  /** CS:0xBF5F/0xBF64. `id` is the raw popup id (already checked non-negative
   *  by the caller). Returns false if the slot was already busy — the
   *  caller's own reward is simply lost UNLESS `objects` (the 200-slot
   *  runtime array, objects.js) is supplied, in which case a busy slot
   *  diverts to `dropCarriedItem` instead (CS:0xBF6B `jmp c041`), matching
   *  the original exactly rather than losing the item. */
  spawn(worldX, worldY, id, objects) {
    if (this.active) {
      if (objects) dropCarriedItem(objects, id, worldX, worldY);   // CS:0xBF6B
      return false;                                          // CS:0xBF64 `js`
    }
    this.active = true;
    this.x = worldX;
    this.y = worldY;
    this.itemType = id >= 0xb ? id - 0xb : null;             // CS:0xBF96/0xBF9B
    return true;
  }

  /** CS:0xBF80-0xBF92. */
  step() {
    if (!this.active) return;
    this.y += POPUP_VY;
    if (this.y < -POPUP_OFFSCREEN_CULL) this.active = false;   // see the header's UNKNOWN_popup_cull note
  }

  /** null while inactive, or while the id fell in the undecoded numeric
   *  range (see the file header). */
  get spriteId() {
    if (!this.active || this.itemType === null) return null;
    return POPUP_SPRITE_BASE + this.itemType;                 // CS:0xBFAB
  }
}
