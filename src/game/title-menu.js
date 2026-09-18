/* title-menu.js — the title screen: a 3-option menu, the letter-grid
 * password/name entry, and the "TOP TEN GODS" hiscore table, closing a gap
 * main.js's own comments flagged explicitly: "this port has no title screen
 * to route 'new game' through" and zones.js's `UNKNOWN_password_entry_ui`
 * ("the grid-entry UI that would let a player TYPE one back in is a
 * disclosed gap").
 *
 * ⚠️ **A later pass converted every widget here from keydown-driven to
 * TICK-POLLED (`step(input)`, the same shape `game/shop.js`'s `ShopScreen`
 * already has), while porting the title-screen/attract-mode system
 * (`game/attract.js`).** This was not a style change: the original's own
 * menu is itself polled once per logic frame off the SAME per-tick
 * `DS:0x382` byte real gameplay input reads — see `docs/dynamic-trace-and-
 * runtime-data.md`'s "The title screen" section: "UP -> cursor -1, clamp at
 * 0, click sfx 0x119, redraw" (from the poll_input head, not a keyboard
 * event). Once the attract-mode cycler needs to feed a `joyl` RECORDING'S
 * ticks into this exact same dispatch (`docs/passwords.md`'s "the recorded
 * demo navigating this same title menu with fake joystick input"), a
 * keydown-only widget has nowhere to receive them — `step(input)` is the
 * one entry point BOTH a real keyboard (via main.js's own shared `input`
 * object) and a decoded recording (`formats/joy.js`) drive identically, so
 * the two can never drift into two different behaviours. Every SFX play
 * that used to live in main.js's `handleTitleKey` (keyed off the raw
 * KeyboardEvent code) now lives in each widget's own `step()` instead — MORE
 * faithful, not just relocated: the original plays the click/confirm sound
 * from the menu's OWN dispatch, never from a key event itself. Real-keyboard
 * convenience-only actions with no `input` bit of their own (ESC, Backspace
 * — the original's per-frame joystick byte has no such bits) stay as
 * separate methods (`cancel()`/`eraseKey()`), called directly by main.js's
 * keydown handler and never reachable from a recording, exactly matching
 * `DS:0x382`'s own real shape.
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
 *   reproduced as a pseudo-DOS command-line screen instead — see
 *   Renderer.presentDosExit().
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
 *   The SAME grid+keyboard loop (`FUN_1000_2eb0`) also drives the hiscore
 *   NAME-ENTRY screen (`"ENTER YOUR NAME HERO"`, `1ffd:eba7`, `NameEntry`
 *   below) — `docs/dynamic-trace-and-runtime-data.md`'s own "hiscore
 *   name-entry screen" section. ⚠️ **The keyboard half of that shared loop
 *   is PROVEN DEAD CODE, not a disclosed simplification**: `CS:0x2F1A`'s own
 *   `CMP reg,0` can never set the carry flag (unsigned subtraction of 0
 *   never borrows), so the gate that would route a real BIOS keypress to
 *   the ASCII classifier (`CS:0x2FDA`) is UNREACHABLE by construction — a
 *   genuine authoring bug in the shipped `GAME.EXE`, confirmed live (a
 *   breakpointed Enter keypress was traced landing at the grid/fire test,
 *   never the ASCII path). The ONLY way to submit a name (or a password) on
 *   any real copy of this game is the on-screen letter grid via FIRE — this
 *   module never had to choose between porting the grid and porting a
 *   keyboard path, because only one of the two ever worked in the original.
 *   `NameEntry`'s own `maxLength` (16, not `PasswordEntry`'s 3) and its
 *   confirm gate (submits WHATEVER's typed, not exactly-N — a bug fix, see
 *   `LetterGrid#fire`'s own citation) both come from this being the
 *   general-purpose shared widget, not a password-specific one.
 *
 *   The grid's exact VISUAL geometry — `UNKNOWN_password_grid_layout` — is
 *   now [PROVEN] too, CLOSED this same session: an 8-column x 5-row, 40-cell
 *   grid (`A-H`/`I-P`/`Q-X`/`Y Z . <space> 0 1 2 3`/`4 5 6 7 8 9` then an
 *   erase icon then a distinct circular confirm icon (neither icon matched
 *   to a `PSMLFNT` glyph — their own sprite source not chased down)), read
 *   directly off a live capture and CROSS-VALIDATED against Gods/docs/
 *   dynamic-trace-and-runtime-data.md's own earlier, independent finding —
 *   a different session moved the cursor "from index 34 to 39" via "5x
 *   KBD_right" while completing a real hiscore entry, and row-major index
 *   34 in THIS grid is row 4 col 2 while 39 is row 4 col 7, exactly 5
 *   columns apart. `GRID_CELLS` below is now built from `formats/
 *   hiscores.js`'s own `ALPHABET_CHARS` (the SAME 38-entry table the
 *   HISCORES.BIN name codec uses — both are literally the one alphabet the
 *   game itself has), not a second, hand-copied literal array.
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
import { ALPHABET_CHARS, NAME_BYTES, bcdDigitString } from '../formats/hiscores.js';

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
 * confirm id serves BOTH `TitleMenu` and `PasswordEntry`/`NameEntry`, not a
 * separate one each. The click fires on any cursor move in the citation
 * (UP/DOWN); this port generalises it to LEFT/RIGHT too for the grid's own
 * 2-D navigation, a disclosed generalisation rather than a byte-cited claim
 * for that axis specifically. Every widget below plays these from its own
 * `step()`, not from a raw key event — see this file's own header. */
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
 * CS:0x2CAF-0x2E26 — the menu's own cursor/dispatch, now tick-polled off the
 * shared `input` object (see this file's own header for why) rather than
 * keydown-driven.
 */
export class TitleMenu {
  constructor() {
    this.cursor = 0;
    this.dirPrev = { up: false, down: false };
    this.firePrev = false;
  }

  /**
   * One tick. @param {{up:boolean,down:boolean,fire:boolean}} input
   * @returns {null|{sfx:number, action?:'begin'|'password'|'exit'}}
   */
  step(input) {
    const upEdge = !!input.up && !this.dirPrev.up;
    const downEdge = !!input.down && !this.dirPrev.down;
    this.dirPrev.up = !!input.up;
    this.dirPrev.down = !!input.down;
    if (upEdge) { this.cursor = Math.max(0, this.cursor - 1); return { sfx: MENU_CLICK_SFX }; }        // CS:0x2D18 clamp at 0
    if (downEdge) { this.cursor = Math.min(MENU_OPTIONS.length - 1, this.cursor + 1); return { sfx: MENU_CLICK_SFX }; } // CS:0x2D28 clamp

    const fireEdge = !!input.fire && !this.firePrev;
    this.firePrev = !!input.fire;
    if (fireEdge) return { sfx: MENU_CONFIRM_SFX, action: ['begin', 'password', 'exit'][this.cursor] }; // CS:0x2D50
    return null;
  }

  /** @param glyphs PSMLFNT — used ONLY for the port-only control-hint
   *    caption below, which has no original-game string to match (not found
   *    anywhere in this project's own string-table dump or live captures).
   *  @param menuGlyphs the MENU font (PGODFONT, main.js's own
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
 * `GRID_ERASE_DESC`/`GRID_CONFIRM_DESC`, descriptors 166/167).
 *
 * `GRID_CELLS` is `formats/hiscores.js`'s own `ALPHABET_CHARS` (the 38-cell
 * alphabet HISCORES.BIN's name field already uses) plus the two icon
 * sentinels — one array, not two independently-typed literals that could
 * silently drift apart. */
const GRID_COLS = 8, GRID_ROWS = 5;
const CELL_DEL = '<', CELL_OK = '=';   // internal sentinels only — never drawn as text, see draw()
const GRID_CELLS = [...ALPHABET_CHARS, CELL_DEL, CELL_OK];
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
 * the empty-slot placeholder (Space, see the header note above). For
 * `NameEntry` (`maxLength` 16), all 16 cells can hold real content. */
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
 * `FUN_1000_2eb0` — the shared interactive letter-grid loop behind BOTH the
 * password screen (`PasswordEntry`) and the hiscore name-entry screen
 * (`NameEntry`). Grid navigation, the erase/confirm cells, and the typed-
 * buffer readout are identical between the two; only the title text, the
 * max buffer length, and whether a "PASS n :xxx" hint row is drawn differ
 * (each subclass's own `draw()` / `title`/`maxLength` fields).
 */
class LetterGrid {
  constructor(maxLength) {
    /* DS:0x385 — a single FLAT 0..39 row-major index, not independent row/
     * col fields. `row`/`col` below are read-only views onto it, kept for
     * every existing caller (drawGrid, #fire, checks.js) that already
     * addresses cells that way — see `step()`'s own header for why the
     * underlying representation had to change. */
    this.cursor = 0;
    this.buffer = [];
    this.maxLength = maxLength;
    this.firePrev = false;
  }

  get row() { return (this.cursor / GRID_COLS) | 0; }
  get col() { return this.cursor % GRID_COLS; }

  /** Real-keyboard-only convenience, never driven by a recording (the
   *  original per-tick joystick byte, `DS:0x382`, has no ESC bit at all —
   *  see this file's own header). Port-only; the original grid has no
   *  "back", only the wrong-guess bounce `PasswordEntry`'s own caller
   *  already reproduces (`CS:0x2e8a`). @returns {{cancel:true}} */
  cancel() { return { cancel: true }; }

  /** Real-keyboard-only convenience for the SAME reason as `cancel()` — the
   *  grid's own erase CELL (`CELL_DEL`, reachable through `step()` and so
   *  replayable) does the identical thing; this is purely a keyboard
   *  shortcut for a human player, not a second mechanism. */
  eraseKey() { this.buffer.pop(); }

  /**
   * One tick. @param {{up:boolean,down:boolean,left:boolean,right:boolean,fire:boolean}} input
   * @returns {null|{sfx:number}|{sfx:number, submit:string}}
   *
   * ⚠️ FIXED — a full rewrite from fresh disassembly of `FUN_1000_2eb0`'s own
   * per-tick dispatch, `CS:0x2F26`-`0x2FD7`. The previous revision modelled
   * this as an edge-triggered 2D (row,col) pad — plausible-looking, but wrong
   * on every axis:
   *
   *   2F26  TEST [0x382],0x80 (FIRE) / JNZ 2F41
   *   2F2D    [0x380]:=0                          ; FIRE not held: clear the latch
   *   2F32    CMP [0x382],0 / JNZ 2F72             ; any OTHER bit -> directions
   *   2F39    (nothing pressed at all -> idle/redraw)
   *   2F41  [0x380]!=0 ? -> 2F39 (idle)            ; FIRE held, already latched: NO-OP —
   *                                                 ;   directions are UNREACHABLE this tick
   *   2F48  [0x380]:=1 ; click(0x233) ; dispatch    ; FIRE held, fresh press: fire only
   *
   *   2F72  RIGHT: ADD [0x385],1  ; ALWAYS clicks when held, no boundary test
   *   2F81  LEFT:  SUB [0x385],1  ; ALWAYS clicks when held, no boundary test
   *   2F90  UP:    cursor>=8  ? SUB 8, click : nothing
   *   2FA6  DOWN:  cursor<0x20 ? ADD 8, click : nothing
   *   2FBC  clamp cursor to [0, 0x27] (39)          ; runs every tick regardless
   *
   * Three genuine divergences from the old model, all load-bearing for a
   * long recorded input stream (this is what made `PJOYL2.DAT`'s own grid
   * navigation drift forever without ever reaching the confirm cell):
   *   1. `DS:0x385` is ONE FLAT 0..39 index, not independent row/col — RIGHT/
   *      LEFT are a bare `+-1` that FREELY CROSSES ROW BOUNDARIES (col 7 of
   *      one row is adjacent to col 0 of the next), not clamped within the
   *      current row the way a 2D pad would clamp it.
   *   2. There is NO debounce latch on any of the four directions (unlike
   *      FIRE's own `DS:0x380`) — holding a direction moves EVERY tick it's
   *      held, not once per press-release cycle.
   *   3. Directions are only ever reached when FIRE is NOT held this tick —
   *      a held FIRE suspends navigation entirely (see `[0x380]` above), it
   *      doesn't merely fail to also move the cursor.
   * RIGHT/LEFT click unconditionally (even a tick that will be clamped back
   * to the SAME cursor, e.g. holding RIGHT at the confirm cell); UP/DOWN
   * click only on a tick that actually moves — a real, disassembly-confirmed
   * asymmetry, not smoothed over. Multiple directions held in one tick all
   * apply, in this exact order (CS:0x2F72 falls through to 0x2F81 to 0x2F90
   * to 0x2FA6 unconditionally) — collapsed here to a single `{sfx}` per
   * tick regardless of how many of the four independently clicked, since
   * nothing downstream plays more than one sfx per tick anyway.
   */
  step(input) {
    if (input.fire) {
      if (this.firePrev) return null;               // CS:0x2F41/0x2F39 — repeat hold, no-op
      this.firePrev = true;                          // CS:0x2F48
      return { sfx: MENU_CONFIRM_SFX, ...this.#fire() };
    }
    this.firePrev = false;                           // CS:0x2F2D
    let clicked = false;
    if (input.right) { this.cursor += 1; clicked = true; }                              // CS:0x2F72-0x2F7E
    if (input.left)  { this.cursor -= 1; clicked = true; }                              // CS:0x2F81-0x2F8D
    if (input.up && this.cursor >= GRID_COLS) { this.cursor -= GRID_COLS; clicked = true; }              // CS:0x2F90-0x2FA3
    if (input.down && this.cursor < GRID_COLS * (GRID_ROWS - 1)) { this.cursor += GRID_COLS; clicked = true; } // CS:0x2FA6-0x2FB9
    if (this.cursor > GRID_CELLS.length - 1) this.cursor = GRID_CELLS.length - 1;        // CS:0x2FBC-0x2FC3
    if (this.cursor < 0) this.cursor = 0;                                                // CS:0x2FC8-0x2FD2
    return clicked ? { sfx: MENU_CLICK_SFX } : null;
  }

  /**
   * ⚠️ FIXED — CS:0x3030 is the confirm-cell's own dispatch, and it submits
   * WHATEVER is in the buffer unconditionally: `RET`s straight out of
   * `FUN_1000_2eb0` (see the header's "hiscore name-entry screen" citation:
   * a live capture completed a 16-character name through this exact path).
   * An earlier revision of this widget only allowed confirming at EXACTLY
   * `maxLength` characters — harmless for a human typing a 3-letter
   * password, but it silently ate the attract-mode demo's own "L"+digit
   * password bypass (`docs/passwords.md`'s own citation), a real 2-
   * character submission this gate would have discarded.
   */
  #fire() {
    const cell = GRID_CELLS[this.cursor];
    if (cell === CELL_DEL) { this.buffer.pop(); return {}; }
    if (cell === CELL_OK) return { submit: this.buffer.join('') };
    if (this.buffer.length < this.maxLength) this.buffer.push(cell);
    return {};
  }

  /** Shared grid + typed-buffer rendering, `FUN_1000_30d4`/`0x3065`/`0x3097`.
   * @param eraseIcon `hero.gridEraseIcon` (grid record 38).
   * @param confirmIcon `hero.gridConfirmIcon` (grid record 39).
   * @param cursorFrames `hero.cursorFrames`, 4 entries (descriptors 87-90).
   * @param tick `clock.tick` — selects the cursor's own phase. */
  drawGrid(renderer, menuGlyphs, eraseIcon, confirmIcon, cursorFrames, tick) {
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
  }

  drawBufferRow(renderer, menuGlyphs) {
    for (let i = 0; i < BUFFER_ROW_LEN; i++) {
      const ch = this.buffer[i] || ' ';
      const f = menuGlyphs && menuGlyphs[ch.charCodeAt(0)];
      if (f) renderer.blitSprite(f, BUFFER_ROW_X0 + i * BUFFER_ROW_ADVANCE, BUFFER_ROW_Y);
    }
  }
}

/**
 * CS:0x2e2f/0x2e6c-0x2ea8 — the letter-grid password entry. `step` returns
 * `{sfx, submit:string}` (exactly PASSWORD_LENGTH letters expected by
 * convention — the confirm cell will submit fewer if pressed early, see
 * `LetterGrid#fire`'s own citation — to be checked against zones.js's
 * `passwordSlots` by the caller, or matched against the attract-mode "L"+
 * digit bypass, `docs/passwords.md`'s own citation) or `{cancel: true}`
 * (ESC, via `cancel()` — a port-only convenience). This module owns no game
 * state.
 */
export class PasswordEntry extends LetterGrid {
  constructor() { super(PASSWORD_LENGTH); }

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
    this.drawGrid(renderer, menuGlyphs, eraseIcon, confirmIcon, cursorFrames, tick);
    this.drawBufferRow(renderer, menuGlyphs);

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

/**
 * `"ENTER YOUR NAME HERO"` (`1ffd:eba7`) — `FUN_1000_2eb0` again, this time
 * called from `FUN_1000_318f` (the game-over/hiscore-insertion sequence).
 * Same grid, same confirm-submits-whatever-length-is-typed behaviour
 * (`LetterGrid#fire`), `maxLength` = `NAME_BYTES` (16, `formats/
 * hiscores.js`) rather than `PasswordEntry`'s 3. No hint row — the shared
 * `FUN_1000_32FE` line is drawn on the password screen and the hiscore
 * TABLE (`HiscoreTable` below), not this entry screen.
 */
export class NameEntry extends LetterGrid {
  constructor() { super(NAME_BYTES); }

  draw(renderer, menuGlyphs, eraseIcon, confirmIcon, background, cursorFrames, tick) {
    if (background) renderer.blitBackground(background);
    else renderer.clear(0);
    drawCentered(renderer, menuGlyphs, 'ENTER YOUR NAME HERO', 8, MENU_ADVANCE);
    this.drawGrid(renderer, menuGlyphs, eraseIcon, confirmIcon, cursorFrames, tick);
    this.drawBufferRow(renderer, menuGlyphs);
  }
}

/* ── The hiscore table, "TOP TEN GODS" (`FUN_1000_32c0`) ──────────────────
 *
 * `[PROVEN]` — a later pass closed the geometry gap an earlier revision of
 * this header disclosed as unrecovered, by raw-disassembling (not just
 * decompiling) `FUN_1000_32c0`'s own draw chain instead of stopping at the
 * decompiler's mangled register-passed-parameter output:
 *
 *   32C6  si = 0xeb89 ("TOP TEN GODS") ; ax = 0x40 ; bx = 8
 *   32CF  call 0x224e                    ; title, raw (X,Y) — NOT the
 *                                         ;   FUN_1000_646f centering wrapper
 *                                         ;   PasswordEntry's own title uses,
 *                                         ;   but 0x40 IS the centred X for a
 *                                         ;   12-char string at 16px/glyph
 *                                         ;   anyway, so the two are pixel-
 *                                         ;   identical here
 *
 *   337C  bx = 0x28(40)                  ; row 0's Y
 *         si = 0x45e                     ; the live table base
 *         cx = 0xa (10 rows)
 *   3385  ax = 0x14(20)                  ; NAME column X
 *   3388  call 0x33ea(ax=X, bx=Y, si)    ; draws 16 chars (0x10-iteration
 *                                         ;   LODSB loop — the SAME 16-byte
 *                                         ;   name-field correction formats/
 *                                         ;   hiscores.js derived from the
 *                                         ;   file's own bytes, now confirmed
 *                                         ;   from the OTHER side: the code
 *                                         ;   that reads them), advancing SI
 *                                         ;   by 16 (name -> score)
 *   338B  ax += 0x28(40) -> 0x3c(60)     ; SCORE column X
 *   338E  call 0x3397(ax=X, bx=Y, si)    ; draws 8 raw BCD digit glyphs (high
 *                                         ;   nibble then low, 4 bytes in
 *                                         ;   on-disk/big-endian order — see
 *                                         ;   hiscores.js's own bcdDigitString),
 *                                         ;   then nets SI += 4 (score field,
 *                                         ;   -> the NEXT record's own name)
 *   3391  bx += 0xd(13)                  ; next row's Y
 *   3394  loop 3385                      ; 10 rows total
 *
 * Every character (name letters AND score digits alike) advances by 0xa(10)
 * px, inside the shared low-level blit `FUN_1000_33c1` itself (`ADD DX,0xa`)
 * — the SAME PSMLFNT `ADVANCE` this module's own `drawText` already
 * defaults to. So: NAME column X=20 (spanning 20-180, all 16 cells always
 * drawn — a pad byte draws PSMLFNT's own space glyph, not nothing), SCORE
 * column X=60 (spanning 60-140, all 8 digits always drawn, genuine leading
 * zeros). ⚠️ These two spans OVERLAP for any name past 4 characters (60
 * is column 4 of the name field) — checked, not smoothed over: the shipped
 * defaults reach up to 8 characters (HERACLES/POSEIDON/DIONYSUS), so on
 * real hardware the score digits are drawn ON TOP of (after) the tail of
 * a long name. That is what `FUN_1000_337c`'s own call order does
 * (name first, score second), not a port bug to route around.
 *
 * PSMLFNT's own `DS:0x138`-based ascii-vs-raw-digit dispatch quirk inside
 * `FUN_1000_33c1` (the name path passes an ASCII code, the score/digit path
 * a raw 0-9 value, to the SAME call) needs no separate handling here: this
 * module's own `drawText`/`glyphs[charCode]` convention already normalises
 * everything to plain characters before drawing, the same as every other
 * screen in this file.
 *
 * The ~500-tick wait-for-fire-or-timeout (`FUN_1000_255d`, `HISCORE_TABLE_
 * TICKS` below) and the shared `FUN_1000_32FE` "PASS n :xxx" hint row
 * (drawn on this screen too, per that function's own header citation) are
 * both wired below.
 */
export const HISCORE_TABLE_TICKS = 500;   // ~33.3s at 15Hz — docs' own "~500 ticks"
const HISCORE_TITLE_Y = 8;                // CS:0x32C9 `bx=8`
const HISCORE_ROW_Y0 = 40, HISCORE_ROW_H = 13;   // CS:0x337C `bx=0x28`; CS:0x3391 `bx+=0xd`
const HISCORE_NAME_X = 20, HISCORE_SCORE_X = 60; // CS:0x3385 `ax=0x14`; CS:0x338B `ax+=0x28`

export class HiscoreTable {
  /** @param {Array<{name:string, scoreBytes:Uint8Array}>} entries `decodeHiscores`'s own 10 rows */
  constructor(entries) {
    this.entries = entries;
    this.ticks = 0;
    this.firePrev = false;
  }

  /** One tick. @returns {boolean} true once this screen is ready to dismiss
   *  (a FIRE press, or the ~500-tick timeout — `FUN_1000_255d`'s own two
   *  exit conditions; the BIOS-keyboard-any-key exit is the proven-dead
   *  path elsewhere in this same shared loop family, not ported). */
  step(input) {
    this.ticks++;
    const fireEdge = !!input.fire && !this.firePrev;
    this.firePrev = !!input.fire;
    return fireEdge || this.ticks >= HISCORE_TABLE_TICKS;
  }

  draw(renderer, glyphs, menuGlyphs, background, passwordSlots) {
    if (background) renderer.blitBackground(background);
    else renderer.clear(0);
    drawCentered(renderer, menuGlyphs, 'TOP TEN GODS', HISCORE_TITLE_Y, MENU_ADVANCE);
    for (let i = 0; i < this.entries.length; i++) {
      const y = HISCORE_ROW_Y0 + i * HISCORE_ROW_H;
      drawText(renderer, glyphs, this.entries[i].name, HISCORE_NAME_X, y, ADVANCE);
      /* CS:0x33A2-0x33B7 — all 8 raw BCD digits, genuine leading zeros, not
       * a right-justified decimal (bcdDigitString's own citation). */
      drawText(renderer, glyphs, bcdDigitString(this.entries[i].scoreBytes), HISCORE_SCORE_X, y, ADVANCE);
    }
    if (passwordSlots) {
      for (let i = 0; i < passwordSlots.length; i++) {
        const chars = passwordSlots[i];
        if (!chars) continue;
        const text = `PASS ${i + 2} :${passwordToString(chars)}`;
        drawText(renderer, glyphs, text, HINT_ROW_X[i], HINT_ROW_Y, HINT_ADVANCE);
      }
    }
  }
}
