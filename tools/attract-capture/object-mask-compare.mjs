/* object-mask-compare.mjs — Gods ranked item 63: the port's aliased objects
 * frames against live DOSBox captures, pixel for pixel.
 *
 * Each capture in mask63/ was taken by mask63_live.py with the tape stopped
 * and the camera at `cam`. For each object listed, the port's frame (built
 * the way main.js's loadSprites builds it, load mask applied) is drawn
 * through the level palette and compared in RGB with the capture: every
 * pixel the port draws must match, and the object's OWN unmasked frame is
 * compared too, as a control that must fail.
 *
 * It also checks the arena encoder against the live arena dumps.
 *
 * The mask63/*.bin arena dumps are git-ignored (raw bytes out of the
 * commercial binary's own memory) — recapture with mask63_live.py before
 * re-running the arena-encoder half of this check.
 *
 *   node tools/attract-capture/object-mask-compare.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const here = new URL('.', import.meta.url).pathname;
const root = new URL('../../', import.meta.url).pathname;
const { dclDecompress } = await import(root + 'src/formats/dcl.js');
const { decodePI1 } = await import(root + 'src/formats/pi1.js');
const { parseAtlas, cutFrame } = await import(root + 'src/formats/atlas.js');
const { buildDescriptorMap, GROUP_STEMS, LEVEL_LOAD_ORDER } = await import(root + 'src/formats/descriptors.js');
const { applyObjectLoadMask, encodeFrame16 } = await import(root + 'src/formats/object-mask.js');
const raw = (n) => new Uint8Array(readFileSync(root + 'game/' + n));

function sprites(world) {
  const groups = LEVEL_LOAD_ORDER(world), atl = {}, img = {};
  for (const g of groups) for (const s of GROUP_STEMS[g]) {
    atl[s] = parseAtlas(dclDecompress(raw(s + '.DAT')).data);
    img[s] = decodePI1(dclDecompress(raw(s + '.PI1')).data);
  }
  const { map, ranges } = buildDescriptorMap(groups, (s) => atl[s].count);
  const own = map.map((d) => { const f = atl[d.stem].frames[d.frame]; return { ...f, pixels: cutFrame(img[d.stem], f) }; });
  const frames = own.slice();
  const objs = ranges.filter((r) => r.group === 'objects');
  const res = applyObjectLoadMask(frames, objs[0].base, objs.reduce((n, r) => n + r.count, 0), world);
  return { own, frames, res };
}

/* The level palette: export 22's `level<N>` group, last file wins
 * (PLEVEL<N>B), with the slot-0/1 override (main.js PALETTE_SLOT01). */
function palette(world) {
  const p = decodePI1(dclDecompress(raw(`PLEVEL${world}B.PI1`)).data).palette.slice();
  [[0, 0, 0], [73, 146, 255]].forEach((c, i) => { p[4 * i] = c[0]; p[4 * i + 1] = c[1]; p[4 * i + 2] = c[2]; });
  return p;
}

const png = (f) => JSON.parse(execSync(`python3 -c "from PIL import Image;import json;im=Image.open('${f}').convert('RGB');print(json.dumps([list(p) for p in im.get_flattened_data()] if hasattr(im,'get_flattened_data') else [list(p) for p in im.getdata()]))"`, { maxBuffer: 1e8 }));

function diff(shot, pal, f, sx, sy) {
  let n = 0, bad = 0;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const v = f.pixels[y * f.w + x];
    if (!v && !(f.opaque0 && f.opaque0[y * f.w + x])) continue;
    const X = sx + x, Y = sy + y;
    if (X < 0 || Y < 0 || X >= 320 || Y >= 160) continue;
    n++;
    const s = shot[Y * 320 + X];
    if (Math.abs(s[0] - pal[4 * v]) > 4 || Math.abs(s[1] - pal[4 * v + 1]) > 4 || Math.abs(s[2] - pal[4 * v + 2]) > 4) bad++;
  }
  return { n, bad };
}

/* Object positions are the map's, except the world-4 flask, which falls
 * 7 px from its authored y 105 before it settles (DOS draws it at 112). */
const CAPTURES = [
  { file: 'w1b_type55.png', world: 1, cam: [36, 720], objs: [{ type: 55, x: 160, y: 752 },
    /* CS:0x1A58: type 55's second sprite, 16 px up, DS:0xdfe6[phase] = 316-318 */
    { id: 316, x: 160, y: 736 }] },
  { file: 'w1b_type62.png', world: 1, cam: [796, 415], objs: [{ type: 62, x: 1031, y: 448 }, { type: 62, x: 1095, y: 448 }] },
  { file: 'w2b_lever.png', world: 2, cam: [1208, 736], objs: [{ type: 24, x: 1350, y: 841 }] },
  { file: 'w4a_flask_lever.png', world: 4, cam: [3236, 108], objs: [{ type: 4, x: 3495, y: 112 }, { type: 24, x: 3403, y: 176 }] },
];

let fails = 0;
const cache = {};
for (const c of CAPTURES) {
  const s = (cache[c.world] ??= sprites(c.world));
  const pal = palette(c.world), shot = png(here + 'mask63/' + c.file);
  for (const o of c.objs) {
    const id = o.id ?? 170 + o.type, sx = o.x - c.cam[0], sy = o.y - c.cam[1];
    const port = diff(shot, pal, s.frames[id], sx, sy);
    const ctrl = diff(shot, pal, s.own[id], sx, sy);
    const ok = port.n > (o.id ? 40 : 100) && port.bad === 0 && ctrl.bad > 20;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.file} ${o.id ? 'sprite' : 'type ' + o.type} (#${id} -> #${s.frames[id].aliasOf ?? id})` +
      `  port ${port.n - port.bad}/${port.n}   own frame ${ctrl.n - ctrl.bad}/${ctrl.n}`);
  }
}

/* The encoder against the live arena: [file, offset, world, first id, count]. */
for (const [file, off, world, first, count] of [
  ['arena_w2_4c7a.bin', 0, 2, 198, 1], ['arena_w4_4c7a.bin', 0, 4, 204, 3], ['arena_w4_4bcc.bin', 0, 4, 175, 2]]) {
  const b = readFileSync(here + 'mask63/' + file).subarray(off);
  const s = (cache[world] ??= sprites(world));
  const enc = []; for (let i = 0; i < count; i++) enc.push(...encodeFrame16(s.own[first + i]));
  let bad = 0; for (let i = 0; i < Math.min(enc.length, b.length); i++) if (enc[i] !== b[i]) bad++;
  if (bad) fails++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${file}: encoded #${first}..#${first + count - 1}, ${Math.min(enc.length, b.length)} bytes, ${bad} differ`);
}
for (const w of [1, 2, 3, 4]) {
  const s = (cache[w] ??= sprites(w));
  console.log(`world ${w}: ${s.res.aliased.length} aliased, unresolved (32-wide) ${s.res.unresolved.join(',') || 'none'}`);
}
process.exit(fails ? 1 : 0);
