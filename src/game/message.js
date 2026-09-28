/* message.js — the status-panel message line: the one place the game ever
 * shows words to the player during a level.
 *
 * PROVENANCE
 *   This whole subsystem was missing from the port. Worse, it was recorded as
 *   present: `consumables.js`'s own `NOT_WIRED_REASON.hint` read "already
 *   ported as the PALFILS hint system", which was false — the *hint table* had
 *   been decoded (docs/asset-formats.md), but nothing ever rendered it. Picking
 *   up a tablet produced a sidebar debug line and nothing on screen.
 *
 *   Everything below is disassembled directly (Ghidra `disassemble_bytes`, not
 *   decompiled) and then re-confirmed BY RECONSTRUCTION: rendering the shipped
 *   PLEV1A tablet message through this module's own layout reproduces the two
 *   pages a DOSBox capture of the real game shows, glyph for glyph — page 1
 *   `<> HINT <> FIND THE GOLD KEY>`, page 2 `TO EXIT THIS WORLD <>`.
 *
 * ── THE ENGINE IS A PRIORITY MAILBOX, NOT A QUEUE ────────────────────────
 *   `CS:0x434e` is the single submit entry. It takes a priority in DL and
 *   arbitrates against a BARRIER byte at `DS:0x394`; there is exactly one
 *   message slot and a higher-or-equal priority preempts whatever is showing.
 *
 *     434e  cmp dl,[0x394] / jc 0x4370       ; below the barrier -> reject
 *     4354  cmp byte [0x393],0 / jz 0x4373   ; nothing showing -> accept
 *     435b  ...prefix compare...             ; see PREFIX REJECT below
 *     4373  [0x3b9]=[0x3ba]=0xff             ; both panel pages dirty
 *     437e  call 0x4602                      ; erase the strip (export 23)
 *     4382  [0x394]=dl                       ; barrier := this priority
 *     4389  [0x260]=[0x212]                  ; latch the string
 *     4392  [0x393]=1                        ; active
 *     43a3  call 0x43b6                      ; lay out + draw page 1 NOW
 *
 *   ⚠️ PREFIX REJECT, `CS:0x435b-0x436e`, and it is ASYMMETRIC — the obvious
 *   reading ("reject an identical message") is wrong in one direction and a
 *   port that implements a symmetric equality test is wrong with it. `lodsb`
 *   reads the NEW string; `jz 0x4370` fires when the NEW string reaches its
 *   NUL with every byte so far matching. So the reject condition is "the new
 *   string is a PREFIX of the displayed one", equality being the special case:
 *   new `"ABC"` against displayed `"ABCDEF"` REJECTS, while new `"ABCDEF"`
 *   against displayed `"ABC"` ACCEPTS (displayed's NUL mismatches `'D'`).
 *
 *   THE BARRIER IS SHORT-LIVED BY DESIGN. `CS:0x4485` zeroes `DS:0x394` again
 *   on the first real draw — which happens inside the same submit call. So the
 *   priority only arbitrates between messages posted in the same frame, unless
 *   a caller holds it up deliberately (the shop does exactly that across a
 *   purchase, `CS:0x7024-0x7031`).
 *
 *   THE PRIORITY LADDER, all eight submit sites (`search_instructions` on
 *   `call 434e`: 0x0cda, 0x0d97, 0x4714, 0x4814, 0x6467, 0x6f74, 0x7079,
 *   0xcc5f). ⚠️ The compare and the latch are both 8-BIT (`cmp dl,[0x394]` /
 *   `mov [0x394],dl`), so `CS:0xcc5c`'s `mov dx,0x7fff` submits 0xFF, not
 *   32767 — a port storing a 16-bit priority mis-ranks that channel.
 *
 * ── IT IS PAGINATED, NOT SCROLLED ────────────────────────────────────────
 *   The line is 28 characters wide and a longer message is shown as TWO TIMED
 *   PAGES, split at a word boundary. There is no marquee anywhere: `DS:0x262`
 *   is written only as 0 / 0xFFFF / 0x140 and read only by a sign test, and
 *   nothing in the chain advances an X by a per-tick delta.
 *
 *   ⚠️ WRAPPING IS THE NORMAL PATH FOR HINTS, NOT AN EDGE CASE. Measured over
 *   the shipped data: of the 45 live hint strings, only 5 produce a message
 *   that fits in 28 characters. 40 of 45 wrap. A port that renders one centred
 *   line is wrong for 89% of the hints in the game.
 *
 * ── LIFETIME: 30 TICKS, THEN 60 IF THERE IS A SECOND PAGE ────────────────
 *   `CS:0x43e2` seeds `DS:0x264 = 0x1e` (30) and `CS:0x43cb` seeds
 *   `DS:0x262 = 0xFFFF` UNCONDITIONALLY; the wrap path then overwrites it with
 *   0x140 at `CS:0x43ee`. The updater `CS:0x4573` does `dec [0x264] / jns`,
 *   and on underflow `cmp [0x262],0 / js 0x45f4` tears down only when 0x262 is
 *   NEGATIVE. So a single-page message lives 31 decrements and dies; a
 *   two-page one flips at 31 and lives 61 more.
 *
 *   ⚠️ Both of this pass's verifier agents were checked against the bytes here
 *   because they disagreed: one read the lifetime as always two-phase (30 then
 *   60 for every message). That reading misses `CS:0x43cb`, which runs
 *   unconditionally after the copy loop — re-disassembled this session, bytes
 *   `c7066202ffff`. Single-page messages get 30 ticks only.
 *
 * ── GEOMETRY ─────────────────────────────────────────────────────────────
 *     x0        0x18 = 24        CS:0x4443
 *     y         0x1d = 29 PANEL-LOCAL -> absolute screen row 189
 *     advance   0xa  = 10 px, FIXED — nothing reads a per-glyph width
 *     width     0x1c = 28 chars -> x 24..304
 *   Glyph cells are 9 rows tall, so the text occupies absolute rows 189-197 —
 *   inside the 160-199 status band, never the playfield. That matches the flat
 *   trough in the shipped PSTAT3 art, which is exactly rows 189-197.
 *
 *   The `+4` arm at `CS:0x4452-0x4455` (and its `DS:0xad4c` panel page) is
 *   NOT modelled, correctly. DS:0x33 is the display's fine-scroll phase:
 *   graphics export 0 sets it every frame, `VGA:0x10F5-0x10FB` `mov ax,[0xa] /
 *   and ax,0x1c / mov [0x33],al` (GAME.EXE only ever zeroes or restores it,
 *   which is why a GAME.EXE-only scan found no setter). A nonzero phase picks
 *   the pre-shifted panel copy 0xad4c, and bit 2 adds the 4 px that copy needs,
 *   so the panel stays put on screen. [PROVEN] live: with camera x poked to
 *   0x1C0 / 0x1C4 / 0x1C8 ([0x33] read back 0 / 4 / 8) and at 0x1DC (28), the
 *   status band's pixels matched at shift 0 in every case (the only
 *   differences were the health bar's shimmer). This port draws one unshifted
 *   panel, which is what the screen shows. `UNKNOWN_ds33_bit2_setter` CLOSED.
 *
 * ── THE FONT: PSMLFNT, AND THE MAPPING IS THE IDENTITY ───────────────────
 *     44e3  lodsb / sub ah,ah / add ax,[0x27e] / mov [0x8],ax / call 0x356e
 *     44f4  add word [0x4],0xa / loop
 *   `sprite = zero_extend(byte) + DS:0x27e`. There is NO `sub al,0x20`, no
 *   translation table, no range fold and NO CASE FOLD anywhere in the path —
 *   `DS:0x27e` has exactly three references program-wide (two writers, this
 *   one reader). The atlas is indexed directly by ASCII code.
 *
 *   ⚠️ SO DO NOT UPPERCASE THE STRING. The shipped hint text is lowercase and
 *   renders uppercase because PSMLFNT's slots 0x61-0x7A hold artwork
 *   PIXEL-IDENTICAL to 0x41-0x5A (checked here: 26/26 identical). Adding a
 *   `toUpperCase()` would look right for letters and silently break 0x11,
 *   0x20 and 0x26, which are ordinary printable glyphs in this font, not
 *   control codes: 0x11 is the solid diamond separator, 0x20 the only all-zero
 *   cell, 0x26 the right-arrow "continued" wedge.
 */

/* ── Geometry, CS:0x4443/0x4459/0x44f4/0x43d5 ─────────────────────────── */
export const LINE_CHARS = 0x1c;        // 28 — CS:0x43d5, CS:0x45e8
export const ORIGIN_X   = 0x18;        // 24 — CS:0x4443
export const Y_LOCAL    = 0x1d;        // 29 — CS:0x4459, panel-local
export const ADVANCE    = 0x0a;        // 10 — CS:0x44f4

/* ── Timing, CS:0x43e2/0x4586 — ticks of the 15 Hz logic clock ────────── */
export const PAGE1_TICKS = 0x1e;       // 30
export const PAGE2_TICKS = 0x3c;       // 60

/* ── The three glyph bytes the composers emit as punctuation ──────────── */
export const DIAMOND = 0x11;           // the solid separator
export const SPACE   = 0x20;
export const WEDGE   = 0x26;           // the page-break "continued" arrow

/** The eight submit priorities, `search_instructions(call 434e)`. */
export const PRIORITY = Object.freeze({
  object:    0x19,   // 25  — CS:0x4711, the object-message composer
  shopFull:  0x19,   // 25  — CS:0x6f6d "inventory full"
  shopSwap:  0x19,   // 25  — CS:0x7071 "this weapon replaces the ..."
  shopItem:  0x1e,   // 30  — CS:0x4811, the shop's own item composer
  bonusGem:  0x31,   // 49  — CS:0x0d94
  extraLife: 0x32,   // 50  — CS:0x0cd8
  hint:      0x64,   // 100 — CS:0x6464, the hint tablet
  endgame:   0xff,   // CS:0xcc5c `mov dx,0x7fff`, truncated to DL
});

/** CS:0x1fc6's "no text" sentinel, tested at CS:0x4679 as a SIGNED `jge`. */
export const NO_TEXT = 0xffff;

/**
 * `CS:0x44a8` — "is there a lowercase letter or a digit at or after `i`?"
 * Returns the routine's CF inverted: true == found (the `clc` arm).
 *
 * ⚠️ UPPERCASE DOES NOT COUNT, and that is not a transcription slip — the
 * routine tests `0x61..0x7a` then `0x30..0x39` and loops on anything else, so
 * `'A'` falls through both windows. Shipped text is lowercase so it rarely
 * matters, but the composed hint's literal `"Hint"` is capitalised and a port
 * that widened this to A-Z would place the page break differently.
 */
export function printableFollows(work, i) {
  for (let k = i; k < work.length; k++) {
    const c = work[k];
    if (c === 0) return false;                       // CS:0x44ab `jz` -> stc
    if (c >= 0x61 && c <= 0x7a) return true;         // CS:0x44ad/0x44b1
    if (c >= 0x30 && c <= 0x39) return true;         // CS:0x44b5/0x44b9
  }
  return false;
}

/**
 * The message engine: `CS:0x434e` (submit), `CS:0x43b6` (layout/paginate),
 * `CS:0x443e`+`CS:0x44c3` (draw) and `CS:0x4569` (per-tick update).
 *
 * The original's two dirty-page flags (`DS:0x3b9`/`DS:0x3ba`) and its erase
 * export are deliberately NOT modelled: they exist so the engine can repaint
 * static text into two alternating VGA pages without re-running layout, and
 * this port rebuilds the whole frame every tick, which subsumes them.
 */
export class MessageEngine {
  constructor() {
    this.active    = false;   // DS:0x393
    this.barrier   = 0;       // DS:0x394
    this.displayed = null;    // DS:0x260 — the accepted NUL-terminated bytes
    this.work      = null;    // DS:0xd716 — the mutated working copy
    this.morePages = -1;      // DS:0x262 — only its SIGN is ever read
    this.timer     = 0;       // DS:0x264
    this.remaining = 0;       // DS:0x276
    this.centre    = 0;       // DS:0x278 — in CHARACTER cells
    this.first     = 0;       // DS:0x27a
    this.page1Len  = 0;       // DS:0x280 — 0 means "single page"
  }

  /**
   * `CS:0x434e`. `str` is the composed message as NUL-terminated bytes.
   * @param {Uint8Array} str
   * @param {number} priority  only the low byte is used (CS:0x434e `cmp dl,..`)
   * @returns {boolean} the original's AX: true accepted, false rejected
   */
  post(str, priority) {
    const dl = priority & 0xff;                      // CS:0x434e is 8-bit
    if (dl < this.barrier) return false;             // CS:0x4352 `jc`
    if (this.active && isPrefixOf(str, this.displayed)) return false;
    this.barrier   = dl;                             // CS:0x4382
    this.displayed = str;                            // CS:0x4389
    this.active    = true;                           // CS:0x4392
    this.#layout();                                  // CS:0x43a3
    return true;
  }

  /** `CS:0x43b6` — copy to the work buffer, centre, and paginate. */
  #layout() {
    /* CS:0x43c1-0x43c9: the copy includes the NUL; CX counts only the text. */
    const len = strlen(this.displayed);
    this.work      = this.displayed.slice(0, len + 1);
    this.morePages = -1;                             // CS:0x43cb, UNCONDITIONAL
    this.remaining = len;                            // CS:0x43d1
    this.page1Len  = 0;                              // CS:0x43dc
    this.timer     = PAGE1_TICKS;                    // CS:0x43e2
    let dx = (LINE_CHARS - len) >> 1;                // CS:0x43d5-0x43da, SAR

    if (dx < 0) {                                    // CS:0x43ea `jns` not taken
      dx = 0;                                        // CS:0x43ec
      this.morePages = 0x140;                        // CS:0x43ee — sign is all
      /* CS:0x43f4-0x4407: scan BACKWARDS from index 0x1c for a space.
       * ⚠️ The scan has no lower bound — `dec cx` is never tested — so a
       * message whose first 28 bytes hold no space walks off the front of the
       * buffer in the original. Unreachable with shipped content (every
       * composer emits 0x11,0x20 as its first two bytes), and bounded here. */
      let i = LINE_CHARS, bx = Y_LOCAL;
      for (;;) {
        dx++; i--; bx--;
        if (i < 0) { i = 0; break; }                 // the port's own bound
        if (this.work[i] !== SPACE) continue;        // CS:0x4404/0x4407
        /* CS:0x4409-0x4413: never break immediately before a number. */
        const nxt = this.work[i + 1];
        if (nxt >= 0x30 && nxt <= 0x39) continue;
        break;
      }
      /* CS:0x4417/0x441b: only mark the break if real text follows it. */
      if (printableFollows(this.work, i + 1)) this.work[i] = WEDGE;   // CS:0x441d
      /* CS:0x4420-0x4426: a diamond on the seam is demoted to a space. */
      if (i > 0 && this.work[i - 1] === DIAMOND) this.work[i - 1] = SPACE;
      dx >>= 1;                                      // CS:0x442a
      this.page1Len = bx;                            // CS:0x442c — == i + 1
    }
    this.centre = dx;                                // CS:0x4430
    this.first  = 0;                                 // CS:0x4434/0x4436
    /* CS:0x443a draws immediately with CX = the copy loop's length on the
     * no-wrap path, or the scan's own counter (== page1Len) on the wrap one. */
    this.#draw(this.page1Len !== 0 ? this.page1Len : this.remaining);
  }

  /**
   * `CS:0x443e` — the half of the draw that has a LOGIC side effect. The
   * pixels themselves are `drawMessage` below; what lives here is the barrier
   * drop and the "nothing printable, draw nothing" guard, both of which change
   * what later submits are accepted.
   */
  #draw(count) {
    if (count !== 0) {                               // CS:0x447a `or cx,cx`
      if (!printableFollows(this.work, this.first)) return;   // CS:0x4483 `jc`
      this.barrier = 0;                              // CS:0x4485
    }
  }

  /**
   * `CS:0x4569` — the per-tick update, called once per 15 Hz frame from the
   * main loop at `CS:0x02db`. (It has two more callers inside the shop loop,
   * `CS:0x6c7b` and `CS:0x6d6c`, which this port does not reach.)
   */
  step() {
    if (!this.active) return;                        // CS:0x4569/0x4570
    if (--this.timer >= 0) return;                   // CS:0x4573 `dec`/`jns`
    if (this.morePages < 0) {                        // CS:0x4579/0x457e `js`
      this.active  = false;                          // CS:0x45f7
      this.barrier = 0;                              // CS:0x45fc
      return;
    }
    this.morePages = -1;                             // CS:0x4580
    this.timer     = PAGE2_TICKS;                    // CS:0x4586
    /* CS:0x4596-0x45a1: page 2's centring is computed from the UNCLAMPED
     * remaining length, while the draw count is clamped to 28 at CS:0x45e8.
     * Faithfully reproduced: a >56-character message gets a negative offset
     * and is drawn off the left edge in the original too. No shipped message
     * is long enough to trigger it — the longest composes to 50 characters. */
    this.centre    = (LINE_CHARS + this.page1Len - this.remaining) >> 1;
    this.first    += this.page1Len;                  // CS:0x45af
    this.remaining -= this.page1Len;                 // CS:0x45b3
    this.page1Len  = 0;                              // CS:0x45a9
  }

  /**
   * `CS:0x45d1-0x45ed` — what the renderer should put on screen this tick,
   * or null when nothing is showing.
   * @returns {{chars: Uint8Array, x: number}|null}
   */
  page() {
    if (!this.active || !this.work) return null;
    let count = this.page1Len !== 0 ? this.page1Len : this.remaining;
    if (count > LINE_CHARS) count = LINE_CHARS;      // CS:0x45e8-0x45ed
    if (count <= 0) return null;
    if (!printableFollows(this.work, this.first)) return null;   // CS:0x4483
    return {
      chars: this.work.subarray(this.first, this.first + count),
      x: ORIGIN_X + this.centre * ADVANCE,           // CS:0x4443 + CS:0x448e
    };
  }

  /** `CS:0x45f7`/`0x45fc` and the six external clears of DS:0x393. */
  clear() {
    this.active = false;
    this.barrier = 0;
    this.work = null;
    this.displayed = null;
  }
}

/**
 * `CS:0x44c7-0x44e1` — the blit gate, evaluated once per draw call.
 * Drawn iff `[0x38a] == 0` (a level is loaded and running) OR `[0x3ab] != 0`
 * (the shop is up) OR (`[0x42] == 4` AND `[0x38a] == 2`).
 *
 * ⚠️ It is a SEPARATE gate from the composer's own at `CS:0x461D`, on two of
 * the same variables — a port that implements one and not the other draws text
 * the original suppresses. Always true in this port, which only ever runs with
 * a level loaded, but modelled so the two agree if a title screen is added.
 */
export function blitGate({ loadStage = 0, shopActive = false, world = 1 } = {}) {
  if (loadStage === 0) return true;                  // CS:0x44cc
  if (shopActive) return true;                       // CS:0x44d3
  return world === 4 && loadStage === 2;             // CS:0x44d5-0x44e1
}

/**
 * Draw the current page. Matches `hud-digits.js`'s own signature shape: the
 * caller owns the panel origin, this owns everything panel-local.
 *
 * @param {import('../render/renderer.js').Renderer} renderer
 * @param {Array} glyphFrames  descriptor-indexed frames; `glyphFrames[c]` is
 *   the glyph for character code `c` — see the IDENTITY MAPPING note above.
 * @param {MessageEngine} engine
 * @param {number} panelY0
 */
export function drawMessage(renderer, glyphFrames, engine, panelY0, ctx) {
  if (!glyphFrames) return;
  if (!blitGate(ctx)) return;
  const p = engine.page();
  if (!p) return;
  const y = panelY0 + Y_LOCAL;
  let x = p.x;
  for (let i = 0; i < p.chars.length; i++) {
    const f = glyphFrames[p.chars[i]];
    /* CS:0x44e6 applies no clamp, so an out-of-range byte would blit whatever
     * descriptor follows the font (PSMLFNT records 123-129 are GODS logo
     * pieces, not glyphs). No shipped string ever emits one — every byte in
     * every static literal and every PALFILS hint slot is 0x11 or 0x20..0x7A —
     * so this skips rather than reproducing a garbage blit. */
    if (f) renderer.blitSprite(f, x, y);
    x += ADVANCE;                                    // CS:0x44f4
  }
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function strlen(b) { let n = 0; while (n < b.length && b[n] !== 0) n++; return n; }

/** CS:0x435b-0x436e — see the PREFIX REJECT note in the header. */
function isPrefixOf(str, displayed) {
  if (!displayed) return false;
  for (let i = 0; ; i++) {
    const a = str[i];
    if (a === undefined || a === 0) return true;     // CS:0x4366 `jz` -> reject
    if (a !== displayed[i]) return false;            // CS:0x436c `jnz` -> accept
  }
}
