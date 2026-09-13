/* inventory-panel.js — the 4-slot crouch/inventory HUD strip.
 *
 * PROVENANCE
 *   Three GAME.EXE functions, all freshly disassembled this pass (Ghidra
 *   `disassemble_function`/`disassemble_bytes`, not decompiled — the pseudo-C
 *   hides the shared {[0x4]=x,[0x6]=y,[0x8]=spriteId} draw-call convention
 *   this whole module depends on):
 *
 *     FUN_1000_1e1a (1000:1e1a) — draws the panel: 4 slot frames, then the
 *       4 held-item icons.
 *     FUN_1000_1f5a (1000:1f5a) — commits a pending slot-selector change
 *       (DS:0x367 -> DS:0x366) and marks the panel dirty.
 *     FUN_1000_228e (1000:228e) — the shared "mark panel dirty" helper both
 *       1f5a and the pickup/level-load paths call.
 *     FUN_1000_1dd1 / FUN_1000_1e06 (1000:1dd1 / 1000:1e06) — arm the
 *       highlight-visibility counter to extend / retract (see below).
 *     FUN_1000_1ee3 (1000:1ee3) — draws one held item's own icon; called
 *       from 1e1a's second loop.
 *
 *   ⚠️ NOT A CROUCH-ONLY POPUP. The main loop calls this UNCONDITIONALLY,
 *   every tick, regardless of player state:
 *
 *     CS:0x02BD  call 0x1000:dc37   ; the line-hazard step (already documented)
 *     CS:0x02C0  call 0x1000:1f5a   ; commit pending selector      <- this module
 *     CS:0x02C3  call 0x1000:1e1a   ; draw the panel               <- this module
 *     CS:0x02C6  call 0x1000:0dff   ; the health-bar chase (already documented)
 *
 *   straight-line code in FUN_1000_006f, no branch around it. So the 4 slot
 *   frames and whatever icons the inventory holds are drawn EVERY frame —
 *   "the panel stays extended only in states 18/19" (this project's own
 *   earlier notes on states 18/19) describes the HIGHLIGHT's visibility, not
 *   the panel's own presence; see the extend/retract note below.
 *
 *   Screen position — read directly off FUN_1000_1e1a's own bytes, absolute
 *   320x200 screen coordinates (the same {[0x4],[0x6],[0x8]} convention this
 *   project already establishes for the hero, every entity, every projectile
 *   and every popup — never an off-screen compositing buffer):
 *
 *     1e5f  add ax,0x60           ; screenX0 := 0x60 (96) — DS:0x33 bit2 would
 *                                 ;   pick 0x64 (100) instead; see "NOT PORTED"
 *     1e65  mov word[0x6],0x3     ; screenY := 3, for the slot frames
 *     1e7c  mov bx,0x74           ; slot-frame sprite := 0x74 (116)
 *     1e7f..1eb7  4 slots, CALL 0x3569 (export 1) each, screenX += 0x20 (32)
 *     1eb9  sub word[0x4],0x78    ; -> screenX0 + 0x8 for loop 2 (96+8=104)
 *     1ec5  mov word[0x6],0x4     ; screenY := 4, for the item icons
 *     1ec4..1ed7  4 slots, CALL 0x1ee3 each (which itself ends CALL 0x356e,
 *                 export 2 — a DIFFERENT masked blitter than the slot frames
 *                 use; this project's own driver table already records
 *                 exports 1/2 as differing only in clip bounds, so a canvas
 *                 port with automatic clipping may use one blitter for both)
 *
 *   So the panel sits near the TOP of the screen (rows 3-20ish), well clear
 *   of the bottom 40-row status band (`PANEL_Y0=160` in status-panel.js) —
 *   genuinely a separate HUD element, not baked into PSTATUS/PSTAT3's own
 *   art. This is a new finding: no earlier pass of this project located the
 *   per-tick call site, so the panel's on-screen position was never
 *   previously established.
 *
 *   THE HIGHLIGHT. The slot equal to the current selector (DS:0x366) draws
 *   sprite 0x73 (116-1, "highlighted") instead of 0x74, but only while a
 *   small saturating counter/delta pair says the panel is "extended":
 *
 *     1e88  cmp dl,[0x366] / jnz 1ea5      ; not the selected slot -> plain frame
 *     1e8e  cmp byte[0x350],1 / jl 1ea5    ; counter < 1            -> plain frame
 *     1e95  cmp byte[0x352],0 / js 1ea5    ; delta negative (retracting) -> plain
 *     1e9c  dec word[0x8]                  ; else -> sprite 0x73 (0x74-1)
 *
 *   DS:0x350 (0..12, saturating both ends) / DS:0x352 (+-1) have exactly
 *   three writers in the whole binary (`search_instructions` on both
 *   operands, program-wide): FUN_1000_1dd1 (EXTEND), FUN_1000_1e06
 *   (RETRACT), and FUN_1000_1e1a's own per-call chase-step; FUN_1000_8c34
 *   (level load) seeds both to 0. Nothing else anywhere reads DS:0x350's
 *   magnitude — it exists purely to gate this one highlight boolean via the
 *   `>=1` threshold, so this port reproduces the counter/delta pair exactly
 *   (cheap, and keeps the door open for an actual slide animation later)
 *   without claiming the magnitude means anything else.
 *
 *     FUN_1000_1dd1 (EXTEND):
 *       1dd4  cmp byte[0x350],0 / jns 1ded   ; counter negative?
 *       1ddb    counter := 0 ; delta := +1    ; yes -> reset and start extending
 *       1ded  cmp byte[0x350],0xc / jz ret     ; already at the cap -> nothing
 *       1df4  cmp byte[0x352],0 / jns ret       ; already extending -> nothing
 *       1dfb    delta := +1                      ; was retracting -> flip
 *     FUN_1000_1e06 (RETRACT):
 *       1e06  delta := -1
 *       1e0b  counter -= 1 ; if counter < 0, counter := 0   ; a DIRECT step,
 *                                                            ; taken every call
 *     FUN_1000_1e1a's own chase-step, taken every call regardless of state:
 *       1e1a  if counter is negative, or counter == 12, skip;
 *             else counter += delta
 *
 *   EXTEND is armed from CS:0x6139, inside the crouch(+FIRE-tap slot-cycle)
 *   handler reached only from states 18/19 — called once per CROUCH tick,
 *   unconditionally (not gated on any button). RETRACT is armed from
 *   CS:0x499A/0x49A7, the player state-machine's own dispatch gate that runs
 *   FUN_1000_1e06 for every state EXCEPT 18/19 — called once per NON-crouch
 *   tick. Net per tick: crouching advances the counter by +1 (only via
 *   1e1a's own step, since 1e06 didn't run); not crouching advances it by -2
 *   (1e06's own direct step, THEN 1e1a's chase-step, both applying delta=-1
 *   in the same tick) until it saturates at 0. Reproduced verbatim below via
 *   `InventoryPanel#step(crouching)`, called once per game tick regardless
 *   of state (mirroring FUN_1000_1e1a itself).
 *
 *   THE ITEM ICON, FUN_1000_1ee3:
 *     1ee3  di = 0x2a4e + type*10          ; the runtime object-descriptor
 *                                          ;   array (already documented
 *                                          ;   elsewhere in this project)
 *     1ee6  ax = type << 1 ; js -> RET     ; type == INVENTORY_EMPTY (0xffff)
 *                                          ;   -> draw nothing (a 1-byte
 *                                          ;   shared RET at 1ee2, borrowed
 *                                          ;   from FUN_1000_1e1a's own tail)
 *     1ef2  dx = descriptor[+0]             ; the stamped sprite id (170+type)
 *     1ef7  cmp dx,0x117(279)/cmp dx,0x118(280)   ; two special-cased ids —
 *       dx==279 -> dx := 0xb7 (183)         ;   the "magical gem"/"treasure
 *       dx==280 -> dx := 0xcc (204)         ;   chest" POPUP-only icon sprites
 *                                           ;   (CS:0xBF5F, already documented
 *                                           ;   elsewhere) get a SEPARATE,
 *                                           ;   smaller icon variant here —
 *                                           ;   this panel never draws 279/280
 *                                           ;   directly.
 *     1f1c  ax = 0x10 - descriptor_arena[finalSprite].heightMinus1
 *     1f22  ax = ax >> 1 (arithmetic)       ; center a variable-height icon
 *     1f24  screenY += ax                   ;   against a nominal 16px band
 *     1f28  call 0x356e                      ; export 2
 *
 *   The plate comment recorded on FUN_1000_1e1a in this project's Ghidra
 *   database says the DS:0x33-bit2 UI-mode flag stages an alternate base
 *   pointer "into a DS:0x0 scratch word -- consumed by something inside loop
 *   2, not traced further here." Direct inspection of FUN_1000_1ee3's own
 *   34 instructions this pass finds NO reference to address 0 anywhere in
 *   it — so that scratch word has no observable effect on either function
 *   this panel calls, and whatever consumes it is a different subsystem
 *   entirely. Its consumer remains unidentified; that no longer matters for
 *   this panel's own rendering.
 *
 *   NOT PORTED (disclosed, not silently dropped):
 *
 *   - DS:0x33 bit 2 — an unidentified UI-mode flag that would shift the
 *     panel 4px right (screenX0 0x64 instead of 0x60) and swap which of two
 *     dirty flags (DS:0x3bb/0x3bc) gates the panel's own early-out. This
 *     port always draws (see below), so the dirty-flag half is moot; the 4px
 *     shift is skipped, defaulting to the bit-clear (0x60) position, since
 *     the flag's real meaning was never established anywhere in this
 *     project and 0x60 is what ordinary gameplay uses on the evidence in
 *     hand (bit2 clear is the fallthrough path, not a special-cased branch).
 *   - DS:0x3bb/DS:0x3bc, the panel's own dirty-repaint flags (FUN_1000_228e,
 *     FUN_1000_1f5a) — irrelevant to a full-redraw canvas renderer, exactly
 *     the same disclosed cut status-panel.js's own header already carries
 *     for its equivalent flag. This module always draws every call.
 *   - THE FIRE-TAP SLOT CYCLE, CS:0x612F-0x619D. Real trigger, read off the
 *     bytes this pass (not up/down, as an earlier design note in this
 *     project guessed): tapping FIRE while crouching with no key under the
 *     hero's hot point advances the selector `(DS:0x366+1) & 3` and shows
 *     the newly-selected item's name via the message system, debounced by a
 *     "handled this press" flag shared with the key-pickup path (a key
 *     pickup this same tick suppresses a cycle so one press can't do both).
 *     Unported — this needs its own input plumbing and message-popup wiring
 *     this project does not yet have for this panel. Consequence: `selector`
 *     never leaves slot 0 in this port.
 *   - CS:0x61A1, "drop whatever the selected slot holds" on crouch exit —
 *     already flagged as unported elsewhere in this project (player.js's own
 *     module comment); unaffected by this pass.
 *   - `collectKey` (pickup.js) is DELIBERATELY LEFT AS ITS EXISTING
 *     first-empty-slot substitution, not reverted to the original's "always
 *     overwrite the current selector" (CS:0x6100-0x610D). Now that the real
 *     trigger for moving the selector is known (FIRE-tap cycling, itself
 *     unported per above), reverting would make every second key permanently
 *     overwrite the first with the selector pinned at slot 0 forever — worse
 *     than the existing substitution, not more faithful to it.
 */

import { INVENTORY_EMPTY, INVENTORY_SLOTS } from './treasure.js';
import { spriteForType } from './objects.js';

/** CS:0x1e7c / CS:0x1e9c — the plain and highlighted ("selected") slot-frame
 *  sprites. The highlighted one is always base-1, never looked up separately. */
export const SLOT_FRAME_SPRITE = 0x74;
export const SLOT_FRAME_HIGHLIGHT_SPRITE = SLOT_FRAME_SPRITE - 1;

/** CS:0x1eb0/0x1ed2 — 0x20px between slots, both loops, 4 slots (INVENTORY_SLOTS). */
export const PANEL_SLOT_SPACING = 0x20;

/** CS:0x1e5f/0x1e65 — the slot-frame loop's own origin (DS:0x33 bit2 clear). */
export const PANEL_FRAME_X0 = 0x60;
export const PANEL_FRAME_Y = 3;

/** CS:0x1eb9/0x1ec5 — the item-icon loop's own origin, 8px right of the frames. */
export const PANEL_ICON_X0 = PANEL_FRAME_X0 + 8;
export const PANEL_ICON_Y = 4;

/** CS:0x1ef7-0x1f0a — the two popup-only icon sprites get a smaller dedicated
 *  variant when shown in this panel instead of their own (raised, larger)
 *  floating-popup sprite. Keyed by the ordinary `170+type` stamped sprite id. */
const ICON_REMAP = { 0x117: 0xb7, 0x118: 0xcc };

/** CS:0x1e21/0x1e93 — the counter's saturation cap; below 1 the highlight hides. */
const COUNTER_MAX = 0xc;
const COUNTER_HIGHLIGHT_MIN = 1;

/**
 * Resolve one inventory slot's raw POBJECTS type to a drawable sprite id, or
 * `null` for an empty slot / a type with no atlas frame. Mirrors
 * FUN_1000_1ee3's own dx remap (1ef7-0x1f0a); the height-centering offset is
 * applied by the caller, since it needs the resolved frame's own height.
 * @param {number} type raw inventory slot value (INVENTORY_EMPTY or a
 *   POBJECTS type — always a key, category 2, per pickup.js's `collectKey`)
 * @returns {?number} sprite id into `hero.frames`
 */
export function panelIconSprite(type) {
  if (type === INVENTORY_EMPTY) return null;
  const sprite = spriteForType(type);
  return Object.prototype.hasOwnProperty.call(ICON_REMAP, sprite) ? ICON_REMAP[sprite] : sprite;
}

/**
 * The panel's own extend/retract highlight-visibility state — DS:0x350
 * (counter) / DS:0x352 (delta). See the PROVENANCE header for the exact
 * per-function step shapes this reproduces.
 */
export class InventoryPanel {
  constructor() {
    /** DS:0x366 — which slot draws highlighted. FIRE-tap cycling (CS:0x615F)
     *  is unported (see header), so this never leaves 0 in this port. */
    this.selector = 0;
    this.counter = 0;   // DS:0x350
    this.delta = 0;     // DS:0x352
  }

  /** FUN_1000_1dd1 — arm EXTEND. Called once per CROUCH tick (CS:0x6139). */
  _extend() {
    if (this.counter < 0) {
      this.counter = 0;
      this.delta = 1;
      return;
    }
    if (this.counter === COUNTER_MAX) return;
    if (this.delta < 0) this.delta = 1;
  }

  /** FUN_1000_1e06 — arm RETRACT, with its own direct one-step decrement.
   *  Called once per NON-crouch tick (CS:0x499A/0x49A7's dispatch gate). */
  _retract() {
    this.delta = -1;
    this.counter -= 1;
    if (this.counter < 0) this.counter = 0;
  }

  /** FUN_1000_1e1a's own chase-step, CS:0x1e1a-0x1e2e — taken unconditionally
   *  on every call, crouching or not. */
  _chaseStep() {
    if (this.counter < 0 || this.counter === COUNTER_MAX) return;
    this.counter += this.delta;
  }

  /**
   * Advance the highlight animation by one game tick. Call this once per
   * tick regardless of player state — mirrors the real per-tick shape
   * exactly (extend/retract runs from the state dispatch, the chase-step
   * runs unconditionally from the same-tick draw call).
   * @param {boolean} crouching `player.state === ST.CROUCH`
   */
  step(crouching) {
    if (crouching) this._extend(); else this._retract();
    this._chaseStep();
  }

  /** CS:0x1e88-0x1e9a — is `slot` drawn with the highlighted frame right now? */
  isHighlighted(slot) {
    return slot === this.selector &&
      this.counter >= COUNTER_HIGHLIGHT_MIN &&
      this.delta >= 0;
  }
}

/**
 * Draw the 4-slot panel: slot frames (highlighted on the selected one, gated
 * by `panel`'s own extend/retract state) then held-item icons. Runs
 * UNCONDITIONALLY every frame — see the PROVENANCE header's CS:0x02C0/0x02C3
 * finding — not just while crouching.
 * @param {import('../render/renderer.js').Renderer} renderer
 * @param {Array<{w:number,h:number,pixels:Uint8Array}>} frames `hero.frames`
 * @param {number[]} inventory the 4-slot array (treasure.js), raw POBJECTS
 *   types or INVENTORY_EMPTY
 * @param {InventoryPanel} panel
 */
export function drawInventoryPanel(renderer, frames, inventory, panel) {
  if (!frames) return;
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const sprite = panel.isHighlighted(slot) ? SLOT_FRAME_HIGHLIGHT_SPRITE : SLOT_FRAME_SPRITE;
    const frame = frames[sprite];
    if (frame) renderer.blitSprite(frame, PANEL_FRAME_X0 + slot * PANEL_SLOT_SPACING, PANEL_FRAME_Y);
  }
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const sprite = panelIconSprite(inventory[slot]);
    if (sprite === null) continue;
    const frame = frames[sprite];
    if (!frame) continue;
    /* CS:0x1f1c-0x1f24 — center a variable-height icon against a nominal
     * 16px band: `(16 - (h-1)) >> 1`, arithmetic shift (SAR), added to Y. */
    const iconY = PANEL_ICON_Y + ((17 - frame.h) >> 1);
    renderer.blitSprite(frame, PANEL_ICON_X0 + slot * PANEL_SLOT_SPACING, iconY);
  }
}
