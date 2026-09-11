/* main.js — milestone 1 wiring.
 *
 * Loads a shipped level, decompresses it in-browser, renders plane A, and
 * drives the hero — real sprites, selected by the ported state machine — with
 * the proven kinematic constants and the ported camera. Anything not proven is
 * either absent or labelled: see game/player.js for the kinematic scope note
 * and game/states.js for how each of the 29 states was identified.
 */

import { dclDecompress } from './formats/dcl.js';
import { decodePI1, sliceTiles, SCREEN_W, SCREEN_H } from './formats/pi1.js';
import { parseMap, MAP_COLS, MAP_ROWS, CELL_SOLID, TILE_COUNTS } from './formats/map.js';
import { parseAtlas, cutAll } from './formats/atlas.js';
import { Clock, LOGIC_HZ } from './engine/clock.js';
import { Renderer } from './render/renderer.js';
import { Player, ST } from './game/player.js';
import { runAllChecks, checkDescriptorAnchors, checkHeroSprites,
         checkSelectorsAndObjects, checkSpawn, checkEntityB, checkEntityA, checkSpawnA,
         checkWeaponsProjectiles, checkTriggerActions,
         checkZones } from './verify/checks.js';
import { EventRunner, parsePalfils, palfilsNameFor } from './game/events.js';
import { makeActionContext, makeGates, DOOR_TILES,
         ACTION_NAMES } from './game/trigger-actions.js';
import { Camera } from './game/camera.js';
import { spriteFor, STATE_INFO, UNMODELLED_PHASE_STATES } from './game/states.js';
import { buildDescriptorMap, GROUP_STEMS, HERO_DESCRIPTOR_MAX } from './formats/descriptors.js';
import { spriteForType, parseObjectCategories, sortForDraw, isDeadType,
         isUnstamped, OBJECT_SLOTS, activationBox,
         activateObjects, insertSpawned } from './game/objects.js';
import { parseObjectRecords, Score, Purse, TreasureBurst, INVENTORY_EMPTY,
         CHEST_MIN, CHEST_MAX, chestKeyFor } from './game/treasure.js';
import { CONSUMABLES, WEAPON_ARCS, INVULN_TICKS_SPAWN } from './game/consumables.js';
import { Starburst, SPRITE_BASE as SB_SPRITE } from './game/starburst.js';
import { Destructibles } from './game/destructible.js';
import { resetWeaponArc, setWeaponArc } from './game/projectiles.js';
import { parseGroupsB, parseGroupsA, GroupSlots, spriteForEntity, MAX_ENTITIES,
         CREATURE_DESCRIPTOR_BASE } from './game/spawn.js';
import { EntityB, MODE, MODE_TABLE, groundBelow, isDying } from './game/entity.js';
import { EntityA, CLASS_TABLES_A, spriteForEntityA } from './game/entity-a.js';
import { VERDICT_NONE } from './game/pathfind.js';
import { runSearch } from './game/pathfind-producers.js';
import { GodsRandom } from './game/random.js';
/* Contact and the grid scan are reached through game/frame.js, which owns the
 * order they must run in — see the note there. */
import { Health, HEALTH_MAX, attackHero } from './game/combat.js';
import { Nests } from './game/nest.js';
import { EnemyShots } from './game/enemy-shots.js';
import { Debris } from './game/debris.js';
import { Arsenal, spawnableWeapons } from './game/hero-fire.js';
import { stepHeroFrame, stepCreatureDamage } from './game/frame.js';
import { DamageGrid, damageForTag } from './game/collision.js';
import { parseWeapons } from './game/weapons.js';
import { pickUpWeapon } from './game/pickup.js';
import { scanZones, unpackTeleportDest, resolveExitDestination,
         ZONE_TELEPORT, ZONE_EXIT } from './game/zones.js';

const LEVELS = ['1A','1B','2A','2B','3A','3B','4A','4B'];

/* Read out of the PWEAPONS records' own text at the 80-byte stride. Taking
 * this order from memory instead put fireball and lightning bolt in each
 * other's places and made a correct claim elsewhere look wrong. */
const WEAPON_NAMES = ['knife', 'time bomb', 'fireball', 'flame',
  'lightning bolt', 'throwing star', 'spear', 'axe', 'hunter',
  'magic axe', 'mace'];

const $ = (id) => document.getElementById(id);
const cache = new Map();

async function fetchRaw(url) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const b = new Uint8Array(await res.arrayBuffer());
  cache.set(url, b);
  return b;
}

async function loadLevel(key) {
  const mapRaw  = await fetchRaw(`game/PLEV${key}.MAP`);
  const bitsRaw = await fetchRaw(`game/PBITS${key}.PI1`);
  const map   = parseMap(dclDecompress(mapRaw).data);
  const sheet = decodePI1(dclDecompress(bitsRaw).data);

  /* PALETTE SOURCE — deliberately NOT the tile sheet.
   * Measured across all 44 shipped .PI1 files: 32 have proper ST 3-bit
   * palette words (all nibbles <= 7) and 12 do NOT — exactly the PBITS* and
   * PXTRA* tile sheets, every one with the high nibble set. So a tile
   * sheet's palette region is not a usable palette.
   * We take the per-level palette from PLEVEL<N><X>.PI1, which is 3-bit
   * clean and is the source the project's earlier VALIDATED extraction used
   * when it rendered all 8 levels as coherent geometry.
   * UNKNOWN_level_palette_source: which file GAME.EXE itself loads for the
   * in-game palette has not been established from the binary. */
  const palRaw = await fetchRaw(`game/PLEVEL${key}.PI1`);
  const palette = decodePI1(dclDecompress(palRaw).data).palette;

  /* TILE LIST — two sheets, truncated to the level's own count.
   * Export 17 builds min(count,120) tiles from PBITS<key>, then count-120 more
   * from PXTRA<key> (which ships only for the four levels with count > 120).
   * Slots beyond `count` are never written by export 17, so we do not provide
   * them: out-of-range plane-A values fall through to the empty path. */
  const count = TILE_COUNTS[key];
  let tiles = sliceTiles(sheet).slice(0, Math.min(count, 120));
  if (count > 120) {
    const xRaw = await fetchRaw(`game/PXTRA${key}.PI1`);
    const extra = sliceTiles(decodePI1(dclDecompress(xRaw).data));
    tiles = tiles.concat(extra.slice(0, count - 120));
  }
  const pfRaw = await fetchRaw(`game/${palfilsNameFor(key)}`);
  const palfilsData = dclDecompress(pfRaw).data;
  const palfils = parsePalfils(palfilsData);

  /* Object categories come from the world's own POBJECTS file (record +4,
   * big-endian). Verified byte-identical to the EXE's DS:0xef78 table for all
   * 132 records in all four worlds. Categories decide draw order only. */
  const objRaw = dclDecompress(await fetchRaw(`game/POBJECTS.00${key[0]}`)).data;
  const cats = parseObjectCategories(objRaw);
  /* The same file read the other way. CS:0x35FB copies +0..+7 of each 48-byte
   * record straight into the 10-byte runtime descriptor, so +6 — the VALUE —
   * is what the treasure award at CS:0x18A8 pays out. */
  const objValues = parseObjectRecords(objRaw).map((r) => r.value);
  const groupsB = parseGroupsB(dclDecompress(pfRaw).data);
  const groupsA = parseGroupsA(dclDecompress(pfRaw).data);
  const drawObjects = sortForDraw(map.objects.filter((o) => !isDeadType(o.type)), cats);

  /* PWEAPONS is per-world, and Power (+0x06) genuinely differs between them —
   * the axe is 4 in worlds 1-2 and 12 in 3-4. The sprite fields and the pickup
   * count are pinned at the EXE-image values by the loader, so they are served
   * from the pinned tables in weapons.js, not from these bytes. */
  const weapons = parseWeapons(
    dclDecompress(await fetchRaw(`game/PWEAPONS.00${key[0]}`)).data);

  return { map, sheet, palette, tiles, tileCount: count, palfils, palfilsRaw: palfilsData, cats, drawObjects,
           objValues, groupsB, groupsA, weapons, world: +key[0] };
}

/* THE HERO'S SPRITES.
 * Descriptor numbering is cumulative across the atlases of a group, and the
 * cursor advances on BOTH the load and skip paths in the driver (VGA 0x0BD4 /
 * 0x0CAA), so an index is computable from frame counts alone. The `always`
 * group is PALWAYS1 (39) + PALWAYS2 (72) + PALWAYS3 (17) + PGODFONT (42), and
 * the hero is descriptors #0..#57 — verified by two predicted-then-measured
 * anchors (#127 = the 80x7 digit strip, #169 = the 208x46 title logo).
 *
 * ANCHOR: the sprite is drawn at exactly (X, Y), top-left, with no offset.
 * CS:0x6049 computes `heroX - [0x1ae]`, `heroY - [0x1b0]`, and all three
 * writers of that pair (CS:0x023f, 0x0a14, 0x92ad) copy [0xa]/[0xc] — the
 * scroll origin — into it immediately before `call 0x4993`. So those words are
 * a camera snapshot, not a per-sprite trim. Corroborated by the pickup test at
 * CS:0x6069 using (X + 0x10, Y + 0x28) as the hero's hot point, which is the
 * centre-bottom of a 32x48 box anchored at (X, Y). */
async function loadSprites(world) {
  /* `level<N>` is the per-world CREATURE group and it lands at descriptor
   * #450 — always(170) + objects(280) — which is exactly where the enemy
   * sprite-class bases start. Despite the name, PLEVEL<N><X>.PI1 is a 32x32
   * creature animation strip, not a tileset. */
  const groups = ['always', 'objects', `level${world}`];
  const atlases = {}, images = {};
  for (const g of groups) {
    for (const s of GROUP_STEMS[g]) {
      atlases[s] = parseAtlas(dclDecompress(await fetchRaw(`game/${s}.DAT`)).data);
      images[s]  = decodePI1(dclDecompress(await fetchRaw(`game/${s}.PI1`)).data);
    }
  }
  const { map, ranges } = buildDescriptorMap(groups, (s) => atlases[s].count);
  const frames = [];
  for (let id = 0; id < map.length; id++) {
    const d = map[id];
    const f = atlases[d.stem].frames[d.frame];
    frames[id] = { ...f, pixels: cutAll(images[d.stem], { frames: [f] })[0].pixels };
  }
  return { frames, ranges, palette: images.PALWAYS1.palette, total: map.length };
}

/* Spawn: pick a standing position from the map itself rather than inventing
 * one. GAME.EXE spawns from DS:0x15a (level-load state we have not read), so
 * this is a PORT-ONLY choice and is flagged as such: we scan for the first
 * cell with solid ground beneath it. */
function findSpawn(map) {
  for (let col = 1; col < MAP_COLS - 1; col++) {
    for (let row = 0; row < MAP_ROWS - 4; row++) {
      const here  = map.planeB[row * MAP_COLS + col];
      const below = map.planeB[(row + 3) * MAP_COLS + col];
      if (here === 0 && below === CELL_SOLID) {
        return { x: col * 32, y: row * 16 };
      }
    }
  }
  return { x: 64, y: 64 };
}

/* Draw a whole atlas into a canvas as a labelled grid, so the decoded frames
 * are inspectable rather than merely asserted to be correct. */
async function renderAtlas(name, canvas) {
  const dat = dclDecompress(await fetchRaw(`game/${name}.DAT`)).data;
  const img = decodePI1(dclDecompress(await fetchRaw(`game/${name}.PI1`)).data);
  const frames = cutAll(img, parseAtlas(dat));
  const COLS = 16, GUT = 3;
  const cw = Math.max(...frames.map((f) => f.w)) + GUT;
  const chh = Math.max(...frames.map((f) => f.h)) + GUT;
  const rows = Math.ceil(frames.length / COLS);
  canvas.width = COLS * cw; canvas.height = rows * chh;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const id = ctx.createImageData(canvas.width, canvas.height);
  const pal = img.palette;
  frames.forEach((f, i) => {
    const ox = (i % COLS) * cw, oy = ((i / COLS) | 0) * chh;
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const v = f.pixels[y * f.w + x];
        if (!v) continue;
        const o = ((oy + y) * canvas.width + ox + x) * 4, c = v * 4;
        id.data[o] = pal[c]; id.data[o + 1] = pal[c + 1];
        id.data[o + 2] = pal[c + 2]; id.data[o + 3] = 255;
      }
    }
  });
  ctx.putImageData(id, 0, 0);
  return frames.length;
}

function renderChecks(results) {
  const host = $('checks');
  host.innerHTML = '';
  for (const r of results) {
    const d = document.createElement('div');
    /* A `note` row reports a measurement rather than asserting one. It must
     * NOT render as a green tick: next to an open UNKNOWN_ a tick reads as
     * resolved, and a check that cannot fail is not evidence. */
    d.className = `chk ${r.note ? 'note' : r.pass ? 'ok' : 'bad'}`;
    d.innerHTML = `<span class="m">${r.note ? '·' : r.pass ? '✓' : '✕'}</span>` +
                  `<span>${r.name}${r.detail ? ` <span class="d">(${r.detail})</span>` : ''}</span>`;
    host.appendChild(d);
  }
  const bad = results.filter((r) => !r.pass && !r.note).length;
  const s = $('summary');
  s.className = bad ? 'bad' : 'ok';
  s.textContent = bad
    ? `${bad} of ${results.length} invariants FAILED`
    : `all ${results.length} invariants hold, re-derived from the shipped bytes`;
}

async function main() {
  const sel = $('level');
  for (const k of LEVELS) {
    const o = document.createElement('option');
    o.value = k; o.textContent = `PLEV${k}`;
    sel.appendChild(o);
  }
  $('hz').textContent = LOGIC_HZ.toFixed(3);

  const renderer = new Renderer($('screen'));

  /* Verification first — if the formats are wrong we want to see it up front. */
  try {
    const { results, sampleMessages } = await runAllChecks(fetchRaw);
    /* The page must show what `npm run verify` shows. These groups used to be
     * node-only, so the panel silently reported a subset and a regression in
     * any of them was invisible here — which defeats the point of the panel. */
    for (const g of [
      checkDescriptorAnchors(fetchRaw), checkHeroSprites(fetchRaw),
      checkSelectorsAndObjects(fetchRaw), checkSpawn(fetchRaw),
      Promise.resolve(checkEntityB()), checkWeaponsProjectiles(fetchRaw),
    checkTriggerActions(fetchRaw), checkZones(fetchRaw),
    Promise.resolve(checkEntityA()), checkSpawnA(fetchRaw),
    ]) results.push(...await g);
    renderChecks(results);
    const mh = $('messages');
    mh.innerHTML = '';
    for (const m of sampleMessages) {
      const d = document.createElement('div');
      d.className = 'msg';
      d.textContent = `“${m}”`;
      mh.appendChild(d);
    }
  } catch (err) {
    $('summary').className = 'bad';
    $('summary').textContent = `check run failed: ${err.message}`;
    console.error(err);
  }

  try {
    const n = await renderAtlas('POBJ1', $('atlas'));
    $('atlasName').textContent = `POBJ1 — ${n} frames`;
  } catch (e) { console.error('atlas render failed', e); }

  let level = await loadLevel(LEVELS[0]);
  let hero = null;
  try {
    hero = await loadSprites(level.world);
  } catch (e) { console.error('sprites failed to load', e); }

  let spawn = findSpawn(level.map);
  let player = new Player(spawn.x, spawn.y);
  /* THE ACTION CONTEXT — what makes a fired trigger actually do something.
   * planeA/planeB are the live map arrays (subarray views into the bulk), so a
   * door written here is visible to the renderer and to collision on the very
   * next frame. Rebuilt per level: the tile constants and the trapdoor table
   * are both per-world. */
  const buildActionCtx = (lvl, inv, ars) => makeActionContext({
    planeA: lvl.map.planeA, planeB: lvl.map.planeB,
    gates: makeGates(lvl.palfilsRaw),
    tiles: DOOR_TILES[lvl.world - 1],
    messages: lvl.map.messages,
    categoryOf: (type) => lvl.cats[type],
    inventory: inv,
    /* A DETACHED copy — see act10's note. The live arsenal is disarmed
     * through the hook below, not by writing into this array. */
    weaponSlots: ars.slots.map((sl) => sl.weapon),
    clearWeaponSlot: (i) => { ars.slots[i].weapon = INVENTORY_EMPTY; },
    /* Same allocator the treasure burst uses — CS:0x38D7 first-fit, with the
     * 200-slot ceiling measured against what is actually live. */
    alloc: () => {
      const live = lvl.drawObjects.reduce((n, o) => n + (o.dead ? 0 : 1), 0);
      if (live >= OBJECT_SLOTS) return null;
      const sl = { x: 0, y: 0, type: 0, flag6: 1, dead: false };
      lvl.drawObjects.push(sl);
      return sl;
    },
    onDiverge: (why) => { diverged.push(why); },
  });
  const diverged = [];
  let events = new EventRunner(level.map, level.palfils);
  /* ENEMIES. The runtime group slots (SS:0x36b4) plus the entities they
   * materialise (DS:0x536). Activation arrives from the plane-B event chain:
   * selector 4 -> CS:0xde08. */
  /* The random source is regenerated once per LEVEL LOAD (CS:0x2b2a, right
   * after the .MAP loader) — not per frame and not per search. Seeded with a
   * constant here so a session is reproducible; the original uses the BIOS
   * tick count and is not. See game/random.js. */
  let rng = new GodsRandom(1);
  /* CS:0x084B/0x0851 — target full, bar 1, so it animates up over 23 frames. */
  let health = new Health();

  /* ── THE ARSENAL AND THE DAMAGE GRID ────────────────────────────────────
   *
   * ⚠️ THE HERO STARTS UNARMED, and that is not a gap in the port. CS:0x914c
   * writes 0xFFFF into all three slot words (DS:0xdd10 / 0xdda2 / 0xde34) and
   * clears their 144-byte projectile areas; its two callers, CS:0x473 and
   * CS:0x8dd9, are the full game restarts. Nothing else ever seeds a slot, so
   * a weapon can only come from one of the 55 weapon pickups the eight maps
   * place (object type >= 0xC0). Wiring that pickup path is the next
   * increment — UNKNOWN_starting_weapon is therefore NOT open: the answer is
   * "none", and the dropdown below is an explicit DEV affordance, labelled as
   * such, so the fire chain is exercisable before pickups exist. */
  let arsenal = new Arsenal(level.weapons);
  const grid = new DamageGrid();
  /* CS:0x9320 — decode a grid tag back to the weapon that stamped it. Bound
   * over the arsenal's live slots so the creature scan needs no other state. */
  const decodeTag = (tag) => damageForTag(
    tag,
    arsenal.slots.map((s) => s.weapon),
    Object.fromEntries(arsenal.slots.filter((s) => s.st).map((s) => [s.weapon, s.st])));
  /* DS:0x365 — level progression only. 0 on world 1, so full damage here. */
  let difficulty = 0;
  let shotsFired = 0, creaturesShot = 0, picked = 0, consumed = 0, banked = 0;

  /* ── Treasure. DS:0x194 (money) and DS:0x3b5 (the packed-BCD score) are
   * separate quantities and only the money one is what the shop refunds
   * against. Both survive a level change; only a full restart clears them
   * (CS:0x0487 / CS:0x8D91). */
  /* The effect state the wired consumables write. DS:0x19c/0x172 (invuln),
   * DS:0x2fa (freeze), DS:0x174 (giant jump), DS:0x224 (lives) — each ticks
   * down once per frame the way the original does. Spawn protection is the
   * SHORT one: CS:0x085D calls the same helper then subtracts 170. */
  let fx = { invuln: INVULN_TICKS_SPAWN, freeze: 0, giantJump: 0, lives: 2,
             arc: 0, shop: false, stateMachineSuspended: false };
  /* CS:0xA461 — the starburst potion's 80-slot particle array. It is a real
   * damage source (tag 0xFC), so it lives beside the projectiles rather than
   * with the cosmetics. */
  let starburst = new Starburst(new GodsRandom(2));
  /* CS:0x73EC — breakable masonry. Only worlds 3-4 place solid 0x6d cells,
   * and only the six terrain-stopping weapons can reach it. */
  let blocks = new Destructibles(1);
  let purse = new Purse(), score = new Score();
  let burst = new TreasureBurst(new GodsRandom(1));
  let opened = 0, lootLanded = 0, sbStamps = 0, lastBurstFx = null;
  let lastBlockFx = [];
  let lastNestFx = [], lastShotsFx = null, lastDebrisFx = [];
  /* ⚠️ DEV SEED, exactly like the weapon picker above. The original puts a
   * "chest key" in DS:0x17e only through CROUCH + FIRE (CS:0x6069), which
   * this port does not implement — so with a truthful empty inventory the
   * chest branch would be unreachable in the running build and the burst
   * would be dead code. The three keys are seeded and the status line says
   * so. Nothing else reads this array. */
  let inventory = [chestKeyFor(CHEST_MIN), chestKeyFor(CHEST_MIN + 2),
                   chestKeyFor(CHEST_MIN + 4), INVENTORY_EMPTY];
  /* Executing the verbs needs the inventory and the weapon slots, so the
   * context is attached here rather than beside the EventRunner. */
  events.actionCtx = buildActionCtx(level, inventory, arsenal);
  /* DS:0xb5dc — the marker list strategy 2 heads for. It is populated by the
   * object-pickup path when the hero takes an "attracts monsters" potion
   * (type 45, CS:0x163d). Pickups are not modelled, so it stays empty and the
   * seed short-circuits to the descriptor's other nibble, exactly as the
   * original does with no markers placed. */
  const markers = [];
  let slots = new GroupSlots();
  let enemies = [];
  let slotsA = new GroupSlots();
  let enemiesA = [];
  /* Stage 6 (CS:0xe659) is ported and now wired end to end: the reload
   * timer, facing test and muzzle computation feed the shared EnemyShots
   * array below, the same one the nest creature fires through. Counted
   * separately so the split between the two firing paths stays visible. */
  let firedByA = 0;

  /* CS:0x8611 / CS:0x1FE7-0x2039 — the world-2 nest creature and the shared
   * enemy-shot array both exist as fully-ported, fully-tested modules
   * (nest.js, enemy-shots.js) that no caller in this file instantiated
   * before this pass. Wiring them here closes that gap for real, not just
   * for System A's stage 6. */
  let nests = new Nests(level.world, rng);
  let shots = new EnemyShots();
  /* CS:0x0172 `not byte [0x36c]` — the every-other-frame toggle the nest's
   * hatch animation reads (DS:0x36c). Not modelled elsewhere in this port
   * yet, so it is owned here. */
  let tock = 0;
  /* DS:0x8b4c — a purely visual, non-interacting particle effect (see
   * game/debris.js's header for the conflation this project made and
   * corrected chasing it). Fully ported and unit-tested but never
   * instantiated from this file before this pass — a shot the terrain
   * stopped left no puff behind it. */
  let debris = new Debris();
  const wireSpawn = () => {
    events.onSpawnB = (param) => {
      const d = level.groupsB[param];
      if (!d || !d.live) return;
      slots.activate(d);
    };
    events.onSpawnA = (param) => {
      const d = level.groupsA[param];
      if (!d || !d.live) return;
      slotsA.activate(d);
    };
  };
  wireSpawn();
  /* CS:0xec60, run for every slot in state 2. Deliberately reproduced quirks:
   * a count-0 group is NOT freed (the original's `jmp 0xed38` only advances
   * the cursor), and the count is unchecked against the 10 slots — we clamp
   * and surface the clamp rather than silently truncating. */
  let clamped = 0;
  const runSpawns = () => {
    for (const slot of slots.slots) {
      if (slot.state !== 2) continue;
      const d = slot.desc;
      if (d.count === 0) continue;                 // never freed — faithful
      const n = Math.min(d.count, MAX_ENTITIES);
      if (d.count > MAX_ENTITIES) clamped++;
      const x = d.tileX * 32, y = d.tileY * 16;
      const onGround = groundBelow(level.map.planeB, x, y);
      const mode = ((d.flags >> 9) & 1) + (onGround ? 0 : 2);
      let delay = 0;
      for (let i = 0; i < n; i++) {
        enemies.push(Object.assign(
          new EntityB({ x, y, mode, speed: d.speed, hp: d.hp || 1,
                        cls: d.cls, delay }),
          { desc: d }));      // the pathfinder reads +0x08/+0x09/+0x0c/+0x0d
        delay += d.stagger;
      }
      slot.state = 1;
    }
  };
  /* CS:0xde7d, System A. Deliberately reproduced/disclosed quirks — see
   * entity-a.js's header: no per-entity stagger (the original's own DX
   * register never advances in this loop) and count clamped the same way
   * System B's is (the original has no bound either). */
  let clampedA = 0;
  const runSpawnsA = () => {
    for (const slot of slotsA.slots) {
      if (slot.state !== 2) continue;
      const d = slot.desc;
      if (d.count === 0) continue;
      const n = Math.min(d.count, MAX_ENTITIES);
      if (d.count > MAX_ENTITIES) clampedA++;
      const x = d.tileX * 32, y = d.tileY * 16;
      for (let i = 0; i < n; i++) {
        enemiesA.push(Object.assign(
          new EntityA({ x, y, cls: d.cls, hp: d.hp || 1, delay: 0 }),
          { desc: d }));
      }
      slot.state = 1;
    }
  };
  /* Start the camera with the hero inside both dead zones, or he sits at
   * screen (0,0) and the view slides for ~25 ticks on every level load.
   * UNKNOWN_camera_init — what the original writes into [0xa]/[0xc] at level
   * load has not been traced; this matches tools/frame-node.mjs so the browser
   * and the headless renderer agree about the same tick. */
  const camInit = (s) => new Camera(s.x - 100, s.y - 60);
  let cam = camInit(spawn);
  let levelInfo = { world: +LEVELS[0][0], sublevel: LEVELS[0][1] === 'A' ? 0 : 1 };
  /* `dying` is counted in the RENDER callback and was previously declared with
   * `let` inside the TICK callback — a different function scope, so the first
   * creature to die would have thrown a ReferenceError mid-frame. Hoisted here
   * beside its siblings, which is where the other counters already lived. */
  let outOfRange = 0, unstamped = 0, dying = 0;

  /* The 8 shipped levels, in the only order this project can currently
   * justify — see the "level exit" note in game/zones.js: the original's
   * true world/sublevel-advance rule (CS:0x0FAC's DS:0x178/0x36a hand-off
   * into FUN_1000_8c34) is not traced past confirming the destination TEXT
   * table exists. This wraps 4B -> 1A. `UNKNOWN_level_exit_destination`. */
  const nextLevelKey = (key) => LEVELS[(LEVELS.indexOf(key) + 1) % LEVELS.length];

  /* True while `switchLevel` is mid-flight — the tick loop pauses rather
   * than scanning zones or stepping physics against a level that is only
   * half-loaded. There is no original-engine equivalent to cite here; DOS
   * just blocked on the synchronous file reads this port awaits instead. */
  let transitioning = false;

  async function switchLevel(key) {
    transitioning = true;
    try {
      sel.value = key;
      level = await loadLevel(key);
      try { hero = await loadSprites(level.world); }
      catch (e) { console.error('sprites failed to load', e); }
      spawn = findSpawn(level.map);
      player = new Player(spawn.x, spawn.y);
      events = new EventRunner(level.map, level.palfils);
      slots = new GroupSlots(); enemies = []; clamped = 0;
      slotsA = new GroupSlots(); enemiesA = []; clampedA = 0; firedByA = 0;
      rng = new GodsRandom(1);
      nests = new Nests(level.world, rng); shots = new EnemyShots(); tock = 0;
      debris = new Debris();
      health = new Health();
      /* A real level change is not a game restart, so CS:0x914c does NOT run
       * and the weapon slots survive — only their counts are re-pinned
       * (CS:0x35e9). The dev selector re-arms below, so equipping is
       * re-applied rather than carried; `reloadWorld` is what keeps the
       * per-world Power swap honest. */
      arsenal = new Arsenal(level.weapons);
      events.actionCtx = buildActionCtx(level, inventory, arsenal);
      equipFromUI();
      grid.clear();
      shotsFired = 0; creaturesShot = 0; picked = 0; consumed = 0; banked = 0;
      /* A level change is not a restart: money, score and the inventory all
       * carry (only CS:0x0487/0x8D91/0x0498/0x8D80 clear them). The burst
       * does not — its ten records live in a fixed array that the next
       * chest overwrites wholesale anyway (CS:0x12EA never looks for free
       * slots). */
      burst = new TreasureBurst(new GodsRandom(1)); opened = 0; lootLanded = 0;
      starburst = new Starburst(new GodsRandom(2));
      /* CS:0x69B1/0x8E40 restore every broken block, then clear the queue. */
      if (blocks) blocks.restoreAll(level.map.planeA, level.map.planeB);
      blocks = new Destructibles(level.world);
      /* A level change is not a restart, so lives carry; the timers do not
       * (the level-start block re-grants the short spawn invulnerability). */
      fx = { ...fx, invuln: INVULN_TICKS_SPAWN, freeze: 0, giantJump: 0,
             arc: 0, shop: false, stateMachineSuspended: false };
      resetWeaponArc();
      wireSpawn();
      cam = camInit(spawn);
      levelInfo = { world: +key[0], sublevel: key[1] === 'A' ? 0 : 1 };
      outOfRange = 0; unstamped = 0;
      $('event').textContent = '–';
    } finally {
      transitioning = false;
    }
  }

  sel.addEventListener('change', () => { switchLevel(sel.value); });

  const input = { left: false, right: false, up: false, down: false, fire: false };
  const KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down', Space: 'fire',
  };
  addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code]; if (k) { input[k] = true; e.preventDefault(); }
  });
  addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code]; if (k) { input[k] = false; e.preventDefault(); }
  });

  $('showUnk').addEventListener('change', (e) => {
    renderer.showUnknownTiles = e.target.checked;
  });

  /* ── the weapon picker, now a CHEAT rather than the only way to arm ──────
   * Real pickups work: walking over a type >= 0xC0 object arms the hero
   * through the original's own slot selector. This dropdown stays because
   * only 5 of the 11 weapons have a decoded spawn handler and a given level
   * may not place one of those five — it forces a weapon so the fire chain
   * stays exercisable. It now routes through the SAME dispatcher a map pickup
   * uses, so it cannot diverge from it. Default is "none", as shipped. */
  const spawnable = spawnableWeapons(level.weapons);
  const wsel = $('weapon');
  wsel.innerHTML = '<option value="-1">none (as shipped — pick one up)</option>';
  for (const w of level.weapons) {
    const ok = spawnable.ok.includes(w.index);
    const o = document.createElement('option');
    o.value = String(w.index);
    o.textContent = WEAPON_NAMES[w.index] + (ok ? '' : ' — handler not decoded');
    o.disabled = !ok;
    wsel.appendChild(o);
  }
  function equipFromUI() {
    const n = +wsel.value;
    if (n < 0) return;                    // leave whatever was picked up
    pickUpWeapon(arsenal, n);             // CS:0x94a7, the real path
  }
  wsel.addEventListener('change', equipFromUI);

  const clock = new Clock(
    () => {
      if (transitioning) return;    // a level load is in flight — hold the frame
      /* Per-tick order is the original's: snapshot the scroll origin, run the
       * state machine, probe plane B, then update the camera (CS:0x023f ->
       * 0x4993 -> 0x5ea0 -> 0x5ea4). Everything drawn this frame uses the
       * snapshot, so the hero and the background never skew apart. */
      cam.snapshot();
      /* CS:0x019D -> 0x01CC -> 0x020F -> 0x0254: latch, clear the grid, move
       * and stamp the projectiles, THEN run the player. That order lives in
       * game/frame.js so the verification suite can drive it — see the note
       * there about the mutation that survived while it was inline here. */
      /* CS:0x11D3 — the activation pass, which owns `+6`. It runs ahead of the
       * object walk because the walk's own gate (CS:0x14A1) reads what it
       * writes. The box is recomputed from the SNAPPED camera. */
      activateObjects(level.drawObjects, activationBox(cam.snapX, cam.snapY));
      /* CS:0x1C91 `call 0x8611` — the world-2 nest creature's spawn, reached
       * from the object walk's category-4/sprite-0x11d dispatch arm, NOT
       * from the activation pass itself (a different per-frame walk over the
       * same array). Reproduces the documented shipped bug faithfully: the
       * object is marked dead here whether or not the spawn actually
       * succeeded (wrong world, or all 10 nest slots already busy). */
      for (const o of level.drawObjects) {
        if (o.dead || o.type !== 115 || !(o.flag6 & 1)) continue;
        nests.spawn(o.x - cam.snapX, o.y, cam.snapX);
        o.dead = true;
      }
      const fr = stepHeroFrame({
        input, arsenal, grid, player,
        map: level.map, cam: { x: cam.snapX, y: cam.snapY }, world: level.world,
        /* CS:0x0206 — the object pass. `drawObjects` is the same array the
         * renderer walks, so collecting one removes it from the frame too. */
        objects: level.drawObjects, bar: health.bar,
        cats: level.cats, health, effects: { ...fx, starburst,
                                             hero: { x: player.x, y: player.y } },
        treasure: { values: level.objValues, inventory, purse, score, burst },
        starburst, blocks, debris,
        burst,
        /* CS:0x38D7 — first-fit over the 200-slot runtime array. `drawObjects`
         * already excludes the map's dead slots, so the headroom here is
         * 200 minus what is live, which is the same number the original has. */
        alloc: () => {
          const live = level.drawObjects.reduce((n, o) => n + (o.dead ? 0 : 1), 0);
          if (live >= OBJECT_SLOTS) return null;
          const s = { x: 0, y: 0, type: 0, flag6: 1, dead: false };
          level.drawObjects.push(s);
          return s;
        },
      });
      for (const t of fr.treasures) {
        if (t.outcome === 'collected') {
          $('event').textContent = `treasure +${t.value} (score +${t.score})`;
        } else if (t.outcome === 'unlocked') {
          opened++;
          $('event').textContent = `chest opened with key ${t.key} — +${t.value}, ` +
            `${t.loot.length} items thrown out`;
        } else if (t.outcome === 'locked') {
          $('event').textContent = `locked chest — needs key ${t.needsKey}`;
        }
      }
      if (fr.loot.settled.length) {
        lastBlockFx = fr.blockFx || [];
      lastBurstFx = fr.burstFx;
      if (fr.burstFx) sbStamps += fr.burstFx.stamped;
      lootLanded += fr.loot.settled.length;
        /* ⚠️ RE-RANK ON INSERT. `sortForDraw` runs once at level load and
         * `alloc` appends, so a settled item would otherwise draw AFTER the
         * weapon pickups — where graphics export 32's three-band partition
         * puts ordinary treasure BEFORE them. Same failure this project
         * already recorded from the other side, when a stable cat-3/cat-5
         * partition left the 55 weapon pickups where they started. */
        for (const s of fr.loot.settled) {
          level.drawObjects = insertSpawned(
            level.drawObjects.filter((o) => o !== s), level.cats, s);
        }
      }
      lastDebrisFx = fr.debrisFx || [];
      if (fr.emitted) shotsFired++;
      for (const c of fr.consumed) {
        consumed++;
        /* CS:0x6377 — over-healing is banked into DS:0x168 at 32 a point,
         * not discarded. UNKNOWN_DS_0168, so it is only counted here. */
        if (c.banked) banked += c.banked;
        $('event').textContent = c.notWired
          ? `"${c.name}" (${c.desc || 'no description'}) — ${c.effect}: ${c.notWired}`
          : c.effect === 'health'
            ? `potion +${c.health}`
            : `"${c.name}" — ${c.effect}` +
              (c.result && c.result.ticks ? ` for ${c.result.ticks} frames` : '') +
              (c.result && c.result.arc ? ` (${c.result.arc})` : '');
      }
      for (const p of fr.picked) {
        picked++;
        $('event').textContent = `picked up ${WEAPON_NAMES[p.weapon]}` +
          (p.duplicate ? ` (again — count ${p.count})` : ` into slot ${'ABC'[p.slot]}`);
      }
      /* plane-B cell -> event record -> selector 2 -> trigger evaluator */
      const fired = events.step(player.x, player.y,
        events.makeState({ timer: clock.tick, inventory }));
      if (fired) {
        /* The verb now RUNS (game/trigger-actions.js); `fired.result` says what
         * it did. Doors and gates write the live plane arrays, so the change is
         * on screen next frame. */
        const r = fired.result;
        const what = r
          ? `${ACTION_NAMES[fired.verb] || `verb ${fired.verb}`}` +
            (r.ok === false ? ` — refused (${r.reason || 'no effect'})` : '') +
            (r.missed ? ' — MISS (ACT8 dead-guard path)' : '')
          : `verb ${fired.verb}`;
        $('event').textContent =
          `trigger ${fired.trigger}: ${what}` + (fired.msg ? ` — “${fired.msg}”` : '');
      }
      /* CS:0x4189's dead `js` is reachable in shipped data — 5 of 48 ACT8
       * records. Report it rather than diverging quietly. */
      while (diverged.length) console.warn('[trigger]', diverged.shift());

      /* CS:0x4A6D — the hero-vs-zone scan; see game/zones.js for the full
       * citation, including the honest gap (its own caller in the original
       * is not located). Zones only exist once ACT3/ACT4 has fired one, so
       * this is a no-op on every level until then, exactly as shipped. */
      const zoneHit = scanZones(events.actionCtx.zones, player.x, player.y);
      if (zoneHit && zoneHit.kind === ZONE_TELEPORT) {
        const dest = unpackTeleportDest(zoneHit.arg);
        player.teleportTo(dest.x, dest.y);
        /* ⚠️ The camera is NOT re-centred here. CS:0x0FDF-0x1042 writes only
         * [0x17a]/[0x17c] (hero position) and never touches [0xa]/[0xc] (the
         * scroll origin this project's own camera.js already ports) — so a
         * teleport in the original is a hard cut for the hero but the camera
         * pans to catch up through its ordinary dead-zone logic, which the
         * unconditional `cam.update()` below already drives every tick. */
        $('event').textContent = `teleport zone -> (${dest.x}, ${dest.y})`;
      } else if (zoneHit && zoneHit.kind === ZONE_EXIT && !transitioning) {
        const dest = resolveExitDestination(zoneHit.arg);
        $('event').textContent = dest
          ? `level exit -> "${dest.text.trim()}"`
          : `level exit — arg ${zoneHit.arg} out of range, inert (CS:0x0FC8)`;
        if (dest) switchLevel(nextLevelKey(sel.value));   // fire-and-forget
      }

      /* CS:0x0282 — the nest walker, BEFORE the System-B entity step at
       * 0x0285 (below) and after the (unported) brood gate at 0x027F. */
      const nestContact = (box) => attackHero(
        { x: box.x, y: box.y, w: box.w, h: box.h, strength: box.hp },
        { x: player.x, y: player.y, state: player.stateIndex }, health,
        { invuln: fx.invuln > 0 }).strengthOut;
      const nestResult = nests.step(
        { x: cam.snapX, y: cam.snapY }, { x: player.x }, fx.freeze,
        nestContact, null, tock);
      for (const s of nestResult.shots) {
        shots.fire(s.x, s.y, s.dir, { x: cam.snapX, y: cam.snapY });
      }
      lastNestFx = nestResult.drawn;
      tock ^= 1;                                      // CS:0x0172 `not`

      runSpawns();
      /* THE HUNT. CS:0xf11f/0xf1e5 run the pathfinder only from the two walk
       * modes, only on a tile crossing, and only when standing on ground —
       * so the verdict is sticky for a whole tile and an airborne or falling
       * enemy never searches. Applying a verdict outside that gate re-seeds
       * the hop cursor every frame and freezes the entity in mid-air. */
      for (const e of enemies) {
        let verdict = VERDICT_NONE;
        const walking = e.mode === MODE.WALK_L || e.mode === MODE.WALK_R;
        if (e.alive && walking && (e.x & 0x1c) === 0
            && groundBelow(level.map.planeB, e.x, e.y)) {
          verdict = runSearch(e, {
            planeB: level.map.planeB,
            camX: cam.snapX, camY: cam.snapY,
            heroX: player.x, heroY: player.y,
            desc: e.desc,
            rnd: rng.next(),        // the single randomness input, CS:0x3836
            world: level.world,     // strategy 3's per-world waypoint list
            markers,                // DS:0xb5dc — empty until an attract potion
          }).verdict;
        }
        e.tick(level.map.planeB, verdict);
      }
      runSpawnsA();
      /* System A's own pipeline, CS:0xe001 — stages 1/2/4/5/6, per entity.
       * Stage 3 (the attack) is not ported; see entity-a.js's header. */
      for (const e of enemiesA) {
        const muzzle = e.tick(
          { x: player.x, y: player.y }, e.desc,
          () => rng.next(), fx.freeze > 0);
        if (muzzle) {
          firedByA++;
          shots.fire(muzzle.x, muzzle.y, muzzle.dir, { x: cam.snapX, y: cam.snapY });
        }
      }
      /* CS:0x0285 — contact, then the damage-grid scan, with contact winning.
       * Also in game/frame.js, for the same reason. Both entity arrays flow
       * through the SAME shared routine (CS:0xff93/0xac59 are proven common
       * to both systems — see CLAUDE.md's "Entity contact" section) — a
       * separate call here would silently make System-A creatures unable to
       * hurt or be hurt by the hero. */
      creaturesShot += stepCreatureDamage([...enemies, ...enemiesA], {
        grid, cam: { x: cam.snapX, y: cam.snapY },
        hero: { x: player.x, y: player.y, state: player.stateIndex },
        health, decodeTag, difficulty, arsenal,
        /* DS:0x172 — CS:0xACCC's `jnz` skips only the health subtraction, so
         * while this is set the hero takes no damage AND STILL KILLS what he
         * touches. Both the shield potion and spawn protection feed it. */
        invuln: fx.invuln > 0 ? 1 : 0,
      }).killed;
      /* CS:0x02BA — enemy shots move and hit, AFTER every emitter that can
       * fire one this tick (the nest at 0x0282, the entities at 0x0285), so
       * unlike the hero's own shots (which step BEFORE the player emits) an
       * enemy shot CAN hit on the very tick it is fired. A second, separate
       * damage path from the hero's own (CS:0x4501, not the grid) — see
       * enemy-shots.js's header for the three ways it differs. */
      /* CS:0x4561 — an enemy shot that hits the hero drops a stationary
       * debris puff too, through the SAME shared array as the projectile
       * terrain-stop puff (game/debris.js). The `debris` parameter existed
       * and was documented in this module before this pass; the caller
       * never passed the instance, AND never passed a health adapter this
       * module's own signature needs (`{invulnerable, hurt}` — the `Health`
       * class this file otherwise uses exposes `.damage()`/`fx.invuln`, not
       * that shape). Neither half of CS:0x4501 had ever actually run: no
       * live enemy shot had reached `hitsHero()` in this environment before
       * now, so the mismatch was silent. */
      lastShotsFx = shots.step(
        { x: cam.snapX, y: cam.snapY },
        { x: player.x, y: player.y, state: player.stateIndex },
        level.map.planeB,
        { invulnerable: fx.invuln > 0, hurt: (n) => health.damage(n) },
        debris);
      /* CS:0x02c6 — the bar chases the target one unit per frame, and the
       * death test reads the BAR, so a fatal hit leaves a rescue window. */
      /* CS:0x0186 `dec word [0x2fa]` floored at CS:0x018C, CS:0xA99B
       * `dec word [0x19c]` clearing DS:0x172 at zero, and the giant-jump word
       * on the same shape. One tick each, once per frame. */
      if (fx.freeze > 0) fx.freeze--;
      if (fx.invuln > 0) fx.invuln--;
      if (fx.giantJump > 0) fx.giantJump--;
      health.chase();
      cam.update(player.x, player.y, levelInfo);
    },
    () => {
      const camX = cam.snapX, camY = cam.snapY;
      renderer.clear(0);
      renderer.drawTilemap(level.map, level.tiles, camX, camY);
      /* OBJECTS, with real sprites: `170 + type`, or `302 + (type - 0xC0)` for
       * a weapon pickup. Drawn at (x, y) top-left, in the original's draw
       * order (cat-3/cat-5 behind, ordinary next, weapons on top — graphics
       * export 32). Dead slots are removed by a SIGN test at load, matching
       * CS:0x9000 `cmp word [si+0x4],0 / jns`. */
      for (const o of level.drawObjects) {
        /* CS:0x1924 writes 0xFFFF into the slot's type and 0 into its live
         * word; CS:0x9000 then tests the SIGN, not equality with 0xFFFF. A
         * collected object stops being drawn from that tick on. */
        if (o.dead) continue;
        const sx = o.x - camX, sy = o.y - camY;
        if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
        const oid = spriteForType(o.type);
        const of_ = hero && hero.frames[oid];
        if (of_ && !isUnstamped(o.type)) {
          renderer.blitSprite(of_, sx, sy);
        } else {
          /* Only reachable for a type in 132..191, which the stamp loop never
           * covers — zero such objects ship. Marked, never guessed. */
          unstamped++;
          renderer.strokeRect(sx - 2, sy - 2, 5, 5, 14);
        }
      }

      /* Breaking blocks. CS:0x7533 draws sprite `frame + [0x158]`, and
       * DS:0x158 is never written — so the sprite IS the frame, 0..3. */
      for (const b of lastBlockFx) {
        const bx = b.x - camX, by = b.y - camY;
        if (bx < -32 || by < -32 || bx > SCREEN_W || by > SCREEN_H) continue;
        const bf = hero && hero.frames[b.sprite];
        if (bf) renderer.blitSprite(bf, bx, by);
        else renderer.strokeRect(bx, by, 32, 16, 12);
      }

      /* Starburst particles. CS:0xA563 draws them with sprite 77 + phase,
       * a three-frame cycle the whole array shares. They are already in
       * screen space — the updater converted and culled them. */
      for (const pt of (lastBurstFx ? lastBurstFx.drawn : [])) {
        const sf = hero && hero.frames[pt.sprite];
        if (sf) renderer.blitSprite(sf, pt.x, pt.y);
        else renderer.strokeRect(pt.x - 1, pt.y - 1, 3, 3, 15);
      }

      /* Items still in flight out of an opened chest. CS:0x1356 draws them
       * with the SAME `170 + type` rule as a placed object — they are ordinary
       * treasure that happens to be moving, which is exactly why they can
       * settle into the object array and be collected. */
      for (const r of burst.records) {
        if (r.type < 0) continue;
        const sx = r.x - camX, sy = r.y - camY;
        if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
        const bf = hero && hero.frames[spriteForType(r.type)];
        if (bf) renderer.blitSprite(bf, sx, sy);
      }

      /* ENEMIES — sprite = class_base + MODE_ANIM[mode] + frame (CS:0xf0ae).
       * Drawn before the hero, matching the original's draw order. */
      for (const e of enemies) {
        /* CS:0xedf7 routes a negative state to the death path instead of the
         * draw call. That path is unread, so a dying creature is dropped from
         * the frame and counted, not drawn with its kill-frame of -1. */
        if (isDying(e)) { dying++; continue; }
        if (e.state === 0 || e.state === -2) continue;   // free / not yet visible
        const sx = e.x - camX, sy = e.y - camY;
        if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
        const eid = spriteForEntity(level.world, e.cls, e.mode, e.frame,
                                    MODE_TABLE.map((m) => m.animBase));
        const ef = eid !== null && hero && hero.frames[eid];
        if (ef && eid >= CREATURE_DESCRIPTOR_BASE) renderer.blitSprite(ef, sx, sy);
        else { outOfRange++; renderer.strokeRect(sx, sy, 24, 24, 12); }
      }

      /* SYSTEM-A ENEMIES — sprite = CS:0xe199, class base + frame (+ a
       * world-dependent facing offset). Drawn in the same pass as System B's,
       * since the original's shared draw call (CS:0x3569) doesn't
       * distinguish the two either. */
      for (const e of enemiesA) {
        if (e.state <= 0) continue;   // waiting / materialising / dying
        const sx = e.x - camX, sy = e.y - camY;
        if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
        const eid = spriteForEntityA(level.world, e.cls, e, CLASS_TABLES_A);
        const ef = eid !== null && hero && hero.frames[eid];
        if (ef) renderer.blitSprite(ef, sx, sy);
        else { outOfRange++; renderer.strokeRect(sx, sy, 24, 24, 11); }
      }

      /* THE WORLD-2 NEST CREATURE — CS:0x8611/0x8688, already in screen
       * space (nest.js computes x-camX/y-camY itself). Sprites 512-520
       * (the creature), 285 (the object it stands on), 108-114 (death). */
      for (const d of lastNestFx) {
        const nf = hero && hero.frames[d.sprite];
        if (nf) renderer.blitSprite(nf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 16, 16, 10); }
      }

      /* ENEMY SHOTS — CS:0x1FE7/0x2039, the shared mechanism by which any
       * shooting enemy fires (the nest, and now System A's stage 6). */
      if (lastShotsFx) for (const d of lastShotsFx) {
        const sf = hero && hero.frames[d.sprite];
        if (sf) renderer.blitSprite(sf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 8, 8, 9); }
      }

      /* DEBRIS — CS:0x1F73/0x356E, the stationary puff a shot leaves behind
       * when solid terrain stops it (CS:0xA816). Purely cosmetic: it cannot
       * hurt anything and cannot touch the map, so it draws through the
       * OTHER blitter (graphics export 2, not export 1) and is not stamped
       * into the damage grid. Sprite ids 58-68 — see game/debris.js. */
      for (const d of lastDebrisFx) {
        const df = hero && hero.frames[d.sprite];
        if (df) renderer.blitSprite(df, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 4, 4, 8); }
      }

      /* PROJECTILES. Drawn after the enemies and before the hero. The sprite
       * is the weapon's own pinned descriptor (+0x0c, or +0x1e when facing
       * selects the second one); the per-projectile animation frame (+0x04
       * against the +0x1c count) is runtime state this port does not yet step,
       * so the base frame is drawn rather than a guessed one.
       * UNKNOWN_projectile_frame. */
      for (const p of arsenal.live()) {
        const sx = p.x - camX, sy = p.y - camY;
        const pid = p.weapon.sprite;
        const pf = hero && hero.frames[pid];
        if (pf) renderer.blitSprite(pf, sx, sy);
        else { outOfRange++; renderer.strokeRect(sx, sy, 8, 8, 13); }
      }

      /* THE HERO. sprite = anim_base[state] + sign_extend(phase), then the
       * three hard remaps — ported verbatim from CS:0x5f77-0x5fa6.
       * ⚠️ `renderPhase`, not `phase`: walk+fire persists the raw counter in
       * DS:0x36b (CS:0x5D6B) and then renders through the DS:0xd950 recoil
       * table (CS:0x5D75). The two are different values in states 5 and 6. */
      const id = spriteFor(player.stateIndex, player.renderPhase);
      const frame = hero && hero.frames[id];
      if (frame) {
        renderer.blitSprite(frame, player.x - camX, player.y - camY);
      } else {
        /* Never draw a guessed sprite: if the id escapes the hero range the
         * box comes back and the counter below goes up, because a silently
         * wrong descriptor is exactly what this project must not ship. */
        outOfRange++;
        renderer.strokeRect(player.x - camX, player.y - camY, 32, 48, 15);
      }
      renderer.present(level.palette);

      $('fps').textContent = clock.fps.toFixed(0);
      $('pos').textContent = `${player.x},${player.y}`;
      const info = STATE_INFO[player.stateIndex];
      const ph = ((player.phase & 0xff) << 24) >> 24;
      const unmodelled = UNMODELLED_PHASE_STATES.includes(player.stateIndex);
      $('pstate').textContent =
        `${player.stateIndex} ${info.label} · phase ${ph}${unmodelled ? '*' : ''} · sprite #${id}` +
        (outOfRange ? ` · ${outOfRange} out-of-range!` : '') +
        (unstamped ? ` · ${unstamped} unstamped object types!` : '') +
        ` · ${enemies.filter((e) => e.alive).length}/${enemies.length} enemies` +
        ` · ${enemiesA.filter((e) => e.alive).length}/${enemiesA.length} sysA` +
        ` · ${nests.live} nests · ${shots.live} shots · ${debris.live} debris` +
        ` · hp ${health.bar}/${health.target > HEALTH_MAX ? HEALTH_MAX : health.target}`        + (health.dead ? ' DEAD' : '') +
        ` · money ${purse.total} · score ${score.value}` +
        ` · lives ${fx.lives}` +
        (fx.invuln ? ` · INVULN ${fx.invuln}` : '') +
        (fx.freeze ? ` · FROZEN ${fx.freeze}` : '') +
        (fx.giantJump ? ` · giant jump ${fx.giantJump}` : '') +
        (fx.arc ? ` · arc ${WEAPON_ARCS[fx.arc].name}` : '') +
        (blocks.broken || blocks.queue.some((q) => q.x >= 0)
          ? ` · blocks ${blocks.broken} broken` +
            (blocks.droppedHits ? `, ${blocks.droppedHits} hits DROPPED` : '') +
            (blocks.strandedSolid ? `, ${blocks.strandedSolid} STUCK SOLID` : '')
          : '') +
        (starburst.active ? ` · STARBURST ${starburst.liveCount} live` +
           ` (${starburst.bursts} bursts, ${starburst.chained} chained,` +
           ` ${sbStamps} stamps)` : '') +
        (fx.shop ? ' · SHOP (state machine suspended)' : '') +
        ` · chests ${opened} (keys dev-seeded)` +
        (lootLanded ? ` · ${lootLanded} loot landed` : '') +
        (burst.stranded ? ` · ${burst.stranded} loot STRANDED (object table full)` : '') +
        (slots.lostActivations ? ` · ${slots.lostActivations} activations lost (all slots busy)` : '');
      /* Every counter the fire chain can raise, surfaced rather than swallowed:
       * an undecoded or NULL spawn handler, an out-of-range projectile `dir`,
       * and how many stamps actually reached the grid. A shot that fires but
       * never stamps can hit nothing, and that is invisible without this. */
      const live = [...arsenal.live()].length;
      $('shots').textContent =
        `${shotsFired} fired · ${live} live · ${arsenal.stamped} stamps · ` +
        `${creaturesShot} killed · ${arsenal.hitTerrain} walled · ` +
        `${picked} picked up · ${consumed} consumed` +
        (banked ? ` (+${banked} banked)` : '') + ` · held ` +
        (arsenal.slots.map((sl, i) => sl.weapon < 0 ? null
           : `${'ABC'[i]}:${WEAPON_NAMES[sl.weapon]}x${sl.st.count - sl.st.base + 1}`)
          .filter(Boolean).join(' ') || 'nothing') +
        (arsenal.undecodedHandler ? ` · ${arsenal.undecodedHandler} undecoded handler!` : '') +
        (arsenal.nullHandler ? ` · ${arsenal.nullHandler} NULL handler!` : '') +
        (arsenal.outOfRange ? ` · ${arsenal.outOfRange} bad dir!` : '') +
        (arsenal.badWeaponIndex ? ` · ${arsenal.badWeaponIndex} bad weapon type!` : '');
    },
  );
  clock.start();
}

main().catch((e) => {
  document.getElementById('summary').className = 'bad';
  document.getElementById('summary').textContent = `fatal: ${e.message}`;
  console.error(e);
});
