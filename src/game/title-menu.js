/* title-menu.js — the title screen: a 3-option menu plus the letter-grid
 * password entry, closing a gap main.js's own comments flagged explicitly:
 * "this port has no title screen to route 'new game' through" and
 * zones.js's `UNKNOWN_password_entry_ui` ("the grid-entry UI that would let
 * a player TYPE one back in is a disclosed gap").
 *
 * PROVENANCE
 *   The menu's DISPATCH is [PROVEN] — see Gods/docs/dynamic-trace-and-
 *   runtime-data.md's "The title screen — a 3-option menu..." section:
 *   `FUN_1000_2c82`/`FUN_1000_317d`, read in full under DOSBox. Three
 *   options, exactly:
 *     cursor 0 -> BEGIN QUEST     (world 1, sublevel A)
 *     cursor 1 -> ENTER PASSWORD  (FUN_1000_2e2f, the letter-grid screen)
 *     cursor 2 -> QUIT            (INT 21h AH=4Ch — DOS terminate)
 *   UP/DOWN CLAMP (not wrap) against the option count; FIRE confirms.
 *   "QUIT" cannot terminate a browser tab, so per this port's own brief it is
 *   reproduced as a permanent blackout instead — see Renderer.presentBlack().
 *
 *   The menu's VISUAL APPEARANCE is also [PROVEN] — confirmed live in a
 *   DOSBox session this pass (`GODS.EXE`->`INTROV.EXE`->`GAME.EXE`, no
 *   breakpoints, straight to a screenshot): a full-screen `PBACKSCR.PI1`
 *   backdrop (a brick wall with a large skull motif — NOT `PSTATUS.PI1`'s
 *   40-row status border, an earlier revision of this module's own wrong
 *   guess, reasoning only from load ORDER — see Gods/docs/drivers-and-
 *   memory.md's own corrected `UNKNOWN_backscr_pi1_loader` entry), the menu
 *   option's own text reading exactly `"ENTER PASSWORD"` (no `"A"` — see
 *   below), and the selected option flanked by inward-pointing arrows on
 *   both sides (`> BEGIN QUEST <`), not a single leading marker.
 *
 *   The password screen's UNDERLYING MECHANISM is [PROVEN] (CS:0x2e2f/
 *   0x2e6c-0x2ea8): a 3-character buffer compared against up to three stored
 *   passwords (zones.js's own `passwordSlots`, one per unlockable world
 *   2/3/4), entered via a grid of cells navigated with the SAME UP/DOWN/FIRE
 *   primitive the menu itself uses (plus LEFT/RIGHT — the grid is 2-D). A
 *   wrong (or, in a session where that world's password was never generated,
 *   an empty) guess bounces back to the TITLE MENU, not a re-prompt
 *   (CS:0x2e8a `JMP 0x1000:2caf`) — reproduced exactly in main.js's own
 *   dispatch. Its own screen TITLE is a DIFFERENT string from the menu
 *   option's own label — `"ENTER A PASSWORD"` (`1ffd:eb96`, CS:0x2e2f's own
 *   message pointer), confirmed both by static citation and by the same
 *   live capture above.
 *
 *   The grid's exact VISUAL geometry — `UNKNOWN_password_grid_layout` — is
 *   now [PROVEN] too, CLOSED this same session: an 8-column x 5-row, 40-cell
 *   grid (`A-H`/`I-P`/`Q-X`/`Y Z . <space> 0 1 2 3`/`4 5 6 7 8 9` then an
 *   erase icon then a confirm icon), read directly off a live capture and
 *   CROSS-VALIDATED against Gods/docs/dynamic-trace-and-runtime-data.md's
 *   own earlier, independent finding — a different session moved the
 *   cursor "from index 34 to 39" via "5x KBD_right" while completing a real
 *   hiscore entry, and row-major index 34 in THIS grid is row 4 col 2 while
 *   39 is row 4 col 7, exactly 5 columns apart. See `GRID_CELLS` below for
 *   the full citation and the two genuinely-still-open loose ends (the
 *   erase/confirm icons' own sprite source, and one obscured cell read from
 *   alphabet ordering rather than a clean pixel match).
 *
 *   GLYPH SAFETY: every string this module draws is built ONLY from
 *   characters Gods/docs/message-line.md's own "notable slots" table names
 *   individually — 0x11 (the solid diamond, reused here as the grid
 *   cursor/placeholder glyph), 0x20 (space) and 0x41-0x5A (A-Z) — plus
 *   `<`/`=`/`>`/digits/`.` , all checked live in a running port (each
 *   renders as a real, legible glyph, not a blank) rather than assumed:
 *   message-line.md's own byte count (130 records, "91 cells in 0x20..0x7A")
 *   already implies that whole printable range is populated real artwork,
 *   just not individually catalogued the way the "notable slots" are.
 *
 *   main.js loads `PBACKSCR.PI1` once (as `titleBackground`, blitted full-
 *   screen via `Renderer.blitBackground`) and passes it, plus its OWN
 *   embedded palette (not the currently-loaded level's — see main.js's own
 *   render-callback comment), into every `draw()` below.
 */

import { SCREEN_W } from '../formats/pi1.js';
import { PASSWORD_LENGTH } from './zones.js';

export const ADVANCE = 0x0a;    // 10 — the same per-glyph step message.js uses
export const DIAMOND = '\x11';  // CS:0x4443's own separator glyph, reused as a cursor

/* MENU_ADVANCE/MENU_FONT — CS:0x224E, the routine the menu's own redraw
 * (CS:0x311C, called from FUN_1000_2c82) and the "QUIT GAME" screen
 * (CS:0x489D->0x646F->0x224E) both draw through — confirmed live in DOSBox
 * this session (breakpoints at CS:0x033E/CS:0x0357 established the ESC/pause
 * mechanism; a user report that "QUIT GAME" flashes on screen during the
 * fade-out prompted checking its font, which turned out to be the SAME one
 * the menu itself uses, not PSMLFNT):
 *   224E: for each byte — 0 -> stop; 0x20 (space) -> advance only, no blit;
 *         else -> blit descriptor (byte + 0x3F), then unconditionally
 *         ADD [x],0x10 (16px, not PSMLFNT's 10px).
 * `byte + 0x3F` is a FIXED constant, not a runtime-snapshotted base like
 * PSMLFNT's own DS:0x27E (message.js) — so it targets a fixed spot in the
 * "always" group's global descriptor numbering, present on every level.
 * 'A' (0x41) + 0x3F = 128, which is EXACTLY PGODFONT's own base in that
 * numbering (main.js's loadSprites(): PALWAYS1(39)+PALWAYS2(72)+PALWAYS3(17)
 * = 128, then PGODFONT) — matching main.js's own independently-established
 * anchor for descriptor #169 (PGODFONT's LAST record, the title logo,
 * 128+41=169). Confirmed visually too: rendering PGODFONT's own records
 * 0-25 (tools/atlas-render.mjs) shows literal gold A-Z letters, in order,
 * in the exact style visible on the real title screen. Records 29-38 are
 * digits 0-9 (not at the ASCII-matching offset — the original's own digit
 * strings for this font must use a different byte, since 26-28 hold three
 * short marks not yet identified, and 39/40 are a left-arrow and a circular
 * icon — which ALSO settles title-menu.js's own previously-unlocated
 * erase/confirm icon sprites for the password grid below, not yet wired up
 * to use them (PasswordEntry still uses PSMLFNT throughout — a disclosed,
 * still-open follow-up, not fixed by this pass).
 * PSMLFNT (message.js's own font, `glyphs` below) remains genuinely correct
 * for the password grid and the in-level message line — this citation only
 * corrects the MENU/QUIT-GAME/tally-screen font, previously assumed (menu)
 * or explicitly disclosed as a stand-in (tally.js) to be PSMLFNT too. */
export const MENU_ADVANCE = 0x10;   // 16

/* Gods/docs/dynamic-trace-and-runtime-data.md's own title-screen trace:
 * "UP -> cursor -1, clamp at 0, click sfx 0x119, redraw" / "FIRE -> confirm
 * sfx 0x233 (same sound the grid-entry widget uses to confirm)" — one
 * confirm id serves BOTH `TitleMenu` and `PasswordEntry`, not two. The
 * click fires on any cursor move in the citation (UP/DOWN); this port
 * generalises it to LEFT/RIGHT too for the password grid's own 2-D
 * navigation, a disclosed generalisation rather than a byte-cited claim for
 * that axis specifically. main.js's `handleTitleKey` is the one place both
 * widgets' key handling passes through, so it is also the one place these
 * are played, rather than threading an audio dependency into either class. */
export const MENU_CLICK_SFX = 0x119;
export const MENU_CONFIRM_SFX = 0x233;

/* CONFIRMED against a live DOSBox capture of the real title screen: the
 * menu's own option 1 reads "ENTER PASSWORD" (no "A") — a DIFFERENT string
 * from the password-entry SCREEN's own title, "ENTER A PASSWORD"
 * (1ffd:eb96, drawn by FUN_1000_2e2f — see PasswordEntry.draw below). Two
 * distinct strings for two distinct UI elements, not one reused label. */
export const MENU_OPTIONS = ['BEGIN QUEST', 'ENTER PASSWORD', 'EXIT TO DOS'];

function textWidth(text, advance) { return text.length * advance; }

/** Draw `text` left-to-right from (x, y), one glyph sprite per character. */
export function drawText(renderer, glyphs, text, x, y, advance = ADVANCE) {
  if (!glyphs) return;
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const f = glyphs[text.charCodeAt(i)];
    if (f) renderer.blitSprite(f, cx, y);
    cx += advance;
  }
}

/** Draw `text` horizontally centred on the 320px screen at row `y`. */
export function drawCentered(renderer, glyphs, text, y, advance = ADVANCE) {
  const x = ((SCREEN_W - textWidth(text, advance)) / 2) | 0;
  drawText(renderer, glyphs, text, x, y, advance);
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

  /** @param {object} glyphs PSMLFNT — used ONLY for the port-only control-hint
   *    caption below, which has no original-game string to match (not found
   *    anywhere in this project's own string-table dump or live captures).
   *  @param {object} menuGlyphs the MENU font (PGODFONT, main.js's own
   *    `menuGlyphs`) — see MENU_ADVANCE's own citation above. Real strings
   *    (MENU_OPTIONS) draw through this one, not PSMLFNT. */
  draw(renderer, glyphs, menuGlyphs, logo, background) {
    if (background) renderer.blitBackground(background);
    else renderer.clear(0);
    let y = 10;
    if (logo) {
      renderer.blitSprite(logo, ((SCREEN_W - logo.w) / 2) | 0, y);
      y += logo.h;
    }
    y += 28;
    for (let i = 0; i < MENU_OPTIONS.length; i++) {
      /* CONFIRMED against the live capture: the selected option is flanked
       * by inward-pointing arrows on BOTH sides ("> LABEL <"), not a single
       * leading marker. */
      const line = i === this.cursor
        ? `>  ${MENU_OPTIONS[i]}  <`
        : `   ${MENU_OPTIONS[i]}   `;
      drawCentered(renderer, menuGlyphs, line, y, MENU_ADVANCE);
      y += 32;
    }
    /* At MENU_ADVANCE (16px/glyph) this 29-character line would run 464px —
     * wider than the 320px screen — so it stays on PSMLFNT/ADVANCE, which
     * is also the more honest choice: it's a port-only addition with no
     * original string to match a font against in the first place. */
    drawCentered(renderer, glyphs, 'ARROWS SELECT  SPACE CONFIRM', 182);
  }
}

/* `UNKNOWN_password_grid_layout` is CLOSED — 8 columns x 5 rows = 40 cells,
 * confirmed live in a DOSBox session this pass (A-X across 3 full rows,
 * then Y/Z/./space/0/1/2/3, then 4-9/erase/confirm), and CROSS-VALIDATED
 * against Gods/docs/dynamic-trace-and-runtime-data.md's own earlier
 * finding: that session moved the cursor "from index 34 to 39" via
 * "5x KBD_right" — row-major index 34 is column 2 of this grid's row 4
 * (the '6' cell) and index 39 is column 7 of row 4 (confirm), exactly 5
 * columns apart. Two cells are a port-level substitution, not a claim of
 * pixel fidelity: the real erase/confirm cells are a left-arrow icon and a
 * distinct circular icon (not a PSMLFNT glyph — reading it precisely would
 * need locating its own sprite asset, not attempted this pass), reproduced
 * here as '<'/'=' for the same glyph-safety reasons the header explains.
 * ⚠️ LEAD, not yet closed: a later pass (see MENU_ADVANCE's own citation
 * above) found the grid's OWN drawer, CS:0x30D4 — `FUN_1000_356e` blitting
 * descriptor `0x80 + n` for cell `n`, i.e. PGODFONT's own records 0-39 in
 * row-major order, the SAME atlas MENU_ADVANCE identifies (`0x80` = 128 =
 * PGODFONT's base). Records 0-25 line up exactly with this grid's own
 * `A`-`Z` (cells 0-25), and PGODFONT's last two records (39/40, past this
 * grid's own 0-39 range by one) ARE a left-arrow and a circular icon
 * on inspection (`tools/atlas-render.mjs PGODFONT`) — a strong lead for the
 * erase/confirm sprites this note has been calling unlocated. But records
 * 26-28 render as three short, unidentified marks, not `.`/space/space as
 * this grid's own `GRID_CELLS` below assumes, so the exact cell<->record
 * correspondence for row 4 onward is NOT re-derived here, and `PasswordEntry`
 * still draws through PSMLFNT, unchanged — swapping it needs that mapping
 * pinned down first (ideally cross-checked against a live capture the way
 * the grid's own geometry was), not assumed from the sequential-index
 * pattern alone. */
const GRID_COLS = 8, GRID_ROWS = 5;
const GRID_CELLS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
  'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
  'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
  'Y', 'Z', '.', ' ', '0', '1', '2', '3',
  '4', '5', '6', '7', '8', '9', '<', '=',
];
const CELL_DEL = '<', CELL_OK = '=';
const GRID_X0 = 16, GRID_Y0 = 40, GRID_COL_W = 36, GRID_ROW_H = 18;

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

  draw(renderer, glyphs, background) {
    if (background) renderer.blitBackground(background);
    else renderer.clear(0);
    /* `"ENTER A PASSWORD"`, 1ffd:eb96 (CS:0x2e2f's own message pointer —
     * see the header and zones.js's own citation of this exact string) —
     * this screen's own title, DISTINCT from the menu option's own label
     * "ENTER PASSWORD" (MENU_OPTIONS' own header note above). */
    drawCentered(renderer, glyphs, 'ENTER A PASSWORD', 8);

    /* The typed buffer. NOT confirmed live: a DOSBox session this pass
     * found a row of diamond glyphs below the real grid that does NOT
     * change as cells are fired (screenshotted before/after) — a fixed
     * decorative border, not a buffer readout, so the real screen's own
     * typed-feedback mechanism (if any) is still unlocated. This line is a
     * port-only UX affordance, not a fidelity claim: shown so a player can
     * see what they have typed. Blank slots use the diamond placeholder —
     * see the header's glyph-safety note for why not '_' or '-'. */
    const slots = [];
    for (let i = 0; i < PASSWORD_LENGTH; i++) slots.push(this.buffer[i] || DIAMOND);
    drawCentered(renderer, glyphs, slots.join(' '), 24);

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = GRID_CELLS[r * GRID_COLS + c];
        const marker = r === this.row && c === this.col ? DIAMOND + ' ' : '  ';
        drawText(renderer, glyphs, marker + cell, GRID_X0 + c * GRID_COL_W, GRID_Y0 + r * GRID_ROW_H);
      }
    }

    drawCentered(renderer, glyphs, '<  DELETE     =  CONFIRM', 140);
    drawCentered(renderer, glyphs, 'ARROWS MOVE  SPACE SELECT', 158);
    drawCentered(renderer, glyphs, 'ESC BACK TO MENU', 176);
  }
}
