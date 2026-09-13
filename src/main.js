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
import { parseMap, TILE_COUNTS } from './formats/map.js';
import { parseAtlas, cutAll } from './formats/atlas.js';
import { Clock, LOGIC_HZ } from './engine/clock.js';
import { Renderer } from './render/renderer.js';
import { Player, ST } from './game/player.js';
import { runAllChecks, checkDescriptorAnchors, checkHeroSprites,
         checkSelectorsAndObjects, checkSpawn, checkEntityB, checkEntityA, checkSpawnA,
         checkWeaponsProjectiles, checkTriggerActions,
         checkZones, checkPopup } from './verify/checks.js';
import { EventRunner, parsePalfils, palfilsNameFor } from './game/events.js';
import { makeActionContext, makeGates, DOOR_TILES,
         ACTION_NAMES } from './game/trigger-actions.js';
import { cameraForSpawn } from './game/camera.js';
import { spriteFor, STATE_INFO, UNMODELLED_PHASE_STATES } from './game/states.js';
import { buildDescriptorMap, GROUP_STEMS, HERO_DESCRIPTOR_MAX } from './formats/descriptors.js';
import { spriteForType, parseObjectCategories, sortForDraw, isDeadType,
         isUnstamped, OBJECT_SLOTS, activationBox,
         activateObjects, insertSpawned,
         stepObjectFall, isFallEligible, dropCarriedItem } from './game/objects.js';
import { parseObjectRecords, Score, Purse, TreasureBurst, INVENTORY_EMPTY,
         CHEST_MIN, CHEST_MAX, chestKeyFor } from './game/treasure.js';
import { CONSUMABLES, WEAPON_ARCS, INVULN_TICKS_SPAWN } from './game/consumables.js';
import { Starburst, SPRITE_BASE as SB_SPRITE } from './game/starburst.js';
import { Destructibles } from './game/destructible.js';
import { resetWeaponArc, setWeaponArc, projectileSprite } from './game/projectiles.js';
import { parseGroupsB, parseGroupsA, GroupSlots, spriteForEntity, MAX_ENTITIES,
         CREATURE_DESCRIPTOR_BASE } from './game/spawn.js';
import { EntityB, MODE, MODE_TABLE, groundBelow, isDying, EST,
DEATH_SPRITE_BASE, DEATH_FRAMES, stealAttemptB, stepCarriedItemB,
groupRewardPosition } from './game/entity.js';
import { EntityA, CLASS_TABLES_A, spriteForEntityA, EST as ESTA,
groupRewardPositionA,
isDyingA, DEATH_SPRITE_BASE_A, DEATH_FRAMES_A, stepCarriedItem } from './game/entity-a.js';
import { VERDICT_NONE } from './game/pathfind.js';
import { runSearch } from './game/pathfind-producers.js';
import { GodsRandom } from './game/random.js';
/* Contact and the grid scan are reached through game/frame.js, which owns the
 * order they must run in — see the note there. */
import { Health, HEALTH_MAX, attackHero } from './game/combat.js';
import { Nests, Brood } from './game/nest.js';
import { Statues } from './game/statue.js';
import { Ce64Creatures, Ce64Spits, OBJECT_TYPE as CE64_OBJECT_TYPE } from './game/ce64.js';
import { EnemyShots } from './game/enemy-shots.js';
import { LineHazards } from './game/line-hazard.js';
import { SelectorTwoSpawns, parseClasses as parseSelectorTwoClasses } from './game/selector2.js';
import { PatGroups, parsePatDirectory, parsePatSpawnDescriptor } from './game/pat-objects.js';
import { MarkerList, stepMarkers } from './game/markers.js';
import { Debris } from './game/debris.js';
import { Popup } from './game/popup.js';
import { Arsenal, spawnableWeapons } from './game/hero-fire.js';
import { stepHeroFrame, stepCreatureDamage } from './game/frame.js';
import { DamageGrid, damageForTag } from './game/collision.js';
import { parseWeapons } from './game/weapons.js';
import { pickUpWeapon } from './game/pickup.js';
import { scanZones, unpackTeleportDest, resolveExitDestination,
         ZONE_TELEPORT, ZONE_EXIT } from './game/zones.js';

const LEVELS = ['1A','1B','2A','2B','3A','3B','4A','4B'];

/* The hero's spawn point on a fresh level load, GAME.EXE's DS:0x15a/0x15c.
 * NOT derived from the .MAP or PALFILS data at all — it is a hardcoded
 * per-world table at DS:0xe8ca (4 records of {u16 x, u16 y}), read directly
 * off the image and indexed by world (FUN_1000_2a37, CS:0x2AB5-0x2ACC). All
 * four points land inside the 4096x1024 world bounds, which is itself a
 * check on the read. */
const SPAWN_TABLE = {
  1: { x: 64,   y: 944 },
  2: { x: 3888, y: 112 },
  3: { x: 64,   y: 48  },
  4: { x: 384,  y: 496 },
};

function levelSpawn(world) {
  return SPAWN_TABLE[world] || { x: 64, y: 64 };
}

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
  /* PALFILS +0x0718 — selector-2's own stationary-turret class descriptors
   * (game/selector2.js). Same window System-B's own per-world class table
   * loader (CS:0xad62) is unrelated to; this one is level-authored data. */
  const groupsSel2 = parseSelectorTwoClasses(dclDecompress(pfRaw).data);
  /* PALFILS +0x0000 — selector-1's own PGOD0x.PAT spawn descriptors
   * (game/pat-objects.js), 100 records of 8 bytes. Parsed unconditionally
   * (the window exists in every PALFILS file); whether any of the 100
   * indices is ever actually reachable from a shipped trigger on this
   * particular level is not filtered here, matching how groupsA/groupsB/
   * groupsSel2 are also parsed in full above. */
  const patDescriptors = Array.from({ length: 100 },
    (_, i) => parsePatSpawnDescriptor(palfilsData, i));
  /* CS:0x3855 — `PGOD0<world>.PAT` loads ONLY on sublevel 'a'
   * (`cmp byte [0x43],0 / jnz`). `key[1]` is 'A' or 'B' (palfilsNameFor's
   * own convention), so this mirrors that gate exactly. A fetch failure
   * (e.g. the asset genuinely missing) leaves both `null` rather than
   * throwing — the level still loads, just with zero PAT objects. */
  let patDirectory = null, patBlobBytes = null;
  if (key[1] === 'A') {
    try {
      const patRaw = await fetchRaw(`game/PGOD0${key[0]}.PAT`);
      patBlobBytes = dclDecompress(patRaw).data;
      patDirectory = parsePatDirectory(patBlobBytes);
    } catch (e) {
      console.warn(`PGOD0${key[0]}.PAT failed to load — PAT objects inert on this level`, e);
    }
  }
  const drawObjects = sortForDraw(map.objects.filter((o) => !isDeadType(o.type)), cats);

  /* PWEAPONS is per-world, and Power (+0x06) genuinely differs between them —
   * the axe is 4 in worlds 1-2 and 12 in 3-4. The sprite fields and the pickup
   * count are pinned at the EXE-image values by the loader, so they are served
   * from the pinned tables in weapons.js, not from these bytes. */
  const weapons = parseWeapons(
    dclDecompress(await fetchRaw(`game/PWEAPONS.00${key[0]}`)).data);

  return { map, sheet, palette, tiles, tileCount: count, palfils, palfilsRaw: palfilsData, cats, drawObjects,
           objValues, groupsB, groupsA, groupsSel2, patDescriptors, patDirectory, patBlobBytes,
           weapons, world: +key[0] };
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
    Promise.resolve(checkPopup()),
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

  let spawn = levelSpawn(level.world);
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
   * over the arsenal's live slots so the creature scan needs no other state.
   * `mode` defaults to 0 (every ordinary creature); the DS:0xce64 world-3
   * creature (game/ce64.js) forces mode:1 around its own contact/scan call,
   * which is what makes the starburst/invulnerability-aura potions deal it
   * only 50/0 damage instead of the usual 10000/10000 — see ce64.js's header. */
  const decodeTag = (tag, mode = 0) => damageForTag(
    tag,
    arsenal.slots.map((s) => s.weapon),
    Object.fromEntries(arsenal.slots.filter((s) => s.st).map((s) => [s.weapon, s.st])),
    mode);
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
  let lastNestFx = [], lastShotsFx = null, lastDebrisFx = [], lastLineHazardFx = null;
  let lastBroodFx = [], lastStatueFx = [], lastCe64Fx = [], lastSpitFx = [], lastSelectorTwoFx = [];
  let lastPatFx = [];
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
  /* DS:0xb5dc — the marker list strategy 2 heads for, game/markers.js.
   * Populated below by the SAME per-object walk that drives fall physics
   * (CS:0x1511-0x1668) — every on-screen category<3 object appends one,
   * every frame, NOT gated on the hero touching it; a type-45 "attracts
   * monsters" potion resets the list and forces every System-B enemy onto
   * strategy 2 (DS:0x399). See game/markers.js's own header for why this is
   * a hard-capped, freeze-until-reset buffer rather than an accumulating
   * trail, and why its coordinates are screen-relative and FROZEN at write
   * time rather than world coordinates. */
  let markerList = new MarkerList();
  let slots = new GroupSlots();
  let enemies = [];
  let slotsA = new GroupSlots();
  let enemiesA = [];
  /* CS:0xBF5F/0xBF80 — the single-slot floating item-icon popup (game/
   * popup.js). Feeds selector2.js's own already-computed `rewards` array
   * (previously grown forever and never drained) and, below, System-B's own
   * per-GROUP elimination reward (`UNKNOWN_f030_item_drop`, descriptor
   * +0x10, spawn.js's `rewardId`) — both were fully decoded but had no
   * rendering module before this pass. */
  let popup = new Popup();
  /* Per-GROUP tracking for System-B's own elimination reward — NOT provided
   * by GroupSlots (which only tracks activation, never per-entity
   * membership or completion). Each entry mirrors the ORIGINAL's own
   * group-runtime "reward already given" latch (CS:0xEDAA/0xEDA6): fires
   * once every member is dead-or-dying (`state <= 0`, matching the
   * original's `(dead+dying) === count` test — this port's simple DYING
   * sentinel makes the two equivalent), at whichever member's own (frozen,
   * post-death) position happens to be read last. */
  let groupsB = [];
  /* System-A's OWN, separate group-elimination reward (CS:0xDFAC-0xE000,
   * `UNKNOWN_sysA_0x1f4_elimination_detector`) — a distinct mechanism from
   * System-B's above, not a duplicate, despite the identical +0x10 offset
   * on a different 50-record descriptor table. Same reward-fire condition
   * as System B (dead-or-dying === count, CS:0xDFC4); the original's
   * STRICTER dead-only slot-free condition (CS:0xDFF5) is not modelled
   * here either, for the same reason System B's own block above doesn't:
   * this port's GroupSlots has no fixed runtime-slot cap to recycle. */
  let groupsA = [];
  /* Stage 6 (CS:0xe659) is ported and now wired end to end for BOTH entity
   * systems: the reload timer, facing test and muzzle computation feed the
   * shared EnemyShots array below, the same one the nest creature fires
   * through. Counted separately per system so the split between the two
   * firing paths stays visible. */
  let firedByA = 0;
  let firedByB = 0;

  /* CS:0x8611 / CS:0x1FE7-0x2039 — the world-2 nest creature and the shared
   * enemy-shot array both exist as fully-ported, fully-tested modules
   * (nest.js, enemy-shots.js) that no caller in this file instantiated
   * before this pass. Wiring them here closes that gap for real, not just
   * for System A's stage 6. */
  let nests = new Nests(level.world, rng);
  let shots = new EnemyShots();
  /* CS:0x894E — the world-2 nest's own brood children, DS:0x8014 (world 2
   * only; NOT to be confused with the world-1 statue table below, which
   * shares the same DOS address by coincidence — game/statue.js's own header
   * explains why a JS port owns two separate arrays rather than one). Passed
   * into `nests.step()` below in place of the `null` this file previously
   * used, which is what silently made every nest death spawn nothing. */
  let brood = new Brood();
  /* CS:0x7CBD/0x7B68/0x7C4B/0x7C7C — the world-1-sublevel-B awakened statue
   * (game/statue.js). Populated from the CURRENT level's own plane A once
   * `levelInfo` exists, below, and again on every level switch. */
  let statues = new Statues();
  /* CS:0x7F0D — the world-3 DS:0xce64 creature and its "spit" sub-projectile
   * (game/ce64.js). Unlike nest.js/statue.js this module calls combat.js
   * directly, so main.js just hands it the real health/grid/decodeTag rather
   * than an injected closure. */
  let ce64Creatures = new Ce64Creatures(rng);
  let ce64Spits = new Ce64Spits(rng);
  /* DS:0xd2be — the Bresenham line-hazard pool (game/line-hazard.js).
   * CS:0xE659's `attackBits` divert to CS:0xE5E4 is wired for BOTH entity
   * systems: entity-a.js's `stageFacingAndFire` (called LAST, as stage 6) and
   * entity.js's `fireB` (called FIRST, before the DS:0xdbe0 mode dispatch —
   * see fireB's own header for why the two systems' call order differs) both
   * return a `{hazard:true,...}` descriptor instead of a muzzle when
   * attackBits != 0; both are routed the same way below. */
  let lineHazards = new LineHazards();
  let firedHazardsByA = 0;
  let firedHazardsByB = 0;
  /* CS:0xAD88/0xAD0D — the selector-2 stationary shooting turrets
   * (game/selector2.js). Reuses the SAME `shots`/`lineHazards` instances
   * every other emitter in this file shares — a turret's shot or hazard
   * fragment lives in the identical pool as the hero's projectiles and
   * enemy-shot family, exactly like the original's own shared arrays. */
  let selectorTwo = new SelectorTwoSpawns();
  /* CS:0xB908 — the selector-1 PGOD0x.PAT scripted objects
   * (game/pat-objects.js). `patDirectory`/`patBlobBytes` are `null` outside
   * sublevel 'a' (CS:0x3855's own load gate) or if the file failed to load,
   * in which case this stays permanently empty rather than throwing. */
  let patGroups = new PatGroups(level.patDirectory || []);
  patGroups.blobBytes = level.patBlobBytes || null;
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
    events.onSpawn2 = (param) => {
      const d = level.groupsSel2[param];
      if (!d || !d.live) return;
      selectorTwo.spawn(d, level.world);
    };
    events.onSpawn1 = (param) => {
      const d = level.patDescriptors && level.patDescriptors[param];
      if (!d) return;
      patGroups.activate(d, level.world);
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
      const members = [];
      for (let i = 0; i < n; i++) {
        const e = Object.assign(
          new EntityB({ x, y, mode, speed: d.speed, hp: d.hp || 1,
                        cls: d.cls, delay }),
          { desc: d });      // the pathfinder reads +0x08/+0x09/+0x0c/+0x0d
        enemies.push(e);
        members.push(e);
        delay += d.stagger;
      }
      /* CS:0xEDAA/0xEDA6 — this batch's own "reward already given" latch,
       * tracked here since GroupSlots has no per-entity membership of its
       * own. See spawn.js's `rewardId` and the file-header note on `popup`. */
      groupsB.push({ desc: d, members, rewardGiven: false });
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
      const members = [];
      for (let i = 0; i < n; i++) {
        const e = Object.assign(
          new EntityA({ x, y, cls: d.cls, hp: d.hp || 1, delay: 0 }),
          { desc: d });
        enemiesA.push(e);
        members.push(e);
      }
      /* CS:0xDFED/DFDB — System-A's own "reward already given" latch, the
       * same shape as groupsB's above (this port has no group-runtime slot
       * of its own to hang it off, unlike CS:0xdf39's own `[bp+0x10]`). */
      groupsA.push({ desc: d, members, rewardGiven: false });
      slot.state = 1;
    }
  };
  /* CS:0x2189-0x21C1 (FUN_1000_2189): camera = clamp(spawn - (0x90,0x48)).
   * Proven, not guessed — see cameraForSpawn()'s own header in camera.js. */
  const camInit = (s) => cameraForSpawn(s.x, s.y);
  let cam = camInit(spawn);
  let levelInfo = { world: +LEVELS[0][0], sublevel: LEVELS[0][1] === 'A' ? 0 : 1 };
  /* CS:0x7E9B — the statue populator wants a 'a'/'b' string, not levelInfo's
   * own 0/1 encoding; producing zero records outside world 1 sublevel B is
   * the single invariant this module cares about most. */
  const sublevelLetter = (info) => (info.sublevel === 1 ? 'b' : 'a');
  statues.populate(level.map.planeA, levelInfo.world, sublevelLetter(levelInfo));
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
      spawn = levelSpawn(level.world);
      player = new Player(spawn.x, spawn.y);
      events = new EventRunner(level.map, level.palfils);
      slots = new GroupSlots(); enemies = []; clamped = 0; firedByB = 0;
      slotsA = new GroupSlots(); enemiesA = []; clampedA = 0; firedByA = 0;
      firedHazardsByA = 0; firedHazardsByB = 0;
      groupsB = []; groupsA = []; popup = new Popup();
      rng = new GodsRandom(1);
      nests = new Nests(level.world, rng); shots = new EnemyShots(); tock = 0;
      lineHazards = new LineHazards();
      markerList = new MarkerList();                    // CS:0x1437
      brood = new Brood();
      ce64Creatures = new Ce64Creatures(rng); ce64Spits = new Ce64Spits(rng);
      selectorTwo = new SelectorTwoSpawns();
      patGroups = new PatGroups(level.patDirectory || []);
      patGroups.blobBytes = level.patBlobBytes || null;
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
      statues.clear().populate(level.map.planeA, levelInfo.world, sublevelLetter(levelInfo));
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
   * only 7 of the 11 weapons have a decoded spawn handler and a given level
   * may not place one of those seven — it forces a weapon so the fire chain
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
       * writes. The box is recomputed from the SNAPPED camera. Passing `cats`
       * is what arms `fallDirty` on the same inactive->active edge CS:0x120F
       * marks dirty — see game/objects.js's fall-physics block. */
      activateObjects(level.drawObjects, activationBox(cam.snapX, cam.snapY), level.cats);
      /* "in the DOS version the items don't stay up in the air but fall down
       * once they come into view" — CS:0x1511-0x1631, one object per call,
       * BEFORE the pickup contact test below (same order as the original's
       * single per-object walk: fall/bounce first, CS:0x168E's pickup call
       * second, same object, same tick). Only objects `activateObjects` just
       * armed (weapons, or category < 3) carry `fallDirty` at all. */
      for (const o of level.drawObjects) {
        if (o.dead || !(o.flag6 & 1)) continue;
        stepObjectFall(level.map, o);
      }
      /* CS:0x160D, the SAME per-object body as the fall physics above (one
       * function, one gate) — every on-screen category<3 object appends a
       * marker every frame. See game/markers.js. */
      stepMarkers(level.drawObjects, level.cats, markerList,
                  { x: cam.snapX, y: cam.snapY });
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
      /* CS:0x1C7D `call 0x7f0d` — the world-3 DS:0xce64 creature's own spawn,
       * reached the same way as the nest's (object-walk, category-4 arm).
       * ⚠️ UNLIKE THE NEST, this object is only marked dead on a SUCCESSFUL
       * spawn — ce64.js's own header: "the sole caller CS:0x1C7D correctly
       * retries a full pool rather than consuming the object", the opposite
       * of the nest's own documented shipped bug just above. */
      for (const o of level.drawObjects) {
        if (o.dead || o.type !== CE64_OBJECT_TYPE || !(o.flag6 & 1)) continue;
        if (ce64Creatures.spawn(o.x - cam.snapX, o.y, cam.snapX)) o.dead = true;
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
        burst, tock,
        /* CS:0x38D7 — first-fit over the 200-slot runtime array. `drawObjects`
         * already excludes the map's dead slots, so the headroom here is
         * 200 minus what is live, which is the same number the original has. */
        alloc: () => {
          const live = level.drawObjects.reduce((n, o) => n + (o.dead ? 0 : 1), 0);
          if (live >= OBJECT_SLOTS) return null;
          const s = { x: 0, y: 0, type: 0, flag6: 1, dead: false };
          /* CS:0x13E0 marks the burst-settled loot's own dirty byte 0xFF the
           * instant it materializes into a real object, same mechanism as
           * activateObjects' CS:0x120F. Harmless fidelity: burst physics
           * already computes a resting position, so this is normally a
           * single immediate re-land (CS:0x1511 sees it already grounded and
           * row-aligned) rather than a visible drop. `s.type` is 0 here and
           * gets overwritten by the caller before use, so re-check eligibility
           * once the real type is known would need a second pass — the type
           * is always < 0xC0 treasure/consumable loot in practice (category
           * < 3), so arming it unconditionally matches shipped behaviour. */
          s.fallDirty = -1;
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
        /* CORRECTION to an earlier revision of this comment, which claimed
         * the camera is NOT re-centred on teleport. CS:0x100F, inside
         * FUN_1000_0fac's teleport-execution tail, is CALL FUN_1000_2189 —
         * the same level-load/respawn camera-init routine camera.js's
         * cameraForSpawn() now ports — called unconditionally, right after
         * [0x17a]/[0x17c] are snapped to the destination. So a teleport in
         * the original IS a hard cut for the camera too, not a dead-zone
         * catch-up. See game/zones.js's own header for the two sibling
         * calls at CS:0x1012/0x1015 (destructible-block restore; the third
         * still untraced). */
        cam = cameraForSpawn(dest.x, dest.y);
        $('event').textContent = `teleport zone -> (${dest.x}, ${dest.y})`;
      } else if (zoneHit && zoneHit.kind === ZONE_EXIT && !transitioning) {
        const dest = resolveExitDestination(zoneHit.arg);
        $('event').textContent = dest
          ? `level exit -> "${dest.text.trim()}"`
          : `level exit — arg ${zoneHit.arg} out of range, inert (CS:0x0FC8)`;
        if (dest) switchLevel(nextLevelKey(sel.value));   // fire-and-forget
      }

      /* CS:0x0282 — the nest walker, BEFORE the System-B entity step at
       * 0x0285 (below) and after the CS:0x027F brood gate (game/nest.js's
       * `Brood`, now wired below instead of the `null` this file used to
       * pass, which is what silently made every nest death spawn nothing). */
      const camNow = { x: cam.snapX, y: cam.snapY };
      const nestContact = (box) => attackHero(
        { x: box.x, y: box.y, w: box.w, h: box.h, strength: box.hp },
        { x: player.x, y: player.y, state: player.stateIndex }, health,
        { invuln: fx.invuln > 0 }).strengthOut;
      const nestResult = nests.step(
        camNow, { x: player.x }, fx.freeze,
        nestContact, brood, tock);
      for (const s of nestResult.shots) {
        shots.fire(s.x, s.y, s.dir, camNow);
      }
      lastNestFx = nestResult.drawn;
      /* CS:0x894E — the brood children a nest death just spawned (if any).
       * Ground-bounce honours "freezes aliens"; ballistic fall ignores it —
       * see Brood#step's own header for why that asymmetry is real. */
      lastBroodFx = brood.step(camNow, fx.freeze, nestContact, level.map.planeB).drawn;
      tock ^= 1;                                      // CS:0x0172 `not`

      /* CS:0x7CBD/0x7B68 — the world-1-sublevel-B awakened statue. `statues`
       * is empty (zero records) outside world 1 sublevel B, so this is a
       * cheap no-op everywhere else. The trigger's own "don't wake on the
       * hero" probe and the live creature's contact test share the SAME
       * `nestContact` shape (`(box) => strengthOut`), since both are plain
       * attackHero calls with a caller-supplied box. */
      const statueScanGrid = (entity) => {
        const r = creatureScansGrid(entity, grid, camNow, decodeTag,
                                     difficulty, undefined, null,
                                     { rng: () => rng.next(), debris });
        return { killed: r.killed };
      };
      statues.checkTrigger(camNow, level.map.planeA, levelInfo.world, health,
                            nestContact, rng);
      const statueResult = statues.step(
        camNow, { x: player.x, y: player.y }, fx.freeze,
        nestContact, statueScanGrid, tock);
      score.add(statueResult.score);
      lastStatueFx = statueResult.drawn;

      /* CS:0x7F0D — the world-3 DS:0xce64 creature and its "spit". Neither
       * module needs injected callbacks (see ce64.js's own header for why it
       * calls combat.js directly, unlike nest.js/statue.js), so this just
       * hands them the real objects. */
      const ce64Opts = { invuln: fx.invuln > 0, difficulty, debris, score };
      lastCe64Fx = ce64Creatures.step(
        camNow, { x: player.x, y: player.y, state: player.stateIndex }, fx.freeze,
        health, grid, decodeTag, ce64Spits, ce64Opts).drawn;
      lastSpitFx = ce64Spits.step(
        camNow, { x: player.x, y: player.y, state: player.stateIndex }, fx.freeze,
        health, grid, decodeTag, ce64Opts).drawn;

      /* CS:0xAD88/0xAD0D — the selector-2 stationary shooting turrets
       * (game/selector2.js). `fire`/`spawnHazard` route into the SAME
       * `shots`/`lineHazards` pools every other emitter in this file
       * shares. `spawnHazard`'s target is deliberately the bare, unjittered
       * `hero.x+8, hero.y+6` this system's own CS:0xDBC6 computes — NOT
       * `lineHazards.spawnJittered`'s own jittered target — see
       * selector2.js's own `stepHandlerB` header for why. */
      lastSelectorTwoFx = selectorTwo.step(
        camNow, { x: player.x, y: player.y, state: player.stateIndex }, fx.freeze,
        health, grid, decodeTag, tock,
        (wx, wy, vx, cam) => shots.fire(wx, wy, vx, cam),
        (wx, wy, n, cam) => lineHazards.spawn(wx, wy, player.x + 8, player.y + 6, n),
        { invuln: fx.invuln > 0, score, debris }).drawn;

      /* CS:0xB987 — the PGOD0x.PAT scripted objects (game/pat-objects.js).
       * Reuses the SAME `shots`/`lineHazards` pools every other emitter in
       * this file shares. CS:0xBCCF's own contact/damage is now wired too
       * (attackHero, then — if that missed — creatureScansGrid, the SAME
       * canonical shape frame.js's stepCreatureDamage and this file's own
       * ce64Creatures.step() call already use), so a PAT object can now be
       * killed by the hero's touch or by a weapon hit, and awards score on
       * death via pat-objects.js's own `scoreForKey`. */
      lastPatFx = patGroups.step(
        camNow, fx.freeze, shots, lineHazards,
        { x: player.x, y: player.y, state: player.stateIndex }, () => rng.next(), tock, null,
        health, grid, decodeTag,
        { invuln: fx.invuln > 0, difficulty, rng: () => rng.next(), debris, score });

      runSpawns();
      /* CS:0xC041, via objects.js's dropCarriedItem — steal-and-carry's own
       * periodic and death-time drops both land here, for BOTH entity
       * systems (moved above the System-B loop, which now also needs it —
       * see CS:0xEE61/EEB1/F054/F059, entity.js's own stepCarriedItemB and
       * the DYING branch). Re-ranks the object array on a successful drop,
       * same reason as the treasure-burst loot settle below: allocObject
       * reuses a dead slot in place, but this port's own draw order is a
       * one-time sort at load, not a per-frame partition like the
       * original's export 32. */
      const dropCarriedIntoWorld = (id, x, y) => {
        const dropped = dropCarriedItem(level.drawObjects, id, x, y);
        if (dropped) {
          level.drawObjects = insertSpawned(
            level.drawObjects.filter((o) => o !== dropped), level.cats, dropped);
        }
      };
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
            markers: markerList.entries,       // DS:0xb5dc
            markersOverride: markerList.override,   // DS:0x399
          }).verdict;
        }
        /* CS:0xE659, called BEFORE the mode dispatch for System B (see
         * entity.js's fireB header) — the muzzle/hazard it returns is routed
         * exactly like System A's own stage 6, below. */
        const muzzleB = e.tick(level.map.planeB, verdict, e.desc);
        if (muzzleB && muzzleB.hazard) {
          firedHazardsByB++;
          if (muzzleB.attackBits === 1) {
            lineHazards.spawnJittered(muzzleB.x, muzzleB.y, player.x, player.y,
                                       muzzleB.n, () => rng.next());
          } else {
            lineHazards.spawnAtHero(muzzleB.x, muzzleB.y, player.x, player.y, muzzleB.n);
          }
        } else if (muzzleB) {
          firedByB++;
          shots.fire(muzzleB.x, muzzleB.y, muzzleB.dir, { x: cam.snapX, y: cam.snapY });
        }
        /* Steal-and-carry, System B — CS:0xEF01/0xEE06-0xEEB1. Unlike System
         * A, this runs for every ALIVE entity every tick regardless of its
         * own current mode/strategy (entity.js's own file header, point 1) —
         * the gate is the global `stealGate`, not this entity's strategy.
         *
         * ORDERING (load-bearing, invisible from either function alone):
         * this runs AFTER e.tick() above, which already ran the mode
         * dispatch (walk/fall/hop) — matching the original, where CS:0xEDDA
         * sits between the mode handler (CS:0xEDD3) and the contact test
         * (CS:0xEDF4), so a steal attempt sees the entity's POST-MOVE
         * position for this tick. stepCreatureDamage (contact) runs later,
         * after the whole `enemies` loop below, so the steal also sees
         * PRE-CONTACT state — an entity that is about to take damage this
         * tick still steals normally. */
        if (e.alive) {
          stealAttemptB(e, markerList.entries, e.desc, { x: cam.snapX, y: cam.snapY },
                         level.drawObjects);
          const carriedB = stepCarriedItemB(e, e.desc, level.world, () => rng.next());
          if (carriedB) dropCarriedIntoWorld(carriedB.id, carriedB.x, carriedB.y);
        }
        if (e.deathDropId !== null) {
          popup.spawn(e.deathDropX, e.deathDropY, e.deathDropId, level.drawObjects);
          e.deathDropId = null;
        }
      }
      runSpawnsA();
      /* System A's own pipeline, CS:0xe001 — all six stages, per entity.
       * camera/markers unlock strategies 1/2 (CS:0xe9da/0xe88c); grid unlocks
       * stage 3's attack/leap (CS:0xe487); the object array unlocks strategy
       * 2's own theft attempt (CS:0xE90E). All four are optional on tick()'s
       * own signature, so this call is the only thing that actually arms
       * them — see entity-a.js's header for what each one does. */
      for (const e of enemiesA) {
        const muzzle = e.tick(
          { x: player.x, y: player.y }, e.desc,
          () => rng.next(), fx.freeze > 0,
          { x: cam.snapX, y: cam.snapY }, markerList.entries, grid, level.drawObjects);
        if (muzzle && muzzle.hazard) {
          /* CS:0xE5E4 — attackBits 1 throws at a jittered point near the
           * hero; 2 or 3 throw at the hero's exact position, muzzle +0x10 X. */
          firedHazardsByA++;
          if (muzzle.attackBits === 1) {
            lineHazards.spawnJittered(muzzle.x, muzzle.y, player.x, player.y,
                                       muzzle.n, () => rng.next());
          } else {
            lineHazards.spawnAtHero(muzzle.x, muzzle.y, player.x, player.y, muzzle.n);
          }
        } else if (muzzle) {
          firedByA++;
          shots.fire(muzzle.x, muzzle.y, muzzle.dir, { x: cam.snapX, y: cam.snapY });
        }
        /* CS:0xE0C1-E198 — the carried-icon ease + probabilistic periodic
         * drop, a separate call site from tick()'s own six-stage pipeline
         * (entity-a.js's file header explains why) — only for a genuinely
         * ALIVE entity, matching the original's own alive-branch placement. */
        if (e.alive) {
          const carried = stepCarriedItem(e, e.desc, () => rng.next());
          if (carried) dropCarriedIntoWorld(carried.id, carried.x, carried.y);
        }
        /* CS:0xE25C-E282 — the one-shot death-time drop, recorded by tick()'s
         * own DYING branch (once, on the frame===-1 tick) and drained here
         * via popup.js (CS:0xBF5F), NOT dropCarriedIntoWorld/C041 — the
         * original genuinely calls the two different routines from these two
         * different sites. `level.drawObjects` arms popup's own busy-slot
         * divert to C041, closing that module's previously-disclosed gap. */
        if (e.deathDropId !== null) {
          popup.spawn(e.deathDropX, e.deathDropY, e.deathDropId, level.drawObjects);
          e.deathDropId = null;
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
        /* CS:0xAC4C — a weapon hit that damages a creature WITHOUT killing it
         * drops a stationary debris spark inside its own hitbox. Closes the
         * last of the five CS:0xA633 callers this port's debris pass tracked. */
        rng: () => rng.next(), debris,
        /* DS:0x172 — CS:0xACCC's `jnz` skips only the health subtraction, so
         * while this is set the hero takes no damage AND STILL KILLS what he
         * touches. Both the shield potion and spawn protection feed it. */
        invuln: fx.invuln > 0 ? 1 : 0,
      }).killed;
      /* `UNKNOWN_f030_item_drop` — System-B's own per-GROUP elimination
       * reward. CS:0xED78-ED80 sums `[0x3c3]` (state===0, dead) + `[0x1f4]`
       * (state<0 and NOT -2/-3, i.e. DYING) and compares to the descriptor's
       * own entity count — a LIVE per-tick recount, not a latch, so this is
       * `.every(...)` here too rather than a monotonic flag.
       * ⚠️ Correction to an earlier revision of this block, caught by
       * advisor() review before this was declared done: `state <= 0` is
       * WRONG — EST.WAITING (-2) and EST.MATERIALISING (-3) both satisfy
       * `<= 0`, so a freshly-spawned group (every member still waiting to
       * materialise) would have satisfied this the SAME tick runSpawns()
       * populated `members`, firing the reward at spawn rather than at
       * elimination. The original's own ff20 dispatch explicitly routes -2
       * and -3 away from the dying tally, so only FREE (0) and DYING (-1)
       * may count — exactly EST.FREE/EST.DYING here.
       * One acknowledged, disclosed timing gap: on the ORIGINAL, an entity
       * killed by THIS tick's own contact test is still mid-pass through the
       * "alive" branch and does not reach ff20/f030 until the FOLLOWING
       * tick, so a same-tick kill cannot complete a group until one tick
       * later. This port's flat (not per-group) entity loop makes that
       * one-tick deferral awkward to reproduce exactly, so a kill via
       * stepCreatureDamage (run once per tick, after every entity's own
       * tick()) can complete a group on the SAME tick here — a disclosed,
       * at-most-one-frame-early popup, not a mechanism error. */
      for (const g of groupsB) {
        if (g.rewardGiven) continue;
        if (!g.members.every((e) => e.state === EST.FREE || e.state === EST.DYING)) continue;
        g.rewardGiven = true;
        if (g.desc.rewardId >= 0) {
          /* CS:0xED84: the position is DS:0x202/0x204 — a shared scratch pair
           * the original overwrites every time ANY member's own CS:0xF034
           * one-shot gate fires, so the reward lands wherever the group's
           * OWN most-recently-cached member died, not simply the last one in
           * spawn order. See entity.js's own `groupRewardPosition` for the
           * same-tick-kill race this now guards against (an earlier revision
           * of this loop read the cache directly and dropped every
           * entityCount===1 group's reward at (null, null)). */
          const { x, y } = groupRewardPosition(g.members);
          popup.spawn(x, y, g.desc.rewardId, level.drawObjects);
        }
      }
      /* `UNKNOWN_sysA_0x1f4_elimination_detector` — System-A's OWN, separate
       * group-elimination reward. Same dead-or-dying-vs-count shape as
       * System B's loop above (CS:0xDFC4), but with the bias arrangement
       * INVERTED: System B's entity caches its own position WITH an `+8`
       * bias already baked in at write time (CS:0xED84); System A's own
       * entity cache (entity-a.js's DYING branch) is RAW, and the `+8`
       * bias — on BOTH X and Y, not X alone — is applied HERE, at this
       * read site, matching CS:0xDFC8-DFD2 exactly (`ax=[0x202]+8`,
       * `bx=[0x204]+8`). Getting this backwards either drops the bias
       * entirely or double-applies System B's own +8-on-X convention to
       * System A's reward position. */
      for (const g of groupsA) {
        if (g.rewardGiven) continue;
        if (!g.members.every((e) => e.state === ESTA.FREE || e.state === ESTA.DYING)) continue;
        g.rewardGiven = true;
        if (g.desc.rewardId >= 0) {
          /* Same same-tick-kill race as groupsB above (see entity.js's own
           * `groupRewardPosition` header) — entity-a.js's own
           * `groupRewardPositionA` applies the identical fallback with
           * System A's own +8-on-both-axes read-site bias. */
          const { x, y } = groupRewardPositionA(g.members);
          popup.spawn(x, y, g.desc.rewardId, level.drawObjects);
        }
      }
      /* Drain selector2.js's own group-elimination rewards (`CS:0xAED0`-
       * `0xAF0F`) into the SAME single-slot popup — previously computed
       * correctly but grown forever and never rendered. */
      for (const r of selectorTwo.rewards) {
        const id = r.itemType !== null ? r.itemType + 0xb : r.popupValue;
        popup.spawn(r.x, r.y, id, level.drawObjects);
      }
      selectorTwo.rewards.length = 0;
      popup.step();
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
      /* CS:0x02BD — DS:0xd2be's own pool, right after the enemy shots and
       * before the health-bar chase (game/frame.js's FRAME_ORDER). Nothing
       * spawns into it yet (see the `lineHazards` declaration above), so this
       * call only ever drains an empty pool today — wiring the spawn side is
       * future work, not this pass. */
      lastLineHazardFx = lineHazards.step(
        { x: cam.snapX, y: cam.snapY },
        { x: player.x, y: player.y, state: player.stateIndex },
        level.map.planeB,
        { invulnerable: fx.invuln > 0, hurt: (n) => health.damage(n) },
        debris, tock);
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
        if (e.state === 0 || e.state === -2) continue;   // free / not yet visible
        const sx = e.x - camX, sy = e.y - camY;
        if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
        if (isDying(e)) {
          /* ⚠️⚠️ CORRECTION, a later session — entity.js's own header traces
           * CS:0xF02A/0xF030 to the byte: the kill tick itself (frame still
           * -1, before tick()'s own DYING branch has run) draws via the
           * ORDINARY formula below with frame=-1; every later tick draws
           * DEATH_SPRITE_BASE + frame (0..6) through the SAME blitter, not
           * the class-table lookup. Both share this one draw call. */
          dying++;
          if (e.frame < 0) {
            const eid = spriteForEntity(level.world, e.cls, e.mode, e.frame,
                                        MODE_TABLE.map((m) => m.animBase));
            const ef = eid !== null && hero && hero.frames[eid];
            if (ef && eid >= CREATURE_DESCRIPTOR_BASE) renderer.blitSprite(ef, sx, sy);
            else { outOfRange++; renderer.strokeRect(sx, sy, 24, 24, 12); }
          } else if (e.frame < DEATH_FRAMES) {
            const df = hero && hero.frames[DEATH_SPRITE_BASE + e.frame];
            if (df) renderer.blitSprite(df, sx, sy);
            else { outOfRange++; renderer.strokeRect(sx, sy, 24, 24, 12); }
          }
          continue;
        }
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
        if (e.state === ESTA.FREE || e.state === ESTA.WAITING) continue;   // free / not yet visible
        const sx = e.x - camX, sy = e.y - camY;
        if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
        if (isDyingA(e)) {
          /* CS:0xE0B2/E241/E247 — the kill tick (frame still -1) draws via
           * the ordinary formula below; every later tick draws
           * DEATH_SPRITE_BASE_A + frame (0..16) through the SAME blitter.
           * Mirrors System B's own DYING render above exactly, with A's own
           * constants (see entity-a.js's DEATH_FRAMES_A header). */
          dying++;
          if (e.frame < 0) {
            const eid = spriteForEntityA(level.world, e.cls, e, CLASS_TABLES_A);
            const ef = eid !== null && hero && hero.frames[eid];
            if (ef) renderer.blitSprite(ef, sx, sy);
            else { outOfRange++; renderer.strokeRect(sx, sy, 24, 24, 11); }
          } else if (e.frame < DEATH_FRAMES_A) {
            const df = hero && hero.frames[DEATH_SPRITE_BASE_A + e.frame];
            if (df) renderer.blitSprite(df, sx, sy);
            else { outOfRange++; renderer.strokeRect(sx, sy, 24, 24, 11); }
          }
          continue;
        }
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

      /* THE NEST'S BROOD CHILDREN — CS:0x894E, sprites off SS:0x360A (a
       * placeholder table — see nest.js's own UNKNOWN_brood_sprite_table)
       * plus the 0x6c(108)-base death burst every creature in this game
       * shares. */
      for (const d of lastBroodFx) {
        const bf = hero && hero.frames[d.sprite];
        if (bf) renderer.blitSprite(bf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 16, 12, 13); }
      }

      /* THE GROUP-ELIMINATION REWARD POPUP — CS:0xBF5F/0xBF80, one shared
       * single slot fed by both System-B's own +0x10 reward and selector2.js's
       * own group-clear reward (see game/popup.js's header). `spriteId` is
       * null for the undecoded plain-numeric-id branch — this port draws
       * nothing for that case rather than guess a digit rendering. */
      {
        const pid = popup.spriteId;
        if (pid !== null) {
          const px = popup.x - camX, py = popup.y - camY;
          const pf = hero && hero.frames[pid];
          if (pf) renderer.blitSprite(pf, px, py);
          else { outOfRange++; renderer.strokeRect(px, py, 16, 16, 15); }
        }
      }

      /* THE WORLD-1 SUBLEVEL-B AWAKENED STATUE — CS:0x7B68/0x7C4B/0x7C7C,
       * sprites 450-455 (idle/moving) and 91-107 (death). */
      for (const d of lastStatueFx) {
        const sf = hero && hero.frames[d.sprite];
        if (sf) renderer.blitSprite(sf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 32, 32, 14); }
      }

      /* THE WORLD-3 DS:0xce64 CREATURE — CS:0x7F5D, sprite table a
       * deliberate placeholder (see ce64.js's UNKNOWN_ce64_sprite_table) and
       * the 0x6c(108)-base death burst. */
      for (const d of lastCe64Fx) {
        const cf = hero && hero.frames[d.sprite];
        if (cf) renderer.blitSprite(cf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 32, 40, 15); }
      }

      /* THE CREATURE'S "SPIT" SUB-PROJECTILE — sprites 492 (windup),
       * 493-504 (flight) and 91-108 (death), all single-source this session,
       * see ce64.js's own provenance note. */
      for (const d of lastSpitFx) {
        const spf = hero && hero.frames[d.sprite];
        if (spf) renderer.blitSprite(spf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 24, 24, 15); }
      }

      /* THE SELECTOR-2 STATIONARY TURRETS — CS:0xAD88, sprites off the
       * per-world class table's own spriteBase (worlds 1/2's ping-pong
       * table or world 4's hardcoded base) plus the shared 0x6c(108)-base
       * death burst. */
      for (const d of lastSelectorTwoFx) {
        const s2f = hero && hero.frames[d.sprite];
        if (s2f) renderer.blitSprite(s2f, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 24, 24, 15); }
      }

      /* PGOD0x.PAT SCRIPTED OBJECTS — CS:0xB987, sprite a fixed spriteBase
       * per class (UNKNOWN_pat_animation_frame — the per-tick walk-cycle
       * offset is not ported, see pat-objects.js's own header). */
      for (const d of lastPatFx) {
        const pf = hero && hero.frames[d.sprite];
        if (pf) renderer.blitSprite(pf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 32, 32, 15); }
      }

      /* ENEMY SHOTS — CS:0x1FE7/0x2039, the shared mechanism by which any
       * shooting enemy fires (the nest, and now System A's stage 6). */
      if (lastShotsFx) for (const d of lastShotsFx) {
        const sf = hero && hero.frames[d.sprite];
        if (sf) renderer.blitSprite(sf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 8, 8, 9); }
      }

      /* THE LINE-HAZARD POOL — CS:0xdc37/0xdb4e, sprites 75/76. See
       * game/line-hazard.js; nothing spawns into it yet (above), so this
       * loop is currently always empty in the running build. */
      if (lastLineHazardFx) for (const d of lastLineHazardFx) {
        const lf = hero && hero.frames[d.sprite];
        if (lf) renderer.blitSprite(lf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 8, 8, 11); }
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

      /* PROJECTILES. Drawn after the enemies and before the hero. CS:0x9CC9-
       * 0x9CE3: sprite = the weapon's own pinned descriptor (+0x0c, or +0x1e
       * when facing selects the second one) PLUS the weapon's shared current
       * animation frame (+0x04, stepped once per tick by CS:0x9d74 — see
       * stepMoverFrame in projectiles.js). This is what makes the knife (and
       * every other nonzero-frameCount weapon) visibly rotate as it flies. */
      for (const p of arsenal.live()) {
        const sx = p.x - camX, sy = p.y - camY;
        const pid = projectileSprite(p.weapon);
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
        ` · ${nests.live} nests · ${brood.live} brood · ${statues.live} statues` +
        ` · ${ce64Creatures.live} ce64 · ${ce64Spits.count} spits · ${selectorTwo.live} sel2` +
        ` · ${patGroups.live} pat` +
        ` · ${shots.live} shots · ${lineHazards.live} hazards · ${debris.live} debris` +
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
        `${creaturesShot} killed · ${arsenal.hitTerrain} walled` +
        (arsenal.noTarget ? ` · ${arsenal.noTarget} hunter shots found no target` : '') + ` · ` +
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
