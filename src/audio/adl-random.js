/* adl-random.js — which sound effects consume a random number.
 *
 * GAME.EXE hands the sound driver a far callback at DS:0xFA (installed at
 * CS:0x29F1: `CALL 0x3836 / RETF` at CS:0x29FD — the random-table read).
 * ADL.EXE, the driver the Sound Blaster/AdLib setting loads, calls it from
 * its sfx dispatch (ADL:0x170, reached through sound export 3 by GAME.EXE's
 * CS:0x22CA):
 *     017D  cmp al,0x49 / jnl drop       ; SIGNED: ids >= 0x80 pass too
 *     0196  and al,0x7f                  ; record = 0x394 + id*3
 *     019E  cmp byte [cs:bp+1],0 / jz    ; +1 picks a pitch-jitter helper
 *     01AF  call [0x470 + (+1 - 1)*2]    ; 0x37D: dl += rnd&1
 *                                        ; 0x386: dl += (rnd&1)+(rnd>>8&1)
 * Each helper is ONE `call far [0xFA]`, i.e. one step of DS:0x160. So these
 * ids advance the game's random table every time they are played — which is
 * why the attract demos' AI depends on the sound driver. [PROVEN] live:
 * PJOYG1's first footstep (id 0x0E, cursor 17) is where DS:0x160 first
 * moves, from a breakpoint on CS:0x3836 returning into CS:0x2A00 from the
 * driver segment. Only ADL's table is modelled: that is what the captures
 * were recorded with, and the other drivers (ROL/TDY/BPR) were not read.
 */

/* ADL.EXE file offset 0x200 + 0x394, 73 x 3-byte records; ids whose +1 byte
 * is nonzero. */
export const ADL_RANDOM_SFX_IDS = new Set([0x01, 0x0e, 0x22, 0x29, 0x2b, 0x2d, 0x35, 0x3c, 0x42, 0x46]);

/* The same records' +1 byte, by id: which helper (1 = 0x37D, 2 = 0x386). */
export const ADL_SFX_VARIANT = new Map([
  [0x01, 2], [0x0e, 1], [0x22, 2], [0x29, 1], [0x2b, 1], [0x2d, 1], [0x35, 1], [0x3c, 1], [0x42, 2], [0x46, 1],
]);

/**
 * What the helper adds to DL, the blob the driver then plays (ADL:0x1B9
 * `mov ax,dx`): the id's blob moves up by 0..1 or 0..2. So these sounds have
 * variants, not just a random draw: the time bomb's and the kill's 0x22
 * plays PGODS.MUS blob 0x22, 0x23 or 0x24. `rnd` is the word CS:0x3836
 * returned (AX).
 */
export function adlVariantOffset(word, rnd) {
  const kind = ADL_SFX_VARIANT.get(word & 0x7f);
  if (!kind || rnd === undefined) return 0;
  return kind === 1 ? rnd & 1 : (rnd & 1) + ((rnd >> 8) & 1);
}

/** @param {number} word the value GAME.EXE puts in AX for CS:0x22CA */
export function sfxDrawsRandom(word) {
  const al = word & 0xff;
  if (al >= 0x49 && al < 0x80) return false;    // ADL:0x017D `jnl` (signed)
  return ADL_RANDOM_SFX_IDS.has(al & 0x7f);
}
