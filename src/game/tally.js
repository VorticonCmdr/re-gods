/* tally.js — the inter-level "LEVEL X COMPLETED" bonus-tally screen and its
 * password-reveal overlay, `CS:0x6553`-`0x6a5a` (`FUN_1000_6553` /
 * `FUN_1000_69d7`). This is the screen `zones.js`'s own ZONE_EXIT branch
 * previously skipped straight past, running the world-advance/key-clear/
 * password-gen side effects synchronously and cutting straight to the next
 * level — main.js now defers all of that until THIS screen's own sequence
 * finishes, matching the original's real call site (`CS:0x02F0`, the main
 * loop's own post-frame check, not the zone-hit itself, which only sets
 * `DS:0x36a`/`DS:0x178` — see `zones.js`'s own header).
 *
 * PROVENANCE — fully disassembled and LIVE-CONFIRMED under DOSBox this pass
 * (forced via the `DS:0x178`/`DS:0x36a` isolated-write technique already
 * used elsewhere in this project, not scripted play): a fresh world-1 spawn
 * (lives=2, health=24, money=0) produced, in order. "LEVEL ONE COMPLETED" /
 * "2 X 2000" / "24 X 80" / "BONUS 005920" (2*2000+24*80=5920, exact), then
 * "LEVEL 2 PASSWORD" / "PME" / "FIRE TO CONTINUE", then a "LOADING THE
 * TEMPLE" interstitial into live world-2 play. See Gods/docs/camera-and-
 * world-nav.md's own new section (search "tally/bonus screen body") for the
 * full disassembly this module ports.
 *
 * THE THREE BONUSES, `FUN_1000_67b8`, each added once, only if nonzero:
 *   time bonus   = lives   * 2000   (CS:0x224 in the original)
 *   health bonus = health  * 80     (CS:0x192)
 *   money bonus  = floor(money / 8) (CS:0x194:0x196, a real 32-bit divide —
 *                  NOT the 3xSAR bug documented elsewhere in this project;
 *                  ⚠️ the original only adds the LOW WORD of the quotient,
 *                  dropping the high word — unproven unsafe at any money
 *                  total a shipped level can produce, not reproduced here
 *                  since this port's own money total is a plain JS number)
 * All three feed one shared pool, which the screen then counts DOWN to zero
 * (`0x66fd`-`0x6798`) at up to 90/tick while the HUD money figure counts UP
 * in lockstep (`FUN_1000_0bbf`/`0x0ab1`, already-ported `hud-digits.js`) —
 * live-confirmed: the post-tally HUD money reads exactly the pool's own
 * starting total. This port credits the drained pool straight to
 * `treasure.js`'s `Purse` (money) — the digit POSITION that matched live is
 * the money field, not score, so only money is credited here; whether the
 * original's own `FUN_1000_0c80` ALSO touches score was not chased to a
 * conclusion and is not reproduced. `POOL_STEP` (90/tick) is real; the
 * original's own downgrade to 10-then-1 near zero (so the countdown lands
 * exactly on 0 even when the pool isn't a multiple of 90) is simplified
 * here to `min(pool, POOL_STEP)`, which reaches exactly 0 by the same
 * construction without the undiscovered exact threshold constants.
 *
 * THE PASSWORD REVEAL, `FUN_1000_69d7` (`CS:0x69d7`-`0x6a5a`) — a real,
 * input-gated overlay, not the absent screen `zones.js`'s own header
 * previously assumed. Shown once, the FIRST time a world is freshly
 * completed (the original bails immediately if the password slot already
 * holds one — `CS:0x69e3 cmp byte[SI],0 / jnz`), reading:
 *   "LEVEL {completedWorld+1} PASSWORD"   (the WORLD BEING UNLOCKED, not the
 *                                          one just finished — `CS:0x69f7
 *                                          inc cl` on the pre-advance world;
 *                                          cross-checked two ways: the bit-10
 *                                          dispatch position runs before
 *                                          bit-1's own world-advance, AND the
 *                                          patched digit's own sprite
 *                                          arithmetic lands exactly on this
 *                                          document's already-established
 *                                          digit-sprite base)
 *   "{3-letter password}"                 (raw 1-26 codes -> 'A'-'Z',
 *                                          `FUN_1000_6a5b`)
 *   "FIRE TO CONTINUE"                     (a REAL wait: `FUN_1000_252c`
 *                                          blocks for a FIRE press then a
 *                                          release; simplified here to a
 *                                          single press edge)
 * The original draws all three lines through a distinct, unidentified font
 * (`FUN_1000_224e`, glyph = byte+0x3f, not PSMLFNT's identity map) as an
 * overlay on the STILL-VISIBLE game world underneath (confirmed live: the
 * hero and level tiles are visible behind the text in both captures) — this
 * module reuses the already-ported, already-verified PSMLFNT font instead,
 * a disclosed port-level substitution, not a fidelity claim, matching this
 * project's own precedent (title-menu.js's own erase/confirm icon note).
 * The two bonus-line ICONS (a life icon before the time-bonus line, a heart
 * before the health-bon line, visible in the live capture) are likewise
 * unidentified sprites — reproduced here as plain text labels instead of
 * inventing a sprite index.
 *
 * TIMING, `FUN_1000_6553`'s own body — no `PPAYOFF.PI1` or any other
 * background blit anywhere in it (confirmed both statically — no export-3/4
 * graphics-load pair — and live: the tally text draws directly over the
 * frozen game frame): a 30-tick wait after the bonus summary appears
 * (`FUN_1000_64d7(30)`), the countdown itself, then a 50-tick wait
 * (`FUN_1000_64d7(50)`) before the tail dispatch (world-advance, key-clear,
 * password-gen) hands off into the password reveal, if any. The `0x52f`
 * "cha-ching" sfx (`FUN_1000_22ca`, the same generic sound-export call
 * `zones.js` already cites for the teleport chime) fires once after the
 * static bonus summary and once every 3rd countdown step. `sfxPending` is
 * exposed rather than played here so this module stays audio-free and
 * testable under plain Node; main.js reads it right after each `step()`
 * call and plays `CHA_CHING_SFX` through `audio/audio-bus.js`.
 */

import { drawCentered } from './title-menu.js';

export const TIME_BONUS_PER_LIFE = 2000;      // CS:0x67b8
export const HEALTH_BONUS_PER_HP = 80;        // CS:0x67b8
export const MONEY_BONUS_DIVISOR = 8;         // CS:0x67b8, floor(money/8)

export const POOL_STEP = 90;                  // CS:0x66fd-0x6798, see header
export const WAIT_AFTER_SUMMARY_TICKS = 30;   // FUN_1000_64d7(30)
export const WAIT_AFTER_COUNTDOWN_TICKS = 50; // FUN_1000_64d7(50)
export const SFX_EVERY_N_STEPS = 3;
/* The "cha-ching" itself — see the header's own citation
 * (`FUN_1000_22ca(0x52f)`, the same generic sound-export call `zones.js`
 * cites for the teleport chime's own CALL MECHANISM, not the same id). Named
 * here, alongside `sfxPending`, now that audio/audio-bus.js exists for
 * main.js to play it through. */
export const CHA_CHING_SFX = 0x52f;

export const POOL_DIGITS = 6;
export const POOL_X0 = 172, POOL_Y = 136, POOL_DIGIT_STEP = 16;   // CS:0x67da, live-confirmed layout

/** CS:0x67b8 — lives*2000, 0 if lives<=0. */
export function timeBonus(lives) { return lives > 0 ? lives * TIME_BONUS_PER_LIFE : 0; }
/** CS:0x67b8 — health*80, 0 if health<=0. */
export function healthBonus(health) { return health > 0 ? health * HEALTH_BONUS_PER_HP : 0; }
/** CS:0x67b8 — floor(money/8), 0 if money<=0. */
export function moneyBonus(moneyTotal) { return moneyTotal > 0 ? Math.floor(moneyTotal / MONEY_BONUS_DIVISOR) : 0; }

function drawPoolDigits(renderer, digitFrames, pool) {
  if (!digitFrames) return;
  const v = Math.max(0, Math.min(999999, pool | 0));
  const s = String(v).padStart(POOL_DIGITS, '0');
  let x = POOL_X0;
  for (let i = 0; i < s.length; i++) {
    renderer.blitSprite(digitFrames[s.charCodeAt(i) - 48], x, POOL_Y);
    x += POOL_DIGIT_STEP;
  }
}

/**
 * One inter-level tally + (optional) password-reveal sequence. `step()`
 * advances one game tick and returns the money to credit this tick (0 most
 * ticks — the caller owns `treasure.js`'s `Purse`, this module doesn't reach
 * into it); `draw()` renders the current phase. `done` goes true once the
 * whole sequence (including any password reveal) has finished, at which
 * point the caller runs the deferred exit effects (world advance, key
 * clear, `switchLevel`) it held back until now.
 */
export class TallyScreen {
  /**
   * @param {object} opts
   * @param {string} opts.title e.g. "LEVEL  ONE" (an `EXIT_DESTINATIONS`
   *   record's own `text`, whitespace-collapsed by the caller)
   * @param {number} opts.lives
   * @param {number} opts.health
   * @param {number} opts.moneyTotal `purse.total` at the moment of the exit
   * @param {?{worldNumber:number, code:string}} opts.password null if this
   *   exit doesn't reveal a password (bit 10 clear, or the slot was already
   *   filled — see the header)
   */
  constructor({ title, lives, health, moneyTotal, password }) {
    this.title = title;
    this.lives = lives;
    this.health = health;
    this.timeBonus = timeBonus(lives);
    this.healthBonus = healthBonus(health);
    this.moneyBonus = moneyBonus(moneyTotal);
    this.pool = this.timeBonus + this.healthBonus + this.moneyBonus;
    this.password = password;
    this.phase = 'summary';        // 'summary' -> 'countdown' -> 'wait' -> ['password'] -> done
    this.waitTicks = WAIT_AFTER_SUMMARY_TICKS;
    this.sfxCounter = 0;
    this.sfxPending = false;       // true the tick a cha-ching would fire — see header
    this.firePrev = false;
    this.done = false;
  }

  /**
   * Advance one tick. `fireHeld` is this tick's live FIRE input state.
   * @returns {number} money to credit the caller's Purse this tick (0 most ticks)
   */
  step(fireHeld) {
    this.sfxPending = false;
    let award = 0;
    if (this.phase === 'summary') {
      if (--this.waitTicks <= 0) {
        this.sfxPending = true;                        // the summary's own bonus-add cha-ching
        this.phase = this.pool > 0 ? 'countdown' : 'wait';
        if (this.phase === 'wait') this.waitTicks = WAIT_AFTER_COUNTDOWN_TICKS;
      }
    } else if (this.phase === 'countdown') {
      const dec = Math.min(this.pool, POOL_STEP);       // CS:0x66fd-0x6798, see header
      this.pool -= dec;
      award = dec;
      if (++this.sfxCounter >= SFX_EVERY_N_STEPS) { this.sfxCounter = 0; this.sfxPending = true; }
      if (this.pool <= 0) { this.phase = 'wait'; this.waitTicks = WAIT_AFTER_COUNTDOWN_TICKS; }
    } else if (this.phase === 'wait') {
      if (--this.waitTicks <= 0) {
        if (this.password) { this.phase = 'password'; }
        else { this.phase = 'done'; this.done = true; }
      }
    } else if (this.phase === 'password') {
      const firePressed = fireHeld && !this.firePrev;   // CS:0x252c's own press edge (release not modelled)
      if (firePressed) { this.phase = 'done'; this.done = true; }
    }
    this.firePrev = fireHeld;
    return award;
  }

  /** @param {import('../render/renderer.js').Renderer} renderer
   *  @param {?object} glyphs PSMLFNT, see header for why not the original's own font
   *  @param {?Array} digitFrames `hud-digits.js`'s `sliceDigitFrames()` output */
  draw(renderer, glyphs, digitFrames) {
    if (this.phase === 'password' && this.password) {
      drawCentered(renderer, glyphs, `LEVEL ${this.password.worldNumber} PASSWORD`, 8);
      drawCentered(renderer, glyphs, this.password.code, 24);
      drawCentered(renderer, glyphs, 'FIRE TO CONTINUE', 158);
      return;
    }
    drawCentered(renderer, glyphs, `${this.title} COMPLETED`, 8);
    let y = 32;
    if (this.timeBonus > 0) {
      drawCentered(renderer, glyphs, `LIVES   ${this.lives} X ${TIME_BONUS_PER_LIFE}`, y);
      y += 16;
    }
    if (this.healthBonus > 0) {
      drawCentered(renderer, glyphs, `HEALTH  ${this.health} X ${HEALTH_BONUS_PER_HP}`, y);
      y += 16;
    }
    drawCentered(renderer, glyphs, 'BONUS', 120);
    drawPoolDigits(renderer, digitFrames, this.pool);
  }
}
