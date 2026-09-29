/* hero-sheet.mjs — render the exact sprites the port selects, so the state ->
 * sprite mapping can be LOOKED AT rather than only asserted.
 *
 * Each row is one action; each cell is what `spriteFor(state, phase)` returns
 * for that action, cut from the atlas the cumulative descriptor map points at.
 * If the numbering, the sign extension or the remap table were wrong, this
 * sheet would show font glyphs, monsters or garbage instead of a warrior.
 *
 * Usage: node tools/hero-sheet.mjs [out.ppm]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(here, '..');
const out  = process.argv[2] || '/tmp/gods_hero.ppm';

const { dclDecompress }  = await import('../src/formats/dcl.js');
const { decodePI1 }      = await import('../src/formats/pi1.js');
const { parseAtlas, cutFrame } = await import('../src/formats/atlas.js');
const { buildDescriptorMap, GROUP_STEMS } = await import('../src/formats/descriptors.js');
const { spriteFor, STATE_INFO, jumpPhase, LADDER_JUMP_PHASE } = await import('../src/game/states.js');

const raw = (n) => {
  const p = join(ROOT, 'game', n);
  if (!existsSync(p)) throw new Error(`missing ${n} — put the game files in game/`);
  return new Uint8Array(readFileSync(p));
};

const atlases = {}, images = {};
for (const s of GROUP_STEMS.always) {
  atlases[s] = parseAtlas(dclDecompress(raw(`${s}.DAT`)).data);
  images[s]  = decodePI1(dclDecompress(raw(`${s}.PI1`)).data);
}
const { map } = buildDescriptorMap(['always'], (s) => atlases[s].count);

/* Exactly the (state, phase) pairs main.js can emit. */
const ROWS = [
  ['walk left  (state 0, 8-frame cycle)',  [0,1,2,3,4,5,6,7].map((p) => [0, p])],
  ['walk right (state 1, 8-frame cycle)',  [0,1,2,3,4,5,6,7].map((p) => [1, p])],
  ['stop-left / idle / stop-right',        [[26, 0xff], [26, 0], [26, 0x01]]],
  ['jump L / jump R / fall L / fall R / climb',
                                           [[8,0],[9,0],[11,0],[12,0],[14,0]]],
];
/* The jump ANIMATION, run through the real phase chain rather than sampled at
 * phase 0 — the sequence is what a reader needs to see. */
const jumpRow = (st, start, label) => {
  let cl = start, cur = 0; const pairs = [];
  for (let i = 0; i < 6; i++) { cl = jumpPhase(st, cl, cur); pairs.push([st, cl]); cur += 2; }
  return [label, pairs];
};
ROWS.push(jumpRow(8, 0, 'jump left, ground take-off'));
ROWS.push(jumpRow(9, 0, 'jump right, ground take-off'));
ROWS.push(jumpRow(8, LADDER_JUMP_PHASE[8], 'jump left, OFF A LADDER (phase 0x0D)'));
ROWS.push(jumpRow(9, LADDER_JUMP_PHASE[9], 'jump right, OFF A LADDER (phase 0x0C)'));

const CELL_W = 40, CELL_H = 56, PAD = 4;
const cols = Math.max(...ROWS.map((r) => r[1].length));
const W = cols * CELL_W + PAD, H = ROWS.length * CELL_H + PAD;
const idx = new Uint8Array(W * H);

const report = [];
ROWS.forEach(([label, pairs], r) => {
  const line = [];
  pairs.forEach(([st, ph], c) => {
    const id = spriteFor(st, ph);
    const d = map[id];
    const f = atlases[d.stem].frames[d.frame];
    const px = cutFrame(images[d.stem], f);
    const ox = c * CELL_W + PAD, oy = r * CELL_H + PAD;
    for (let y = 0; y < f.h && oy + y < H; y++) {
      for (let x = 0; x < f.w && ox + x < W; x++) {
        const v = px[y * f.w + x];
        if (v) idx[(oy + y) * W + ox + x] = v;
      }
    }
    const signed = ((ph & 0xff) << 24) >> 24;
    line.push(`ph${signed >= 0 ? '+' : ''}${signed}=#${id}(${d.stem}[${d.frame}] ${f.w}x${f.h})`);
  });
  report.push(`${label}\n    ${line.join('  ')}`);
});

const pal = images.PALWAYS1.palette;
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < idx.length; i++) {
  const c = idx[i] * 4;
  buf[i * 3] = pal[c]; buf[i * 3 + 1] = pal[c + 1]; buf[i * 3 + 2] = pal[c + 2];
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), buf]));

console.log(`hero sheet ${W}x${H} -> ${out}\n`);
for (const r of report) console.log('  ' + r + '\n');
console.log(`  state labels: ${[0,1,26,8,9,11,12,14].map((s) => `${s}=${STATE_INFO[s].label}`).join(', ')}`);
