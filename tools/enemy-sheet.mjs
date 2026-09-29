/* enemy-sheet.mjs — drive the real spawn chain on shipped level data and
 * render what comes out.
 *
 * The point is that this uses no synthetic input: it walks every plane-B cell
 * of a level, dispatches through the real EventRunner, activates the real
 * group slots, runs the real CS:0xec60 spawn loop, and composes sprites with
 * the real CS:0xf0ae formula. If any link is wrong the sheet shows font
 * glyphs or nothing at all.
 *
 * Usage: node tools/enemy-sheet.mjs [levelKey] [out.ppm]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(here, '..');
const key  = process.argv[2] || '1A';
const out  = process.argv[3] || `/tmp/gods_enemies_${key}.ppm`;
const world = +key[0];

const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1 } = await import('../src/formats/pi1.js');
const { parseMap } = await import('../src/formats/map.js');
const { parseAtlas, cutFrame } = await import('../src/formats/atlas.js');
const { buildDescriptorMap, GROUP_STEMS } = await import('../src/formats/descriptors.js');
const { parseGroupsB, GroupSlots, spriteForEntity, CLASS_TABLES_B,
        CREATURE_DESCRIPTOR_BASE, MAX_ENTITIES } = await import('../src/game/spawn.js');
const { EntityB, MODE_TABLE, groundBelow } = await import('../src/game/entity.js');
const { parsePalfils, palfilsNameFor, EventRunner } = await import('../src/game/events.js');

const raw = (n) => {
  const p = join(ROOT, 'game', n);
  if (!existsSync(p)) throw new Error(`missing ${n} — run: npm run assets`);
  return new Uint8Array(readFileSync(p));
};

const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
const pfRaw = raw(palfilsNameFor(key));
const palfils = parsePalfils(dclDecompress(pfRaw).data);
const groups = parseGroupsB(dclDecompress(pfRaw).data);

/* Sprite groups in load order: always(170) + objects(280) + level<N>. */
const atlases = {}, images = {};
for (const g of ['always', 'objects', `level${world}`]) {
  for (const s of GROUP_STEMS[g]) {
    atlases[s] = parseAtlas(dclDecompress(raw(`${s}.DAT`)).data);
    images[s]  = decodePI1(dclDecompress(raw(`${s}.PI1`)).data);
  }
}
const { map: dmap } = buildDescriptorMap(['always', 'objects', `level${world}`],
                                         (s) => atlases[s].count);
const frameFor = (id) => {
  const d = dmap[id];
  if (!d) return null;
  const f = atlases[d.stem].frames[d.frame];
  return { ...f, stem: d.stem, frame: d.frame, pixels: cutFrame(images[d.stem], f) };
};

/* Walk the hero over every plane-B cell that carries an event, through the
 * real dispatcher. Nothing here knows which cells are spawns. */
const runner = new EventRunner(map, palfils);
const activated = [];
runner.onSpawnB = (param) => { activated.push(param); };
for (let row = 0; row < 64; row++) {
  for (let col = 0; col < 128; col++) {
    if (map.planeB[row * 128 + col] < 3) continue;
    runner.lastCell = -1;
    runner.step(col * 32, row * 16, runner.makeState({ timer: 0 }));
  }
}

/* Activate and run the spawn loop, exactly as main.js does. */
const slots = new GroupSlots();
for (const p of activated) { const d = groups[p]; if (d && d.live) slots.activate(d); }
const enemies = [];
for (const slot of slots.slots) {
  if (slot.state !== 2) continue;
  const d = slot.desc;
  if (d.count === 0) continue;
  const x = d.tileX * 32, y = d.tileY * 16;
  const onGround = groundBelow(map.planeB, x, y);
  const mode = ((d.flags >> 9) & 1) + (onGround ? 0 : 2);
  let delay = 0;
  for (let i = 0; i < Math.min(d.count, MAX_ENTITIES); i++) {
    enemies.push(new EntityB({ x, y, mode, speed: d.speed, hp: d.hp || 1, cls: d.cls, delay }));
    delay += d.stagger;
  }
  slot.state = 1;
}

/* One sheet row per activated group: the walk cycle of its class, both ways. */
const ANIM = MODE_TABLE.map((m) => m.animBase);
const rows = [];
const seen = new Set();
for (const slot of slots.slots) {
  if (!slot.desc || seen.has(slot.desc.index)) continue;
  seen.add(slot.desc.index);
  const d = slot.desc;
  const cells = [];
  for (const mode of [0, 1]) {
    for (let fr = 0; fr < 8; fr++) {
      cells.push(spriteForEntity(world, d.cls, mode, fr, ANIM));
    }
  }
  rows.push({ d, cells });
}

const CELL = 40, PAD = 3;
const cols = Math.max(1, ...rows.map((r) => r.cells.length));
const W = cols * CELL + PAD, H = Math.max(1, rows.length) * CELL + PAD;
const idx = new Uint8Array(W * H);
let bad = 0;
rows.forEach((r, ri) => {
  r.cells.forEach((id, ci) => {
    if (id === null || id < CREATURE_DESCRIPTOR_BASE) { bad++; return; }
    const f = frameFor(id);
    if (!f) { bad++; return; }
    const ox = ci * CELL + PAD, oy = ri * CELL + PAD;
    for (let y = 0; y < f.h && oy + y < H; y++)
      for (let x = 0; x < f.w && ox + x < W; x++) {
        const v = f.pixels[y * f.w + x];
        if (v) idx[(oy + y) * W + ox + x] = v;
      }
  });
});

const pal = decodePI1(dclDecompress(raw(`PLEVEL${key}.PI1`)).data).palette;
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < idx.length; i++) {
  const c = idx[i] * 4;
  buf[i * 3] = pal[c]; buf[i * 3 + 1] = pal[c + 1]; buf[i * 3 + 2] = pal[c + 2];
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), buf]));

console.log(`PLEV${key}: ${activated.length} selector-4 activations -> ` +
            `${seen.size} distinct groups, ${enemies.length} entities, ` +
            `${slots.lostActivations} lost (all slots busy)`);
/* The "lost" figure is an ARTEFACT OF THIS TOOL, not a finding: it walks the
 * hero over every event cell in one pass, so every group activates at once
 * against ten slots. In play they trigger gradually and slots free as groups
 * are cleared. The original really does drop an activation when all ten are
 * busy (CS:0xde2a returns after the event is already consumed) — but you
 * would not see 28 of them. */
console.log(`sheet ${W}x${H} -> ${out}${bad ? `   (${bad} cells unrenderable)` : ''}\n`);
for (const r of rows) {
  const d = r.d;
  const f = frameFor(r.cells[0]);
  console.log(`  group ${String(d.index).padStart(2)}  count ${d.count}  hp ${d.hp}` +
              `  speed ${d.speed}  class ${d.cls} (base ${CLASS_TABLES_B[world][d.cls]?.base})` +
              `  tile ${d.tileX},${d.tileY} -> world ${d.tileX * 32},${d.tileY * 16}` +
              `  -> #${r.cells[0]} ${f ? `${f.stem}[${f.frame}] ${f.w}x${f.h}` : 'UNRENDERABLE'}`);
}
