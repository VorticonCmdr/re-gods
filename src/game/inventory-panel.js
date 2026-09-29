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
 *   SCREEN POSITION — PANEL-LOCAL, NOT ABSOLUTE. ⚠️ RETRACTION: an earlier
 *   version of this header read FUN_1000_1e1a's `[0x6]` literals as absolute
 *   320x200 screen rows and concluded "the panel sits near the TOP of the
 *   screen (rows 3-20ish), well clear of the bottom 40-row status band."
 *   THAT IS WRONG and is withdrawn — a live DOSBox comparison puts the panel
 *   inside the bottom status band. The error was over-reading a disassembly:
 *   the old header even noticed the DS:0x0 word ("consumed by something
 *   inside loop 2, not traced further here") and then dismissed it because
 *   FUN_1000_1ee3 never references address 0. The consumer was never
 *   FUN_1000_1ee3 — it is the graphics driver itself.
 *
 *   DS:[0x0] IS THE DESTINATION-BUFFER SEGMENT for every sprite blit, and
 *   THE BLITTERS THEMSELVES read it. VGA.EXE export 1 (table word #1 =
 *   0x1d07) and export 2 (word #2 = 0x1b86) — the two the slot frames and
 *   the icons actually call via the CS:0x3569 / CS:0x356e thunks — both open
 *     mov di,[0x0] ; sub di,0x4 ; mov es,di          ; 1d3b / 1bb3
 *     di := (x & ~7) >> 3 ; di += y*4 + y*8 + y*32   ; 1d44-1d61 / 1bc6-1bd9
 *     ...
 *     add di,0x40                                    ; 1df0 / 1c60
 *   The `sub di,0x4` is PARAGRAPHS (-64 bytes) and the later `add di,0x40`
 *   is BYTES (+64), so they cancel exactly — the -4 exists only to give DI
 *   headroom for the negative-Y clip the routines allow. NET destination =
 *   DS:[0x0] : (44*y + x/8). The pitch 44 is re-derived here from the
 *   y*4 + y*8 + y*32 chain, independently of hud-digits.js's export-21
 *   derivation. So the blitter contributes NO row bias of its own: the
 *   destination is chosen entirely by the segment its caller installs.
 *
 *   FUN_1000_1e1a temporarily retargets that word to the STATUS-PANEL
 *   composition buffer and draws with PANEL-LOCAL coordinates:
 *
 *     1e2f  al := DS:0x33 & 4
 *     1e36  bx := 0xad4c          ; bit set   (page 1's panel buffer)
 *     1e4b  bx := 0xacde          ; bit clear (page 0's panel buffer)
 *     1e6b  push [0x0]            ; SAVE the global destination segment
 *     1e78  mov [0x0],bx          ; RETARGET to the panel buffer <-- the +160
 *     1e5f  add ax,0x60           ; panelX0 := 0x60 (96) (+4 when bit 2 set)
 *     1e65  mov word[0x6],0x3     ; PANEL-LOCAL Y := 3, the slot frames
 *     1e7c  mov bx,0x74           ; slot-frame sprite := 0x74 (116), 32x19
 *     1e7f..1eb7  4 slots, CALL 0x3569 (export 1) each, X += 0x20 (32)
 *     1eb9  sub word[0x4],0x78    ; -> panelX0 + 8 (104) for loop 2
 *     1ec5  mov word[0x6],0x4     ; PANEL-LOCAL Y := 4, the item icons
 *     1ec4..1ed7  4 slots, CALL 0x1ee3 each (-> export 2 at 0x356e)
 *     1ede  mov [0x0],ax          ; RESTORE the global destination segment
 *
 *   DS:[0x0] is retargeted in exactly THREE places program-wide, and all
 *   three are status-panel HUD routines: CS:0x1e78 `mov [0x0],bx` (this
 *   panel), CS:0x0ec9 `mov [0x0],ax` (the health bar) and CS:0x448a
 *   `mov [0x0],bx` (FUN_1000_443e). Establishing that needs TWO searches,
 *   not one: `search_instructions` on `word ptr [0x0],` finds only the two
 *   `mov [0x0],bx` forms (1e78, 448a) because it cannot match the 8086
 *   accumulator-direct encoding `a3 00 00`; a second search on `[0x0], AX`
 *   finds 0ec9, 0f3f, 1ede, 44a0 — of which 0ec9 is a third install and the
 *   other three are restores. Nothing outside the HUD ever retargets the
 *   word. (An earlier draft of this header said "only two writers"; that was
 *   a single-search artifact, and the correction is recorded here rather
 *   than quietly dropped.)
 *
 *   WHY THE PANEL ALSO ZEROES DS:0x33 (CS:0x1e72 push / CS:0x1e73
 *   `mov byte[0x33],0` / CS:0x1eda restore — and identically at CS:0x0ebc in
 *   the health bar and CS:0x444d in FUN_1000_443e): exports 1 and 2 both
 *   begin `mov dl,[0x33] / xor dh,dh / add dx,ax`, i.e. the blitter adds the
 *   WHOLE byte at DS:0x33 to X. That byte carries the world's fine pan, so a
 *   HUD element must suppress it or the panel would scroll with the level.
 *   Each HUD routine therefore zeroes DS:0x33 for the duration and pre-adds
 *   only `(DS:0x33 & 4)` to [0x4] by hand (CS:0x1e5f) — the 4-pixel
 *   compensation for page 1's backdrop, which export 28 stores shifted by a
 *   per-byte `ror al,1` x4 with nibble carry (`and al,0xf` / `or al,ch`,
 *   VGA memory 0x905-0x911). This port models neither (DS:0x33 is always 0
 *   here), which is exactly the original's bit-clear arm.
 *
 *   THE PANEL BUFFER REACHES THE SCREEN AT ROW 160. Every frame,
 *   FUN_1000_2274 (called at CS:0x02DE) copies it to the live page:
 *
 *     2275  call 0x2287           ; graphics export 27 (slot 0x52be):
 *                                 ;   AX = 0xacde|0xad4c (the panel buffer)
 *                                 ;   ES = DS:[0x0]      (the live page)
 *                                 ;   DI = (DS:0x33 & 0x18) >> 3 (fine pan)
 *     2278  add di,0x1b80         ; 0x1b80 = 7040 = 160 * 44  <-- THE +160
 *     227e  mov ds,ax ; sub si,si
 *     2280  mov cx,0x6dd ; rep movsb
 *
 *   44 is the mode-0Dh scanline pitch this project already documents. So a
 *   panel-local Y of 3 is SCREEN ROW 163. (`mov cx,0x6dd` = 1757 is three
 *   bytes short of a full 40 rows x 44 = 1760 — UNKNOWN_2274_copy_length,
 *   recorded rather than rounded; the shortfall lies past x=319.)
 *
 *   THE BUFFER'S BACKDROP is painted ONCE, not per frame: VGA.EXE graphics
 *   export 28 (table word #28 = 0x0888, VGA memory 0x888) sets all six HUD
 *   dirty flags to 0xff and copies 40 rows x 40 bytes from 0xac7a:0 (the
 *   converted PSTATUS or PSTAT3, 40 B/row contiguous — see status-panel.js) into
 *   0xacde:0 emitting 4 pad bytes per row (`rep movsb`+`stosw`+`stosw`),
 *   turning a 40-byte pitch into 44; then the same into 0xad4c:0 with the
 *   per-byte `ror al,1` x4 page shift. Its GAME.EXE thunk is FUN_1000_9020
 *   (`CALLF [0x52c2]`, export 28); its six callers are CS:0x05a6, 0x220f,
 *   0x6b59, 0x6d9a, 0x8e2e and 0x8fc9 — all one-shot init/level-load paths,
 *   NONE inside the per-frame block CS:0x0282-0x02E1. The arithmetic closes
 *   out: 0xacde-0xac7a = 1600 = 40x40 (the backdrop) and 0xad4c-0xacde =
 *   1760 = 44x40 (one panel). That also closes
 *   `UNKNOWN_status_panel_es_segment` (drivers-and-memory.md), which had
 *   left the 40-row gap between those two segments unexplained and the +160
 *   resting on inference.
 *
 *   SAME CONVENTION AS THE HEALTH BAR, byte for byte — CS:0x0e97 saves
 *   [0x0], CS:0x0eb5/0x0ec6 pick 0xacde/0xad4c, CS:0x0ec9 `mov [0x0],ax`,
 *   CS:0x0ecc `mov word[0x6],7`, CS:0x0f3f restores. Lives (CS:0x0ad8/
 *   0x0aeb), money (CS:0x0b5c) and score (CS:0x0bdb) load the same two
 *   segments into ES directly. All six users of 0xacde in the binary are
 *   status-panel HUD elements. So this module takes `panelY0` exactly like
 *   drawHealthBar/drawLives/drawMoney/drawScore already do.
 *
 *   CORROBORATED BY THE ART. PSTAT3.PI1's own backdrop, decoded through this
 *   port's `decodeStatusPanel`, carries four index-15 slot recesses at
 *   panel-local rows 5..22, x 101-122 / 133-154 / 165-186 / 197-218 — an
 *   exact 32px pitch, with pillar art flanking at x 88..92 and 226..227:
 *   the precise footprint of four 32x19 slot frames at x = 96/128/160/192,
 *   panel-local y = 3. Sprite 0x74 measures 32x19 (PALWAYS3 frame 5, via
 *   this port's own parseAtlas). PSTATUS.PI1 (the disk-1 panel) carries a
 *   byte-identical strip, so this holds on every world and disk, not only
 *   PLEV1A. The backdrop was authored for this panel.
 *
 *   FINAL SCREEN Y (panelY0 = 160): slot frames at 163 — sprite 0x74 being
 *   32x19, rows 163..181, x 96..223. Item icons at
 *   160 + 4 + ((17 - h) >> 1): 164 for a 16-tall icon, 168 for an 8-tall
 *   one. Both well inside the 160..199 band.
 *
 *   DRAW ORDER, straight-line in FUN_1000_006f, no branch:
 *     CS:0x02C0  call 1f5a   ; commit pending selector      <- this module
 *     CS:0x02C3  call 1e1a   ; DRAW THE PANEL               <- this module
 *     CS:0x02C6  call 0dff   ; health-bar chase
 *     CS:0x02C9  call 0e77   ; health bar          (health-bar.js)
 *     CS:0x02CC  call 0ab1   ; lives digits        (hud-digits.js)
 *     CS:0x02D2  call 0b40   ; money digits        (hud-digits.js)
 *     CS:0x02D8  call 0bbf   ; score digits        (hud-digits.js)
 *     CS:0x02DE  call 2274   ; COPY the panel buffer to screen, +row 160
 *   The panel is the FIRST overlay element, drawn onto a backdrop already
 *   present in the buffer — so in this port it must be drawn AFTER
 *   `renderer.blitStatusPanel()` (this port's stand-in for that persistent
 *   buffer) and BEFORE the health bar and the digits.
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
 *   - DS:0x33 bit 2 — the 4px shift (screenX0 0x64 instead of 0x60) and the
 *     dirty-flag swap (DS:0x3bb/0x3bc). DS:0x33 is the display's fine-scroll
 *     phase (VGA:0x10FB), and the shift only compensates for the pre-shifted
 *     panel copy that phase selects; on screen the panel does not move
 *     ([PROVEN] live, message.js's DS:0x33 note). So 0x60 is simply right.
 *   - DS:0x3bb/DS:0x3bc, the panel's own dirty-repaint flags (FUN_1000_228e,
 *     FUN_1000_1f5a) — irrelevant to a full-redraw canvas renderer, exactly
 *     the same disclosed cut status-panel.js's own header already carries
 *     for its equivalent flag. This module always draws every call.
 *
 *   Ported since: the FIRE-tap slot cycle (CS:0x612F-0x619D, player.js
 *   `_inventoryTap`, through `pending`), the crouch drop (CS:0x61A1,
 *   player.js `_drop`) and the key pickup into the shown slot
 *   (CS:0x6100-0x610D, pickup.js `collectKey`).
 */

import { INVENTORY_EMPTY, INVENTORY_SLOTS } from './treasure.js';
import { spriteForType } from './objects.js';

/** CS:0x1e7c / CS:0x1e9c — the plain and highlighted ("selected") slot-frame
 *  sprites. The highlighted one is always base-1, never looked up separately. */
export const SLOT_FRAME_SPRITE = 0x74;
export const SLOT_FRAME_HIGHLIGHT_SPRITE = SLOT_FRAME_SPRITE - 1;

/** CS:0x1eb0/0x1ed2 — 0x20px between slots, both loops, 4 slots (INVENTORY_SLOTS). */
export const PANEL_SLOT_SPACING = 0x20;

/** CS:0x1e5f/0x1e65 — the slot-frame loop's own origin (DS:0x33 bit2 clear).
 *  `PANEL_FRAME_Y` is PANEL-LOCAL (CS:0x1e65 `mov word[0x6],0x3`), not an
 *  absolute screen row: add the status panel's own `panelY0` (160). */
export const PANEL_FRAME_X0 = 0x60;
export const PANEL_FRAME_Y = 3;

/** CS:0x1eb9/0x1ec5 — the item-icon loop's own origin, 8px right of the
 *  frames; `PANEL_ICON_Y` is PANEL-LOCAL too (CS:0x1ec5), same +160 rule. */
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
    /** DS:0x366 — which slot draws highlighted. Moved by the crouch FIRE
     *  tap (player.js `_crouch`, CS:0x615F) through `pending`; zeroed by a
     *  new game only (CS:0x8D73/0x8D78, inside the [0x391] block CS:0x8D58). */
    this.selector = 0;
    /** DS:0x367 — the pending selector the FIRE tap writes (CS:0x6171);
     *  the panel draw copies it into DS:0x366 (CS:0x1F5A). */
    this.pending = 0;
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
    /* CS:0x1F5A, from the panel draw every frame: [0x366] := [0x367]. The
     * FIRE tap's new slot shows the same tick ([PROVEN] live, PJOYL1 809). */
    if (this.pending !== this.selector) this.selector = this.pending;
  }

  /** CS:0x1e88-0x1e9a — is `slot` drawn with the highlighted frame right now? */
  isHighlighted(slot) {
    return slot === this.selector &&
      this.counter >= COUNTER_HIGHLIGHT_MIN &&
      this.delta >= 0;
  }
}

/**
 * Draw the 4-slot panel INTO THE STATUS PANEL: slot frames (highlighted on
 * the selected one, gated by `panel`'s own extend/retract state) then
 * held-item icons. Runs UNCONDITIONALLY every frame — see the PROVENANCE
 * header's CS:0x02C0/0x02C3 finding — not just while crouching. Must be
 * called AFTER `renderer.blitStatusPanel()` (the original draws onto a panel
 * buffer whose backdrop is already present — VGA.EXE export 28, a one-shot)
 * and BEFORE the health bar and digits (CS:0x02C3 < CS:0x02C9).
 * @param {import('../render/renderer.js').Renderer} renderer
 * @param {Array<{w:number,h:number,pixels:Uint8Array}>} frames `hero.frames`
 * @param {number[]} inventory the 4-slot array (treasure.js), raw POBJECTS
 *   types or INVENTORY_EMPTY
 * @param {InventoryPanel} panel
 * @param {number} panelY0 the status panel's own screen-Y origin (160) —
 *   CS:0x1e65/0x1ec5's `[0x6]` values are PANEL-LOCAL; FUN_1000_2274
 *   (CS:0x02DE) copies the panel buffer to the screen at `+0x1b80 = 160*44`.
 */
export function drawInventoryPanel(renderer, frames, inventory, panel, panelY0) {
  if (!frames) return;
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const sprite = panel.isHighlighted(slot) ? SLOT_FRAME_HIGHLIGHT_SPRITE : SLOT_FRAME_SPRITE;
    const frame = frames[sprite];
    if (frame) renderer.blitSprite(frame, PANEL_FRAME_X0 + slot * PANEL_SLOT_SPACING,
      panelY0 + PANEL_FRAME_Y);
  }
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const sprite = panelIconSprite(inventory[slot]);
    if (sprite === null) continue;
    const frame = frames[sprite];
    if (!frame) continue;
    /* CS:0x1f1c-0x1f24 — center a variable-height icon against a nominal
     * 16px band: `(16 - (h-1)) >> 1`, arithmetic shift (SAR), added to Y. */
    const iconY = panelY0 + PANEL_ICON_Y + ((17 - frame.h) >> 1);
    renderer.blitSprite(frame, PANEL_ICON_X0 + slot * PANEL_SLOT_SPACING, iconY);
  }
}
