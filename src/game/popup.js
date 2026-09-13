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
 *   0 .. 0xA        -> a PLAIN NUMERIC popup (CS:0xC004). CLAUDE.md's own
 *                       words: "not chased further" — this is a genuine
 *                       UNKNOWN, not merely unported, so this module does
 *                       NOT render this branch rather than guess a sprite
 *                       for it. `spawn()` still occupies the single slot
 *                       (matching the original's own slot-occupancy rule),
 *                       it simply never yields a `spriteId`.
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
 * MOTION, CS:0xBF6E/0xBF87-92: `y += -6` every tick, uncapped in the bytes
 * this project has read. No cull or lifetime is established from the binary
 * — `UNKNOWN_popup_cull` — so this port's own off-screen-height cull below
 * is a disclosed SAFETY VALVE against an eternal floating icon, not a
 * decoded mechanism; flagged rather than presented as proven.
 *
 * NOT MODELLED: a second `spawn()` call while the slot is busy diverts, in
 * the original, to the "steal-and-carry" object-respawn routine (`CS:0xC041`
 * — drop a REAL, solid object back into the world). That mechanic is not
 * ported anywhere in this project (steal-and-carry itself is unported), so
 * this module's own `spawn()` simply drops the new request when busy — an
 * honest simplification, not a silent behavioural change from a modelled
 * original path.
 */

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
   *  caller's own reward is simply lost, matching the original's "consumed
   *  either way" semantics for the group-elimination trigger this feeds. */
  spawn(worldX, worldY, id) {
    if (this.active) return false;                          // CS:0xBF64 `js`
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
