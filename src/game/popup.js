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
 * `UNKNOWN_popup_reward_not_collectable` — CLOSED. This module used to
 * render the arc and then throw the reward away, so every System-A,
 * System-B, selector-2, nest and statue kill award in the port was a
 * picture that vanished. It now queues a LANDING (`this.landed`), which
 * main.js drains into objects.js's `dropCarriedItem` — the same allocator
 * the selector-1 PAT drop and steal-and-carry already use. Rewards are
 * items again.
 *
 * THE BUSY-SLOT DIVERT, CS:0xBF6B — a second `spawn()` while the single
 * slot (DS:0x1a0) is busy does not queue and does not lose the item: it
 * jumps straight to CS:0xC041 and lands immediately, where it was awarded.
 * That now goes through the same `landed` queue rather than an optional
 * `objects` argument, so every landing re-ranks the draw order the same way
 * (the old direct-call path skipped that).
 */

export const POPUP_VY = -6;                 // CS:0xBF75, the seeded Y-velocity
export const POPUP_SPRITE_BASE = 170;        // the object-sprite formula, `170 + type`
export const WEAPON_SPRITE_BASE = 0x12e;     // CS:0xC004 `add cx,0x12e` — 302
export const WEAPON_ID_MAX = 0xb;            // CS:0xBF96 `cmp cx,0xb / jl`
/* THE TWO ARC LENGTHS. The ordinary branch runs until the velocity reaches
 * 5 (CS:0xBFD7 `cmp [0x22a],5 / jl`), the WEAPON branch only until 4
 * (CS:0xC026 `cmp [0x22a],4 / jge`) — they are separate tails, not one
 * shared loop, and the constants really do differ. So an ordinary item is
 * airborne 11 ticks and rises a net 11px; a weapon 10 ticks and 15px. */
export const LAND_VY_OBJECT = 5;
export const LAND_VY_WEAPON = 4;
/* CS:0xBF5F `cmp cx,0x3d / jz bf59` — id 61 (POBJECTS type 50, "spike arc")
 * skips the toss entirely: `and bx,0xfff0` snaps it to the 16px tile row and
 * jumps straight to the CS:0xC041 landing. */
export const SNAP_ID = 0x3d;

export class Popup {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.id = null;          // the RAW id — the weapon/object split needs it
    this.vy = 0;             // DS:0x22a
    this.itemType = null;    // POBJECTS type, or null on the weapon branch
    /* Landings waiting for the host to turn into real objects. Queued rather
     * than allocated here so every landing goes through main.js's own
     * `dropCarriedIntoWorld`, which re-ranks the draw order — the old direct
     * `dropCarriedItem` call on the busy-divert path did not, so a diverted
     * item could draw out of order. */
    this.landed = [];
  }

  /** A LANDING, CS:0xC041. `land` is how the host turns a reward into a real
   *  object. Pass it and the landing happens INLINE, which is what the
   *  original does at every one of these sites: CS:0xBF6B and CS:0xBF59 both
   *  jump straight into CS:0xC041, and the arc's own terminator falls into it
   *  — so the object exists for the REST of the frame and anything that runs
   *  later (a steal probe, another channel's collision) can see it. Omit it
   *  and the landing is queued on `landed` instead, which is the shape the
   *  invariant suite drives this class in. Deferring in the real game would
   *  be a divergence, not a simplification. */
  #settle(land, id, x, y) {
    if (land) land(id, x, y);
    else this.landed.push({ id, x, y });
  }

  /** CS:0xBF5F/0xBF64. `id` is the raw id (the caller has already rejected
   *  negatives). Returns true if the toss slot was taken, false if the
   *  request was diverted straight to a landing. */
  spawn(worldX, worldY, id, land) {
    if (id === SNAP_ID) {                                    // CS:0xBF5F `jz bf59`
      this.#settle(land, id, worldX, worldY & 0xfff0);       // CS:0xBF59
      return false;
    }
    if (this.active) {
      /* CS:0xBF6B — a second request while the single slot (DS:0x1a0) is
       * busy does NOT lose the item and does NOT queue behind the first: it
       * jumps straight to CS:0xC041 and lands immediately, right where it
       * was awarded. */
      this.#settle(land, id, worldX, worldY);
      return false;
    }
    this.active = true;
    this.x = worldX;
    this.y = worldY;
    this.id = id;
    this.vy = POPUP_VY;                                      // CS:0xBF75
    this.itemType = id >= WEAPON_ID_MAX ? id - WEAPON_ID_MAX : null;
    return true;
  }

  /** CS:0xBF80-0xBFEF (ordinary) / CS:0xC004-0xC03B (weapon).
   *  Order matters and is the original's: apply the velocity, store, draw,
   *  THEN increment and test — so the frame that lands is drawn at the
   *  landing position, and the object is created there too. */
  step(land) {
    if (!this.active) return;
    this.y += this.vy;                                       // CS:0xBF8E / 0xC008
    this.vy += 1;                                            // CS:0xBFD3 / 0xC022
    const limit = this.id < WEAPON_ID_MAX ? LAND_VY_WEAPON : LAND_VY_OBJECT;
    if (this.vy >= limit) {
      /* CS:0xBFE9/0xC03B free the slot, then fall into CS:0xC041 — which is
       * where the reward stops being a picture and becomes an item. */
      this.#settle(land, this.id, this.x, this.y);
      this.active = false;
      this.id = null;
      this.itemType = null;
    }
  }

  /** The sprite drawn DURING the toss. Two branches, and the weapon one was
   *  the piece this project had recorded as undecodable:
   *    id >= 0xB : CS:0xBFAB, the POBJECTS descriptor sprite, 170 + type
   *    id <  0xB : CS:0xC004, `0x12E + id` — the weapon's own icon. */
  get spriteId() {
    if (!this.active) return null;
    if (this.itemType === null) return WEAPON_SPRITE_BASE + this.id;
    return POPUP_SPRITE_BASE + this.itemType;                 // CS:0xBFAB
  }
}
