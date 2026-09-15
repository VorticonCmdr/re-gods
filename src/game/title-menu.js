/* title-menu.js — the title screen: a 3-option menu plus the letter-grid
 * password entry, closing a gap main.js's own comments flagged explicitly:
 * "this port has no title screen to route 'new game' through" and
 * zones.js's `UNKNOWN_password_entry_ui` ("the grid-entry UI that would let
 * a player TYPE one back in is a disclosed gap").
 *
 * PROVENANCE
 *   The menu itself is [PROVEN] — see Gods/docs/dynamic-trace-and-runtime-
 *   data.md, "The title screen — a 3-option menu...": `FUN_1000_2c82`/
 *   `FUN_1000_317d`, read in full under DOSBox. Three options, exactly:
 *     cursor 0 -> BEGIN QUEST     (world 1, sublevel A)
 *     cursor 1 -> ENTER PASSWORD  (FUN_1000_2e2f, the letter-grid screen)
 *     cursor 2 -> QUIT            (INT 21h AH=4Ch — DOS terminate)
 *   UP/DOWN CLAMP (not wrap) against the option count; FIRE confirms.
 *   "QUIT" cannot terminate a browser tab, so per this port's own brief it is
 *   reproduced as a permanent blackout instead — see Renderer.presentBlack().
 *
 *   The password screen's UNDERLYING MECHANISM is [PROVEN] (CS:0x2e2f/
 *   0x2e6c-0x2ea8): a 3-character buffer compared against up to three stored
 *   passwords (zones.js's own `passwordSlots`, one per unlockable world
 *   2/3/4), entered via a grid of cells navigated with the SAME UP/DOWN/FIRE
 *   primitive the menu itself uses (plus LEFT/RIGHT — the grid is 2-D). A
 *   wrong (or, in a session where that world's password was never generated,
 *   an empty) guess bounces back to the TITLE MENU, not a re-prompt
 *   (CS:0x2e8a `JMP 0x1000:2caf`) — reproduced exactly in main.js's own
 *   dispatch.
 *
 *   The grid's exact VISUAL geometry (cell arrangement, on-screen layout) is
 *   NOT established — no disassembly pass has pinned FUN_1000_2eb0's own
 *   draw coordinates, and the interactive session that proved the mechanism
 *   (Gods/docs/dynamic-trace-and-runtime-data.md's hiscore-entry trace) only
 *   confirms cursor INDICES (0..39, "+"=39=confirm), not a row/column shape.
 *   `UNKNOWN_password_grid_layout`. This port's own 7x4 A-Z+DEL+OK grid is a
 *   port-level design choice, not a claim of pixel fidelity — the same
 *   disclosure renderer.js's own header already makes for the tilemap
 *   renderer.
 *
 *   GLYPH SAFETY: every string this module draws is built ONLY from
 *   characters Gods/docs/message-line.md's own "notable slots" table names
 *   individually — 0x11 (the solid diamond, reused here as the cursor/
 *   placeholder glyph), 0x20 (space) and 0x41-0x5A (A-Z) — plus `<`/`=`
 *   (0x3C/0x3D) for the grid's DEL/OK cells, checked live in a running port
 *   (both render as real, legible glyphs, not blanks) rather than assumed:
 *   message-line.md's own byte count (130 records, "91 cells in 0x20..0x7A")
 *   already implies that whole printable range is populated real artwork,
 *   just not individually catalogued the way the "notable slots" are.
 */

import { SCREEN_W } from '../formats/pi1.js';
import { PASSWORD_LENGTH } from './zones.js';

export const ADVANCE = 0x0a;    // 10 — the same per-glyph step message.js uses
export const DIAMOND = '\x11';  // CS:0x4443's own separator glyph, reused as a cursor

export const MENU_OPTIONS = ['BEGIN QUEST', 'ENTER PASSWORD', 'EXIT TO DOS'];

function textWidth(text) { return text.length * ADVANCE; }

/** Draw `text` left-to-right from (x, y), one glyph sprite per character. */
export function drawText(renderer, glyphs, text, x, y) {
  if (!glyphs) return;
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const f = glyphs[text.charCodeAt(i)];
    if (f) renderer.blitSprite(f, cx, y);
    cx += ADVANCE;
  }
}

/** Draw `text` horizontally centred on the 320px screen at row `y`. */
function drawCentered(renderer, glyphs, text, y) {
  const x = ((SCREEN_W - textWidth(text)) / 2) | 0;
  drawText(renderer, glyphs, text, x, y);
}

/**
 * CS:0x2CAF-0x2E26 — the menu's own cursor/dispatch. Purely event-driven off
 * keydown (the 15 Hz tick loop is frozen while any non-'game' uiState is
 * active — see main.js), which is a port-level simplification of a menu
 * that, in the original, is itself polled once per logic frame.
 */
export class TitleMenu {
  constructor() { this.cursor = 0; }

  /** @returns {'begin'|'password'|'exit'|null} */
  onKeyDown(code) {
    if (code === 'ArrowUp' || code === 'KeyW') {
      this.cursor = Math.max(0, this.cursor - 1);                      // CS:0x2D18 clamp at 0
    } else if (code === 'ArrowDown' || code === 'KeyS') {
      this.cursor = Math.min(MENU_OPTIONS.length - 1, this.cursor + 1); // CS:0x2D28 clamp at [0x386]
    } else if (code === 'Space' || code === 'Enter') {
      return ['begin', 'password', 'exit'][this.cursor];               // CS:0x2D50 dispatch
    }
    return null;
  }

  draw(renderer, glyphs, logo) {
    renderer.clear(0);
    let y = 8;
    if (logo) {
      renderer.blitSprite(logo, ((SCREEN_W - logo.w) / 2) | 0, y);
      y += logo.h;
    }
    y += 24;
    for (let i = 0; i < MENU_OPTIONS.length; i++) {
      const marker = i === this.cursor ? DIAMOND + ' ' : '  ';
      drawCentered(renderer, glyphs, marker + MENU_OPTIONS[i], y);
      y += 20;
    }
    drawCentered(renderer, glyphs, 'ARROWS SELECT  SPACE CONFIRM', 170);
  }
}

/* 26 letters + DEL('<') + OK('=') — every cell exactly one glyph wide, so a
 * fixed column pitch never has to fit "DEL"/"OK" against single letters. 7
 * columns x 4 rows. The grid's SHAPE (which world-2/3/4 unlock this
 * reproduces) is proven; this specific 7x4 arrangement is not — see the
 * header's `UNKNOWN_password_grid_layout` note. */
const GRID_COLS = 7, GRID_ROWS = 4;
const GRID_CELLS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G',
  'H', 'I', 'J', 'K', 'L', 'M', 'N',
  'O', 'P', 'Q', 'R', 'S', 'T', 'U',
  'V', 'W', 'X', 'Y', 'Z', '<', '=',
];
const CELL_DEL = '<', CELL_OK = '=';
const GRID_X0 = 34, GRID_Y0 = 60, GRID_COL_W = 36, GRID_ROW_H = 20;

/**
 * CS:0x2e2f/0x2e6c-0x2ea8 — the letter-grid password entry. `onKeyDown`
 * returns `{submit: string}` (exactly PASSWORD_LENGTH letters, to be checked
 * against zones.js's `passwordSlots` by the caller — this module owns no
 * game state) or `{cancel: true}` (ESC — a port-only convenience; the
 * original grid has no "back", only the wrong-guess bounce CS:0x2e8a already
 * reproduces via the caller's own dispatch).
 */
export class PasswordEntry {
  constructor() {
    this.row = 0;
    this.col = 0;
    this.buffer = [];
  }

  /** @returns {{submit:string}|{cancel:true}|null} */
  onKeyDown(code) {
    if (code === 'Escape') return { cancel: true };
    if (code === 'Backspace') { this.buffer.pop(); return null; }
    if (code === 'ArrowUp' || code === 'KeyW') this.row = Math.max(0, this.row - 1);
    else if (code === 'ArrowDown' || code === 'KeyS') this.row = Math.min(GRID_ROWS - 1, this.row + 1);
    else if (code === 'ArrowLeft' || code === 'KeyA') this.col = Math.max(0, this.col - 1);
    else if (code === 'ArrowRight' || code === 'KeyD') this.col = Math.min(GRID_COLS - 1, this.col + 1);
    else if (code === 'Space' || code === 'Enter') {
      const cell = GRID_CELLS[this.row * GRID_COLS + this.col];
      if (cell === CELL_DEL) this.buffer.pop();
      else if (cell === CELL_OK) {
        if (this.buffer.length === PASSWORD_LENGTH) return { submit: this.buffer.join('') };
      } else if (this.buffer.length < PASSWORD_LENGTH) {
        this.buffer.push(cell);
      }
    }
    return null;
  }

  draw(renderer, glyphs) {
    renderer.clear(0);
    drawCentered(renderer, glyphs, 'ENTER PASSWORD', 16);

    /* The typed buffer, blank slots shown as the diamond placeholder — see
     * the header's glyph-safety note for why not '_' or '-'. */
    const slots = [];
    for (let i = 0; i < PASSWORD_LENGTH; i++) slots.push(this.buffer[i] || DIAMOND);
    drawCentered(renderer, glyphs, slots.join(' '), 36);

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = GRID_CELLS[r * GRID_COLS + c];
        const marker = r === this.row && c === this.col ? DIAMOND + ' ' : '  ';
        drawText(renderer, glyphs, marker + cell, GRID_X0 + c * GRID_COL_W, GRID_Y0 + r * GRID_ROW_H);
      }
    }

    drawCentered(renderer, glyphs, '<  DELETE     =  CONFIRM', 148);
    drawCentered(renderer, glyphs, 'ARROWS MOVE  SPACE SELECT', 164);
    drawCentered(renderer, glyphs, 'ESC BACK TO MENU', 180);
  }
}
