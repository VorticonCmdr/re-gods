/* sb-voice.js — decodes PDEMOSB4.SB: INTROV.EXE's Sound-Blaster intro
 * track. The file name is kept from when this was believed to be one voice
 * clip; ⚠️ that reading was wrong.
 *
 * PDEMOSB4.SB is a SAMPLE-MUSIC SEQUENCE: 11 PCM clips plus a byte-code
 * script, played by PPLAYER.BIN's own sequencer. Read from the driver's
 * code (ndisasm of the blast.py-decompressed PPLAYER.BIN), then checked
 * live in DOSBox (Gods/docs/execution-and-boot.md, "PDEMOSB4.SB").
 *
 * LAYOUT (all little-endian, offsets into the decompressed file):
 *   byte 0          sequence count (1)
 *   u16 at 2        offset of the clip table (0x1DC)
 *   per sequence i, 4 bytes at 4 + 4*i:
 *     u16 script offset, u8 "also start FM" flag (0xFF — `0000:01e0`),
 *     s8 pitch bias ([0x2950], -4 here)
 *   clip table, 6 bytes per clip: {u16 offset, u16 paragraph, u16 length}
 *     — clip k's PCM starts at paragraph*16 + offset, 8-bit unsigned mono.
 *     11 real entries; header 0x21E + their 226960 PCM bytes = the whole
 *     227502-byte file.
 *
 * SCRIPT (`0000:23c0`, jump table at `0000:239c`), one byte per opcode:
 *   00 n  repeat count R       02 n  step length S
 *   07 n  select clip n        01    rest one step
 *   04 n  call sub-sequence n  05    return (at top level: STOP)
 *   03    jump to the current sequence's start
 *   >= 20 play the current clip, rate = word at PPLAYER.BIN 0x2992 + (op-0x20)
 *         (a BYTE offset, `0000:2549`), scaled by (256 + bias) / 256
 *         (`0000:269a`, with [0x1f90] = 256)
 * A step lasts (S+1)*(R+1) driver ticks (`0000:237a`); the driver is ticked
 * by INTROV's own 50 Hz timer (`CS:0x14F4`). Each new note halts the
 * previous DMA first (`0000:26a8`), so clips never overlap.
 *
 * Checked live: clip 5 (15502 bytes) started at counter 1544 and clip 6 at
 * 1640 — the simulation's 1536/1632 plus INTROV's constant +8 start offset;
 * the first note's rate, 10548*252/256 = 10383, is the value an earlier
 * session read live at the driver's DS:0x294C. The script runs 64 notes
 * over 7680 ticks (153.6 s) and its last audible note ends at counter ~7614,
 * before INTROV's own final stop at 7632 — so `UNKNOWN_sb_voice_stream_end`
 * closes as "nothing audible is cut short"; the stop only cuts the script's
 * closing rest.
 */

export const SB_TICK_HZ = 50;

/**
 * @param {Uint8Array} sb      DCL-decompressed PDEMOSB4.SB
 * @param {Uint8Array} player  DCL-decompressed PPLAYER.BIN (for the rate table)
 * @param {number} [seq=0]     sequence index
 * @returns {{ clips: Uint8Array[], events: Array<{tick:number, clip:number, rateHz:number}>, endTick:number }}
 */
export function parseSbSequence(sb, player, seq = 0) {
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const seqCount = sb[0];
  if (seq >= seqCount) throw new Error(`sequence ${seq} >= count ${seqCount}`);
  const table = u16(sb, 2);
  const entry = 4 + 4 * seq;
  const script = u16(sb, entry);
  const bias = (sb[entry + 3] << 24) >> 24;

  const clips = [];
  for (let k = 0; ; k++) {
    const o = table + 6 * k;
    const start = u16(sb, o + 2) * 16 + u16(sb, o);
    const len = u16(sb, o + 4);
    if (start < table || start + len > sb.length) break;   // past the real entries
    clips.push(sb.subarray(start, start + len));
  }

  const events = [];
  const stack = [];
  let si = script, t = 0, S = 0, R = 0, clip = 0;
  for (let guard = 0; guard < 100000; guard++) {
    const op = sb[si++];
    if (op >= 0x20) {
      const rate = u16(player, 0x2992 + (op - 0x20));
      events.push({ tick: t, clip, rateHz: Math.floor(rate * (256 + bias) / 256) });
      t += (S + 1) * (R + 1);
    } else if (op === 0x00) R = sb[si++];
    else if (op === 0x02) S = sb[si++];
    else if (op === 0x07) clip = sb[si++];
    else if (op === 0x01) t += (S + 1) * (R + 1);
    else if (op === 0x04) {
      const n = sb[si++];
      if (n < seqCount) { stack.push(si); si = u16(sb, 4 + 4 * n); }
    } else if (op === 0x05) {
      if (!stack.length) return { clips, events, endTick: t };
      si = stack.pop();
    } else {
      /* 03 (loop forever) and the rarer opcodes (06 slide, 08 halt, ...)
       * are not used by the shipped file; refuse rather than guess. */
      throw new Error(`PDEMOSB4 opcode 0x${op.toString(16)} at 0x${(si - 1).toString(16)} not ported`);
    }
  }
  throw new Error('PDEMOSB4 script did not terminate');
}
