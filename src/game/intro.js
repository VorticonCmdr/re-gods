/* intro.js — INTROV.EXE's pre-game sequence: the "RENEGADE PRESENTS..."
 * opener, the "GODS" logo card, the production-team credits, and the 8-page
 * story crawl that precedes GAME.EXE's own title menu (title-menu.js).
 * Ported because the port previously had no intro at all — main.js booted
 * straight into 'menu'.
 *
 * ⚠️ **A later pass fully disassembled `analysis/unpacked/INTROV.unpacked.exe`
 * in Ghidra** (imported fresh this session — the project's Ghidra project
 * only ever had GAME.EXE/VGA.EXE loaded before) and corrected several
 * things this file's FIRST draft had wrong, having been built only from a
 * live screen capture and a visual read of the font atlas. Read the whole
 * header before touching the constants below; several are now real,
 * disassembly-derived facts, not guesses:
 *
 * REAL SEQUENCE (entry() -> FUN_1000_0136, traced call-by-call):
 *   1. FUN_1000_0ab3: "RENEGADE" / "PRESENTS" / "A BITMAP BROTHERS" / "GAME"
 *      — 4 separate single-line full screens, WHITE "titles" font (`bd`
 *      register/global `DS:0xbd` = 0x30 for this whole call).
 *   2. FUN_1000_0870 -> FUN_1000_0a07: the "GODS" logo card (backdrop +
 *      wordmark), standalone.
 *   3. FUN_1000_0143: `DS:0xbd` reset to 0 (GOLD "credits" font) for
 *      "PRODUCTION TEAM" / "CODE"+"STEVE TALL" / "GRAPHICS"+"MARK COLEMAN" /
 *      "DESIGN"+"ERIC MATTHEWS"+"STEVE TALL" / "MUSIC"+"NATION XII" /
 *      "MUSIC CODE AND SFX"+"RICHARD JOSEPH" / "ADDITIONAL CODE"+
 *      "MIKE MONTGOMERY" — each group one screen, drawn with `FUN_1000_0d10`
 *      called once per LINE (confirmed by literal call count per group) —
 *      then the "GODS" wordmark alone again (`FUN_1000_0a1f`, no backdrop
 *      redraw — CALLED THE SAME WAY logo step 2 draws it, just the 7 tiles,
 *      not a fresh full card), then "INTO THE WONDERFUL" (GOLD font too,
 *      NOT white — corrected from this file's first draft, which had it
 *      grouped with "LOADING GAME" under the white font).
 *   4. FUN_1000_057c: the 8-page story crawl (confirmed by counting exactly
 *      8 calls to `FUN_1000_07ae`, the per-page draw+hold routine, split
 *      3+5 around an intermediate fade). Uses a THIRD glyph-index formula —
 *      see STORY FONT below.
 *   5. Falls through into `entry()`'s own shared tail: `DS:0xbd` reset to 0
 *      again, "LOADING GAME" drawn (GOLD font), then `FUN_1000_1128` —
 *      confirmed to be a plain `INT 21h AH=4Bh` EXEC of `GAME.EXE` — runs.
 *
 * DOES **NOT** LOOP — corrected from this file's first draft. `entry()` is
 * straight-line code with no backward branch anywhere in its own body or in
 * any function it calls for this sequence; it runs 1-5 above exactly once
 * and hands off to `GAME.EXE`. What the first draft's live DOSBox session
 * saw "loop back to the logo card" after leaving it running unattended was
 * almost certainly `GAME.EXE`'s OWN, already-ported idle-timeout attract
 * cycle (title-menu.js/attract.js) redrawing ITS OWN similar-looking "GODS"
 * title logo (PGODFONT descriptor #169, a different asset) after control
 * had already passed to it — not INTROV.EXE repeating. This port now ends
 * the sequence once, at step 5, same as the disassembly.
 *
 * SKIP — confirmed exactly: `DS:0x193` is a global "skip requested" flag,
 * set the instant `FUN_1000_12d8` (called at the top of essentially every
 * wait loop) sees a key waiting in the BIOS buffer (`INT 21h` function
 * check, bit 0x80). EVERY wait loop in the sequence checks it every
 * iteration and jumps straight to the SAME shared tail as step 5 above the
 * moment it's set — so "any key skips to the title menu" is real, uniform,
 * and reachable from any point in the sequence, confirmed structurally
 * rather than only by the one live keypress test the first draft relied on.
 *
 * FONTS — THREE distinct glyph-index formulas were found, not one shared
 * one as the first draft assumed:
 *   - WHITE "titles" font (steps 1's four strings): `idx = ch + 0x30 - 0x41`
 *     (`FUN_1000_0d2a`, `DS:0xbd`=0x30) — for real uppercase ASCII 'A'-'Z'
 *     this lands exactly on records 48-73, confirmed both by the formula's
 *     own arithmetic (0x41+0x30-0x41=48, 0x5A+0x30-0x41=73) and by this
 *     being the SAME routine the gold credits font uses with `bd`=0.
 *   - GOLD "credits" font (steps 2-3's role/name lines and "LOADING GAME"):
 *     same routine, `DS:0xbd`=0, so `idx = ch - 0x41` — records 0-25 for
 *     'A'-'Z' directly (this part of the first draft was already right).
 *   - GOLD "story" font (step 4's poem): a COMPLETELY DIFFERENT routine,
 *     `FUN_1000_0d72`, `idx = ch + 9` — no `bd` register, no case-folding.
 *     For real lowercase 'a'-'z' (0x61-0x7A, exactly what the shipped poem
 *     text is) this lands on records 106-131, the atlas's own last 26
 *     records — ending exactly at record 131, the atlas's final record.
 *     **The first draft's "upper-fold before indexing" was wrong** — the
 *     real formula takes the shipped lowercase bytes completely as-is, no
 *     case conversion of any kind. It also resolves the shipped text's own
 *     "heroGs" (for "hero's") without any special-casing: 'G' (0x47) is
 *     just an ordinary input to the SAME formula, landing on record 80 —
 *     independently confirmed to BE an apostrophe-shaped glyph by this
 *     project's own visual atlas read. Not a bug, not this port's
 *     approximation — the developers reused the letter 'G' as a numeric
 *     shortcut into the one glyph they needed at that exact record.
 *   - Per-character advance also differs: 16px for both credits-routine
 *     fonts (`FUN_1000_0d2a`'s own `AX += 0x10`), but 8px for the story
 *     font (`FUN_1000_0d72`'s own `AX += 8`) — a deliberately tighter,
 *     overlapping kerning, not a port approximation.
 *
 * ASSETS (confirmed live in DOSBox — `gods` launches GODS.EXE, which EXECs
 * INTROV.EXE before GAME.EXE, per Gods/docs/dynamic-trace-and-runtime-
 * data.md — and by direct decode against this port's own pi1.js/atlas.js):
 *   PSTBACK.PI1  — the logo card's stone-wall/helmet backdrop.
 *   PONE.PI1     — the hero-portrait backdrop behind the story crawl.
 *   PINTROFT.PI1 — a 320x200 atlas image holding THREE distinct fonts plus
 *                  the "GODS" wordmark, self-labelled in the shipped art
 *                  ("^CREDITS FNT" / "^TITLES FONT" / "^FONT FOR STORY").
 *   PINTROFT.DAT — its descriptor table, same 2+10*count schema as every
 *                  other P*.DAT (formats/atlas.js) — parses cleanly at 132
 *                  records.
 *
 * STRING POOL — read byte-exact off `analysis/unpacked/INTROV.unpacked.exe`
 * (Gods/docs/execution-and-boot.md's own citation, `introv 0x2a3e-0x2cd5`),
 * not retyped from prose. The eight story pages are separated in the
 * shipped bytes by a literal 0xFF marker.
 *
 * TIMING — real, relative, disassembly-derived for the FOUR white-font
 * cards (the `DS:0x93` tick counter's own thresholds, "id<2" sound-driver
 * branch): RENEGADE holds ~87 ticks; PRESENTS ~193; A BITMAP BROTHERS
 * ~180; GAME ~188 (i.e. RENEGADE is a short flash, the three-word phrases
 * hold roughly twice as long each — CREDIT_HOLD_WEIGHTS below encodes
 * these ratios instead of the first draft's flat uniform guess). The GOLD
 * credit cards' own thresholds were read too but not fully reduced to
 * per-card deltas this pass; they're within the same rough order of
 * magnitude and this port keeps a flat hold for them, disclosed as
 * unweighted. **Still open, not from this pass**: `DS:0x93`'s own tick
 * rate in Hz (it's driven by the sound driver's own reprogrammed timer,
 * not the 15Hz game-logic tick or the confirmed ~VGA-vsync-rate
 * `FUN_1000_1901` wait — its ISR was not traced), and the 8 story pages'
 * own individual hold lengths (`FUN_1000_07ae`'s wait target is register-
 * passed, not a static per-call literal, so it wasn't recovered by
 * decompilation alone). UNKNOWN_intro_page_timing narrows to just these
 * two residuals; UNKNOWN_intro_credits_timing is otherwise closed.
 *
 * PALETTE — LOGO now fixed, STORY still open. `FUN_1000_1635` is confirmed
 * as the DAC-install routine (16-entry table -> `INT 10h AX=1012h`), fed
 * from a table at `DS:0x73` that `FUN_1000_0db5`/`FUN_1000_0d9c` rotate
 * between card transitions (a genuine per-card colour-cycle/dissolve
 * effect, not a static palette) — but this pass could not pin down where
 * `DS:0x73`'s OWN source values come from (a direct memory read at the
 * address this file's first draft guessed, `DS:0x2`, turned out to be
 * unrelated ASCII filename data, not a palette — a wrong guess, corrected
 * here rather than left silently). **User-reported: the "GODS" wordmark
 * rendered solid red instead of gold on the logo card.** Root cause: this
 * port was presenting the logo card under `PSTBACK.PI1`'s OWN embedded
 * palette, whose index 2 is a pure-red entry the wordmark's own pixels
 * legitimately hit. Checked directly (not assumed): `PSTBACK.PI1` and
 * `PINTROFT.PI1` turn out to share ONE real palette — decoding `PSTBACK`'s
 * indices under `PINTROFT`'s embedded palette reproduces `PSTBACK`'s own
 * native stone-wall colors exactly. So the logo card now presents under
 * `PINTROFT`'s palette throughout (`Intro#palette()`), fixing both the
 * backdrop AND the wordmark at once — a real fix, not a tradeoff. The SAME
 * check against `PONE.PI1` (the story backdrop) came out wrong — garish
 * green/orange bands, not its own gradient — so `PONE.PI1` genuinely does
 * NOT share `PINTROFT`'s palette, and the story page's own gold-vs-salmon
 * text hue mismatch is still open. UNKNOWN_intro_glyph_palette narrows to
 * the STORY section only. Next
 * step is a live DAC port read (0x3C7/0x3C9) during an actual DOSBox
 * run, the technique already validated for UNKNOWN_level_palette_source,
 * not more static reading.
 */

import { SCREEN_W } from '../formats/pi1.js';
import { cutAll } from '../formats/atlas.js';

export const LOGO_FRAME_RANGE = [41, 48];   // the 7 "GODS" wordmark tiles, 32x46 each

/** Slice PINTROFT's three fonts + the logo tiles out of its decoded image. */
export function buildIntroAssets(fontImg, fontAtlas, logoBgImg, portraitImg) {
  const frames = cutAll(fontImg, fontAtlas);

  /* GOLD "credits" font — FUN_1000_0d2a, DS:0xbd=0: idx = ch - 0x41. */
  const creditsGlyphs = [];
  for (let c = 0; c < 26; c++) creditsGlyphs[0x41 + c] = frames[c];
  creditsGlyphs[0x2e] = frames[26];                       // '.'
  for (let d = 0; d < 10; d++) creditsGlyphs[0x30 + d] = frames[28 + d];

  /* WHITE "titles" font — FUN_1000_0d2a, DS:0xbd=0x30: idx = ch - 0x11. */
  const titleGlyphs = [];
  for (let c = 0; c < 26; c++) titleGlyphs[0x41 + c] = frames[48 + c];

  /* GOLD "story" font — FUN_1000_0d72: idx = ch + 9, no case-folding, no
   * bd offset. Covers the full printable range this port ever indexes
   * (space is skipped by the caller, never reaches here). */
  const storyGlyphs = [];
  for (let c = 0x20; c < 0x7f; c++) {
    const idx = c + 9;
    if (idx >= 0 && idx < frames.length) storyGlyphs[c] = frames[idx];
  }

  const logoTiles = frames.slice(LOGO_FRAME_RANGE[0], LOGO_FRAME_RANGE[1]);

  return {
    creditsGlyphs, titleGlyphs, storyGlyphs, logoTiles,
    logoBg: logoBgImg, portraitBg: portraitImg,
    /* PINTROFT's OWN embedded palette — used for the credits section, which
     * has no PI1 backdrop of its own to borrow one from (drawn on a
     * cleared/black frame). See this file's own PALETTE header note for
     * the open gap on the LOGO/STORY sections, which share a screen with a
     * backdrop and so can't both be pixel-correct under one embedded
     * palette. */
    fontPalette: fontImg.palette,
  };
}

function textWidth(text, advance) { return text.length * advance; }

/** Draw `text` with a glyph map indexed by real ASCII code (space = gap, no
 * blit — matches both real drawing routines' own byte loop: neither blits
 * anything for 0x20). */
export function drawIntroText(renderer, glyphMap, text, x, y, advance) {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== ' ') {
      const f = glyphMap[ch.charCodeAt(0)];
      if (f) renderer.blitSprite(f, cx, y);
    }
    cx += advance;
  }
}

export function drawIntroCentered(renderer, glyphMap, text, y, advance) {
  const x = ((SCREEN_W - textWidth(text, advance)) / 2) | 0;
  drawIntroText(renderer, glyphMap, text, x, y, advance);
}

/** The "GODS" wordmark — 7 tiles blitted side by side, centred. */
export function drawLogo(renderer, logoTiles, y) {
  const totalW = logoTiles.reduce((w, f) => w + f.w, 0);
  let x = ((SCREEN_W - totalW) / 2) | 0;
  for (const f of logoTiles) { renderer.blitSprite(f, x, y); x += f.w; }
}

const CREDITS_ADVANCE = 16;   // FUN_1000_0d2a: AX += 0x10, confirmed
const STORY_ADVANCE = 8;      // FUN_1000_0d72: AX += 8, confirmed

/* ── Step 1: the white-font opener ───────────────────────────────────────
 * FUN_1000_0ab3, one screen per entry, WHITE font. Weights are the real
 * relative DS:0x93 tick deltas (see this file's TIMING header) normalised
 * to RENEGADE=1; still no absolute Hz, so this port scales them onto its
 * own OPENER_BASE_HOLD rather than claiming a measured duration. */
export const OPENER_CARDS = ['RENEGADE', 'PRESENTS', 'A BITMAP BROTHERS', 'GAME'];
const OPENER_WEIGHTS = [87, 193, 180, 188].map((t) => t / 87);

/* ── Step 3: the gold-font production credits ────────────────────────────
 * FUN_1000_0143, confirmed line-for-line by FUN_1000_0d10's own call count
 * per group (1, 2, 2, 3, 2, 2, 2 lines respectively), THEN the wordmark
 * insert (no separate card here — see LOGO_INSERT_AFTER below), THEN
 * "INTO THE WONDERFUL" alone. */
export const CREDIT_CARDS = [
  ['PRODUCTION TEAM'],
  ['CODE', 'STEVE TALL'],
  ['GRAPHICS', 'MARK COLEMAN'],
  ['DESIGN', 'ERIC MATTHEWS', 'STEVE TALL'],
  ['MUSIC', 'NATION XII'],
  ['MUSIC CODE AND SFX', 'RICHARD JOSEPH'],
  ['ADDITIONAL CODE', 'MIKE MONTGOMERY'],
];
/** After this many CREDIT_CARDS, FUN_1000_0143 re-blits the "GODS" wordmark
 * alone (FUN_1000_0a1f) before continuing to "INTO THE WONDERFUL". */
export const LOGO_INSERT_AFTER = CREDIT_CARDS.length;
export const INTO_WONDERFUL_CARD = 'INTO THE WONDERFUL';   // GOLD font, not white
export const LOADING_CARD = 'LOADING GAME';                 // GOLD font, drawn in entry()'s own tail

/* ── Step 4: the 8-page story crawl ──────────────────────────────────────
 * Byte-exact off the string pool, split on the shipped 0xFF page markers.
 * "heroGs" is the source text's own literal encoding — see this file's
 * STORY FONT header note for why 'G' is correct as shipped, not a
 * placeholder for a missing apostrophe glyph. */
export const STORY_PAGES = [
  ['any man may', 'earn through', 'skill and courage', 'a single favour'],
  ['if he will face', 'the fear of the', 'ancient city'],
  ['and slay the four', 'great guardians', 'who have stolen', 'our citadel'],
  ['our hero stands', 'before the gods', 'and asks that'],
  ['if he fulfills', 'their quest', 'he will join them', 'as an equal'],
  ['only the hope', 'of the', 'heroGs failure', 'comforts them'],
  ['the warrior', 'departs for the', 'city of legends'],
  ['preparing to', 'carve one more', 'story on', 'its walls'],
];

const TICK_HZ = 15;
const T = (seconds) => Math.round(seconds * TICK_HZ);

/* Absolute pacing is still this port's own choice (see TIMING header) —
 * only the OPENER's own relative weights are real. */
const OPENER_BASE_HOLD = T(0.7);
const LOGO_FADE = T(0.5);
const LOGO_HOLD = T(1.6);
const CREDIT_FADE = T(0.35);
const CREDIT_HOLD = T(1.5);
const PAGE_FADE = T(0.5);
const PAGE_HOLD = T(2.2);

/** Tick-polled, same `step()`-per-frame shape as title-menu.js's widgets.
 * Nothing here reads `input` directly — INTROV.EXE's own "any key skips"
 * is real and confirmed (see this file's SKIP header), handled uniformly
 * by main.js's keydown listener, the same way it already handles skipping
 * attract-mode playback. Runs the sequence exactly ONCE (see the DOES NOT
 * LOOP header note) and reports completion via `done`; main.js transitions
 * to 'menu' when it sees that, same as a skip. */
export class Intro {
  constructor() {
    this.tick = 0;
    this.section = 'opener';   // 'opener' | 'logo' | 'credits' | 'story' | 'loading'
    this.cardIndex = 0;
    this.pageIndex = 0;
    this.done = false;
  }

  step() {
    if (this.done) return;
    this.tick++;
    if (this.section === 'opener') {
      const hold = OPENER_BASE_HOLD * OPENER_WEIGHTS[this.cardIndex];
      if (this.tick >= hold) {
        this.tick = 0;
        this.cardIndex++;
        if (this.cardIndex >= OPENER_CARDS.length) { this.section = 'logo'; this.cardIndex = 0; }
      }
      return;
    }
    if (this.section === 'logo') {
      if (this.tick >= LOGO_FADE * 2 + LOGO_HOLD) { this.tick = 0; this.section = 'credits'; this.cardIndex = 0; }
      return;
    }
    if (this.section === 'credits') {
      if (this.tick >= CREDIT_FADE * 2 + CREDIT_HOLD) {
        this.tick = 0;
        this.cardIndex++;
        const total = CREDIT_CARDS.length + 1;   // + INTO_WONDERFUL
        if (this.cardIndex >= total) { this.section = 'story'; this.pageIndex = 0; }
      }
      return;
    }
    if (this.section === 'story') {
      if (this.tick >= PAGE_FADE * 2 + PAGE_HOLD) {
        this.tick = 0;
        this.pageIndex++;
        if (this.pageIndex >= STORY_PAGES.length) { this.section = 'loading'; }
      }
      return;
    }
    // 'loading'
    if (this.tick >= CREDIT_FADE * 2 + CREDIT_HOLD) { this.done = true; }
  }

  fadeT() {
    if (this.section === 'opener') return 1;
    if (this.section === 'loading') return 1;
    const fadeIn = this.section === 'logo' ? LOGO_FADE : this.section === 'credits' ? CREDIT_FADE : PAGE_FADE;
    const hold = this.section === 'logo' ? LOGO_HOLD : this.section === 'credits' ? CREDIT_HOLD : PAGE_HOLD;
    if (this.tick < fadeIn) return this.tick / fadeIn;
    if (this.tick < fadeIn + hold) return 1;
    const fadeOutT = this.tick - fadeIn - hold;
    return Math.max(0, 1 - fadeOutT / fadeIn);
  }

  draw(renderer, assets) {
    renderer.clear(0);
    if (this.section === 'opener') {
      drawIntroCentered(renderer, assets.titleGlyphs, OPENER_CARDS[this.cardIndex], 92, CREDITS_ADVANCE);
      return;
    }
    if (this.section === 'logo') {
      if (assets.logoBg) renderer.blitBackground(assets.logoBg);
      drawLogo(renderer, assets.logoTiles, 70);
      return;
    }
    if (this.section === 'credits') {
      if (this.cardIndex < CREDIT_CARDS.length) {
        const lines = CREDIT_CARDS[this.cardIndex];
        const y0 = 92 - (lines.length - 1) * 9;
        lines.forEach((line, i) =>
          drawIntroCentered(renderer, assets.creditsGlyphs, line, y0 + i * 18, CREDITS_ADVANCE));
      } else if (this.cardIndex === LOGO_INSERT_AFTER) {
        /* The wordmark-only re-insert — no backdrop redraw in the real
         * sequence at this point, so this port keeps whatever was drawn
         * last (the credits section never blits a backdrop either). */
        drawLogo(renderer, assets.logoTiles, 70);
      } else {
        drawIntroCentered(renderer, assets.creditsGlyphs, INTO_WONDERFUL_CARD, 92, CREDITS_ADVANCE);
      }
      return;
    }
    if (this.section === 'story') {
      if (assets.portraitBg) renderer.blitBackground(assets.portraitBg);
      const lines = STORY_PAGES[this.pageIndex];
      const y0 = 20;
      lines.forEach((line, i) =>
        drawIntroCentered(renderer, assets.storyGlyphs, line, y0 + i * 16, STORY_ADVANCE));
      return;
    }
    // 'loading'
    drawIntroCentered(renderer, assets.creditsGlyphs, LOADING_CARD, 92, CREDITS_ADVANCE);
  }

  /** The palette to present with — see this file's own PALETTE header for
   * the open gap (still real for the STORY section only — see below). */
  palette(assets) {
    /* 'logo': PSTBACK.PI1 and PINTROFT.PI1 turn out to share ONE palette —
     * rendering PSTBACK's own indices under PINTROFT's embedded palette
     * reproduces PSTBACK's own native colors exactly (checked directly,
     * not assumed), so this is a real fix, not the same tradeoff STORY
     * still has: user-reported, the wordmark rendered solid RED under
     * PSTBACK's own palette (index 2 there is a pure-red entry the
     * wordmark's pixels legitimately hit) instead of gold. PONE.PI1 does
     * NOT share PINTROFT's palette (checked the same way — comes out as
     * wrong garish bands), so STORY is unaffected by this fix. */
    if (this.section === 'opener' || this.section === 'credits' ||
        this.section === 'loading' || this.section === 'logo') {
      return assets.fontPalette;
    }
    if (this.section === 'story' && assets.portraitBg) return assets.portraitBg.palette;
    return assets.logoBg ? assets.logoBg.palette : null;
  }
}
