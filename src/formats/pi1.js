/* pi1.js — Atari ST DEGAS low-resolution bitmap decoder.
 *
 * PROVENANCE
 *   Every `.PI1` in the release decompresses to EXACTLY 32034 bytes:
 *       2-byte resolution word + 16 palette words (32 B) + 32000 B bitmap.
 *   32000 = 320 * 200 * 4 planes / 8. A fifth plane would require 40000 bytes,
 *   so the "5th collision bitplane" claim made by some sources is impossible
 *   for these files — the bytes do not exist.
 *   Resolution word is 0x0000 (low res) in every file, and all 16 palette
 *   words are 0x0RGB with every nibble <= 7 — Atari ST 3-bit-per-channel.
 *
 *   Plane order: plane 0 is the LEAST significant bit. This is PROVEN by a
 *   control experiment, not assumed: re-decoding PGODFONT with the plane
 *   order reversed keeps the glyphs perfectly legible (geometry is invariant
 *   under plane permutation) but collapses the smooth gold gradient into
 *   bands. Legibility alone would not have distinguished the two.
 *
 *   The DOS port ships the original ST artwork unconverted; GAME.EXE's
 *   graphics driver converts ST planar -> EGA planar at load time
 *   (export 3), and that routine contains NO byte swap — ST word bit 15 is
 *   the leftmost pixel, which is already VGA planar byte order, so the
 *   endianness cancels.
 */

export const PI1_SIZE      = 32034;
export const PI1_HEADER    = 34;      // resolution word + 16 palette words
export const SCREEN_W      = 320;
export const SCREEN_H      = 200;
export const ST_ROW_BYTES  = 160;     // 320 px * 4 planes / 8

/**
 * Decode a decompressed .PI1 image.
 * @param {Uint8Array} buf exactly 32034 bytes
 * @returns {{palette: Uint8Array, paletteRaw: Uint16Array,
 *            indices: Uint8Array, width: number, height: number}}
 *   palette   — 16 * 4 bytes RGBA, 8-bit per channel
 *   paletteRaw— the 16 original 0x0RGB words
 *   indices   — 320*200 palette indices, row-major
 */
export function decodePI1(buf) {
  if (buf.length !== PI1_SIZE) {
    throw new Error(`PI1: expected ${PI1_SIZE} bytes, got ${buf.length}`);
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const resolution = dv.getUint16(0, false);   // big-endian; 0 = low res
  if (resolution !== 0) {
    throw new Error(`PI1: expected low-res (0), got ${resolution}`);
  }

  const paletteRaw = new Uint16Array(16);
  const palette = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    const w = dv.getUint16(2 + i * 2, false);
    paletteRaw[i] = w;
    /* ST palette: 0000 0RRR 0GGG 0BBB, 3 bits per channel (0..7).
     * Scale 0..7 -> 0..255 exactly at both endpoints: round(v * 255 / 7). */
    const r = (w >> 8) & 7, g = (w >> 4) & 7, b = w & 7;
    palette[i * 4 + 0] = Math.round((r * 255) / 7);
    palette[i * 4 + 1] = Math.round((g * 255) / 7);
    palette[i * 4 + 2] = Math.round((b * 255) / 7);
    palette[i * 4 + 3] = 255;
  }

  /* ST word-interleaved planar -> chunky indices.
   * Each 8-byte group covers 16 pixels: plane0 word, plane1, plane2, plane3.
   * Within a plane word, bit 15 is the LEFTMOST pixel. */
  const indices = new Uint8Array(SCREEN_W * SCREEN_H);
  let src = PI1_HEADER;
  let dst = 0;
  for (let y = 0; y < SCREEN_H; y++) {
    for (let group = 0; group < SCREEN_W / 16; group++) {
      const p0 = (buf[src] << 8) | buf[src + 1];
      const p1 = (buf[src + 2] << 8) | buf[src + 3];
      const p2 = (buf[src + 4] << 8) | buf[src + 5];
      const p3 = (buf[src + 6] << 8) | buf[src + 7];
      src += 8;
      for (let bit = 15; bit >= 0; bit--) {
        const m = 1 << bit;
        indices[dst++] =
          ((p0 & m) ? 1 : 0) |          // plane 0 = LSB  (proven, see header)
          ((p1 & m) ? 2 : 0) |
          ((p2 & m) ? 4 : 0) |
          ((p3 & m) ? 8 : 0);
      }
    }
  }
  return { palette, paletteRaw, indices, width: SCREEN_W, height: SCREEN_H };
}

/* ---- tile sheets ------------------------------------------------------- */

/* PROVENANCE for the tile grid:
 *   Tiles are 32x16 px. Graphics export 17 (the tile-cache builder) clamps
 *   the tile index at 0x78 = 120, and 320/32 = 10 columns x 192/16 = 12 rows
 *   = exactly 120 tiles. A 16x16 grid would give 240 and contradict the
 *   clamp. Layout is ROW-MAJOR (col = N % 10, row = floor(N / 10));
 *   column-major is visibly wrong — it fragments every wall.
 *   Each map indexes its own sheet: PLEV<N><X>.MAP -> PBITS<N><X>.PI1.
 */
export const TILE_W = 32;
export const TILE_H = 16;
export const TILE_COLS = 10;
export const TILE_ROWS = 12;
export const TILE_COUNT = TILE_COLS * TILE_ROWS;   // 120, == export 17's 0x78

/**
 * Slice a decoded tile sheet into `TILE_COUNT` indexed tiles.
 * @returns {Uint8Array[]} each TILE_W*TILE_H palette indices
 */
export function sliceTiles(img) {
  const tiles = [];
  for (let n = 0; n < TILE_COUNT; n++) {
    const col = n % TILE_COLS;
    const row = (n / TILE_COLS) | 0;
    const t = new Uint8Array(TILE_W * TILE_H);
    const ox = col * TILE_W, oy = row * TILE_H;
    for (let y = 0; y < TILE_H; y++) {
      const s = (oy + y) * SCREEN_W + ox;
      t.set(img.indices.subarray(s, s + TILE_W), y * TILE_W);
    }
    tiles.push(t);
  }
  return tiles;
}
