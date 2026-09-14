/* hud-digits.js — the score, lives and money digit displays on the status
 * panel, CS:0x0bbf (score) / CS:0x0ab1 (lives) / CS:0x0b40 (money).
 *
 * PROVENANCE
 *   Found the same way as health-bar.js: searching for consumers of the
 *   score/money "display dirty" flags this project's own treasure.js
 *   already names (`DS:0x70`/`0x71` — treasure.js's own header quotes
 *   `CS:0x1950`'s `mov byte [0x70],0xff / mov byte [0x71],0xff`) turns up
 *   `FUN_1000_0bbf`, and its own call to `FUN_1000_0df8` — a 3-instruction
 *   thunk (`mov bp,0x52a6 / callf [bp+0] / ret`) into graphics-driver
 *   EXPORT 21 — is the SAME export this project's own `formats/descriptors.
 *   js` already independently anchors at descriptor #127 ("Export 21 is
 *   hard-wired to descriptor #127... PALWAYS3 frame 16, measured 80x7 —
 *   exactly ten 8x7 digit cells"). All three routines below share that one
 *   digit strip; none of them was previously wired to anything.
 *
 *   All three disassembled directly (Ghidra `disassemble_function`, not
 *   decompiled — the decompiler's own register-lifetime guesses hide the
 *   exact push/pop nibble-splitting and, for lives, get the digit ORDER
 *   backwards; see below).
 *
 *   ALL THREE share one call-site block, straight-line in the main loop,
 *   no branch around any of them:
 *
 *     CS:0x02C9  call 0x1000:0e77   ; health bar (health-bar.js)
 *     CS:0x02CC  call 0x1000:0ab1   ; LIVES        <- this module
 *     CS:0x02CF  call 0x1000:0b21   ; money-changed detector (sets 0x6e/0x6f)
 *     CS:0x02D2  call 0x1000:0b40   ; MONEY        <- this module
 *     CS:0x02D8  call 0x1000:0bbf   ; SCORE        <- this module
 *
 *   SCORE, `FUN_1000_0bbf` (CS:0x0bbf-0x0c7f). Gated on `DS:0x3e0` (a
 *   display-suppress flag not otherwise chased) and one of a same-shaped
 *   dirty-flag pair (`DS:0x70`/`0x71`, selected by `DS:0x33` bit 2 — see
 *   the NOT PORTED note). Draws all 4 bytes of the packed-BCD score
 *   (`treasure.js`'s own `Score.bytes`, DS:0x3b5-0x3b8) from the LEAST
 *   significant byte first:
 *
 *     0bf3  [0x4] := 0x128(296) + (DS:0x33&4)  ; screenX0 (rightmost digit)
 *     0bff  [0x6] := 5                          ; panel-local Y
 *     0c05  al := bytes[0] ; push ax ; al &= 0xf   ; LOW nibble (ones)
 *     0c0b  draw(al) ; [0x4] -= 8                    ; step LEFT
 *     0c13  pop ax ; al >>= 4 (x4)                     ; HIGH nibble (tens)
 *     0c1c  draw(al) ; [0x4] -= 8                        ; step LEFT
 *     ... repeated for bytes[1], bytes[2], bytes[3] ...
 *
 *   So digit N (0-indexed, ones=0) draws at screenX0 - 8*N, confirming the
 *   BCD byte order this project's own treasure.js already documents
 *   (`bytes[0]` least significant) renders normally left-to-right when read.
 *
 *   LIVES, `FUN_1000_0ab1`/`FUN_1000_0af0` (CS:0x0ab1-0x0b20). Same
 *   dirty-flag-pair shape (`DS:0x6c`/`0x6d`), clamps to 99, but the two
 *   digits are computed and drawn in the OPPOSITE order from score/money —
 *   confirmed from raw bytes, not the decompiler's pseudo-C (which renders
 *   this as an opaque signed-byte loop and hides which digit is which):
 *
 *     0afb  bl := 10 ; cl := 0
 *     0aff  al -= bl ; js 0b07 ; inc cl ; jmp 0aff   ; repeatedly subtract
 *                                                    ;   10, counting in CL
 *     0b07  al += bl                                  ; undo the failed
 *                                                    ;   subtraction -> AL
 *                                                    ;   = ONES digit (0-9)
 *     0b09  push ax                                    ; save {ones}
 *     0b0c  [0x4] += DX                                  ; DX = the caller's
 *                                                        ;   0/4 font offset
 *     0b10  al := cl                                      ; TENS digit
 *     0b12  draw(al)                                        ; TENS FIRST, at
 *                                                          ;   the base X
 *     0b18  [0x4] += 8                                      ; step RIGHT
 *     0b1d  pop ax ; draw(al)                                 ; ONES SECOND,
 *                                                            ;   8px to the
 *                                                            ;   right of
 *                                                            ;   tens
 *
 *   i.e. lives reads normally left-to-right (tens, then ones) from a FIXED
 *   LEFT anchor, unlike score/money's right-anchored, right-to-left layout
 *   — a real asymmetry between a fixed-width 2-digit counter and a
 *   variable-magnitude accumulator, not an inconsistency to "fix".
 *
 *   MONEY, `FUN_1000_0b21` (change detector) + `FUN_1000_0b40` (draw).
 *   0b21 just compares the live 32-bit total (`DS:0x194`/`0x196`, this
 *   project's own `treasure.js` `Purse.total`) against a snapshot the main
 *   loop takes earlier in the same tick (`DS:0x272`/`0x274`) and sets a
 *   THIRD dirty-flag pair (`DS:0x6e`/`0x6f`) on any change. 0b40 draws it as
 *   a PLAIN DECIMAL number (repeated `div 10`, NOT BCD) — and clamps it,
 *   confirmed via raw disassembly (not the decompiler's ambiguous signed
 *   framing):
 *
 *     0b74  ax:dx := [0x194]:[0x196]           ; the 32-bit total
 *     0b7b  cmp dx,7 / jl 0b92                  ; high word < 7 -> no clamp
 *     0b80  cmp ax,0xa120 / jle 0b92              ; == 7 and low <= 0xa120
 *                                                ;   -> no clamp
 *     0b85  ax:=0xa120 ; dx:=7                    ; ELSE: ax:dx := 0x0007a120
 *     0b8b  [0x194]:=ax ; [0x196]:=dx               ; WRITTEN BACK — this is
 *                                                  ;   a real, permanent
 *                                                  ;   clamp on the actual
 *                                                  ;   money total, not a
 *                                                  ;   display-only trick
 *     0b92  [0x4] := 0x128 + (DS:0x33&4)            ; screenX0
 *     0b9e  [0x6] := 0x11(17)                        ; panel-local Y
 *     0ba4  cx := 6                                    ; SIX digits
 *     0baa  div bx(=10) ; draw(dx=remainder)             ; ones first...
 *     0bb6  [0x4] -= 8 ; loop                              ; ...stepping
 *                                                          ;   LEFT, same
 *                                                          ;   as score
 *
 *   `0x0007a120 == 500000` — MONEY IS CAPPED AT 500,000, enforced lazily at
 *   DISPLAY TIME rather than at the point a treasure pickup adds to it. A
 *   port that only clamps `Purse.total` at accumulation time (or not at
 *   all) diverges: the original genuinely lets the accumulator exceed
 *   500,000 between digit-redraws (the dirty flag only fires on a CHANGE,
 *   so a rapid string of pickups can push the real total arbitrarily high
 *   before the very next redraw clamps it back down). This port redraws
 *   every frame (see NOT PORTED), so `clampMoneyForDisplay` below is called
 *   every frame and the divergence never has room to occur — the port is
 *   MORE eager to clamp than the original, never less, which is the safe
 *   direction to differ in.
 *
 * NOT PORTED (disclosed, not silently dropped):
 *   - `DS:0x3e0` (a score-display suppress flag, not otherwise chased —
 *     plausibly set during a scripted sequence or menu transition) and all
 *     three dirty-flag pairs (0x6c/0x6d lives, 0x6e/0x6f money, 0x70/0x71
 *     score) — irrelevant to this port's full-redraw-every-frame renderer,
 *     the same disclosed simplification `inventory-panel.js`'s own header
 *     already carries for its equivalent flags.
 *   - `DS:0x33` bit 2 / the ES segment choice — see health-bar.js's
 *     identical note; defaulted to the bit-clear arm here too.
 */

import { SCORE_BYTES } from './treasure.js';

/** `formats/descriptors.js`'s own already-established anchor: export 21 is
 *  hard-wired to this one descriptor, PALWAYS3 frame 16, measured 80x7 —
 *  ten 8x7 digit cells, glyphs '0'..'9' left to right. */
export const DIGIT_STRIP_DESCRIPTOR = 127;
export const DIGIT_W = 8;
export const DIGIT_H = 7;
export const DIGIT_STEP = 8;   // CS:0x0c0e/0x0b18/0x0bb6 — every digit loop's own X step

export const MONEY_CAP = 0x7a120;   // 500000 — CS:0x0b80/0x0b85

/** CS:0x0bff/0x0b9e/0x0b0c — panel-local Y for each display; see
 *  health-bar.js's header for why "panel-local" means +status-panel-Y0. */
export const SCORE_Y_LOCAL = 5;
export const LIVES_Y_LOCAL = 9;
export const MONEY_Y_LOCAL = 0x11;

/** CS:0x0bf3/0x0b92 — the shared right-anchor for score and money (both
 *  draw right-to-left from here). */
export const RIGHT_ANCHOR_X = 0x128;
/** CS:0x0e7d... no — CS:0x0ab1's own literal — the fixed LEFT anchor lives draws from. */
export const LIVES_X = 0x42;

export const SCORE_DIGITS = SCORE_BYTES * 2;   // 8
export const MONEY_DIGITS = 6;
export const LIVES_CLAMP = 99;                 // CS:0x0af3/0x0af8

/**
 * Slice the 80x7 digit strip (descriptor #127) into ten 8x7 glyph frames,
 * '0' at index 0. Call once per level load (whenever `hero.frames` is
 * rebuilt), not per frame.
 * @param {Array<{w:number,h:number,pixels:Uint8Array}>} frames hero.frames
 * @returns {?Array<{w:number,h:number,pixels:Uint8Array}>} null if the strip
 *   isn't loaded (frames not ready yet)
 */
export function sliceDigitFrames(frames) {
  const strip = frames && frames[DIGIT_STRIP_DESCRIPTOR];
  if (!strip || strip.w !== DIGIT_W * 10 || strip.h !== DIGIT_H) return null;
  const out = [];
  for (let d = 0; d < 10; d++) {
    const pixels = new Uint8Array(DIGIT_W * DIGIT_H);
    for (let y = 0; y < DIGIT_H; y++) {
      pixels.set(strip.pixels.subarray(y * strip.w + d * DIGIT_W, y * strip.w + (d + 1) * DIGIT_W), y * DIGIT_W);
    }
    out.push({ w: DIGIT_W, h: DIGIT_H, pixels });
  }
  return out;
}

/**
 * CS:0x0b80-0x0b8b — clamp a 32-bit money total to 500000, matching the
 * original's own real, permanent write-back (see the module header). Call
 * before reading `purse.total` for display.
 * @param {import('./treasure.js').Purse} purse
 */
export function clampMoneyForDisplay(purse) {
  if (purse.total > MONEY_CAP) purse.total = MONEY_CAP;
}

/**
 * Draw `count` digits right-to-left from `x0` (the position of the LAST,
 * i.e. rightmost/least-significant, digit), each 8px left of the previous.
 * @param {import('../render/renderer.js').Renderer} renderer
 * @param {Array} digitFrames `sliceDigitFrames`'s own output
 * @param {number[]} digits least-significant first, e.g. `[9,4,2]` for 249
 * @param {number} x0 @param {number} y
 */
function drawDigitsRightToLeft(renderer, digitFrames, digits, x0, y) {
  let x = x0;
  for (const d of digits) {
    renderer.blitSprite(digitFrames[d], x, y);
    x -= DIGIT_STEP;
  }
}

/**
 * CS:0x0bbf/0x0c05-0x0c79 — draw the 8-digit packed-BCD score.
 * @param {import('../render/renderer.js').Renderer} renderer
 * @param {Array} digitFrames
 * @param {import('./treasure.js').Score} score
 * @param {number} panelY0
 */
export function drawScore(renderer, digitFrames, score, panelY0) {
  if (!digitFrames) return;
  const digits = [];
  for (const byte of score.bytes) { digits.push(byte & 0xf, byte >> 4); }
  drawDigitsRightToLeft(renderer, digitFrames, digits, RIGHT_ANCHOR_X, panelY0 + SCORE_Y_LOCAL);
}

/**
 * CS:0x0b40/0x0ba4-0x0bbb — draw the 6-digit decimal money total. Callers
 * should run `clampMoneyForDisplay` first (matching the original's own
 * write-back, see the module header).
 * @param {import('../render/renderer.js').Renderer} renderer
 * @param {Array} digitFrames
 * @param {import('./treasure.js').Purse} purse
 * @param {number} panelY0
 */
export function drawMoney(renderer, digitFrames, purse, panelY0) {
  if (!digitFrames) return;
  const digits = [];
  let v = purse.total >>> 0;
  for (let i = 0; i < MONEY_DIGITS; i++) { digits.push(v % 10); v = Math.floor(v / 10); }
  drawDigitsRightToLeft(renderer, digitFrames, digits, RIGHT_ANCHOR_X, panelY0 + MONEY_Y_LOCAL);
}

/**
 * CS:0x0ab1/0x0af0 — draw the clamped 2-digit lives counter, tens then
 * ones, LEFT to RIGHT (the opposite order/anchor from score/money — see
 * the module header for why that's not an inconsistency).
 * @param {import('../render/renderer.js').Renderer} renderer
 * @param {Array} digitFrames
 * @param {number} lives
 * @param {number} panelY0
 */
export function drawLives(renderer, digitFrames, lives, panelY0) {
  if (!digitFrames) return;
  const clamped = Math.min(Math.max(lives, 0), LIVES_CLAMP);   // CS:0x0af3/0x0af8
  const tens = Math.floor(clamped / 10);
  const ones = clamped % 10;
  const y = panelY0 + LIVES_Y_LOCAL;
  renderer.blitSprite(digitFrames[tens], LIVES_X, y);
  renderer.blitSprite(digitFrames[ones], LIVES_X + DIGIT_STEP, y);
}
