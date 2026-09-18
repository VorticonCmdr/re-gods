/* intro.js — INTROV.EXE's pre-game sequence: the credits reveal, the "GODS"
 * logo card, and the 8-page story crawl that precedes GAME.EXE's own title
 * menu (title-menu.js). Ported because the port previously had no intro at
 * all — main.js booted straight into 'menu'.
 *
 * ASSETS (all confirmed live in DOSBox — `gods` launches GODS.EXE, which
 * EXECs INTROV.EXE before GAME.EXE, per Gods/docs/dynamic-trace-and-runtime-
 * data.md — and by direct decode against this port's own pi1.js/atlas.js):
 *
 *   PSTBACK.PI1  — the logo card's stone-wall/helmet backdrop. Despite the
 *                  name overlap with the status panel, this is a DIFFERENT
 *                  file, owned by INTROV.EXE, not GAME.EXE (Gods/docs/
 *                  drivers-and-memory.md already disclosed the name clash).
 *   PONE.PI1     — the hero-portrait backdrop behind the story crawl.
 *   PINTROFT.PI1 — a 320x200 atlas image holding THREE distinct fonts plus
 *                  the "GODS" wordmark, self-labelled in the shipped art
 *                  ("^CREDITS FNT" / "^TITLES FONT" / "^FONT FOR STORY").
 *   PINTROFT.DAT — its descriptor table, same 2+10*count schema as every
 *                  other P*.DAT (formats/atlas.js) — parses cleanly at 132
 *                  records, confirming this file is no exception.
 *
 * Both backgrounds decompress to the standard 32034-byte ST DEGAS frame and
 * render through the port's EXISTING pi1.js decoder unchanged — verified by
 * rendering them to PNG and eyeballing the result (the wall/helmet and the
 * horned hero portrait respectively), not merely assumed from the doc's
 * "standard DEGAS frame" note.
 *
 * GLYPH LAYOUT — read straight off the decoded atlas, pixel-verified against
 * a labelled per-record render (`node tools/render-node.mjs` has no intro
 * mode; this was a one-off script, not checked in — the record ranges below
 * are the artifact that survives):
 *   0-25    'A'-'Z' (credits font, 16x16, gold)
 *   26      '.'
 *   27      unidentified punctuation (looks like a raised double-dot; never
 *           needed by any credits/poem string actually used here, so left
 *           unmapped rather than guessed at)
 *   28-37   '0'-'9'
 *   38-39   left-arrow / circular icon (unused by this sequence)
 *   41-47   the "GODS" wordmark, seven 32x46 tiles meant to be blitted
 *           side by side as one 224px-wide logo, not indexed as text
 *   48-73   'A'-'Z' (titles font, 16x14, white)
 *   74-131  '!' (0x21) through 'Z' (0x5A) in strict ASCII order, 58 records
 *           (story font, gold, variable height ~4-14px) — NO lowercase
 *           glyphs exist despite the shipped poem text being lowercase, so
 *           this port upper-folds before indexing; that fold is inferred
 *           from the glyph range, not read out of INTROV.EXE's own
 *           dispatch code (disassembling the real per-character blit was
 *           out of scope for this pass).
 *
 * STRING POOL — read byte-exact off `analysis/unpacked/INTROV.unpacked.exe`
 * (Gods/docs/execution-and-boot.md's own citation, `introv 0x2a3e-0x2cd5`),
 * NOT retyped from that doc's prose summary (this project has been burned
 * twice by exactly that: the password generator's SI formula and the
 * PGODFONT digit range were both transcription errors that survived a
 * prior pass's review). The eight story pages below are separated in the
 * shipped bytes by a literal 0xFF marker; PAGES mirrors that grouping
 * exactly, unedited.
 *
 * PALETTE — disclosed, unresolved gap: PSTBACK.PI1/PONE.PI1 (the backdrops)
 * and PINTROFT.PI1 (the font/logo atlas) each carry their OWN embedded
 * palette, and a check of which index values each file actually uses found
 * real overlap between them (PONE alone already uses all 16 indices) — so
 * there is no clean "merge the two palettes" fix, and which single DAC
 * install the real INTROV.EXE uses when text and a backdrop share a screen
 * was not traced. This port presents the LOGO/STORY sections under the
 * BACKDROP's own palette (so the backdrop itself — most of the frame — is
 * pixel-correct) and accepts that the gold text renders a different hue
 * (salmon/pink over the story portrait, live-checked) as a result. The
 * CREDITS section has no competing backdrop (drawn on a cleared frame), so
 * it presents under PINTROFT's own palette and the gold IS correct there —
 * live-checked. UNKNOWN_intro_glyph_palette is the open follow-up (needs a
 * live DAC readout during the real INTROV.EXE's own story-page display,
 * the same technique already used for UNKNOWN_level_palette_source).
 *
 * SEQUENCING — confirmed live: any key at any point during the intro jumps
 * straight to GAME.EXE's own title menu (tested with Enter from mid-poem;
 * main.js's keydown handler owns this, not this module). Left un-skipped,
 * the logo card and the 8 story pages cycle in a loop (a live DOSBox run
 * was left running past the last story page and it faded straight back to
 * the logo card) — this port stops the CREDITS reveal from ever repeating
 * on that loop (see CREDIT_CARDS below) since nothing in this pass's live
 * capture actually confirms whether the real INTROV.EXE replays credits on
 * every lap or only once; disclosed as a port-only choice, not a citation.
 * Per-page hold/fade timing was NOT captured to the tick and is NOT from
 * disassembly — the constants below are this port's own reasonable
 * approximation of what was seen live, flagged here rather than presented
 * as measured. UNKNOWN_intro_credits_timing and UNKNOWN_intro_page_timing
 * are open follow-ups for a session with DOSBox execute-breakpoint budget
 * to spend on INTROV.EXE specifically (Ghidra has no program loaded for it
 * yet — GAME.EXE/VGA.EXE only).
 */

import { SCREEN_W } from '../formats/pi1.js';
import { cutAll } from '../formats/atlas.js';

export const LOGO_FRAME_RANGE = [41, 48];   // the 7 "GODS" wordmark tiles, 32x46 each

/** Slice PINTROFT's three fonts + the logo tiles out of its decoded image. */
export function buildIntroAssets(fontImg, fontAtlas, logoBgImg, portraitImg) {
  const frames = cutAll(fontImg, fontAtlas);

  const creditsGlyphs = [];
  for (let c = 0; c < 26; c++) creditsGlyphs[0x41 + c] = frames[c];
  creditsGlyphs[0x2e] = frames[26];                       // '.'
  for (let d = 0; d < 10; d++) creditsGlyphs[0x30 + d] = frames[28 + d];

  const titleGlyphs = [];
  for (let c = 0; c < 26; c++) titleGlyphs[0x41 + c] = frames[48 + c];

  /* '!' (0x21) .. 'Z' (0x5A), strict ASCII order — see this file's header. */
  const storyGlyphs = [];
  for (let c = 0x21; c <= 0x5a; c++) storyGlyphs[c] = frames[74 + (c - 0x21)];

  const logoTiles = frames.slice(LOGO_FRAME_RANGE[0], LOGO_FRAME_RANGE[1]);

  return {
    creditsGlyphs, titleGlyphs, storyGlyphs, logoTiles,
    logoBg: logoBgImg, portraitBg: portraitImg,
    /* PINTROFT's OWN embedded palette — used for the credits section, which
     * has no PI1 backdrop of its own to borrow one from (drawn on a
     * cleared/black frame). Matches this project's own established
     * "a sprite SHEET's pixel indices are only meaningful under ITS OWN
     * palette unless something else is actively sharing the DAC" pattern
     * (see e.g. PBITS/PLEVEL — a live check confirmed BITS sheets carry no
     * usable palette of their own; here PINTROFT's DOES decode to a
     * correct-looking gold font standalone, so it's used directly rather
     * than assumed absent). */
    fontPalette: fontImg.palette,
  };
}

function textWidth(text, advance) { return text.length * advance; }

/** Draw `text` with a glyph map indexed by real ASCII code (space = gap, no
 * blit — matches title-menu.js's drawText convention for the same reason:
 * CS:0x224E's own byte loop never blits a space glyph). */
export function drawIntroText(renderer, glyphMap, text, x, y, advance, foldUpper = false) {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== ' ') {
      const code = foldUpper ? ch.toUpperCase().charCodeAt(0) : ch.charCodeAt(0);
      const f = glyphMap[code];
      if (f) renderer.blitSprite(f, cx, y);
    }
    cx += advance;
  }
}

export function drawIntroCentered(renderer, glyphMap, text, y, advance, foldUpper = false) {
  const x = ((SCREEN_W - textWidth(text, advance)) / 2) | 0;
  drawIntroText(renderer, glyphMap, text, x, y, advance, foldUpper);
}

/** The "GODS" wordmark — 7 tiles blitted side by side, centred. */
export function drawLogo(renderer, logoTiles, y) {
  const totalW = logoTiles.reduce((w, f) => w + f.w, 0);
  let x = ((SCREEN_W - totalW) / 2) | 0;
  for (const f of logoTiles) { renderer.blitSprite(f, x, y); x += f.w; }
}

/* ── The credits reveal ──────────────────────────────────────────────────
 * String-pool order, unedited (introv 0x2a3e). One "card" per array entry;
 * multi-line cards (the production-team credits) are joined with the SAME
 * pairing the bytes themselves show (role, name[, name]). */
export const CREDIT_CARDS = [
  ['RENEGADE'],
  ['PRESENTS'],
  ['A BITMAP BROTHERS'],
  ['GAME'],
  ['PRODUCTION TEAM'],
  ['CODE', 'STEVE TALL'],
  ['GRAPHICS', 'MARK COLEMAN'],
  ['DESIGN', 'ERIC MATTHEWS', 'STEVE TALL'],
  ['MUSIC', 'NATION XII'],
  ['MUSIC CODE AND SFX', 'RICHARD JOSEPH'],
  ['ADDITIONAL CODE', 'MIKE MONTGOMERY'],
];

/* "INTO THE WONDERFUL" has no paired second line in the string pool (the
 * very next string is "LOADING GAME", a separate card by every other
 * card's own one-or-two-line shape) — shown here as its own single-line
 * card rather than silently dropped or spliced onto a neighbour. */
export const INTO_WONDERFUL_CARD = 'INTO THE WONDERFUL';
export const LOADING_CARD = 'LOADING GAME';

/* ── The 8-page story crawl ──────────────────────────────────────────────
 * Byte-exact off the string pool, split on the shipped 0xFF page markers.
 * "heroGs" is the source text's own apostrophe encoding (this font has no
 * apostrophe glyph in the traced range — see storyGlyphs above) — rendered
 * literally as "hero's" would need a glyph this atlas doesn't provide, so
 * it's left as the shipped "heroGs" would draw: 'G' has a real glyph, and
 * this port doesn't invent a substitute apostrophe glyph that was never
 * confirmed to exist. */
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

/* Disclosed-approximate timing — see this file's header. */
const CREDIT_HOLD = T(1.1);
const LOGO_FADE = T(0.5);
const LOGO_HOLD = T(1.6);
const PAGE_FADE = T(0.5);
const PAGE_HOLD = T(2.2);

const STORY_ADVANCE = 8;
const CREDITS_ADVANCE = 10;
const TITLE_ADVANCE = 10;

/** Tick-polled, same `step(input)`-per-frame shape as title-menu.js's
 * widgets (see that file's own header for why: a shared `input`-driven
 * poll is what lets an attract-mode recording drive a widget identically
 * to a real key). Unlike those widgets, nothing here ever reads `input`
 * directly — INTROV.EXE's own "any key skips" is handled by main.js's
 * keydown listener, uniformly, the same way it already handles skipping
 * attract-mode playback; this class just advances its own clock. */
export class Intro {
  constructor() {
    this.tick = 0;
    this.section = 'credits';   // 'credits' | 'logo' | 'story'
    this.cardIndex = 0;
    this.pageIndex = 0;
  }

  /** @returns {boolean} true once per section-advance tick (no consumer
   * currently needs the edge; kept for symmetry with the other widgets). */
  step() {
    this.tick++;
    if (this.section === 'credits') {
      if (this.tick >= CREDIT_HOLD) {
        this.tick = 0;
        this.cardIndex++;
        const total = CREDIT_CARDS.length + 2;   // + INTO_WONDERFUL + LOADING
        if (this.cardIndex >= total) { this.section = 'logo'; this.cardIndex = 0; }
      }
      return true;
    }
    if (this.section === 'logo') {
      if (this.tick >= LOGO_FADE * 2 + LOGO_HOLD) { this.tick = 0; this.section = 'story'; this.pageIndex = 0; }
      return true;
    }
    // 'story'
    if (this.tick >= PAGE_FADE * 2 + PAGE_HOLD) {
      this.tick = 0;
      this.pageIndex++;
      /* Loop back to the logo, not the credits — see this file's header
       * for why credits are disclosed as NOT replaying on this loop. */
      if (this.pageIndex >= STORY_PAGES.length) { this.section = 'logo'; this.pageIndex = 0; }
    }
    return true;
  }

  /** 0..1 brightness multiplier for renderer.present()'s own `fadeT`,
   * matching the mechanism quitFade/gameOverFade already use in main.js. */
  fadeT() {
    if (this.section === 'credits') return 1;
    const fadeIn = this.section === 'logo' ? LOGO_FADE : PAGE_FADE;
    const hold = this.section === 'logo' ? LOGO_HOLD : PAGE_HOLD;
    if (this.tick < fadeIn) return this.tick / fadeIn;
    if (this.tick < fadeIn + hold) return 1;
    const fadeOutT = this.tick - fadeIn - hold;
    return Math.max(0, 1 - fadeOutT / fadeIn);
  }

  draw(renderer, assets) {
    renderer.clear(0);
    if (this.section === 'credits') {
      const total = CREDIT_CARDS.length + 2;
      if (this.cardIndex < CREDIT_CARDS.length) {
        const lines = CREDIT_CARDS[this.cardIndex];
        const y0 = 92 - (lines.length - 1) * 9;
        lines.forEach((line, i) =>
          drawIntroCentered(renderer, assets.creditsGlyphs, line, y0 + i * 18, CREDITS_ADVANCE));
      } else if (this.cardIndex === CREDIT_CARDS.length) {
        drawIntroCentered(renderer, assets.titleGlyphs, INTO_WONDERFUL_CARD, 92, TITLE_ADVANCE);
      } else {
        drawIntroCentered(renderer, assets.titleGlyphs, LOADING_CARD, 92, TITLE_ADVANCE);
      }
      return;
    }
    if (this.section === 'logo') {
      if (assets.logoBg) renderer.blitBackground(assets.logoBg);
      drawLogo(renderer, assets.logoTiles, 70);
      return;
    }
    // 'story'
    if (assets.portraitBg) renderer.blitBackground(assets.portraitBg);
    const lines = STORY_PAGES[this.pageIndex];
    const y0 = 20;
    lines.forEach((line, i) =>
      drawIntroCentered(renderer, assets.storyGlyphs, line, y0 + i * 16, STORY_ADVANCE, true));
  }

  /** The palette to present with — the logo/story sections each have their
   * OWN backdrop's own palette; the credits section has no backdrop at all
   * (drawn on a cleared/black frame, so any palette does, but the caller
   * still needs one to hand `renderer.present()` — the logo backdrop's is
   * as good a default as any). */
  palette(assets) {
    if (this.section === 'credits') return assets.fontPalette;
    if (this.section === 'story' && assets.portraitBg) return assets.portraitBg.palette;
    return assets.logoBg ? assets.logoBg.palette : null;
  }
}
