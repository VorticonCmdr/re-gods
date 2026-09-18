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
import { PASSWORD_LENGTH, passwordToString } from './zones.js';

export const ADVANCE = 0x0a;    // 10 — the same per-glyph step message.js uses

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
 * in the exact style visible on the real title screen.
 * PGODFONT's FULL record map, pixel-verified this pass per-record (an
 * earlier revision of this comment had the digits and icons each one
 * record too high, from misreading a cropped strip render rather than
 * each record's own exact bounds):
 *   0-25    'A'-'Z'
 *   26      '.'
 *   27      two small dots (unidentified — not used by any string this
 *           port draws through this font)
 *   28-37   '0'-'9'
 *   38      LEFT-pointing arrow  (pixel-verified: touches the sprite's own
 *           left edge only at its middle rows — the point — and its right
 *           edge across a wide row band — the tail)
 *   39      a small circular icon with text too fine to read at 16x16
 *   40      RIGHT-pointing arrow (mirror of 38's own edge-touch profile)
 *   41      the 208x46 title logo (not 16x16 like 0-40 — main.js's own
 *           #169 anchor)
 * CS:0x3148-0x3179 (FUN_1000_311c, right after the 3 option lines) blits
 * descriptor 0xA8 (128+40, the RIGHT arrow) at fixed X=0x18(24), then 0xA6
 * (128+38, the LEFT arrow) at fixed X=0x118(280), both at the SAME row the
 * selected option's own text uses (Y := cursor*32+0x52, matching FUN_1000_
 * 646f's own three Y args 0x52/0x72/0x92 exactly) — i.e. the LEFT-side icon
 * points RIGHT/inward and the RIGHT-side icon points LEFT/inward, matching
 * this doc's own already-established "inward-pointing arrows on both
 * sides" finding and the real screenshot. These are FIXED-position sprite
 * blits, not flowed text characters — MENU_ARROW_LEFT/RIGHT below, used
 * directly by TitleMenu.draw(), not through `menuGlyphs`'s own ASCII '<'/
 * '>' (which this font has no glyphs for at all, silently rendering
 * nothing — the bug a user report caught after the font swap).
 * Records 39-40's own circular icon and RIGHT arrow are also a real,
 * pixel-verified lead for title-menu.js's own previously-unlocated
 * erase/confirm icon sprites for the password grid below (FUN_1000_30d4
 * blits through this SAME atlas, `0x80+n` for cell `n`) — NOT wired up
 * there yet (`PasswordEntry` still uses PSMLFNT throughout, a disclosed,
 * still-open follow-up), since that grid's own exact cell<->record
 * correspondence past 'A'-'Z' (records 26/27's own two unidentified marks
 * don't match `GRID_CELLS`' assumed `.`/space/space) isn't re-derived here.
 * PSMLFNT (message.js's own font, `glyphs` below) remains genuinely correct
 * for the password grid and the in-level message line — this citation only
 * corrects the MENU/QUIT-GAME/tally-screen font, previously assumed (menu)
 * or explicitly disclosed as a stand-in (tally.js) to be PSMLFNT too. */
export const MENU_ADVANCE = 0x10;   // 16
export const MENU_ARROW_LEFT_DESC = 168;   // 0xA8 = 128+40 — RIGHT-pointing arrow, drawn at the LEFT slot
export const MENU_ARROW_RIGHT_DESC = 166;  // 0xA6 = 128+38 — LEFT-pointing arrow, drawn at the RIGHT slot
export const MENU_ARROW_LEFT_X = 0x18;     // 24
export const MENU_ARROW_RIGHT_X = 0x118;   // 280

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

/** Draw `text` left-to-right from (x, y), one glyph sprite per character.
 * CS:0x224E's own byte loop: 0x20 (space) advances the cursor but blits
 * NOTHING — not even a blank/transparent sprite — so two words separated by
 * a real space render with a true gap, not a visible placeholder glyph in
 * between (an earlier revision of this port blitted `glyphs[0x20]` like any
 * other character, which is correct ONLY for the password grid's own direct
 * per-cell blits — see GRID_CELLS' own space cell and BUFFER_ROW_* below,
 * neither of which goes through this function — and produced a stray dot
 * between every word of flowed text like "ENTER A PASSWORD" instead). */
export function drawText(renderer, glyphs, text, x, y, advance = ADVANCE) {
  if (!glyphs) return;
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') {
      const f = glyphs[text.charCodeAt(i)];
      if (f) renderer.blitSprite(f, cx, y);
    }
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
   *    (MENU_OPTIONS) draw through this one, not PSMLFNT.
   *  @param {?object} arrowLeft `hero.frames[MENU_ARROW_LEFT_DESC]` (a
   *    RIGHT-pointing arrow — see MENU_ADVANCE's own citation for why).
   *  @param {?object} arrowRight `hero.frames[MENU_ARROW_RIGHT_DESC]`. */
  draw(renderer, glyphs, menuGlyphs, arrowLeft, arrowRight, logo, background) {
    if (background) renderer.blitBackground(background);
    else renderer.clear(0);
    let y = 10;
    if (logo) {
      renderer.blitSprite(logo, ((SCREEN_W - logo.w) / 2) | 0, y);
      y += logo.h;
    }
    y += 28;
    for (let i = 0; i < MENU_OPTIONS.length; i++) {
      drawCentered(renderer, menuGlyphs, MENU_OPTIONS[i], y, MENU_ADVANCE);
      /* CS:0x3148-0x3179 — FIXED-position sprite blits, not text flanking the
       * label (an earlier revision of this line drew literal '<'/'>' glyphs
       * inline, which silently rendered as nothing once menuGlyphs (PGODFONT)
       * replaced PSMLFNT here, since PGODFONT has no ASCII '<'/'>' at all —
       * see MENU_ADVANCE's own citation for the real descriptors/positions
       * and the live-confirmed "inward-pointing" placement). */
      if (i === this.cursor) {
        if (arrowLeft) renderer.blitSprite(arrowLeft, MENU_ARROW_LEFT_X, y);
        if (arrowRight) renderer.blitSprite(arrowRight, MENU_ARROW_RIGHT_X, y);
      }
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
 * confirmed live in a DOSBox session (A-X across 3 full rows, then
 * Y/Z/./space/0/1/2/3, then 4-9/erase/confirm), and CROSS-VALIDATED against
 * Gods/docs/dynamic-trace-and-runtime-data.md's own earlier finding: that
 * session moved the cursor "from index 34 to 39" via "5x KBD_right" — row-
 * major index 34 is column 2 of this grid's row 4 (the '6' cell) and index
 * 39 is column 7 of row 4 (confirm), exactly 5 columns apart.
 *
 * The exact PIXEL GEOMETRY and FONT are now `[PROVEN]` too, by decompiling
 * `FUN_1000_30d4` directly (Gods/docs/passwords.md's own UI section): 8
 * columns of 32px starting at X=40, 5 rows of 24px starting at Y=40, each
 * cell blitting PGODFONT descriptor `0x80 + (row*8+col)` — i.e. PGODFONT's
 * own records 0-39 in row-major order, DIRECTLY (not the title menu's own
 * left/right-swapped arrow placement). This also closes a genuinely
 * previously-unidentified glyph: record 27 (this grid's own 'space' cell,
 * index 27) is the space glyph itself — `FUN_1000_3065`'s typed-buffer
 * readout (below) substitutes alphabet code `0x1C` (Space, this project's
 * own established a-z/digit/./space encoding) for an empty buffer slot, and
 * `0x1C + 0x7F - 0x80 = 27` — the same record this grid's own row 4 uses,
 * not a mystery "two small dots" icon as an earlier pass of this project's
 * documentation had it. Records 38/39 (this grid's own erase/confirm cells)
 * are main.js's `gridEraseIcon`/`gridConfirmIcon` (`loadSprites()`'s own
 * `GRID_ERASE_DESC`/`GRID_CONFIRM_DESC`, descriptors 166/167). */
const GRID_COLS = 8, GRID_ROWS = 5;
const GRID_CELLS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
  'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
  'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
  'Y', 'Z', '.', ' ', '0', '1', '2', '3',
  '4', '5', '6', '7', '8', '9', '<', '=',
];
const CELL_DEL = '<', CELL_OK = '=';   // internal sentinels only — never drawn as text, see draw()
const GRID_X0 = 40, GRID_Y0 = 40, GRID_COL_W = 32, GRID_ROW_H = 24;   // CS:0x30D4, exact

/* CS:0x3097 — the cursor is a small 4-frame animated icon (descriptor
 * 0x57+phase, i.e. global descriptors 87-90, one "always"-group PALWAYS2
 * record per phase — `tools/atlas-render.mjs PALWAYS2` shows records 48-51,
 * global 87-90, are a 4-frame twinkling/sparkle star, white-gold, rotating
 * through its points) blitted AT the selected cell's own position — the
 * SAME (X,Y) the grid's own letter/digit uses, not an offset marker — one
 * phase advance per logic tick (`FUN_1000_3097` runs once per iteration of
 * the 15 Hz grid-loop, `FUN_1000_2eb0`, matching `clock.tick` directly). */

/* CS:0x3065 — the typed-buffer readout: NOT a decorative border (an
 * earlier pass of this project's own documentation, and this module's own
 * prior revision, both read it that way from a live capture that happened
 * not to catch it changing). It is a real 16-cell row, left-aligned at
 * X=32, Y=168, 16px/cell, reading `DS:0x3004` (the SAME scratch buffer the
 * grid input loop fills) byte-for-byte — so for a 3-letter password only
 * the first 3 cells ever show real content, the other 13 are permanently
 * the empty-slot placeholder (Space, see the header note above). */
const BUFFER_ROW_X0 = 32, BUFFER_ROW_Y = 168, BUFFER_ROW_ADVANCE = 16, BUFFER_ROW_LEN = 16;

/* CS:0x32FE, shared with the "TOP TEN GODS" hiscore table (FUN_1000_32c0)
 * AND this grid-entry loop itself (FUN_1000_2eb0) — drawn on BOTH screens,
 * not hiscore-table-only as an earlier pass of this project's own
 * documentation had it. One line per already-generated password (a slot
 * that has never been filled this session draws nothing at all, not even a
 * blank template), at FIXED positions regardless of which slots are
 * actually filled: X = 10/110/210, Y = 190, small font (PSMLFNT-style, an
 * 8px stride — narrower than this module's own default ADVANCE). Format is
 * the literal on-disk template `"pass N : "` with the digit and 3 letters
 * patched in — `"PASS 2 :PME"` for a real world-2 password, exactly. See
 * Gods/docs/passwords.md's own "Disk persistence" and "The generator"
 * sections. */
const HINT_ROW_Y = 190, HINT_ROW_X = [10, 110, 210], HINT_ADVANCE = 8;

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

  /**
   * @param glyphs PSMLFNT — used only for the small hint-line text below.
   * @param menuGlyphs PGODFONT — the title and every grid cell's own letter/
   *   digit/'.'/space now draw through this (CS:0x30D4/0x3065), not PSMLFNT.
   * @param {?object} eraseIcon `hero.gridEraseIcon` (grid record 38).
   * @param {?object} confirmIcon `hero.gridConfirmIcon` (grid record 39).
   * @param {?object} background `titleBackground` — CS:0x2e2f draws no
   *   background of its own, so whatever PBACKSCR the title menu already
   *   put up stays behind this screen too.
   * @param {Array<number[]|null>} passwordSlots main.js's own 3-slot array
   *   (index 0..2 -> world 2..4) — read-only here, for the hint line only.
   * @param {?Array<object>} cursorFrames `hero.cursorFrames`, 4 entries
   *   (descriptors 87-90) — see CURSOR_* header note above.
   * @param {number} tick `clock.tick` — selects the cursor's own phase.
   */
  draw(renderer, glyphs, menuGlyphs, eraseIcon, confirmIcon, background, passwordSlots,
    cursorFrames, tick) {
    if (background) renderer.blitBackground(background);
    else renderer.clear(0);
    /* `"ENTER A PASSWORD"`, 1ffd:eb96 (CS:0x2e2f's own message pointer) —
     * this screen's own title, DISTINCT from the menu option's own label
     * "ENTER PASSWORD". Drawn via PGODFONT (CS:0x30D4 calls FUN_1000_224e,
     * the SAME routine the title menu's own options use), not PSMLFNT. */
    drawCentered(renderer, menuGlyphs, 'ENTER A PASSWORD', 8, MENU_ADVANCE);

    /* The grid itself — bare glyphs, no per-cell marker prefix (the real
     * screen draws only the letter/digit/icon, nothing else). */
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = GRID_CELLS[r * GRID_COLS + c];
        const x = GRID_X0 + c * GRID_COL_W, y = GRID_Y0 + r * GRID_ROW_H;
        if (cell === CELL_DEL) { if (eraseIcon) renderer.blitSprite(eraseIcon, x, y); }
        else if (cell === CELL_OK) { if (confirmIcon) renderer.blitSprite(confirmIcon, x, y); }
        else if (menuGlyphs) {
          const f = menuGlyphs[cell.charCodeAt(0)];
          if (f) renderer.blitSprite(f, x, y);
        }
        if (r === this.row && c === this.col && cursorFrames && cursorFrames.length) {
          const f = cursorFrames[(tick | 0) % cursorFrames.length];
          if (f) renderer.blitSprite(f, x, y);
        }
      }
    }

    /* The typed-buffer readout — see BUFFER_ROW_* header note above. */
    for (let i = 0; i < BUFFER_ROW_LEN; i++) {
      const ch = this.buffer[i] || ' ';
      const f = menuGlyphs && menuGlyphs[ch.charCodeAt(0)];
      if (f) renderer.blitSprite(f, BUFFER_ROW_X0 + i * BUFFER_ROW_ADVANCE, BUFFER_ROW_Y);
    }

    /* The hint line(s) — see HINT_ROW_* header note above. */
    if (passwordSlots) {
      for (let i = 0; i < passwordSlots.length; i++) {
        const chars = passwordSlots[i];
        if (!chars) continue;   // CS:0x32FE's own `if (*pcVar3 != 0)` guard — empty slot draws nothing
        const text = `PASS ${i + 2} :${passwordToString(chars)}`;
        drawText(renderer, glyphs, text, HINT_ROW_X[i], HINT_ROW_Y, HINT_ADVANCE);
      }
    }
  }
}
