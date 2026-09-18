/* dcl-encode.js — a correctness-first PKWARE DCL ("implode") encoder,
 * companion to dcl.js's decoder.
 *
 * PROVENANCE / DESIGN
 *   Every shipped GODS asset uses litFlag=0 (dcl.js's own header comment:
 *   "uncoded literals"), meaning a compressor doesn't need a literal-Huffman
 *   encoder at all — literal bytes are raw 8 bits. That makes a STORE-MODE
 *   encoder (every input byte emitted as a literal, no LZ77 matching)
 *   trivially spec-valid and always correctly decodable: it only has toget
 *   the bitstream framing right, not find good matches. This is what this
 *   file implements. It does NOT try to shrink the output — GODS assets are
 *   downloaded/mounted by a browser, not fit on a 720K floppy, so a ~12.5%
 *   size inflation (1 flag bit + 8 literal bits per input byte) has no
 *   functional cost here. Real LZ77 match-based compression is a possible
 *   follow-up for smaller files, not required for correctness.
 *
 *   The only Huffman coding this encoder ever emits is the single
 *   end-of-stream symbol (length code 15, the same one dcl.js's decoder
 *   recognizes as `length === 519 -> break`, BEFORE it ever reads a
 *   distance) — so only a length-code encoder is needed, never a
 *   distance-code encoder. Its canonical-code construction is derived
 *   directly from dcl.js's own `buildHuffman`/`decode()` shape (see
 *   `buildEncodeTable` below) so the two can't drift apart: encode and
 *   decode share the exact same LENLEN table and the exact same canonical
 *   numbering algorithm, just run in opposite directions.
 *
 *   `dclCompressStore` self-checks its own output by round-tripping it
 *   through the existing, already-verified `dclDecompress` before
 *   returning — a compressor that produced an undecodable stream would
 *   throw immediately, not ship a silently-broken file.
 */

import { dclDecompress } from './dcl.js';

/* Mirrors dcl.js's own compact run-length bit-length table for the length
 * Huffman tree (LENLEN) — duplicated as a literal here (not imported)
 * because it's `dcl.js`-internal; the shared regression test in
 * verify/checks.js is what keeps the two from silently diverging. */
const LENLEN = [2, 35, 36, 53, 38, 23];
function expand(rep) {
  const out = [];
  for (const b of rep) {
    const len = b & 15, run = (b >> 4) + 1;
    for (let i = 0; i < run; i++) out.push(len);
  }
  return out;
}

/**
 * Build a symbol -> {code, length} canonical-Huffman ENCODE table from a
 * flat per-symbol bit-length list, using the exact same canonical-code
 * construction dcl.js's `decode()` walks bit-by-bit (length-major, symbols
 * in increasing numeric order within a length). `code` is the length-bit
 * unsigned value read MSB-first — i.e. to emit it, write bit (length-1)
 * first, down to bit 0, each XORed with 1 (dcl.js's decode() does the same
 * `^1` on every bit it reads before accumulating it into its own `code`).
 */
function buildEncodeTable(lengths) {
  const count = new Int32Array(16);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const baseCodeAtLen = new Int32Array(16);
  const rankCursor = new Int32Array(16);
  {
    let first = 0;
    for (let len = 1; len < 16; len++) {
      baseCodeAtLen[len] = first;
      first = (first + count[len]) << 1;
    }
  }
  const table = new Map();
  for (let sym = 0; sym < lengths.length; sym++) {
    const l = lengths[sym];
    if (!l) continue;
    const rank = rankCursor[l]++;
    table.set(sym, { length: l, code: baseCodeAtLen[l] + rank });
  }
  return table;
}

const LEN_H_ENC = buildEncodeTable(expand(LENLEN));

/* LSB-first bit writer — the encode-side mirror of dcl.js's `BitReader`:
 * `writeBits(v, n)` packs `v`'s bits 0..n-1 into successive stream
 * positions, matching `BitReader.bits(n)`'s own `val & ((1<<n)-1)`
 * extraction of whatever was written first. */
class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.nbits = 0; }
  writeBit(bit) {
    this.cur |= (bit & 1) << this.nbits;
    if (++this.nbits === 8) { this.bytes.push(this.cur); this.cur = 0; this.nbits = 0; }
  }
  writeBits(value, count) {
    for (let i = 0; i < count; i++) this.writeBit((value >>> i) & 1);
  }
  /** Emit a Huffman-coded symbol per `buildEncodeTable`'s own convention —
   *  MSB first, each bit inverted, matching dcl.js `decode()`'s `^1`. */
  writeCoded(table, sym) {
    const { code, length } = table.get(sym);
    for (let i = length - 1; i >= 0; i--) this.writeBit(((code >>> i) & 1) ^ 1);
  }
  finish() {
    if (this.nbits > 0) { this.bytes.push(this.cur); this.cur = 0; this.nbits = 0; }
    return Uint8Array.from(this.bytes);
  }
}

const DICT_SIZE = 6;    // 4096-byte window — the convention every shipped asset uses
const EOF_SYMBOL = 15;  // LEN_BASE[15]=264, LEN_EXTRA[15]=8 -> 264+255 = 519, dcl.js's own EOF value

/**
 * Compress `data` into a valid, litFlag=0 (uncoded-literal) PKWARE DCL
 * stream — store mode, no LZ77 matching. Self-verifies by decompressing
 * its own output and comparing to the input before returning.
 * @param {Uint8Array} data
 * @returns {Uint8Array} a full DCL file (2-byte header + bitstream)
 */
export function dclCompressStore(data) {
  const bw = new BitWriter();
  bw.writeBits(0, 8);          // litFlag = 0 (uncoded literals)
  bw.writeBits(DICT_SIZE, 8);  // dictionary size code

  for (let i = 0; i < data.length; i++) {
    bw.writeBit(0);            // "literal" flag (dcl.js: `if (br.bits(1))` false branch)
    bw.writeBits(data[i], 8);  // raw 8-bit literal, uncoded (litFlag=0)
  }

  /* End-of-stream: pair flag, then length symbol 15 (base 264) with all-1
   * extra bits (255) -> length 519, which dcl.js recognizes and breaks on
   * BEFORE ever reading a distance — no distance encoding needed at all. */
  bw.writeBit(1);
  bw.writeCoded(LEN_H_ENC, EOF_SYMBOL);
  bw.writeBits(0xFF, 8);

  const out = bw.finish();

  const check = dclDecompress(out);
  if (check.data.length !== data.length || !check.data.every((b, i) => b === data[i])) {
    throw new Error('dclCompressStore: self-check failed — output does not decompress back to the input');
  }

  return out;
}
