/* hiscores.js — HISCORES.BIN's "TOP TEN GODS" table: the 20-byte record
 * format, the 1-based name alphabet (shared with the password/name-entry
 * letter grid, game/title-menu.js's `GRID_CELLS`), and the insertion-sort
 * ranking a new score goes through.
 *
 * FORMAT, `[PROVEN]` — see Gods/docs/dynamic-trace-and-runtime-data.md's own
 * "HISCORES.BIN decoded" section and its later correction:
 *
 *   216 bytes total = 10 x 20-byte records, then a 16-byte trailing block.
 *   Each record: { name: 16 bytes, 1-based alphabet, 0-padded ;
 *                  score: 4 bytes, PACKED BCD, big-endian }.
 *
 * ⚠️ CORRECTED, a later session (while building this module): the ORIGINAL
 * pass here had read the split as 18+2 (a plain u16 LE score) — the true
 * boundary is 16+4, and the score is packed BCD, not binary. The value a
 * u16-LE misreading of bytes 18-19 reports happens to survive for any score
 * whose top two BCD digits are zero (packed-BCD nibbles are hex-digit-
 * shaped by construction), which is exactly why the original pass's own
 * spot-check ("0x1978/0x7819") looked plausible without being right. Found
 * by reading this project's own real, locally-modified HISCORES.BIN: two
 * records there hold a full 16-character name (`AZQRXVX5ZRR.TM4`,
 * `AIQQQQBBBBBBBBB5` — the second is a DIFFERENT session's own leftover
 * test input, already on record in that doc) with ZERO padding before the
 * next field starts, which an 18-byte name could never produce. Confirmed
 * against every record in both that file and the pristine shipped one:
 * bytes 16-19 read as big-endian are all-BCD-nibble in every case. This
 * also matches `gods-web`'s own pre-existing, independently-arrived-at
 * `game/treasure.js` `Score` class — `SCORE_BYTES = 4`, packed BCD — the
 * SAME 4-byte encoding the live in-memory running score already uses; this
 * module just confirms it round-trips to disk unchanged, byte-reversed
 * (`Score.bytes[0]` is the low BCD pair; the on-disk field is big-endian,
 * high pair first).
 *
 * The trailing 16 bytes are the level-select password slots' own disk
 * round-trip (`docs/passwords.md`), XOR-obfuscated per field. Not modelled
 * here — `zones.js`'s `passwordSlots` already round-trips those three
 * separately (see main.js's own persistence, added alongside this module),
 * and HISCORES.BIN's own trailing block is otherwise `[PROVEN]` inert (the
 * load side decodes it but never compares or branches on it).
 */

/**
 * The 38-cell letter/digit/punctuation alphabet, 1-based (index 0 here is
 * code 1 = 'A'). Row-major order A-H/I-P/Q-X/Y-Z-.-space/0-9 — the SAME
 * order `title-menu.js`'s password/name-entry grid lays its cells out in
 * (GRID_CELLS there is built from this array plus its own two icon
 * sentinels, not duplicated). `docs/dynamic-trace-and-runtime-data.md`'s
 * hiscore-name-entry section: "a-z -> 1-26, 0-9 -> 0x1D-0x26(29-38), '.' ->
 * 0x1B(27), Space -> 0x1C(28)" — exactly this array's own 1-based indices.
 */
export const ALPHABET_CHARS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
  'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
  'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
  'Y', 'Z', '.', ' ', '0', '1', '2', '3',
  '4', '5', '6', '7', '8', '9',
];

/** char -> 1-based alphabet code (1..38), or 0 if not encodable (pad/terminator). */
export function charToCode(ch) {
  const i = ALPHABET_CHARS.indexOf(ch);
  return i < 0 ? 0 : i + 1;
}

/** 1-based alphabet code -> char, or '' for 0 (pad/terminator). */
export function codeToChar(code) {
  return code >= 1 && code <= ALPHABET_CHARS.length ? ALPHABET_CHARS[code - 1] : '';
}

export const NAME_BYTES = 16;    // corrected from 18 — see header
export const SCORE_BYTES = 4;
export const RECORD_BYTES = NAME_BYTES + SCORE_BYTES;   // 20
export const TABLE_RECORDS = 10;
export const TABLE_BYTES = RECORD_BYTES * TABLE_RECORDS;  // 200
export const TOTAL_BYTES = 216;  // + the 16-byte trailing (password) block

/**
 * @param {string} name up to NAME_BYTES characters, each in ALPHABET_CHARS
 * @returns {Uint8Array} NAME_BYTES bytes, 0-padded
 */
export function encodeName(name) {
  const out = new Uint8Array(NAME_BYTES);
  for (let i = 0; i < NAME_BYTES && i < name.length; i++) out[i] = charToCode(name[i]);
  return out;
}

/** @param {Uint8Array|number[]} bytes NAME_BYTES bytes -> a display string, stopping at the first 0. */
export function decodeName(bytes) {
  let s = '';
  for (let i = 0; i < NAME_BYTES; i++) {
    if (bytes[i] === 0) break;
    s += codeToChar(bytes[i]);
  }
  return s;
}

/**
 * A `game/treasure.js` `Score` (or any `{bytes: Uint8Array(4)}` with the
 * SAME low-pair-first packed-BCD layout) -> the on-disk big-endian 4 bytes.
 */
export function encodeScoreBytes(scoreBytes) {
  return Uint8Array.from([scoreBytes[3], scoreBytes[2], scoreBytes[1], scoreBytes[0]]);
}

/** The inverse of `encodeScoreBytes` — on-disk 4 bytes -> `Score.bytes` order. */
export function decodeScoreBytes(bytes) {
  return Uint8Array.from([bytes[3], bytes[2], bytes[1], bytes[0]]);
}

/** On-disk big-endian packed-BCD 4 bytes -> a plain number, for display/comparison. */
export function bcdToNumber(bytes) {
  let v = 0;
  for (let i = 0; i < SCORE_BYTES; i++) v = v * 100 + (bytes[i] >> 4) * 10 + (bytes[i] & 0x0f);
  return v;
}

/**
 * CS:0x339B-0x33B7 (`FUN_1000_3397`, the hiscore table's own score-column
 * drawer, full disassembly): 4 bytes, HIGH nibble then low nibble each,
 * bytes read in on-disk (big-endian) order — i.e. exactly the 8 decimal
 * digits of `bcdToNumber`'s own result, MSB first, with genuine leading
 * ZERO digits (this loop always draws all 8 positions; there is no
 * suppress-leading-zeros branch anywhere in it). NOT the same as
 * `String(bcdToNumber(bytes)).padStart(8, ' ')` — that pads with spaces
 * and would misrepresent what the original actually draws for any score
 * under 10000000 (every shipped score, in practice).
 */
export function bcdDigitString(bytes) {
  let s = '';
  for (let i = 0; i < SCORE_BYTES; i++) { s += (bytes[i] >> 4).toString(); s += (bytes[i] & 0x0f).toString(); }
  return s;
}

/** The inverse of `bcdToNumber` — a plain number -> on-disk big-endian packed-BCD 4 bytes. */
export function numberToBcdBytes(n) {
  const out = new Uint8Array(SCORE_BYTES);
  let v = Math.max(0, n | 0);
  for (let i = SCORE_BYTES - 1; i >= 0; i--) {
    out[i] = ((Math.floor(v / 10) % 10) << 4) | (v % 10);
    v = Math.floor(v / 100);
  }
  return out;
}

/**
 * The true shipped defaults — `git show HEAD:HISCORES.BIN` in the `Gods`
 * repo, decoded and cross-checked against `Gods/docs/dynamic-trace-and-
 * runtime-data.md`'s own already-published table: 9 Greek deity/hero names
 * plus one generic placeholder (`AAAAAA`, the only non-zero score).
 *
 * ⚠️ NOT read from `Gods/HISCORES.BIN` at runtime, deliberately — unlike
 * every other shipped asset this port fetches, that file is mutable
 * runtime state the project's own DOSBox sessions have already overwritten
 * with real play data (see that repo's own git history), so its CURRENT
 * working-tree content is this developer machine's own save, not the
 * floppy's real defaults. Hardcoded here instead, from the git-tracked
 * pristine version, so gods-web's own "first launch" table is stable and
 * reproducible regardless of what any contributor's local Gods checkout
 * happens to hold. See `tools/copy-assets.mjs`'s own citation for the
 * same reasoning applied to why this file is NOT in its `WANTED` list.
 */
export const DEFAULT_TABLE = Object.freeze([
  { name: 'AAAAAA', score: 7819 },
  { name: 'HERACLES', score: 0 },
  { name: 'ZEUS', score: 0 },
  { name: 'HERA', score: 0 },
  { name: 'APOLLO', score: 0 },
  { name: 'POSEIDON', score: 0 },
  { name: 'DIONYSUS', score: 0 },
  { name: 'ARES', score: 0 },
  { name: 'ATHENA', score: 0 },
  { name: 'HERMES', score: 0 },
].map(({ name, score }) => ({ name, score, scoreBytes: numberToBcdBytes(score) })));

/**
 * @param {Uint8Array} bytes TOTAL_BYTES (216), or at least TABLE_BYTES (200)
 * @returns {Array<{name:string, scoreBytes:Uint8Array, score:number}>} TABLE_RECORDS entries
 */
export function decodeHiscores(bytes) {
  const table = [];
  for (let i = 0; i < TABLE_RECORDS; i++) {
    const o = i * RECORD_BYTES;
    const nameBytes = bytes.subarray(o, o + NAME_BYTES);
    const scoreBytes = bytes.subarray(o + NAME_BYTES, o + RECORD_BYTES);
    table.push({ name: decodeName(nameBytes), scoreBytes: Uint8Array.from(scoreBytes),
                 score: bcdToNumber(scoreBytes) });
  }
  return table;
}

/**
 * CS:0x329A-0x32B6 — insert-and-shift-down. A new entry ranked at `index`
 * (0..9, found by the caller: the first slot whose score is <= the new
 * one, or 9 if it belongs last / doesn't qualify at all) displaces that
 * slot and everything below it shifts down one, dropping the old slot 9.
 * `table` is mutated in place and also returned.
 * @param {Array} table TABLE_RECORDS entries, as `decodeHiscores` returns
 * @param {number} index 0..TABLE_RECORDS-1
 * @param {{name:string, scoreBytes:Uint8Array, score:number}} entry
 */
export function insertAt(table, index, entry) {
  for (let i = table.length - 1; i > index; i--) table[i] = table[i - 1];
  table[index] = entry;
  return table;
}

/**
 * Where a `score` would rank against `table` (already sorted, as the
 * shipped/live table always is) — the same "any of the 10 slots" reach
 * `FUN_1000_3211`'s own shift loop has (`UNKNOWN_hiscores_score_distribution`,
 * CLOSED). @returns {number} 0..TABLE_RECORDS-1 (insertion index), or -1 if
 * `score` doesn't beat the last-place entry at all.
 */
export function rankOf(table, score) {
  for (let i = 0; i < table.length; i++) if (score > table[i].score) return i;
  return -1;
}
