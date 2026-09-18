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
import { Player, ST, FOOTSTEP_SFX, CLIMB_STEP_SFX } from './game/player.js';
import { InventoryPanel, drawInventoryPanel } from './game/inventory-panel.js';
import { runAllChecks, checkDescriptorAnchors, checkHeroSprites,
         checkSelectorsAndObjects, checkSpawn, checkEntityB, checkEntityA, checkSpawnA,
         checkWeaponsProjectiles, checkTriggerActions,
         checkZones, checkPopup, checkLevers, checkSpikes,
         checkMessages, checkLineBarriers, checkTitleMenu, checkHiscoresFile, checkTally,
         checkShop, checkMusic } from './verify/checks.js';
import { EventRunner, parsePalfils, palfilsNameFor } from './game/events.js';
import { LineBarriers, parseLineBarrierRecords } from './game/line-barriers.js';
import { makeActionContext, makeGates, DOOR_TILES,
         ACTION_NAMES } from './game/trigger-actions.js';
import { cameraForSpawn, Camera } from './game/camera.js';
import { spriteFor, STATE_INFO, UNMODELLED_PHASE_STATES } from './game/states.js';
import { buildDescriptorMap, GROUP_STEMS, HERO_DESCRIPTOR_MAX,
         LEVEL_LOAD_ORDER } from './formats/descriptors.js';
import { spriteForType, parseObjectCategories, sortForDraw, isDeadType,
         isUnstamped, OBJECT_SLOTS, activationBox, buildDrawSequence,
         activateObjects, insertSpawned,
         stepObjectFall, isFallEligible, dropCarriedItem,
         ObjectAnimClock, animatedObjectSprite } from './game/objects.js';
import { parseObjectRecords, Score, Purse, TreasureBurst,
         INVENTORY_EMPTY } from './game/treasure.js';
import { CONSUMABLES, WEAPON_ARCS, INVULN_TICKS_SPAWN } from './game/consumables.js';
import { Starburst, SPRITE_BASE as SB_SPRITE, SPAWN_SFX } from './game/starburst.js';
import { Destructibles } from './game/destructible.js';
import { resetWeaponArc, setWeaponArc, projectileSprite, FIRE_SFX,
         TERRAIN_SFX, AXE_BOUNCE_SFX } from './game/projectiles.js';
import { parseGroupsB, parseGroupsA, GroupSlots, spriteForEntity, MAX_ENTITIES,
         CREATURE_DESCRIPTOR_BASE, groupSlotReleasable } from './game/spawn.js';
import { EntityB, MODE, MODE_TABLE, groundBelow, isDying, EST,
DEATH_SPRITE_BASE, DEATH_FRAMES, stealAttemptB, stepCarriedItemB,
groupRewardPosition } from './game/entity.js';
import { EntityA, CLASS_TABLES_A, spriteForEntityA, EST as ESTA,
groupRewardPositionA,
isDyingA, DEATH_SPRITE_BASE_A, DEATH_FRAMES_A, stepCarriedItem } from './game/entity-a.js';
import { VERDICT_NONE } from './game/pathfind.js';
import { runSearch } from './game/pathfind-producers.js';
import { GodsRandom } from './game/random.js';
import { decodeStatusPanel, PANEL_Y0 as STATUS_PANEL_Y0 } from './game/status-panel.js';
import { stepHealthBarShimmer, drawHealthBar } from './game/health-bar.js';
import { sliceDigitFrames, clampMoneyForDisplay, drawScore, drawMoney, drawLives } from './game/hud-digits.js';
import { LeverToggle, SFX_LEVER_TOGGLE } from './game/levers.js';
import { KillSmoke } from './game/kill-smoke.js';
import { SpikeClock, stepSpikes, spikeSprites, spike130Sprite,
         SPIKE_TYPE, SPIKE117_TYPE, SPIKE130_TYPE } from './game/spikes.js';
/* Contact and the grid scan are reached through game/frame.js, which owns the
 * order they must run in — see the note there. */
import { Health, HEALTH_MAX, attackHero, HURT_SFX } from './game/combat.js';
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
import { MessageEngine, drawMessage, PRIORITY } from './game/message.js';
import { SeenBitmap, messageGate, composeObjectMessage,
         composeHint, HINT_TABLET_TYPE } from './game/message-compose.js';
import { buildObjectArena, appendHints, hintOffsetForX,
         stringAt } from './game/text-arena.js';
import { Arsenal, spawnableWeapons } from './game/hero-fire.js';
import { stepHeroFrame, stepCreatureDamage } from './game/frame.js';
import { DamageGrid, damageForTag, despawnConsumedHit } from './game/collision.js';
import { parseWeapons } from './game/weapons.js';
import { pickUpWeapon } from './game/pickup.js';
import { scanZones, unpackTeleportDest, resolveExitDestination,
         ZONE_TELEPORT, ZONE_EXIT, exitEffects, advanceWorld,
         clearNonPotionInventory, generatePassword, passwordSlotForWorld,
         passwordWorldForSlot, passwordToString, PASSWORD_SLOTS } from './game/zones.js';
import { DeathBurst, findRespawnPosition, loseLife, DEATH_SFX } from './game/death.js';
import { TitleMenu, PasswordEntry, NameEntry, HiscoreTable, HISCORE_TABLE_TICKS,
         drawCentered, MENU_ADVANCE, MENU_ARROW_LEFT_DESC, MENU_ARROW_RIGHT_DESC } from './game/title-menu.js';
import { DEFAULT_TABLE, encodeScoreBytes, rankOf, insertAt, bcdToNumber } from './formats/hiscores.js';
import { decodeJoyRecording } from './formats/joy.js';
import { CYCLE, JOYG_SHOWCASE_SPAWN, JOYG_SHOWCASE_LOADOUT, fileNameFor, nextState } from './game/attract.js';
import { ShopScreen, BUY_CONFIRM_SFX } from './game/shop.js';
import { TallyScreen, CHA_CHING_SFX } from './game/tally.js';
import { WebAudioBus } from './audio/audio-bus.js';
import { parseMusContainer, isSmf } from './audio/mus-container.js';
import { MusicPlayer } from './audio/music-player.js';

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

/* Palette slots 0/1 GAME.EXE installs at runtime, overriding whatever
 * `PLEVEL<key>.PI1`'s own embedded palette holds there — `[PROVEN]` live
 * this session by intercepting INT 10h AX=1012h ("set block of DAC color
 * registers") for a clean world-1 load: slot 0 = ST `0x0000` (black, not
 * the file's own `0x0333` gray), slot 1 = ST `0x0247` (a blue, not the
 * file's own `0x0400` red). Identical for both 1A and 1B. See `loadLevel`'s
 * own comment for the full closure writeup and the disclosed gap: worlds
 * 2-4 are NOT verified, so they are deliberately absent here rather than
 * guessed from the file's own (possibly also wrong) values. */
const PALETTE_SLOT01_OVERRIDE = {
  1: [[0, 0, 0], [73, 146, 255]],   // ST 0x0000, 0x0247 (round(n*255/7))
};

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
   *
   * `UNKNOWN_level_palette_source` is CLOSED, `[PROVEN]` live in DOSBox this
   * session -- and the closure is a correction, not a confirmation:
   * `PLEVEL<key>.PI1`'s own embedded palette is only PARTIALLY right.
   * Intercepting the real INT 10h AX=1012h "set DAC block" call GAME.EXE
   * issues for a clean world-1 load (both 1A and 1B, byte-identical) shows
   * slots 2-15 match the file's own words EXACTLY, but slots 0/1 do not:
   * the file has `0x0333`/`0x0400` (a gray, then RED) at those two slots;
   * the live DAC has `0x0000`/`0x0247` (BLACK, then a BLUE) instead. This
   * is the user-reported bug ("the background of the second part of the
   * city isn't red but blue in dosbox") -- and it is NOT a 1A-vs-1B
   * difference (both sublevels are identical, live and in the file); the
   * port was rendering red for BOTH halves of world 1, not just failing to
   * distinguish them.
   * An exhaustive search of every shipped file's decompressed bytes (every
   * PLEVEL*.PI1, PLEVEL*.DAT, PBITS*.PI1, PLEV*.MAP, PALFILS.0*, PALWAYS*)
   * found the live value `0x0247` NOWHERE -- these two slots are not read
   * from a file at all; GAME.EXE overwrites them at runtime from a source
   * this pass could not pin down (a driver-internal staging buffer at
   * `12576:0x66` receives them already-written; the write side was not
   * caught live). Matches this project's own `drivers-and-memory.md`
   * finding for `PSTATUS.PI1`/`PLEVEL1A.PI1` sharing words 2-15 with "two
   * low, level-specific accent slots" varying independently -- that note
   * had the mechanism right (an override exists) but assumed the FILE's
   * own low slots were what got used, which this session's live capture
   * disproves for world 1.
   * SCOPE: only world 1 (both sublevels) has been live-verified. Worlds
   * 2-4 have NOT been checked against a live DAC capture -- this override
   * table intentionally leaves them at the file's own (possibly also
   * wrong) values rather than guessing. See the doc closure for exactly
   * what a follow-up pass needs to do (repeat the INT10h/1012h capture for
   * each world) before extending this table. */
  const palRaw = await fetchRaw(`game/PLEVEL${key}.PI1`);
  const palette = decodePI1(dclDecompress(palRaw).data).palette;
  const slot01Override = PALETTE_SLOT01_OVERRIDE[key[0]];
  if (slot01Override) {
    palette[0] = slot01Override[0][0]; palette[1] = slot01Override[0][1];
    palette[2] = slot01Override[0][2]; palette[3] = 255;
    palette[4] = slot01Override[1][0]; palette[5] = slot01Override[1][1];
    palette[6] = slot01Override[1][2]; palette[7] = 255;
  }

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
  /* The SAME file read a third way: its 132 name/description pairs are the
   * front of the `DS:0x1fc6` string arena every in-level message reads its
   * words out of (game/text-arena.js). The 40 PALFILS hint strings are
   * appended to that same pool by FUN_1000_36b1, which is why the hint tablet
   * and the object composer both resolve text through one base. */
  const textPool = buildObjectArena(objRaw);
  const hints = appendHints(textPool.arena, palfilsData);
  textPool.arena = hints.arena;
  const groupsB = parseGroupsB(dclDecompress(pfRaw).data);
  const groupsA = parseGroupsA(dclDecompress(pfRaw).data);
  /* PALFILS +0x0718 — selector-2's own stationary-turret class descriptors
   * (game/selector2.js). Same window System-B's own per-world class table
   * loader (CS:0xad62) is unrelated to; this one is level-authored data. */
  const groupsSel2 = parseSelectorTwoClasses(dclDecompress(pfRaw).data);
  /* PALFILS +0x189C — the selector 7-10 line-barrier system's own 25-record
   * table (game/line-barriers.js). Parsed unconditionally like the other
   * PALFILS windows above; whether any record is ever actually reachable
   * from a shipped plane-B event on this level is decided at arm time. */
  const lineBarrierRecords = parseLineBarrierRecords(dclDecompress(pfRaw).data);
  /* PALFILS +0x0000 — selector-1's own PGOD0x.PAT spawn descriptors
   * (game/pat-objects.js), 100 records of 8 bytes. Parsed unconditionally
   * (the window exists in every PALFILS file); whether any of the 100
   * indices is ever actually reachable from a shipped trigger on this
   * particular level is not filtered here, matching how groupsA/groupsB/
   * groupsSel2 are also parsed in full above. */
  const patDescriptors = Array.from({ length: 100 },
    (_, i) => parsePatSpawnDescriptor(palfilsData, i));
  /* CS:0x3855 — the `PGOD0<world>.PAT` FILE READ is skipped on sublevel 'b'
   * (`cmp byte [0x43],0 / jnz 386a`, so 385c-3867's `CALL 0x257e` load runs
   * only for 'a').
   *
   * ⚠️ THAT IS NOT "no PAT objects on B sublevels", and reading it that way
   * cost this port 75 enemies across 1B/2B/4B. The load's destination is the
   * FIXED buffer DS:0x500 (CS:0x385F `mov bx,0x500`), which is exactly where
   * the per-frame walker reads its directory from (CS:0xB9B8 `mov bp,0x500 /
   * add bp,ax`). Nothing clears that buffer between sublevels, and the file
   * is per-WORLD — 1A and 1B both want PGOD01.PAT — so on entering 1B the
   * blob loaded for 1A is still resident and the walker seeds from it
   * normally. The skip is a don't-reload-the-same-file optimisation, not a
   * feature gate.
   *
   * Loading it for both sublevels therefore reproduces the bytes the
   * original has in memory during ordinary play, in which a world's 'a'
   * always precedes its 'b'. (Entering a 'b' level cold via password leaves
   * DS:0x500 holding whatever the previous world left there — genuinely
   * stale data the original reads anyway. That is not modelled; this port
   * serves the correct world's blob in every case.)
   *
   * A fetch failure leaves both `null` rather than throwing — the level
   * still loads, just with zero PAT objects. */
  let patDirectory = null, patBlobBytes = null;
  try {
    const patRaw = await fetchRaw(`game/PGOD0${key[0]}.PAT`);
    patBlobBytes = dclDecompress(patRaw).data;
    patDirectory = parsePatDirectory(patBlobBytes);
  } catch (e) {
    console.warn(`PGOD0${key[0]}.PAT failed to load — PAT objects inert on this level`, e);
  }
  const drawObjects = sortForDraw(map.objects.filter((o) => !isDeadType(o.type)), cats);

  /* PWEAPONS is per-world, and Power (+0x06) genuinely differs between them —
   * the axe is 4 in worlds 1-2 and 12 in 3-4. The sprite fields and the pickup
   * count are pinned at the EXE-image values by the loader, so they are served
   * from the pinned tables in weapons.js, not from these bytes. */
  const weapons = parseWeapons(
    dclDecompress(await fetchRaw(`game/PWEAPONS.00${key[0]}`)).data);

  return { map, sheet, palette, tiles, tileCount: count, palfils, palfilsRaw: palfilsData, cats, drawObjects,
           objValues, groupsB, groupsA, groupsSel2, lineBarrierRecords, patDescriptors, patDirectory, patBlobBytes,
           weapons, textPool, hints, world: +key[0] };
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
  /* `smallfnt` (PSMLFNT) is the in-game message font — game/message.js. It is
   * the LAST group of the level load order (formats/descriptors.js), loaded at
   * CS:0x2c19 right after `CS:0x2c00` snapshots the descriptor cursor into
   * `DS:0x27e`, which is exactly the base the glyph blit adds the raw
   * character byte to. Appending it here shifts no existing descriptor. */
  const groups = LEVEL_LOAD_ORDER(world);
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
  /* `DS:0x27e` — the glyph base (CS:0x2c4b's `[0x68]-0x1e00 >> 3`, snapshotted
   * BEFORE the smallfnt load, so it is that atlas's own record 0). The blit is
   * `sprite = rawByte + base` with no fold and no clamp, so exposing the font
   * as a byte-indexed array of frames IS the original's mapping. */
  const fontBase = ranges.find((r) => r.stem === 'PSMLFNT');
  const glyphs = fontBase
    ? frames.slice(fontBase.base, fontBase.base + fontBase.count) : null;
  /* `menuGlyphs` — PGODFONT, byte-indexed to match `glyphs`' own convention
   * even though the original's OWN indexing isn't ASCII-shaped (byte+0x3F,
   * a fixed constant landing on this group's own base — see title-menu.js's
   * MENU_ADVANCE citation). PGODFONT's records 0-25 line up with real ASCII
   * 'A'-'Z' directly (confirmed both by that offset arithmetic and visually,
   * `tools/atlas-render.mjs PGODFONT`: literal gold A-Z in order), so this
   * array is built with real ASCII codes as keys for drawText/drawCentered's
   * own `charCodeAt` lookup — a port-side convenience, not a claim that the
   * original indexes it this way. Digits '0'-'9' are ALSO remapped here,
   * since gods-web/game/tally.js builds its bonus-line strings with real
   * ASCII digits — records 28-37, PIXEL-VERIFIED per-record this pass (an
   * earlier revision of this comment had them one off, at 29-38, having
   * mis-read record 29 as '0' from a cropped strip render; record 28 is the
   * real '0' — see title-menu.js's own MENU_ADVANCE citation for the full
   * record map, corrected there too). Nothing else beyond A-Z/0-9 is
   * defined (no period, no icons — the menu's own arrow sprites are fixed-
   * position blits, not flowed text, see MENU_ARROW_LEFT/RIGHT below). */
  const menuFontBase = ranges.find((r) => r.stem === 'PGODFONT');
  let menuGlyphs = null;
  if (menuFontBase) {
    menuGlyphs = [];
    for (let c = 0; c < 26; c++) menuGlyphs[0x41 + c] = frames[menuFontBase.base + c];
    for (let d = 0; d < 10; d++) menuGlyphs[0x30 + d] = frames[menuFontBase.base + 28 + d];
    /* Records 26 ('.') and 27 (space) — CS:0x30D4's own password/hiscore grid
     * blits PGODFONT records 0-39 directly by cell index (0x80+n), and
     * CS:0x3065's typed-buffer readout maps an empty slot's own alphabet
     * code (Space = 0x1C, see message.js's established a-z/digit/./space
     * encoding) to record (0x1C+0x7F)-0x80 = 27 — closing this project's own
     * long-standing "records 26-28 unidentified" ambiguity for record 27
     * specifically: it IS the space glyph, not a mystery icon. Keyed here by
     * real ASCII '.'/' ' so PasswordEntry's own GRID_CELLS (which already
     * uses literal '.'and ' ' characters) can look them up the same way it
     * looks up letters/digits. */
    menuGlyphs[0x2e] = frames[menuFontBase.base + 26];  // '.'
    menuGlyphs[0x20] = frames[menuFontBase.base + 27];  // ' ' (space)
  }
  /* PGODFONT records 38/39 — CS:0x30D4's own grid cells 38 (erase) and 39
   * (confirm), descriptors 0x80+38=166 and 0x80+39=167 respectively (DIRECT
   * indexing, unlike the title menu's own swapped-for-inward-pointing
   * MENU_ARROW_LEFT/RIGHT_DESC below — grid cell 38 really is drawn with
   * record 38, not record 40). Record 38 is the same LEFT-pointing arrow
   * MENU_ARROW_RIGHT_DESC already names (168+38=166, arithmetic coincidence
   * of the two independent numbering schemes landing on the same value, not
   * a shared meaning) — kept as its own named constant for clarity at the
   * password grid's own call site. */
  const GRID_ERASE_DESC = 166;   // 0x80+38 — LEFT-pointing arrow
  const GRID_CONFIRM_DESC = 167; // 0x80+39 — the small circular icon
  /* CS:0x3097's own cursor icon — descriptor 0x57+phase = 87..90, an
   * "always"-group PALWAYS2 sprite (`tools/atlas-render.mjs PALWAYS2`,
   * records 48-51): a 4-frame twinkling/sparkle star. See title-menu.js's
   * own CS:0x3097 citation for the animation-rate/position details. */
  const CURSOR_DESC_BASE = 87;
  const cursorFrames = [0, 1, 2, 3].map((i) => frames[CURSOR_DESC_BASE + i]);
  return { frames, ranges, glyphs, glyphBase: fontBase ? fontBase.base : -1, menuGlyphs,
           gridEraseIcon: frames[GRID_ERASE_DESC], gridConfirmIcon: frames[GRID_CONFIRM_DESC],
           cursorFrames,
           palette: images.PALWAYS1.palette, total: map.length };
}

/* The status panel. CS:0x38a's own latch loads PSTAT3 exactly once, the
 * first time the real per-tick game loop runs (game/status-panel.js) — not
 * per level and not per world, so this port loads it once at startup too. */
async function loadStatusPanel() {
  const raw = dclDecompress(await fetchRaw('game/PSTAT3.PI1')).data;
  return decodeStatusPanel(raw);
}

/* The title screen's own full-320x200 backdrop — PBACKSCR.PI1, confirmed
 * against a live DOSBox capture of the real title screen (not merely the
 * palette-only lead Gods/CLAUDE.md's own drivers-and-memory.md previously
 * had for this file — see title-menu.js's own header). Unlike the status
 * panel, this IS the full image: the menu draws it as one full-screen
 * blit, not the 40-row band decodeStatusPanel extracts. */
async function loadTitleBackground() {
  const raw = dclDecompress(await fetchRaw('game/PBACKSCR.PI1')).data;
  return decodePI1(raw);
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
  /* #11 audio backlog item — see audio/audio-bus.js's own header for what
   * this is and, explicitly, what it is not (not chip-accurate; a stylized
   * reproduction of already-cited SFX ids this port had nowhere to send
   * before now). `AudioContext` is created lazily inside the bus itself on
   * the first real play() call, not here — see that module for why. */
  const audio = new WebAudioBus();

  /* #11 audio backlog item, music half — see audio/music-player.js's own
   * header. PGODS.MUS (mus-container.js's own header has the full citation
   * trail for why the other ten shipped .MUS/.RL files are not fetched at
   * all here) is played only by the non-Roland sound drivers, which never
   * pick a specific one of its 70 real tracks — UNKNOWN_pgods_mus_cue_
   * dispatch is CLOSED, live-confirmed in DOSBox: the real per-level music
   * is PGODSRL{A-G}.RL, dispatched by world number, but only under Roland
   * (see Gods/docs/drivers-and-memory.md). This port doesn't parse those
   * files, so there is no level/event mapping to port for PGODS.MUS itself
   * — the same disclosed-affordance spirit as the weapon picker below:
   * every track is offered on demand, none is claimed to belong to any
   * level or event. */
  const musicPlayer = new MusicPlayer();
  const musicSel = $('musicTrack');
  fetchRaw('game/PGODS.MUS').then((raw) => {
    const blobs = parseMusContainer(dclDecompress(raw).data);
    musicSel.innerHTML = '<option value="-1">(none)</option>';
    blobs.forEach((blob, i) => {
      if (!isSmf(blob)) return;   // the 3 mus_type2 blobs (19/20/40) — undecoded, see smf-parser.js
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `track ${i}`;
      musicSel.appendChild(o);
    });
    musicSel.addEventListener('change', () => {
      const n = +musicSel.value;
      if (n < 0) { musicPlayer.stop(); return; }
      musicPlayer.play(blobs[n]);
    });
  });
  $('musicStop').addEventListener('click', () => {
    musicPlayer.stop();
    musicSel.value = '-1';
  });

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
    Promise.resolve(checkPopup()), Promise.resolve(checkLevers()),
    Promise.resolve(checkSpikes()), checkMessages(fetchRaw),
    checkLineBarriers(fetchRaw), Promise.resolve(checkTitleMenu()),
    Promise.resolve(checkHiscoresFile()),
    Promise.resolve(checkTally()), Promise.resolve(checkShop()),
    checkMusic(fetchRaw),
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
  /* CS:0x0df8's own export-21 anchor (formats/descriptors.js, descriptor
   * #127) — sliced once per hero (re)load into ten 8x7 glyph frames the
   * score/lives/money digit renderers (game/hud-digits.js) share. */
  let digitFrames = null;
  try {
    hero = await loadSprites(level.world);
    digitFrames = sliceDigitFrames(hero.frames);
  } catch (e) { console.error('sprites failed to load', e); }

  /* Loaded once, world-independent, exactly like the original (CS:0x38a's
   * latch never resets across levels or restarts — see status-panel.js). */
  let statusPanel = null;
  try {
    statusPanel = await loadStatusPanel();
  } catch (e) { console.error('status panel failed to load', e); }

  /* PBACKSCR.PI1 — the title screen's own full-screen backdrop, confirmed
   * live (see loadTitleBackground's own header). Closes the gap main.js
   * previously had no title screen to draw anything on at all. */
  let titleBackground = null;
  try {
    titleBackground = await loadTitleBackground();
  } catch (e) { console.error('title background failed to load', e); }

  /* The true shipped "TOP TEN GODS" defaults (game/formats/hiscores.js's
   * own `DEFAULT_TABLE`, hardcoded rather than fetched — see that export's
   * own citation for why HISCORES.BIN itself is not a fetchable asset here)
   * — overridden below (see the `hiscoreEntries` declaration further down,
   * hoisted-`function` helpers) by whatever this browser's own localStorage
   * already holds, matching a real player's progress the same way
   * `loadPersistedPasswordSlots()` does. */
  const initialHiscores = DEFAULT_TABLE.map((e) => ({ ...e, scoreBytes: e.scoreBytes.slice() }));

  let spawn = levelSpawn(level.world);
  let player = new Player(spawn.x, spawn.y);
  player.spawnAtLevelStart(spawn.x, spawn.y);   // CS:0x8C34 — the level-load seed
  /* DS:0x8c3c — ACT6's four-slot smoke puff (game/kill-smoke.js). Held here,
   * outside the per-level action context, because the walker at CS:0x0239
   * runs from the main loop rather than from the verb: a puff seeded by the
   * last trigger before a level switch would otherwise have nothing to tick
   * it. It IS cleared per level, unlike leverToggle/spikeClock — CS:0x8EC2
   * and its three siblings free all four slots in the level-load routine. */
  const killSmoke = new KillSmoke();
  /* THE ACTION CONTEXT — what makes a fired trigger actually do something.
   * planeA/planeB are the live map arrays (subarray views into the bulk), so a
   * door written here is visible to the renderer and to collision on the very
   * next frame. Rebuilt per level: the tile constants and the trapdoor table
   * are both per-world. */
  const buildActionCtx = (lvl, inv, ars) => makeActionContext({
    planeA: lvl.map.planeA, planeB: lvl.map.planeB,
    /* ACT6 (CS:0x3bd1, "kill category-4 objects near the point") walks
     * ctx.objects directly — unlike ACT0/ACT1, which go through the `alloc`
     * hook below. Without this the array stays makeActionContext()'s own
     * empty default forever, so ACT6 always finds nothing to kill: every
     * lever-gated hazard (e.g. PLEV1A's world-1 spikes at (443,960)/(462,960),
     * gated on lever index 3) stays alive no matter what the player pulls.
     * `level.drawObjects` is REASSIGNED (not just mutated) by insertSpawned
     * after a loot settle or a carried-item drop, so this reference goes
     * stale mid-level — refreshed every tick just before events.step() runs,
     * below. */
    objects: lvl.drawObjects,
    /* The one instance above, so a rebuilt context never drops a puff that is
     * still mid-animation. */
    killSmoke,
    gates: makeGates(lvl.palfilsRaw),
    tiles: DOOR_TILES[lvl.world - 1],
    messages: lvl.map.messages,
    categoryOf: (type) => lvl.cats[type],
    inventory: inv,
    /* A DETACHED copy — see act10's note. The live arsenal is disarmed
     * through the hook below, not by writing into this array. */
    weaponSlots: ars.slots.map((sl) => sl.weapon),
    clearWeaponSlot: (i) => { ars.slots[i].weapon = INVENTORY_EMPTY; },
    /* Without this, `makeActionContext`'s own default `sfx: () => {}` (a
     * deliberately silent no-op for tests) is what every ACT0/2/3/6/7/8/9
     * handler's `ctx.sfx(SFX.XXX)` call would reach here too — the exact
     * "recorded as already ported, actually never wired" trap this project's
     * own memory already flags for the message-line subsystem. */
    sfx: (id) => audio.play(id),
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
   * only 50/0 damage instead of the usual 10000/10000 — see ce64.js's header.
   *
   * ⚠️ CS:0x937C/0x9382 — weapon +0x49 (weapons.js's `consumedOnHit`) lives
   * INSIDE this same decode in the original, so despawnConsumedHit runs here
   * too, right after damageForTag, rather than in collision.js's
   * damageForTag itself (which stays pure — many verify checks call it with
   * synthetic, non-mutable state). On any ordinary weapon hit, a weapon with
   * +0x49 set despawns the exact projectile record that just scored it —
   * single-hit, non-piercing. Every one of this port's grid consumers (the
   * hero's own creatureScansGrid, ce64/pat-objects/selector2/statue's
   * proxied scans) is threaded through this ONE decodeTag closure, so wiring
   * it here covers all of them at once. */
  const decodeTag = (tag, mode = 0) => {
    const d = damageForTag(
      tag,
      arsenal.slots.map((s) => s.weapon),
      Object.fromEntries(arsenal.slots.filter((s) => s.st).map((s) => [s.weapon, s.st])),
      mode);
    despawnConsumedHit(d, arsenal.weapons, arsenal.slots.map((s) => s.area));
    return d;
  };
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
  /* CS:0x3b4 — the health bar's own filled-segment shimmer phase (game/
   * health-bar.js). A genuine persistent global in the original (no writer
   * ever resets it on level load or restart), so it lives here beside
   * leverToggle/spikeClock/passwordSlots, not inside switchLevel's reset. */
  let healthBarShimmer = { phase: 0, tick: 0 };
  /* CS:0x01BD's own `jmp 0x9bb` (health.dead, combat.js) — game/death.js.
   * `deathSeq` is non-null for the ~1.2s burst; once the THIRD life is lost
   * (CS:0x093E `js`) `uiState` itself leaves 'game' for 'name-entry' or
   * 'hiscore-table' (the real CS:0x0943 cascade, below) — which already
   * freezes the tick loop via the ordinary `uiState !== 'game'` gate, so
   * there is no separate "game over, but still uiState 'game'" freeze flag
   * to track here any more (an earlier pass's own `gameOverState`,
   * superseded now that the screens it stood in for are real). */
  let deathSeq = null, lastDeathBurstFx = [];
  /* CS:0xA461 — the starburst potion's 80-slot particle array. It is a real
   * damage source (tag 0xFC), so it lives beside the projectiles rather than
   * with the cosmetics. */
  let starburst = new Starburst(new GodsRandom(2));
  /* `starburst.bursts` only counts real spawner runs (starburst.js: "how
   * many times the spawner actually ran"), incremented once per call
   * regardless of how many of the 8 particles it seeds — edge-detecting it
   * here is how a NEW chain reaction is told apart from the per-tick
   * `burstFx` snapshot frame.js already returns for every tick a burst is
   * still animating, without needing a dedicated signal from starburst.js. */
  let lastStarburstBursts = 0;
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
  let lastSpikeFx = [];
  let lastKillSmokeFx = [];
  /* CS:0x0495-0x04A1 — the real boot state: all 4 slots empty. Keys now
   * enter through CROUCH + FIRE (CS:0x6069 -> game/pickup.js's `scanForKey`/
   * `collectKey`, wired into Player._crouch), so this no longer needs a
   * dev-seed to keep the chest-unlock branch reachable. */
  let inventory = [INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY];
  /* CS:0x02C0/0x02C3 -> game/inventory-panel.js. Drawn every tick regardless
   * of state (see that module's own header); only the highlight's
   * extend/retract animation is state-dependent. */
  let inventoryPanel = new InventoryPanel();
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
  /* CS:0x434e — the status-panel message line (game/message.js) and the
   * once-per-type "already shown" bitmap at DS:0x8cea (CS:0x462e). The bitmap
   * is cleared on a FULL level entry and not on the light re-entry path, so it
   * is rebuilt alongside the engine in switchLevel() below. */
  let messages = new MessageEngine();
  let seenTypes = new SeenBitmap();

  /**
   * `CS:0x4609` reached through the pickup dispatcher — the generic
   * name/description/value message, gated and de-duplicated.
   */
  function postObjectMessage(type) {
    if (!level.textPool) return;
    /* `shopActive` is false because this port has no shop screen; that makes
     * the CS:0x461D gate reduce to "world 1, or the type-0x53 bypass", which
     * is exactly what the original does in a level. See messageGate's header
     * for why that is NOT the same as hard-coding "world 1 only". */
    if (!messageGate({ type, category: level.cats[type], world: level.world,
                       shopActive: false, seen: seenTypes })) return;
    const msg = composeObjectMessage(type, level.textPool);
    if (!msg) return;                       // CS:0x4679 — this type has no text
    /* CS:0x4717-0x4731 — a submit the engine REFUSED un-sets the seen bit, so
     * a message that lost a priority race is retried rather than lost. */
    if (!messages.post(msg, PRIORITY.object)) seenTypes.clear(type);
  }

  /**
   * The consumable branch of the dispatcher, `CS:0x1829`-`CS:0x1839`.
   *
   * Type 69 is the HINT TABLET and does not go through the composer at all:
   * `CS:0x63D5` builds its own buffer, submits at priority 100 and returns
   * `DX = 0`, which is what stops the player also seeing the tablet's own
   * "tablet / reveals clues". Every other handler returns a message TIER:
   *     0  -> no message          CS:0x182D `or dx,dx / jz`
   *     1  -> show it             CS:0x1831 `dec dx / jz`
   *   >=2  -> clear the priority barrier first, then show it   CS:0x1834
   */
  function postPickupMessage(c) {
    if (c.type === HINT_TABLET_TYPE) {
      /* CS:0x63DD-0x63FA: the key is the tablet's own WORLD X. The original
       * reads it back off the draw-list record it appended for this same
       * object and adds the camera origin — `(x - camX) + camX`, identically
       * the object's x, so this port compares the object's x directly. */
      const off = hintOffsetForX(level.hints.keys, level.hints.offs, c.x);
      /* ⚠️ NO MATCH IS A SHIPPED, REACHABLE BUG IN THE ORIGINAL, and it is
       * deliberately NOT reproduced. `CS:0x63FC` jumps to a nine-POP sequence
       * having pushed five words: it loads DS with the handler's own address,
       * eats its return address and RETs to the tablet's screen Y. Two of the
       * 46 shipped tablets reach it — PLEV1B's objects at x=348 and x=329,
       * against PALFILS.0B1's only live keys 1521/1611. What the corrupt path
       * was WRITTEN to show is the string at DS:0xed17, so that is what this
       * port shows; emulating the crash would gain nothing and make the port
       * non-deterministic. `UNKNOWN_63d5_nomatch_runtime_effect`. */
      const hint = off >= 0 ? stringAt(level.textPool.arena, off) : null;
      messages.post(composeHint(hint), PRIORITY.hint);
      return;                               // CS:0x646C `sub dx,dx`
    }
    const tier = CONSUMABLES[c.rank] ? CONSUMABLES[c.rank].dx : 0;
    if (!tier) return;                      // CS:0x182F `jz 0x183c`
    if (tier >= 2) messages.barrier = 0;    // CS:0x1834 `mov byte [0x394],0`
    postObjectMessage(c.type);              // CS:0x1839 `call 0x4609`
  }
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
   * as System B (dead-or-dying === count, CS:0xDFC4). The original's
   * STRICTER dead-only slot-free condition IS now modelled — see the
   * release loop that follows the reward loop below.
   * ⚠️ This comment used to end "this port's GroupSlots has no fixed
   * runtime-slot cap to recycle", which was simply false: GroupSlots has
   * ten (spawn.js RUNTIME_SLOTS), activate() refuses when they are all
   * busy, and nothing ever freed one — so the pool filled and later
   * activations were consumed-and-lost. That was the bug.
   *
   * ⚠️ `groupsA`/`groupsB` are APPEND-ONLY for the life of a level: a group
   * that has paid its reward and released its slot keeps its record here
   * with `released: true`, because the latch is what stops a stale record
   * zeroing a slot a NEWER activation has since taken. So these arrays are
   * a log of every group ever activated, NOT a list of live ones — a
   * divergence from the original, where the ten fixed slot records are
   * reused wholesale and a released slot is indistinguishable from a fresh
   * one. Anything iterating them for "current enemies" must filter. */
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
  /* CS:0x1045 — idle+FIRE's own lever/switch toggle (game/levers.js). ONE
   * instance for the whole session, matching the original's own persistent
   * globals (DS:0x346/0x3a2) — not reset on a level switch, since neither is
   * ever reset by the level-load routine either. */
  const leverToggle = new LeverToggle();
  /* CS:0x1447 — the retracting-spike hazard's shared animation clock
   * (game/spikes.js). Also a session-persistent global (DS:0x39b/0x39c/
   * 0x39f are never reset on level load), so every spike across every level
   * this session visits shares one continuous phase. */
  const spikeClock = new SpikeClock();
  /* CS:0x148B/0x148F — DS:0x3a0, the rotating-crystal counter (type 54,
   * game/objects.js). Session-persistent for the same reason spikeClock is:
   * no direct-offset write anywhere in the image resets it. */
  const objectAnimClock = new ObjectAnimClock();
  /* DS:0x432/0x436/0x43a — the level-select password slots (game/zones.js's
   * `generatePassword`/`passwordSlotForWorld`), written by FUN_1000_69d7 on
   * a real level exit (bit 10 of the destination record's own +0x1e — see
   * zones.js) and otherwise persistent for the session, exactly like
   * leverToggle/spikeClock above: nothing in the original ever clears them,
   * not even a full restart, so `fullRestart()` below does not reset this
   * either. (The original's own storage — DS:0x432/0x436/0x43a — does get
   * overwritten by HISCORES.BIN's own load/save round-trip at CS:0x3211/
   * 0x3445; that file round-trip is the one writer this port doesn't have,
   * not something to "fix" by clearing passwordSlots on restart.) Index
   * 0/1/2 = the password that unlocks world 2/3/4 (game/zones.js's
   * `passwordWorldForSlot`). A generated password is surfaced both as event
   * text (see the ZONE_EXIT branch below) and — `UNKNOWN_password_entry_ui`
   * is now CLOSED — as a real target for the title screen's own "ENTER A
   * PASSWORD" grid (game/title-menu.js's `PasswordEntry`, dispatched from
   * `handleTitleKey` below). */
  /* `loadPersistedPasswordSlots` is declared further below (hoisted — a
   * plain `function`, not `const`), reading this port's own hard-disk-
   * install localStorage round-trip — see that declaration's own header. */
  let passwordSlots = loadPersistedPasswordSlots() || new Array(PASSWORD_SLOTS).fill(null);
  /* The inter-level bonus-tally + password-reveal sequence, game/tally.js.
   * Non-null while active — see the tick/render callbacks below for how it
   * gates the normal per-tick simulation, and `finishTallyScreen` for the
   * deferred exit effects (world advance, key clear, `switchLevel`) the
   * ZONE_EXIT branch used to run synchronously on the zone hit itself. */
  let tallyScreen = null;
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
  /* Selectors 7-10 — the "path job" / line-barrier system (game/
   * line-barriers.js). Mutates level.map.planeB directly (same convention
   * as the trigger-action verbs' own door/trapdoor writers), so it must be
   * (re)built against THIS level's own map object every level load. */
  let lineBarriers = new LineBarriers(level.map, level.lineBarrierRecords);
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
    /* Selectors 7-10 — arm one game/line-barriers.js record. `param` is a
     * record index (0..24), `selector` picks which of the record's own 4
     * target points/types applies (game/line-barriers.js's own
     * SELECTOR_TO_SLOT). */
    events.onPathJob = (param, selector) => { lineBarriers.arm(param, selector); };
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
       * own. See spawn.js's `rewardId` and the file-header note on `popup`.
       * `slot` is carried so the group can RELEASE it on completion
       * (CS:0xEDB1) — without that the 10-slot pool fills and every later
       * selector-4 activation is consumed-and-lost. `released` latches the
       * free so a stale group record can never zero a slot that a NEWER
       * activation has since taken. */
      groupsB.push({ desc: d, members, rewardGiven: false, slot, released: false });
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
       * of its own to hang it off, unlike CS:0xdf39's own `[bp+0x10]`).
       * `slot`/`released` carry System-A's own slot release (CS:0xDFF9) for
       * the same reason System B's do — see that block. */
      groupsA.push({ desc: d, members, rewardGiven: false, slot, released: false });
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

  /* CS:0x42/0x43 -> a LEVELS key string. The real advance (FUN_1000_6b00,
   * see game/zones.js's `advanceWorld`) only ever produces sublevel A, so
   * this never needs to build a "B" key itself — but it takes `sublevel`
   * rather than hardcoding 'A' so it stays honest about that being the
   * advance rule's own output, not an assumption baked in here. */
  const levelKeyFor = (world, sublevel) => `${world}${sublevel === 1 ? 'B' : 'A'}`;

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
      try { hero = await loadSprites(level.world); digitFrames = sliceDigitFrames(hero.frames); }
      catch (e) { console.error('sprites failed to load', e); }
      spawn = levelSpawn(level.world);
      player = new Player(spawn.x, spawn.y);
      player.spawnAtLevelStart(spawn.x, spawn.y);   // CS:0x8C34 — the level-load seed
      events = new EventRunner(level.map, level.palfils);
      slots = new GroupSlots(); enemies = []; clamped = 0; firedByB = 0;
      slotsA = new GroupSlots(); enemiesA = []; clampedA = 0; firedByA = 0;
      firedHazardsByA = 0; firedHazardsByB = 0;
      groupsB = []; groupsA = []; popup = new Popup();
      messages = new MessageEngine(); seenTypes = new SeenBitmap();
      rng = new GodsRandom(1);
      nests = new Nests(level.world, rng); shots = new EnemyShots(); tock = 0;
      lineHazards = new LineHazards();
      markerList = new MarkerList();                    // CS:0x1437
      brood = new Brood();
      ce64Creatures = new Ce64Creatures(rng); ce64Spits = new Ce64Spits(rng);
      selectorTwo = new SelectorTwoSpawns();
      lineBarriers = new LineBarriers(level.map, level.lineBarrierRecords);
      patGroups = new PatGroups(level.patDirectory || []);
      patGroups.blobBytes = level.patBlobBytes || null;
      debris = new Debris();
      /* ⚠️ FIXED — same bug as arsenal below, same root cause. A level
       * change resets health/bar to full (CS:0x084B/0x0851 — correct, an
       * ordinary level load DOES restore health), but the familiar's own
       * state (DS:0x168/0x210/0x304) is cleared only by CS:0x047D/0x8DDF
       * (full restarts) and CS:0xAB53 (the familiar's own death) — never by
       * an ordinary level load. `new Health()` below wiped it every time
       * regardless, which would silently re-close the shop's gate 2 the
       * moment the player left and re-entered any shop, even without the
       * familiar ever dying. Carried across explicitly instead. */
      const carriedFamiliar = { energy: health.familiarEnergy,
        power: health.familiarPower, wings: health.familiarWings };
      health = new Health();
      health.familiarEnergy = carriedFamiliar.energy;
      health.familiarPower = carriedFamiliar.power;
      health.familiarWings = carriedFamiliar.wings;
      /* ⚠️ FIXED — this comment used to describe intent the code below it
       * didn't implement. A real level change is not a game restart, so
       * CS:0x914c does NOT run and the weapon slots should survive — but
       * this line unconditionally built a brand-new (unarmed) Arsenal on
       * EVERY level transition, silently disarming the hero every time,
       * which is what made the shop's own gate 1 (UNKNOWN_shop_eligibility_
       * gates, CLOSED — Gods/docs/shop.md) unreachable through its one real
       * entry path: entering a world 3/4 shop via password always calls
       * this function first. `reloadWorld` is the call that actually keeps
       * armed slots armed while re-pinning their counts under the new
       * world's PWEAPONS records (CS:0x35e9) and swapping in the per-world
       * Power table; `fullRestart()` is the one place arsenal is actually
       * rebuilt from scratch, mirroring CS:0x914c's own two callers being
       * full restarts, never a level transition. */
      arsenal.reloadWorld(level.weapons);
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
      lastStarburstBursts = 0;  // a fresh instance restarts its own bursts count at 0 too
      /* CS:0x69B1/0x8E40 restore every broken block, then clear the queue. */
      if (blocks) blocks.restoreAll(level.map.planeA, level.map.planeB);
      blocks = new Destructibles(level.world);
      /* CS:0x8EC2 and its three siblings free all four DS:0x8c3c slots on a
       * level load, so a puff never survives into the next level. */
      killSmoke.clear(); lastKillSmokeFx = [];
      /* A level change is not a restart, so lives carry; the timers do not
       * (the level-start block re-grants the short spawn invulnerability). */
      fx = { ...fx, invuln: INVULN_TICKS_SPAWN, freeze: 0, giantJump: 0,
             arc: 0, shop: false, stateMachineSuspended: false };
      /* Not the original's own state (there is no "mid-death-sequence level
       * exit" in the shipped game — the death test and a level-exit trigger
       * are mutually exclusive events), but defensive: a level switch while
       * a death/game-over is in flight should not leave a stale one behind. */
      deathSeq = null; lastDeathBurstFx = []; gameOverFade = null;
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

  /**
   * CS:0x0473/CS:0x8DD9 — the full game restart CS:0x914c's own header
   * comment already names as the ONLY thing that clears the weapon slots,
   * money, score and inventory (a level change, `switchLevel`, deliberately
   * carries all four). Reached both from BEGIN QUEST (key='1A', the menu's
   * own cursor-0 dispatch: `world:=1, sublevel:='a'`) and from a correct
   * password guess (key = that world's own 'A' sublevel — CS:0x2ea0/0x2ead
   * sets the world directly, then falls into the SAME `sublevel:=0; JMP
   * 0x1000:2a37` tail BEGIN QUEST uses).
   */
  async function fullRestart(key = '1A') {
    fx.lives = 2;                       // CS:0x8DD9's own starting value
    purse = new Purse(); score = new Score();          // CS:0x0487/0x8D91
    inventory = [INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY]; // CS:0x0498/0x8D80
    /* CS:0x914c — clears all three weapon slots (the hero starts UNARMED,
     * Gods/docs/consumables-and-treasure.md). This is now the ONLY place
     * arsenal is rebuilt from scratch — switchLevel's own reloadWorld call
     * preserves it across an ordinary level change, matching CS:0x914c's
     * own two callers both being full restarts, never a level transition. */
    arsenal = new Arsenal(level.weapons);
    /* CS:0xC470 (dismiss the familiar) — called from these exact same two
     * full restarts (CS:0x047D/0x8DDF). switchLevel's own health reset
     * below now CARRIES the familiar's state forward across an ordinary
     * level change (see its own comment), so a full restart has to clear
     * it explicitly here instead, the same asymmetry as arsenal above. */
    health.familiarEnergy = -1; health.familiarPower = 0; health.familiarWings = 0;
    deathSeq = null; lastDeathBurstFx = []; paused = false; gameOverFade = null;
    await switchLevel(key);             // CS:0x914c's own two callers both fall into world 1
  }

  /* CS:0x0643 — DS:0x194:=0x3880, DS:0x196:=1. The FULL 32-bit value (not
   * the low word alone, an arithmetic mistake this session's own docs
   * correct — see Gods/docs/shop.md) is 0x1_3880 = 80000. */
  const SHOP_STARTING_MONEY = 80000;

  /* World 2's shop roster — `SS:0x51aa`'s own full raw list for this world
   * (Gods/docs/shop.md's `UNKNOWN_shop_roster_source`, CLOSED): the 12-id
   * "stable core" this project's own live captures agreed on, plus `2`
   * (gated on the hero's weapon slots, `UNKNOWN_shop_eligibility_gates`,
   * CLOSED — this is exactly the id that disagreed between the two live
   * captures). `ShopScreen#rebuildVisible` does the filtering; this is the
   * full candidate list, not a pre-filtered one. Every id is independently
   * confirmed a real `game/consumables.js` `CONSUMABLES` type — shop.md's
   * own cross-check. `194,197,201` are weapon-purchase ids (`WEAPON_ID_BASE
   * + weaponIndex` — fireball, throwing star, magic axe): `UNKNOWN_shop_
   * tradein_value`, CLOSED, Gods/docs/shop.md — every raw id `>=0xc0` buys
   * and equips that weapon, not "sells" anything. */
  const SHOP_ROSTER_WORLD_2 = [0, 2, 35, 36, 38, 42, 44, 51, 52, 53, 70, 71, 72, 194, 197, 201];

  /* Worlds 3 and 4 share the same 18 consumable ids (world 2's 13 minus `2`
   * plus `3,37,39,40,41`, all independently confirmed as real CONSUMABLES
   * types) but DIFFERENT weapon-purchase ids — `SS:0x51aa`'s own raw lists
   * genuinely diverge there, not a transcription choice. `2`/`3` (power
   * potions) and `40`/`41` (familiar boosts) are gated by the two
   * eligibility checks — `UNKNOWN_shop_eligibility_gates`, CLOSED, Gods/
   * docs/shop.md: gate 1 opens once the hero holds any weapon
   * (`arsenal.slots`), gate 2 opens once a familiar is alive
   * (`health.familiarEnergy`), reachable by buying `39` (the familiar
   * itself) in this same shop. `ShopScreen#rebuildVisible` applies both
   * gates AND the grid's 17-slot scroll truncation (the original's own
   * `0x25c` path — with every gate open and a full purse, world 3/4's own
   * 21/23-entry raw lists both exceed 17, so the single cheapest survivor
   * silently drops). */
  const SHOP_CONSUMABLES_WORLD_3_4 = [
    0, 2, 3, 35, 36, 37, 38, 39, 40, 41, 42, 44, 51, 52, 53, 70, 71, 72,
  ];
  /* Weapon ids, per world — fireball/throwing star/spear for world 3,
   * fireball/spear/axe/hunter/mace for world 4 (`Gods/docs/shop.md`'s own
   * roster-source table, `UNKNOWN_shop_roster_source` CLOSED). */
  const SHOP_ROSTER_WORLD_3 = [...SHOP_CONSUMABLES_WORLD_3_4, 194, 197, 198];
  const SHOP_ROSTER_WORLD_4 = [...SHOP_CONSUMABLES_WORLD_3_4, 194, 198, 199, 200, 202];

  const shopRosterForWorld = (world) => (
    world === 2 ? SHOP_ROSTER_WORLD_2.slice()
    : world === 3 ? SHOP_ROSTER_WORLD_3.slice()
    : world === 4 ? SHOP_ROSTER_WORLD_4.slice()
    : []
  );

  /**
   * A correct password takes the player straight into that world's shop,
   * not the level itself. `FUN_1000_006f`'s own prologue runs the level
   * loader (`FUN_1000_8c34`) BEFORE its `DS:0x38c`/`DS:0x42` check redirects
   * into `FUN_1000_0643` (the shop's entry point) — the destination level
   * is already loaded and sitting in memory when the shop opens, and
   * leaving the shop does not load anything a second time. See
   * Gods/docs/shop.md's own "Forcing shop entry live" section for how this
   * order was established (and why entering the shop directly, skipping
   * the level load, crashes). Real prices are charged — `UNKNOWN_shop_
   * prices` is closed, see shop.js's own `PRICES` table and shop.md. */
  async function enterViaPassword(matchWorld) {
    uiState = 'shop';
    purse = new Purse(); score = new Score();
    inventory = [INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY];
    deathSeq = null; lastDeathBurstFx = []; gameOverFade = null;
    await switchLevel(levelKeyFor(matchWorld, 0));
    purse.add(SHOP_STARTING_MONEY);
    shopScreen = new ShopScreen({
      roster: shopRosterForWorld(matchWorld),
      inventory,
      state: { health, arsenal },
      purse,
      onDone: () => { uiState = 'game'; shopScreen = null; paused = false; },
    });
  }

  sel.addEventListener('change', () => { switchLevel(sel.value); });

  /* ── Attract mode (game/attract.js) ───────────────────────────────────
   * `attract` is null, or `{state, tape:{ticks, cursor}}` while the 6-state
   * `joyl`/`joyg` cycler is driving either the menu or real gameplay off a
   * decoded recording instead of the keyboard — see attract.js's own header
   * for the full CS:0x2DA6-0x2DEE trace this ports.
   *
   * `attractLoading` guards against re-entering `enterAttractState` while
   * its own `await`s are in flight (the SAME shape `transitioning` already
   * gives `switchLevel` — a joyg segment's own `enterAttractState` calls
   * `switchLevel` itself, so the two guards compose rather than duplicate). */
  let attractLoading = false;

  /**
   * Load `attract.js`'s `CYCLE[state]` and put the port into whatever state
   * that entry needs — CS:0x2DC7/0x2DCC (joyl: reset into the menu's own
   * redraw-poll head, `CS:0x2cc4`) or CS:0x2DE6/0x2DE9 (joyg: NOT a
   * fullRestart-bypassing jump as an earlier pass here assumed — CS:0x8C34
   * (`FUN_1000_8c34`, this whole function) turns out to BE one of
   * `fullRestart`'s own two real callers, confirmed by cross-referencing
   * its own comments' CS:0x8DD9/0x8DDF citations against this function's
   * body. So a joyg showcase entry is a full restart in every field
   * (lives/money/score/inventory/familiar/health, mirrored below in the
   * SAME order this function's own disassembly runs them) that happens to
   * land on a scripted position (`JOYG_SHOWCASE_SPAWN`) and weapon grant
   * (`JOYG_SHOWCASE_LOADOUT`, CS:0x8F3B) instead of world 1's own default
   * spawn and an unarmed hero — not a different, bespoke mechanism. */
  async function enterAttractState(state) {
    attractLoading = true;
    try {
      const entry = CYCLE[state];
      const bytes = dclDecompress(await fetchRaw(`game/${fileNameFor(entry)}`)).data;
      const { ticks } = decodeJoyRecording(bytes);
      if (entry.kind === 'joyl') {
        titleMenu.cursor = 0;                 // CS:0x2cc4 [0x385]:=0
        passwordEntry = null; nameEntry = null; hiscoreTable = null;
        uiState = 'menu';
        idleTicks = 0;                        // CS:0x2cc4's own idle-timer reset
      } else {
        /* CS:0x8C34 IS `fullRestart`'s own other real caller — confirmed
         * this pass, not assumed: `fullRestart`'s own comments already cite
         * CS:0x8DD9 (arsenal clear) and CS:0x8DDF (dismiss familiar) as one
         * of its "exact same two full restarts," and both addresses sit
         * inside THIS function, in its common prologue, before the
         * DS:0x3e7-gated showcase branch ever runs. So the showcase entry
         * is not "gameplay with some extra setup" — it is a full restart
         * that happens to land on a scripted position/loadout instead of
         * world 1's own default one. Mirrored here field-for-field:
         * lives=2 (CS:0x8DE2), money/score zeroed (CS:0x8DED/0x8D91),
         * inventory cleared (CS:0x8D80), familiar dismissed (CS:0x8DDF) —
         * all BEFORE switchLevel, exactly like fullRestart's own ordering,
         * since switchLevel deliberately carries money/score/inventory
         * forward and only clears familiar/health if this code already has. */
        fx.lives = 2;
        purse = new Purse(); score = new Score();
        inventory = [INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY];
        health.familiarEnergy = -1; health.familiarPower = 0; health.familiarWings = 0;
        deathSeq = null; lastDeathBurstFx = []; paused = false; gameOverFade = null;
        await switchLevel(levelKeyFor(entry.world, 1));   // sublevel B — JOYG_SUBLEVEL
        /* switchLevel's own `health = new Health()` already lands on
         * bar=START_BAR(1)/target=START_TARGET(24) — CS:0x8E16's own
         * `mov word[0x19a],1`, the SAME instruction `Health#respawn()` cites
         * (CS:0x0851) — so the showcase hero visibly climbs from 1 HP up to
         * full over the first ~23 ticks, matching a real respawn/restart's
         * own bar-chase animation exactly. Not a stand-in; confirmed by
         * cross-referencing the two call sites' identical opcode bytes. */
        const s = JOYG_SHOWCASE_SPAWN[entry.n];
        player = new Player(s.heroX, s.heroY);
        player.spawnAtLevelStart(s.heroX, s.heroY);       // CS:0x8C34
        cam = new Camera(s.camX, s.camY);
        /* CS:0x8F3B-0x8FC3 — a real, disassembly-derived per-world weapon
         * grant, not a fresh unarmed hero (game/attract.js's own
         * `JOYG_SHOWCASE_LOADOUT` citation). Each `count` is that many
         * separate `pickUpWeapon` calls, matching CS:0x8FE5's own `LOOP`.
         * CS:0x914c (the arsenal clear) already ran inside switchLevel's
         * OWN `arsenal.reloadWorld` this tick, but that preserves whatever
         * was armed rather than clearing it, so a fresh Arsenal is built
         * here too, matching fullRestart's own CS:0x914c/`new Arsenal`. */
        arsenal = new Arsenal(level.weapons);
        for (const { weapon, count } of JOYG_SHOWCASE_LOADOUT[entry.n]) {
          for (let i = 0; i < count; i++) pickUpWeapon(arsenal, weapon);
        }
        uiState = 'game';
      }
      attract = { state, tape: { ticks, cursor: 0 } };
    } finally {
      attractLoading = false;
    }
  }

  /* CS:0x2CB3-0x2CC1 — reached only from the idle-timer path below, never
   * re-checked once inside the cycler (docs/dynamic-trace-and-runtime-
   * data.md's "Idle timeout has two layers" section: 3 hiscore-table shows
   * in a row with no real input). `DS:0x384 >= 2` (hard-disk install) is
   * what the original ALSO gates this on — always true for this port, see
   * `hiscoreEntries`' own header. */
  function startAttract() {
    idleCycles = 0;
    enterAttractState(0);   // fire-and-forget — same convention switchLevel's other callers use
  }

  /** Any real keypress during playback wins — see the keydown handler's
   *  own citation for why this isn't modelled from a specific address. */
  function stopAttract() {
    if (!attract) return;
    attract = null;
    uiState = 'menu';
    passwordEntry = null; nameEntry = null; hiscoreTable = null;
    idleTicks = 0; idleCycles = 0;
  }

  /* ── The title screen ─────────────────────────────────────────────────
   * `uiState` gates BOTH the tick and render callbacks below. Every non-
   * 'game' state EXCEPT 'quitting'/'exit' is now TICK-POLLED (`step(input)`
   * on whichever widget is active), not keydown-driven — see title-menu.js's
   * own header for why this conversion was load-bearing, not cosmetic: the
   * attract-mode cycler (game/attract.js) needs a per-tick `input` object to
   * feed a `joyl`/`joyg` recording into, the exact same one real keyboard
   * input already fills every tick via the `input` object below. 'exit' is
   * this port's stand-in for QUIT's `INT 21h AH=4Ch` — see
   * Renderer.presentBlack(). */
  let uiState = 'menu';   // 'menu'|'password'|'name-entry'|'hiscore-table'|'game-over-fade'|'shop'|'game'|'exit'|'quitting'
  const titleMenu = new TitleMenu();
  let passwordEntry = null;
  let nameEntry = null;
  let hiscoreTable = null;
  /* Set when a GAME OVER's score beats the table's own last-place entry
   * (`hiscores.js`'s `rankOf`) — consumed the moment `nameEntry` submits,
   * see the death/game-over block below. */
  let pendingHiscoreRank = -1, pendingHiscoreScoreBytes = null;
  let shopScreen = null;
  /* CS:0x46E-onward — the live "TOP TEN GODS" table (Gods/docs/dynamic-
   * trace-and-runtime-data.md's own corrected HISCORES.BIN layout: 10 x
   * {name: 16 bytes, score: 4-byte packed BCD}). Loaded once below from the
   * shipped file, then overridden by whatever this browser's own localStorage
   * already holds — `DS:0x384 >= 2` (hard-disk install) is what makes this
   * round-trip to disk at all in the original (`docs/passwords.md`'s own
   * citation, cross-checked this session against `CS:0x229A`'s `INT 21h
   * AH=19h` "get default drive" source — see Gods/docs/dynamic-trace-and-
   * runtime-data.md's own correction); this port always models a hard-disk
   * install (the alternative makes the very feature the user asked to port
   * unreachable), so persisting via localStorage is the FAITHFUL behaviour
   * for that install type, not an arbitrary port addition — same reasoning
   * for `passwordSlots`' own persistence below, which gets it for the first
   * time in this same pass. */
  const HISCORES_STORAGE_KEY = 'gods-web:hiscores:v1';
  const PASSWORDS_STORAGE_KEY = 'gods-web:passwordSlots:v1';
  function persistHiscores() {
    try {
      localStorage.setItem(HISCORES_STORAGE_KEY, JSON.stringify(
        hiscoreEntries.map((e) => ({ name: e.name, scoreBytes: Array.from(e.scoreBytes) }))));
    } catch { /* private browsing / storage disabled — silently stays in-memory only */ }
  }
  function loadPersistedHiscores() {
    try {
      const raw = localStorage.getItem(HISCORES_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw).map((e) => {
        const scoreBytes = Uint8Array.from(e.scoreBytes);
        return { name: e.name, scoreBytes, score: bcdToNumber(scoreBytes) };
      });
    } catch { return null; }
  }
  let hiscoreEntries = loadPersistedHiscores() || initialHiscores;
  function persistPasswordSlots() {
    try { localStorage.setItem(PASSWORDS_STORAGE_KEY, JSON.stringify(passwordSlots)); }
    catch { /* see persistHiscores() */ }
  }
  function loadPersistedPasswordSlots() {
    try {
      const raw = localStorage.getItem(PASSWORDS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  /* CS:0x11e/0x120 (idle timer, reused level-timer pair) and CS:0x3d7 (idle-
   * cycle count) — `docs/dynamic-trace-and-runtime-data.md`'s own "Idle
   * timeout has two layers" section. Both apply to uiState 'menu' only (the
   * original's own gate is inside the MENU's poll loop specifically, not a
   * global idle timer — entering 'password'/'name-entry'/'hiscore-table'
   * leaves them untouched, exactly as CS:0x2CC4 only resets them on
   * re-entering the menu). ⚠️ DISCLOSED: this port resets `idleTicks` on
   * ANY recognized step() edge while the menu is up (movement or fire),
   * which is the natural, expected behaviour but was not independently
   * re-verified against a live capture of the exact reset condition this
   * session — the citation covers the 100-tick THRESHOLD and the "three
   * cycles" gate, not proof of what resets the counter mid-count. */
  let idleTicks = 0, idleCycles = 0;
  const IDLE_TICKS_THRESHOLD = 100;     // CS:0x2CF7 `cmp [0x11e],100`
  const IDLE_CYCLES_THRESHOLD = 3;      // CS:0x2CB3 `cmp [0x3d7],3`
  /* CS:0x2CBA `cmp [0x384],2 / jl` — hard-disk install only; this port
   * always models one (see hiscoreEntries' own header above), so the
   * attract cycler is always reachable, matching a real installed copy. */
  let attract = null;   // null, or {state, kind:'menu'|'game', ticks, cursor, world}
  /* ESC-to-quit and P-to-pause, live-confirmed in DOSBox (breakpoints at
   * CS:0x033E and CS:0x0357, GAME.EXE's per-tick FUN_1000_031a):
   *   CS:0x0335 CALL FUN_1000_2503 (INT 16h AH=1 peek / AH=0 read) ->
   *     AL==0x1B (ESC)  -> JMP FUN_1000_0996, which falls straight into the
   *       title-menu loop FUN_1000_2c82 (Begin Quest / Enter Password / Exit
   *       to DOS) — confirmed AL=0x011B at the breakpoint, screen back at the
   *       title menu one frame later.
   *     AL=='p'/'P'     -> CS:0x0357: a tight busy-wait (MOV [0x3ac],0 / CALL
   *       FUN_1000_2503 / JNC loop) that runs NOTHING else — no rendering, no
   *       ticks — until ANY key is read; confirmed live by an execute
   *       breakpoint at the loop head firing immediately after P, and by two
   *       frozen-then-resumed screen captures. Only Space sets [0x3ac]:=1 on
   *       exit (any other key leaves it 0); [0x3ac] itself has no reader
   *       anywhere else in GAME.EXE, so the practical effect is identical
   *       either way — the pause loop just falls through the SAME resume on
   *       any key. Confirmed live that ESC while paused does NOT quit — the
   *       pause loop has no ESC special-case, so it just unpauses like any
   *       other key (see the keydown handler below, which checks `paused`
   *       before `Escape`). */
  let paused = false;

/* CS:0x0996-0x09A6: ESC's target draws "QUIT GAME" (the SAME menu font as
 * above — see title-menu.js's MENU_ADVANCE citation) then calls the fade-out
 * driver export before falling into the title-menu loop — user-confirmed
 * live in DOSBox: "QUIT GAME is shortly on screen while the screen fades
 * out and exits to the menu". `uiState = 'quitting'` reproduces the VISIBLE
 * shape of that (frozen last game frame, "QUIT GAME" overlaid, palette
 * fading to black, then the menu) over `QUIT_FADE_MS` — a port-level
 * duration, not a byte-cited one: CS:0x359D is a single opaque driver call
 * with no GAME.EXE-side loop to time, so how long the real fade actually
 * takes is unmeasured, unlike everything else this pass confirmed with a
 * breakpoint. `quitFade.snapshot` is the world's own index buffer at the
 * instant ESC was pressed, so the frozen scene keeps rendering correctly
 * without re-running the (now-stopped) per-tick draw pipeline. */
const QUIT_FADE_MS = 600;
let quitFade = null;   // null | { snapshot: Uint8Array, palette: Uint8Array|number[], start: number }

/* CS:0x0943-0x098D — the game-over sequence's own "150-iteration palette
 * fade," full disassembly this pass: stop the music (export 10), play the
 * GAME OVER fanfare (`sfx 0x6413`, already identified — see the SFX-port
 * pass earlier this project), then `CX=0x96(150): { CALL 0x357f; CALL
 * 0x358d }` — 150 iterations of a driver-export pair (`0x357f`/`0x358d`
 * are themselves trampolines into the graphics driver's own export table,
 * `docs/drivers-and-memory.md`'s "Palette blank/fade-out/fade-in" family)
 * — before `CALL 0x318f` (name entry) and, once that returns, `AX=1; CALL
 * 0x359d` (fade back in, the SAME driver call `quitFade` above already
 * reproduces the shape of) ahead of `CALL 0x32c0` (the hiscore table).
 * `QUIT_FADE_MS`'s own header already disclosed why an exact duration
 * isn't recoverable (a tight software loop timed against the display
 * driver, not a byte-cited wall-clock figure) — this fade is the SAME kind
 * of call, so it gets the SAME treatment: a port-level duration, reusing
 * `quitFade`'s own snapshot-and-ramp mechanism rather than a second,
 * divergent implementation. Not modelled: the exact intermediate driver
 * calls between the fade-out and name-entry (CS:0x096E-0x0982, clearing
 * `DS:0x38d`/`0x33` and two more driver-export calls) — this port simply
 * shows the name-entry/hiscore-table screen once faded out, on its own
 * already-rendered background, rather than reproducing a specific
 * intermediate DAC state no player-visible difference hangs on. */
const GAME_OVER_FADE_MS = 600;
let gameOverFade = null;   // null | { snapshot, palette, start, next: 'name-entry'|'hiscore-table' }

  /* Gods/docs/dynamic-trace-and-runtime-data.md: UP/DOWN plays click sfx
   * 0x119, FIRE plays confirm sfx 0x233 — see title-menu.js's own citation
   * for the LEFT/RIGHT generalisation. Every widget below plays these from
   * its OWN `step()` return value now (title-menu.js's own header explains
   * why), not from a raw key event — this file just does `audio.play(r.sfx)`
   * wherever a `step()` result carries one. */

  /**
   * CS:0x2e6c-0x2e93 (byte-for-byte against each stored password; an empty,
   * never-generated slot never matches — zones.js's own `passwordSlots[i]`
   * is `null` until that world is first completed) PLUS CS:0x2e51-0x2e6a
   * (the attract-mode demo's own hardcoded "L"+digit bypass, `docs/
   * passwords.md`'s own citation — the demo can't feasibly script a real
   * password through recorded input, so while `attract` playback is live,
   * typing 'L' then a digit 2-4 sets the world directly, skipping the real
   * match loop). Both read the SAME submitted buffer regardless of whether
   * it came from a real player or a `joyl` recording driving this exact
   * widget — see game/attract.js's own header.
   * @returns {number} the world to jump to, or -1 (CS:0x2e8a, no match)
   */
  function matchPassword(submit) {
    for (let i = 0; i < passwordSlots.length; i++) {
      const pw = passwordSlots[i];
      if (pw && passwordToString(pw) === submit) return passwordWorldForSlot(i);
    }
    if (attract && submit.length === 2 && submit[0] === 'L' && submit[1] >= '2' && submit[1] <= '4') {
      return submit.charCodeAt(1) - '0'.charCodeAt(0);
    }
    return -1;
  }

  const input = { left: false, right: false, up: false, down: false, fire: false };
  const KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down', Space: 'fire',
    /* Enter used to be a MENU-only confirm alias (the old keydown-driven
     * `handleTitleKey`'s own `MENU_CONFIRM_KEYS`). Now that every widget
     * reads the one shared `input` object, it maps to 'fire' everywhere,
     * including real gameplay — a harmless generalisation, not a citation. */
    Enter: 'fire',
  };
  addEventListener('keydown', (e) => {
    /* A real keypress during attract-mode playback always wins — port-only
     * (see game/attract.js's own header: the original has no clean way to
     * distinguish a real key from the recording's own writes to the SAME
     * per-tick byte, and this is the sensible behaviour for a browser port
     * regardless). Checked before every other branch below, including
     * 'shop', since the cycler's own joyl segments can drive that far. */
    if (attract) { stopAttract(); }
    if (uiState === 'shop') {
      /* The shop (game/shop.js) reads this SAME `{left,right,up,down,fire}`
       * object every tick via the Clock's own `shopScreen.step(input)` call
       * above — it needs no dedicated key handler, just a way into `input`. */
      const k = KEYMAP[e.code]; if (k) { input[k] = true; e.preventDefault(); }
      return;
    }
    if (uiState === 'password' || uiState === 'name-entry') {
      /* ESC/Backspace are port-only conveniences with no `input` bit of
       * their own (the original's per-tick joystick byte has neither) —
       * see title-menu.js's `LetterGrid#cancel`/`#eraseKey`. Everything
       * else (arrows/space) flows into `input` below like any other state,
       * consumed by the widget's own `step()` in the tick callback. */
      const widget = uiState === 'password' ? passwordEntry : nameEntry;
      if (e.code === 'Escape') {
        e.preventDefault();
        if (uiState === 'password') { passwordEntry = null; uiState = 'menu'; }
        else {
          /* CS:0x318f's own scope: cancelling name entry (port-only — the
           * original has no "back" here either) skips the insertion, not
           * the table — the table is always shown after a game over. */
          nameEntry = null;
          uiState = 'hiscore-table';
          hiscoreTable = new HiscoreTable(hiscoreEntries);
        }
        return;
      }
      if (e.code === 'Backspace') { e.preventDefault(); widget.eraseKey(); return; }
    }
    if (uiState !== 'game') {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter']
        .includes(e.code)) e.preventDefault();
      const k = KEYMAP[e.code]; if (k) input[k] = true;
      return;
    }
    /* Paused (CS:0x0357's own busy-wait) resumes on ANY key, ESC included —
     * checked before the Escape/KeyP branches below so a paused ESC can't
     * fall through to the quit case; see the `paused` declaration above. */
    if (paused) { paused = false; e.preventDefault(); return; }
    if (e.code === 'Escape') {
      paused = false;
      quitFade = { snapshot: renderer.buf.slice(), palette: level.palette, start: performance.now() };
      uiState = 'quitting';
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyP') { paused = true; e.preventDefault(); return; }
    const k = KEYMAP[e.code]; if (k) { input[k] = true; e.preventDefault(); }
    /* CS:0x0943's own game-over sequence exits into the title/attract-mode
     * system — now REAL (see the death/game-over block below and game/
     * attract.js), not a placeholder: `uiState` itself leaves 'game' for
     * 'name-entry' or 'hiscore-table' the instant the third life is lost,
     * so there is no separate "press R" shortcut needed here any more —
     * those screens dismiss through their own FIRE/confirm handling
     * (title-menu.js's `LetterGrid`/`HiscoreTable`), reached via the
     * `uiState !== 'game'` branch above, not this one. */
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
      /* Attract-mode playback (game/attract.js) overrides `input` from the
       * decoded recording, BEFORE anything below reads it — a `joyl` tick
       * feeds the menu/password widgets exactly like a real keypress would
       * (docs/passwords.md's "the recorded demo navigating this same title
       * menu with fake joystick input"); a `joyg` tick feeds real gameplay
       * the SAME way once `uiState` is 'game' (below). This is the whole
       * mechanism — no attract-specific branching anywhere else in this
       * callback, by construction (see title-menu.js's own header for why
       * the tick-poll conversion was what made this possible at all). */
      /* ⚠️ FIXED — reported live: "in attract mode the hero jumps off the
       * very first ladder and clips into a platform, at which point the
       * port begins to diverge from the DOS version." Root cause: this
       * block used to run — and advance `t.cursor` — UNCONDITIONALLY, even
       * while `transitioning`/`attractLoading` was true (a level load in
       * flight, e.g. the exact tick after a `joyl` recording's own BEGIN
       * QUEST selection fires `fullRestart('1A')` a few lines below, or the
       * attract-mode "L"+digit password bypass). `switchLevel`'s `await
       * loadLevel`/`await loadSprites` genuinely span multiple real
       * animation frames (a fetch + DCL decompress), during which the
       * 'game' branch below correctly holds the frame (`if (transitioning)
       * return;`) — but this block, running BEFORE that gate, kept
       * consuming (and discarding, since nothing downstream read `input`
       * that tick) recorded ticks the whole time. In the original, level
       * loads are synchronous DOS I/O — zero simulated ticks ever elapse
       * during one — so this port's own async load was silently eating a
       * few ticks' worth of the recording, permanently shifting every
       * later tick's input one frame-offset off. The desync is invisible on
       * an easy stretch of flat walking but produces exactly the reported
       * symptom the first time the recording's timing-sensitive moves (a
       * ladder mid-air grab, then a jump-off) land a frame or two away from
       * where the original's own synchronous timing puts them. Gating this
       * block the same way the 'game' branch already gates itself keeps the
       * tape's cursor and the actual number of simulated ticks in lockstep,
       * exactly like the original's blocking load. */
      if (attract && !transitioning && !attractLoading) {
        const t = attract.tape;
        const frame = t.cursor < t.ticks.length ? t.ticks[t.cursor] : null;
        input.up = !!frame?.up; input.down = !!frame?.down;
        input.left = !!frame?.left; input.right = !!frame?.right; input.fire = !!frame?.fire;
        t.cursor++;
        /* CS:0xFF terminator exhausted (formats/joy.js strips it, so "ran
         * past the decoded ticks" IS "hit the terminator") — advance the
         * cycler. Disclosed: the original's own low-level "recording ended,
         * jump back to the dispatch head" mechanism was not traced this
         * pass — see attract.js's own header. */
        if (t.cursor >= t.ticks.length) enterAttractState(nextState(attract.state));
      }
      /* The inter-level tally/password sequence (game/tally.js) suspends
       * the normal per-tick simulation entirely, matching the original's
       * own state-machine-frozen tally screen (CS:0x6553's caller never
       * reaches FUN_1000_4993 while it runs) — see tally.js's own header.
       * `input.fire` is read directly rather than threaded through a
       * dedicated handler since the keydown listener below already sets it
       * while uiState stays 'game' throughout this sequence. */
      if (tallyScreen) {
        const award = tallyScreen.step(input.fire);
        if (award) purse.add(award);
        /* `sfxPending` is reset to false at the TOP of every step() call
         * (tally.js), so this reads as a fresh, single-tick latch — safe to
         * play once here without a separate "already played" guard. */
        if (tallyScreen.sfxPending) audio.play(CHA_CHING_SFX);
        if (tallyScreen.done) tallyScreen.onDone();
        return;
      }
      /* The shop (game/shop.js) is its own frozen uiState, same reasoning
       * as the tally screen above but simpler — the shop's own onDone
       * (enterViaPassword) already handed off into 'game', so nothing here
       * needs to watch for a state change the way the tally screen's
       * onDone dispatch does. */
      if (shopScreen) {
        /* Read the RETURN value, not `lastPurchase` — `lastPurchase`
         * persists across ticks, so gating on it would replay the sound
         * every tick after a purchase instead of once, on the tick it
         * actually completed. Refusals have no cited sfx id (shop.md only
         * documents a message priority for them), so they stay silent. */
        const purchase = shopScreen.step(input);
        if (purchase && !purchase.refused) audio.play(BUY_CONFIRM_SFX);
        return;
      }
      /* The title menu / password / name-entry / hiscore-table screens
       * freeze the whole simulation, same as the original's own menu loop
       * never runs FUN_1000_4993 (the per-frame player update) while it has
       * control — see the 'uiState' header comment above. Each widget plays
       * its own sfx from its `step()` return now (title-menu.js's header). */
      if (uiState === 'menu') {
        /* CS:0x2CF7 `cmp [0x11e],100` / CS:0x2CB3 `cmp [0x3d7],3` — the idle
         * timer only advances (and the whole cycler is only reachable) from
         * THIS state; see the `idleTicks`/`idleCycles` declaration above for
         * the reset-on-activity disclosure. */
        if (!attract) {
          idleTicks++;
          if (idleTicks >= IDLE_TICKS_THRESHOLD) {
            idleTicks = 0;
            idleCycles++;
            if (idleCycles >= IDLE_CYCLES_THRESHOLD) { startAttract(); return; }
            hiscoreTable = new HiscoreTable(hiscoreEntries);
            uiState = 'hiscore-table';
            return;
          }
        }
        const r = titleMenu.step(input);
        if (r) {
          // any recognized edge resets BOTH counters — breaks the "N idle cycles IN A ROW" chain, see the disclosure above
          idleTicks = 0; idleCycles = 0;
          if (r.sfx) audio.play(r.sfx);
          if (r.action === 'begin') { uiState = 'game'; fullRestart('1A'); }
          else if (r.action === 'password') { uiState = 'password'; passwordEntry = new PasswordEntry(); }
          else if (r.action === 'exit') { uiState = 'exit'; }
        }
        return;
      }
      if (uiState === 'password') {
        const r = passwordEntry.step(input);
        if (r) {
          if (r.sfx) audio.play(r.sfx);
          if ('submit' in r) {
            /* CS:0x2e51-0x2e6a — the attract-mode "L"+digit bypass fires
             * ONLY during playback, and lands on the SAME continuation as
             * BEGIN QUEST (CS:0x2ea0/0x2d9e -> JMP 0x1000:2a37), not the
             * real-password match's own shop entry — see matchPassword()'s
             * own citation and docs/shop.md's "a correct password takes the
             * player straight into that world's shop" (that is true only
             * for a REAL match, below). */
            const bypass = !!attract && r.submit.length === 2 && r.submit[0] === 'L'
              && r.submit[1] >= '2' && r.submit[1] <= '4';
            const world = bypass ? r.submit.charCodeAt(1) - 0x30 : matchPassword(r.submit);
            passwordEntry = null;
            uiState = 'menu';                 // CS:0x2e8a default; overridden below on a match
            if (bypass) { uiState = 'game'; fullRestart(levelKeyFor(world, 0)); }
            else if (world > 0) enterViaPassword(world);
          }
        }
        return;
      }
      if (uiState === 'name-entry') {
        const r = nameEntry.step(input);
        if (r) {
          if (r.sfx) audio.play(r.sfx);
          if ('submit' in r) {
            /* CS:0x329A-0x32B6's own insert-and-shift-down — `hiscores.js`'s
             * `insertAt`. `pendingHiscoreRank`/`ScoreBytes` were captured at
             * the moment the third life was lost (the death/game-over block
             * below), before this screen ever opened. */
            insertAt(hiscoreEntries, pendingHiscoreRank,
              { name: r.submit, scoreBytes: pendingHiscoreScoreBytes, score: score.value });
            persistHiscores();
            nameEntry = null;
            uiState = 'hiscore-table';
            hiscoreTable = new HiscoreTable(hiscoreEntries);
          }
        }
        return;
      }
      if (uiState === 'hiscore-table') {
        if (hiscoreTable.step(input)) {
          hiscoreTable = null;
          if (attract) { enterAttractState(nextState(attract.state)); return; }   // CS:0x2D07 `jmp 0x2caf`
          uiState = 'menu';
        }
        return;
      }
      if (uiState !== 'game') return;
      if (transitioning) return;    // a level load is in flight — hold the frame
      /* CS:0x0357's own busy-wait: pressing P freezes ticking until any key
       * is pressed — see the `paused` declaration and keydown handler above.
       * The render callback below still runs every rAF frame as usual; with
       * nothing left ticking, it just keeps redrawing the same frozen state,
       * matching the original's own silent freeze (no "PAUSED" overlay). */
      if (paused) return;
      /* Per-tick order is the original's: snapshot the scroll origin, run the
       * state machine, probe plane B, then update the camera (CS:0x023f ->
       * 0x4993 -> 0x5ea0 -> 0x5ea4). Everything drawn this frame uses the
       * snapshot, so the hero and the background never skew apart. */
      cam.snapshot();
      /* CS:0x0e83/0x0e8a — the health bar's own shimmer phase (game/health-
       * bar.js), gated on every OTHER tick in the original; unconnected to
       * anything else this tick does, so it advances here rather than
       * threading it through the render callback below. */
      stepHealthBarShimmer(healthBarShimmer);
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
      /* CS:0x01F2 — the line-barrier rescan (game/line-barriers.js's own
       * `tick()`), advancing every CYCLING selector-7-10 barrier one
       * Bresenham leg. `[PROVEN]` this session (frame.js's own
       * `LINE_BARRIERS_AT`, get_xrefs_to on CS:0x767A): called from BOTH
       * FUN_1000_006f (here, unconditionally, before pickup/projectiles/
       * the player) AND the death driver FUN_1000_09BB at CS:0x09C7 — so it
       * must run every tick regardless of `deathSeq`, which is why this call
       * sits ABOVE that gate rather than inside it. Corrects an earlier
       * pass that shipped this call near the END of the tick instead,
       * grouped with `lineHazards.step()` and disclosed only as "not pinned
       * to an exact CS: call site" — the site was one `get_xrefs_to` away,
       * and that placement was backwards, not merely unproven. One disclosed
       * residual: `grid.clear()`/`blocks.step()` (CS:0x01CC/0x01DF) run
       * inside `stepHeroFrame` below, i.e. AFTER this call, where the
       * original runs them BEFORE — semantically inert, since this system
       * touches neither the damage grid nor destructible blocks. Settle
       * barriers (the vast majority) are untouched by this call. */
      lineBarriers.tick();
      /* CS:0x01BD's own `jmp 0x9bb` skips the player state machine entirely
       * once the hero is dead (game/death.js) — everything else in this
       * tick (enemies, hazards, projectiles, events) keeps running, matching
       * the busiest reading of FUN_1000_09bb's own call graph; only the
       * player's own actions (fire, pickups, block-breaking, levers) stop. */
      let fr = null;
      if (!deathSeq) {
      fr = stepHeroFrame({
        input, arsenal, grid, player,
        map: level.map, cam: { x: cam.snapX, y: cam.snapY }, world: level.world,
        /* CS:0x0206 — the object pass. `drawObjects` is the same array the
         * renderer walks, so collecting one removes it from the frame too. */
        objects: level.drawObjects, bar: health.bar,
        cats: level.cats, health, invuln: fx.invuln > 0,
        effects: { ...fx, starburst,
                   hero: { x: player.x, y: player.y } },
        treasure: { values: level.objValues, inventory, purse, score, burst },
        starburst, blocks, debris,
        burst, tock, inventory,
        /* CS:0x1045 — idle+FIRE's own lever/switch toggle (game/levers.js).
         * `level.palfils.levers` is the SAME parsed PALFILS window `events.js`
         * already reads for COND11/12; `leverToggle` mutates it in place, so
         * a level's own trigger conditions see the flip on the very next tick. */
        levers: level.palfils.levers, leverToggle,
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
      }
      /* CS:0x6139 (crouch tick) / CS:0x499A->0x1e06 (every other tick) — the
       * panel's own extend/retract highlight animation. Runs unconditionally,
       * same as the draw call itself. */
      inventoryPanel.step(player.state === ST.CROUCH);
      if (fr) {
      if (starburst.bursts !== lastStarburstBursts) {
        audio.play(SPAWN_SFX);
        lastStarburstBursts = starburst.bursts;
      }
      for (const t of fr.treasures) {
        if (t.sfx) audio.play(t.sfx);
        /* CS:0x18A4 (ordinary treasure, CX = type) and CS:0x18EF (a chest just
         * unlocked, CX = type|1 — the OPEN sprite's own type, which is why the
         * message reads "treasure chest / open" rather than "/ iron"). */
        if (t.outcome === 'collected') postObjectMessage(t.type);
        else if (t.outcome === 'unlocked') postObjectMessage(t.type | 1);
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
      /* CROUCH + FIRE, CS:0x6069 -> game/pickup.js's `scanForKey`/`collectKey`. */
      if (fr.keyCollected) {
        $('event').textContent =
          `key ${fr.keyCollected.type} collected (slot ${fr.keyCollected.slot})`;
      }
      /* IDLE + FIRE, CS:0x1045 -> game/levers.js's `LeverToggle`. */
      if (fr.leverToggled) {
        audio.play(SFX_LEVER_TOGGLE);
        const on = leverToggle.animating() || (fr.leverToggled.type & 1);
        $('event').textContent =
          `lever/switch type ${fr.leverToggled.type} ${on ? 'ON' : 'OFF'}` +
          (leverToggle.animating() ? ' (animating)' : '');
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
      if (fr.emitted) { shotsFired++; audio.play(FIRE_SFX); }   // CS:0x985f/0x9895
      /* CS:0x5AAD/0x5ABA — already gated to WALK_FOOTSTEP_PHASES by
       * player.js, so this per-tick check IS the tuned cadence, not a bare
       * trigger. See audio/audio-bus.js's own header for why the earlier
       * "needs cadence tuning" caveat here was checked and closed. */
      if (fr.footstep) audio.play(FOOTSTEP_SFX);
      /* The FUN_1000_5931 thunk's four callers — the climb ping-pong's two
       * turn-arounds, already gated behind _climb's own tock===0 return. */
      if (fr.climbStep) audio.play(CLIMB_STEP_SFX);
      /* CS:0xA7F6 — one play per projectile the terrain stops this tick,
       * not one per tick: `fr.projectiles.hits` already carries one entry
       * per stop (Arsenal.step collects it from every slot's own
       * stepProjectiles call), the same array frame.js already drains for
       * the debris puff at each hit. */
      for (let i = 0; i < fr.projectiles.hits.length; i++) audio.play(TERRAIN_SFX);
      /* CS:0xa7ad — likewise one play per bounce this TICK. Arsenal.step's
       * own `this.axeBounced` is a lifetime total (for the HUD); the
       * returned `axeBounced` is the per-tick delta this hook needs. */
      for (let i = 0; i < fr.projectiles.axeBounced; i++) audio.play(AXE_BOUNCE_SFX);
      /* The time bomb's own bounce/land/detonate ids — Arsenal.step()
       * (hero-fire.js) already collects one entry per event this tick,
       * same shape as `hits`/`axeBounced` above. */
      for (const id of fr.projectiles.bombSfx) audio.play(id);
      for (const c of fr.consumed) {
        consumed++;
        postPickupMessage(c);
        /* CS:0x6377 — over-healing is banked into DS:0x168 at 32 a point,
         * not discarded. UNKNOWN_DS_0168, so it is only counted here. */
        if (c.banked) banked += c.banked;
        /* ⚠️ BUG FIX. CS:0x62EC `inc word [0x224]` — the extra-life potion
         * (rank 10, type 42). `applyConsumable` was called with a SPREAD
         * COPY of `fx` (`{...fx, starburst, hero}`), so `state.lives` inside
         * that handler mutated a throwaway object; the potion incremented a
         * value nothing ever read back. `c.result.lives` already carries the
         * new total (consumables.js's own `state.lives = (state.lives??0)+1`
         * seeds from that same spread copy), so apply it to the REAL fx. */
        if (c.result && typeof c.result.lives === 'number') fx.lives = c.result.lives;
        /* ⚠️ The tablet reaches this loop through the `notWired` branch, since
         * its effect is not an `applyConsumable` state change. Left alone, the
         * debug HUD read `"tablet" (reveals clues) — hint: ...` while the panel
         * below was showing the hint perfectly — i.e. it still READ as
         * unported, which is the exact trap that hid this whole subsystem for
         * as long as it was hidden. Report what actually happened. */
        if (c.type === HINT_TABLET_TYPE) {
          const off = hintOffsetForX(level.hints.keys, level.hints.offs, c.x);
          $('event').textContent = off >= 0
            ? `tablet @x=${c.x} → hint "${String.fromCharCode(...stringAt(level.textPool.arena, off))}"`
            : `tablet @x=${c.x} → no PALFILS key (CS:0x63FC's own bug path) — "Hint Error"`;
          continue;
        }
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
        if (p.sfx) audio.play(p.sfx);
        $('event').textContent = `picked up ${WEAPON_NAMES[p.weapon]}` +
          (p.duplicate ? ` (again — count ${p.count})` : ` into slot ${'ABC'[p.slot]}`);
      }
      }
      /* CS:0x02DB `call 0x4569` — the message line's own countdown and page
       * flip (game/message.js).
       *
       * ⚠️ ORDER, AND IT IS AN OFF-BY-ONE IF YOU GET IT WRONG. The original
       * picks objects up inside the player state machine at CS:0x0254 and
       * updates the message at CS:0x02DB — POST FIRST, THEN DECREMENT, in the
       * same frame. Running the update before the pickup block gives a
       * freshly-posted message 32 frames instead of 31.
       *
       * UNCONDITIONAL, and deliberately outside the `if (fr)` guard above:
       * CS:0x02DB is straight-line in the main loop, and `fr` is null on
       * death/game-over frames, where a message must still count down. */
      messages.step();
      /* Re-sync ACT6's kill target: level.drawObjects is reassigned (not
       * mutated) by insertSpawned above on a loot settle / carried-item drop,
       * which would otherwise leave events.actionCtx.objects pointing at a
       * stale array. */
      events.actionCtx.objects = level.drawObjects;
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
        /* CS:0x1012 — FUN_1000_de6f, `rep stosb` 0x8e8 (2280) bytes at
         * SS:0x3768: the System-A entity group-RUNTIME array, 10 slots x
         * 0xe4 bytes, zeroed wholesale. This was a disclosed gap in
         * game/zones.js's own header ("this port does not reproduce that
         * yet"). NOT System B — de6f's own literal base is 0x3768, System
         * A's runtime; System B's is a different array (SS:0x36b4) that
         * this instruction never touches, so only System-A creatures are
         * wiped by a teleport.
         *
         * This port has no single runtime array to zero — the equivalent
         * state is spread across three structures (slotsA: per-slot
         * activation; groupsA: per-group reward-tracking; enemiesA: the
         * live entities themselves). Zeroing the original's array means a
         * System-A group's entities are never walked by CS:0xdf39's own
         * per-frame loop again — they are not merely frozen, they become
         * permanently unreachable. Every element of enemiesA is pushed
         * exactly once, alongside a groupsA record, by runSpawnsA() above —
         * there is no other producer — so clearing all three together is a
         * complete and faithful mirror of the original's block-clear, not
         * an approximation of it. */
        slotsA = new GroupSlots();
        groupsA = [];
        enemiesA = [];
        $('event').textContent = `teleport zone -> (${dest.x}, ${dest.y})`;
      } else if (zoneHit && zoneHit.kind === ZONE_EXIT && !transitioning && !tallyScreen) {
        const dest = resolveExitDestination(zoneHit.arg);
        if (!dest) {
          $('event').textContent =
            `level exit — arg ${zoneHit.arg} out of range, inert (CS:0x0FC8)`;
        } else {
          /* CS:0x0FAC-0x0FDC in the original only sets DS:0x178/DS:0x36a —
           * the real dispatch (world advance, key clear, password reveal)
           * runs from the main loop's own post-frame check (CS:0x02F0, `call
           * 0x6553`), AFTER the tally screen's own bonus countdown, not on
           * the zone hit itself. `game/tally.js`'s own header covers the
           * full citation; everything below that used to run synchronously
           * here (`clearNonPotionInventory`, the pool reset, `advanceWorld`+
           * `switchLevel`) is now deferred into `finishTallyScreen`, called
           * once `tallyScreen.done` goes true (see the tick callback). */
          const fx2 = exitEffects(dest.bits);
          const completedWorld = levelInfo.world;
          /* FUN_1000_69d7 — generate-if-empty, keyed to the world being
           * LEFT. Generated here rather than at tally-screen completion (a
           * disclosed simplification: this port's own `rng` draws no other
           * randomness during the tally sequence, so the exact tick the
           * draw happens on doesn't change the result) but only SHOWN if
           * this call is what freshly filled the slot — CS:0x69e3's own
           * `cmp byte[SI],0/jnz` bails silently on a slot that already had
           * one, which this mirrors via `wasEmpty`. */
          let passwordReveal = null;
          if (fx2.genPassword) {
            const passwordSlot = passwordSlotForWorld(completedWorld);
            const wasEmpty = passwordSlot >= 0 && passwordSlot < passwordSlots.length &&
              !passwordSlots[passwordSlot];
            if (wasEmpty) { passwordSlots[passwordSlot] = generatePassword(rng); persistPasswordSlots(); }
            if (wasEmpty) {
              passwordReveal = {
                worldNumber: completedWorld + 1,             // CS:0x69f7 `inc cl` — see tally.js header
                code: passwordToString(passwordSlots[passwordSlot]),
              };
            }
          }
          tallyScreen = new TallyScreen({
            title: dest.text.trim().replace(/\s+/g, ' '),
            lives: fx.lives,
            health: health.target,          // DS:0x192, not the chasing bar (DS:0x19a) — see combat.js's Health
            moneyTotal: purse.total,
            password: passwordReveal,
          });
          const finishTallyScreen = () => {
            if (fx2.clearKeys) clearNonPotionInventory(inventory, level.cats);
            if (fx2.poolReset) {
              /* FUN_1000_6992, LEVEL THREE only (see the table in zones.js's
               * header — bit 9 is set on no other record). The original
               * re-runs a chunk of FUN_1000_8c34's own level-init sequence:
               * destructible blocks, System-A's entity-group runtime, and
               * several small hazard-pool clears. The destructible-block
               * restore/clear pair in THAT sequence is itself gated
               * `world != 3`, so at the world this handler fires from (3) it
               * is already a no-op in the ORIGINAL — `blocks` is correctly
               * left untouched here, not an omission. What genuinely resets:
               * System-A's entity-group runtime (the same three-structure
               * mirror of FUN_1000_de6f the teleport-zone branch above
               * already uses) and the line-hazard pool (FUN_1000_dbfb,
               * game/line-hazard.js). Two further sub-resets in the
               * original's own sequence — a "spawn flash" pool at DS:0xac90
               * and the pickup-sparkle array at DS:0xb578 — have no port-side
               * module at all yet; the world-2 nest pool (DS:0xcfcc) is
               * world-2-specific and already empty by world 3 in ordinary
               * play. None of those three are reproduced here. */
              slotsA = new GroupSlots();
              groupsA = [];
              enemiesA = [];
              lineHazards = new LineHazards();
            }
            $('event').textContent = `level exit -> "${dest.text.trim()}"`;
            if (fx2.advance) {
              /* FUN_1000_6b00 — the ENTIRE advance rule: +1, wrapped 5->1,
               * sublevel FORCED to A. Never a jump to a specific world. */
              const next = advanceWorld(completedWorld);
              switchLevel(levelKeyFor(next.world, next.sublevel));  // fire-and-forget
            }
            tallyScreen = null;
          };
          tallyScreen.onDone = finishTallyScreen;   // read by the tick callback below
        }
      }

      /* CS:0x0282 — the nest walker, BEFORE the System-B entity step at
       * 0x0285 (below) and after the CS:0x027F brood gate (game/nest.js's
       * `Brood`, now wired below instead of the `null` this file used to
       * pass, which is what silently made every nest death spawn nothing). */
      const camNow = { x: cam.snapX, y: cam.snapY };
      const nestContact = (box) => attackHero(
        { x: box.x, y: box.y, w: box.w, h: box.h, strength: box.hp },
        { x: player.x, y: player.y, state: player.stateIndex }, health,
        { invuln: fx.invuln > 0, sfx: (id) => audio.play(id) }).strengthOut;
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
                                     { rng: () => rng.next(), debris,
                                       sfx: (id) => audio.play(id) });
        return { killed: r.killed };
      };
      /* ⚠️ NOT `nestContact`. `checkTrigger`'s own "defer if the hero is
       * standing on the dormant statue" probe (`CS:0x7D6E call 0x1000:ac59`,
       * DIRECTLY — confirmed live in Ghidra, unlike statue.js's own live-
       * creature touch test at `CS:0x7C90 call 0x1000:a9e4`) never reaches
       * `a9e4`'s `abc0`, so it never plays a sound in the original — it
       * even snapshots/restores `health.target` around the call BECAUSE
       * it's a pure geometry probe, not a real hit. Reusing `nestContact`
       * here would have played `KILL_SFX` every tick the hero merely stands
       * near a dormant world-1-sublevel-B statue. */
      const statueTriggerProbe = (box) => attackHero(
        { x: box.x, y: box.y, w: box.w, h: box.h, strength: box.hp },
        { x: player.x, y: player.y, state: player.stateIndex }, health,
        { invuln: fx.invuln > 0 }).strengthOut;
      /* CS:0xC041, via objects.js's dropCarriedItem — steal-and-carry's own
       * periodic and death-time drops both land here, for BOTH entity
       * systems (moved above the System-B loop, which now also needs it —
       * see CS:0xEE61/EEB1/F054/F059, entity.js's own stepCarriedItemB and
       * the DYING branch). Re-ranks the object array on a successful drop,
       * same reason as the treasure-burst loot settle below: allocObject
       * reuses a dead slot in place, but this port's own draw order is a
       * one-time sort at load, not a per-frame partition like the
       * original's export 32.
       *
       * Hoisted above the popup tick below, which needs it. */
      const dropCarriedIntoWorld = (id, x, y) => {
        const dropped = dropCarriedItem(level.drawObjects, id, x, y);
        if (dropped) {
          level.drawObjects = insertSpawned(
            level.drawObjects.filter((o) => o !== dropped), level.cats, dropped);
        }
      };

      /* ── THE SINGLE POPUP SLOT, AND WHO GETS IT ──────────────────────────
       *
       * Every "award an item on a kill" in the game contends for ONE slot
       * (DS:0x1a0). A loser is not queued and not lost: CS:0xBF6B lands it
       * immediately, right where it was awarded, instead of tossing it. So
       * WHICH channel wins a contended frame is observable — it decides
       * which reward arcs and which appears in place.
       *
       * The frame loop FUN_1000_006f fixes that priority by call order, and
       * this file now follows it exactly. Every entry below is a call site
       * inside 006f, read off the binary this session:
       *
       *     0x0209  CALL bf80   the TICK            <- here
       *     0x0223  CALL ad88   selector-2          (aefa)
       *     0x0285  CALL ed15   System B            (eda0, f068)
       *     0x028b  CALL df39   System A            (dfe7, e27d)
       *     0x0294  CALL b987   selector-1 PAT      (bba8)
       *     0x029a  CALL 7b68   the awakened statue (7ca2)
       *
       * ⚠️ The port previously ran this list almost exactly BACKWARDS —
       * statue first, tick last. Two consequences, both now fixed. The tick
       * frees the slot when an arc ends (CS:0xBFE9/0xC03B), so running it
       * last meant an award on the landing frame always saw a busy slot and
       * diverted, every single time. And PAT beat System A/B to the slot
       * when the original has PAT losing to both.
       *
       * The PAT walker is worth spelling out because it is the one channel
       * that can contend with ITSELF: CS:0xB977 is a bare 5-iteration loop
       * (`pop di / pop si / add si,0x1c / add di,0xc8 / dec [0x3a9] / jnz
       * b992`, RET at 0xB986) with NO tick call inside it, so when two
       * scripted groups finish on the same frame the first takes the slot
       * and the second diverts. pat-objects.js queues drops in slot-walk
       * order and the drain below replays that order, so both halves of
       * that behaviour survive the port.
       *
       * ── WHERE A REWARD BECOMES AN OBJECT ─────────────────────────────
       *
       * INLINE, at the award site — never deferred. `dropCarriedIntoWorld`
       * is handed to every popup.step/popup.spawn below because CS:0xC041
       * is reached by FALLING INTO it from three places that are all in the
       * middle of a frame: the arc's terminator (CS:0xBFE9/0xC03B), the
       * busy-slot divert (CS:0xBF6B) and the id-0x3D snap (CS:0xBF59). An
       * object created there exists for the REST of the frame, so later
       * channels — and entity.js's own steal probe, which is handed
       * `level.drawObjects` at CS:0xEE61 — can see it on the same tick.
       * An earlier revision queued these landings and drained them at the
       * bottom of the tick; that made a selector-2 divert invisible to the
       * System-B steal probe, which is a divergence, not a simplification. */
      popup.step(dropCarriedIntoWorld);

      statues.checkTrigger(camNow, level.map.planeA, levelInfo.world, health,
                            statueTriggerProbe, rng);
      const statueResult = statues.step(
        camNow, { x: player.x, y: player.y }, fx.freeze,
        nestContact, statueScanGrid, tock);
      score.add(statueResult.score);
      lastStatueFx = statueResult.drawn;
      /* The statue's own kill award (CS:0xBF5F) is NOT drained here: its
       * walker is CS:0x029A, the LAST popup channel in the frame. The drain
       * lives at the bottom of this tick, past both entity systems. */

      /* CS:0x7F0D — the world-3 DS:0xce64 creature and its "spit". Neither
       * module needs injected callbacks (see ce64.js's own header for why it
       * calls combat.js directly, unlike nest.js/statue.js), so this just
       * hands them the real objects. */
      const ce64Opts = { invuln: fx.invuln > 0, difficulty, debris, score,
                          sfx: (id) => audio.play(id) };
      lastCe64Fx = ce64Creatures.step(
        camNow, { x: player.x, y: player.y, state: player.stateIndex }, fx.freeze,
        health, grid, decodeTag, ce64Spits, ce64Opts).drawn;
      lastSpitFx = ce64Spits.step(
        camNow, { x: player.x, y: player.y, state: player.stateIndex }, fx.freeze,
        health, grid, decodeTag, ce64Opts).drawn;

      /* CS:0x1447/0x1B72/0x1AF6 — the retracting spike hazard (types
       * 50/117/130, game/spikes.js). Undebounced flat damage, so it does NOT
       * route through the shared attackHero/creatureScansGrid contact path
       * every creature in this file uses — it applies straight to `health`. */
      spikeClock.step();
      /* CS:0x148B `inc byte [0x3a0]` / CS:0x148F `and byte [0x3a0],0x7` —
       * the SAME once-per-frame function (FUN_1000_1432) that advances the
       * spike counters four instructions earlier, so it steps here. Unlike
       * DS:0x39c/0x39d/0x39e it is NOT behind CS:0x1450's DS:0x36c gate:
       * the crystal advances every tick. */
      objectAnimClock.step();
      lastSpikeFx = stepSpikes(level.drawObjects, spikeClock,
        { x: player.x, y: player.y }, health, { invuln: fx.invuln > 0 });

      /* CS:0x0239 `call 0x3cc7` — ACT6's smoke puffs advance a frame and
       * draw (game/kill-smoke.js). The walker sits in the main loop between
       * the starburst step (CS:0x0212) and the player state machine
       * (CS:0x0254), so a puff draws UNDER the hero and under every entity,
       * which is where the draw loop below puts it. */
      lastKillSmokeFx = killSmoke.step(camNow);

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
        { invuln: fx.invuln > 0, score, debris, planeB: level.map.planeB,
          sfx: (id) => audio.play(id) }).drawn;
      /* CS:0x0223 / CS:0xAED0-0xAF0F — drain selector2.js's own group-
       * elimination rewards into the SAME single-slot popup. FIRST of the
       * six channels (the walker is CS:0xAD88, earlier in the frame than
       * either entity system), so on a contended frame selector-2 is the
       * one that gets to arc. It used to be drained last, after System A/B
       * and PAT had already taken the slot. */
      for (const r of selectorTwo.rewards) {
        const id = r.itemType !== null ? r.itemType + 0xb : r.popupValue;
        popup.spawn(r.x, r.y, id, dropCarriedIntoWorld);
      }
      selectorTwo.rewards.length = 0;

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
        { invuln: fx.invuln > 0, difficulty, rng: () => rng.next(), debris, score,
          sfx: (id) => audio.play(id) });

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
          popup.spawn(e.deathDropX, e.deathDropY, e.deathDropId, dropCarriedIntoWorld);
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
          popup.spawn(e.deathDropX, e.deathDropY, e.deathDropId, dropCarriedIntoWorld);
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
        sfx: (id) => audio.play(id),
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
          popup.spawn(x, y, g.desc.rewardId, dropCarriedIntoWorld);
        }
      }
      /* CS:0xEDAA-0xEDB1 — RELEASE THE RUNTIME SLOT. Read fresh off the
       * binary this session, because the predicate is NOT the reward's:
       *
       *     ed78  mov cl,[0x3c3]      ; members that are fully FREE
       *     ed7c  add cl,[0x1f4]      ; + members still DYING
       *     ed80  cmp cl,[si] / jnz   ; == count  -> the REWARD above
       *     edaa  mov al,[0x3c3]      ; fully-FREE members ONLY, no dying
       *     edad  cmp al,[si]
       *     edaf  jl  edb6            ; fewer than count -> keep the slot
       *     edb1  mov word [bp+0],0   ; <- free it
       *
       * So the reward fires on (FREE|DYING) === count but the slot frees
       * only on FREE >= count: a group mid-death-animation has already paid
       * its reward and still holds its slot. Reusing the reward predicate
       * here would free the slot one death-fade early.
       *
       * The port had NO release at all, and main.js's own comment claimed
       * GroupSlots had "no fixed runtime-slot cap to recycle" — it has ten
       * (spawn.js RUNTIME_SLOTS). Levels 2A/3A/4A/4B activate 25-38 distinct
       * System-B groups, so the pool filled and every later activation was
       * consumed-and-lost. See tools/spawn-census.mjs for the per-level count.
       *
       * `[si]` is the DESCRIPTOR's own count, not the materialised member
       * total; they differ only if count > MAX_ENTITIES, which no shipped
       * descriptor does (measured counts are {1,2,3,4,5,10}). Comparing
       * against members.length would silently change the predicate if that
       * ever stopped being true, so the descriptor's count is what is used. */
      for (const g of groupsB) {
        if (g.released) continue;
        if (!groupSlotReleasable(g.members, g.desc.count, EST.FREE)) continue;
        g.released = true;
        g.slot.state = 0;                                 // CS:0xEDB1
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
          popup.spawn(x, y, g.desc.rewardId, dropCarriedIntoWorld);
        }
      }
      /* CS:0xDFF1-0xDFF9 — System A's own slot release, structurally
       * identical to System B's above and read off the binary the same way:
       *
       *     dfc0  add cl,[0x1f4] / dfc4 cmp cl,[si] / jnz   ; reward
       *     dff1  mov cl,[0x3c3]      ; fully-FREE members ONLY
       *     dff5  cmp cl,[si]
       *     dff7  jl  dffe            ; keep the slot
       *     dff9  mov word [bp+0],0   ; <- free it
       *
       * ⚠️ This project's docs cite "CS:0xDFF5" for this free; that address
       * is the CMP. The store is at CS:0xDFF9. */
      for (const g of groupsA) {
        if (g.released) continue;
        if (!groupSlotReleasable(g.members, g.desc.count, ESTA.FREE)) continue;
        g.released = true;
        g.slot.state = 0;                                 // CS:0xDFF9
      }
      /* CS:0x0294 / CS:0xBB87-0xBBA8 — drain the selector-1 GROUP drops
       * queued by pat-objects.js when a whole scripted group has been
       * killed. The queued position is SCREEN-relative (the original caches
       * it that way at CS:0xBBC1 and adds the camera back at CS:0xBB8E),
       * plus the +8 on BOTH axes that CS:0xBB96/0xBB99 apply.
       *
       * This is what makes level 1A's class-2 flying monster hand over its
       * knife: its descriptor byte +7 is 0, and `dropCarriedItem`'s own
       * CS:0xC059 split turns an id below 0x0B into weapon type id + 0xC0 —
       * object type 192, weapon index 0, "knife". Picking it up increments
       * the weapon's `count`, and volleySize() = count - base + 1 takes the
       * hero from one thrown knife to two.
       *
       * `UNKNOWN_pat_drop_pop_arc` — CLOSED. CS:0xBBA8 calls CS:0xBF5F, the
       * SAME toss the System-A/B/selector-2/nest rewards use, so the drop
       * goes through popup.spawn() rather than straight into the object
       * array: it arcs up and lands ~11px higher (15px for a weapon), and
       * only then becomes an object. Routing it here also means the PAT
       * drop now shares the single-slot and busy-divert semantics with
       * every other reward, instead of being the one path that bypassed
       * them.
       *
       * ⚠️ Drained HERE, after both entity systems, because the walker runs
       * at CS:0x0294 — later than System B (0x0285) and System A (0x028b).
       * PAT LOSES the slot to both; it does not win it. See the priority
       * table at the popup tick above. */
      for (const d of patGroups.drops) {
        popup.spawn(d.x + camNow.x + 8, d.y + camNow.y + 8, d.id, dropCarriedIntoWorld);
      }
      patGroups.drops.length = 0;

      /* CS:0x029A / CS:0x7CA2 — the awakened statue's own kill award. LAST
       * of the six channels, so it is the one most likely to find the slot
       * busy and land in place. */
      for (const p of statueResult.popups) popup.spawn(p.x, p.y, p.id, dropCarriedIntoWorld);

      /* No landing drain here, deliberately: CS:0xC041 already ran INLINE
       * for every award above, which is what the original does. See the
       * popup tick's own header. `popup.landed` stays empty in this build —
       * it is the queue the invariant suite drives the class through when
       * no landing callback is supplied. Before any of this, System-A,
       * System-B, selector-2, nest and statue awards were drawn and then
       * discarded — `UNKNOWN_popup_reward_not_collectable`. */
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
      /* CS:0x0e15-0x0e24 — one HURT_SFX per bar-descent-start, latched so a
       * multi-frame descent from one hit plays it once, matching tally.js's
       * own `sfxPending` consume-and-reset pattern. */
      if (health.hurtSounds > 0) { audio.play(HURT_SFX); health.hurtSounds = 0; }
      /* CS:0x01BD-0x01C9 (`bar <= 0`, combat.js's `health.dead`) — detected
       * here, one step later than the original's own per-frame ordering
       * (which tests the bar BEFORE that frame's player-state-machine call
       * even runs; this port's `stepHeroFrame` gate above only takes effect
       * from the NEXT frame on). See game/death.js's own header for the
       * full CS:0x09BB/0x0930/0x0845 chain this block ports. */
      if (!deathSeq && health.dead) {
        deathSeq = new DeathBurst(player.x - cam.snapX, player.y - cam.snapY);
        audio.play(DEATH_SFX);   // once, right as the burst begins — this gate only ever fires once per death
        /* `fr` (stepHeroFrame's own per-tick return) is gated off for the
         * whole burst below, so lastDebrisFx/lastBurstFx/lastBlockFx would
         * otherwise keep redrawing whatever they held on the tick death was
         * detected, for all 18 frames of the burst. Clear them here rather
         * than inside the `if (fr)` block, since that block simply doesn't
         * run during the burst. */
        lastDebrisFx = [];
        lastBurstFx = null;
        lastBlockFx = [];
      }
      if (deathSeq) {
        const r = deathSeq.tick();
        lastDeathBurstFx = r.sprites;
        if (r.done) {
          deathSeq = null;
          const { lives, gameOver } = loseLife(fx.lives);   // CS:0x093A/0x093E
          fx.lives = lives;
          if (gameOver) {
            /* CS:0x0943 onward — the real game-over cascade (Gods/docs/
             * dynamic-trace-and-runtime-data.md's "hiscore name-entry
             * screen" + "TOP TEN GODS" sections), superseding the earlier
             * `gameOverPlaceholder()`/"press R" stand-in death.js's own
             * header still documents (that function stays exported and
             * tested — see checks.js — it is just no longer what real play
             * reaches). `FUN_1000_318f`'s own `[0x38d]` gate (skip the
             * whole mechanism under some condition this project has not
             * traced) is not modelled — every game over here attempts the
             * real cascade. */
            pendingHiscoreRank = rankOf(hiscoreEntries, score.value);
            pendingHiscoreScoreBytes = encodeScoreBytes(score.bytes);
            /* CS:0x095D-0x0966's own 150-iteration fade — see
             * `gameOverFade`'s own header. The render callback below owns
             * the actual ramp and the transition into 'name-entry'/
             * 'hiscore-table' once it completes, the same split `quitFade`
             * already uses. */
            gameOverFade = {
              snapshot: renderer.buf.slice(), palette: level.palette, start: performance.now(),
              next: pendingHiscoreRank >= 0 ? 'name-entry' : 'hiscore-table',
            };
            uiState = 'game-over-fade';
            $('event').textContent = 'GAME OVER';
          } else {
            health.respawn();                                       // CS:0x084B/0x0851
            const pos = findRespawnPosition(spawn.x, spawn.y, level.map.planeB); // CS:0x0873-0x08BD
            player.teleportTo(pos.x, pos.y);                         // CS:0x08D6-0x08E6 (state 4)
            player.fallDamage = 0;                                   // CS:0x08E0, teleportTo doesn't touch this
            cam = cameraForSpawn(pos.x, pos.y);                      // CS:0x08CC-0x08D3
            fx.invuln = INVULN_TICKS_SPAWN;                          // CS:0x0860
            $('event').textContent = `respawned — ${fx.lives} ${fx.lives === 1 ? 'life' : 'lives'} left`;
          }
        }
      }
      cam.update(player.x, player.y, levelInfo);
    },
    () => {
      /* uiState === 'quitting' — see the `quitFade` declaration above.
       * Restoring the snapshot every frame (rather than drawing it once)
       * is what keeps this state's own render independent of the world's
       * per-tick pipeline, which `paused`-style is NOT running here (ticks
       * are already gated off by `uiState !== 'game'` in the tick callback
       * above). Driven off wall-clock time, not a frame/tick count, so it
       * is not subject to the display's own refresh rate. */
      if (uiState === 'quitting' && quitFade) {
        renderer.buf.set(quitFade.snapshot);
        const elapsed = performance.now() - quitFade.start;
        const fadeT = Math.max(0, 1 - elapsed / QUIT_FADE_MS);
        const menuGlyphs = hero && hero.menuGlyphs;
        drawCentered(renderer, menuGlyphs, 'QUIT GAME', 92, MENU_ADVANCE);
        renderer.present(quitFade.palette, fadeT);
        if (elapsed >= QUIT_FADE_MS) { uiState = 'menu'; quitFade = null; }
        return;
      }
      /* uiState === 'game-over-fade' — CS:0x095D's own 150-iteration fade,
       * see `gameOverFade`'s own header above. Same snapshot-and-ramp shape
       * as `quitFade` just above (frozen last frame, fading to black), then
       * hands off to whichever screen the death/game-over block already
       * decided on (`gameOverFade.next`). */
      if (uiState === 'game-over-fade' && gameOverFade) {
        renderer.buf.set(gameOverFade.snapshot);
        const elapsed = performance.now() - gameOverFade.start;
        const fadeT = Math.max(0, 1 - elapsed / GAME_OVER_FADE_MS);
        const menuGlyphs = hero && hero.menuGlyphs;
        drawCentered(renderer, menuGlyphs, 'GAME OVER', 92, MENU_ADVANCE);
        renderer.present(gameOverFade.palette, fadeT);
        if (elapsed >= GAME_OVER_FADE_MS) {
          if (gameOverFade.next === 'name-entry') { uiState = 'name-entry'; nameEntry = new NameEntry(); }
          else { uiState = 'hiscore-table'; hiscoreTable = new HiscoreTable(hiscoreEntries); }
          gameOverFade = null;
        }
        return;
      }
      /* uiState !== 'game': draw the title screen instead of the world.
       * `hero.frames[169]` is the 208x46 GODS title logo — descriptor #169
       * in the "always" atlas group (PALWAYS1+2+3+PGODFONT), loaded by
       * loadSprites() for every world, so it, `hero.glyphs` (PSMLFNT) and
       * `hero.menuGlyphs` (PGODFONT — the menu's OWN font, see title-menu.js's
       * MENU_ADVANCE citation) are already available here with no extra
       * fetch — see loadSprites()'s own header for the #169 anchor. */
      if (uiState !== 'game') {
        const glyphs = hero && hero.glyphs, menuGlyphs = hero && hero.menuGlyphs, logo = hero && hero.frames[169];
        const arrowLeft = hero && hero.frames[MENU_ARROW_LEFT_DESC], arrowRight = hero && hero.frames[MENU_ARROW_RIGHT_DESC];
        if (uiState === 'menu') titleMenu.draw(renderer, glyphs, menuGlyphs, arrowLeft, arrowRight, logo, titleBackground);
        else if (uiState === 'password') {
          passwordEntry.draw(renderer, glyphs, menuGlyphs, hero && hero.gridEraseIcon,
            hero && hero.gridConfirmIcon, titleBackground, passwordSlots,
            hero && hero.cursorFrames, clock.tick);
        }
        else if (uiState === 'name-entry') {
          nameEntry.draw(renderer, menuGlyphs, hero && hero.gridEraseIcon,
            hero && hero.gridConfirmIcon, titleBackground, hero && hero.cursorFrames, clock.tick);
        }
        else if (uiState === 'hiscore-table' && hiscoreTable) {
          hiscoreTable.draw(renderer, glyphs, menuGlyphs, titleBackground, passwordSlots);
        }
        else if (uiState === 'shop' && shopScreen) shopScreen.draw(renderer, glyphs);
        if (uiState === 'exit') renderer.presentBlack();   // QUIT's stand-in — see Renderer's own header
        /* PBACKSCR's OWN palette, not level.palette — like PSTATUS/PSTAT3
         * (status-panel.js's own PALETTE note), nothing in GAME.EXE installs
         * a fresh DAC for this screen; whatever palette is already active
         * colours it, and at this exact moment in the original that IS
         * PBACKSCR's own (no level has loaded yet to overwrite it). */
        else renderer.present(titleBackground ? titleBackground.palette : level.palette);
        return;
      }
      const camX = cam.snapX, camY = cam.snapY;
      renderer.clear(0);
      renderer.drawTilemap(level.map, level.tiles, camX, camY);
      /* Selectors 7-10 — the line-barrier system's own footprint (game/
       * line-barriers.js), drawn in the same pass/order as the tilemap
       * itself since it fills gaps IN that tilemap (plane A never carries
       * these tiles; this system draws over plane A's own "empty" cells). */
      renderer.drawExtraTiles(lineBarriers.cells(), level.tiles, camX, camY);
      /* OBJECTS, with real sprites: `170 + type`, or `302 + (type - 0xC0)` for
       * a weapon pickup. Drawn at (x, y) top-left, in the original's draw
       * order (cat-3/cat-5 behind, ordinary next, weapons on top — graphics
       * export 32). Dead slots are removed by a SIGN test at load, matching
       * CS:0x9000 `cmp word [si+0x4],0 / jns`. The retracting spike hazard
       * (game/spikes.js) is included INLINE via `buildDrawSequence` — see
       * game/objects.js for why it is not a separate pass in the original. */
      const isSpikeType = (t) => t === SPIKE_TYPE || t === SPIKE117_TYPE || t === SPIKE130_TYPE;
      const drawSeq = buildDrawSequence(level.drawObjects, isSpikeType, new Set(lastSpikeFx));
      for (const { obj: o, spike } of drawSeq) {
        if (spike) {
          const draw = (o.type === SPIKE130_TYPE)
            ? [spike130Sprite(o, spikeClock)]
            : (() => { const s = spikeSprites(o, spikeClock); return [s.base, s.overlay]; })();
          for (const d of draw) {
            const sx = d.x - camX, sy = d.y - camY;
            if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
            let sf = hero && hero.frames[d.sprite];
            /* game/spikes.js: the base sprite's bottom edge is pinned at
             * objY+32 — draws `rows` rows starting `srcRowOffset` rows into
             * the frame, not the whole thing, or the composite gets a
             * duplicate crown and/or sinks into the floor tile below the
             * pit as pingpong changes — live-verified against a DOSBox
             * screenshot of this exact scene, at multiple pingpong phases. */
            if (sf && d.rows != null && d.rows < sf.h) {
              sf = { w: sf.w, h: d.rows, pixels: sf.pixels.subarray(d.srcRowOffset * sf.w) };
            }
            if (sf) renderer.blitSprite(sf, sx, sy);
            else renderer.strokeRect(sx - 2, sy - 2, 5, 5, 14);
          }
          continue;
        }
        const sx = o.x - camX, sy = o.y - camY;
        if (sx < -64 || sy < -64 || sx > SCREEN_W || sy > SCREEN_H) continue;
        /* CS:0x1D0E-0x1D86 — while a delayed special-lever toggle is
         * animating on THIS object, its sprite comes from the per-world
         * table (game/levers.js), not the ordinary `170+type` formula. */
        const leverSprite = leverToggle.spriteFor(o, level.world);
        /* CS:0x1669 — the ordinary category<3 draw dispatches on the STAMPED
         * SPRITE ID, and sprite 224 (type 54, the rotating crystal) picks a
         * frame from DS:0x3a0 instead of drawing its base sprite. See
         * game/objects.js. The lever override still wins: CS:0x1D0E's own
         * animation is a different, per-object path and must be tested
         * first, so `animatedObjectSprite` goes INSIDE the `??` fallback,
         * never wrapped around the finished `oid`. */
        const oid = leverSprite
          ?? animatedObjectSprite(spriteForType(o.type), objectAnimClock);
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

      /* ACT6'S SMOKE — CS:0x3CC7, sprites 108-114, the puff left where a
       * lever-neutralised hazard used to be (game/kill-smoke.js). Already in
       * screen space: the walker subtracts the scroll itself, every tick, so
       * a puff stays put in the world while the camera moves. Drawn here
       * because its walker runs at CS:0x0239 — before the player state
       * machine at CS:0x0254 and before the entities at CS:0x0285, so a puff
       * is under both. */
      for (const d of lastKillSmokeFx) {
        const kf = hero && hero.frames[d.sprite];
        if (kf) renderer.blitSprite(kf, d.x, d.y);
        else { outOfRange++; renderer.strokeRect(d.x, d.y, 32, 32, 14); }
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
       * game/line-hazard.js; fed by both entity systems' attackBits!=0
       * divert (spawnJittered/spawnAtHero, below) and by selector2.js's own
       * handlers, so this loop is live whenever a hazard-throwing group is
       * on screen. */
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

      /* THE HERO'S OWN DEATH BURST — CS:0x0A3B-0x0AA2, game/death.js. Screen-
       * LOCKED (the original never re-subtracts the camera once seeded), so
       * these draw at their own stored (x,y) directly, unlike every other
       * sprite in this loop. */
      for (const b of lastDeathBurstFx) {
        const bf = hero && hero.frames[b.sprite];
        if (bf) renderer.blitSprite(bf, b.x, b.y);
        else { outOfRange++; renderer.strokeRect(b.x, b.y, 8, 8, 12); }
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

      /* THE STATUS PANEL. Drawn LAST and opaque across the full width — see
       * renderer.js's own blitStatusPanel and status-panel.js's PROVENANCE
       * note on why that's enough to match the original's 160-row viewport
       * without also clipping the world draw above. Coloured through
       * level.palette like everything else this port draws (the panel's own
       * embedded palette is never installed in the original either). */
      if (statusPanel) renderer.blitStatusPanel(statusPanel, STATUS_PANEL_Y0);

      /* THE CROUCH/INVENTORY PANEL — CS:0x02C0/0x02C3, game/inventory-
       * panel.js. Drawn every frame regardless of player state (not a
       * crouch-only popup), and PANEL-LOCAL in Y like every other overlay
       * here: FUN_1000_1e1a retargets the shared destination-segment word
       * DS:[0x0] to the status-panel buffer 0xacde at CS:0x1e78, and
       * FUN_1000_2274 (CS:0x02DE) copies that buffer to the screen at
       * `+0x1b80 = 160*44`. It is the FIRST overlay element the original
       * draws (CS:0x02C3, before the health bar at CS:0x02C9), onto a
       * backdrop already in the buffer — hence after blitStatusPanel and
       * before drawHealthBar here. */
      drawInventoryPanel(renderer, hero && hero.frames, inventory, inventoryPanel,
                         STATUS_PANEL_Y0);

      /* THE STATUS PANEL'S DYNAMIC OVERLAY — CS:0x02C9-0x02D8, straight-line
       * in the main loop right after the panel's own backdrop refresh
       * (game/health-bar.js, game/hud-digits.js). Drawn last, on top of the
       * just-blitted backdrop, exactly like the original draws these on top
       * of whatever the backdrop's own VRAM already held. */
      drawHealthBar(renderer, hero && hero.frames, health.bar, healthBarShimmer.phase, STATUS_PANEL_Y0);
      drawLives(renderer, digitFrames, fx.lives, STATUS_PANEL_Y0);
      clampMoneyForDisplay(purse);
      drawMoney(renderer, digitFrames, purse, STATUS_PANEL_Y0);
      drawScore(renderer, digitFrames, score, STATUS_PANEL_Y0);
      /* THE MESSAGE LINE — game/message.js. Panel-local row 0x1d (absolute
       * screen row 189), drawn last because the original draws it into the
       * same panel page every overlay above writes to, after them. */
      drawMessage(renderer, hero && hero.glyphs, messages, STATUS_PANEL_Y0,
                  { loadStage: 0, shopActive: false, world: level.world });

      /* The tally/password overlay draws LAST, on top of the fully-composed
       * frame — matching the original, which draws it over whatever the
       * still-running game world already left in VRAM (see tally.js's own
       * header: both live captures show the hero and level tiles visible
       * underneath the text). */
      if (tallyScreen) tallyScreen.draw(renderer, hero && hero.menuGlyphs, digitFrames);

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
        ` · ${patGroups.live} pat · ${lineBarriers.live} barriers` +
        ` · ${shots.live} shots · ${lineHazards.live} hazards · ${debris.live} debris` +
        ` · ${lastSpikeFx.length} spikes` +
        ` · hp ${health.bar}/${health.target > HEALTH_MAX ? HEALTH_MAX : health.target}`        + (health.dead ? ' DEAD' : '') +
        ` · money ${purse.total} · score ${score.value}` +
        ` · lives ${fx.lives}` +
        (deathSeq ? ` · death burst ${deathSeq.counter}/${0x12}` : '') +
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
        ` · chests ${opened} · keys [${inventory.map((v) => v === INVENTORY_EMPTY ? '-' : v).join(',')}]` +
        (lootLanded ? ` · ${lootLanded} loot landed` : '') +
        (burst.stranded ? ` · ${burst.stranded} loot STRANDED (object table full)` : '') +
        /* ALL FOUR allocator pools, not just System B's. Every one of them
         * consumes its event record before searching for a slot, so a
         * refusal is a permanently missing enemy — and for years only one
         * of the four counters had any read site at all, which is precisely
         * why the pools that never released a slot went unnoticed. Naming
         * the pool matters too: the fix for each is a different file. */
        (() => {
          const lost = [
            ['SysB', slots.lostActivations],
            ['SysA', slotsA.lostActivations],
            ['PAT', patGroups.lostActivations],
            ['turret', selectorTwo.refused],
          ].filter(([, n]) => n);
          return lost.length
            ? ` · activations lost: ${lost.map(([k, n]) => `${k} ${n}`).join(', ')} (pool full)`
            : '';
        })();
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
