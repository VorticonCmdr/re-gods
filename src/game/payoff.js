/* payoff.js — the game-completion screen, CS:0x037A. [PROVEN] live in DOSBox
 * (gods-web tools/attract-capture/w4payoff.py): the world-4 ending sets
 * DS:0x34A once the hero has banked the ten gifts, and the main loop's
 * CS:0x032E `jnz 0x37a` lands here.
 *
 *   037A  [0x34A] = 0 ; export 8 (fade out) ; [0x33] = 0
 *   038A  atlas group "introft" (DS:0xEB0A) from the level-group cursor
 *         DS:0x130, i.e. over level<N> from descriptor 0x1C2
 *   03AC  [0x38A] = 4 ; PPAYOFF.PI1 (DS:0xEAFF "payoff.pi1") -> 2888:0
 *   03BE  0x04B0: the image to the back buffer (export 3 from 2888:0x22)
 *   03CD  its 16 palette words, byte-swapped, to DS:0xDCE ; export 9 fades
 *         them in ([0x42] = 6 around the call)
 *   03FB  [0x11E] = 0 ; 8 pages from DS:0xEF58 (two lines each):
 *           image again, line 1 at y 0x0C, line 2 at y 0x1E (0x04C5),
 *           export 14 (flip, [0x39] = 0), wait until [0x39] >= 0xFA
 *   0435  poll input until fire (CS:0x241D, [0x382] bit 7)
 *   043F  export 8 ; the restart (main.js completionRestart)
 *
 * 0x04C5 centres at x = 0xA0 - (4*len - 4) = 164 - 4*len; 0x04DF draws each
 * byte as sprite ch + 0x1CB with export 2, 8 px apart, a space as a gap.
 * With introft at descriptor 0x1C2 that is PINTROFT record ch + 9 — the
 * story font intro.js already slices (storyGlyphs).
 *
 * [0x39] counts at 60 Hz (docs/execution-and-boot.md), so a page holds
 * 250/60 s; measured live 76-78 BIOS ticks (4.18-4.29 s) a page including
 * the redraw.
 */
import { drawIntroText } from './intro.js';

/* DS:0xEF58 — sixteen pointers, two lines a page (GAME.EXE bytes, equal to
 * what the live screen showed on pages 1 and 8). Page 8's second line is
 * the empty string at 0xEF36. */
export const PAYOFF_PAGES = Object.freeze([
  ['the way to mount olympus', 'lies open'],
  ['you may now claim your place', 'among the gods'],
  ['enjoy your life', 'it will last forever'],
  ['enjoy your life', 'it will last forever'],
  ['so what will you do', 'with this gift_'],
  ['journey again to the city', 'if you dare'],
  ['this time your task will', 'be harder'],
  ['press fire to continue', ''],
]);
export const PAGE_HOLD = 0xfa;               // CS:0x042C `cmp byte [0x39],0xfa`
export const PAGE_HZ = 60;                   // DS:0x39
export const LINE_Y = [0x0c, 0x1e];          // CS:0x0412 / 0x0418
export const FADE_MS = 8 * 3 * 1000 / 60;    // export 9: 8 passes, AX=1 -> 3 retraces each
const ADVANCE = 8;                           // CS:0x0506

export const lineX = (text) => 0xa0 - (4 * text.length - 4);   // CS:0x04C5

export class PayoffScreen {
  constructor() {
    this.page = 0;
    this.t = 0;          // ms on this page
    this.fadeMs = 0;
    this.done = false;
  }

  /** One call per frame; `fire` is the held fire input. Returns true once
   *  fire was pressed after the last page (CS:0x0438). */
  step(dtMs, fire) {
    this.fadeMs += dtMs;
    if (this.page < PAYOFF_PAGES.length) {
      this.t += dtMs;
      if (this.t * PAGE_HZ / 1000 >= PAGE_HOLD) { this.page++; this.t = 0; }
      return false;
    }
    if (fire) this.done = true;
    return this.done;
  }

  get fadeT() { return Math.min(1, this.fadeMs / FADE_MS); }

  draw(renderer, image, storyGlyphs) {
    renderer.blitBackground(image);                                // CS:0x0408 -> 0x04B0
    const p = PAYOFF_PAGES[Math.min(this.page, PAYOFF_PAGES.length - 1)];
    for (let i = 0; i < 2; i++) {
      if (p[i]) drawIntroText(renderer, storyGlyphs, p[i], lineX(p[i]), LINE_Y[i], ADVANCE);
    }
  }
}
