/* frame-node.mjs — render one 320x200 game frame headlessly: tilemap, hero
 * sprite and camera, using the port's own modules and the LEVEL palette.
 *
 * The hero atlas carries its own palette and the level palette comes from
 * PLEVEL<N><X>.PI1; the original has one hardware palette for everything, so
 * compositing the hero in level colours is a check on the palette source.
 *
 * Usage: node tools/frame-node.mjs [levelKey] [ticks] [out.ppm]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB  = resolve(here, '..', 'public');
const key   = process.argv[2] || '1A';
const ticks = +(process.argv[3] || 12);
const out   = process.argv[4] || `/tmp/gods_frame_${key}.ppm`;

const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1, sliceTiles, TILE_W, TILE_H, SCREEN_W, SCREEN_H } = await import('../src/formats/pi1.js');
const { parseMap, MAP_COLS, MAP_ROWS, TILE_COUNTS, CELL_SOLID } = await import('../src/formats/map.js');
const { parseAtlas, cutFrame } = await import('../src/formats/atlas.js');
const { buildDescriptorMap, GROUP_STEMS } = await import('../src/formats/descriptors.js');
const { spriteForType, parseObjectCategories, sortForDraw, isDeadType } = await import('../src/game/objects.js');
const { spriteFor, STATE_INFO } = await import('../src/game/states.js');
const { parseGroupsB, GroupSlots, spriteForEntity, MAX_ENTITIES,
        CREATURE_DESCRIPTOR_BASE } = await import('../src/game/spawn.js');
const { EntityB, MODE_TABLE, groundBelow } = await import('../src/game/entity.js');
const { parsePalfils, palfilsNameFor } = await import('../src/game/events.js');
const { Player } = await import('../src/game/player.js');
const { Camera } = await import('../src/game/camera.js');

const raw = (n) => {
  const p = join(PUB, 'game', n);
  if (!existsSync(p)) throw new Error(`missing ${n} — run: npm run assets`);
  return new Uint8Array(readFileSync(p));
};

const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
const pal = decodePI1(dclDecompress(raw(`PLEVEL${key}.PI1`)).data).palette;
const count = TILE_COUNTS[key];
let tiles = sliceTiles(decodePI1(dclDecompress(raw(`PBITS${key}.PI1`)).data)).slice(0, Math.min(count, 120));
if (count > 120) {
  tiles = tiles.concat(sliceTiles(decodePI1(dclDecompress(raw(`PXTRA${key}.PI1`)).data)).slice(0, count - 120));
}

const atlases = {}, images = {};
const world = +key[0];
for (const g of ['always', 'objects', `level${world}`]) {
  for (const s of GROUP_STEMS[g]) {
    atlases[s] = parseAtlas(dclDecompress(raw(`${s}.DAT`)).data);
    images[s]  = decodePI1(dclDecompress(raw(`${s}.PI1`)).data);
  }
}
const { map: dmap } = buildDescriptorMap(['always', 'objects', `level${world}`], (s) => atlases[s].count);
const cats = parseObjectCategories(dclDecompress(raw(`POBJECTS.00${key[0]}`)).data);
const drawObjects = sortForDraw(map.objects.filter((o) => !isDeadType(o.type)), cats);
const heroFrame = (id) => {
  const d = dmap[id];
  const f = atlases[d.stem].frames[d.frame];
  return { ...f, pixels: cutFrame(images[d.stem], f) };
};

/* Same spawn rule as main.js: first cell with solid ground three rows below. */
let spawn = { x: 64, y: 64 };
outer: for (let col = 1; col < MAP_COLS - 1; col++) {
  for (let row = 0; row < MAP_ROWS - 4; row++) {
    if (map.planeB[row * MAP_COLS + col] === 0 &&
        map.planeB[(row + 3) * MAP_COLS + col] === CELL_SOLID) {
      spawn = { x: col * 32, y: row * 16 }; break outer;
    }
  }
}

/* Spawn the FIRST live enemy group of this level through the real recipe, and
 * put the hero and camera beside it so the frame shows something. */
const groups = parseGroupsB(dclDecompress(raw(palfilsNameFor(key))).data);
const slots = new GroupSlots();
const firstLive = groups.find((g) => g.live && g.count > 0);
const enemies = [];
if (firstLive) {
  slots.activate(firstLive);
  const ex = firstLive.tileX * 32, ey = firstLive.tileY * 16;
  const onGround = groundBelow(map.planeB, ex, ey);
  const mode = ((firstLive.flags >> 9) & 1) + (onGround ? 0 : 2);
  let delay = 0;
  for (let i = 0; i < Math.min(firstLive.count, MAX_ENTITIES); i++) {
    enemies.push(new EntityB({ x: ex, y: ey, mode, speed: firstLive.speed,
                               hp: firstLive.hp || 1, cls: firstLive.cls, delay }));
    delay += firstLive.stagger;
  }
  spawn = { x: ex - 64, y: ey };
}
const p = new Player(spawn.x, spawn.y);
const cam = new Camera(spawn.x - 100, spawn.y - 60);
const input = { left: false, right: true, up: false, down: false, fire: false };
const lvl = { world: +key[0], sublevel: key[1] === 'A' ? 0 : 1 };
for (let i = 0; i < ticks; i++) {
  cam.snapshot();
  p.tick(map, input);
  for (const e of enemies) e.tick(map.planeB);
  cam.update(p.x, p.y, lvl);
}

const idx = new Uint8Array(SCREEN_W * SCREEN_H);
const camX = cam.snapX, camY = cam.snapY;
for (let row = camY >> 4; row <= Math.min(MAP_ROWS - 1, (camY + SCREEN_H) >> 4); row++) {
  for (let col = camX >> 5; col <= Math.min(MAP_COLS - 1, (camX + SCREEN_W) >> 5); col++) {
    const t = tiles[map.planeA[row * MAP_COLS + col] - 1];
    if (!t) continue;
    const dx = col * TILE_W - camX, dy = row * TILE_H - camY;
    for (let y = 0; y < TILE_H; y++) {
      const py = dy + y; if (py < 0 || py >= SCREEN_H) continue;
      for (let x = 0; x < TILE_W; x++) {
        const px = dx + x; if (px < 0 || px >= SCREEN_W) continue;
        const v = t[y * TILE_W + x]; if (v) idx[py * SCREEN_W + px] = v;
      }
    }
  }
}

let drawn = 0;
for (const o of drawObjects) {
  const sx = o.x - camX, sy = o.y - camY;
  if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
  const of_ = heroFrame(spriteForType(o.type));
  drawn++;
  for (let y = 0; y < of_.h; y++) {
    const py = sy + y; if (py < 0 || py >= SCREEN_H) continue;
    for (let x = 0; x < of_.w; x++) {
      const px = sx + x; if (px < 0 || px >= SCREEN_W) continue;
      const v = of_.pixels[y * of_.w + x]; if (v) idx[py * SCREEN_W + px] = v;
    }
  }
}

const ANIM = MODE_TABLE.map((m) => m.animBase);
let drawnE = 0;
for (const e of enemies) {
  if (e.state === 0 || e.state === -2) continue;
  const sx = e.x - camX, sy = e.y - camY;
  if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
  const eid = spriteForEntity(world, e.cls, e.mode, e.frame, ANIM);
  if (eid === null || eid < CREATURE_DESCRIPTOR_BASE) continue;
  const ef = heroFrame(eid); drawnE++;
  for (let y = 0; y < ef.h; y++) {
    const py = sy + y; if (py < 0 || py >= SCREEN_H) continue;
    for (let x = 0; x < ef.w; x++) {
      const px = sx + x; if (px < 0 || px >= SCREEN_W) continue;
      const v = ef.pixels[y * ef.w + x]; if (v) idx[py * SCREEN_W + px] = v;
    }
  }
}

const id = spriteFor(p.stateIndex, p.phase);
const f = heroFrame(id);
for (let y = 0; y < f.h; y++) {
  const py = p.y - camY + y; if (py < 0 || py >= SCREEN_H) continue;
  for (let x = 0; x < f.w; x++) {
    const px = p.x - camX + x; if (px < 0 || px >= SCREEN_W) continue;
    const v = f.pixels[y * f.w + x]; if (v) idx[py * SCREEN_W + px] = v;
  }
}

const buf = Buffer.alloc(SCREEN_W * SCREEN_H * 3);
for (let i = 0; i < idx.length; i++) {
  const c = idx[i] * 4;
  buf[i * 3] = pal[c]; buf[i * 3 + 1] = pal[c + 1]; buf[i * 3 + 2] = pal[c + 2];
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${SCREEN_W} ${SCREEN_H}\n255\n`), buf]));
console.log(`PLEV${key} tick ${ticks}: hero (${p.x},${p.y}) state ${p.stateIndex} ` +
            `"${STATE_INFO[p.stateIndex].label}" phase ${p.phase} sprite #${id} ${f.w}x${f.h}, ` +
            `cam (${camX},${camY}), ${drawn} objects + ${drawnE} enemies -> ${out}`);
