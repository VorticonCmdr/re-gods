/* dcl.js — PKWARE Data Compression Library ("implode" / blast) decompressor.
 *
 * PROVENANCE
 *   Every one of the 119 `P`-prefixed files in the GODS DOS release is DCL
 *   compressed. All begin with the two header bytes `00 06` = literal mode 0
 *   (uncoded literals), dictionary size 6 (4096 bytes).
 *   UNPACK.EXE embeds the string:
 *     "PKWARE Data Compression Library(tm) Copyright 1990-91 PKWARE Inc. Version 1.02"
 *   and GAME.EXE loads it as a DOS overlay (INT 21h AX=4B03h at 1000:28f7).
 *   Verified: 119/119 files decompress and consume their input exactly, with
 *   zero trailing bytes.
 *
 *   This is a direct transliteration of the project's verified `blast.py`,
 *   which is itself a port of zlib's contrib/blast.c. The tables below are
 *   the canonical PKWARE Huffman length tables in blast.c's compact
 *   run-length form: each byte encodes (count-1) << 4 | bit_length.
 */

/* Length codes: base value and number of extra bits. blast.c `base`/`extra`. */
const LEN_BASE  = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0,  1,  2,  3,  4,  5,  6,   7,   8];

/* Compact bit-length tables, verbatim from blast.c. */
const LITLEN = [
  11,124,8,7,28,7,188,13,76,4,10,8,12,10,12,10,8,23,8,9,7,6,7,8,7,6,55,8,23,24,
  12,11,7,9,11,12,6,7,22,5,7,24,6,11,9,6,7,22,7,11,38,7,9,8,25,11,8,11,9,12,8,
  12,5,38,5,38,5,11,7,5,6,21,6,10,53,8,7,24,10,27,44,253,253,253,252,252,252,
  13,12,45,12,45,12,61,12,45,44,173,
];
const LENLEN  = [2, 35, 36, 53, 38, 23];
const DISTLEN = [2, 20, 53, 230, 247, 151, 248];

/* Expand the compact run-length form into a flat per-symbol bit-length list. */
function expand(rep) {
  const out = [];
  for (const b of rep) {
    const len = b & 15, run = (b >> 4) + 1;
    for (let i = 0; i < run; i++) out.push(len);
  }
  return out;
}

/* Canonical Huffman decode table: count[] per length, symbol[] in order. */
function buildHuffman(lengths) {
  const count = new Int32Array(16);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const offs = new Int32Array(16);
  let s = 0;
  for (let l = 1; l < 16; l++) { offs[l] = s; s += count[l]; }
  const symbol = new Int32Array(lengths.length);
  for (let sym = 0; sym < lengths.length; sym++) {
    const l = lengths[sym];
    if (l) symbol[offs[l]++] = sym;
  }
  return { count, symbol };
}

const LIT_H  = buildHuffman(expand(LITLEN));
const LEN_H  = buildHuffman(expand(LENLEN));
const DIST_H = buildHuffman(expand(DISTLEN));

/* LSB-first bit reader over a Uint8Array. */
class BitReader {
  constructor(data) { this.d = data; this.p = 0; this.buf = 0; this.cnt = 0; }
  bits(need) {
    let val = this.buf;
    while (this.cnt < need) {
      if (this.p >= this.d.length) throw new Error('DCL: out of input');
      val |= this.d[this.p++] << this.cnt;
      this.cnt += 8;
    }
    this.buf = val >>> need;
    this.cnt -= need;
    return val & ((1 << need) - 1);
  }
  /* PKWARE codes are stored inverted and bit-reversed; hence the `^ 1`. */
  decode(h) {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1) ^ 1;
      const cnt = h.count[len];
      if (code < first + cnt) return h.symbol[index + (code - first)];
      index += cnt;
      first = (first + cnt) << 1;
      code <<= 1;
    }
    throw new Error('DCL: invalid code');
  }
}

/**
 * Decompress a PKWARE DCL stream.
 * @param {Uint8Array} data raw file bytes, starting at the 2-byte header
 * @returns {{data: Uint8Array, litFlag: number, dictSize: number, consumed: number}}
 */
export function dclDecompress(data) {
  const br = new BitReader(data);
  const litFlag  = br.bits(8);   // 0 = uncoded literals (all GODS assets)
  const dictSize = br.bits(8);   // 4..6 -> 1024/2048/4096-byte window
  if (dictSize < 4 || dictSize > 6) {
    throw new Error(`DCL: bad dictionary size ${dictSize}`);
  }

  /* Grow-on-demand output. GODS assets top out around 32 KB. */
  let out = new Uint8Array(1 << 16);
  let n = 0;
  const push = (b) => {
    if (n === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[n++] = b;
  };

  for (;;) {
    if (br.bits(1)) {
      /* length/distance pair */
      const sym = br.decode(LEN_H);
      const length = LEN_BASE[sym] + (LEN_EXTRA[sym] ? br.bits(LEN_EXTRA[sym]) : 0);
      if (length === 519) break;              // end-of-stream marker
      const nbits = (length === 2) ? 2 : dictSize;
      const dist = ((br.decode(DIST_H) << nbits) | br.bits(nbits)) + 1;
      if (dist > n) throw new Error('DCL: distance before start of output');
      for (let i = 0; i < length; i++) push(out[n - dist]);
    } else {
      /* literal */
      push(litFlag ? br.decode(LIT_H) : br.bits(8));
    }
  }

  return {
    data: out.subarray(0, n),
    litFlag,
    dictSize,
    /* bytes of input actually touched — used to assert "consumes input exactly" */
    consumed: br.p,
  };
}

/** Fetch a `P`-prefixed asset and DCL-decompress it. */
export async function loadPacked(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const raw = new Uint8Array(await res.arrayBuffer());
  const r = dclDecompress(raw);
  return { ...r, rawLength: raw.length, url };
}
