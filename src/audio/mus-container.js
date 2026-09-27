/* mus-container.js — the `.MUS`/`.RL` container format.
 *
 * `Gods/docs/drivers-and-memory.md`'s "Music formats" section, `[PROVEN]` on
 * `PGODS.MUS`/`PMUSIC.MUS`/`PGODMUS2.MUS`/`PGODSRLA.RL`/`PTITLE.RL`:
 *
 *   u16 LE  count
 *   count × u32 LE  absolute offset (into this SAME decompressed buffer)
 *   u16     pad (80 00)
 *           ... concatenated blobs, back to back, no length prefix each ...
 *
 * A blob's own end is the NEXT blob's start offset (or EOF for the last),
 * exactly as `drivers-and-memory.md` verifies on `PGODS.MUS` (73 entries,
 * strictly increasing, last extent ending at the decompressed length).
 *
 * Extended this session (Gods/docs/drivers-and-memory.md's own music-format
 * section did not check this before): a full `MThd` census across every
 * shipped `.MUS`/`.RL` file. `PGODS.MUS` is the only one `GAME.EXE` itself
 * ever opens (its `pgods.mus`/`gods.mus` strings are the sole music-related
 * literals in `GAME.EXE`'s own bytes — confirmed by a raw byte regex scan,
 * not just `strings`, which misses table-referenced content). The other
 * ten files (`PMUSIC.MUS`, `PGODMUS2.MUS`, `PTITLE.RL`, `PGODSRLA`-`G.RL`)
 * belong to the pre-game INTRO executables (device-specific splash music)
 * or, for the seven `PGODSRLA`-`G.RL` files specifically, to NOTHING this
 * project has found a reference to at all — a raw regex scan of both
 * `GAME.EXE` and `TGAME.EXE` for the bare token "godsrl" (case-insensitive)
 * returns zero matches in either binary. So this module only needs to
 * handle `PGODS.MUS`'s own shape to be useful for actual gameplay.
 */

/** True iff `blob` opens with the 4-byte SMF magic `MThd`. */
export const isSmf = (blob) => (
  blob.length >= 4 && blob[0] === 0x4d && blob[1] === 0x54
  && blob[2] === 0x68 && blob[3] === 0x64
);

/**
 * The non-SMF blobs (`PGODS.MUS` 19/20/40, `PGODMUS2.MUS`'s only blob, and
 * index 21 of every `PGODSRL?.RL`) are NOT a different music format: they are
 * ordinary SMF files, WORD-DICTIONARY COMPRESSED. `Gods/docs/drivers-and-
 * memory.md`'s `UNKNOWN_mus_type2` closure has the full citation; in short,
 * `PPLAYER.BIN`'s own byte accessor (`0000:12e8`, taken whenever the tag
 * byte stored at `[bp+0x8b]` by `0000:13ac` is `'C'`/`'c'`) reads logical
 * byte `i` as
 *
 *     word = dict[ blob[0x201 + (i >> 1)] ],   dict = 256 × u16 LE at blob+1
 *     byte = (i & 1) ? word >> 8 : word & 0xff
 *
 * and `0000:13df`-`13e8` starts the stream at logical byte 1 for tag `'c'`,
 * 0 for `'C'` (the dictionary pairs bytes, so an odd-length SMF needs one
 * lead pad byte). Expanding that way yields `MThd`...`MTrk` directly — all 11
 * such blobs shipped in the game parse cleanly to End-of-Track.
 *
 * @param {Uint8Array} blob one container blob
 * @returns {?Uint8Array} the SMF bytes (the blob itself if already SMF), or
 *   null if the blob is neither shape
 */
export function expandBlob(blob) {
  if (isSmf(blob)) return blob;
  if (blob.length < 0x202 || (blob[0] !== 0x43 && blob[0] !== 0x63)) return null;
  const n = blob.length - 0x201;
  const out = new Uint8Array(2 * n);
  for (let k = 0; k < n; k++) {
    const v = blob[0x201 + k];
    out[2 * k] = blob[1 + 2 * v];
    out[2 * k + 1] = blob[2 + 2 * v];
  }
  const smf = out.subarray(blob[0] === 0x63 ? 1 : 0);
  return isSmf(smf) ? smf : null;
}

/**
 * Split a decompressed `.MUS`/`.RL` buffer into its blobs.
 * @param {Uint8Array} data the DCL-decompressed container bytes
 * @returns {Uint8Array[]} one subarray per blob, in container order
 */
export function parseMusContainer(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0, true);
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(view.getUint32(2 + 4 * i, true));
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const end = i + 1 < count ? offsets[i + 1] : data.length;
    blobs.push(data.subarray(offsets[i], end));
  }
  return blobs;
}
