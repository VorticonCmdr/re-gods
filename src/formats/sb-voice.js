/* sb-voice.js — decodes PDEMOSB4.SB: INTROV.EXE's Sound-Blaster-only
 * digitized voice sample, layered under `godmus2.mus` when `GODS.INI`
 * selects Sound Blaster (execution-and-boot.md's "intro sound-file list").
 *
 * Format `[PROVEN]`, decoded by disassembling PPLAYER.BIN (the shared sound
 * driver both `music-player.js` and this module trace back to) in Ghidra
 * AND cross-checking every finding live in DOSBox — not from the byte shape
 * alone. The decompressed blob (`blast.py`) is a tiny directory over one or
 * more embedded clips, read by `FUN_0000_22f9` in PLAYER.BIN's own address
 * space:
 *   byte 0        clip count (1 for PDEMOSB4.SB — a single voice line)
 *   byte 1..3     unused padding (not read by the loader)
 *   per clip i, at offset 4 + i*4 (4 bytes, all little-endian):
 *     u16  dataStart   byte offset into THIS SAME blob where the clip's
 *                      raw PCM begins (8 for PDEMOSB4.SB's one clip — right
 *                      after the 8-byte count+directory header)
 *     u8   stateByte   copied verbatim to the driver's own state variable
 *                      (0xFF for PDEMOSB4.SB's clip; not otherwise decoded)
 *     u8   param       copied to a second driver scratch byte (0xFC for
 *                      PDEMOSB4.SB's clip; not otherwise decoded)
 * A clip's raw PCM runs from its own `dataStart` to the next clip's
 * `dataStart` (or EOF for the last clip) — the directory carries no
 * explicit length field, only start offsets.
 *
 * Sample data is 8-bit UNSIGNED mono PCM (confirmed by this project's own
 * already-`[PROVEN]` byte-histogram read of PDEMOSB4.SB: mean 127.76≈128,
 * silence-biased, smooth — see drivers-and-memory.md's `PGOD0x.PAT` closure,
 * which uses PDEMOSB4.SB as its own "what real 8-bit PCM looks like"
 * reference sample).
 *
 * SAMPLE RATE `[PROVEN]` live in DOSBox, not merely read out of the file
 * (the file itself carries no rate field at all — the rate is a driver-side
 * constant baked into PLAYER.BIN, applied uniformly to every clip). Booted
 * `GODS.EXE`->`INTROV.EXE` with `GODS.INI` set to Sound Blaster, located
 * PLAYER.BIN's own DSP-command-write primitive live (a fixed, position-
 * independent byte signature — the routine never embeds its own load
 * segment, just the hardwired I/O port 0x22C — found via `mem_scan` at
 * physical 0x293F3, giving a live load segment of 0x26BE), and set an
 * execute breakpoint on its `OUT DX,AL` instruction. Live command sequence,
 * confirmed across three streamed blocks:
 *   0xD1                    "speaker on" (once, at stream start)
 *   0x40, 0xA0               "set time constant" = 0xA0 (160 decimal) —
 *                             STABLE across every block observed
 *   0x14, 0x39, 0x00          "8-bit single-cycle DMA output", length-1 =
 *                             0x0039 = 57 -> 58-byte block, re-issued once
 *                             per DMA-complete interrupt (this is a
 *                             STREAMED playback, not one large DMA transfer)
 * The standard Sound Blaster DSP formula (confirmed live at PLAYER.BIN's
 * own `SetupSbPlayback`, `0000:2667` in the `/PLAYER.BIN` Ghidra project:
 * `AX = 1000000 / rateHz; timeConstant = -AX` truncating 8-bit) gives, for
 * timeConstant=0xA0=160: `1000000 / (256 - 160) = 1000000 / 96 ≈ 10416.67`.
 * The driver's own REQUESTED rate (read live from its `[rate]` parameter
 * word, DS:0x294C at the same live segment) is 10383 — the ~0.3% gap
 * between the two is the same integer-truncation rounding the original
 * code itself accepts, not a decode error on this project's part. This
 * port uses the achieved hardware rate (10417, rounded) since that is what
 * a real Sound Blaster actually played back, not the driver's pre-rounding
 * request.
 *
 * `UNKNOWN_sb_voice_stream_end`: not chased down this pass — whether
 * playback runs to the clip's own natural end-of-buffer or is cut short by
 * the intro's own credits-timing logic advancing past the Sound-Blaster
 * card. This port just plays the whole decoded clip once.
 */

export const SB_VOICE_SAMPLE_RATE_HZ = 10417; // 1_000_000 / (256 - 0xA0), rounded — see header

/**
 * @param {Uint8Array} bytes  DCL-decompressed PDEMOSB4.SB (blast.py/dclDecompress's `.data`).
 * @returns {{ count: number, clips: Array<{ dataStart: number, stateByte: number, param: number, pcm: Uint8Array }> }}
 */
export function parseSbVoice(bytes) {
  const count = bytes[0];
  const clips = [];
  for (let i = 0; i < count; i++) {
    const entryOff = 4 + i * 4;
    const dataStart = bytes[entryOff] | (bytes[entryOff + 1] << 8);
    const stateByte = bytes[entryOff + 2];
    const param = bytes[entryOff + 3];
    const nextDataStart = i + 1 < count
      ? (bytes[entryOff + 4] | (bytes[entryOff + 5] << 8))
      : bytes.length;
    clips.push({ dataStart, stateByte, param, pcm: bytes.subarray(dataStart, nextDataStart) });
  }
  return { count, clips };
}
