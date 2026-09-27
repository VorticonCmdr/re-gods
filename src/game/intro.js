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
 * REAL SEQUENCE (entry() -> FUN_1000_0136, traced call-by-call). ⚠️ ORDER
 * CORRECTED: 0136 calls 0ab3, 0870, 057c, 0143 — so step 4 (story) runs
 * BEFORE step 3 (credits); the numbering below is kept from the first
 * draft, the playback order is 1, 2, 4, 3, 5 (see INTRO_TIMELINE):
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
 * TIMING and PALETTE — both CLOSED; see INTRO_TIMELINE and palette() below
 * for the full citations (UNKNOWN_intro_page_timing: DS:0x93 is a 50 Hz
 * PIT-driven counter and story pages hold a fixed 0x180 ticks;
 * UNKNOWN_intro_glyph_palette: DS:0x73 is a working palette faded toward
 * static DS tables or PONE.PI1's own embedded palette).
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
 * FUN_1000_0ab3, one screen per entry, WHITE font. Timing: INTRO_TIMELINE. */
export const OPENER_CARDS = ['RENEGADE', 'PRESENTS', 'A BITMAP BROTHERS', 'GAME'];

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

/* ── The real timeline ─────────────────────────────────────────────────
 * `UNKNOWN_intro_page_timing` — CLOSED. Every wait in INTROV.EXE compares the
 * word counter DS:0x93 against an absolute threshold. That counter is bumped
 * once per timer interrupt by `0x14F4`, called from the INT 8 handler at
 * `0x15D1`, which `0x1321` installs after `0x15B8` reprograms PIT channel 0
 * with divisor 0x5D38 = 23864 -> 1193182/23864 = 49.999 Hz. So the counter is
 * a 50 Hz clock, and it is also the sound driver's tick (`0x14F4` calls
 * PPLAYER.BIN AH=2 right after the increment), which is why every step below
 * lands on the music's own bar lines (96 ticks = one 4/4 bar of PGODMUS2 at
 * 480000 us/quarter). Live-confirmed in DOSBox: counter-vs-BIOS-tick rate
 * 50.05 Hz, story page 1 entered at exactly the threshold 1641, page 2 at
 * 2025 = 1641 + 0x180.
 *
 * Each wait carries THREE thresholds, picked by the sound-driver id
 * DS:0x195 (`== 2`, `< 2`, `> 2`). GODS.INI's shipped "Sound Blaster" sets
 * id 4 (read live), so this port uses the `> 2` column throughout. The
 * sequence origin is counter 7 (`CS:0x005A`/`0x0060`).
 *
 * Story pages: `FUN_1000_07ae` takes DI = the page's text, NOT a hold length
 * (the earlier "register-passed wait target" reading was wrong). It snapshots
 * the counter on entry and waits for `start + 0x180` = 384 ticks = 7.68 s
 * (0x110 under driver id 3). The LAST page of each batch then stays up until
 * the next absolute threshold — 19 s and 28 s respectively — live-confirmed
 * with page 3 still on screen at counter 3149.
 *
 * ORDER, corrected: `CS:0x0136` calls 0ab3 (opener) -> 0870 (logo) -> 057c
 * (STORY) -> 0143 (CREDITS). The story comes BEFORE the production credits;
 * this file's first two drafts had them the other way round. Live-confirmed:
 * the credits routine is entered at counter 6434, after the story's last
 * threshold (6400).
 *
 * Fades are the real 8-/7-step palette ramps (`0xDCC`/`0xE51`, AX retrace
 * waits per step), about 0.34 s at AX=3; modelled here as linear ramps of
 * that length. The logo and credits palette-cycle effects between the
 * static tables at DS:0xF3/0x113/0x133/0x173 are not modelled.
 */
export const INTRO_HZ = 50;
const FADE = 17;      // 8 steps x 3 retraces at 70 Hz ~ 0.34 s ~ 17 ticks
const PAGE_HOLD = 0x180;

/* Each shot: [inTick, outTick, section, index]. `in` = the palette fade-in
 * (or page flip) threshold, `out` = the fade-out threshold. */
export const INTRO_TIMELINE = [
  [7, 90, 'opener', 0], [194, 288, 'opener', 1], [384, 472, 'opener', 2], [577, 665, 'opener', 3],
  [768, 1256, 'logo', 0],
  [1342, 1641, 'story', -1],                        // the portrait alone, faded in
  [1641, 1641 + PAGE_HOLD, 'story', 0],
  [1641 + PAGE_HOLD, 1641 + 2 * PAGE_HOLD, 'story', 1],
  [1641 + 2 * PAGE_HOLD, 3368, 'story', 2],          // last of batch 1: held to 3368
  [3427, 3442, 'story', -1],
  [3442, 3442 + PAGE_HOLD, 'story', 3],              // ~15 ticks after 3427 for the fade (estimate)
  [3442 + PAGE_HOLD, 3442 + 2 * PAGE_HOLD, 'story', 4],
  [3442 + 2 * PAGE_HOLD, 3442 + 3 * PAGE_HOLD, 'story', 5],
  [3442 + 3 * PAGE_HOLD, 3442 + 4 * PAGE_HOLD, 'story', 6],
  [3442 + 4 * PAGE_HOLD, 6400, 'story', 7],          // held to 6400
  [6534, 6634, 'credits', 0], [6634, 6729, 'credits', 1], [6729, 6824, 'credits', 2],
  [6824, 6919, 'credits', 3], [6919, 7014, 'credits', 4], [7014, 7109, 'credits', 5],
  [7109, 7204, 'credits', 6], [7204, 7497, 'credits', LOGO_INSERT_AFTER],
  [7497, 7775, 'credits', LOGO_INSERT_AFTER + 1],    // 7632 + 200 retraces (CS:0x00A5)
  [7861, 7900, 'loading', 0],                        // after the fade-outs + 50 retraces
];
export const INTRO_END_TICK = 7900;

/** Tick-polled at the game's 15 Hz, but keeps time in INTROV's own 50 Hz
 * counter units so every threshold above is used verbatim. Nothing here
 * reads `input` directly — any key skips (see the SKIP header), handled by
 * main.js's keydown listener. Runs once (see DOES NOT LOOP). */
export class Intro {
  constructor() {
    this.t = 7;
    this.done = false;
    this.#sync();
  }

  #sync() {
    const shot = INTRO_TIMELINE.find(([a, b]) => this.t >= a && this.t < b)
      || INTRO_TIMELINE.findLast(([a]) => this.t >= a);
    this.shot = shot;
    this.section = shot[2];
    this.cardIndex = shot[2] === 'story' ? 0 : shot[3];
    this.pageIndex = shot[2] === 'story' ? shot[3] : 0;
  }

  step(ticks = INTRO_HZ / 15) {
    if (this.done) return;
    this.t += ticks;
    if (this.t >= INTRO_END_TICK) { this.done = true; return; }
    this.#sync();
  }

  /** 0..1 brightness from the fade ramps at the shot's own in/out ticks.
   * Consecutive story pages and credit cards share one faded-in screen, so
   * only the section's first/last shot actually ramps. */
  fadeT() {
    const [a, b, sec, idx] = this.shot;
    if (this.t >= b) return 0;
    const i = INTRO_TIMELINE.indexOf(this.shot);
    const prev = INTRO_TIMELINE[i - 1], next = INTRO_TIMELINE[i + 1];
    const contIn = prev && prev[2] === sec && prev[1] === a && sec !== 'opener';
    const contOut = next && next[2] === sec && next[0] === b && sec !== 'opener';
    let v = 1;
    if (!contIn) v = Math.min(v, (this.t - a) / FADE);
    if (!contOut) v = Math.min(v, (b - this.t) / FADE);
    return Math.max(0, Math.min(1, v));
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
        drawLogo(renderer, assets.logoTiles, 70);
      } else {
        drawIntroCentered(renderer, assets.creditsGlyphs, INTO_WONDERFUL_CARD, 92, CREDITS_ADVANCE);
      }
      return;
    }
    if (this.section === 'story') {
      if (assets.portraitBg) renderer.blitBackground(assets.portraitBg);
      if (this.pageIndex < 0) return;
      const lines = STORY_PAGES[this.pageIndex];
      const y0 = 20;
      lines.forEach((line, i) =>
        drawIntroCentered(renderer, assets.storyGlyphs, line, y0 + i * 16, STORY_ADVANCE));
      return;
    }
    // 'loading'
    drawIntroCentered(renderer, assets.creditsGlyphs, LOADING_CARD, 92, CREDITS_ADVANCE);
  }

  /** `UNKNOWN_intro_glyph_palette` — CLOSED. DS:0x73 is a WORKING palette,
   * zeroed at entry (`CS:0x003B`) and stepped by the fade routines toward a
   * target table: the static tables at DS:0xD3/0xF3/0x113/0x133/0x153/0x173,
   * or DS:0x393, which `CS:0x05CD` fills by byte-swapping the 16 words at
   * `1b51:0002` — the embedded ST palette of PONE.PI1 (loaded there by
   * `CS:0x0F3F`, filename DS:0x3EB "one.pi1"). Live-confirmed: DS:0x393 read
   * back word-for-word equal to PONE.PI1's header. So the story pages, text
   * included, really are shown under PONE's own palette; the salmon-ish
   * story text is the original's look, not a port error.
   * 'logo': PSTBACK.PI1 and PINTROFT.PI1 share one palette (checked
   * directly), and the wordmark rendered red under PSTBACK's own index 2, so
   * the logo card presents under PINTROFT's palette. */
  palette(assets) {
    if (this.section === 'story' && assets.portraitBg) return assets.portraitBg.palette;
    return assets.fontPalette;
  }
}
