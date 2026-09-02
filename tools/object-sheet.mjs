/* object-sheet.mjs — render every distinct object type that ships in the maps,
 * as the sprite `170 + type` resolves to, beside the NAME that type carries in
 * POBJECTS.
 *
 * This is the visual half of the proof. The arithmetic says a map object of
 * type t draws descriptor 170 + t; if that is right, the picture at 170 + t
 * must match the words at POBJECTS record t. A key must look like a key.
 *
 * Usage: node tools/object-sheet.mjs [world 1-4] [out.ppm]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB  = resolve(here, '..', 'public');
const world = +(process.argv[2] || 1);
const out   = process.argv[3] || `/tmp/gods_objects_${world}.ppm`;

const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1 } = await import('../src/formats/pi1.js');
const { parseMap } = await import('../src/formats/map.js');
const { parseAtlas, cutFrame } = await import('../src/formats/atlas.js');
const { buildDescriptorMap, GROUP_STEMS } = await import('../src/formats/descriptors.js');
const { spriteForType, isDeadType, STAMPED_TYPES } = await import('../src/game/objects.js');

const raw = (n) => {
  const p = join(PUB, 'game', n);
  if (!existsSync(p)) throw new Error(`missing ${n} — run: npm run assets`);
  return new Uint8Array(readFileSync(p));
};

const atlases = {}, images = {};
for (const g of ['always', 'objects']) {
  for (const s of GROUP_STEMS[g]) {
    atlases[s] = parseAtlas(dclDecompress(raw(`${s}.DAT`)).data);
    images[s]  = decodePI1(dclDecompress(raw(`${s}.PI1`)).data);
  }
}
const { map: dmap } = buildDescriptorMap(['always', 'objects'], (s) => atlases[s].count);

/* POBJECTS: 132 x 48-byte records, big-endian u16 id at +0, category at +4,
 * value at +6, then text. */
const pobj = dclDecompress(raw(`POBJECTS.00${world}`)).data;
const rec = (t) => {
  const r = pobj.subarray(t * 48, (t + 1) * 48);
  const be = (o) => (r[o] << 8) | r[o + 1];
  const text = [...r.subarray(8, 44)]
    .map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('')
    .replace(/\.+/g, ' ').trim();
  return { id: be(0), cat: be(4), value: be(6), text };
};

/* Every distinct type actually placed in this world's two maps. */
const seen = new Map();
for (const sub of ['A', 'B']) {
  const m = parseMap(dclDecompress(raw(`PLEV${world}${sub}.MAP`)).data);
  for (const o of m.objects) {
    if (isDeadType(o.type)) continue;
    seen.set(o.type, (seen.get(o.type) || 0) + 1);
  }
}
const types = [...seen.keys()].sort((a, b) => a - b);

const CELL = 40, COLS = 12, PAD = 3;
const rows = Math.ceil(types.length / COLS);
const W = COLS * CELL + PAD, H = rows * CELL + PAD;
const idx = new Uint8Array(W * H);

const lines = [];
types.forEach((t, i) => {
  const sid = spriteForType(t);
  const d = dmap[sid];
  const f = atlases[d.stem].frames[d.frame];
  const px = cutFrame(images[d.stem], f);
  const ox = (i % COLS) * CELL + PAD, oy = ((i / COLS) | 0) * CELL + PAD;
  for (let y = 0; y < f.h && oy + y < H; y++) {
    for (let x = 0; x < f.w && ox + x < W; x++) {
      const v = px[y * f.w + x];
      if (v) idx[(oy + y) * W + ox + x] = v;
    }
  }
  const r = t < STAMPED_TYPES ? rec(t) : null;
  lines.push(
    `  type ${String(t).padStart(3)} x${String(seen.get(t)).padStart(3)}` +
    ` -> #${String(sid).padStart(3)} ${d.stem}[${String(d.frame).padStart(3)}]` +
    ` ${String(f.w).padStart(3)}x${String(f.h).padStart(2)}` +
    (r ? `  id=${r.id} cat=${r.cat} val=${String(r.value).padStart(4)}  "${r.text}"`
       : '  (weapon pickup, no POBJECTS record)'));
});

const pal = decodePI1(dclDecompress(raw(`PLEVEL${world}A.PI1`)).data).palette;
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < idx.length; i++) {
  const c = idx[i] * 4;
  buf[i * 3] = pal[c]; buf[i * 3 + 1] = pal[c + 1]; buf[i * 3 + 2] = pal[c + 2];
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), buf]));

console.log(`world ${world}: ${types.length} distinct object types, sheet ${W}x${H} -> ${out}\n`);
for (const l of lines) console.log(l);

/* The self-test the arithmetic must pass: POBJECTS' own +0 field is
 * independently 170 + t, so it must agree with spriteForType for every
 * non-weapon type. Two producers of the same number. */
const mismatch = types.filter((t) => t < STAMPED_TYPES && rec(t).id !== spriteForType(t));
console.log(`\n  POBJECTS id == 170 + type on ` +
            `${types.filter((t) => t < STAMPED_TYPES).length - mismatch.length}/` +
            `${types.filter((t) => t < STAMPED_TYPES).length} non-weapon types` +
            (mismatch.length ? `  MISMATCH: ${mismatch.join(',')}` : ''));
