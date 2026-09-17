/* random.js — GODS' random source, which is a REPLAYED TABLE, not a PRNG.
 *
 * GAME.EXE contains only 14 MUL/IMUL instructions, all register-operand:
 * there is no LCG and no multiply-based generator anywhere. Instead:
 *
 *   1. SEED       CS:0x236c, once at init — `sub ah,ah / int 1Ah /
 *                 mov [0x122],dx`, the low word of the BIOS tick count.
 *                 Wall-clock seeded, so the ORIGINAL IS NOT REPRODUCIBLE
 *                 run-to-run either. CS:0x236c has exactly one caller
 *                 (FUN_1000_229a, itself called once from `entry`), so
 *                 [0x122] is never reseeded again for the life of the
 *                 process — every later table regen, and every password
 *                 generated via FUN_1000_6a6b, consumes from wherever the
 *                 mixer chain was left. This class does not thread that
 *                 cross-level state; each reseed() takes its seed explicitly.
 *   2. MIXER      FUN_1000_2375 — a hand-rolled bytewise RCR/XOR shuffle over
 *                 [0x122], reproduced instruction-for-instruction below.
 *                 UNKNOWN_random_mixer — CLOSED, [PROVEN] live in DOSBox:
 *                 breakpointed FUN_1000_37f6's own entry (before any mixer
 *                 call), read [0x122] = 0x6189 as the real entry seed, ran
 *                 to the function's RET, and dumped the live 512-byte table
 *                 at 1ffd:7e14 (session-live DS/ES segment 0x136A, same
 *                 segment for both). Running mix16() below 256 times from
 *                 that captured seed, then applying the two forced-zero
 *                 draws exactly as GAME.EXE does, reproduces all 512 bytes
 *                 byte-for-byte, forced zeros (at byte offsets 190 and 380
 *                 in that capture) included. The whole per-call carry-flag
 *                 dependency chain resolves to CF_in=0 at the mixer's own
 *                 first RCR for every one of the 258 calls FUN_1000_37f6
 *                 makes (each is immediately preceded — via OR/CMP/AND — by
 *                 an instruction that clears CF), so the function is a pure,
 *                 external-state-free function of the 16-bit seed for this
 *                 consumer. (FUN_1000_6a6b, the password generator, is the
 *                 mixer's only other caller; its first two of three calls
 *                 also have CF_in=0, its third follows a DIV whose CF this
 *                 project has not pinned down — moot here since password
 *                 generation is not ported.)
 *   3. TABLE      FUN_1000_37f6 — 256 words at 1ffd:7e14, regenerated ONCE
 *                 PER LEVEL LOAD (called from CS:0x2b2a, right after the .MAP
 *                 loader). [0x160] (the draw cursor) resets to 0 right after
 *                 the fill loop succeeds, BEFORE the two forced zeros are
 *                 written. Retried (re-enters from the top, continuing the
 *                 SAME mixer chain rather than the original seed) if the
 *                 256-word fill comes out entirely zero — which live-tracing
 *                 this session showed is a real, if narrow, hang risk in
 *                 GAME.EXE itself: seed 0 is a fixed point of the mixer
 *                 (every RCR/XOR/AND/SHL/RCL/ADD of an all-zero register
 *                 state yields zero), so a boot whose BIOS tick count's low
 *                 word happens to be exactly 0 makes FUN_1000_37f6 retry
 *                 forever. NOT PORTED, disclosed: reseed() below bounds the
 *                 retry and nudges a stuck-at-zero seed by 1 rather than
 *                 looping forever, because a JS infinite loop hangs the tab
 *                 in a way the original's analogous hang never could a DOS
 *                 session. Then exactly two more mixer draws pick the two
 *                 entries forced to zero — the first AND 0xFE (byte offset
 *                 0..254, i.e. word index 0..127 only), the second AND 0x1FE
 *                 (byte offset 0..510, any of the 256 words) — so it is
 *                 "1-2" net zeroed entries only when the two draws collide.
 *   4. DRAW       FUN_1000_3836 — 59 call sites, the game's only random
 *                 source: return [0x7e14 + [0x160]], then
 *                 [0x160] = ([0x160] + 2) & 0x1FF.
 *
 * WHAT IS PORTED. The DRAW (a 256-word table read cyclically by a byte
 * cursor stepping 2 and masked to 0x1FF) and the MIXER/TABLE generation are
 * both exact now — given the same seed, reseed() produces the identical
 * 512-byte table GAME.EXE would. The one remaining divergence is the
 * cross-level seed threading noted under SEED above: this class does not
 * carry [0x122] across reseed() calls the way the real game carries it
 * across level loads and password generation, so a caller that needs
 * multi-level replay fidelity against a real GAME.EXE run must thread the
 * seed itself.
 */

export const RANDOM_TABLE_WORDS = 256;   // FUN_1000_37f6
export const RANDOM_CURSOR_MASK = 0x1ff; // FUN_1000_3836, a BYTE cursor

/**
 * FUN_1000_2375, CS:0x2375-0x23a5. One 16-bit word in, one 16-bit word out,
 * pure given CF_in=0 (see the header for why that always holds here).
 */
function mix16(seed16) {
  let AL = (seed16 >> 8) & 0xff;   // 237c MOV CL,AH ; 237e MOV AL,CL
  let CL = AL;
  let DL = seed16 & 0xff;          // 237a MOV DL,AL (the original low byte)
  let CF = 0;

  const rcr = () => { const out = AL & 1; AL = (AL >> 1) | (CF << 7); CF = out; };

  rcr();                                      // 2380 RCR AL,1
  CL = (CL ^ AL) & 0xff; CF = 0;              // 2382 XOR CL,AL
  rcr(); rcr();                               // 2384/2386 RCR AL,1 x2
  CL = (CL ^ AL) & 0xff; CF = 0;              // 2388 XOR CL,AL
  rcr();                                      // 238a RCR AL,1
  DL = (DL ^ AL) & 0xff; CF = 0;              // 238c XOR DL,AL
  rcr(); rcr();                               // 238e/2390 RCR AL,1 x2
  AL = AL & 1; CF = 0;                        // 2392 AND AL,1

  const shlOut = (DL >> 7) & 1;
  DL = (DL << 1) & 0xff; CF = shlOut;         // 2394 SHL DL,1
  const rclOut = (CL >> 7) & 1;
  CL = ((CL << 1) | CF) & 0xff; CF = rclOut;  // 2396 RCL CL,1

  AL = (AL + DL) & 0xff;                      // 2398 ADD AL,DL
  DL = AL;                                    // 239a MOV DL,AL
  return ((CL & 0xff) << 8) | (DL & 0xff);    // 239c/239e/23a0 -> MOV [0x122],AX
}

const RESEED_MAX_ATTEMPTS = 8; // see "NOT PORTED, disclosed" above

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
    let s = seed & 0xffff;
    for (let attempt = 0; attempt < RESEED_MAX_ATTEMPTS; attempt++) {
      if (s === 0) s = 1; // stuck fixed point — see "NOT PORTED, disclosed" above
      let allZero = true;
      for (let i = 0; i < RANDOM_TABLE_WORDS; i++) {
        s = mix16(s);
        this.table[i] = s;
        if (s !== 0) allZero = false;
      }
      if (!allZero) break;
    }

    this.cursor = 0; // DS:0x160 reset, right after the fill succeeds

    s = mix16(s);
    this.table[(s & 0x00fe) >> 1] = 0;
    s = mix16(s);
    this.table[(s & 0x01fe) >> 1] = 0;
  }

  /** FUN_1000_3836 — the draw. Advances the shared cursor. */
  next() {
    const v = this.table[this.cursor >> 1];
    this.cursor = (this.cursor + 2) & RANDOM_CURSOR_MASK;
    return v;
  }
}
