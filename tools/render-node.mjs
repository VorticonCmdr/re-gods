/* render-node.mjs — render a level to a PPM using the port's own modules.
 *
 * This exists so the render path can be checked without a browser: same
 * DCL decoder, same PI1 decoder, same tile slicing, same palette source.
 * Usage: node tools/render-node.mjs [levelKey] [outFile]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB  = resolve(here, '..', 'public');

const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1, sliceTiles, TILE_W, TILE_H } = await import('../src/formats/pi1.js');
const { parseMap, MAP_COLS, MAP_ROWS } = await import('../src/formats/map.js');

const key = process.argv[2] || '1A';
const out = process.argv[3] || `/tmp/gods_${key}.ppm`;

const raw = (n) => {
  const p = join(PUB, 'game', n);
  if (!existsSync(p)) throw new Error(`missing ${n} — run: npm run assets`);
  return new Uint8Array(readFileSync(p));
};

const map   = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
const sheet = decodePI1(dclDecompress(raw(`PBITS${key}.PI1`)).data);
const tiles = sliceTiles(sheet);
const pal   = decodePI1(dclDecompress(raw(`PLEVEL${key}.PI1`)).data).palette;

/* Render the whole 4096x1024 world at 1:1 — big, but it makes tiling errors
 * obvious in a way a 320x200 window would not. */
const W = MAP_COLS * TILE_W, H = MAP_ROWS * TILE_H;
const idx = new Uint8Array(W * H);
let missing = 0;
for (let row = 0; row < MAP_ROWS; row++) {
  for (let col = 0; col < MAP_COLS; col++) {
    const n = map.planeA[row * MAP_COLS + col];
    if (n === 0) continue;
    const t = tiles[n - 1];        // plane A is 1-BASED: export 0 does 64*(B-1)
    if (!t) { missing++; continue; }
    const ox = col * TILE_W, oy = row * TILE_H;
    for (let y = 0; y < TILE_H; y++) {
      const d = (oy + y) * W + ox, s = y * TILE_W;
      for (let x = 0; x < TILE_W; x++) { const v = t[s + x]; if (v) idx[d + x] = v; }
    }
  }
}

const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < idx.length; i++) {
  const c = idx[i] * 4;
  px[i * 3] = pal[c]; px[i * 3 + 1] = pal[c + 1]; px[i * 3 + 2] = pal[c + 2];
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), px]));

const nonEmpty = idx.reduce((a, v) => a + (v ? 1 : 0), 0);
console.log(`PLEV${key}: ${W}x${H}, ${(100 * nonEmpty / idx.length).toFixed(1)}% non-empty pixels, ` +
            `${missing} cells with tile index >= 120 -> ${out}`);
