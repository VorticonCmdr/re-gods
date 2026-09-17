/* joy.js — decodes P*.JOY{G,L}{1,2,3}.DAT: flat, headerless recordings of
 * joystick/button input that drove GAME.EXE's attract-mode demo.
 *
 * See Gods/docs/asset-formats.md's "recorded attract-mode input, not sprite
 * data" section and Gods/docs/player-state-machine.md's DS:0x382 row. The
 * per-tick poller (FUN_1000_241d) writes one packed byte per frame:
 *   bit0 up, bit1 down, bit2 left, bit3 right, bit7 fire, bits 4-6 always 0
 * (in the live-computed value — which is what makes 0xFF an unambiguous
 * end-of-stream sentinel: no real frame can ever set bits 4-6, so a byte
 * with all eight bits set can only be the deliberately-written terminator).
 * FUN_1000_006f checks for that whole byte, not a masked comparison.
 *
 * Only `joyg` files decode into real GAMEPLAY input — they jump straight
 * into FUN_1000_6b00 (world/sublevel already forced). `joyl` files drive the
 * title-menu loop with the SAME byte format, so this decoder reads them
 * identically, but their ticks are menu up/down/fire presses, not player
 * movement — a consumer expecting a Player-tick replay must not feed a
 * `joyl` stream to it.
 */

export const JOY_TERMINATOR = 0xff;

export const JOY_BIT = { UP: 0x1, DOWN: 0x2, LEFT: 0x4, RIGHT: 0x8, FIRE: 0x80 };

/**
 * @param {Uint8Array} bytes  DCL-decompressed file contents (dclDecompress's
 *   own `.data`), still including the trailing 0xFF sentinel.
 * @returns {{
 *   ticks: Array<{up:boolean,down:boolean,left:boolean,right:boolean,fire:boolean}>,
 *   terminatorIndex: number,   // byte offset of the 0xFF, or -1 if absent
 *   liveBitsClean: boolean,    // true iff no non-terminator byte sets bits 4-6
 * }}
 */
export function decodeJoyRecording(bytes) {
  const ticks = [];
  let terminatorIndex = -1;
  let liveBitsClean = true;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === JOY_TERMINATOR) { terminatorIndex = i; break; }
    if (b & 0x70) liveBitsClean = false;
    ticks.push({
      up: !!(b & JOY_BIT.UP),
      down: !!(b & JOY_BIT.DOWN),
      left: !!(b & JOY_BIT.LEFT),
      right: !!(b & JOY_BIT.RIGHT),
      fire: !!(b & JOY_BIT.FIRE),
    });
  }
  return { ticks, terminatorIndex, liveBitsClean };
}

/** `joyg` cycler state -> 0-based world index, CS:0x2DD5-0x2DE9 (state-1)>>1
 *  for states 1/3/5 — then FUN_1000_6b00 (CS:0x6B00-0x6B0B) increments it to
 *  the real 1-based world the rest of the game expects. Both `joyg1/2/3`
 *  (this table's keys) map onto that same INC, so the file-name index IS
 *  already the 1-based world number — recorded here only so a caller does
 *  not have to re-derive the two-stage indexing scheme to use this module. */
export const JOYG_WORLD = { 1: 1, 2: 2, 3: 3 };

/** Every `joyg` segment forces sublevel B before any gameplay tick runs
 *  (FUN_1000_2df1's unconditional double-load) — see docs/asset-formats.md's
 *  "does not visit both sublevels" correction. */
export const JOYG_SUBLEVEL = 1; // 0 = 'a', 1 = 'b'
