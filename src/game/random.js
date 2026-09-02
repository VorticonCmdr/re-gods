/* random.js — GODS' random source, which is a REPLAYED TABLE, not a PRNG.
 *
 * GAME.EXE contains only 14 MUL/IMUL instructions, all register-operand:
 * there is no LCG and no multiply-based generator anywhere. Instead:
 *
 *   1. SEED       CS:0x236c, once at init — `sub ah,ah / int 1Ah /
 *                 mov [0x122],dx`, the low word of the BIOS tick count.
 *                 Wall-clock seeded, so the ORIGINAL IS NOT REPRODUCIBLE
 *                 run-to-run either.
 *   2. MIXER      FUN_1000_2375 — a hand-rolled bytewise RCR/XOR shuffle.
 *   3. TABLE      FUN_1000_37f6 — 256 words at 1ffd:7e14, regenerated ONCE
 *                 PER LEVEL LOAD (called from CS:0x2b2a, right after the .MAP
 *                 loader), retried if it comes out all-zero, then 1-2 entries
 *                 forced to zero.
 *   4. DRAW       FUN_1000_3836 — 59 call sites, the game's only random
 *                 source: return [0x7e14 + [0x160]], then
 *                 [0x160] = ([0x160] + 2) & 0x1FF.
 *
 * WHAT IS PORTED, AND WHAT IS NOT. The DRAW is ported exactly — a 256-word
 * table read cyclically by a byte cursor stepping 2 and masked to 0x1FF, so
 * the observable structure (period 256, every entry visited once per lap,
 * shared cursor across all consumers) is reproduced. The MIXER is NOT ported:
 * FUN_1000_2375 has not been read in this project, so the table contents come
 * from a seeded generator here. UNKNOWN_random_mixer.
 *
 * That divergence is deliberate and it costs nothing testable: the original's
 * table is seeded from the wall clock, so its CONTENTS were never reproducible
 * to begin with. What a port can and must reproduce is the replay behaviour,
 * because "the same value comes back every 256 draws" is a property the game
 * can depend on and a fresh Math.random() per call would not have.
 */

export const RANDOM_TABLE_WORDS = 256;   // FUN_1000_37f6
export const RANDOM_CURSOR_MASK = 0x1ff; // FUN_1000_3836, a BYTE cursor

export class GodsRandom {
  /**
   * @param {number} seed any integer; pass a fixed value to make a run
   *   reproducible, which is the only way to get determinism out of this
   *   subsystem (see the header).
   */
  constructor(seed = 1) {
    this.table = new Uint16Array(RANDOM_TABLE_WORDS);
    this.cursor = 0;                       // DS:0x160, in BYTES
    this.reseed(seed);
  }

  /** FUN_1000_37f6 — called once per level load, not per frame. */
  reseed(seed) {
    /* Not the original mixer — see UNKNOWN_random_mixer in the header. A
     * xorshift is used only to fill the table; the table is what matters. */
    let s = (seed | 0) || 1;
    for (let i = 0; i < RANDOM_TABLE_WORDS; i++) {
      s ^= s << 13; s |= 0;
      s ^= s >>> 17;
      s ^= s << 5; s |= 0;
      this.table[i] = s & 0xffff;
    }
    /* The original retries if the whole table came out zero, then forces 1-2
     * entries to zero. Both are reproduced: the retry can never fire here, and
     * the forced zeros are real values consumers can see. */
    this.table[0] = 0;
    this.cursor = 0;
  }

  /** FUN_1000_3836 — the draw. Advances the shared cursor. */
  next() {
    const v = this.table[this.cursor >> 1];
    this.cursor = (this.cursor + 2) & RANDOM_CURSOR_MASK;
    return v;
  }
}
