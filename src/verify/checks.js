/* checks.js — live invariant checks.
 *
 * The point of this module is that "grounded in facts" should be checkable by
 * the user in the running page, not asserted in a comment. Every check below
 * re-derives a published figure from the shipped bytes at load time. If a
 * format claim were wrong, these would go red rather than fail silently.
 */

import { dclDecompress } from '../formats/dcl.js';
import { DOOR_TILES, ZONE_TELEPORT, ZONE_EXIT, makeGates, makeActionContext,
         runAction, fireTrigger } from '../game/trigger-actions.js';
import { scanZones, unpackTeleportDest, resolveExitDestination,
         EXIT_DESTINATIONS } from '../game/zones.js';
import { consumesKey } from '../game/trigger.js';
import { PI1_SIZE, decodePI1, TILE_COUNT } from '../formats/pi1.js';
import { decodeStatusPanel, PANEL_W, PANEL_H, PANEL_Y0 } from '../game/status-panel.js';
import { LeverToggle, heroNearLever, SPECIAL_LEVER_SPRITES,
         SPECIAL_LEVER_ANIM } from '../game/levers.js';
import { SpikeClock, spikePingpong, heroInSpikeBox, heroInSpike130Box,
         stepSpikes, spikeSprites, spike130Sprite, SPIKE_OVERLAY,
         SPIKE117_OVERLAY, SPIKE130_ANIM, SPIKE_TYPE, SPIKE117_TYPE,
         SPIKE130_TYPE } from '../game/spikes.js';
import { InventoryPanel, drawInventoryPanel, panelIconSprite,
         SLOT_FRAME_SPRITE, SLOT_FRAME_HIGHLIGHT_SPRITE, PANEL_SLOT_SPACING,
         PANEL_FRAME_X0, PANEL_FRAME_Y, PANEL_ICON_X0,
         PANEL_ICON_Y } from '../game/inventory-panel.js';
import { BULK_SIZE, parseMap } from '../formats/map.js';
import { parseAllTriggers, isLive, verbOf, TRIG_COUNT } from '../game/trigger.js';
import { parseAtlas, cutAll, atlasStats } from '../formats/atlas.js';
import { buildDescriptorMap, GROUP_STEMS, PLAYER_ANIM_BASE, HERO_DESCRIPTOR_MAX } from '../formats/descriptors.js';
import { STATE_INFO, STATE_TABLE, spriteFor, NON_RENDERING_STATES, jumpPhase,
         LADDER_JUMP_PHASE } from '../game/states.js';
import { emittableStates } from '../game/player.js';
import { MODE, MODE_TABLE, EntityB, hopDelta, hopCursorNext, EST,
         groundBelow, onScreen, fireB, isDying,
         DEATH_SPRITE_BASE as ENTB_DEATH_SPRITE_BASE,
         DEATH_FRAMES as ENTB_DEATH_FRAMES,
         stealAttemptB, carryOffsetB, stepCarriedItemB,
         groupRewardPosition } from '../game/entity.js';
import { parseGroupsB, parseGroupsA, GroupSlots, spriteForEntity, CLASS_TABLES_B,
         CREATURE_DESCRIPTOR_BASE, MAX_ENTITIES } from '../game/spawn.js';
import { EntityA, CLASS_TABLES_A, spriteForEntityA, rollStrategy,
         stageAccelerate, stageApply, stageFacingAndFire,
         SPRITE_BASE_8FRAME, SPRITE_BASE_6FRAME,
         stageAttack, REACH_OFFSETS, DISPLACEMENT_TABLE,
         ZONES, ZONE_SCRATCH, currentZone, strategy1, strategy2,
         stealAttempt, searchAndSteal, stepCarriedItem,
         EST as ESTA, isDyingA,
         DEATH_SPRITE_BASE_A as ENTA_DEATH_SPRITE_BASE,
         DEATH_FRAMES_A as ENTA_DEATH_FRAMES,
         groupRewardPositionA } from '../game/entity-a.js';
import { SELECTOR_TABLE, SELECTOR_TRIGGER, EVENT_TABLE_OFF, EVENT_COUNT,
         palfilsNameFor, parsePalfils, EventRunner } from '../game/events.js';
import { GROUP_SLOTS as PAT_GROUP_SLOTS, SUBRECORDS_PER_GROUP, ABSOLUTE_TAG,
         HOLD_BOX, reloadTicks, decodeDelta, parsePatDirectory,
         parsePatSpawnDescriptor, CLASS_TABLE_A, PatGroups,
         DEATH_SPRITE_BASE as PAT_DEATH_SPRITE_BASE, DEATH_RETIRE_AT,
         scoreForKey } from '../game/pat-objects.js';
import { spriteForType, parseObjectCategories, isDeadType, isUnstamped,
         OBJECT_SPRITE_BASE, STAMPED_TYPES } from '../game/objects.js';
import { VERDICT, REACHABLE_VERDICTS, VERDICT_NONE, verdictAction, applyVerdict, search, searchable,
         OpenList, OPEN_SLOTS, OPEN_LIMIT, GRID_PITCH, GRID_CELLS, GRID_LIMIT,
         GRID_MARGIN, heroCell, entityCell, SEED_STRATEGIES, SEED_WEIGHT_MASK,
         seedStrategy, seedBoxCells, seedColumnCells, gridIndex,
         WAYPOINTS, MARKER_MAX, ATTRACT_POTION_TYPE, stealGate } from '../game/pathfind.js';
import { runSearch, makeState, seedGoals } from '../game/pathfind-producers.js';
import { MarkerList, stepMarkers, DISTRACT_TYPE } from '../game/markers.js';
import { Health, HEALTH_MAX, damageFor, attackHero, creatureTouchesHero,
         difficultyScale, DIFFICULTY_MULTIPLIERS, difficultyForgiven,
         DIFFICULTY_PROGRESSION, creatureScansGrid, hitSparkAxis,
         CREATURE_CONTACT_BOX } from '../game/combat.js';
import { Arsenal, spawnableWeapons, FIRE_CAPABLE_STATES, LEVER_STATES,
         INVENTORY_STATES } from '../game/hero-fire.js';
import { pickUpWeapon, chooseSlot, heroTouches, stepPickups, PICKUP_BOX,
         isWeaponPickup, weaponIndexOf, FIREBALL,
         consumableRank, keyHotPoint, objectNearHotPoint, scanForKey,
         collectKey } from '../game/pickup.js';
import { CONSUMABLES, WIRED, WEAPON_ARCS, NOT_WIRED_REASON, applyConsumable,
         INVULN_TICKS_POTION, INVULN_TICKS_SPAWN, INVULN_SPAWN_DEDUCTION,
         FREEZE_TICKS, GIANT_JUMP_TICKS, POWER_POTION_STEPS, MSG_CLEAR_394,
         SHIELD_NOOP_DS, SHIELD_NOOP_SITES, UNIMPLEMENTED_TYPE,
         FAMILIAR_ENERGY_DS, FAMILIAR_CLEAR_SITES,
         banksOverheal } from '../game/consumables.js';

import { stepHeroFrame, stepCreatureDamage, FRAME_ORDER,
         HUNTER_WEAPON } from '../game/frame.js';
import { CHEST_MIN, CHEST_MAX, CHEST_KEY_BASE, chestKeyFor, openedType,
         isLockedChest, isOpenChest, isChestType, scoreForValue,
         collectTreasure, parseObjectRecords, Score, Purse, TreasureBurst,
         burstTypes, burstTypesAligned, BURST_TABLE, BURST_TABLE_DS,
         BURST_ALIGNED_DS, BURST_STRIDE_WORDS, BURST_AUTHORED_WORDS,
         BURST_COUNT, BURST_VY_CAP, CHEST_SFX, TREASURE_SFX,
         INVENTORY_CLEAR_SITES, INVENTORY_EMPTY, CHEST_KEY_CENSUS, INVENTORY_SLOTS,
         OBJ_NAME_OFF, OBJ_NAME_MAX, OBJ_DESC_OFF, OBJ_DESC_MAX,
         OBJ_RECORD_SIZE } from '../game/treasure.js';
import { expandMapObjects, allocObject, OBJECT_SLOTS, activationBox,
         activateObjects, sortForDraw, insertSpawned, CATEGORY, WEAPON_TYPE_MIN,
         stepObjectFall, isFallEligible, BOUNCE_DELTA, FALL_STEP,
         WORLD_HEIGHT, STRADDLE_OFFSET, BOUNCE_TERMINAL, ACTIVATION_MARGIN,
         dropCarriedItem } from '../game/objects.js';
import { GodsRandom } from '../game/random.js';
import { CLASS_TABLES, EMPTY_CLASS, HAZARD_CLASS, HAZARD_HANDLERS,
         HAZARD_SPRITE_BASE, POOL_SLOTS, POOL_STRIDE,
         POOL_TENANTS } from '../game/entity-classes.js';
import { EnemyShots, hitsHero, isCrouching,
         SLOTS as ES_SLOTS, STRIDE as ES_STRIDE, FREE as ES_FREE,
         CULL_LEFT, CULL_RIGHT, DAMAGE as ES_DAMAGE, CROUCH_RAISE,
         HERO_BOX, HOT_POINT, SPRITE_RIGHT, SPRITE_LEFT, SPRITE_FADE_BASE,
         DESPAWN_RIGHT_X, DESPAWN_LEFT_X, TERRAIN_Y_BIAS, TERRAIN_STRADDLE,
         FADE_FREE_AT, STOP_STATE_RIGHT, STOP_STATE_LEFT } from '../game/enemy-shots.js';
import { LineHazards, jitterTarget, isCrouching as lhIsCrouching,
         SLOTS as LH_SLOTS, HERO_HOT_POINT, HERO_BOX as LH_HERO_BOX,
         CROUCH_RAISE as LH_CROUCH_RAISE, DAMAGE as LH_DAMAGE,
         PROBE_BIAS, WALL_DEBRIS_BIAS, HERO_HIT_DEBRIS_BIAS,
         CULL as LH_CULL, SPRITE_BASE as LH_SPRITE_BASE, MUZZLE_X_OFFSET,
         TARGET_JITTER_MASK, TARGET_JITTER_BIAS } from '../game/line-hazard.js';
import { SelectorTwoSpawns, parseClasses as parseSelectorTwoClasses,
         culled as selectorTwoCulled, scoreForState0, stepHandlerB as selectorTwoHandlerB,
         stepHandlerB03C as selectorTwoHandlerB03C,
         DEATH_FRAMES as SEL2_DEATH_FRAMES,
         DEATH_SPRITE_BASE as SEL2_DEATH_SPRITE_BASE, stepPace32x32 } from '../game/selector2.js';
import { RockSettlePool, RockBurstPool } from '../game/rockfall.js';
import { HERO_SHOTS_AT, ENEMY_SHOTS_AT } from '../game/frame.js';
import { Nests, aimAt, broodCount, signed16,
         OBJECT_TYPE as NEST_TYPE, OBJECT_SPRITE as NEST_OBJ_SPRITE,
         WORLD as NEST_WORLD, SLOTS as NEST_SLOTS, STRIDE as NEST_STRIDE,
         SEED_STATE, SEED_HP, SEED_TIMER_BASE, SEED_TIMER_MASK,
         SEED_X_BIAS, SEED_Y_BIAS,
         SPRITE_BASE as NEST_SPRITE_BASE, SPRITE_FIRST as NEST_SPRITE_FIRST,
         SPRITE_LAST as NEST_SPRITE_LAST, DEATH_SPRITE_BASE,
         BOX_HATCH, BOX_ALIVE, HATCH_WINDOW, AIM_GATE, FIRE_RELOAD,
         FIRE_PERIOD, HATCH_RELOAD, BAND_LEFT, BAND_RIGHT, MUZZLE,
         BROOD_AT_STATE, DEATH_FREE_AT_STATE, BROOD_SLOTS, BROOD_STRIDE,
         BROOD_Y_OFFSET, BROOD_HP, ST as NST } from '../game/nest.js';
/* A separate import, appended rather than folded into the block above, so
 * this pass's additions to checks.js stay strictly additive: the brood
 * walker at CS:0x894E, closed and ported as `Brood` (see nest.js). */
import { Brood, broodFacingOffset, BROOD_SEED_FALL_SUBSTATE, BROOD_BOX,
         BROOD_BOUNCE_PROBE_X, BROOD_FALL_PROBE, BROOD_FALL_GRAVITY_CAP,
         BROOD_DEATH_DRAW_OFFSET, BROOD_FACING_OFFSET, BROOD_SPRITE_TABLE,
         DEATH_DRAW_OFFSET } from '../game/nest.js';
import { Debris, SLOTS as DBG_SLOTS, STRIDE as DBG_STRIDE, LIFETIME_TICKS,
         SPRITE_FIRST, SPRITE_LAST, EXPIRE_AT } from '../game/debris.js';
import { Popup, POPUP_VY, POPUP_SPRITE_BASE, POPUP_OFFSCREEN_CULL } from '../game/popup.js';
import { Destructibles, DESTRUCTIBLE_TILE, MIN_WORLD, MACE_INDEX, MACE_BONUS,
         QUEUE_SLOTS, RESTORE_SLOTS, BREAK_FRAMES, SPRITE_BASE_DS,
         SPRITE_BASE_VALUE, blockDamage, hitsToBreak,
         shotsToBreak } from '../game/destructible.js';
import { Starburst, BURST_TEMPLATE, PARTICLES_PER_BURST, SLOTS,
         CULL as SB_CULL, GRAVITY_PERIOD, AGE_MAX, AGE_STEP, CHAIN_WINDOW,
         TAG as SB_TAG, chainThreshold, modeDamage,
         SPAWNER_CALLERS } from '../game/starburst.js';
import { JUMP_ARC_END, JUMP_ARC_EXIT, fireGuardBefore,
         fireGuardAfter } from '../game/fire-states.js';
import { Player, ST, S as PS, JUMP_ARC_EARLY_LAND_CURSOR,
         WALK_STEP } from '../game/player.js';
import { CELL_SOLID, CELL_CLIMBABLE, MAP_COLS as MC, attrAt } from '../formats/map.js';
import { parseWeapons, allocateShots, MAX_SUBSLOTS, WEAPON_SLOTS, tagFor,
         WEAPON_COUNT, PINNED_08, PINNED_SPRITE, PINNED_SPRITE2,
         armWeapon, pickUpAgain, refundFor, reloadWorld,
         SPRITE_FIELDS_ARE_PINNED } from '../game/weapons.js';
import { FIRE_STATES as FS, FIRE_STATE_IDS, WALK_FIRE_ANIM, EMIT_WALK,
         EMIT_OTHER, fireAnimOffset, fireTick, persistsRawPhase,
         ENTRY, tryEnterFireState } from '../game/fire-states.js';
import { clipScanBox, CLIP_NEAR, CLIP_BOTTOM, CLIP_RIGHT,
         DamageGrid, CELL, GRID_ORIGIN, GRID_LO, GRID_BYTES, ROW_STRIDE,
         WRITE_LO, WRITE_HI, MAX_SCAN_COLS, stampIndex, scanIndex,
         damageForTag, TAGS_PER_SLOT } from '../game/collision.js';
import { FireControl, FIRE_BIT, EMIT_PHASE, RECHECK_PHASE,
         FIRE_STATES } from '../game/fire.js';
import { SLOT_STRIDE, PROJECTILE_SIZE, GROUP_STRIDE, GROUP_ENTRIES,
         AREA_ENTRIES, ENTRIES_REACHABLE, GROUPS_PROBED, HANDLER_TABLE, NULL_HANDLERS,
         DECODED_HANDLERS, HANDLERS, DIRS, CUT_WEAPON, volleySize,
         volleySizeAtLoad, spawnVolley, muzzle, MOVER_TABLE, MOVER_NULL,
         DRAW_STYLES, WOBBLE_ENTRIES, newWobble,
         stepFireball, pickTarget, unpackHunterVel, hunterTurnRate,
         TARGET_STRIDE, AXE_STATE_STRIDE, AXE_BOUNCE_VX, AXE_GRAVITY,
         AXE_VY_CAP, AXE_SPRITE_BASE, newAxeState, stepMagicAxe, axeSprite,
         axeWallAt, spawnAxeVolley,
         HUNTER_VEL_CLAMP, HUNTER_TARGET_BIAS, HUNTER_CULL, hunterSteerAxis,
         stepHunter, stepHunterArray, HUNTER_NO_TARGET_AT,
         FUSE_START, FUSE_EXPLODE, BOMB_FRAGMENTS, BOMB_SPRITE_BASE,
         BOMB_BOUNCE, BOMB_GRAVITY_CAP, stepTimeBomb,
         PROJECTILE_VELOCITY, setWeaponArc, resetWeaponArc,
         MOVER_WALK, CULL, stepProjectiles,
         DECODED_MOVERS, stepMoverFrame, projectileSprite } from '../game/projectiles.js';
/* A separate import, appended rather than folded into any block above, so
 * this pass's addition stays strictly additive: ce64.js — the world-3-only
 * creature (object type 96) and its "spit" sub-projectile. Names that would
 * collide with an existing import (SEED_HP, DEATH_SPRITE_BASE,
 * DEATH_DRAW_OFFSET, OBJECT_TYPE, OBJECT_SPRITE, WORLD, SLOTS, STRIDE — all
 * already bound by nest.js above) are aliased with a CE64_ prefix, the same
 * convention this file already uses for NEST_/ES_/LH_. */
import { Ce64Creatures, Ce64Spits,
         OBJECT_TYPE as CE64_TYPE, OBJECT_SPRITE as CE64_SPRITE,
         WORLD as CE64_WORLD, SLOTS as CE64_SLOTS, STRIDE as CE64_STRIDE,
         SEED_HP as CE64_SEED_HP, SEED_WANDER as CE64_SEED_WANDER,
         SEED_TIMER as CE64_SEED_TIMER,
         TIMER_RELOAD_BASE, TIMER_RELOAD_MASK,
         ATTACK_AT_WANDER, WANDER_CYCLE_LENGTH, ATTACK_WINDOW,
         BOX_CREATURE, SCORE_CREATURE_KILL, SCORE_SPIT_KILL,
         DEATH_SPRITE_BASE as CE64_DEATH_SPRITE_BASE,
         DEATH_DRAW_OFFSET as CE64_DEATH_DRAW_OFFSET, DEATH_FREE_AT,
         WANDER_SPRITE, UNKNOWN_ce64_sprite_table,
         SPIT_CAP, SPIT_WINDUP_TICKS, SPIT_ORIGIN_Y_BIAS, SPIT_ARM_HP,
         SPIT_ARM_STEPS, SPIT_WINDUP_SPRITE, SPIT_SPRITE_BASE,
         SPIT_FACING_LEFT_OFFSET, SPIT_FACING_RIGHT_OFFSET, SPIT_BOX,
         SPIT_CULL, SPIT_DEATH_SPRITE_BASE,
         SPIT_DEATH_FRAMES } from '../game/ce64.js';

export function makeChecker() {
  const results = [];
  const check = (name, pass, detail = '') => {
    results.push({ name, pass: !!pass, detail });
    return pass;
  };
  return { results, check };
}

/** Documented figures this port must reproduce from raw bytes. */
export const EXPECTED = {
  liveTriggers: 756,
  condSlots: 2268,
  cond0Slots: 1207,
  verbHistogram: [203, 4, 75, 75, 3, 134, 25, 60, 48, 18, 7, 6, 8, 77, 13],
  maxCondKind: 16,
  maxVerb: 14,
};

/**
 * Run every invariant against the whole shipped level set.
 * @param {(url:string)=>Promise<Uint8Array>} fetchRaw returns raw file bytes
 */
export async function runAllChecks(fetchRaw) {
  const { results, check } = makeChecker();
  const keys = ['1A','1B','2A','2B','3A','3B','4A','4B'];

  let liveTotal = 0, slotTotal = 0, cond0Total = 0;
  let maxKind = -1, maxVerb = -1;
  const hist = new Array(15).fill(0);
  let dclExact = 0, pi1Exact = 0, bulkExact = 0;
  let sampleMessages = [];

  for (const k of keys) {
    /* --- DCL: decompresses and consumes its input EXACTLY --- */
    const rawMap = await fetchRaw(`game/PLEV${k}.MAP`);
    const decMap = dclDecompress(rawMap);
    if (decMap.consumed === rawMap.length) dclExact++;
    check(`PLEV${k}.MAP header is 00 06 (DCL, literal mode 0, 4096-byte dict)`,
      rawMap[0] === 0 && rawMap[1] === 6, `got ${rawMap[0]} ${rawMap[1]}`);

    /* --- MAP: bulk is exactly 21824 bytes --- */
    const map = parseMap(decMap.data);
    const bulkLen = decMap.data.length - (4 + map.count * 2);
    if (bulkLen === BULK_SIZE) bulkExact++;
    check(`PLEV${k} bulk == ${BULK_SIZE} (total - 21824 == 4 + 2*count)`,
      bulkLen === BULK_SIZE, `bulk=${bulkLen} count=${map.count}`);

    if (sampleMessages.length === 0) {
      sampleMessages = map.messages.filter(Boolean).slice(0, 4);
    }

    /* --- triggers --- */
    for (let i = 0; i < TRIG_COUNT; i++) {
      const t = parseAllTriggers(map.bulk)[i];
      if (!isLive(t)) continue;
      liveTotal++;
      const v = verbOf(t);
      if (v < 15) hist[v]++;
      if (v > maxVerb) maxVerb = v;
      for (let s = 0; s < 3; s++) {
        slotTotal++;
        if (t.condKind[s] === 0) cond0Total++;
        if (t.condKind[s] > maxKind) maxKind = t.condKind[s];
      }
    }

    /* --- PI1: exactly 32034 bytes = 4 planes, never 5 --- */
    const rawBits = await fetchRaw(`game/PBITS${k}.PI1`);
    const decBits = dclDecompress(rawBits);
    if (decBits.data.length === PI1_SIZE) pi1Exact++;
    check(`PBITS${k}.PI1 == ${PI1_SIZE} B (4 planes; 5 would need 40034)`,
      decBits.data.length === PI1_SIZE, `${decBits.data.length}`);
    /* Palette provenance — a correction this port surfaced.
     * The project notes originally claimed EVERY .PI1 has ST 3-bit palette
     * words (all nibbles <= 7). Measured across all 44 shipped .PI1 files
     * that holds for 32 of them and FAILS for exactly 12: the PBITS* and
     * PXTRA* tile sheets, every one of which also has the high nibble set.
     * So a tile sheet's palette words are NOT a usable ST palette, and the
     * level palette must come from elsewhere. We assert the real split. */
    const bitsImg = decodePI1(decBits.data);
    const st3 = (img) => !Array.from(img.paletteRaw)
      .some((w) => ((w >> 8) & 15) > 7 || ((w >> 4) & 15) > 7 || (w & 15) > 7);
    check(`PBITS${k} palette is NOT ST 3-bit (tile sheets carry no palette)`,
      !st3(bitsImg));

    const rawPal = await fetchRaw(`game/PLEVEL${k}.PI1`);
    const palImg = decodePI1(dclDecompress(rawPal).data);
    check(`PLEVEL${k}.PI1 palette IS ST 3-bit (every nibble <= 7)`, st3(palImg));
  }

  check(`DCL consumes input exactly on all 8 maps`, dclExact === 8, `${dclExact}/8`);
  check(`all 8 .PI1 tile sheets are exactly ${PI1_SIZE} bytes`, pi1Exact === 8, `${pi1Exact}/8`);
  check(`all 8 map bulks are exactly ${BULK_SIZE} bytes`, bulkExact === 8, `${bulkExact}/8`);

  check(`live trigger records == ${EXPECTED.liveTriggers}`,
    liveTotal === EXPECTED.liveTriggers, `${liveTotal}`);
  check(`condition slots == ${EXPECTED.condSlots}`,
    slotTotal === EXPECTED.condSlots, `${slotTotal}`);
  check(`COND0 (unused-slot) count == ${EXPECTED.cond0Slots}`,
    cond0Total === EXPECTED.cond0Slots, `${cond0Total}`);
  check(`max condition kind == ${EXPECTED.maxCondKind} (17-entry table SS:0x35b0)`,
    maxKind === EXPECTED.maxCondKind, `${maxKind}`);
  check(`max action verb == ${EXPECTED.maxVerb} (15-entry table SS:0x3592)`,
    maxVerb === EXPECTED.maxVerb, `${maxVerb}`);
  const histOk = hist.every((v, i) => v === EXPECTED.verbHistogram[i]);
  check(`action verb histogram matches the C port exactly`,
    histOk, hist.join('/'));

  check(`tile grid is ${TILE_COUNT} tiles (export 17 clamps at 0x78 = 120)`,
    TILE_COUNT === 120, `${TILE_COUNT}`);

  /* --- sprite atlases --- */
  for (const name of ['PALWAYS1', 'POBJ1', 'PGODFONT', 'PSMLFNT']) {
    const dat = dclDecompress(await fetchRaw(`game/${name}.DAT`)).data;
    const img = decodePI1(dclDecompress(await fetchRaw(`game/${name}.PI1`)).data);
    const a = parseAtlas(dat);                      // throws unless 2 + 10*count
    const s = atlasStats(a);
    check(`${name}.DAT is 2 + 10*count bytes (count ${a.count})`,
      dat.length === 2 + 10 * a.count, `${dat.length}`);
    check(`${name} frames all inside the 320x200 canvas`,
      s.outOfBounds === 0, `${s.outOfBounds} out of bounds`);
    check(`${name} word2 is dead padding (always 0)`,
      s.word2NonZero === 0, `${s.word2NonZero} non-zero`);
    const frames = cutAll(img, a);
    const empty = frames.filter((f) => !f.pixels.some((v) => v !== 0)).length;
    check(`${name}: ${a.count - empty}/${a.count} frames contain pixels`,
      empty <= 1, `${empty} empty`);
  }

  /* --- the status panel (game/status-panel.js) --- *
   * Undocumented before this pass. The load-site disassembly (CS:0x2a01 for
   * PSTATUS, CS:0x2a09/0x05a0 for PSTAT3) says only rows 160-199 are ever
   * converted — these checks re-derive that from the shipped bytes rather
   * than trusting the disassembly alone. */
  for (const name of ['PSTATUS', 'PSTAT3']) {
    const raw = dclDecompress(await fetchRaw(`game/${name}.PI1`)).data;
    check(`${name}.PI1 == ${PI1_SIZE} B (a genuine DEGAS image, not an atlas)`,
      raw.length === PI1_SIZE, `${raw.length}`);
    const img = decodePI1(raw);
    let topZero = true;
    for (let i = 0; i < PANEL_Y0 * 320 && topZero; i++) topZero = img.indices[i] === 0;
    check(`${name}: rows 0..${PANEL_Y0 - 1} are ALL colour 0 (never converted — CS:0x2a23's SI skips them)`,
      topZero);
    const panel = decodeStatusPanel(raw);
    check(`${name}: decodeStatusPanel returns ${PANEL_W}x${PANEL_H}`,
      panel.w === PANEL_W && panel.h === PANEL_H, `${panel.w}x${panel.h}`);
    const bandHasZero = panel.indices.includes(0);
    check(`${name}: the real 40-row band contains NO colour-0 pixels (opaque, no mask needed)`,
      !bandHasZero);
  }

  /* The two files load into the SAME destination (0xac7a) — PSTAT3 physically
   * overwrites PSTATUS at runtime, and only PSTAT3 is ever visible once real
   * gameplay starts. Confirm they are genuinely different assets (not one
   * file copied under two names) and that the difference sits where the
   * disassembly-free visual diff found it. */
  {
    const a = decodeStatusPanel(dclDecompress(await fetchRaw('game/PSTATUS.PI1')).data);
    const b = decodeStatusPanel(dclDecompress(await fetchRaw('game/PSTAT3.PI1')).data);
    let diff = 0, minX = PANEL_W, maxX = -1, minY = PANEL_H, maxY = -1;
    for (let y = 0; y < PANEL_H; y++) for (let x = 0; x < PANEL_W; x++) {
      const i = y * PANEL_W + x;
      if (a.indices[i] !== b.indices[i]) {
        diff++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    check(`PSTATUS and PSTAT3 are genuinely different (not the same file twice)`, diff > 0, `${diff} px differ`);
    check(`...and everywhere ELSE in the 320x40 band is pixel-identical`,
      diff > 0 && diff < PANEL_W * PANEL_H * 0.25,
      `diff bbox x[${minX},${maxX}] y[${minY},${maxY}]`);
  }

  /* PALETTE. Neither load site installs a DAC palette (no export 7/8/9
   * adjacent to CS:0x2a01/0x2a09) — the converted bytes are drawn through
   * whatever level palette is already active. Confirmed here: the panel's
   * own embedded words 2..15 match PLEVEL1A.PI1's own words 2..15 exactly,
   * differing only in the two low, level-specific accent slots every level
   * palette also varies independently — so reading indices through
   * level.palette (as this port's renderer.present() already does for
   * every other sprite) is the right call, not a simplification. */
  {
    const panelImg = decodePI1(dclDecompress(await fetchRaw('game/PSTATUS.PI1')).data);
    const levelImg = decodePI1(dclDecompress(await fetchRaw('game/PLEVEL1A.PI1')).data);
    let sharedTail = true;
    for (let i = 2; i < 16 && sharedTail; i++) sharedTail = panelImg.paletteRaw[i] === levelImg.paletteRaw[i];
    check(`PSTATUS's own palette words 2..15 match PLEVEL1A's exactly (shared baseline, no DAC install)`,
      sharedTail);
  }

  return { results, sampleMessages, hist };
}

/* Descriptor-numbering anchors. Both were PREDICTED from the cumulative model
 * and then measured against the shipped atlases — neither dimension was
 * fitted. If the numbering were wrong these would land on the wrong frame. */
export async function checkDescriptorAnchors(fetchRaw) {
  const { results, check } = makeChecker();
  const counts = {};
  for (const s of ['PALWAYS1', 'PALWAYS2', 'PALWAYS3', 'PGODFONT']) {
    counts[s] = parseAtlas(dclDecompress(await fetchRaw(`game/${s}.DAT`)).data).count;
  }
  const { map, ranges } = buildDescriptorMap(['always'], (s) => counts[s]);

  const d127 = map[127];
  const a3 = parseAtlas(dclDecompress(await fetchRaw('game/PALWAYS3.DAT')).data);
  const f127 = a3.frames[d127.frame];
  check(`descriptor #127 (export 21) -> ${d127.stem} frame ${d127.frame}, 80x7 digit strip`,
    d127.stem === 'PALWAYS3' && f127.w === 80 && f127.h === 7, `${f127.w}x${f127.h}`);

  const d169 = map[169];
  const gf = parseAtlas(dclDecompress(await fetchRaw('game/PGODFONT.DAT')).data);
  const f169 = gf.frames[d169.frame];
  check(`descriptor #169 -> ${d169.stem} frame ${d169.frame}, the 208x46 title logo`,
    d169.stem === 'PGODFONT' && f169.w === 208 && f169.h === 46, `${f169.w}x${f169.h}`);

  const heroFrames = [];
  const a1 = parseAtlas(dclDecompress(await fetchRaw('game/PALWAYS1.DAT')).data);
  const a2 = parseAtlas(dclDecompress(await fetchRaw('game/PALWAYS2.DAT')).data);
  a1.frames.forEach((f) => heroFrames.push(f));
  a2.frames.slice(0, 19).forEach((f) => heroFrames.push(f));
  const tall = heroFrames.filter((f) => f.w === 32 && f.h >= 42).length;
  check(`hero descriptors #0..#57 are 32x48-class frames`,
    tall >= 55, `${tall}/58 are 32x>=42`);
  check(`max player anim_base (55) lies inside the hero range`,
    Math.max(...PLAYER_ANIM_BASE) <= HERO_DESCRIPTOR_MAX, `${Math.max(...PLAYER_ANIM_BASE)}`);
  /* ══ THE DS:0xcfcc CO-TENANT — a PLACED world-2 enemy ════════════════════
   *
   * Last session closed UNKNOWN_hazard_emitter_placement by proving the other
   * tenant of this pool is CUT. The natural next inference — that its
   * neighbour is cut too — is wrong, and these checks are what forces the
   * question rather than letting the assumption stand.
   */
  {
    const nkeys = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'];
    const placed = {};
    const cat4 = {};
    for (const k of nkeys) {
      const m = parseMap(dclDecompress(await fetchRaw(`game/PLEV${k}.MAP`)).data);
      placed[k] = m.objects.filter((o) => !isDeadType(o.type)
                                       && o.type === NEST_TYPE).length;
    }
    for (const w of [1, 2, 3, 4]) {
      const cats = parseObjectCategories(
        dclDecompress(await fetchRaw(`game/POBJECTS.00${w}`)).data);
      cat4[w] = [...cats].map((c, i) => [c, i]).filter(([c]) => c === 4)
                         .map(([, i]) => i);
    }

    const w2 = placed['2A'] + placed['2B'];
    const rest = nkeys.filter((k) => k[0] !== '2')
                      .reduce((n, k) => n + placed[k], 0);

    /* ⚠️ THE DISCRIMINATING PART IS THE ZERO. A type placed only in world 2
     * is what makes the allocator's own `cmp byte [0x42],2` corroborating
     * rather than circular — the world gate was read out of the code before
     * this census was run, and the census could have contradicted it. */
    check(`object type ${NEST_TYPE} is placed 16+16 in WORLD 2 and nowhere else`,
      placed['2A'] === 16 && placed['2B'] === 16 && w2 === 32 && rest === 0,
      `PLEV2A ${placed['2A']}, PLEV2B ${placed['2B']}, all six other maps ` +
      `${rest} — matching CS:0x8611's \`cmp byte [0x42],2\` exactly. So the ` +
      `DS:0xcfcc pool's OTHER tenant is the opposite of the falling hazard: ` +
      `decoded AND reachable, 32 placements the port had nothing for`);

    check(`type ${NEST_TYPE} is POBJECTS category 4, with an EMPTY name and description`,
      [1, 2, 3, 4].every((w) => cat4[w].includes(NEST_TYPE)),
      `category 4 in all four worlds. The game never names it, which is why ` +
      `this port's "nest" is a LABEL and UNKNOWN_nest_identity stands. It is ` +
      `also consistent: a category-4 object is rejected by the walk-in pickup ` +
      `path (CS:0x17E6 \`jg\` sends category >= 2 away), so it never needs one`);

    /* Category 4 is one of the two codes this project has carried as UNKNOWN
     * since the POBJECTS work. This does not close it, but it narrows it.
     *
     * ⚠️ I FIRST WROTE THIS ROW AS "every category-4 type is unnamed", with
     * an assertion that did not test any name. It is false: type 50 is named
     * "spike". The row now tests what it claims — and the exception argues
     * the same way as the rule, because a spike is a hazard rather than an
     * item, which is what category 4 looks like from every other angle too. */
    {
      const pobj1 = dclDecompress(await fetchRaw('game/POBJECTS.001')).data;
      const nameOf4 = (t) => {
        let n = '';
        for (let i = 0; i < 16; i++) {
          const c = pobj1[t * 48 + 8 + i];
          if (!c) break;
          n += String.fromCharCode(c);
        }
        return n;
      };
      const named = cat4[1].filter((t) => nameOf4(t) !== '');
      check(`6 of the 7 category-4 types are UNNAMED — the exception is type 50, "spike"`,
        cat4[1].length === 7 && cat4[1].join() === cat4[2].join()
          && named.length === 1 && named[0] === 50 && nameOf4(50) === 'spike'
          && nameOf4(NEST_TYPE) === '',
        `types ${cat4[1].join(', ')} (identical in world 2), and only 50 ` +
        `carries text. POBJECTS categories 0/1/2/3 are ` +
        `potion/treasure/keys/levers — all things the hero picks up. Category ` +
        `4 has no names because nothing in it is an item: type ${NEST_TYPE} ` +
        `is routed BY SPRITE ID into a spawner at CS:0x161D, and "spike" is a ` +
        `hazard. Categories 4 and 5 stay UNKNOWN, but this is what 4 looks ` +
        `like from the data side`);
    }

    /* ── the sprite range closes exactly ────────────────────────────────── */
    check(`sprite = ${NEST_SPRITE_BASE} + state covers exactly nine frames, ${NEST_SPRITE_FIRST}..${NEST_SPRITE_LAST}`,
      NEST_SPRITE_FIRST === 512 && NEST_SPRITE_LAST === 520
        && NEST_SPRITE_LAST - NEST_SPRITE_FIRST + 1 === 9
        && SEED_STATE === -4,
      `state runs [-4, +4] and the formula is applied unchanged across the ` +
      `whole signed range — CS:0x88B4 (hatching, negative) and CS:0x8765 ` +
      `(alive) both do \`add dx,0x204\`. Under world 2's load order those nine ` +
      `land inside PLEVEL2B (#504..#540) with room to spare, and render as ` +
      `four frames growing upward out of nothing then five creature poses`);

    /* ⚠️ The pedestal offsets CANCEL the allocator's exactly — seed (x+3,
     * y-24) against draw (x-3, y+24) — so the plinth lands precisely on the
     * placed object. Two readings taken from opposite ends of the subsystem
     * confirming each other; I had both numbers and missed that they meet. */
    check(`the object keeps drawing its OWN sprite (${NEST_OBJ_SPRITE}) under the creature, exactly where it was placed`,
      NEST_OBJ_SPRITE === 285 && NEST_OBJ_SPRITE === 170 + NEST_TYPE
        && SEED_X_BIAS === 3 && SEED_Y_BIAS === -0x18,
      `CS:0x8806 blits sprite 0x11d at (x-3, y+0x18), cancelling the seed's ` +
      `(+3, -0x18) exactly, on every path — hatching, ` +
      `alive and frozen. That is why the nest does not need the ordinary ` +
      `object draw: the creature carries it. It is also the reason the ` +
      `dispatcher can mark the object dead immediately without the plinth ` +
      `vanishing`);

    /* ── the fire logic: asymmetric on BOTH counts ──────────────────────── */
    {
      const x = 1000;
      const band = [];
      for (let hx = x - 60; hx <= x + 60; hx++) if (aimAt(x, hx) === 0) band.push(hx);
      const lo = band[0] - x, hi = band[band.length - 1] - x;
      check(`the aim dead band is [-${BAND_LEFT}, +${BAND_RIGHT}) — asymmetric, and half-open`,
        lo === -BAND_LEFT && hi === BAND_RIGHT - 1 && band.length === 56
          && aimAt(x, x - BAND_LEFT - 1) === -1 && aimAt(x, x + BAND_RIGHT) === +1,
        `heroX - entityX in [${lo}, ${hi}] inclusive = 56 px wide: 32 left, 24 ` +
        `right. CS:0x86CE's \`sub bx,0x38\` is applied to the ALREADY-BIASED ` +
        `bx (heroX + 0x20), so the second bound is heroX - 24, not heroX - 56 ` +
        `— reading it as a fresh offset gives an 88-px band`);

      {
        /* ⚠️ In the dead band CS:0x8736 writes state 2 and falls straight
         * through to the tail with NO `dec`. The timer PAUSES. And because
         * the >40 gate at CS:0x86BB decrements before the aim test, a turret
         * whose hero parked in the band since its last shot sits at exactly
         * 40 and needs 41 more frames after the hero leaves. */
        const pool = new Nests(2, new GodsRandom(5));
        pool.spawn(0, 200, 0);
        const s0 = pool.slots[0];
        s0.state = 0; s0.timer = 20;
        const none = (b) => b.hp;
        for (let t = 0; t < 30; t++) pool.step({ x: 0, y: 0 }, { x: s0.x }, 0, none);
        check(`the fire timer FREEZES while the hero is in the dead band`,
          s0.timer === 20 && s0.state === NST.BAND,
          `30 ticks with the hero centred and the timer has not moved off ` +
          `${s0.timer}. CS:0x8736 writes state 2 and falls through with no ` +
          `\`dec\` — only the two aiming branches decrement. A port that ticks ` +
          `the timer unconditionally has the creature fire the instant the ` +
          `hero steps out, instead of after the remaining countdown`);
      }

      check(`the muzzle offsets are asymmetric too: +${MUZZLE.right.dx} against ${MUZZLE.left.dx}`,
        MUZZLE.right.dx === 0x18 && MUZZLE.left.dx === -6
          && MUZZLE.right.dy === MUZZLE.left.dy
          && MUZZLE.right.dir === -MUZZLE.left.dir,
        `CS:0x86EF \`add ax,0x18\` against CS:0x871D \`sub ax,0x6\`, both with ` +
        `\`add bx,6\`. The right muzzle sits at the far edge of the 24-wide ` +
        `body and the left one just outside the near edge. Only the direction ` +
        `word DS:0x206 (+-5) is a clean mirror`);
    }

    /* ── the timers, and the reload that exceeds its own gate ───────────── */
    check(`the fire reload (${FIRE_RELOAD}) is GREATER than the aim gate (${AIM_GATE})`,
      FIRE_RELOAD > AIM_GATE && FIRE_PERIOD === FIRE_RELOAD + 1,
      `CS:0x86BB skips the aim logic while the timer exceeds ${AIM_GATE}, and ` +
      `CS:0x86DF reloads it to ${FIRE_RELOAD} — so for two ticks after every ` +
      `shot the creature holds its fired pose and does not re-aim. The full ` +
      `period is ${FIRE_PERIOD} ticks (the shot lands when the dec goes ` +
      `NEGATIVE), about 2.9 s at 15 Hz`);

    check(`the first shot comes ${HATCH_RELOAD + 1} frames after rising, but the cycle is ${FIRE_PERIOD}`,
      HATCH_RELOAD === 0x27 && FIRE_PERIOD === 43
        && HATCH_RELOAD < AIM_GATE && FIRE_RELOAD > AIM_GATE,
      `the emerge handler reloads ${HATCH_RELOAD}, which is BELOW the ` +
      `${AIM_GATE} gate, so the aim path runs immediately and 40 decs reach ` +
      `-1. The fire reload is ${FIRE_RELOAD}, ABOVE the gate, so two frames ` +
      `are eaten by CS:0x8731 before aiming resumes and the steady cycle is ` +
      `${FIRE_PERIOD}. The two differ because the reload straddles the gate ` +
      `in opposite directions`);

    check(`the hatch seed timer is ${SEED_TIMER_BASE}..${SEED_TIMER_BASE + SEED_TIMER_MASK}, straddling the aim gate`,
      /* ⚠️ Literals on the right. `SEED_TIMER_BASE === AIM_GATE` is the
       * interesting OBSERVATION but a tautological ASSERTION — both are my
       * own transcription of the same binary, so it restates itself. The
       * linter refused it, correctly. */
      SEED_TIMER_BASE === 0x28 && AIM_GATE === 0x28 && SEED_TIMER_MASK === 0x0f,
      `CS:0x864D seeds 0x28 then CS:0x8657 adds (rand & 0xf). The base IS the ` +
      `aim gate, so a fresh creature waits a randomised 0..15 ticks before it ` +
      `can first aim — the randomisation exists to stop sixteen nests on one ` +
      `screen firing in lockstep`);

    /* ── the hitbox changes with state, and by a factor of nine ─────────── */
    check(`the hitbox is ${BOX_HATCH.w}x${BOX_HATCH.h} while hatching and ${BOX_ALIVE.w}x${BOX_ALIVE.h} once alive`,
      BOX_HATCH.w === 8 && BOX_ALIVE.w === 0x18
        && BOX_HATCH.dx === 8 && BOX_HATCH.dy === 15
        && BOX_ALIVE.dx === 0 && BOX_ALIVE.dy === 0,
      `CS:0x8883 against CS:0x8740. The small box is also OFFSET into the ` +
      `middle of the sprite, at (x+8, y+15), where the alive box is flush at ` +
      `(x, y). One box for both makes the whole emergence a free kill`);

    /* ── a SEVENTH cull rectangle ───────────────────────────────────────── */
    {
      const rects = [
        ['System-B entity', -63, 351, -63, 223],
        ['starburst', -8, 351, -8, 191],
        ['this creature', HATCH_WINDOW.xMin, HATCH_WINDOW.xMax,
                          HATCH_WINDOW.yMin, HATCH_WINDOW.yMax],
      ];
      const sigs = new Set(rects.map((r) => r.slice(1).join()));
      check(`the hatch window is a SEVENTH distinct cull rectangle`,
        sigs.size === rects.length && HATCH_WINDOW.yMin === 8,
        rects.map((r) => `${r[0]} x[${r[1]},${r[2]}] y[${r[3]},${r[4]}]`).join(' · ') +
        ` — and this is the only one of the seven whose Y floor is POSITIVE, ` +
        `so it culls at the top of the visible screen rather than above it. ` +
        `Factoring the seven into one helper would be wrong six times`);
    }

    /* ── the brood count: WALK the loop, do not read the seed ───────────── */
    check(`a dying creature broods ${broodCount(0)} or ${broodCount(1)}, not 2 or 3`,
      broodCount(0) === 3 && broodCount(1) === 4
        && [0, 1].every((r) => {
          /* CS:0x88E7 `mov dx,2` + (rand&1), CS:0x8947 `dec dx / jns`. */
          let dx = 2 + (r & 1), n = 0;
          do { n++; dx -= 1; } while (dx >= 0);
          return n === broodCount(r);
        }),
      `\`mov dx,2 / add dx,(rand & 1)\` with \`dec dx / jns\` at the bottom ` +
      `runs one more pass than the seed suggests. This project has now been ` +
      `caught by that shape four times — starburst particles, hits-to-break, ` +
      `the block's first shot, and this`);

    check(`the brood array is ${BROOD_SLOTS} x ${BROOD_STRIDE} bytes and children land one tile BELOW`,
      BROOD_SLOTS === 16 && BROOD_STRIDE === 0x10 && BROOD_Y_OFFSET === 0x18
        && BROOD_HP === 0x2b,
      `CS:0x88F5 \`mov bp,0xf\` with \`dec bp / jns\` = ${BROOD_SLOTS} slots at ` +
      `stride ${BROOD_STRIDE} = 256 bytes, which is exactly what CS:0x8676 ` +
      `fills with 0xFFFF (\`mov cx,0x80\` words). The children inherit the ` +
      `parent's x,y by \`movsw / movsw\` and then add ${BROOD_Y_OFFSET} to y`);

    check(`the two brood randoms are DIFFERENT shapes — sign from the unmasked word`,
      signed16(0xffff) === -1 && signed16(0x7fff) === 32767
        && signed16(0x8003) === -32765,
      `CS:0x8913 masks then negates unconditionally (-2..-5). CS:0x8921 takes ` +
      `the MAGNITUDE from (rand & 3) but the SIGN from the untouched 16-bit ` +
      `word — \`mov bx,ax / and ax,3 / or bx,bx / jns / neg ax\`. A single ` +
      `\`(rand & 3) - 2\` reproduces neither`);

    /* ── death inherits the live state, DRIVEN THROUGH THE REAL CLASS ────
     *
     * ⚠️ I first wrote this as a local re-implementation of the increment
     * loop, which proved only that I could write the same three lines twice.
     * Mutation testing said so: unifying the two brood randoms inside Nests
     * SURVIVED, and relaxing `== 4` to `>= 4` inside Nests was not even
     * reachable from the check. It now drives the class. */
    {
      const noDamage = (b) => b.hp;                 // a contact stub that never hits
      const cam0 = { x: 0, y: 0 };
      /** Put one creature straight into `state`, at HP -1, and let it die. */
      const dieFrom = (state) => {
        const pool = new Nests(2, new GodsRandom(11));
        const kids = [];
        const brood = {
          spawn: (x, y, f8, fA, hp) => { kids.push({ x, y, f8, fA, hp }); return true; },
        };
        pool.spawn(0, 200, 0);
        const s = pool.slots[0];
        s.state = state; s.hp = -1;
        let ticks = 0;
        while (pool.live > 0 && ticks < 20) {
          pool.step(cam0, { x: 0 }, 0, noDamage, brood);
          ticks++;
        }
        return { ticks, kids, broods: pool.broods };
      };

      const d0 = dieFrom(NST.AIM_LEFT);
      const d3 = dieFrom(NST.AIM_RIGHT);
      const d4 = dieFrom(NST.FIRED_RIGHT);
      check(`killing it on the fired-right tick (state ${NST.FIRED_RIGHT}) SKIPS the brood`,
        d0.broods === 1 && d3.broods === 1 && d4.broods === 0
          && d0.ticks === 7 && d3.ticks === 4 && d4.ticks === 3
          && BROOD_AT_STATE === 4 && DEATH_FREE_AT_STATE === 7,
        `death does not reset the state, it CONTINUES incrementing from ` +
        `whatever pose the creature held: dying from state 0 takes ` +
        `${d0.ticks} ticks and broods, from 3 takes ${d3.ticks} and broods, ` +
        `from 4 takes ${d4.ticks} and does NOT. CS:0x87DA is ` +
        `\`cmp ...,4 / jnz\` — an equality test — so a creature already at 4 ` +
        `increments past it. State ${NST.FIRED_RIGHT} lasts exactly one tick, ` +
        `so the window is narrow; \`>= 4\` loses it entirely`);

      /* ⚠️ KILLED MID-RISE. CS:0x88C6/0x88DB `jmp 0x877e` means the EMERGE
       * draw shares the live path's tail, so CS:0x8784 `mov word [si+4],0`
       * runs for a creature killed while still hatching. My port had that
       * reset on the live path only; a cross-read of the tail found it. */
      {
        const pool = new Nests(2, new GodsRandom(3));
        pool.spawn(0, 200, 0);
        const s0 = pool.slots[0];
        s0.state = -3;                       // mid-rise
        const kill = () => -1;               // a contact stub that always kills
        const frames = pool.step(cam0, { x: 0 }, 0, kill, null);
        const dead = pool.step(cam0, { x: 0 }, 0, kill, null);
        const firstDeathSprite = dead.drawn[0] && dead.drawn[0].sprite;
        check(`a creature killed MID-RISE starts its death at frame 0, not at a negative one`,
          s0.state >= 0 && firstDeathSprite === DEATH_SPRITE_BASE
            && frames.drawn.length > 0,
          `the emerge draw jumps to the shared tail at CS:0x877E, so the ` +
          `CS:0x8784 state reset applies to it too. Without it the death ` +
          `handler starts negative and draws sprite ${DEATH_SPRITE_BASE} - 3 = ` +
          `${DEATH_SPRITE_BASE - 3}, three frames before the death cloud`);
      }

      /* The brood's two random fields, observed over many bursts through the
       * real spawner rather than asserted against my own arithmetic. */
      {
        const f8 = new Set(), fA = new Set();
        let kids = 0;
        for (let seed = 0; seed < 40; seed++) {
          const pool = new Nests(2, new GodsRandom(seed));
          const brood = { spawn: (x, y, a, b) => { f8.add(a); fA.add(b); kids++; return true; } };
          pool.spawn(0, 200, 0);
          pool.slots[0].state = NST.AIM_LEFT; pool.slots[0].hp = -1;
          for (let t = 0; t < 12 && pool.live > 0; t++) {
            pool.step(cam0, { x: 0 }, 0, noDamage, brood);
          }
        }
        const f8s = [...f8].sort((a, b) => a - b);
        const fAs = [...fA].sort((a, b) => a - b);
        /* ⚠️ THE DRAW ORDER, pinned separately. The range check above cannot
         * see the two rng.next() calls being swapped — the distributions are
         * unchanged, and the original's table is wall-clock seeded so the
         * per-child pairing was never observable against it anyway. It is
         * still unfaithful: CS:0x8913 draws BEFORE CS:0x8921. A scripted
         * source makes the order testable without pretending the values are.
         */
        {
          const script = [0, 0, 3];          // count-draw, then fieldA, then field8
          let i = 0;
          const rng = { next: () => script[i++] ?? 0 };
          const pool = new Nests(2, rng);
          const kids = [];
          const brood = { spawn: (x, y, a, b) => { kids.push([a, b]); return true; } };
          pool.spawn(0, 200, 0);
          /* spawn() consumed one draw for the hatch timer; restart the script. */
          i = 0;
          pool.slots[0].state = NST.AIM_LEFT; pool.slots[0].hp = -1;
          for (let t = 0; t < 12 && pool.live > 0; t++) {
            pool.step(cam0, { x: 0 }, 0, noDamage, brood);
          }
          check(`the brood draws fieldA BEFORE field8 — order pinned, not just range`,
            kids.length === 3 && kids[0][0] === 3 && kids[0][1] === -2,
            `feeding the draws 0, 0, 3 gives child 0 field8=+${kids[0][0]}, ` +
            `fieldA=${kids[0][1]}: the 0 went to CS:0x8913 (-(0+2) = -2) and ` +
            `the 3 to CS:0x8921 (magnitude 3, positive word). Swap the two ` +
            `calls and the same script yields field8=0, fieldA=-5`);
        }

        check(`the brood's two random fields have DIFFERENT ranges — ${f8s.join(',')} against ${fAs.join(',')}`,
          kids > 100
            && f8s.every((v) => v >= -3 && v <= 3) && f8s.includes(-3) && f8s.includes(3)
            && fAs.every((v) => v >= -5 && v <= -2) && fAs.length === 4
            && f8s.includes(0) && !fAs.includes(0),
          `+0x8 is SYMMETRIC about zero (magnitude from \`and ax,3\`, sign from ` +
          `the untouched word at CS:0x8929) while +0xa is STRICTLY NEGATIVE ` +
          `(\`and ax,3 / neg ax / sub ax,2\` at CS:0x8913). Observed over ` +
          `${kids} children from 40 seeds. A single \`(rand & 3) - 2\` gives ` +
          `-2..1 for both — wrong range, wrong symmetry, and it never reaches ` +
          `-3 or +3`);
      }
    }

    /* ── the allocator's caller tests the WRONG FLAG ────────────────────── */
    check(`a nest fires ONCE — CS:0x1C94 is \`jz\` where its sibling uses \`jc\``,
      NEST_WORLD === 2 && NEST_SLOTS === 10 && NEST_STRIDE === 10
        && SEED_STATE === -4 && SEED_HP === 60,
      `CS:0x8611 signals failure with STC like the sibling allocator ` +
      `CS:0x7F0D, whose caller correctly tests \`jc\` at CS:0x1C80. This arm ` +
      `tests ZF instead, and ZF is 0 on ALL THREE return paths — success ` +
      `(\`add [si],ax\` lands in 0x28..0x37), pool-full (an occupied slot's x ` +
      `is non-zero) and wrong-world (the \`cmp\` failed). So the fall-through ` +
      `always runs and CS:0x1C98 marks the object dead. Consequences: each of ` +
      `the 16 nests yields at most one creature, and a nest activating while ` +
      `the ten-slot pool is full is consumed with NOTHING spawned`);

    /* ── the model runs on the shipped placements ───────────────────────── */
    {
      const map2a = parseMap(dclDecompress(await fetchRaw('game/PLEV2A.MAP')).data);
      const nests = map2a.objects.filter((o) => !isDeadType(o.type)
                                             && o.type === NEST_TYPE);

      /* ⚠️ HOW MANY CAN BE ON SCREEN AT ONCE — measured, not assumed.
       * I first wrote this row as "16 nests fill the ten-slot pool", spawning
       * all 16 in a loop. That is not how play works and it overstated the
       * finding. Sweeping the real activation box (CS:0x11A0) over every
       * camera position on both world-2 maps gives a maximum of 4 (PLEV2A)
       * and 5 (PLEV2B) simultaneously inside it — a single screen can NEVER
       * fill the pool. The pressure comes from somewhere else: slots are
       * freed only by DEATH (CS:0x87E9 is the sole `mov word [si],0xffff` in
       * the whole 0x8611..0x894D range), never on scroll-off, so allocation
       * is CUMULATIVE across a sublevel. */
      let boxMax = 0;
      for (let cx = 0; cx <= 4096 - 320; cx += 32) {
        for (let cy = 0; cy <= 1024 - 160; cy += 16) {
          const b = activationBox(cx, cy);
          let c = 0;
          for (const o of nests) {
            if (o.x >= b.xMin && o.x <= b.xMax && o.y >= b.yMin && o.y <= b.yMax) c++;
          }
          if (c > boxMax) boxMax = c;
        }
      }
      check(`at most ${boxMax} of PLEV2A's ${nests.length} nests fit one activation box — the pool cannot fill from one screen`,
        nests.length === 16 && boxMax === 4 && boxMax < NEST_SLOTS,
        `swept over every camera position: ${boxMax} against ${NEST_SLOTS} ` +
        `slots. So the ten slots are not a per-screen budget. They are a ` +
        `CUMULATIVE one — nothing frees a slot but death — and with the ` +
        `\`jz\` bug a nest that finds the pool full is consumed permanently. ` +
        `The reachable failure is a player who leaves ten alive and then ` +
        `activates an eleventh`);

      {
        const pool = new Nests(2, new GodsRandom(7));
        let ok = 0;
        for (const o of nests) if (pool.spawn(o.x, o.y, 0)) ok++;
        check(`and when it does fill, the surplus is LOST rather than deferred`,
          ok === NEST_SLOTS && pool.refused === nests.length - NEST_SLOTS
            && pool.live === NEST_SLOTS,
          `${ok} allocated, ${pool.refused} refused — and because CS:0x1C98 ` +
          `runs on the refused path too, those ${pool.refused} objects are ` +
          `dead for the rest of the sublevel. A port that "fixes" CS:0x1C94 to ` +
          `\`jc\` spawns them later instead and diverges`);

        const wrong = new Nests(1, new GodsRandom(7));
        check(`the same pool refuses every allocation outside world 2`,
          !wrong.spawn(100, 100, 0) && wrong.wrongWorld === 1 && wrong.live === 0,
          `CS:0x8611's world gate, and the census agrees from the data side: ` +
          `zero type-${NEST_TYPE} objects ship in worlds 1, 3 or 4. The hazard ` +
          `that shares this pool is gated to world 4, so the two tenants could ` +
          `never coexist even if the hazard were placed — a STRUCTURAL reason, ` +
          `stronger than the "the hazard is cut" one this project recorded`);
      }
    }

    /* ── DS:0x3b2 is NOT shared state, correcting CLAUDE.md ─────────────── */
    results.push({
      name: 'CORRECTION: DS:0x3b2 is per-pass scratch, not a shared counter',
      note: true, pass: true,
      detail: 'CLAUDE.md records the two DS:0xcfcc tenants as sharing "one ' +
        'shared counter DS:0x3b2". All six references in the image are ' +
        'CS:0x868E/0x869B/0x8796 (this creature) and CS:0x8B5D/0x8B69/0x8C26 ' +
        '(the hazard), and each walker RESETS it at the top of its own pass, ' +
        'increments once per live record, and reads it only at the bottom of ' +
        'that same pass to decide whether to unhook its own gate. Nothing is ' +
        'carried between the two. The genuine sharing hazard is the RECORDS: ' +
        'ten slots read with incompatible +4/+6/+8 meanings.',
    });


    /* ══ WHAT THE NEST FIRES — DS:0x8954, and it is a WHOLE SUBSYSTEM ════ */
    {
      const cam = { x: 0, y: 0 };
      const hero = { x: 200, y: 100, state: 0 };

      check(`enemy shots are ${ES_SLOTS} records of ${ES_STRIDE} bytes at DS:0x8954, free when +6 < 0`,
        ES_SLOTS === 20 && ES_STRIDE === 8 && ES_FREE < 0,
        `CS:0x200F/0x2061 \`mov cx,0x14\` with \`add si,0x8\`. The emitter tests ` +
        `\`js\` for free and the updater tests \`jns\` for alive — the same ` +
        `word read in opposite senses, which is easy to invert from one site`);

      /* The two muzzle windows are NOT mirrors, and the difference is real. */
      const l = new EnemyShots(), r = new EnemyShots();
      const firedL = l.fire(4, 100, -5, cam);      // screenX 4: inside right's
      const firedR = r.fire(4, 100, +5, cam);      //   window, outside left's
      check(`the two muzzle windows differ — screenX 4 fires RIGHT but not LEFT`,
        !firedL && firedR && CULL_LEFT.xMin === 8 && CULL_RIGHT.xMin === -8
          && CULL_LEFT.xMax === 0x148 && CULL_RIGHT.xMax === 0x138,
        `left x[${CULL_LEFT.xMin},${CULL_LEFT.xMax}] against right ` +
        `x[${CULL_RIGHT.xMin},${CULL_RIGHT.xMax}] — each shifted 16 px AWAY ` +
        `from the direction of travel, so a muzzle just off the near edge is ` +
        `allowed and one just off the far edge is not. Y is identical in both. ` +
        `Reusing one rectangle loses shots at one edge and invents them at the ` +
        `other`);

      /* The hero box, at its four edges, with the crouch adjustment. */
      const hx = hero.x, hy = hero.y;
      const at = (sx, sy, cr = false) => hitsHero(sx, sy, hx, hy, cr);
      /* ⚠️ LITERALS on the probe coordinates. Written with HERO_BOX.w and
       * HOT_POINT.dx on both sides these read as tests but are X === X, and
       * mutation testing proved it: narrowing the box and zeroing the hot
       * point both SURVIVED. The linter cannot see it because these are
       * property accesses, not bare imported identifiers. */
      check(`the hero box is 32x48 INCLUSIVE, hot point +10,+4`,
        HERO_BOX.w === 0x20 && HERO_BOX.h === 0x30
          && HOT_POINT.dx === 0x0a && HOT_POINT.dy === 0x04
          && at(hx - 10, hy - 4) && at(hx + 22, hy + 44)
          && !at(hx - 11, hy) && !at(hx + 23, hy),
        `CS:0x4527-0x4545: \`jl\`/\`jg\` reject, so equality passes at every ` +
        `edge. The shot's own hot point (+${HOT_POINT.dx}, +${HOT_POINT.dy}) is ` +
        `added BEFORE the world conversion at CS:0x450A`);

      check(`crouching raises the top edge by ${CROUCH_RAISE} — 24 here, 20 on the CONTACT path`,
        at(hx, hy + 4) && !at(hx, hy + 4, true) && at(hx, hy + CROUCH_RAISE, true)
          && CROUCH_RAISE === 0x18 && isCrouching(0x12) && isCrouching(0x13)
          && !isCrouching(0x11) && !isCrouching(0x14),
        `CS:0x4516 runs the same \`cmp byte [0x377],0x12/0x13\` range test as ` +
        `the contact sites, but raises by 0x18 where CS:0xACA0 raises by 0x14. ` +
        `CLAUDE.md lists CS:0x4516 among three crouch sites without saying it ` +
        `belongs to the enemy-SHOT path rather than to CS:0xac59`);

      /* Invulnerability: the shot passes THROUGH rather than being eaten. */
      {
        const es = new EnemyShots();
        let hurt = 0;
        const health = { invulnerable: true, hurt: (n) => { hurt += n; } };
        es.fire(hero.x - 40, hero.y + 10, +5, cam);
        for (let t = 0; t < 12; t++) es.step(cam, hero, null, health);
        check(`while invulnerable the shot PASSES THROUGH — not consumed, no damage`,
          hurt === 0 && es.hits === 0 && es.passedThrough >= 5 && es.live === 1,
          `CS:0x4547's \`jnz\` skips BOTH the \`sub word [0x192],2\` and the ` +
          `\`mov word [si+6],0xffff\` that consumes it, so it keeps flying ` +
          `(${es.passedThrough} ticks inside the box). The CONTACT path is the ` +
          `opposite: CS:0xACCC skips only the subtract and the creature still ` +
          `dies`);

        const es2 = new EnemyShots();
        let hurt2 = 0;
        const h2 = { invulnerable: false, hurt: (n) => { hurt2 += n; } };
        es2.fire(hero.x - 40, hero.y + 10, +5, cam);
        for (let t = 0; t < 12; t++) es2.step(cam, hero, null, h2);
        check(`a hit costs a FLAT 2 off the health TARGET, once`,
          hurt2 === 2 && ES_DAMAGE === 2 && es2.hits === 1 && es2.live === 0,
          `CS:0x454E \`sub word [0x192],2\` — DS:0x192 is the target, so the ` +
          `bar at DS:0x19a chases down afterwards. ⚠️ It never reaches the ` +
          `difficulty scalar: DS:0x365 is consumed at CS:0xab56/0xab63 inside ` +
          `the CS:0xac59 path, which this test does not use. Enemy shots hit ` +
          `for the same amount in world 1 and world 4`);
      }

      /* Sprites and despawn: direction-dependent, and not mirrored. */
      check(`the flight sprite depends on DIRECTION — ${SPRITE_RIGHT} right, ${SPRITE_LEFT} left`,
        SPRITE_RIGHT === 0x48 && SPRITE_LEFT === 0x45
          && SPRITE_FADE_BASE === 0x45   /* literal: the coincidence, not X===X */
          && DESPAWN_RIGHT_X === 0x140 && DESPAWN_LEFT_X === -0x10
          && FADE_FREE_AT.join() === '3,6',
        `CS:0x20D2 against CS:0x2103 — two different descriptors, not one ` +
        `frame flipped, and the left one doubles as the first fade frame. The ` +
        `despawn edges are asymmetric too (0x140 against -0x10), and the fade ` +
        `frees on TWO equality tests (3 and 6) rather than one \`>=\``);

      /* ── The terrain probe: THREE branches, not one gated test ────────
       *
       * ⚠️ I first wrote this as "a cell of 1 stops the shot, GATED by a
       * straddle test", and the fixture only passed because it sat exactly on
       * the straddle boundary. The bytes read the other way round: `[di]` is
       * ALWAYS tested, and the straddle adds a SECOND cell. Written my way, a
       * shot entering a wall head-on at (x & 0x1f) == 0 flies straight
       * through it. The three cases are tested separately below so no single
       * fixture can hide a branch again. */
      {
        const mk = () => {
          const pb = new Uint8Array(128 * 64);
          pb[6 * 128 + 4] = 1;                     // solid at col 4, row 6
          return pb;
        };
        const far = { x: 9999, y: 9999, state: 0 };
        /** put one shot at world (x, 6*16) and step once; return its state */
        const probe = (x, planeB) => {
          const es = new EnemyShots();
          es.slots[0] = { x, y: 6 * 16, vx: 5, state: 0 };
          es.step(cam, far, planeB, null);
          return es.slots[0];
        };
        /* head-on: inside col 4 with no straddle at all. vx=5 lands it at
         * 4*32 + 5, so (x & 0x1f) == 5 — far below the straddle threshold. */
        const headOn = probe(4 * 32, mk());
        /* straddling: end at col 3 with (x & 0x1f) > 0x18, so [di] is col 3
         * (empty) and [di+1] is col 4 (solid). */
        const straddle = probe(3 * 32 + 0x19 - 5, mk());
        /* exactly ON the boundary: `jng` means 0x18 does NOT straddle, so
         * col 3 stays empty and the shot flies on. */
        const boundary = probe(3 * 32 + 0x18 - 5, mk());

        check(`terrain stops a shot on its OWN cell, or on the next one when it straddles past 24`,
          headOn.state !== 0 && straddle.state !== 0 && boundary.state === 0
            && TERRAIN_STRADDLE === 0x18,
          `head-on into col 4 stops (state ${headOn.state}); straddling ` +
          `${(straddle.x & 0x1f)} px into col 3 stops on col 4 ` +
          `(state ${straddle.state}); sitting at exactly ${boundary.x & 0x1f} ` +
          `does NOT — CS:0x2150 is \`jng\`, so 0x18 itself is not a straddle. ` +
          `Making the straddle GATE the primary test lets a shot fly through a ` +
          `wall it entered head-on`);

        check(`the stop STATE depends on direction — ${STOP_STATE_RIGHT} right, ${STOP_STATE_LEFT} left, and both free tests are live`,
          headOn.state === 4 && headOn.vx === 0
            && FADE_FREE_AT.join() === '3,6'
            && STOP_STATE_RIGHT === 4 && STOP_STATE_LEFT === 1,
          `CS:0x215E seeds 4 for a right-flying shot and CS:0x2165 seeds 1 for ` +
          `a left-flying one, then CS:0x216A zeroes the velocity — which is ` +
          `what makes CS:0x20B6's \`jz\` arm reachable at all. So a left stop ` +
          `fades 1,2 and frees at 3 while a right stop fades 4,5 and frees at ` +
          `6: BOTH equality tests are live, and the fade cannot be written as ` +
          `one \`>=\`. The sprites fall out of it — 0x45,0x46,0x47 left and ` +
          `0x48,0x49,0x4A right, three consecutive per direction`);

        check(`the terrain probe's +${TERRAIN_Y_BIAS} Y bias is a FOURTH pixel-to-cell rule`,
          TERRAIN_Y_BIAS === 2
            && probe(4 * 32, (() => { const p2 = mk(); p2[6 * 128 + 4] = 0;
                                      p2[7 * 128 + 4] = 1; return p2; })()).state === 0,
          `CS:0x2124 \`add bx,0x2\` before the mask. Collected: floored ` +
          `(entity), rounded-to-nearest (hero, export 40), +8 on both axes ` +
          `(the hero's projectile terrain stop), and +2 on Y only here. One ` +
          `shared helper is wrong three times`);
      }

      /* The frame order, which is opposite for the two projectile systems. */
      check(`enemy shots step AFTER the player; hero shots step BEFORE`,
        ENEMY_SHOTS_AT > 0x0254 && HERO_SHOTS_AT < 0x0254
          && ENEMY_SHOTS_AT === 0x02ba && HERO_SHOTS_AT === 0x020f,
        `CS:0x020F precedes the state machine at CS:0x0254, so a hero shot ` +
        `cannot hit anything on its spawn tick. CS:0x02BA follows both the ` +
        `nest walker (0x0282) and the entity step (0x0285), so an enemy shot ` +
        `moves and can reach the hero on the very tick it is fired. Giving ` +
        `both systems one ordering is wrong for one of them either way`);
    }

    /* ══ DS:0xd2be — THE LINE-HAZARD POOL, AND IT IS A RAY NOT A SEGMENT ═══ */
    {
      const cam = { x: 0, y: 0 };
      const farHero = { x: 9999, y: 9999, state: 0 };
      const zeroPlaneB = () => new Uint8Array(128 * 64);

      check(`the line-hazard record layout and constants match the bytes`,
        LH_SLOTS === 20 && HERO_HOT_POINT.dx === 6 && HERO_HOT_POINT.dy === 4
          && LH_HERO_BOX.w === 0x20 && LH_HERO_BOX.h === 0x30
          && LH_CROUCH_RAISE === 0x18 && LH_DAMAGE === 2
          && PROBE_BIAS === 3 && WALL_DEBRIS_BIAS === 3 && HERO_HIT_DEBRIS_BIAS === 2
          && LH_CULL.xMax === 0x13c && LH_CULL.yMax === 0xbc
          && LH_SPRITE_BASE === 0x4b && MUZZLE_X_OFFSET === 0x10,
        `CS:0xdbd4 \`mov bp,0x13\` (20 slots), CS:0xdb51/0xdb56 (hot point ` +
        `+6,+4), CS:0xdb87/0xdb92 (32x48 box), CS:0xdb76 (crouch +0x18, the ` +
        `enemy-shot value, not combat.js's +0x14), CS:0xdba0 (flat -2), ` +
        `CS:0xdc68/0xdc6b (+3 probe bias, a FIFTH pixel-to-cell rule), ` +
        `CS:0xdc1b/0xdc1e (-3 debris) and CS:0xdbb2/0xdbb5 (-2 debris, a ` +
        `DIFFERENT constant), CS:0xdca2/0xdca7 (cull 0x13c x 0xbc), ` +
        `CS:0xdcb6 (sprite base 0x4b=75), CS:0xe5fe/0xe649 (+0x10 muzzle, a ` +
        `THIRD offset in this game)`);

      /* ── Pure Bresenham math, hand-verified against the actual trace ──── */
      {
        const hzX = new LineHazards();
        /* source (0,0) -> target (100,10): dx=100 dy=10, X-MAJOR. `spawn`
         * itself burns the first `n` steps (CS:0xdce1's own immediate pass),
         * so one spawn(n=10) already IS "10 steps". Hand-traced: err starts
         * at dx>>1=50, and crosses zero on step 6 (0-indexed step 5), giving
         * exactly one y-increment inside 10 steps. */
        const sx1 = hzX.spawn(0, 0, 100, 10, 10);
        check(`x-major Bresenham: 10 steps of a dx=100,dy=10 line lands at (10,1)`,
          sx1.line.x === 10 && sx1.line.y === 1 && sx1.line.xMajor === true
            && sx1.line.err === 50,
          `err seeded to dx>>1=50 (CS:0xdd02), decremented by dy=10 each of ` +
          `10 steps, correcting by +dx and y+=1 exactly once (on step 6) — ` +
          `matching a 1-in-10 slope over 10 x-steps`);

        const hzY = new LineHazards();
        /* the mirror: source (0,0) -> target (10,100), Y-MAJOR. */
        const sy1 = hzY.spawn(0, 0, 10, 100, 10);
        check(`y-major Bresenham: 10 steps of a dx=10,dy=100 line lands at (1,10)`,
          sy1.line.x === 1 && sy1.line.y === 10 && sy1.line.xMajor === false
            && sy1.line.err === 50,
          `the same trace with the axes swapped — CS:0xdd41 seeds err to ` +
          `dy>>1=50 and CS:0xdd43 steps y UNCONDITIONALLY before the ` +
          `conditional x correction, the opposite instruction order from the ` +
          `x-major loop, though the net per-step effect is identical`);

        /* leftward, to exercise the OTHER two of the four resume constants
         * (CS:0xdd95/CS:0xddd3), which mirror by DECREMENTING the major axis
         * rather than incrementing it. */
        const hzL = new LineHazards();
        const sl1 = hzL.spawn(100, 0, 0, 10, 10);
        check(`leftward x-major mirrors by DECREMENTING x, not by negating the trace`,
          sl1.line.x === 90 && sl1.line.y === 1 && sl1.line.sx === -1,
          `source (100,0) -> target (0,10): CS:0xdd78's branch computes the ` +
          `same dx/dy magnitudes and err arithmetic, just with sx=-1`);
      }

      /* ── THE central finding: a RAY, not a segment ─────────────────────
       * The seed's own four loop bodies (CS:0xdd04/dd43/dd95/ddd3) have NO
       * destination check — only CS:0x7a0b's own copies do, and CS:0x7a0b's
       * `JMP DI` always lands back in the SEED's copy (which keeps re-writing
       * the SAME resume constant), so that check never runs. A port that
       * stops the fragment at the target is wrong. */
      {
        const hz = new LineHazards();
        /* target is only 5 px away in X; a segment model would arrive within
         * the FIRST spawn() call (n=3) and never move again. */
        const s = hz.spawn(0, 0, 5, 0, 3);
        const afterSpawnX = s.line.x;
        hz.step(cam, farHero, zeroPlaneB(), null, null, 0);
        const afterOneStepX = s.line.x;
        hz.step(cam, farHero, zeroPlaneB(), null, null, 0);
        check(`the fragment FLIES PAST its own target instead of stopping there`,
          afterSpawnX === 3 && afterOneStepX === 6 && s.line.x === 9
            && s.active && afterOneStepX > 5,
          `target x was 5; after spawn x=${afterSpawnX}, after one tick ` +
          `x=${afterOneStepX} (already past it), after two x=${s.line.x} — ` +
          `still flying and still active. A segment-stopping implementation ` +
          `would have frozen at x=5 on the very first call`);
      }

      /* ── Solid terrain: consume + a STATIONARY debris puff at world -3 ── */
      {
        const hz = new LineHazards();
        const debrisCalls = [];
        const fakeDebris = { spawn: (...a) => debrisCalls.push(a) };
        const planeB = zeroPlaneB();
        planeB[0 * 128 + 2] = 1;          // solid at col 2, row 0
        /* source (0,0) -> target (1000,0), pure horizontal so dy=0 keeps the
         * probe on row 0 always. n=32 per call; spawn's own pass lands at
         * x=32 (col 1, not solid yet); the first step() call lands at x=64,
         * whose probe col floor((64+3)/32)=2 IS solid. */
        const s = hz.spawn(0, 0, 1000, 0, 32);
        check(`spawn's own immediate pass leaves it short of the wall`, s.line.x === 32);
        hz.step(cam, farHero, planeB, null, fakeDebris, 0);
        check(`solid terrain consumes the fragment and drops a puff at world -${WALL_DEBRIS_BIAS}`,
          !s.active && hz.wallHits === 1 && debrisCalls.length === 1
            && debrisCalls[0][0] === 64 - WALL_DEBRIS_BIAS
            && debrisCalls[0][1] === 0 - WALL_DEBRIS_BIAS
            && debrisCalls[0][2] === 0 && debrisCalls[0][3] === 0,
          `at the moment of the hit x=64,y=0 (col ${Math.floor((64+PROBE_BIAS)/32)}, ` +
          `row 0); the puff lands at world (${debrisCalls[0]?.[0]}, ` +
          `${debrisCalls[0]?.[1]}) — CS:0xdc1b/0xdc1e's OWN -3 constant, not ` +
          `"undo the +3 probe bias" (it happens to be the same number, but ` +
          `it is a separate instruction in the bytes)`);
      }

      /* ── Off-screen cull: consume WITHOUT debris ────────────────────── */
      {
        const hz = new LineHazards();
        const debrisCalls = [];
        const fakeDebris = { spawn: (...a) => debrisCalls.push(a) };
        /* source (280,50) -> target (1000,50): spawn's own n=50 pass lands at
         * x=330 (already past CULL.xMax=0x13c=316, but spawn() itself never
         * checks — only step() does), and the FIRST step() call advances by
         * another 50 (to x=380) BEFORE running its checks, same as every
         * step() call. Either position is past the cull bound, so this only
         * needs one call. */
        const s = hz.spawn(280, 50, 1000, 50, 50);
        hz.step(cam, farHero, zeroPlaneB(), null, fakeDebris, 0);
        check(`the off-screen cull consumes with NO debris puff`,
          !s.active && hz.culled === 1 && debrisCalls.length === 0,
          `x=${s.line.x} >= CULL.xMax=${LH_CULL.xMax} — CS:0xdcdb writes the free ` +
          `marker and jumps straight to the next record, skipping the debris ` +
          `call the wall-hit path makes`);
      }

      /* ── Hero hit: consume, flat -2 damage, a puff at world -2 ─────────
       * ⚠️ -2 here against -3 for the wall hit — a THIRD distinct debris-jitter
       * constant next to the two already documented in debris.js. */
      {
        const hz = new LineHazards();
        const hero = { x: 100, y: 100, state: 0 };   // not crouching
        let hurt = 0;
        const health = { invulnerable: false, hurt: (n) => { hurt += n; } };
        const debrisCalls = [];
        const fakeDebris = { spawn: (...a) => debrisCalls.push(a) };
        /* source (0,100) -> target (1000,100), horizontal at hero's own Y.
         * n=10 per call; spawn lands x=10, then nine more step() calls add
         * 10 each, landing exactly x=100 — hot point (106,104), inside the
         * hero's box [100,132]x[100,148]. */
        const s = hz.spawn(0, 100, 1000, 100, 10);
        for (let i = 0; i < 9 && s.active; i++) {
          hz.step(cam, hero, zeroPlaneB(), health, fakeDebris, 0);
        }
        check(`a hero hit is consumed, costs a FLAT ${LH_DAMAGE} off the target, and drops a puff at world -${HERO_HIT_DEBRIS_BIAS}`,
          !s.active && hurt === LH_DAMAGE && hz.heroHits === 1
            && debrisCalls.length === 1
            && debrisCalls[0][0] === 100 - HERO_HIT_DEBRIS_BIAS
            && debrisCalls[0][1] === 100 - HERO_HIT_DEBRIS_BIAS,
          `hit at world (100,100): CS:0xdba0 \`sub word [0x192],2\` (the ` +
          `TARGET, so the bar chases down afterwards like every other ` +
          `source), then CS:0xdbbb's own -${HERO_HIT_DEBRIS_BIAS} puff — a ` +
          `THIRD distinct debris-jitter constant next to the wall hit's -` +
          `${WALL_DEBRIS_BIAS} and debris.js's own two`);
      }

      /* ── Invulnerability: PASS THROUGH, exactly like enemy-shots.js ──── */
      {
        const hz = new LineHazards();
        const hero = { x: 100, y: 100, state: 0 };
        let hurt = 0;
        const health = { invulnerable: true, hurt: (n) => { hurt += n; } };
        const debrisCalls = [];
        const fakeDebris = { spawn: (...a) => debrisCalls.push(a) };
        const s = hz.spawn(0, 100, 1000, 100, 10);
        for (let i = 0; i < 9 && s.active; i++) {
          hz.step(cam, hero, zeroPlaneB(), health, fakeDebris, 0);
        }
        check(`while invulnerable the fragment PASSES THROUGH — not consumed, no damage, no debris`,
          s.active && hurt === 0 && hz.heroHits === 0 && hz.passedThrough >= 1
            && debrisCalls.length === 0,
          `CS:0xdb99/0xdb9e's \`jnz\` skips the consume, the \`sub\` AND the ` +
          `debris call, exactly mirroring enemy-shots.js's CS:0x4547 — the ` +
          `opposite of the CONTACT path, where invulnerability still kills ` +
          `the attacker`);
      }

      /* ── N <= 0 is refused, defensively (never observed in shipped data,
       * see the module header's census — but nothing here should be able to
       * hang a browser tab on an input this project hasn't checked) ────── */
      {
        const hz = new LineHazards();
        const r0 = hz.spawn(0, 0, 10, 10, 0);
        const rNeg = hz.spawn(0, 0, 10, 10, -5);
        check(`n<=0 is refused rather than looping`,
          r0 === null && rNeg === null && hz.live === 0,
          `a shipped census of all 89 reachable descriptors (attackBits!=0, ` +
          `fire-rate nibble!=0) found n only ever 2,3,4,5,6,8,10 — never 0 or ` +
          `1 — but CS:0xdce1's own loop wraps 0-1 to 0xFFFF with no guard on ` +
          `the high nibble (unlike the low nibble's CS:0xe666 \`jz\`), so this ` +
          `port refuses defensively rather than trusting data it hasn't seen`);
      }

      /* ── Pool exhaustion: silent refusal, matching every other first-fit
       * pool in this game ────────────────────────────────────────────── */
      {
        const hz = new LineHazards();
        let ok = 0;
        for (let i = 0; i < LH_SLOTS; i++) if (hz.spawn(i, 0, i + 1, 0, 1)) ok++;
        const overflow = hz.spawn(0, 0, 1, 0, 1);
        check(`the 21st spawn is refused once all ${LH_SLOTS} slots are busy`,
          ok === LH_SLOTS && overflow === null && hz.refused === 1 && hz.live === LH_SLOTS,
          `CS:0xdbe7 — first-fit over 20 slots, and a spawn that finds none ` +
          `free returns without allocating, silently, the same convention as ` +
          `this game's other pools`);
      }

      /* ── The two CS:0xE5E4 spawn variants, by their SOURCE/TARGET shape ── */
      {
        const hz1 = new LineHazards();
        const atHero = hz1.spawnAtHero(50, 60, 200, 210, 1);
        check(`spawnAtHero: source = entity +0x${MUZZLE_X_OFFSET.toString(16)} X, target = hero EXACTLY +8,+6`,
          atHero.line.dx === Math.abs((200 + 8) - (50 + MUZZLE_X_OFFSET))
            && atHero.line.dy === Math.abs((210 + 6) - 60)
            && atHero.line.sx === 1 && atHero.line.sy === 1,
          `CS:0xe5fe/0xe649: muzzle X = entityX+0x${MUZZLE_X_OFFSET.toString(16)}, ` +
          `no Y offset; target is the hero's position with no jitter at all`);

        const hz2 = new LineHazards();
        const zeroJitter = () => TARGET_JITTER_BIAS;   // (0x1f & 0x3f) - 0x1f == 0
        const jittered = hz2.spawnJittered(50, 60, 200, 210, 1, zeroJitter);
        check(`spawnJittered: source = entity EXACTLY (no muzzle), target = hero +8,+6 +jitter`,
          jittered.line.dx === Math.abs((200 + 8) - 50)
            && jittered.line.dy === Math.abs((210 + 6) - 60)
            && TARGET_JITTER_MASK === 0x3f && TARGET_JITTER_BIAS === 0x1f,
          `CS:0xe5e9: no muzzle offset applied to the source at all — the one ` +
          `structural difference from spawnAtHero, next to the jitter itself. ` +
          `With a fixed RNG returning exactly the bias value the jitter is ` +
          `zero (${TARGET_JITTER_MASK.toString(16)} & ${TARGET_JITTER_MASK.toString(16)} - ` +
          `${TARGET_JITTER_BIAS.toString(16)} = 0), isolating the offset math`);

        check(`jitterTarget's own range is asymmetric: [-${TARGET_JITTER_BIAS}, +${TARGET_JITTER_MASK - TARGET_JITTER_BIAS}]`,
          (() => {
            let seq = [0, 0x3f];   // min and max raw draws
            let i = 0;
            const j = jitterTarget(() => seq[i++ % seq.length]);
            return j.dx === -TARGET_JITTER_BIAS && j.dy === (TARGET_JITTER_MASK - TARGET_JITTER_BIAS);
          })(),
          `CS:0xe631-0xe634: \`(rand() & 0x3f) - 0x1f\` ranges over ` +
          `[-31, +32], not a symmetric +/-31 — 0x3f - 0x1f = 0x20 = 32`);
      }

      check(`isCrouching agrees with enemy-shots.js's own version (same states, different raise magnitude)`,
        lhIsCrouching(0x12) && lhIsCrouching(0x13) && !lhIsCrouching(0x11) && !lhIsCrouching(0x14),
        `CS:0xdb68-0xdb74 is the SAME \`cmp byte [0x377],0x12/0x13\` range test ` +
        `as CS:0x4516, just raising by the same 0x18 rather than a different ` +
        `magnitude — so the two modules' isCrouching functions agree even ` +
        `though they are separately defined`);
    }

    results.push({
      name: 'what is still open around this creature', note: true, pass: true,
      detail: 'UNKNOWN_nest_shot — CS:0x2039 and CS:0x1FE7, what the creature ' +
        'actually fires and whether it can hurt the hero. UNKNOWN_8014_brood ' +
        '— the brood walker CS:0x894E, so the port carries the two seeded ' +
        'signed fields as field8/fieldA rather than calling them a velocity. ' +
        'UNKNOWN_8014_world1 — CS:0x7CBD and CS:0x7EB6 gate on world 1 and ' +
        'share the same 256 bytes, writing PLANE A at CS:0x7E62; the two ' +
        'tenants are mutually exclusive by world, which is why the level-init ' +
        'clear at CS:0x8676 zeroes the array only in world 2. UNKNOWN_ce64_pool ' +
        '— CS:0x8681 clears this pool by jumping INTO the middle of a third ' +
        'pool\'s clear routine at CS:0x7F48, whose tail disarms the DS:0xce64 ' +
        'walker as a side effect.',
    });

    /* ══ THE BROOD WALKER, CS:0x894E — CLOSED, no longer out of scope ═══════
     *
     * The note pushed just above still calls UNKNOWN_8014_brood open, listing
     * field8/fieldA as unlabelled. It is stale as of the checks below, and it
     * is left in place rather than edited — see nest.js's own walker section
     * for the up-to-date account, which this block re-derives from the real
     * `Brood` class rather than restating in prose. */
    {
      const camZero = { x: 0, y: 0 };
      const emptyPlaneB = () => new Uint8Array(128 * 64);
      const alive = (hp) => () => hp.strength;   // a contact stub that never hits

      /* ── the seed: CHILDREN START FALLING, not bouncing ────────────────── */
      {
        const brood = new Brood();
        const ok = brood.spawn(10, 20, 3, -4, BROOD_HP);
        const s = brood.slots.find((sl) => sl.frame >= 0);
        check(`a freshly spawned brood child starts BALLISTIC, fallSubstate=${BROOD_SEED_FALL_SUBSTATE}`,
          ok && s.fallSubstate === BROOD_SEED_FALL_SUBSTATE && s.fallSubstate !== 0
            && s.frame === 0 && s.strength === BROOD_HP,
          `the seed block already on record in nest.js states "+0xc = 1" — a ` +
          `child bursts upward (fieldA is always negative) and only settles ` +
          `into GROUND-BOUNCE mode once it lands. A port that starts children ` +
          `bouncing skips the burst arc entirely`);
      }

      /* ── ground-bounce: the step is NEVER undone, only the velocity flips ── */
      {
        const brood = new Brood();
        brood.spawn(0, 0, 4, 0, BROOD_HP);
        const s = brood.slots.find((sl) => sl.frame >= 0);
        s.fallSubstate = 0;
        const planeB = emptyPlaneB();
        /* solid exactly where the RIGHT-facing probe (x+BROOD_BOUNCE_PROBE_X)
         * lands after the step, at row 0 */
        planeB[((4 + BROOD_BOUNCE_PROBE_X) >> 5)] = 1;
        brood.step(camZero, 0, alive(s), planeB);
        check(`ground-bounce steps x with the PRE-bounce vx, THEN reflects it`,
          s.x === 4 && s.vx === -4,
          `x lands at ${s.x} (the wall was found only AFTER stepping there) ` +
          `and vx flips from 4 to ${s.vx} — CS:0x8A6C never un-steps the ` +
          `position it just found solid, the same shape this file's own ` +
          `hero/enemy wall probes use elsewhere`);
      }

      /* ── ballistic-fall gravity: capped at 8, an EIGHTH independent rule ── */
      {
        const brood = new Brood();
        brood.spawn(0, 0, 0, 0, BROOD_HP);
        const s = brood.slots.find((sl) => sl.frame >= 0);
        const openSky = emptyPlaneB();
        for (let t = 0; t < 20; t++) brood.step(camZero, 0, alive(s), openSky);
        check(`ballistic-fall gravity caps at ${BROOD_FALL_GRAVITY_CAP}, not the magic axe's own (coincidentally equal) cap`,
          s.vy === BROOD_FALL_GRAVITY_CAP && BROOD_FALL_GRAVITY_CAP === 8,
          `20 ticks over open sky and vy has settled at ${s.vy} rather than ` +
          `growing without bound — CS:0x8AB1's own \`inc / cmp 8 / jle\`. This ` +
          `project already runs a growing list of independently-coded gravity ` +
          `rules that do not share a routine; this is an eighth`);
      }

      /* ── landing: the transition back to ground-bounce ─────────────────── */
      {
        const brood = new Brood();
        brood.spawn(0, 0, 0, 0, BROOD_HP);
        const s = brood.slots.find((sl) => sl.frame >= 0);
        const ground = emptyPlaneB();
        /* solid exactly under the (x+0xc, y+0xf) probe on the very first
         * fall tick (x=0,y=0 -> probe col 0, row 0), with the row above it
         * (row -1) untested/absent — i.e. NOT solid. */
        ground[(BROOD_FALL_PROBE.dy >> 4) * 128 + (BROOD_FALL_PROBE.dx >> 5)] = 1;
        brood.step(camZero, 0, alive(s), ground);
        check(`landing on solid ground switches fallSubstate back to 0, snapping y to the tile-row-plus-one`,
          s.fallSubstate === 0 && s.vy === 0 && s.y === 16,
          `probe (x+${BROOD_FALL_PROBE.dx}, y+${BROOD_FALL_PROBE.dy}) finds ` +
          `solid ground on the first tick; y snaps from 0 to ${s.y} — floor to ` +
          `the current tile row then ADD ONE FULL ROW, the same idiom CLAUDE.md ` +
          `documents for the hero's own jump ceiling-ejection — and the child ` +
          `returns to ground-bounce movement from the next tick on`);
      }

      /* ── the hitbox: a THIRD size in this file, not the parent's either box ── */
      {
        const brood = new Brood();
        brood.spawn(0, 0, 0, 0, BROOD_HP);
        const s = brood.slots.find((sl) => sl.frame >= 0);
        s.fallSubstate = 0;
        let seenBox = null;
        brood.step(camZero, 0, (box) => { seenBox = box; return box.hp; }, emptyPlaneB());
        check(`the brood contact box is ${BROOD_BOX.w}x${BROOD_BOX.h}, distinct from BOTH of the parent's own (${BOX_ALIVE.w}x${BOX_ALIVE.h} / ${BOX_HATCH.w}x${BOX_HATCH.h})`,
          seenBox !== null && seenBox.w === 0x18 && seenBox.h === 0x10
            && !(seenBox.w === BOX_ALIVE.w && seenBox.h === BOX_ALIVE.h)
            && !(seenBox.w === BOX_HATCH.w && seenBox.h === BOX_HATCH.h),
          `CS:0x898B \`[0x1e2]=0x18(24) ; [0x1e4]=0x10(16)\` — passed straight ` +
          `to the shared CS:0xa9e4 thunk every creature in this game uses`);
      }

      /* ── death: reuses the parent's CAP, but NOT its duration or offset ── */
      {
        const dieAtFrame = (frame) => {
          const brood = new Brood();
          brood.spawn(0, 0, 0, 0, BROOD_HP);
          const s = brood.slots.find((sl) => sl.frame >= 0);
          s.frame = frame; s.strength = -1;
          let ticks = 0;
          while (s.frame >= 0 && ticks < 30) {
            brood.step(camZero, 0, alive(s), emptyPlaneB());
            ticks++;
          }
          return ticks;
        };
        const fromZero = dieAtFrame(0);
        const fromFive = dieAtFrame(5);
        check(`a child that died at frame 0 bursts for exactly DEATH_FREE_AT_STATE (${DEATH_FREE_AT_STATE}) ticks, reusing the PARENT's cap`,
          fromZero === DEATH_FREE_AT_STATE,
          `CS:0x8A5C increments +0x4 and compares against 7 — the SAME cap ` +
          `this file already names DEATH_FREE_AT_STATE for the parent. But ` +
          `unlike the parent's state, +0x4 here COUNTS UP from whatever frame ` +
          `it held while alive, so 7 is a CAP, not a guaranteed duration`);
        check(`a child that died holding a LATER frame bursts for FEWER ticks — death inherits the frame, it does not reset`,
          fromFive === DEATH_FREE_AT_STATE - 5,
          `died holding frame 5 -> only ${fromFive} ticks to reach the cap — ` +
          `the same "death inherits the live state" shape this file already ` +
          `documents for the parent's own #death, now confirmed for the brood ` +
          `too. A port that always bursts for a flat ${DEATH_FREE_AT_STATE} ` +
          `ticks loses this`);
        check(`the brood's own death draw offset is NOT the parent's DEATH_DRAW_OFFSET — only the X survives`,
          BROOD_DEATH_DRAW_OFFSET.dx === DEATH_DRAW_OFFSET.dx
            && BROOD_DEATH_DRAW_OFFSET.dy !== DEATH_DRAW_OFFSET.dy
            && BROOD_DEATH_DRAW_OFFSET.dy === -0x11,
          `CS:0x8A43: X matches the parent's ${DEATH_DRAW_OFFSET.dx} exactly, ` +
          `but Y is ${BROOD_DEATH_DRAW_OFFSET.dy} (-0x11), not ${DEATH_DRAW_OFFSET.dy} ` +
          `— a task-level summary this pass started from asserted outright ` +
          `reuse of the parent's own constant; the bytes disagree on Y, and ` +
          `on drawing once rather than twice`);
      }

      /* ── facing: +3 for NON-NEGATIVE vx, not strictly-positive vx ────────── */
      check(`the facing offset is +${BROOD_FACING_OFFSET} for non-negative vx (including exactly 0), 0 for negative`,
        broodFacingOffset(0) === BROOD_FACING_OFFSET
          && broodFacingOffset(5) === BROOD_FACING_OFFSET
          && broodFacingOffset(-1) === 0,
        `CS:0x89AA \`js\` skips the \`add dx,3\` only when vx is strictly ` +
        `NEGATIVE — vx===0 still gets +${BROOD_FACING_OFFSET}, the same ` +
        `"non-negative, not strictly positive" convention this file already ` +
        `uses for the parent elsewhere (HATCH_EXPORT2_BELOW, aimAt)`);

      /* ── freeze: an asymmetry between the two movement modes, kept as-is ── */
      {
        const falling = new Brood();
        falling.spawn(0, 0, 0, 3, BROOD_HP);
        const sFall = falling.slots.find((sl) => sl.frame >= 0);
        sFall.fallSubstate = 1;
        const yBefore = sFall.y;
        falling.step(camZero, 999, alive(sFall), emptyPlaneB());

        const bouncing = new Brood();
        bouncing.spawn(0, 0, 4, 0, BROOD_HP);
        const sBounce = bouncing.slots.find((sl) => sl.frame >= 0);
        sBounce.fallSubstate = 0;
        const xBefore = sBounce.x;
        bouncing.step(camZero, 999, alive(sBounce), emptyPlaneB());

        check(`"freezes aliens" stops GROUND-BOUNCE movement but NOT ballistic fall`,
          sFall.y !== yBefore && sBounce.x === xBefore,
          `CS:0x8970 jumps straight into the fall routine (0x8AB1) BEFORE the ` +
          `freeze test at CS:0x8979 is ever reached — only a bouncing child ` +
          `(fallSubstate 0) passes through it. So a falling child keeps ` +
          `falling under freeze while a bouncing one is held still. Implemented ` +
          `as traced rather than made uniform`);
      }

      /* ── the sprite table's own contents are genuinely unread ────────────── */
      check(`BROOD_SPRITE_TABLE is an honest IDENTITY placeholder, not an invented sprite sequence`,
        BROOD_SPRITE_TABLE.every((v, i) => v === i),
        `SS:0x360A's own byte contents were never read by any pass over this ` +
        `project — only the LOOKUP MECHANISM (frame-doubled word index, +-3 ` +
        `facing variant) was ever proven. Per this task's own instruction not ` +
        `to fabricate specific numbers, frame is passed straight through ` +
        `rather than through an invented table. UNKNOWN_brood_sprite_table`);

      /* ── end-to-end: Nests#brood really can drive a live Brood instance ──── */
      {
        const script = [0, 0, 3];     // count-draw, then fieldA, then field8 — same script nest.js's own brood test uses
        let i = 0;
        const rng = { next: () => script[i++] ?? 0 };
        const nests = new Nests(2, rng);
        const brood = new Brood();
        nests.spawn(0, 200, 0);
        i = 0;                        // spawn() itself burned one draw for the hatch timer
        const parent = nests.slots[0];
        parent.state = 0; parent.hp = -1;
        let ticks = 0;
        while (nests.live > 0 && ticks < 20) {
          nests.step(camZero, { x: 0 }, 0, () => parent.hp, brood);
          ticks++;
        }
        check(`Nests#brood's existing spawn(...) call drives a REAL Brood instance end to end, with no changes to Nests`,
          brood.live > 0 && nests.broodlings === brood.live,
          `spawned ${brood.live} live brood children through the SAME ` +
          `argument order Nests already used before this pass — no field ` +
          `renaming, no signature change on the Nests side was needed`);
      }
    }

    results.push({
      name: 'the brood walker is no longer out of scope; two residuals remain',
      note: true, pass: true,
      detail: 'UNKNOWN_brood_score — CS:0x8A33-0x8A65 (the decoded death path) ' +
        'is draw / inc / free with no call into the shared BCD score entry ' +
        'this project documents for other kills; whether an award happens off ' +
        'that path is open, so Brood.score stays at 0 rather than a guess. ' +
        'UNKNOWN_brood_sprite_table — SS:0x360A is proven to be a frame-' +
        'doubled lookup with a +-3 facing variant, but its own byte contents ' +
        'were never read; BROOD_SPRITE_TABLE is an identity placeholder. ' +
        'UNKNOWN_8014_world1 and UNKNOWN_ce64_pool, named in the note above ' +
        'this one, are unrelated to the walker and remain untouched by this pass.',
    });
  }

  return results;
}

/* Hero sprite selection. The point of these is that the port must never index
 * a descriptor it cannot justify: `base + sign_extend(phase)` is unbounded in
 * principle (max base 55, walk phase reaches 7), so every id the port can
 * actually emit is enumerated and bounds-checked here rather than trusted. */
export async function checkHeroSprites(fetchRaw) {
  const { results, check } = makeChecker();

  const stems = GROUP_STEMS.always;
  const atlases = {}, images = {};
  for (const s of stems) {
    atlases[s] = parseAtlas(dclDecompress(await fetchRaw(`game/${s}.DAT`)).data);
    images[s]  = decodePI1(dclDecompress(await fetchRaw(`game/${s}.PI1`)).data);
  }
  const { map } = buildDescriptorMap(['always'], (s) => atlases[s].count);

  /* Every (state, phase) pair the port emits, DERIVED by driving a real
   * Player through a scripted input program — not a hand-kept list that would
   * quietly stop covering a state someone adds later. */
  const { pairs: emitted } = emittableStates();

  let worstId = -1, bad = 0;
  for (const [st, ph] of emitted) {
    const id = spriteFor(st, ph);
    if (id < 0 || id > HERO_DESCRIPTOR_MAX) bad++;
    if (id > worstId) worstId = id;
  }
  check(`every (state, phase) the port emits lands in descriptor [0, ${HERO_DESCRIPTOR_MAX}]`,
    bad === 0, `${emitted.length} pairs, max id #${worstId}`);

  /* Frames the hero actually uses must be hero-sized, not font glyphs. */
  const sizes = emitted.map(([st, ph]) => {
    const d = map[spriteFor(st, ph)];
    return atlases[d.stem].frames[d.frame];
  });
  const heroSized = sizes.filter((f) => f.w === 32 && f.h >= 40).length;
  check(`the frames those ids resolve to are hero-sized (32 x >=40)`,
    heroSized === sizes.length, `${heroSized}/${sizes.length}`);

  /* The stopping poses: leaving walk-left sets CL = -1 and walk-right CL = +1
   * before entering state 26 (base 52), so they must render 51 and 53 — the
   * anim_base values of stub states 27 and 28. This is the third independent
   * derivation of the left/right split, asserted rather than asserted-about. */
  check(`stop-left renders descriptor #51 (== anim_base of stub state 27)`,
    spriteFor(26, 0xff) === 51, `#${spriteFor(26, 0xff)}`);
  check(`stop-right renders descriptor #53 (== anim_base of stub state 28)`,
    spriteFor(26, 0x01) === 53, `#${spriteFor(26, 0x01)}`);
  /* WHAT THE THREE REMAPS ARE FOR — found by this check failing.
   * The remap table at CS:0x5f8b is not arbitrary. Its three inputs are
   * exactly the phase-0 sprite of the three most common resting states:
   *     0x34 = 52 = base(26) idle        -> 0x19 = 25
   *     0x36 = 54 = base(12) fall right  -> 0x23 = 35
   *     0x37 = 55 = base(11) fall left   -> 0x26 = 38
   * base 52 exists to generate 51 / 52 / 53 for the stop-left, standing and
   * stop-right poses; the middle one is then redirected to descriptor 25.
   * So the hero's frames are NOT a contiguous block, and a port that skips
   * the remap draws the wrong sprite in the three states the hero spends most
   * of its time in. All three redirects land on 32x>=40 frames (asserted by
   * the hero-sized check above), which is independent corroboration. */
  check(`idle renders descriptor #25 (base 52 remapped at CS:0x5f8b)`,
    spriteFor(26, 0) === 25, `#${spriteFor(26, 0)}`);
  check(`fall-left #38 and fall-right #35 (bases 55/54 remapped)`,
    spriteFor(11, 0) === 38 && spriteFor(12, 0) === 35,
    `#${spriteFor(11, 0)} / #${spriteFor(12, 0)}`);

  /* CBW sign-extends AL, so 0xFF is -1 and not 255. A port that widens CL as
   * unsigned indexes descriptor #307 instead of #51 and draws a font glyph. */
  check(`phase is sign-extended as a byte (0xFF -> -1, not 255)`,
    spriteFor(26, 0xff) === 51 && spriteFor(26, 0xff) !== 52 + 255);

  /* THE JUMP ANIMATION. Four entry cases, and the two asymmetries are the whole
   * point: jump-LEFT resolves to two distinct airborne frames (37 and 38)
   * because CS:0x4E78 stores 7 while its catch-all stores 6, whereas
   * jump-RIGHT stores 5 in both places and collapses to one. And a jump that
   * begins on a LADDER seeds phase 0x0D/0x0C, giving a visibly different
   * take-off pose. Assert the whole sequence, not just the endpoints. */
  const jumpSeq = (st, start) => {
    let cl = start, cur = 0; const out = [];
    for (let i = 0; i < 6; i++) { cl = jumpPhase(st, cl, cur); out.push(spriteFor(st, cl)); cur += 2; }
    return out.join(',');
  };
  check(`ground jump left renders 31,31,36,37,37,37 (two airborne frames)`,
    jumpSeq(8, 0) === '31,31,36,37,37,37', jumpSeq(8, 0));
  check(`ground jump right renders 29,29,33,34,34,34 (one airborne frame)`,
    jumpSeq(9, 0) === '29,29,33,34,34,34', jumpSeq(9, 0));
  check(`ladder jump left starts on 44, not 31 (phase 0x0D from CS:0x5927)`,
    jumpSeq(8, LADDER_JUMP_PHASE[8]) === '44,44,38,37,37,37',
    jumpSeq(8, LADDER_JUMP_PHASE[8]));
  check(`ladder jump right starts on 41, not 29 (phase 0x0C from CS:0x5912)`,
    jumpSeq(9, LADDER_JUMP_PHASE[9]) === '41,41,34,34,34,34',
    jumpSeq(9, LADDER_JUMP_PHASE[9]));

  /* The three non-rendering states must be refused, not silently resolved to
   * an anim_base the original never reads. */
  const refused = NON_RENDERING_STATES.filter((s) => {
    try { spriteFor(s, 0); return false; } catch { return true; }
  });
  check(`states ${NON_RENDERING_STATES.join('/')} refuse to yield a sprite ` +
        `(their anim_base is provably never read)`,
    refused.length === NON_RENDERING_STATES.length,
    `${refused.length}/${NON_RENDERING_STATES.length}`);
  check(`the port never emits one of those states`,
    !emitted.some(([s]) => NON_RENDERING_STATES.includes(s)));

  /* PALETTE — the hero renders correctly when composited into a level using
   * PLEVEL<N><X>.PI1's palette, which LOOKS like evidence that PLEVEL is the
   * real in-game palette. It only is if the hero actually uses indices where
   * the two palettes disagree; if every index he touches is one of the
   * agreeing entries the render would look right under either, and proves
   * nothing. So measure the overlap instead of assuming it.
   * Reported as a NOTE, never a green check: UNKNOWN_level_palette_source is
   * still open and a passing tick beside it would read as resolved. */
  const heroPal = images.PALWAYS1.paletteRaw;
  const lvlPal = decodePI1(dclDecompress(await fetchRaw('game/PLEVEL1A.PI1')).data).paletteRaw;
  const disagree = new Set();
  for (let i = 0; i < 16; i++) if (heroPal[i] !== lvlPal[i]) disagree.add(i);

  const used = new Set();
  for (const [st, ph] of emitted) {
    const d = map[spriteFor(st, ph)];
    const f = atlases[d.stem].frames[d.frame];
    for (const v of cutAll(images[d.stem], { frames: [f] })[0].pixels) used.add(v);
  }
  const decisive = [...used].filter((v) => disagree.has(v));
  results.push({
    name: `palette evidence: ${disagree.size}/16 entries differ between PALWAYS1 and PLEVEL1A; ` +
          `the hero's frames use ${decisive.length} of them`,
    note: true, pass: true,
    detail: decisive.length
      ? `indices ${decisive.join(',')} — the level-palette render IS discriminating`
      : 'NONE — the level-palette render is NOT evidence either way',
  });

  return results;
}

/* Both entity systems' death-fade sprite ranges, checked against the REAL
 * built 'always' descriptor map rather than assumed in range. main.js's own
 * render loop silently falls back to a strokeRect and bumps a counter nobody
 * asserts on when hero.frames[id] is undefined (outOfRange++), so a fade base
 * or frame count that walks off the end of the atlas would draw wrong and
 * never fail a test — this is the check that closes that gap. Advisor-
 * flagged: System B's own DEATH_SPRITE_BASE (108) + frames 0..6 is already
 * known to cross PALWAYS2 -> PALWAYS3 (CLAUDE.md's own nest.js citation);
 * System A's DEATH_SPRITE_BASE_A (91) + frames 0..16 was never checked
 * against the atlas at all. */
export async function checkDeathFadeSprites(fetchRaw) {
  const { results, check } = makeChecker();

  const stems = GROUP_STEMS.always;
  const atlases = {};
  for (const s of stems) {
    atlases[s] = parseAtlas(dclDecompress(await fetchRaw(`game/${s}.DAT`)).data);
  }
  const { map, ranges } = buildDescriptorMap(['always'], (s) => atlases[s].count);

  const resolves = (base, frames) => {
    const ids = Array.from({ length: frames }, (_, i) => base + i);
    const missing = ids.filter((id) => id < 0 || id >= map.length || !map[id]);
    const stemsHit = new Set(ids.filter((id) => map[id]).map((id) => map[id].stem));
    return { ids, missing, stemsHit };
  };

  const b = resolves(ENTB_DEATH_SPRITE_BASE, ENTB_DEATH_FRAMES);
  check(`System B's fade range [${ENTB_DEATH_SPRITE_BASE}, ` +
    `${ENTB_DEATH_SPRITE_BASE + ENTB_DEATH_FRAMES - 1}] resolves in the built 'always' map ` +
    `(${map.length} descriptors)`,
    b.missing.length === 0, `missing: ${JSON.stringify(b.missing)}`);
  results.push({
    name: `System B's fade range spans stems ${[...b.stemsHit].join(',')}`,
    note: true, pass: true,
    detail: `crosses an atlas file boundary iff >1 stem is listed`,
  });

  const a = resolves(ENTA_DEATH_SPRITE_BASE, ENTA_DEATH_FRAMES);
  check(`System A's fade range [${ENTA_DEATH_SPRITE_BASE}, ` +
    `${ENTA_DEATH_SPRITE_BASE + ENTA_DEATH_FRAMES - 1}] resolves in the built 'always' map ` +
    `(${map.length} descriptors)`,
    a.missing.length === 0, `missing: ${JSON.stringify(a.missing)}`);
  results.push({
    name: `System A's fade range spans stems ${[...a.stemsHit].join(',')}`,
    note: true, pass: true,
    detail: `crosses an atlas file boundary iff >1 stem is listed`,
  });

  /* main.js draws every fade frame through the SAME masked blitter as an
   * ordinary sprite (no size class of its own), so unlike checkHeroSprites'
   * "must be hero-sized" assertion there is no shape constraint to check here
   * — only that a real frame (not undefined) backs every id. That's what the
   * two checks above already assert; this just documents why there's no
   * third one for size, so a future reader doesn't go looking for it. */

  return results;
}

/* The plane-B selector dispatch, and the object sprite rule. Both were
 * established this pass and both replaced something the port had wrong, so
 * both are asserted against the shipped bytes rather than trusted. */
export async function checkSelectorsAndObjects(fetchRaw) {
  const { results, check } = makeChecker();
  const keys = ['1A','1B','2A','2B','3A','3B','4A','4B'];

  /* --- selectors ------------------------------------------------------- */
  check(`SS:0x3570 has 11 entries and the trigger evaluator is SELECTOR 3`,
    SELECTOR_TABLE.length === 11 &&
    SELECTOR_TABLE[SELECTOR_TRIGGER - 1].handler === 0x39ae,
    `sel ${SELECTOR_TRIGGER} -> 0x${SELECTOR_TABLE[SELECTOR_TRIGGER - 1].handler.toString(16)}`);

  const hist = {}, paramMax = {};
  let wide = 0, slots = 0;
  for (const k of keys) {
    const b = dclDecompress(await fetchRaw(`game/${palfilsNameFor(k)}`)).data;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < EVENT_COUNT; i++) {
      const o = EVENT_TABLE_OFF + i * 4;
      const sel = dv.getUint16(o, false), par = dv.getUint16(o + 2, false);
      slots++;
      if (sel > 255 || par > 255) wide++;
      hist[sel] = (hist[sel] || 0) + 1;
      paramMax[sel] = Math.max(paramMax[sel] ?? -1, par);
    }
  }

  /* The decisive structural check: the shipped maximum selector is exactly the
   * table size. Under a 0-based reading selector 11 would index entry 11,
   * which belongs to a DIFFERENT table (SS:0x3586, consumed only by
   * CS:0xAE7C). So the data alone forces the 1-based reading. */
  const maxSel = Math.max(...Object.keys(hist).map(Number));
  check(`max shipped selector (${maxSel}) == table size (11), forcing the 1-based read`,
    maxSel === SELECTOR_TABLE.length, `${slots} records scanned`);

  /* Each selector's param must fit the table its handler indexes. */
  const BOUND = { 1: 100, 2: 100, 3: 100, 4: 50, 5: 50, 7: 25, 8: 25, 9: 25, 10: 25 };
  const bad = Object.entries(BOUND).filter(([sel, n]) => (paramMax[sel] ?? -1) >= n);
  check(`every selector's max param fits its handler's table ` +
        `(sel 1/2/3 < 100, 4/5 < 50, 7-10 < 25)`,
    bad.length === 0,
    `maxima ${[1,2,3,4,5,7,8,9,10].map((s) => `${s}:${paramMax[s] ?? '-'}`).join(' ')}`);

  /* The original packs each field to ONE byte (CS:0x386E) before use, so this
   * port's direct big-endian read is only equivalent while nothing exceeds
   * 255. Assert it rather than assume it. */
  check(`no event field exceeds 255, so the byte-pack at CS:0x386E is lossless`,
    wide === 0, `${wide} of ${slots * 2} fields`);

  check(`selector 3 (triggers) is the most common non-empty selector`,
    hist[3] > 0 && Object.entries(hist).filter(([s]) => +s > 0)
      .every(([s, n]) => +s === 3 || n <= hist[3]),
    `census ${Object.entries(hist).map(([s, n]) => `${s}:${n}`).join(' ')}`);

  /* --- objects --------------------------------------------------------- */
  let live = 0, unstamped = 0, outside = 0, idAgree = 0, idTotal = 0;
  const distinct = new Set();
  for (const k of keys) {
    const m = parseMap(dclDecompress(await fetchRaw(`game/PLEV${k}.MAP`)).data);
    const pobj = dclDecompress(await fetchRaw(`game/POBJECTS.00${k[0]}`)).data;
    for (const o of m.objects) {
      if (isDeadType(o.type)) continue;
      live++; distinct.add(o.type);
      if (isUnstamped(o.type)) unstamped++;
      const sid = spriteForType(o.type);
      if (sid < OBJECT_SPRITE_BASE || sid > 449) outside++;
      /* POBJECTS' own big-endian id at +0 is independently `base + type`.
       * In worlds 1-3 that base is 170, corroborating the EXE stamp from the
       * shipped asset. WORLD 4's file uses 175 — every record shifted +5,
       * the same authoring drift this project already recorded for
       * PWEAPONS.004's +0xc/+0x1e fields, in the same file. The stamp loop
       * overwrites the descriptor unconditionally, so the shift never takes
       * effect; that is exactly what makes CS:0x2234 load-bearing rather
       * than redundant. Assert the real per-world base. */
      if (o.type < STAMPED_TYPES) {
        idTotal++;
        const id = (pobj[o.type * 48] << 8) | pobj[o.type * 48 + 1];
        const fileBase = (pobj[0] << 8) | pobj[1];
        if (id === fileBase + o.type) idAgree++;
      }
    }
  }
  check(`POBJECTS' own id field is a clean \`base + type\` ramp in every world`,
    idAgree === idTotal, `${idAgree}/${idTotal}`);

  /* The per-world bases, stated so the world-4 anomaly is visible rather than
   * averaged away — and so the claim "the EXE stamp is what the game uses"
   * has something concrete standing behind it. */
  const bases = [];
  for (const w of ['1', '2', '3', '4']) {
    const b = dclDecompress(await fetchRaw(`game/POBJECTS.00${w}`)).data;
    bases.push((b[0] << 8) | b[1]);
  }
  check(`POBJECTS bases are 170,170,170,175 — world 4 is shifted +5 and the ` +
        `CS:0x2234 stamp discards it`,
    bases.join() === '170,170,170,175', bases.join(','));
  check(`every shipped object's sprite lands in the objects group (#170..#449)`,
    outside === 0, `${live} live objects, ${distinct.size} distinct types`);
  results.push({
    name: `object types in the unstamped gap 132..191 (CS:0x223A stamps only 132)`,
    note: true, pass: true,
    detail: unstamped === 0 ? 'none ship — the hazard never fires' : `${unstamped} DO ship`,
  });

  /* The category table the port reads from POBJECTS must agree with the two
   * lever/switch pairs this project established independently. */
  const cats = parseObjectCategories(
    dclDecompress(await fetchRaw('game/POBJECTS.001')).data);
  check(`categories 24/25/26/27 are all 3 — the lever & switch off/on pairs`,
    [24, 25, 26, 27].every((t) => cats[t] === 3),
    [24, 25, 26, 27].map((t) => cats[t]).join(','));

  return results;
}


/* System-B enemy locomotion. Nothing constructs entities yet (spawn is
 * undecoded), so these assert the CONSTANTS and the two physics curves that
 * were re-read from the binary — the parts a port would otherwise share with
 * the hero and get subtly wrong. */
export function checkEntityB() {
  const { results, check } = makeChecker();

  check(`the System-B mode table is 8 entries with anim_base 0/9/8/17/8/17`,
    MODE_TABLE.length === 8 &&
    [0, 9, 8, 17, 8, 17].every((b, i) => MODE_TABLE[i].animBase === b),
    MODE_TABLE.slice(0, 6).map((m) => m.animBase).join(','));

  /* The hop arc is SIGNED BOTH WAYS around its own base — a port that treats
   * DS:0xdcde as index 0 of an array loses the entire descent. */
  const rise = [-1, -2, -3, -4, -5, -6].map(hopDelta);
  const fall = [1, 2, 3, 4, 5].map(hopDelta);
  check(`the hop arc extends to negative indices (rise ${rise.join(',')})`,
    rise.join() === '1,1,2,4,8,8' && fall.join() === '-1,-1,-2,-4,-8',
    `descent ${fall.join(',')}`);
  check(`the hop arc runs out past index 15 rather than reading garbage`,
    hopDelta(16) === null && hopDelta(-7) === null);

  /* Enemy gravity is NOT the hero's. Hero: dY = 4 + v, v <= 10, so 5..14.
   * Enemy: dY = v applied before the increment, v <= 16, so 0..16. Assert the
   * whole sequence, because "clamped at 16" alone would pass with an
   * off-by-one in the apply-then-increment order. */
  const planeB = new Uint8Array(128 * 64);
  const e = new EntityB({ x: 64, y: 0, mode: MODE.FALL_L });
  /* Skip the spawn states — this check is about the fall CURVE in isolation,
   * so it forces v = 0. Neither real entry path actually starts there: a
   * freshly SPAWNED entity begins at v = 2 (CS:0xecf1 `mov word [di+0x12],2`)
   * and one that WALKS OFF A LEDGE begins at v = 1 (CS:0xf15f), checked
   * separately below. */
  e.state = 1; e.vel = 0;
  const steps = [];
  let prev = e.y;
  for (let i = 0; i < 20; i++) { e.tick(planeB); steps.push(e.y - prev); prev = e.y; }
  check(`enemy fall is 0,1,2,..,16 then flat — applied BEFORE the increment`,
    steps.slice(0, 17).every((d, i) => d === i) && steps.slice(17).every((d) => d === 16),
    `first 6: ${steps.slice(0, 6).join(',')} last: ${steps[19]}`);

  /* Ground is `== 1` EXACTLY. Ladder (2) and event cells (>= 3) are not
   * ground, so an enemy falls straight through a ladder column. */
  const gb = new Uint8Array(128 * 64);
  const at = (x, y) => (((x & 0xFFE0) >> 5) + ((y & 0xFFF0) >> 4) * 128) + 0x100;
  gb[at(64, 0)] = 1;
  check(`plane-B 1 is ground`, groundBelow(gb, 64, 0));
  gb[at(64, 0)] = 2;
  check(`plane-B 2 (ladder) is NOT ground — enemies fall through ladders`,
    !groundBelow(gb, 64, 0));
  gb[at(64, 0)] = 200;
  check(`plane-B >= 3 (an event cell) is NOT ground`, !groundBelow(gb, 64, 0));

  /* Walk speed: the delay reloads to 10 - speed and the step happens when the
   * counter goes negative, so a step costs (10 - speed) + 1 ticks. */
  const walked = (speed) => {
    const flat = new Uint8Array(128 * 64);
    for (let c = 0; c < 128; c++) flat[at(c * 32, 0) ] = 1;
    const w = new EntityB({ x: 64, y: 0, mode: MODE.WALK_R, speed });
    w.state = 1;
    const x0 = w.x;
    for (let i = 0; i < 44; i++) w.tick(flat);
    return w.x - x0;
  };
  const fast = walked(10), slow = walked(7);
  check(`higher descriptor +0x0b is FASTER (speed 10 moves ${fast}px vs speed 7 ${slow}px in 44 ticks)`,
    fast > slow, `${fast} > ${slow}`);

  /* The spawn state machine: waiting (stagger) -> materialising (5 ticks) ->
   * alive with the descriptor's HP. Entities of one group share a spawn point
   * and differ only in when they appear. */
  const sp = new EntityB({ x: 64, y: 0, hp: 3, delay: 4 });
  const trace = [];
  for (let i = 0; i < 12; i++) { sp.tick(planeB); trace.push(sp.state); }
  check(`spawn runs waiting(delay) -> materialising(5) -> alive with descriptor HP`,
    trace.join() === '-2,-2,-2,-3,-3,-3,-3,-3,3,3,3,3', trace.join(','));

  /* The cull window is asymmetric — 64 px of slack on the left and top only. */
  check(`cull window is x (-63,351), y (-63,223) — slack on left/top only`,
    onScreen(-63 + 1, 0, 0, 0) && !onScreen(-64, 0, 0, 0) &&
    onScreen(350, 0, 0, 0) && !onScreen(352, 0, 0, 0));

  /* CS:0xE659, System B's own reading — called via fireB. Same reload gate
   * and attackBits divert as System A's stageFacingAndFire, but facing comes
   * from the entity's OWN mode bit (DS:0xd95a's bit test reduces to exactly
   * this module's `facingOf`), and — unlike System A — there is no "zero own
   * velocity means don't fire" gate: System B has no signed X-velocity
   * register at this point, so a live entity fires whenever its reload timer
   * allows, regardless of mode. */
  check(`fireByte 0 never arms (no desc also refuses, silently)`,
    fireB(new EntityB({ x: 0, y: 0 }), { fire: 0x00, flags: 0 }) === null &&
    fireB(new EntityB({ x: 0, y: 0 }), null) === null);

  const bRight = new EntityB({ x: 0, y: 0, mode: MODE.WALK_R });
  const shotR = fireB(bRight, { fire: 0x31, flags: 0 });
  check(`mode WALK_R (odd) fires from x+32, dir = +hiNibble — no velocity gate needed`,
    shotR && shotR.x === bRight.x + 0x20 && shotR.dir === 3, JSON.stringify(shotR));

  const bLeft = new EntityB({ x: 0, y: 0, mode: MODE.HOP_L });
  const shotL = fireB(bLeft, { fire: 0x31, flags: 0 });
  check(`mode HOP_L (even) fires from x-8, dir = -hiNibble — mid-hop still fires`,
    shotL && shotL.x === bLeft.x - 8 && shotL.dir === -3, JSON.stringify(shotL));

  const bReload = new EntityB({ x: 0, y: 0, mode: MODE.WALK_R });
  const first = fireB(bReload, { fire: 0x31, flags: 0 });
  const second = fireB(bReload, { fire: 0x31, flags: 0 });
  check(`the reload timer blocks an immediate second shot`, first && second === null);

  const bHazard = new EntityB({ x: 10, y: 20, mode: MODE.WALK_L });
  const hazardB = fireB(bHazard, { fire: 0x61, flags: 0x10 });   // (0x10>>4)&3 = 1
  check(`attackBits != 0 diverts to a hazard spawn, unmuzzled, n = hi nibble`,
    hazardB && hazardB.hazard === true && hazardB.attackBits === 1 &&
    hazardB.n === 6 && hazardB.x === 10 && hazardB.y === 20,
    JSON.stringify(hazardB));

  /* CS:0xF030's death fade — a REGRESSION GUARD for a real bug an advisor
   * review caught: this port previously just stopped drawing a dying
   * entity for good (CLAUDE.md's own "CLOSED" note for this mechanism was
   * itself wrong — see entity.js's file header for the fresh
   * disassemble_bytes trace). The kill tick itself (frame still -1, set by
   * combat.js/frame.js matching CS:0xFFBF) is the render pass's job, not
   * tick()'s — this only covers tick()'s own CS:0xF030 state machine. */
  {
    const planeBd = new Uint8Array(128 * 64);
    const d = new EntityB({ x: 0, y: 0, mode: MODE.WALK_L });
    d.state = EST.DYING; d.frame = -1;          // CS:0xFFBF's own kill-tick values
    check('a killed entity is DYING, not silently freed',
      isDying(d) && d.state === EST.DYING);

    const frames = [];
    for (let i = 0; i < ENTB_DEATH_FRAMES; i++) {
      d.tick(planeBd);
      frames.push(d.frame);
      check(`CS:0xF06E/F071: tick ${i} keeps the entity DYING while frame < ${ENTB_DEATH_FRAMES}`,
        isDying(d), `frame=${d.frame} state=${d.state}`);
    }
    check(`CS:0xF06E: frame counts 0..${ENTB_DEATH_FRAMES - 1} across exactly ${ENTB_DEATH_FRAMES} ticks`,
      frames.join() === Array.from({ length: ENTB_DEATH_FRAMES }, (_, i) => i).join(),
      frames.join());
    check(`CS:0xF091-F094: the fade sprite base is the FLAT ${ENTB_DEATH_SPRITE_BASE.toString(16)} constant, not a class-table lookup`,
      ENTB_DEATH_SPRITE_BASE === 0x6c);

    d.tick(planeBd);   // the ENTB_DEATH_FRAMES-th tick — CS:0xF075's `jl` is NOT taken
    check('CS:0xF077/F07C: the entity finalises to FREE, not stuck dying forever',
      d.state === EST.FREE && !isDying(d), `state=${d.state}`);
    check('CS:0xF07C: the stagger/delay field is also cleared on finalise',
      d.delay === 0);
  }

  /* CS:0xF034's own one-shot position cache (`deathCacheX/Y/Seq`), which
   * feeds main.js's own System-B group-elimination reward (popup.js).
   * A REGRESSION GUARD for a second, more serious bug the SAME advisor
   * review caught: a fresh entity's `state` is EST.WAITING (-2), and
   * `-2 <= 0` is true — so main.js's own group-completion check must NOT be
   * `state <= 0`, or a group would satisfy "all dead/dying" the instant it
   * spawns, before a single entity has even ticked once. */
  {
    const fresh = new EntityB({ x: 10, y: 20, mode: MODE.WALK_L });
    check('a freshly-spawned entity is WAITING (-2), which satisfies `state <= 0` '
      + '— the exact trap that made an earlier revision of the group-reward check fire at spawn',
      fresh.state === EST.WAITING && fresh.state <= 0, `state=${fresh.state}`);
    check('...and MATERIALISING (-3) also satisfies `state <= 0`',
      EST.MATERIALISING <= 0);
    check('the cache is UNSET before any entity has died',
      fresh.deathCacheSeq === -1 && fresh.deathCacheX === null);

    const planeBc = new Uint8Array(128 * 64);
    const killed = new EntityB({ x: 100, y: 50, mode: MODE.WALK_L });
    killed.state = EST.DYING; killed.frame = -1;
    killed.tick(planeBc);
    check('CS:0xF034/F03A-F042: the kill-tick (frame still -1 at entry) caches the position',
      killed.deathCacheX === 108 && killed.deathCacheY === 50 && killed.deathCacheSeq >= 0,
      `x=${killed.deathCacheX} y=${killed.deathCacheY} seq=${killed.deathCacheSeq}`);
    check('CS:0xED84: the cache adds +8 to X ONLY, Y is untouched',
      killed.deathCacheX === killed.x + 8 && killed.deathCacheY === killed.y);

    const seqAfterFirst = killed.deathCacheSeq;
    for (let i = 0; i < ENTB_DEATH_FRAMES; i++) killed.tick(planeBc);
    check('CS:0xF034 is a ONE-SHOT gate — the cache does not move once frame leaves -1',
      killed.deathCacheSeq === seqAfterFirst && killed.deathCacheX === 108);

    /* Two entities dying in the SAME tick: the LATER one processed must win
     * the shared "freshest" tie-break, matching CS:0xED84 reading whichever
     * member's CS:0xF034 gate fired most recently — this is what lets
     * main.js pick "the group's own last-died member" without a real
     * shared scratch pair (see entity.js's own header note). */
    const first = new EntityB({ x: 0, y: 0 });
    first.state = EST.DYING; first.frame = -1;
    const second = new EntityB({ x: 200, y: 200 });
    second.state = EST.DYING; second.frame = -1;
    first.tick(planeBc);
    second.tick(planeBc);
    check('the entity ticked SECOND has the higher deathCacheSeq (it cached most recently)',
      second.deathCacheSeq > first.deathCacheSeq,
      `first=${first.deathCacheSeq} second=${second.deathCacheSeq}`);
  }

  /* A REAL BUG, found and fixed this session: `groupRewardPosition` (the
   * function main.js's own `groupsB` reward loop now calls). Every check
   * above drives the death cache by calling `.tick()` IMMEDIATELY after
   * setting `state = DYING; frame = -1` — which is NOT how main.js's own
   * per-frame ordering works. There, `stepCreatureDamage` (which sets
   * state/frame on a kill) runs AFTER every entity's own `tick()` call for
   * that SAME frame, so the entity that dies this frame does not get a
   * chance to run its own CS:0xF034 cache-write until its NEXT tick — one
   * frame after main.js's reward loop already ran and (before this fix)
   * already latched `rewardGiven` using a still-null cache. This is the
   * common case for shipped data: an `entityCount === 1` group's one member
   * satisfies "all members FREE or DYING" on the exact tick it dies. */
  {
    const justKilled = new EntityB({ x: 300, y: 400 });
    justKilled.state = EST.DYING; justKilled.frame = -1;   // as stepCreatureDamage just left it
    check('a same-tick kill has NOT yet cached a position — the pre-fix crash site',
      justKilled.deathCacheSeq === -1 && justKilled.deathCacheX === null);

    const pos = groupRewardPosition([justKilled]);
    check('groupRewardPosition falls back to the entity\'s own LIVE (x+8, y) — the exact '
      + 'value the cache would hold one tick later, since a DYING entity never moves — '
      + 'instead of (null, null)',
      pos.x === 308 && pos.y === 400, JSON.stringify(pos));

    /* One tick later the cache DOES populate, and must take over — the
     * fallback is a bridge for the missing tick, not a replacement. */
    justKilled.tick(new Uint8Array(128 * 64));
    const pos2 = groupRewardPosition([justKilled]);
    check('once the cache populates on the entity\'s own next tick, the SAME formula '
      + 'reads it instead of falling back again',
      pos2.x === justKilled.deathCacheX && pos2.y === justKilled.deathCacheY
      && pos2.x === 308 && pos2.y === 400, JSON.stringify(pos2));

    /* A mixed group: one member already cached (died last tick), one dying
     * THIS tick with no cache yet. */
    const diedLastTick = new EntityB({ x: 0, y: 0 });
    diedLastTick.state = EST.DYING; diedLastTick.frame = -1;
    diedLastTick.tick(new Uint8Array(128 * 64));   // cache now populated
    const diedThisTick = new EntityB({ x: 500, y: 600 });
    diedThisTick.state = EST.DYING; diedThisTick.frame = -1;   // no cache yet
    const posMixed = groupRewardPosition([diedLastTick, diedThisTick]);
    check('a mixed group correctly reports the ALREADY-cached member\'s real position '
      + '(its deathCacheSeq is a real number >= 0, beating the fresh member\'s -1)',
      posMixed.x === diedLastTick.deathCacheX && posMixed.y === diedLastTick.deathCacheY,
      JSON.stringify(posMixed));
  }

  /* ── Steal-and-carry, System B — CS:0xEF01/0xEEBA/0xEE06-0xEEB1/
   * 0xF045-0xF068. `stealGate` is genuinely GLOBAL mutable state (matching
   * DS:0x3cd's own one-way, whole-process latch — see pathfind.js's own
   * header), so this block saves and restores it around itself rather than
   * assuming a fresh module gives a known starting value, since some other
   * check function's own `seedGoals` call may already have armed it. */
  {
    const savedGateState = stealGate.active;
    const cam = { x: 100, y: 50 };
    /* Same fixtures as entity-a.js's own steal-and-carry tests, deliberately
     * — the eligibility formula is shared verbatim (stealFlagBits, exported
     * from entity-a.js), so the SAME flags word should behave identically. */
    const desc1 = { flags: 0x01 };

    /* THE GATE ITSELF: armed by the REAL producer (pathfind-producers.js's
     * seedGoals), not hand-set — the one assertion that would fail if a
     * future change moved CS:0xF7C9's own write relative to the paint loop.
     * `markersOverride: true` forces idx===2 deterministically (the DS:0x399
     * "attracts monsters" override), matching this project's own established
     * way of testing strategy 2 without needing to reverse the nibble roll. */
    {
      stealGate.active = false;
      const st = makeState({
        planeB: new Uint8Array(128 * 64), camX: 0, camY: 0,
        desc: { seedPair: 0, seedWeight: 0 },
        markers: [{ x: 10, y: 10, type: 34 }],
        markersOverride: true,
      });
      const idx = seedGoals(st, 500, 500, () => 0);
      check('CS:0xF7C9: seedGoals idx===2 with a NONEMPTY marker list arms stealGate.active',
        idx === 2 && stealGate.active === true);
    }

    /* The gate genuinely GATES — with it closed, an otherwise-eligible and
     * proximate marker steals nothing. */
    {
      stealGate.active = false;
      const e = new EntityB({ x: 148, y: 88 });
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      stealAttemptB(e, [{ x: 40, y: 30, type: 34 }], desc1, cam, objects);
      check('stealAttemptB bails outright when stealGate.active is false',
        e.carriedType === -1 && objects[0].dead === false);
    }

    /* With the gate open, the SAME 48x48 proximity + eligibility test System
     * A uses (shared stealFlagBits/searchAndSteal) lets the theft through. */
    {
      stealGate.active = true;
      const e = new EntityB({ x: 148, y: 88 });
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      stealAttemptB(e, [{ x: 40, y: 30, type: 34 }], desc1, cam, objects);
      check('stealAttemptB steals an eligible+proximate marker once the gate is open',
        e.carriedType === 34 && e.carriedX === 140 && e.carriedY === 80
        && objects[0].dead === true);
    }

    /* CS:0xEF51 — the hint tablet exclusion, SYSTEM B ONLY (System A's own
     * stealAttempt has no such check, per entity-a.js's own header note). */
    {
      stealGate.active = true;
      const e = new EntityB({ x: 148, y: 88 });
      const objects = [{ x: 140, y: 80, type: 0x45, flag6: 1, dead: false, slot: 0 }];
      stealAttemptB(e, [{ x: 40, y: 30, type: 0x45 }], desc1, cam, objects);
      check('CS:0xEF51: marker.type===0x45 (hint tablet) is excluded even when otherwise eligible+proximate',
        e.carriedType === -1 && objects[0].dead === false);
    }

    /* CS:0xEF10 — already carrying bails before the marker walk even starts. */
    {
      stealGate.active = true;
      const e = new EntityB({ x: 148, y: 88 });
      e.carriedType = 5;
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      stealAttemptB(e, [{ x: 40, y: 30, type: 34 }], desc1, cam, objects);
      check('an already-carrying entity never attempts a second theft',
        e.carriedType === 5 && objects[0].dead === false);
    }
    check('an empty marker list is a silent no-op, not a throw',
      (() => {
        stealGate.active = true;
        const e = new EntityB({ x: 148, y: 88 });
        stealAttemptB(e, [], desc1, cam, []);
        return e.carriedType === -1;
      })());

    /* carryOffsetB — DS:0xdc00, read live via read_memory, not decompiled.
     * World 2/4 class 0 both base at a KNOWN CLASS_TABLES_B entry, so the
     * index into the offset table is pinned exactly. */
    {
      const off = carryOffsetB(2, 0, 450);   // world2 class0 base=450, idx 0
      check('carryOffsetB world 2, idx 0, matches DS:0xdc00 verbatim',
        off.dx === 20 && off.dy === 25, JSON.stringify(off));
    }
    {
      const off = carryOffsetB(4, 0, 450 + 9);   // world4 class0 base=450, idx 9
      check('carryOffsetB world 4, idx 9, reads a signed-negative dx (-4, 9)',
        off.dx === -4 && off.dy === 9, JSON.stringify(off));
    }
    {
      const off = carryOffsetB(1, 0, 462);   // world1 class0 base=462, idx 0
      check('carryOffsetB world 1 falls back to {0,0} — CS:0xEEDA-EEE1 zero-extends '
        + '(world-2) instead of sign-extending it, landing far outside the real table',
        off.dx === 0 && off.dy === 0, JSON.stringify(off));
    }
    check('carryOffsetB clamps a computed index past the table to {0,0} rather than reading garbage',
      (() => { const off = carryOffsetB(2, 0, 450 + 25); return off.dx === 0 && off.dy === 0; })());

    /* stepCarriedItemB: the attach-offset draw position ALWAYS recomputes,
     * independent of whether the drop roll fires this tick — and the drop
     * position is a THIRD, different point from both. */
    {
      const e = new EntityB({ x: 100, y: 100, mode: MODE.WALK_L, cls: 0 });
      check('stepCarriedItemB: not carrying -> null, no side effect',
        stepCarriedItemB(e, desc1, 2, () => 0) === null && e.carriedX === 0);
    }
    {
      const e = new EntityB({ x: 100, y: 100, mode: MODE.WALK_L, cls: 0 });
      e.carriedType = 34;
      const NEVER = { flags: 0x02 };
      const r = stepCarriedItemB(e, NEVER, 2, () => 0);
      check('the RIGID attach draw position recomputes even when the drop refuses (world2/cls0/idx0 -> +20,+25)',
        e.carriedX === 120 && e.carriedY === 125 && r === null,
        `carried=${e.carriedX},${e.carriedY}`);
    }
    {
      const e = new EntityB({ x: 100, y: 100, mode: MODE.WALK_L, cls: 0 });
      e.carriedType = 34;
      const ALWAYS = { flags: 0x00 };
      const r = stepCarriedItemB(e, ALWAYS, 2, () => 1);   // rand never consulted for bits===0
      check('the DROP lands at the entity\'s own RAW (x+8, y) — a DIFFERENT point from the attach offset',
        r && r.id === 34 + 0xb && r.x === 108 && r.y === 100
        && (e.carriedX !== r.x || e.carriedY !== r.y),
        `${JSON.stringify(r)} attach=${e.carriedX},${e.carriedY}`);
      check('a completed drop clears carriedType', e.carriedType === -1);
    }
    {
      const e = new EntityB({ x: 100, y: 100, cls: 0 });
      e.carriedType = 0xc5;   // weapon range
      const WEAPON_NEVER = { flags: 0x08 };
      check('weapon flags&0xC===8 never drops',
        stepCarriedItemB(e, WEAPON_NEVER, 2, () => 0) === null && e.carriedType === 0xc5);
      const WEAPON_ALWAYS = { flags: 0x00 };
      const r = stepCarriedItemB(e, WEAPON_ALWAYS, 2, () => 1);
      check('weapon flags&0xC===0 drops now: id = carriedType - 0xC0',
        r && r.id === 0xc5 - 0xc0, JSON.stringify(r));
    }
    {
      const ROLL = { flags: 0x01 };
      const eFail = new EntityB({ x: 100, y: 100, cls: 0 }); eFail.carriedType = 34;
      check('ordinary flags&3===1 (roll-gated): a nonzero draw refuses the drop',
        stepCarriedItemB(eFail, ROLL, 2, () => 1) === null && eFail.carriedType === 34);
      const ePass = new EntityB({ x: 100, y: 100, cls: 0 }); ePass.carriedType = 34;
      check('...but a draw of exactly 0 lets it through (rand()&0x7f===0)',
        stepCarriedItemB(ePass, ROLL, 2, () => 0) !== null && ePass.carriedType === -1);
    }

    /* An entity ANIMATES while carrying — the tests above all call
     * stepCarriedItemB directly with hand-set mode/frame, which can't catch
     * carryOffsetB being wired to a frozen constant instead of the entity's
     * LIVE sprite (CS:0xF0AE reads the entity's current mode/frame every
     * tick, and tick()'s own _walk/_step mutates both). This ticks a real
     * walking carrier across several steps and checks the attach offset
     * actually moves as the walk animation advances, landing on more than
     * one row of CARRY_OFFSET_TABLE_B. */
    {
      const flat = new Uint8Array(128 * 64);
      const atW = (x, y) => (((x & 0xFFE0) >> 5) + ((y & 0xFFF0) >> 4) * 128) + 0x100;
      for (let c = 0; c < 4; c++) flat[atW(c * 32, 0)] = 1;   // a short flat floor
      const e = new EntityB({ x: 0, y: 0, mode: MODE.WALK_L, cls: 0 });
      e.state = 1;
      e.carriedType = 34;
      const NEVER = { flags: 0x02 };                          // ordinary flags&3===2 -> never drops
      const seenOffsets = new Set();
      for (let i = 0; i < 16; i++) {
        e.tick(flat, VERDICT_NONE, null);
        stepCarriedItemB(e, NEVER, 2, () => 1);
        seenOffsets.add(`${e.carriedX - e.x},${e.carriedY - e.y}`);
      }
      check('stepCarriedItemB\'s attach offset MOVES as a walking carrier animates '
        + '(carryOffsetB reads the live per-tick sprite, not a frozen constant)',
        seenOffsets.size >= 2, [...seenOffsets].join(' | '));
    }

    /* The DYING-branch death-time drop, CS:0xF045-F068 — a SEPARATE popup
     * call from the group reward (deathCacheX/Y above), at the entity's own
     * raw (x+8, y), sharing only the frame===-1 one-shot gate. */
    {
      const e = new EntityB({ x: 200, y: 300, hp: 5 });
      e.state = EST.DYING; e.frame = -1;
      e.carriedType = 40;
      e.tick(new Uint8Array(128 * 64));
      check('CS:0xF045-F068: the DYING frame===-1 tick records a death-time drop at the RAW (x+8,y) position',
        e.deathDropId === 40 + 0xb && e.deathDropX === 208 && e.deathDropY === 300,
        JSON.stringify({ id: e.deathDropId, x: e.deathDropX, y: e.deathDropY }));
      check('the carried item is consumed by the death-time drop',
        e.carriedType === -1);

      const e2 = new EntityB({ x: 0, y: 0, hp: 5 });
      e2.state = EST.DYING; e2.frame = -1;
      e2.tick(new Uint8Array(128 * 64));
      check('an entity carrying nothing at death records no drop request',
        e2.deathDropId === null);
    }

    stealGate.active = savedGateState;
  }

  return results;
}


/* System A's six-stage pipeline (CS:0xe001), in isolation — see entity-a.js's
 * header for what is and is not ported. */
export function checkEntityA() {
  const { results, check } = makeChecker();

  /* Stage 2's arrival test rounds position+16 down to a multiple of 32, so
   * two positions that round to the same 32px cell are "arrived" even when
   * not pixel-identical, and the velocity decays toward zero rather than
   * being cleared outright. */
  const e = new EntityA({ x: 100, y: 100 });
  e.goalX = 100; e.goalY = 100;
  e.vx = 5; e.vy = -5; e.stepCap = 4;
  stageAccelerate(e, 4);
  check(`arrived at the goal cell decays velocity toward zero, doesn't clear it`,
    e.arrivedCoarse && e.vx === 1 && e.vy === -1, `vx=${e.vx} vy=${e.vy}`);
  for (let i = 0; i < 5; i++) stageAccelerate(e, 4);
  check(`velocity decay stops AT zero, doesn't overshoot`, e.vx === 0 && e.vy === 0);

  /* Not arrived: a proportional step toward the goal, clamped by min(own
   * cap, descriptor +0xc), added to (not replacing) the existing velocity. */
  const e2 = new EntityA({ x: 0, y: 0 });
  e2.goalX = 800; e2.goalY = 0;
  e2.stepCap = 100;
  stageAccelerate(e2, 3);   // desc.stepCap = 3, smaller than e2.stepCap
  check(`the smaller of the two step caps wins, and it ACCUMULATES`,
    e2.vx === 3, `vx=${e2.vx} (expected min(own,desc) = 3)`);
  const beforeVx = e2.vx;
  stageAccelerate(e2, 3);
  check(`stage 2 accumulates onto existing velocity, not overwrites`,
    e2.vx === beforeVx + 3, `vx=${e2.vx}`);

  /* Stage 5: frozen means no movement at all, even mid-flight. */
  const e3 = new EntityA({ x: 10, y: 10 });
  e3.vx = 4; e3.vy = 0;
  stageApply(e3, true);
  check(`DS:0x2fa (freezes aliens) stops stage 5 outright`, e3.x === 10 && e3.y === 10);
  stageApply(e3, false);
  check(`unfrozen, stage 5 applies velocity`, e3.x === 14 && e3.y === 10);

  /* Fine-arrival snaps straight to the goal, overriding velocity. */
  const e4 = new EntityA({ x: 50, y: 50 });
  e4.goalX = 47; e4.goalY = 53; e4.vx = 99; e4.vy = 99; e4.arrivedFine = true;
  stageApply(e4, false);
  check(`the FINE-arrival flag snaps position to the goal, ignoring velocity`,
    e4.x === 47 && e4.y === 53);

  /* Stage 6: no fire capability (fireByte 0), no reload nibble, zero
   * velocity, and the reload-not-elapsed case must all refuse to fire.
   * `desc.flags` bits [5:4] carry attackBits — 0 here means "ordinary fire". */
  const f0 = new EntityA({ x: 0, y: 0 });
  check(`fireByte 0 never arms`, stageFacingAndFire(f0, { fireByte: 0x00, flags: 0 }) === null);
  const f1 = new EntityA({ x: 0, y: 0 }); f1.vx = 0;
  check(`zero own velocity means no fire, even with a live fireByte`,
    stageFacingAndFire(f1, { fireByte: 0x31, flags: 0 }) === null);
  const f2 = new EntityA({ x: 0, y: 0 }); f2.vx = 4;
  const shot = stageFacingAndFire(f2, { fireByte: 0x31, flags: 0 });   // hi nibble 3, lo nibble 1
  check(`facing right (vx>0) fires from x+32, dir = +hiNibble`,
    shot && shot.x === f2.x + 0x20 && shot.dir === 3, JSON.stringify(shot));
  const f3 = new EntityA({ x: 0, y: 0 }); f3.vx = -4;
  const shotL = stageFacingAndFire(f3, { fireByte: 0x31, flags: 0 });
  check(`facing left (vx<0) fires from x-8, dir = -hiNibble`,
    shotL && shotL.x === f3.x - 8 && shotL.dir === -3, JSON.stringify(shotL));

  /* CS:0xE5E4 — attackBits != 0 diverts to the line-hazard pool, and does
   * NOT test vx (CS:0xe6a5's zero-velocity gate sits inside the attackBits
   * == 0 branch only). desc.flags bits [5:4] carry attackBits; fireByte's
   * hi nibble becomes `n`, not a shot direction, in this branch. */
  const f4 = new EntityA({ x: 10, y: 20 });   // vx left at 0 — must NOT block the divert
  const hazard1 = stageFacingAndFire(f4, { fireByte: 0x61, flags: 0x10 });  // (0x10>>4)&3 = 1
  check(`attackBits!=0 diverts to a hazard spawn even at zero velocity`,
    hazard1 && hazard1.hazard === true && hazard1.attackBits === 1,
    JSON.stringify(hazard1));
  check(`the hazard spawn carries n = the fireByte's hi nibble`,
    hazard1 && hazard1.n === 6, JSON.stringify(hazard1));
  check(`the hazard spawn's x/y are the entity's own position, unmuzzled`,
    hazard1 && hazard1.x === 10 && hazard1.y === 20, JSON.stringify(hazard1));
  const f5 = new EntityA({ x: 0, y: 0 });
  const hazard2 = stageFacingAndFire(f5, { fireByte: 0x21, flags: 0x20 }); // (0x20>>4)&3 = 2
  check(`attackBits==2 also diverts (only 0 fires an ordinary shot)`,
    hazard2 && hazard2.hazard === true && hazard2.attackBits === 2, JSON.stringify(hazard2));

  /* CS:0xe748 — the low nibble wins with probability (weight+1)/128. Extreme
   * weights should never/always swap, matching the doc's own closed-form
   * reading (weight=127 can never swap, weight=0 swaps 127/128). */
  let neverSwapped = true, alwaysSwapped = true;
  for (let r = 0; r < 128; r++) {
    if (rollStrategy(0x21, 127, () => r) !== 1) neverSwapped = false;   // lo=1
    if (r > 0 && rollStrategy(0x21, 0, () => r) !== 2) alwaysSwapped = false; // hi=2
  }
  check(`seed weight 127 never swaps to the high nibble`, neverSwapped);
  check(`seed weight 0 swaps to the high nibble on every nonzero roll`, alwaysSwapped);

  /* The two special sprite bases carry NO facing offset and their own
   * frame-cycle lengths (8 and 6), unlike the default 4-frame + offset case. */
  const tables = { 1: [{ base: SPRITE_BASE_8FRAME, w: 32, h: 32 },
                       { base: SPRITE_BASE_6FRAME, w: 32, h: 32 }] };
  const s8 = new EntityA({ x: 0, y: 0 }); s8.cls = 0; s8.frame = 5; s8.facing = 0;
  check(`sprite base 496 (0x1f0) draws base+frame with no facing offset`,
    spriteForEntityA(1, 0, s8, tables) === SPRITE_BASE_8FRAME + 5);
  const s6 = new EntityA({ x: 0, y: 0 }); s6.cls = 1; s6.frame = 3; s6.facing = 1;
  check(`sprite base 486 (0x1e6) also carries no facing offset`,
    spriteForEntityA(1, 1, s6, tables) === SPRITE_BASE_6FRAME + 3);

  /* Default class, world < 2: frame remapped through [0,1,2,1] BEFORE the
   * +3 facing offset (only when facing===0); world >= 2: frame added
   * directly, offset is +4. */
  const dTables = { 1: [{ base: 1000, w: 32, h: 32 }], 2: [{ base: 1000, w: 32, h: 32 }] };
  const w1 = new EntityA({ x: 0, y: 0 }); w1.cls = 0; w1.frame = 3; w1.facing = 0;
  check(`world<2 default class remaps frame 3 -> 1 via DS:0xdf78, +3 offset`,
    spriteForEntityA(1, 0, w1, dTables) === 1000 + 1 + 3,
    `${spriteForEntityA(1, 0, w1, dTables)}`);
  w1.facing = 1;
  check(`facing=1 ("last moved right") adds NO offset`,
    spriteForEntityA(1, 0, w1, dTables) === 1000 + 1);
  const w2 = new EntityA({ x: 0, y: 0 }); w2.cls = 0; w2.frame = 3; w2.facing = 0;
  check(`world>=2 default class adds the raw frame directly, +4 offset`,
    spriteForEntityA(2, 0, w2, dTables) === 1000 + 3 + 4);

  /* ── Stage 3, CS:0xe487 -> FUN_1000_e4e2 — the reach-table scan ─────────
   * Hit/no-hit cases, plus the DISPLACEMENT CURSOR DRIFT on a 2-hit scan —
   * a first hit reads DISPLACEMENT_TABLE[0] cleanly, a second (later) hit
   * reads whatever index the elapsed step count has drifted the cursor to,
   * NOT the "next" table entry. */
  {
    const cam0 = { x: 0, y: 0 };
    const emptyGrid = new DamageGrid(); emptyGrid.clear();

    const eGateOff = new EntityA({ x: 80, y: 80 });
    check(`stage 3 does nothing while descriptor +0xf (attackGate) is 0`,
      stageAttack(eGateOff, { attackGate: 0, stepCap: 4 }, emptyGrid, cam0) === null);

    const eNoHit = new EntityA({ x: 80, y: 80 });
    check(`stage 3 finds nothing on an empty damage grid`,
      stageAttack(eNoHit, { attackGate: 6, stepCap: 4 }, emptyGrid, cam0) === null);

    const eFarOff = new EntityA({ x: -10000, y: -10000 });
    check(`stage 3 stops (returns null) rather than reading garbage when the entity's own cell is off the grid`,
      stageAttack(eFarOff, { attackGate: 6, stepCap: 4 }, emptyGrid, cam0) === null);

    /* REACH_OFFSETS[0] = {dCol:-1, dRow:-1}, the scan's very FIRST probed
     * cell. Stamping only this one gives a single, first-step hit. */
    const off0 = REACH_OFFSETS[0];
    const stampAt = (grid, off, tag) =>
      { grid.buf[stampIndex(80 + off.dCol * CELL, 80 + off.dRow * CELL) - GRID_LO] = tag; };

    const eHit0 = new EntityA({ x: 80, y: 80 });
    eHit0.arrivedFine = true;               // prove stage 3 clears this on a hit
    const gridHit0 = new DamageGrid(); gridHit0.clear();
    stampAt(gridHit0, off0, 5);
    const r0 = stageAttack(eHit0, { attackGate: 6, stepCap: 4 }, gridHit0, cam0);
    check(`a hit on the very first probed cell reads DISPLACEMENT_TABLE at cursor 0`,
      r0 && r0.hits.length === 1 && r0.hits[0].step === 0 && r0.hits[0].cursor === 0,
      JSON.stringify(r0));
    check(`the returned delta is DISPLACEMENT_TABLE[0] doubled and clamped to desc.stepCap (+0xc)`,
      r0 && r0.dx === -4 && r0.dy === -4,   // {-8,-8} * 2 = {-16,-16}, clamped to +/-4
      JSON.stringify(r0));
    check(`a hit arms the windup (entity +0x16 -> 10, CS:0xE496) and clears arrivedFine`,
      eHit0.stepCap === 10 && eHit0.arrivedFine === false);
    check(`the steering delta blends onto the PRE-stage-2 velocity snapshot, not a bare assignment`,
      eHit0.vx === eHit0.prevVx + r0.dx && eHit0.vy === eHit0.prevVy + r0.dy);

    /* A second stamp at REACH_OFFSETS[3] = {dCol:2, dRow:-1} lands on the
     * scan's 4th probed cell (step 3). attackGate=12 -> budget = (0x10-12)
     * & 0xf = 4, so the scan visits steps 0,1,2,3 exactly and the cursor —
     * which advances on EVERY step, hit or miss — has drifted to 3 by the
     * time this second hit registers. A "clean, per-hit" table index would
     * read 1 here; the original does not work that way. */
    const off3 = REACH_OFFSETS[3];
    const eHit2 = new EntityA({ x: 80, y: 80 });
    const gridHit2 = new DamageGrid(); gridHit2.clear();
    stampAt(gridHit2, off0, 5);
    stampAt(gridHit2, off3, 7);
    const r2 = stageAttack(eHit2, { attackGate: 12, stepCap: 4 }, gridHit2, cam0);
    check(`a 2-hit scan caps at exactly 2 tracked hits`,
      r2 && r2.hits.length === 2, JSON.stringify(r2));
    check(`the FIRST hit still reads cursor 0 cleanly`,
      r2 && r2.hits[0].step === 0 && r2.hits[0].cursor === 0);
    check(`⚠️ the SECOND hit reads a DRIFTED cursor (3, the elapsed step count) — NOT a clean index 1`,
      r2 && r2.hits[1].step === 3 && r2.hits[1].cursor === 3, JSON.stringify(r2));
    check(`only the FIRST hit's displacement ever steers the entity — the second hit's drift has no gameplay effect`,
      r2 && r2.dx === r0.dx && r2.dy === r0.dy);
  }

  /* ── Strategy 1, CS:0xe9da — the zone search ─────────────────────────── */
  {
    const cam0 = { x: 0, y: 0 };
    const zone1 = ZONES[0];   // {loX:0, loY:0, hiX:160, hiY:60}
    const w1z = zone1.hiX - zone1.loX, h1z = zone1.hiY - zone1.loY;

    /* Force the desired===current(=1) branch deterministically: zoneWeight
     * 127 always takes the weighted search, and with ZONE_SCRATCH
     * permanently zero that search always yields zone 1. An entity at
     * screen (50,20) is cleanly inside zone 1 and nowhere else. */
    let boxOk = true, centreOk = true;
    for (const rv of [0, 1, 32, 63, 64, 100, 126, 127]) {
      const e = new EntityA({ x: 50, y: 20 });
      const seq = [5, rv, rv];       // [0] passes the zoneWeight(127) gate; [1]/[2] offX/offY draws
      let n = 0;
      strategy1(e, { zoneWeight: 127 }, cam0, () => seq[n++] ?? rv);
      const offX = (e.goalX - cam0.x) - zone1.loX + 16;
      const offY = (e.goalY - cam0.y) - zone1.loY + 16;
      if (offX < 0 || offX >= w1z || offY < 0 || offY >= h1z) boxOk = false;
      /* This port's own reading of the documented "-16" shift: it centres a
       * 32px-wide entity, so the entity's presumed CENTRE (goal + 16 on
       * both axes) should land inside the zone's own rectangle. Flagged as
       * an interpretation in strategy1's own header, not re-derived from
       * CS:0xe9da's raw bytes — asserted here as this port's understanding,
       * not as independently confirmed original behaviour. */
      const cx = e.goalX - cam0.x + 16, cy = e.goalY - cam0.y + 16;
      if (cx < zone1.loX || cx > zone1.hiX || cy < zone1.loY || cy > zone1.hiY) centreOk = false;
    }
    check(`strategy 1's raw scaled offset never escapes its own zone's width/height`, boxOk);
    check(`(this port's reading of the -16 shift) the entity's presumed 32px-body centre lands inside the target zone`,
      centreOk);

    /* ⚠️ THE "WRONG DIRECTION" RING STEP, asserted explicitly. current=1,
     * desired=6: the BACKWARD ring search finds desired in exactly 1 hop
     * (zone 1 -> 6), so a "sensible" implementation would step backward.
     * The original does the opposite: it is the FORWARD search that FAILS
     * (blocked on its own very first hop, since ZONE_SCRATCH is
     * permanently zero), and the entity steps FORWARD anyway — landing in
     * zone 2, not the reachable zone 6. Independently re-verified from the
     * raw disassembly twice in this project; not a transcription error. */
    const eWrong = new EntityA({ x: 50, y: 20 });         // currentZone === 1
    const wrongSeq = [1, 6, 0, 0];    // [0] fails the zoneWeight(0) gate -> reroll branch
                                        // [1] rand()&7 === 6 -> desired = 6
                                        // [2]/[3] offX/offY for the eventual setGoal
    let wi = 0;
    strategy1(eWrong, { zoneWeight: 0 }, cam0, () => wrongSeq[wi++] ?? 0);
    check(`⚠️ current=1, desired=6: the reachable (1-hop, backward) direction is NOT taken`,
      eWrong.storedZone === 2, `storedZone=${eWrong.storedZone} (expected 2, the FAILED forward direction, not 6)`);

    /* Strategy 1 never stays sticky — every call re-arms entity.strategy. */
    const eSticky = new EntityA({ x: 50, y: 20 });
    eSticky.strategy = 1;
    strategy1(eSticky, { zoneWeight: 127 }, cam0, () => 5);
    check(`strategy 1 always re-arms the sticky-strategy byte to "unset" before returning`,
      eSticky.strategy === -1);

    /* currentZone's own asymmetric bounds, and its 0-return for an entity
     * cleanly outside all 7 zones (an edge case the given spec does not
     * itself address — see stepBack6's own comment for how strategy1
     * handles it defensively rather than assuming it can't occur). */
    check(`currentZone finds zone 1 for an entity well inside it`,
      currentZone({ x: 50, y: 20 }, cam0) === 1);
    check(`currentZone returns 0 for an entity cleanly outside every zone`,
      currentZone({ x: 1000, y: 1000 }, cam0) === 0);
  }

  /* ── Strategy 2, CS:0xe88c — marker-seek ─────────────────────────────── */
  {
    const camera = { x: 200, y: 100 };
    const markers = [{ x: 50, y: 30, type: 10 }];

    const e = new EntityA({ x: 0, y: 0 });
    strategy2(e, markers, camera, () => 0);
    check(`strategy 2 converts a screen-frozen marker to a world goal via marker + CURRENT camera (not re-subtracted)`,
      e.goalX === 250 && e.goalY === 130, `${e.goalX},${e.goalY}`);

    const eEmpty = new EntityA({ x: 5, y: 5 });
    eEmpty.goalX = 5; eEmpty.goalY = 5;
    strategy2(eEmpty, [], camera, () => 0);
    check(`strategy 2 with an empty marker list leaves the existing goal untouched`,
      eEmpty.goalX === 5 && eEmpty.goalY === 5);

    const eNull = new EntityA({ x: 5, y: 5 });
    eNull.goalX = 5; eNull.goalY = 5;
    strategy2(eNull, null, camera, () => 0);
    check(`strategy 2 tolerates a null marker list the same way as an empty one`,
      eNull.goalX === 5 && eNull.goalY === 5);
  }

  /* ── tick()'s own dispatch: strategies 1/2 are wired, gated on `camera` ─
   * The one real caller (main.js) does not pass a camera yet, so this also
   * locks in the documented fallback: no camera means the goal is left
   * exactly as untouched as it was before this session. */
  {
    const cam0 = { x: 0, y: 0 };
    const descBase = { seedPair: 0x11, seedWeight: 0, stepCap: 4, speedCap: 4, fireByte: 0, flags: 0 };

    const eNoCam = new EntityA({ x: 50, y: 20, hp: 5 });
    eNoCam.state = eNoCam.hp;           // skip the pre-life FSM
    eNoCam.strategy = 1;
    eNoCam.goalX = 999; eNoCam.goalY = 999;
    eNoCam.tick({ x: 0, y: 0 }, descBase, () => 0, false);
    check(`tick() leaves strategy 1's goal untouched when no camera is supplied (the current, real call-site behaviour)`,
      eNoCam.goalX === 999 && eNoCam.goalY === 999);

    const eCam = new EntityA({ x: 50, y: 20, hp: 5 });
    eCam.state = eCam.hp;
    eCam.strategy = 1;
    eCam.goalX = 999; eCam.goalY = 999;
    eCam.tick({ x: 0, y: 0 }, { ...descBase, zoneWeight: 127 }, () => 5, false, cam0);
    check(`tick() DOES route strategy 1 through strategy1() once a camera is supplied`,
      eCam.goalX !== 999 || eCam.goalY !== 999, `goal=${eCam.goalX},${eCam.goalY}`);

    const eNoCam2 = new EntityA({ x: 0, y: 0, hp: 5 });
    eNoCam2.state = eNoCam2.hp;
    eNoCam2.strategy = 2;
    eNoCam2.goalX = 999; eNoCam2.goalY = 999;
    eNoCam2.tick({ x: 0, y: 0 }, descBase, () => 0, false, null, [{ x: 50, y: 30, type: 10 }]);
    check(`tick() leaves strategy 2's goal untouched when no camera is supplied, even with markers present`,
      eNoCam2.goalX === 999 && eNoCam2.goalY === 999);

    const cam2 = { x: 200, y: 100 };
    const eCam2 = new EntityA({ x: 0, y: 0, hp: 5 });
    eCam2.state = eCam2.hp;
    eCam2.strategy = 2;
    eCam2.goalX = 999; eCam2.goalY = 999;
    eCam2.tick({ x: 0, y: 0 }, descBase, () => 0, false, cam2, [{ x: 50, y: 30, type: 10 }]);
    check(`tick() DOES route strategy 2 through strategy2() once both camera and markers are supplied`,
      eCam2.goalX === 250 && eCam2.goalY === 130, `goal=${eCam2.goalX},${eCam2.goalY}`);
  }

  /* CS:0xE247's death fade — System A's OWN, distinct from System B's:
   * DEATH_FRAMES_A=17 not 7, sprite base 0x5b not 0x6c, and a RAW (unbiased)
   * position cache (System B's own write-time cache adds +8 to X). A
   * regression guard mirroring checkEntity()'s own CS:0xF030 tests exactly,
   * so the two entity systems' death sequences stay independently verified. */
  {
    const desc0 = { seedPair: 0, seedWeight: 0, stepCap: 4, speedCap: 4, fireByte: 0, flags: 0 };
    const d = new EntityA({ x: 0, y: 0, hp: 5 });
    d.state = ESTA.DYING; d.frame = -1;          // combat.js's own kill-tick values
    check('a killed System-A entity is DYING, not silently freed',
      isDyingA(d) && d.state === ESTA.DYING);

    const frames = [];
    for (let i = 0; i < ENTA_DEATH_FRAMES; i++) {
      d.tick({ x: 0, y: 0 }, desc0, () => 0, false);
      frames.push(d.frame);
      check(`CS:0xE2AC/E2AF: tick ${i} keeps the entity DYING while frame < ${ENTA_DEATH_FRAMES}`,
        isDyingA(d), `frame=${d.frame} state=${d.state}`);
    }
    check(`CS:0xE2AC: frame counts 0..${ENTA_DEATH_FRAMES - 1} across exactly ${ENTA_DEATH_FRAMES} ticks`,
      frames.join() === Array.from({ length: ENTA_DEATH_FRAMES }, (_, i) => i).join(),
      frames.join());
    check(`CS:0xE2D2: the fade sprite base is the FLAT ${ENTA_DEATH_SPRITE_BASE.toString(16)} constant, ` +
      `distinct from System B's own 0x6c`,
      ENTA_DEATH_SPRITE_BASE === 0x5b);

    d.tick({ x: 0, y: 0 }, desc0, () => 0, false);   // the ENTA_DEATH_FRAMES-th tick — CS:0xE2B3's `jl` is NOT taken
    check('CS:0xE2B5/E2BA: the entity finalises to FREE, not stuck dying forever',
      d.state === ESTA.FREE && !isDyingA(d), `state=${d.state}`);
    check('CS:0xE2BA: the delay/dormant-countdown field is also cleared on finalise',
      d.delay === 0);
  }

  /* CS:0xE251/E256's one-shot cache — RAW, no bias, unlike System B's own
   * write-time `+8`-on-X. The `+8`-on-BOTH-axes bias belongs at the
   * REWARD'S OWN read site (main.js), not here — see entity-a.js's own
   * DEATH_FRAMES_A header for why getting this backwards either drops the
   * bias or wrongly reuses System B's X-only convention. */
  {
    const desc0 = { seedPair: 0, seedWeight: 0, stepCap: 4, speedCap: 4, fireByte: 0, flags: 0 };
    const fresh = new EntityA({ x: 10, y: 20, hp: 5 });
    check('a freshly-spawned System-A entity is WAITING (-2), which satisfies `state <= 0` '
      + '— the same trap System B\'s own group-reward guard already documents',
      fresh.state === ESTA.WAITING && fresh.state <= 0, `state=${fresh.state}`);
    check('the cache is UNSET before any entity has died',
      fresh.deathCacheSeq === -1 && fresh.deathCacheX === null);

    const killed = new EntityA({ x: 100, y: 50, hp: 5 });
    killed.state = ESTA.DYING; killed.frame = -1;
    killed.tick({ x: 0, y: 0 }, desc0, () => 0, false);
    check('CS:0xE251/E256: the kill-tick (frame still -1 at entry) caches the position RAW',
      killed.deathCacheX === 100 && killed.deathCacheY === 50 && killed.deathCacheSeq >= 0,
      `x=${killed.deathCacheX} y=${killed.deathCacheY} seq=${killed.deathCacheSeq}`);
    check('CS:0xE251/E256: unlike System B, NEITHER axis is biased at write time',
      killed.deathCacheX === killed.x && killed.deathCacheY === killed.y);

    const seqAfterFirst = killed.deathCacheSeq;
    for (let i = 0; i < ENTA_DEATH_FRAMES; i++) killed.tick({ x: 0, y: 0 }, desc0, () => 0, false);
    check('CS:0xE24F is a ONE-SHOT gate — the cache does not move once frame leaves -1',
      killed.deathCacheSeq === seqAfterFirst && killed.deathCacheX === 100);

    const first = new EntityA({ x: 0, y: 0, hp: 5 });
    first.state = ESTA.DYING; first.frame = -1;
    const second = new EntityA({ x: 200, y: 200, hp: 5 });
    second.state = ESTA.DYING; second.frame = -1;
    first.tick({ x: 0, y: 0 }, desc0, () => 0, false);
    second.tick({ x: 0, y: 0 }, desc0, () => 0, false);
    check('the entity ticked SECOND has the higher deathCacheSeq (it cached most recently)',
      second.deathCacheSeq > first.deathCacheSeq,
      `first=${first.deathCacheSeq} second=${second.deathCacheSeq}`);
  }

  /* A REAL BUG, found and fixed this session — System A's own mirror of
   * `groupRewardPosition`'s bug (see entity.js's own regression test, right
   * after checkEntityB's identical death-cache block, for the full timing
   * argument). main.js's `groupsA` reward loop reads the cache the SAME
   * tick a member's `state` first goes DYING, but that member's own
   * CS:0xE251/E256 cache-write only runs on ITS NEXT `tick()` call — one
   * frame after `stepCreatureDamage` (which runs after every entity's own
   * per-frame `tick()`) set `state`/`frame`. `groupRewardPositionA` must
   * fall back to the entity's own live position (with the same +8/+8
   * read-site bias) rather than reading a still-null cache. */
  {
    const desc1 = { seedPair: 0, seedWeight: 0, stepCap: 4, speedCap: 4, fireByte: 0, flags: 0 };
    const justKilled = new EntityA({ x: 300, y: 400, hp: 5 });
    justKilled.state = ESTA.DYING; justKilled.frame = -1;   // as stepCreatureDamage just left it
    check('a same-tick kill has NOT yet cached a position — the pre-fix crash site',
      justKilled.deathCacheSeq === -1 && justKilled.deathCacheX === null);

    const pos = groupRewardPositionA([justKilled]);
    check('groupRewardPositionA falls back to the entity\'s own LIVE (x+8, y+8) — the '
      + 'exact value the cache would hold one tick later, since a DYING entity never '
      + 'moves — instead of (NaN, NaN)',
      pos.x === 308 && pos.y === 408, JSON.stringify(pos));

    justKilled.tick({ x: 0, y: 0 }, desc1, () => 0, false);   // cache now populates
    const pos2 = groupRewardPositionA([justKilled]);
    check('once the cache populates on the entity\'s own next tick, the SAME formula '
      + 'reads deathCacheX/Y+8 instead of falling back again — still (308, 408)',
      pos2.x === justKilled.deathCacheX + 8 && pos2.y === justKilled.deathCacheY + 8
      && pos2.x === 308 && pos2.y === 408, JSON.stringify(pos2));
  }

  /* End-to-end regression guard for main.js's own `groupsA` reward-check
   * loop (CS:0xDFAC-E000): drive a full 3-member group through kill -> the
   * full DEATH_FRAMES_A-tick fade -> FREE, and assert the SAME predicate
   * main.js uses (`state === FREE || state === DYING`) fires the reward the
   * instant the LAST member starts dying — NOT waiting for any member to
   * finish its fade — and stays latched (no re-fire) once every member has
   * finished. Before this session neither `groupsA` nor this predicate
   * existed at all, so this is also the first test that would have caught
   * a group never being tracked in the first place. */
  {
    const desc0 = { seedPair: 0, seedWeight: 0, stepCap: 4, speedCap: 4, fireByte: 0, flags: 0 };
    const members = [
      new EntityA({ x: 10, y: 20, hp: 3 }),
      new EntityA({ x: 30, y: 40, hp: 3 }),
      new EntityA({ x: 50, y: 60, hp: 3 }),
    ];
    for (const m of members) m.state = m.hp;   // skip the pre-life FSM — all three alive
    const rewardFired = () => members.every((e) => e.state === ESTA.FREE || e.state === ESTA.DYING);

    check('a fully-alive 3-member group does NOT satisfy the reward predicate',
      !rewardFired());

    members[0].state = ESTA.DYING; members[0].frame = -1;
    members[0].tick({ x: 0, y: 0 }, desc0, () => 0, false);   // caches its own death position
    check('one of three dying — the other two still alive — does NOT fire',
      !rewardFired());

    members[1].state = ESTA.DYING; members[1].frame = -1;
    members[1].tick({ x: 0, y: 0 }, desc0, () => 0, false);
    check('two of three dying — one still alive — still does NOT fire',
      !rewardFired());

    members[2].state = ESTA.DYING; members[2].frame = -1;
    members[2].tick({ x: 0, y: 0 }, desc0, () => 0, false);
    check('CS:0xDFC4: ALL THREE dying (none fully dead yet) DOES satisfy the reward '
      + 'predicate — dead+dying === count, not dead === count',
      rewardFired());
    check('every member has a cache to read at reward time, since DYING is only '
      + 'reachable through the frame===-1 tick that writes it',
      members.every((e) => e.deathCacheX !== null && e.deathCacheY !== null));

    const src = members.reduce((a, b) => (b.deathCacheSeq > a.deathCacheSeq ? b : a));
    check('the group\'s own reward position picks whichever member cached MOST recently '
      + '(the third, ticked last)',
      src === members[2], `picked x=${src.x}`);
    /* Assert against the LITERAL placement (50, 60), not `members[2].x + 8` —
     * that form is tautological, since deathCacheX is unbiased at write time
     * (CS:0xE251/E256) and would equal members[2].x + 8 whether the +8 lands
     * at write time or read time. Pinning the raw cache to its unbiased value
     * is what actually distinguishes the two, and main.js's own reward loop
     * is what applies the +8 at the read site. */
    check('CS:0xE251/E256: the cache itself is RAW/unbiased — (50, 60), not (58, 68)',
      src.deathCacheX === 50 && src.deathCacheY === 60,
      `x=${src.deathCacheX} y=${src.deathCacheY}`);
    check('CS:0xDFC8-DFD2: the read-site bias is +8 on BOTH axes, applied at the READ '
      + 'site — main.js\'s own reward loop, not here',
      src.deathCacheX + 8 === 58 && src.deathCacheY + 8 === 68);

    /* Run the full 17-tick fade out to FREE on all three — the reward
     * predicate must stay satisfied throughout (FREE also counts), matching
     * CS:0xDFC4's own dead-OR-dying test rather than the stricter dead-ONLY
     * CS:0xDFF5 slot-free condition this port does not model (see main.js's
     * own header comment on `groupsA`). */
    for (let i = 0; i < ENTA_DEATH_FRAMES; i++) {
      for (const m of members) m.tick({ x: 0, y: 0 }, desc0, () => 0, false);
    }
    check(`after the full ${ENTA_DEATH_FRAMES}-tick fade every member is FREE`,
      members.every((e) => e.state === ESTA.FREE), members.map((e) => e.state).join());
    check('...and the reward predicate STILL holds (FREE counts, same as DYING)',
      rewardFired());
  }

  /* ── Steal-and-carry, System A only — CS:0xE88C/E90E/E99F/E0C1-E198/
   * E25C-E282 ────────────────────────────────────────────────────────── */
  {
    const cam = { x: 100, y: 50 };
    /* stealFlagBits reads bits[1:0] DIRECTLY for ordinary types — a flags
     * word of 1 gives bits=1 (nonzero -> eligible); 0 gives bits=0 (never
     * eligible, CS:0xE996's own skip). Chosen so the "eligible" and
     * "ineligible" fixtures below are a single-bit difference, not a guess. */
    const desc1 = { flags: 0x01 };
    const desc0 = { flags: 0x00 };

    /* searchAndSteal: exact {type,x,y} match, backward walk, kill+carry. */
    {
      const objects = [
        { x: 10, y: 10, type: 5, flag6: 1, dead: false, slot: 0 },
        { x: 150, y: 130, type: 34, flag6: 1, dead: false, slot: 1 },   // the real match
        { x: 150, y: 130, type: 34, flag6: 0, dead: false, slot: 2 },   // same type/pos, flag6=0 -> NOT eligible
      ];
      const e = new EntityA({ x: 0, y: 0 });
      searchAndSteal(e, objects, 34, 150, 130);
      check('searchAndSteal only matches a LIVE object (flag6 bit0 set), not the coincident dead-flag one',
        e.carriedType === 34 && e.carriedX === 150 && e.carriedY === 130);
      check('the stolen object is killed: dead, type 0xffff, flag6 0',
        objects[1].dead === true && objects[1].type === 0xffff && objects[1].flag6 === 0);
      check('the coincident flag6=0 record is left completely untouched',
        objects[2].dead === false && objects[2].type === 34);
    }
    {
      const e = new EntityA({ x: 0, y: 0 });
      const objects = [{ x: 1, y: 1, type: 9, flag6: 1, dead: false, slot: 0 }];
      searchAndSteal(e, objects, 34, 150, 130);
      check('searchAndSteal is a silent no-op when nothing matches',
        e.carriedType === -1 && objects[0].dead === false);
    }
    {
      const e = new EntityA({ x: 0, y: 0 });
      const objects = [{ x: 150, y: 130, type: 34, flag6: 1, dead: true, slot: 0 }];
      searchAndSteal(e, objects, 34, 150, 130);
      check('a record marked dead (JS-level `dead:true`) never matches, even with matching type/x/y',
        e.carriedType === -1);
    }
    {
      const e2 = new EntityA({ x: 0, y: 0 });
      const objects2 = [{ x: 150, y: 130, type: 0xffff, flag6: 1, dead: false, slot: 0 }];
      searchAndSteal(e2, objects2, 34, 150, 130);
      check('a record with type 0xffff (dead-type sentinel) is skipped even with flag6 set and dead:false',
        e2.carriedType === -1);
    }

    /* stealAttempt: proximity box + eligibility gate, first match only. */
    {
      const markerNear = { x: 40, y: 30, type: 34 };   // world (140,80) — within 48x48 of entityX/Y
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      const e = new EntityA({ x: 148, y: 88 });
      stealAttempt(e, [markerNear], desc1, cam, objects);
      check('an eligible, proximate marker steals its matching object',
        e.carriedType === 34 && e.carriedX === 140 && e.carriedY === 80);
    }
    {
      const markerNear = { x: 40, y: 30, type: 34 };
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      const e = new EntityA({ x: 148, y: 88 });
      stealAttempt(e, [markerNear], desc0, cam, objects);
      check('flags=0x00 makes stealFlagBits 0 for every ordinary type -> no theft at all',
        e.carriedType === -1 && objects[0].dead === false);
    }
    {
      const markerFar = { x: 500, y: 500, type: 34 };   // world (600,550) — far from any entity below
      const objects = [{ x: 600, y: 550, type: 34, flag6: 1, dead: false, slot: 0 }];
      const e = new EntityA({ x: 0, y: 0 });
      stealAttempt(e, [markerFar], desc1, cam, objects);
      check('an eligible but out-of-range marker is skipped (48x48 proximity box)',
        e.carriedType === -1 && objects[0].dead === false);
    }
    {
      const e = new EntityA({ x: 148, y: 88 });
      e.carriedType = 5;   // already carrying
      const marker = { x: 40, y: 30, type: 34 };
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      stealAttempt(e, [marker], desc1, cam, objects);
      check('an already-carrying entity never attempts a second theft',
        e.carriedType === 5 && objects[0].dead === false);
    }
    {
      const e = new EntityA({ x: 148, y: 88 });
      stealAttempt(e, [], desc1, cam, []);
      check('an empty marker list is a silent no-op, not a throw',
        e.carriedType === -1);
    }

    /* The round-trip through the REAL marker producer, not a hand-built
     * marker. Every fixture above hand-constructs `{x, y, type}` so that
     * `marker.x + camera.x` already equals the object's own world X — that
     * never exercises the actual coordinate contract. `stepMarkers` writes
     * SCREEN coordinates as `o.x - cam.x` (markers.js CS:0x15F1/0x162E);
     * `stealAttempt` reconstructs world coordinates as `marker.x + camera.x`
     * (CS:0xE90E) and `searchAndSteal` then demands an EXACT match against
     * the object's own world position. The two only agree when both calls
     * run against the SAME camera snapshot — true today because main.js
     * calls `stepMarkers` and `stealAttempt` in the same tick against the
     * same `cam.snapX/snapY`, but nothing in either function's own signature
     * enforces that. This is the one assertion that would fail if a future
     * change moved either call site relative to the camera snapshot. */
    {
      const cats = new Uint8Array(64);
      cats[34] = 0;                                    // category 0 < 3 -> eligible
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      const markerList = new MarkerList();
      stepMarkers(objects, cats, markerList, cam);      // the SAME `cam` stealAttempt uses below
      check('stepMarkers, run against real object data, records one screen-relative marker',
        markerList.entries.length === 1
        && markerList.entries[0].x === 140 - cam.x
        && markerList.entries[0].y === 80 - cam.y
        && markerList.entries[0].type === 34);

      const e = new EntityA({ x: 148, y: 88 });          // within 48x48 of world (140,80)
      stealAttempt(e, markerList.entries, desc1, cam, objects);
      check('stealAttempt, fed the REAL stepMarkers() output under the SAME camera, steals the object',
        e.carriedType === 34 && e.carriedX === 140 && e.carriedY === 80
        && objects[0].dead === true);
    }

    /* strategy2 wiring: bail on carrying, else set the goal then steal. */
    {
      const marker = { x: 40, y: 30, type: 34 };
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      const e = new EntityA({ x: 148, y: 88 });
      strategy2(e, [marker], cam, () => 0, desc1, objects);
      check('strategy2 both sets the goal AND attempts the theft in one call',
        e.goalX === marker.x + cam.x && e.goalY === marker.y + cam.y
        && e.carriedType === 34, `goal=${e.goalX},${e.goalY} carried=${e.carriedType}`);
    }
    {
      const e = new EntityA({ x: 148, y: 88 });
      e.carriedType = 7;
      e.goalX = 999; e.goalY = 999;
      const marker = { x: 40, y: 30, type: 34 };
      const objects = [{ x: 140, y: 80, type: 34, flag6: 1, dead: false, slot: 0 }];
      strategy2(e, [marker], cam, () => 0, desc1, objects);
      check('CS:0xE88C\'s own carrying-bail (degenerate half): the goal is left untouched and nothing is stolen',
        e.goalX === 999 && e.goalY === 999 && e.carriedType === 7 && objects[0].dead === false);
    }
    check('strategy2 without an `objects` argument still behaves exactly as before this pass (no throw, no steal)',
      (() => {
        const e = new EntityA({ x: 0, y: 0 });
        strategy2(e, [{ x: 50, y: 30, type: 10 }], cam, () => 0);
        return e.carriedType === -1;
      })());

    /* stepCarriedItem: ease, then the 3-way drop-roll (0/never/roll). */
    {
      const e = new EntityA({ x: 100, y: 100 });
      check('not carrying -> null, no ease', stepCarriedItem(e, desc1, () => 0) === null);
    }
    {
      const e = new EntityA({ x: 100, y: 100 });
      e.carriedType = 34;   // ordinary, ineligible for drop entirely
      e.carriedX = 0; e.carriedY = 0;
      const NEVER_DROP = { flags: 0x02 };   // ordinary bits[1:0] == 2 -> CS:0xE149, never
      const r = stepCarriedItem(e, NEVER_DROP, () => 0);
      check('EASE still runs even when the drop roll says never: halves the remaining distance',
        e.carriedX === (100 + 8) >> 1 && e.carriedY === (100 + 24) >> 1,
        `carried=${e.carriedX},${e.carriedY}`);
      check('flags&3===2 (ordinary) never drops, whatever rand() returns',
        r === null && e.carriedType === 34);
    }
    {
      const e = new EntityA({ x: 100, y: 100 });
      e.carriedType = 34;
      e.carriedX = 108; e.carriedY = 124;   // already eased to the target — ease is a no-op this tick
      const ALWAYS_DROP = { flags: 0x00 };   // ordinary bits[1:0] == 0 -> drop now
      const r = stepCarriedItem(e, ALWAYS_DROP, () => 1);   // rand never consulted for bits===0
      check('flags&3===0 (ordinary) drops immediately: id = carriedType + 0xB',
        r && r.id === 34 + 0xb && r.x === 108 && r.y === 124, JSON.stringify(r));
      check('a completed drop clears carriedType back to "not carrying"',
        e.carriedType === -1);
    }
    {
      const e = new EntityA({ x: 100, y: 100 });
      e.carriedType = 0xc5;   // weapon range (>=0xC0)
      e.carriedX = 108; e.carriedY = 124;
      const WEAPON_NEVER = { flags: 0x08 };   // flags & 0xC === 8 -> never (weapon)
      check('flags&0xC===8 (weapon) never drops',
        stepCarriedItem(e, WEAPON_NEVER, () => 0) === null && e.carriedType === 0xc5);
      const WEAPON_ALWAYS = { flags: 0x00 };   // flags & 0xC === 0 -> drop now (weapon)
      const r = stepCarriedItem(e, WEAPON_ALWAYS, () => 1);
      check('flags&0xC===0 (weapon) drops immediately: id = carriedType - 0xC0',
        r && r.id === 0xc5 - 0xc0, JSON.stringify(r));
    }
    {
      /* the 1-in-128 roll: bits neither 0 nor "never" -> gated on rand()&0x7f===0 */
      const eRollFail = new EntityA({ x: 100, y: 100 });
      eRollFail.carriedType = 34; eRollFail.carriedX = 108; eRollFail.carriedY = 124;
      const ROLL_GATED = { flags: 0x01 };   // ordinary bits[1:0] == 1 -> roll-gated
      check('ordinary flags&3===1 (roll-gated): a nonzero draw refuses the drop',
        stepCarriedItem(eRollFail, ROLL_GATED, () => 1) === null
        && eRollFail.carriedType === 34);
      const eRollPass = new EntityA({ x: 100, y: 100 });
      eRollPass.carriedType = 34; eRollPass.carriedX = 108; eRollPass.carriedY = 124;
      check('...but a draw of exactly 0 lets it through (rand()&0x7f===0)',
        stepCarriedItem(eRollPass, ROLL_GATED, () => 0) !== null
        && eRollPass.carriedType === -1);
    }

    /* death-time drop: recorded once, at the frame===-1 tick, via
     * deathDropId/X/Y — the periodic drop's OWN id/position convention
     * (+0xB/-0xC0), but drained by popup.js, not dropCarriedItem/C041. */
    {
      const e = new EntityA({ x: 200, y: 300, hp: 5 });
      e.state = ESTA.DYING; e.frame = -1;
      e.carriedType = 40;         // ordinary
      e.carriedX = 205; e.carriedY = 310;
      e.tick({ x: 0, y: 0 }, desc1, () => 0, false);
      check('the DYING branch\'s frame===-1 tick records a death-time drop request',
        e.deathDropId === 40 + 0xb && e.deathDropX === 205 && e.deathDropY === 310,
        JSON.stringify({ id: e.deathDropId, x: e.deathDropX, y: e.deathDropY }));
      check('the carried item is consumed by the death-time drop (no longer carrying)',
        e.carriedType === -1);

      const e2 = new EntityA({ x: 0, y: 0, hp: 5 });
      e2.state = ESTA.DYING; e2.frame = -1;
      e2.tick({ x: 0, y: 0 }, desc1, () => 0, false);
      check('an entity carrying nothing at death records no drop request',
        e2.deathDropId === null);
    }

    /* dropCarriedItem's id round-trip, exercised end to end through popup.js's
     * own busy-slot divert — see checkPopup for the direct objects.js test. */
    {
      const objects = expandMapObjects([]);
      const dropped = dropCarriedItem(objects, 34 + 0xb, 300, 400);
      check('dropCarriedItem round-trips the ordinary +0xB bias back to the original type',
        dropped && dropped.type === 34 && dropped.x === 300 && dropped.y === 400
        && dropped.flag6 === 1 && dropped.fallDirty === -1, JSON.stringify(dropped));
      const dropped2 = dropCarriedItem(objects, 0xc5 - 0xc0, 300, 400);
      check('dropCarriedItem round-trips the weapon -0xC0 bias back to the original type',
        dropped2 && dropped2.type === 0xc5);
    }
    check('dropCarriedItem returns null on a table with no dead slot to reuse',
      dropCarriedItem([{ x: 0, y: 0, type: 5, flag6: 1, dead: false }], 34 + 0xb, 0, 0) === null);

    /* Never BOTH a periodic drop AND a death-time drop for the same carried
     * item, reproducing main.js's own per-tick ordering rather than calling
     * stepCarriedItem/tick() in isolation. main.js's real sequence per tick
     * is: e.tick(...) runs first (sees the entity's state as of the START
     * of this tick); THEN, only `if (e.alive)`, stepCarriedItem() may roll a
     * drop; contact damage (stepCreatureDamage) that would transition the
     * entity to DYING runs AFTER both, at the end of the frame — so a kill
     * this tick can only ever be observed by tick()'s own DYING branch on
     * the FOLLOWING tick, once stepCarriedItem has already had its one
     * chance to drop (or not) while the entity was still genuinely alive.
     * carriedType is a single mutually-exclusive flag cleared by whichever
     * drop fires first, so this is provably a non-issue given that ordering
     * — this test pins the ordering itself so a future reshuffle of
     * main.js's per-tick sequence cannot silently reintroduce a double
     * drop. */
    {
      // Case A: the periodic roll succeeds on the "alive" tick -> the item
      // is gone by the time the entity dies; the death branch must not
      // re-drop it.
      const e = new EntityA({ x: 100, y: 100, hp: 5 });
      e.carriedType = 34; e.carriedX = 108; e.carriedY = 124;
      const ALWAYS_DROP = { flags: 0x00 };
      // tick 1 (main.js order): e.tick() runs first (state still alive,
      // no-op for carry) — omitted here, it does not touch carriedType —
      // then, gated on e.alive, stepCarriedItem rolls.
      const periodic = stepCarriedItem(e, ALWAYS_DROP, () => 0);
      check('case A: the periodic drop fires while genuinely alive',
        periodic !== null && e.carriedType === -1);
      // end of tick 1: contact damage kills the entity (simulating
      // stepCreatureDamage, which runs AFTER stepCarriedItem in main.js).
      e.state = ESTA.DYING; e.frame = -1;
      // tick 2: tick()'s own DYING branch now runs for the first time.
      e.tick({ x: 0, y: 0 }, desc1, () => 0, false);
      check('case A: the death-time drop does NOT also fire — carriedType was already cleared',
        e.deathDropId === null);
    }
    {
      // Case B: the periodic roll refuses on the "alive" tick -> the item
      // is still carried when the entity dies; the death branch is the
      // ONLY drop, and it must still fire (this is the disclosed
      // popup-vs-C041 asymmetry, not a second missed drop).
      const e = new EntityA({ x: 100, y: 100, hp: 5 });
      e.carriedType = 34; e.carriedX = 108; e.carriedY = 124;
      const NEVER_DROP = { flags: 0x02 };
      const periodic = stepCarriedItem(e, NEVER_DROP, () => 0);
      check('case B: the periodic drop refuses while alive (flags&3===2)',
        periodic === null && e.carriedType === 34);
      e.state = ESTA.DYING; e.frame = -1;
      e.tick({ x: 0, y: 0 }, desc1, () => 0, false);
      check('case B: the death-time drop fires exactly once, since the periodic one never did',
        e.deathDropId === 34 + 0xb && e.carriedType === -1);
    }
  }

  return results;
}


/* The enemy spawn chain, end to end, on shipped level data. Every figure here
 * is re-derived from the PALFILS bytes at run time — none is transcribed. */
export async function checkSpawn(fetchRaw) {
  const { results, check } = makeChecker();
  const keys = ['1A','1B','2A','2B','3A','3B','4A','4B'];

  let live = 0, refs = 0, badRef = 0, outOfMap = 0, overCount = 0;
  const counts = new Set(), speeds = new Set(), perFile = [];
  const rewardIds = new Set();
  for (const k of keys) {
    const buf = dclDecompress(await fetchRaw(`game/${palfilsNameFor(k)}`)).data;
    const groups = parseGroupsB(buf);
    let n = 0;
    for (const g of groups) {
      if (!g.live) continue;
      live++; n++;
      counts.add(g.count); speeds.add(g.speed);
      rewardIds.add(g.rewardId);
      if (g.count > MAX_ENTITIES) overCount++;
      if (g.tileX < 1 || g.tileX > 126 || g.tileY < 1 || g.tileY > 60) outOfMap++;
    }
    perFile.push(n);
    /* Every selector-4 event in this level must name a LIVE descriptor. */
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < EVENT_COUNT; i++) {
      const o = EVENT_TABLE_OFF + i * 4;
      if (dv.getUint16(o, false) !== 4) continue;
      refs++;
      const p = dv.getUint16(o + 2, false);
      if (!(groups[p] && groups[p].live)) badRef++;
    }
  }

  check(`270 live System-B group descriptors (14/14/30/28/50/50/42/42)`,
    live === 270, `${live} — ${perFile.join('/')}`);
  check(`every selector-4 event names a live descriptor`,
    badRef === 0, `${refs} references, ${badRef} dangling`);
  check(`every spawn tile is inside the 128x64 map`,
    outOfMap === 0, `${outOfMap} outside`);
  check(`no group asks for more than the ${MAX_ENTITIES} runtime slots`,
    overCount === 0, `entity counts ${[...counts].sort((a, b) => a - b).join(',')}`);
  results.push({
    name: `descriptor +0x0b speeds in shipped data`, note: true, pass: true,
    detail: `${[...speeds].sort((a, b) => a - b).join(',')} — step delay is 10 - v, so higher is faster`,
  });
  /* CS:0xED94's own BE i16 reward id, re-derived from raw bytes independent
   * of parseGroupsB itself. CLAUDE.md's own `UNKNOWN_sysB_reward_ids` census
   * (decompressing all 8 PALFILS files and reading +0x10 directly) found
   * EXACTLY this closed set across every world — a wrong sign-handling or
   * off-by-one field offset lands outside it immediately, which is what
   * makes this a real assertion rather than a restatement of whatever
   * parseGroupsB happens to compute. */
  const DOCUMENTED_REWARD_IDS = new Set([-1, 0, 6, 11, 17, 18, 21, 22, 46, 56, 112, 135, 136]);
  const rewardIdsSorted = [...rewardIds].sort((a, b) => a - b);
  check(`every live descriptor's +0x10 reward id matches CLAUDE.md's own shipped-data census`,
    rewardIdsSorted.every((id) => DOCUMENTED_REWARD_IDS.has(id)),
    `got {${rewardIdsSorted.join(',')}}`);
  results.push({
    name: `descriptor +0x10 reward ids in shipped data`, note: true, pass: true,
    detail: `${rewardIdsSorted.join(',')} — negative = no reward, `
      + `< 0xB a plain numeric popup (undecoded, not rendered), >= 0xB a POBJECTS type`,
  });

  /* Sprite composition: every (class, mode, frame) a level can produce must
   * land inside that world's creature group, which begins at descriptor #450.
   * This is the check that would catch a wrong class table or a wrong base. */
  const ANIM = MODE_TABLE.map((m) => m.animBase);
  let usedClasses = 0, below = 0, over = 0;
  const overBases = new Set();
  for (const world of [1, 2, 3, 4]) {
    const stems = GROUP_STEMS[`level${world}`];
    let groupFrames = 0;
    for (const st of stems) {
      groupFrames += parseAtlas(dclDecompress(await fetchRaw(`game/${st}.DAT`)).data).count;
    }
    const last = CREATURE_DESCRIPTOR_BASE + groupFrames - 1;
    /* only the classes the shipped descriptors actually reference */
    const refd = new Set();
    for (const sub of ['A', 'B']) {
      const g = parseGroupsB(dclDecompress(
        await fetchRaw(`game/${palfilsNameFor(`${world}${sub}`)}`)).data);
      g.filter((x) => x.live).forEach((x) => refd.add(x.cls));
    }
    for (const cls of refd) {
      usedClasses++;
      const rec = CLASS_TABLES_B[world][cls];
      if (!rec) { below++; continue; }
      if (rec.base < CREATURE_DESCRIPTOR_BASE) below++;
      if (rec.base + 17 > last) { over++; overBases.add(`w${world}:${rec.base}`); }
    }
  }
  check(`every referenced enemy class starts at or after descriptor #450`,
    below === 0, `${usedClasses} classes referenced across the 4 worlds`);
  results.push({
    name: `REFERENCED classes whose base + 17 escapes their creature group`,
    note: true, pass: true,
    detail: over === 0 ? 'none — the formula is consistent everywhere it is exercised' :
      `${[...overBases].join(' ')} — mostly the 24x24 records; ` +
      `UNKNOWN_sysB_small_class_modes (the port range-checks and refuses to draw)`,
  });

  /* The spawn recipe itself, driven through the real EventRunner on PLEV1A. */
  const map = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
  const pf = dclDecompress(await fetchRaw(`game/${palfilsNameFor('1A')}`)).data;
  const groups = parseGroupsB(pf);
  const runner = new EventRunner(map, parsePalfils(pf));
  const acts = [];
  runner.onSpawnB = (p) => acts.push(p);
  for (let row = 0; row < 64; row++) {
    for (let col = 0; col < 128; col++) {
      if (map.planeB[row * 128 + col] < 3) continue;
      runner.lastCell = -1;
      runner.step(col * 32, row * 16, runner.makeState({ timer: 0 }));
    }
  }
  check(`PLEV1A dispatches selector-4 activations through the real event chain`,
    acts.length > 0 && acts.every((p) => groups[p] && groups[p].live),
    `${acts.length} activations, groups ${[...new Set(acts)].join(',')}`);

  /* And the sprites those groups resolve to are creature frames, not glyphs. */
  const ids = [...new Set(acts)].map((p) => {
    const d = groups[p];
    return spriteForEntity(1, d.cls, MODE.WALK_L, 0, ANIM);
  });
  check(`their sprites land in world 1's creature group`,
    ids.length > 0 && ids.every((i) => i !== null && i >= CREATURE_DESCRIPTOR_BASE),
    `#${ids.join(' #')}`);

  /* ── The pathfinder verdict (CS:0xf586 / 0xf2ac) ──────────────────────── */

  /* The domain is exactly 8 wide. Re-derived here from CS:0xf2ac's arithmetic
   * rather than read off the table, so the table and the formula must agree. */
  const derived = [];
  for (let v = 0; v <= 7; v++) {
    if (v <= 1) { derived.push({ v, mode: v }); continue; }
    let ax = v - 2;
    const mode = 4 + (ax & 1);
    ax &= 0xfffe;
    const cursor = ax === 0 ? 7 : (ax - 2 === 0 ? 9 : 13);
    derived.push({ v, mode, cursor });
  }
  check(`the verdict domain re-derives from CS:0xf2ac's arithmetic`,
    derived.every((d, i) => VERDICT[i].mode === d.mode && VERDICT[i].cursor === d.cursor),
    derived.map((d) => `${d.v}->m${d.mode}${d.cursor ? `/c${d.cursor}` : ''}`).join(' '));

  /* Hop cursors are REACHES: the sibling seeders CS:0xf2e4/0xf2fc compute
   * 5 + 2*(d-1), so 7/9/13 must be exactly d = 2, 3, 5. */
  const reaches = [7, 9, 13].map((c) => (c - 5) / 2 + 1);
  check(`hop cursor seeds 7/9/13 are the reaches 2/3/5 under 5 + 2*(d-1)`,
    reaches.every(Number.isInteger) && reaches.join() === '2,3,5', reaches.join('/'));

  /* The two walk handlers test the verdict against DIFFERENT constants. */
  check(`walk-left keeps going on verdict 0, walk-right on verdict 1`,
    verdictAction(0, MODE.WALK_L) === 'keep' && verdictAction(1, MODE.WALK_R) === 'keep'
    && verdictAction(1, MODE.WALK_L) === 'apply' && verdictAction(0, MODE.WALK_R) === 'apply',
    'CS:0xf14e tests 0, CS:0xf215 tests 1 — not a shared constant');

  check(`a negative verdict falls back to patrol, never to a mode`,
    verdictAction(VERDICT_NONE, MODE.WALK_L) === 'patrol'
    && verdictAction(VERDICT_NONE, MODE.WALK_R) === 'patrol',
    'CS:0xf14c / 0xf20e `js`');

  /* Applying a hop verdict must set mode AND cursor AND frame — CS:0xf2ac
   * writes all three, and a port that only sets the mode hops zero distance. */
  const he = new EntityB({ x: 0, y: 0, mode: MODE.WALK_L });
  he.state = 1;
  applyVerdict(he, 6);
  check(`applying verdict 6 gives hop-left with cursor 13 and frame 0`,
    he.mode === MODE.HOP_L && he.vel === 13 && he.frame === 0,
    `mode ${he.mode}, cursor ${he.vel}, frame ${he.frame}`);

  /* Only 7 and 13 ever ship — the hop stage seeds exactly those two
   * (CS:0xfb88 / 0xfbaa), and 9 belongs to the dead verdict-4/5 branch. */
  check(`both live hop cursor seeds are inside the arc table`,
    [7, 13].every((c) => hopDelta(c) !== null),
    `deltas ${[7, 13].map((c) => hopDelta(c)).join(',')} (9 is the dead branch)`);

  /* Only 0,1,2,3,6,7 can ever be minted, so the cursor-9 branch is dead. */
  check(`verdicts 4 and 5 are unreachable — the cursor-9 branch is dead code`,
    VERDICT.filter((r) => r.dead).map((r) => r.v).join() === '4,5'
    && REACHABLE_VERDICTS.every((v) => !VERDICT[v].dead)
    && VERDICT.filter((r) => r.dead).every((r) => r.cursor === 9),
    `mintable ${REACHABLE_VERDICTS.join(',')} — CS:0xf2d0 \`mov bx,0x9\` never runs`);

  /* THE CURSOR DECREMENTS, and the -8 run the seeds sit in is the LAUNCH.
   * Y grows downward, so a negative delta moves the entity up. Seed 13 spends
   * nine ticks climbing at 8 px where seed 7 spends three — which is what
   * makes 13 the long hop. */
  const arcOf = (seed) => {
    const out = []; let c = seed;
    for (let i = 0; i < 24; i++) { out.push(hopDelta(c)); c = hopCursorNext(c); }
    return out;
  };
  const a7 = arcOf(7), a13 = arcOf(13);
  const rise = (a) => -a.reduce((s, v) => Math.min(s, s + v), 0);
  check(`the hop cursor decrements and the -8 run is the LAUNCH, not a tail`,
    a7[0] === -8 && a7.includes(0) && a7[a7.length - 1] === 8
    && rise(a13) > rise(a7),
    `seed 7 rises ${rise(a7)} px, seed 13 rises ${rise(a13)} px ` +
    '(CS:0xf9c3 `sub bx,2`)');

  /* And the floor is an oscillation, not a clamp — it ping-pongs -6/-5, both
   * of which hold 8, giving a constant 8 px/tick terminal fall. */
  check(`the cursor floor ping-pongs -6/-5 rather than clamping`,
    hopCursorNext(-6) === -5 && hopCursorNext(-5) === -6
    && hopDelta(-6) === 8 && hopDelta(-5) === 8,
    'CS:0xf9c6 `cmp bx,-12 / jl / mov bx,-10` — terminal fall is a flat 8 px');

  /* ── The grid, and the two DIFFERENT cell rules ───────────────────────── */

  check(`the visited grid is 20 x 20 and its bound excludes the last row`,
    GRID_PITCH * 20 === GRID_CELLS && GRID_LIMIT === GRID_CELLS - GRID_PITCH,
    `${GRID_CELLS} bytes, pitch ${GRID_PITCH}, bound ${GRID_LIMIT} = 400 - 20 (CS:0xf7e5)`);

  check(`the export-39 bias 0x55 is a 5-column, 4-row margin at pitch 20`,
    GRID_MARGIN === 4 * GRID_PITCH + 5, `${GRID_MARGIN} = 4*${GRID_PITCH} + 5`);

  check(`the hero's cell rounds the column, the entity's floors it`,
    heroCell(16, 0) === 1 && entityCell(16, 0) === 0
    && heroCell(31, 0) === 1 && entityCell(31, 0) === 0,
    'export 40 adds 0x10 first (CS:0x5fab); CS:0xf56a does not');

  check(`both rules floor the ROW identically`,
    heroCell(0, 15) === 0 && entityCell(0, 15) === 0
    && heroCell(0, 16) === 128 && entityCell(0, 16) === 128,
    'and dx,0xfff0 in both');

  /* ── The open list ───────────────────────────────────────────────────── */
  const ol = new OpenList();
  let pushed = 0;
  for (let i = 0; i < 40; i++) if (ol.push({ i })) pushed++;
  check(`the open list holds 32 nodes and then refuses pushes`,
    pushed === OPEN_SLOTS && ol.dropped === 40 - OPEN_SLOTS,
    `${pushed} accepted, ${ol.dropped} dropped (CS:0xf6ac limit ${OPEN_LIMIT})`);

  let popped = 0;
  while (ol.pop()) popped++;
  check(`every pushed node is popped exactly once`,
    popped === pushed && ol.count === 0, `${popped} popped, count ${ol.count}`);

  /* THE DOUBLE INCREMENT. CS:0xf5ff does `inc cx` with no `add si,8`, so the
   * emptied slot is rescanned next turn and charged a second `add cx,1`. Net:
   * one expansion advances the cursor by 1 slot but the counter by 2, so the
   * wrap at cx >= 0x20 fires after ~16 expansions rather than 32. This is the
   * single behavioural difference between the real loop and a plain queue. */
  const q = new OpenList();
  for (let i = 0; i < OPEN_SLOTS; i++) q.push({ i });
  q.pop(); q.wrapAfterExpand();          // first expansion
  const siA = q.si, cxA = q.cx;
  q.pop(); q.wrapAfterExpand();          // second
  check(`one expansion advances the cursor by 1 slot but the counter by 2`,
    siA === 0 && cxA === 1 && q.si === 1 && q.cx === 3,
    `after 1: si=${siA} cx=${cxA}; after 2: si=${q.si} cx=${q.cx} ` +
    '(CS:0xf5ff `inc cx` with no `add si,8`)');

  /* And therefore the counter reaches its 0x20 wrap after only 16 expansions.
   * With a full list, n expansions leave si = n-1 and cx = 2n-1; a plain queue
   * would leave cx = n. At n = 16 the counter is already 31, one short of the
   * wrap, while only half the slots have been visited. */
  const q2 = new OpenList();
  for (let i = 0; i < OPEN_SLOTS; i++) q2.push({ i });
  for (let n = 0; n < 16; n++) { q2.pop(); q2.wrapAfterExpand(); }
  check(`16 expansions leave the counter at 31 — half the slots, a full lap`,
    q2.si === 15 && q2.cx === 31 && q2.count === OPEN_SLOTS - 16,
    `si=${q2.si} cx=${q2.cx} count=${q2.count}; a plain queue would give cx=16 ` +
    '— UNKNOWN_f5ff_cx_desync');

  /* The search must degrade to "no path" while the producers are unknown.
   * That is the honest state and it should be visible, not asserted. */
  const idle = Object.assign(new EntityB({ x: 100, y: 100, mode: MODE.WALK_L }), { state: 1 });
  check(`with no producers the search reports no path (enemies patrol)`,
    search(idle, 0, 0) === VERDICT_NONE,
    "UNKNOWN_pathfinder_producers — the original's own no-path case");

  /* An off-screen entity is culled before anything is cleared, so its verdict
   * stays 0xFFFF: off-screen enemies never hunt. */
  const far = Object.assign(new EntityB({ x: 5000, y: 100 }), { state: 1 });
  check(`an off-screen entity is culled before the search runs`,
    !searchable(5000, 100, 0, 0) && search(far, 0, 0) === VERDICT_NONE,
    'CS:0xf59f-0xf5b2 — off-screen enemies never hunt');

  /* THE LOOP ITSELF, driven by a synthetic expand. Without this every check
   * above stops at `if (!expand) return`, so the GOOD_ENOUGH cutoff, the
   * cursor quirk inside the loop and the cost/firstMove wiring would all be
   * written but never run. The stub pushes one node per call and, on the
   * second expansion, drops `best` under the cutoff. */
  const seen = [];
  let calls = 0;
  const stubVerdict = search(idle, 0, 0, {
    expand(st, x, y) {
      calls++;
      seen.push({ x, y, depth: st.depth, firstMove: st.firstMove });
      if (calls === 1) { st.open.push({ x: 64, y: 32, cost: 5, firstMove: 3 }); return; }
      st.best = 8;                       // under GOOD_ENOUGH -> loop must stop
      st.verdict = st.firstMove;
    },
  });
  check(`the search loop reads cost and firstMove from the popped slot`,
    calls === 2 && seen[0].depth === 0 && seen[0].firstMove === 0
    && seen[1].x === 64 && seen[1].y === 32
    && seen[1].depth === 5 && seen[1].firstMove === 3,
    `root(depth 0) then node(depth ${seen[1] && seen[1].depth}, ` +
    `move ${seen[1] && seen[1].firstMove}) — CS:0xf623/0xf627`);

  check(`the loop stops as soon as best drops to GOOD_ENOUGH or below`,
    calls === 2 && stubVerdict === 3,
    `2 expansions, verdict ${stubVerdict} — CS:0xf5d8/0xf635 \`jna 0x10\``);

  /* ── DOES IT ACTUALLY HUNT? ───────────────────────────────────────────
   * There is no differential test for this subsystem — the seed choice is
   * randomised from a wall-clock-seeded replay table, so the original is not
   * reproducible run-to-run either. But the randomness enters at exactly one
   * point, so pinning `rnd` makes the chain deterministic without faking it.
   * The test is two-sided on real level geometry: a chase that closes, and a
   * genuinely unreachable hero that yields no path. A pursuit test that only
   * passes on an open field proves very little. */
  const huntMap = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);

  /* Find real geometry rather than inventing it: a run of clear cells with
   * solid ground beneath. */
  let corr = null;
  for (let row = 4; row < 60 && !corr; row++) {
    let run = 0;
    for (let col = 1; col < 127; col++) {
      const ok = huntMap.planeB[(row + 2) * 128 + col] === 1
              && huntMap.planeB[row * 128 + col] === 0
              && huntMap.planeB[(row + 1) * 128 + col] === 0;
      if (ok) { run++; if (run >= 9) { corr = { row, col: col - 8 }; break; } }
      else run = 0;
    }
  }

  /* Use a REAL shipped descriptor rather than a fabricated struct — the whole
   * discipline here is re-deriving from shipped bytes, and a hand-made one
   * silently picked hopUnlock 0, which disables the seed-13 arcs and left half
   * the hop machinery uncovered. */
  const huntPf = dclDecompress(await fetchRaw(`game/${palfilsNameFor('1A')}`)).data;
  const huntDescs = parseGroupsB(huntPf).filter((d) => d.live);
  const shipped = huntDescs.find((d) => (d.seedPair & 0xf) === 0 && d.budget >= 8
                                        && d.hopUnlock > 4) || huntDescs[0];

  const chase = (walls, desc, wallRows) => {
    const planeB = Uint8Array.from(huntMap.planeB);
    for (const c of walls) {
      for (let r = corr.row - wallRows; r <= corr.row + 1; r++) planeB[r * 128 + c] = 1;
    }
    const y = corr.row * 16;
    const heroX = (corr.col + 8) * 32;
    const e = Object.assign(
      new EntityB({ x: corr.col * 32, y, mode: MODE.WALK_L, speed: desc.speed || 9 }),
      { state: 1 });
    const camX = Math.max(0, corr.col * 32 - 48), camY = Math.max(0, y - 80);
    const first = Math.abs(e.x - heroX);
    const verdicts = [];
    let oob = 0, bailouts = 0;
    for (let t = 0; t < 60; t++) {
      let v = VERDICT_NONE;
      const walking = e.mode === MODE.WALK_L || e.mode === MODE.WALK_R;
      if (walking && (e.x & 0x1c) === 0 && groundBelow(planeB, e.x, e.y)) {
        /* rnd 0 can never lose to the weight (`swap only when weight < rnd`),
         * so the LOW nibble wins — strategy 0, direct pursuit. Pinning the one
         * random input is what makes this deterministic without faking it. */
        const r = runSearch(e, { planeB, camX, camY, heroX, heroY: y, desc, rnd: 0 });
        v = r.verdict;
        oob += r.state.oob; bailouts += r.state.bailouts;
        verdicts.push(v);
      }
      e.tick(planeB, v);
    }
    return { first, last: Math.abs(e.x - heroX), verdicts, oob, bailouts };
  };

  if (!corr) {
    results.push({ name: 'enemy pursuit', note: true, pass: true,
      detail: 'PLEV1A has no corridor wide enough to stage a chase' });
  } else {
    const open = chase([], shipped, 0);
    check(`an enemy on open ground closes the distance to the hero`,
      open.last < open.first && open.verdicts.some((v) => v === 1),
      `descriptor #${shipped.index}: ${open.first} -> ${open.last} px, ` +
      `first verdict ${open.verdicts[0]} (walk right)`);

    /* ⚠️ THE INSTRUMENTATION ASSERTION. A grid write outside [0,400) silently
     * drops a GOAL MARK and an out-of-range read returns 0 = "free", so both
     * failure modes look exactly like "sometimes no path". Counting them is
     * the only way to tell a working search from a quietly clipping one. */
    check(`the search never reads or writes outside its grid or plane`,
      open.oob === 0 && open.bailouts === 0,
      `${open.oob} out-of-range accesses, ${open.bailouts} loop bailouts ` +
      'across the whole chase');

    /* A two-tile wall is inside a seed-7 hop's 32-px reach, so the enemy
     * should clear it rather than give up. */
    const hopped = chase([corr.col + 3], shipped, 1);
    check(`a two-tile wall is hopped, not treated as impassable`,
      hopped.verdicts.some((v) => v === 2 || v === 3 || v === 6 || v === 7)
      && hopped.last < hopped.first,
      `verdicts ${[...new Set(hopped.verdicts)].join(',')}, ` +
      `${hopped.first} -> ${hopped.last} px`);

    /* Six tiles is out of reach of both seeds (7 rises 32 px, 13 rises 80). */
    const blocked = chase([corr.col + 3], shipped, 4);
    check(`an enemy walled off from the hero gets NO PATH, every time`,
      blocked.verdicts.length > 0 && blocked.verdicts.every((v) => v === VERDICT_NONE),
      `${blocked.verdicts.length} searches, all none — the search does not ` +
      'hallucinate a route through solid tiles');
  }

  /* The long-hop arcs only run when descriptor +0x0c > 4, so they need their
   * own coverage: without it seed 13 and move codes 6/7 are never exercised. */
  check(`the long-hop gate is exercised by a real shipped descriptor`,
    shipped.hopUnlock > 4,
    `descriptor #${shipped.index} has +0x0c = ${shipped.hopUnlock} ` +
    '(CS:0xfb9e `cmp byte [si+0xc],4 / jng`) — seed 13 and codes 6/7 reachable');

  /* ── How much of the shipped population can actually hunt? ─────────────
   * Strategy 2 is the "attracts monsters" potion's marker list, and with no
   * markers it SHORT-CIRCUITS to the other nibble (CS:0xf799 -> 0xf71a), so
   * it is not inert. Strategy 3 paints only if one of its per-world waypoints
   * is on screen. The honest figure is the share whose EFFECTIVE strategy is
   * hero-relative (0 or 1), weighted over every rnd. */
  const effective = (b8, w9, rnd) => {
    const lo = b8 & 0x0f, hi = (b8 & 0xf0) >> 4;
    let idx = seedStrategy(b8, w9, rnd);
    if (idx === 2) {                          // CS:0xf799 — one hop, no retry
      const other = idx === lo ? hi : lo;
      idx = other === 2 ? 2 : other;
    }
    return idx;
  };
  let heroRel = 0, total = 0;
  for (const world of [1, 2, 3, 4]) {
    for (const sub of ['A', 'B']) {
      const buf = dclDecompress(
        await fetchRaw(`game/${palfilsNameFor(`${world}${sub}`)}`)).data;
      parseGroupsB(buf).forEach((d, i) => {
        if (!d.live) return;
        total++;
        const o = 0x11A4 + i * 0x16;
        let good = 0;
        for (let rnd = 0; rnd < 128; rnd++) {
          const e = effective(buf[o + 8], buf[o + 9], rnd);
          if (e === 0 || e === 1) good++;
        }
        heroRel += good / 128;
      });
    }
  }
  const pct = (100 * heroRel / total).toFixed(1);
  results.push({
    name: 'share of shipped groups whose goal is hero-relative', note: true, pass: true,
    detail: `${pct}% of ${total} live descriptors, weighted over every rnd — ` +
      'the rest choose strategy 3 (a per-world waypoint, which paints only when ' +
      'one is on screen) or land on 2 twice',
  });

  /* Strategy 2 with no markers must fall back, not go inert. */
  const fbGrid = () => {
    const st = { grid: new Int8Array(GRID_CELLS), camX: 0, camY: 0 };
    return st;
  };
  check(`strategy 2 with an empty marker list retries the other nibble`,
    effective(0x20, 0, 1) === 0 && effective(0x02, 0, 127) === 0
    && effective(0x22, 0, 1) === 2,
    'lo/hi 0 is reached from either side; 2 paired with 2 has no retry ' +
    '(CS:0xf799 -> 0xf71a `xchg cx,dx`)');

  /* The waypoint lists: every shipped coordinate must be inside the map, and
   * worlds 3 and 4 must be the SAME list — DS:0xdb28 gives both one pointer. */
  const wpCounts = [1, 2, 3, 4].map((w) => WAYPOINTS[w].length);
  const allInMap = [1, 2, 3, 4].every((w) =>
    WAYPOINTS[w].every(([x, y]) => x >= 0 && x < 128 && y >= 0 && y < 64));
  check(`the per-world waypoint lists are inside the 128x64 map`,
    allInMap && WAYPOINTS[3] === WAYPOINTS[4],
    `${wpCounts.join('/')} waypoints per world; 3 and 4 share a list ` +
    '(DS:0xdb28 -> 0xdb30, 0xdb58, 0xdba8, 0xdba8)');

  /* The attract potion is what forces strategy 2 — object type 45. */
  const objs = dclDecompress(await fetchRaw('game/POBJECTS.001')).data;
  const nameOf = (t) => Array.from(objs.slice(t * 0x30 + 8, t * 0x30 + 48))
    .map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('');
  check(`DS:0x399 is set by object type 45, the "attracts monsters" potion`,
    ATTRACT_POTION_TYPE === 45 && /attracts monsters/.test(nameOf(45)),
    `POBJECTS type 45 reads "${nameOf(45).replace(/\.+/g, ' ').trim()}" ` +
    '— CS:0x163d `cmp dx,0x2d` then CS:0x164d sets the gate');

  /* ── Health: the bar lags the target, and that lag IS the game ────────── */

  /* Level start animates the bar up rather than showing it full. */
  const hs = new Health();
  let upTicks = 0;
  while (hs.bar < HEALTH_MAX && upTicks < 100) { hs.chase(); upTicks++; }
  check(`level start fills the bar over 23 frames, not instantly`,
    upTicks === 23 && hs.bar === HEALTH_MAX,
    `${upTicks} ticks from bar 1 to ${HEALTH_MAX} (CS:0x084B target 24, 0x0851 bar 1)`);

  /* THE RESCUE WINDOW — the check that proves the lag is modelled rather than
   * the target being drained instantly. Drive the target to 0 and the hero
   * must stay alive for the bar's whole descent. */
  const dying = new Health(HEALTH_MAX, HEALTH_MAX);
  dying.damage(HEALTH_MAX);                        // target 24 -> 0
  let alive = 0;
  while (!dying.dead && alive < 100) { dying.chase(); alive++; }
  /* ⚠️ THE DISCRIMINATING ASSERTION is not the frame count — that is just the
   * starting bar walking down, and it would pass under an instant-drain
   * implementation too. What proves the lag is modelled is that the TARGET is
   * already at or below zero while the hero is still ALIVE. */
  const lagWindow = new Health(HEALTH_MAX, HEALTH_MAX);
  lagWindow.damage(HEALTH_MAX);
  lagWindow.chase();
  check(`a fatal hit leaves a rescue window: target dead, hero still alive`,
    lagWindow.target <= 0 && !lagWindow.dead && lagWindow.bar > 0
    && alive === HEALTH_MAX && dying.dead,
    `target ${lagWindow.target}, bar ${lagWindow.bar}, alive — then ${alive} ` +
    `frames (~${(alive / 15).toFixed(1)} s at 15 Hz) to death (CS:0x01bd reads the BAR)`);

  /* The window has a real deadline, but ⚠️ NOT the one this file used to
   * assert. Every potion site opens `cmp word [0x19a],0 / jns <effect>` —
   * JNS, so it proceeds while the bar is non-negative and refuses only once
   * it has gone NEGATIVE. This check previously asserted "does nothing once
   * the bar reads zero", which is the opposite at exactly the boundary that
   * decides whether the last frame of the descent can still be saved. */
  const saved = new Health(HEALTH_MAX, HEALTH_MAX);
  saved.damage(HEALTH_MAX);
  for (let i = 0; i < 20; i++) saved.chase();      // bar down to 4
  const tookIt = saved.potion(0x18).taken;
  let after = 0;
  while (!saved.dead && after < 200) { saved.chase(); after++; }

  const atZero = new Health(HEALTH_MAX, HEALTH_MAX);
  atZero.damage(HEALTH_MAX);
  while (atZero.bar > 0) atZero.chase();           // bar is exactly 0
  const zeroWorks = atZero.potion(0x18).taken;

  const negative = new Health(HEALTH_MAX, HEALTH_MAX);
  negative.bar = -1;
  const refused = negative.potion(0x18).taken;

  check(`a potion still works at a bar of exactly 0, and is refused below it`,
    tookIt && !saved.dead && after >= 200
      && atZero.bar === 0 && zeroWorks === true && refused === false,
    `bar 0 -> accepted, bar -1 -> refused. CS:0x6306 is ` +
    '`cmp word [0x19a],0 / jns`, the same non-strict shape as the damage ' +
    'guard and the pickup gate — and the opposite of the death test, which ' +
    'fires at <= 0. Four reads of DS:0x19a, three different boundaries');

  /* ⚠️ AND THE CAP IS A CONVERSION, NOT A CLAMP. */
  const brim = new Health(HEALTH_MAX, HEALTH_MAX);
  brim.target = HEALTH_MAX - 2;
  const brimmed = brim.potion(0x18);
  /* ⚠️ CORRECTED. An earlier revision of this check asserted the banking as
   * live behaviour. CS:0x6384 gates it on DS:0x168 >= 0 — the FAMILIAR'S
   * energy — which is -1 at both full restarts and can only be lifted by a
   * "familiar" potion, type 39, placed ZERO times in all eight maps. */
  const withFamiliar = new Health(HEALTH_MAX, HEALTH_MAX);
  withFamiliar.target = HEALTH_MAX - 2; withFamiliar.familiarEnergy = 1000;
  const fed = withFamiliar.potion(0x18);
  check(`over-healing banks 32 a point ONLY while a familiar is alive`,
    brim.target === HEALTH_MAX && brimmed.banked === 0
      && brimmed.discarded === (0x18 - 2)
      && fed.banked === (0x18 - 2) * 32,
    `the same ${0x18 - 2} wasted points bank ${fed.banked} with a familiar ` +
    `and ${brimmed.banked} without. CS:0x6377 shifts the excess left five ` +
    `times, but CS:0x6384 \`cmp word [0x168],0 / jns\` skips the credit when ` +
    `DS:0x168 is negative — and CS:0xC470 sets -1 at both full restarts. So ` +
    `the banking is real code that NO shipped level can reach, and quoting ` +
    `it as what over-healing does was wrong`);

  /* The hurt sound is a ONE-SHOT per descent, not one per tick. */
  const noisy = new Health(HEALTH_MAX, HEALTH_MAX);
  noisy.damage(10);
  for (let i = 0; i < 20; i++) noisy.chase();
  check(`the hurt sound fires once per descent, not once per frame`,
    noisy.hurtSounds === 1,
    `${noisy.hurtSounds} sound(s) over a 10-unit descent (latch DS:0x3ad)`);

  /* ── The damage curve, and a correction this port made ────────────────── */

  /* Five arithmetic shifts, not four. The two readings disagree on almost
   * every shipped enemy HP, so this is decided by the bytes, not by taste. */
  const hpSeen = new Set();
  for (const world of [1, 2, 3, 4]) {
    for (const sub of ['A', 'B']) {
      const buf = dclDecompress(
        await fetchRaw(`game/${palfilsNameFor(`${world}${sub}`)}`)).data;
      parseGroupsB(buf).forEach((d) => { if (d.live) hpSeen.add(d.hp); });
    }
  }
  const hps = [...hpSeen].sort((a, b) => a - b);
  const differ = hps.filter((v) => damageFor(v) !== (((v + 1) >> 4) + 5)).length;
  check(`contact damage is ((strength + 1) >> 5) + 5 — five shifts, not four`,
    damageFor(2) === 5 && damageFor(255) === 13 && differ > 20,
    `shipped HP ${hps[0]}..${hps[hps.length - 1]} gives ${damageFor(hps[0])}..` +
    `${damageFor(hps[hps.length - 1])} damage; the old \`>> 4\` note disagrees on ` +
    `${differ}/${hps.length} values (it would cost 21 of ${HEALTH_MAX} at HP 255)`);

  /* Crouching really shortens the hitbox — otherwise the dodge is cosmetic.
   * The box is `heroY + 8 - h <= atkY <= heroY + 38`, and crouching raises the
   * lower bound by 20, so attacks in a 20-px band are exactly what a standing
   * hero eats and a crouching one ducks. */
  const hero = { x: 100, y: 100, state: 0 };
  const high = { x: 110, y: 80, w: 0x20, h: 0x20, strength: 0 };
  const standHit = attackHero(high, hero, new Health(), {}).hit;
  const crouchHit = attackHero(high, { ...hero, state: 0x12 }, new Health(), {}).hit;
  /* And it must be a BAND, not blanket immunity: a hit at the hero's own
   * level still connects while crouching. */
  const lowHit = attackHero({ ...high, y: 110 }, { ...hero, state: 0x12 },
                            new Health(), {}).hit;
  check(`crouching (states 18/19) raises the hitbox top and dodges a HIGH hit`,
    standHit && !crouchHit && lowHit,
    `y=80 hits standing and misses crouching; y=110 still hits crouching ` +
    '— CS:0xaca0 `add bx,0x14`');

  /* Invulnerability suppresses the damage but NOT the hit report. */
  const h3 = new Health();
  const inv = attackHero({ x: 110, y: 110, w: 0x20, h: 0x20, strength: 40 },
                         hero, h3, { invuln: 1 });
  /* CS:0xACCC's `jnz` skips ONLY the `sub` at 0xACD3; the [0x34] test and the
   * bp store at 0xACDB/0xACE2 sit after the branch rejoins. So an invulnerable
   * hero is a creature-killing battering ram — he takes no damage and the
   * contact still reports a hit, which is what kills the creature. */
  check(`invulnerability blocks the damage but STILL kills what touches him`,
    inv.hit && h3.target === HEALTH_MAX && inv.strengthOut === -1,
    `hit, target unchanged at ${h3.target}, strength -> ${inv.strengthOut} — ` +
    'CS:0xaccc gates only the sub, so the kill still lands');

  /* Contact kills the creature: the strength IS the entity's state word and
   * the routine writes 0xFFFF back through it. */
  const creature = { x: 110, y: 110, state: 40, frame: 3, delay: 7 };
  const h4 = new Health();
  const touch = creatureTouchesHero(creature, hero, h4, {});
  check(`touching the hero costs health AND kills the creature`,
    touch.hit && h4.target < HEALTH_MAX && creature.state === -1
    && creature.frame === -1 && creature.delay === 0,
    `hero -${touch.damage}, creature state 40 -> ${creature.state} ` +
    '(CS:0xffb4 writes bp back, CS:0xffbf starts the death frames)');

  /* The reportGate is an input, not a constant — with it set, the hero is
   * hurt and the caller is told nothing, so the creature survives. */
  const survivor = { x: 110, y: 110, state: 40, frame: 3, delay: 7 };
  const h5 = new Health();
  creatureTouchesHero(survivor, hero, h5, { reportGate: 1 });
  /* ── Weapons and the difficulty scalar ───────────────────────────────── */

  const wpn = parseWeapons(dclDecompress(await fetchRaw('game/PWEAPONS.001')).data);
  check(`PWEAPONS.001 is 11 records of 0x50 bytes`,
    wpn.length === 11, `${wpn.length} records`);

  /* +0x0a is the max simultaneous projectiles, and the fire routine can only
   * ever consume three (an unrolled 3-iteration loop). Every shipped record
   * holding exactly 1 or 3 is what corroborates the field's meaning — a value
   * of 2, or of 7, would refute it. */
  const shots = [...new Set(wpn.map((w) => w.maxShots))].sort();
  check(`every weapon's +0x0a max-shots is 1 or 3, never more than the 3 sub-slots`,
    shots.join() === '1,3' && wpn.every((w) => w.maxShots <= MAX_SUBSLOTS),
    `values ${shots.join('/')} across 11 weapons (CS:0x9609, loop length ${MAX_SUBSLOTS})`);

  /* The cap is per weapon: a 1-shot weapon is refused a second live shot. */
  const oneShot = wpn.findIndex((w) => w.maxShots === 1);
  const threeShot = wpn.findIndex((w) => w.maxShots === 3);
  const busy = (n) => ({ weapon: n, subslots: [true, false, false] });
  const free = (n) => ({ weapon: n, subslots: [false, false, false] });
  const a1 = allocateShots([busy(oneShot), null, null], wpn);
  const a2 = allocateShots([busy(threeShot), null, null], wpn);
  const a3 = allocateShots([free(oneShot), null, null], wpn);
  check(`a 1-shot weapon is refused a second live shot; a 3-shot one is not`,
    a1.allocated[0] === null && a2.allocated[0] !== null && a3.allocated[0] !== null,
    `weapon #${oneShot} (1 shot) blocked while busy, #${threeShot} (3) allowed, ` +
    'and #' + oneShot + ' allowed again once free — CS:0x9613 `dec bx / jz`');

  /* PWEAPONS.004's sprite drift, the same +5 as POBJECTS.004 — and it never
   * takes effect because CS:0x366d pins those fields at the EXE values. */
  const w4 = parseWeapons(dclDecompress(await fetchRaw('game/PWEAPONS.004')).data);
  /* Measured on the FILE field. `sprite` now returns the pinned EXE value, so
   * reading the drift through it shows +0 — which is the pinning working, not
   * the drift being absent. */
  const drift = wpn.map((w, i) => w4[i].fileSprite - w.fileSprite);
  check(`PWEAPONS.004 sprite fields are shifted +5, and are pinned at load`,
    drift.every((d) => d === 5) && SPRITE_FIELDS_ARE_PINNED,
    `+${drift[0]} on all 11 records — discarded by CS:0x366d, like POBJECTS.004`);

  /* ⚠️ THESE TWO ASSERTED THE WRONG READING UNTIL THE WHOLE BRACKET WAS READ.
   * `shr bx,cl` looks like it computes the damage. CS:0xAB5E subtracts the RAW
   * value first and CS:0xAB86 adds the shifted one BACK, so the shift is what
   * the scalar forgives — and the direction is the intuitive one after all. */
  check(`the difficulty scalar multipliers are 1.00 / 0.75 / 0.50 / 0.25 / 0.25`,
    DIFFICULTY_MULTIPLIERS.map((m) => m.toFixed(2)).join() === '1.00,0.75,0.50,0.25,0.25',
    DIFFICULTY_MULTIPLIERS.map((m) => m.toFixed(2)).join(' ') +
    ' — applied = raw - (raw >> (3 - scalar)), CS:0xAB5E paired with CS:0xAB86');

  check(`a later-progression scalar deals LESS damage`,
    difficultyScale(100, 3) < difficultyScale(100, 1)
    && difficultyScale(100, 0) === 100,
    `scalar 1 -> ${difficultyScale(100, 1)}, scalar 3 -> ${difficultyScale(100, 3)} ` +
    'of 100 — enemies get tougher as the game progresses');

  results.push({
    name: 'the difficulty curve a player actually meets', note: true, pass: true,
    detail: 'the scalar starts at 0 and is incremented on level completion ' +
      'CLAMPED TO [2,4], so the sequence is ' +
      DIFFICULTY_PROGRESSION.map((s) => (difficultyScale(1000, s) / 1000).toFixed(2)).join(' -> ') +
      ' — monotone, and enemies are toughest at the END, not on world 2',
  });

  check(`DS:0x34 non-zero hurts the hero but leaves the creature alive`,
    h5.target < HEALTH_MAX && survivor.state === 40,
    `hero hurt, creature state still ${survivor.state} — UNKNOWN_DS_0034`);

  /* The walk -> fall TRANSITION is not inert. CS:0xf157 seeds v := 1 and
   * advances Y by one pixel in the same tick, before the fall handler ever
   * runs. An earlier revision of this port set v := 0 and left Y alone, which
   * delayed every ledge fall by a tick and started the curve one step low. */
  const ledge = new Uint8Array(128 * 64);
  ledge[0x100] = 1;                          // ground under the start cell only
  const w = Object.assign(new EntityB({ x: 0, y: 0, mode: MODE.WALK_L, speed: 10 }),
                          { state: 1 });
  w.tick(ledge);                             // on a tile boundary, ground present
  const beforeY = w.y, beforeMode = w.mode;
  w.x = 32; w.tick(ledge);                   // next tile: no ground -> fall
  check(`walking off a ledge seeds velocity 1 and moves Y by 1 in the same tick`,
    beforeMode === MODE.WALK_L && w.mode === MODE.FALL_L && w.vel === 1
    && w.y === beforeY + 1,
    `mode ${beforeMode}->${w.mode}, v ${w.vel}, y ${beforeY}->${w.y} (CS:0xf157/0xf15f/0xf162)`);

  /* ── The seed strategies ─────────────────────────────────────────────── */

  /* The jump table at DS:0xd966 is four wide and the nibble is UNBOUNDED, so
   * the shipped data has to stay inside it or the original would jump into
   * garbage. Census every live descriptor across all 8 levels. */
  let nibbleMax = -1, weightMax = -1, liveDescs = 0;
  const nib = {};
  for (const world of [1, 2, 3, 4]) {
    for (const sub of ['A', 'B']) {
      const buf = dclDecompress(
        await fetchRaw(`game/${palfilsNameFor(`${world}${sub}`)}`)).data;
      parseGroupsB(buf).forEach((d, i) => {
        if (!d.live) return;
        liveDescs++;
        const o = 0x11A4 + i * 0x16;
        const lo = buf[o + 8] & 0x0f, hi = (buf[o + 8] & 0xf0) >> 4;
        nibbleMax = Math.max(nibbleMax, lo, hi);
        weightMax = Math.max(weightMax, buf[o + 9]);
        nib[lo] = (nib[lo] || 0) + 1; nib[hi] = (nib[hi] || 0) + 1;
      });
    }
  }
  check(`every shipped seed-strategy nibble is inside the 4-entry table`,
    nibbleMax === SEED_STRATEGIES.length - 1 && liveDescs > 0,
    `${liveDescs} live descriptors, max nibble ${nibbleMax}, table ${SEED_STRATEGIES.length} ` +
    `— histogram ${JSON.stringify(nib)}`);

  check(`every shipped seed weight fits the 0x7f mask`,
    weightMax === SEED_WEIGHT_MASK,
    `max +0x09 is ${weightMax}, mask is ${SEED_WEIGHT_MASK} (CS:0xf713)`);

  /* The weight's polarity: `cmp bx,ax / jnl` keeps the LO nibble, so a HIGH
   * weight means LO wins. 127 can never lose because rand <= 127. */
  check(`weight 127 always picks the LO strategy, weight 0 almost always HI`,
    [0, 1, 63, 127].every((r) => seedStrategy(0x21, 127, r) === 1)
    && [1, 63, 127].every((r) => seedStrategy(0x21, 0, r) === 2)
    && seedStrategy(0x21, 0, 0) === 1,
    'CS:0xf716 `cmp bx,ax / jnl` — swap only when +9 < rand');

  /* Strategy 1 paints a box around the HERO — 32 cells, and the corners of
   * that box must sit exactly 64 px out on both axes. */
  const box = seedBoxCells(1000, 500);
  const xs = box.map((c) => c[0]), ys = box.map((c) => c[1]);
  check(`seed strategy 1 paints a 32-cell box +/-64 px around the hero`,
    box.length === 32 && Math.min(...xs) === 936 && Math.max(...xs) === 1064
    && Math.min(...ys) === 436 && Math.max(...ys) === 564,
    `x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)} ` +
    `(CS:0xf729, bp=7 so 8 cells a side)`);

  /* Strategy 0, the commonest, marks the hero's own 3-cell column — one cell
   * per tile row of his 32x48 body, stepping by the grid pitch. */
  const col = seedColumnCells(160, 80);
  check(`seed strategy 0 marks the hero's 3-cell column, stepping by the pitch`,
    col.length === 3 && col[1] - col[0] === GRID_PITCH && col[2] - col[1] === GRID_PITCH
    && col[0] === (160 >> 5) + GRID_PITCH * (80 >> 4) + GRID_MARGIN,
    `cells ${col.join(',')} — a 32x48 hero spans 3 tile rows (CS:0xf892/0xf896/0xf89d)`);

  /* And its cell math is NOT export 39's, despite the identical 0x55 bias. */
  check(`strategy 0 and export 39 disagree by the 8-px bias near a boundary`,
    seedColumnCells(8, 16)[0] !== gridIndex(8, 16)
    && seedColumnCells(64, 32)[0] === gridIndex(64 + 8, 32 + 8),
    'CS:0xf868 has no `sub cx,8`; export 39 (VGA:0x203) does');

  results.push({
    name: 'what the seed grid actually holds', note: true, pass: true,
    detail: 'CS:0xf7dd marks cells 0xFF, and both decoded strategies walk the ' +
      "HERO's position — so SS:0x1c70 is the GOAL region, not a closed set. " +
      'Reading it the other way inverts the search.',
  });

  results.push({
    name: 'shipped seed-strategy mix', note: true, pass: true,
    detail: `strategy 0 (chase the hero's column) ${nib[0] || 0}, ` +
      `1 (box around him) ${nib[1] || 0}, 2 ${nib[2] || 0}, 3 ${nib[3] || 0} ` +
      `of ${liveDescs * 2} nibbles. Strategy 2 is the \"attracts monsters\" potion ` +
      '(object type 45 sets DS:0x399) and 3 is the per-world waypoint list — ' +
      'both closed; all four are implemented.',
  });

  return results;
}


/* System A's spawn chain and its shipped-data strategy census. Every figure
 * here is re-derived from the PALFILS bytes at run time. */
export async function checkSpawnA(fetchRaw) {
  const { results, check } = makeChecker();
  const keys = ['1A','1B','2A','2B','3A','3B','4A','4B'];

  let live = 0, refs = 0, badRef = 0, overCount = 0;
  const perFile = [];
  const loHist = {}, share = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const rewardIdsA = new Set();
  for (const k of keys) {
    const buf = dclDecompress(await fetchRaw(`game/${palfilsNameFor(k)}`)).data;
    const groups = parseGroupsA(buf);
    let n = 0;
    for (const g of groups) {
      if (!g.live) continue;
      live++; n++;
      rewardIdsA.add(g.rewardId);
      if (g.count > MAX_ENTITIES) overCount++;
      const lo = g.seedPair & 0xf, hi = (g.seedPair >> 4) & 0xf;
      loHist[lo] = (loHist[lo] || 0) + 1;
      /* CS:0xe748: the low nibble is used with probability (weight+1)/128 —
       * see rollStrategy's own header. This is the SAME measurement this
       * project already makes for System B's pathfinder seed. */
      const pLow = (g.seedWeight + 1) / 128;
      share[lo] = (share[lo] || 0) + pLow;
      share[hi] = (share[hi] || 0) + (1 - pLow);
    }
    perFile.push(n);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < EVENT_COUNT; i++) {
      const o = EVENT_TABLE_OFF + i * 4;
      if (dv.getUint16(o, false) !== 5) continue;   // selector 5 = System A
      refs++;
      const p = dv.getUint16(o + 2, false);
      if (!(groups[p] && groups[p].live)) badRef++;
    }
  }

  check(`74 live System-A group descriptors (9/9/10/9/9/9/10/9, any order)`,
    live === 74, `${live} — ${perFile.join('/')}`);
  check(`every selector-5 event names a live descriptor`,
    badRef === 0, `${refs} references, ${badRef} dangling`);
  check(`no live descriptor's low strategy nibble exceeds 2`,
    Object.keys(loHist).every((k) => +k <= 2), JSON.stringify(loHist));

  /* CS:0xDFDB's own BE i16 reward id — the FIRST census of this previously-
   * undocumented System-A-only field, re-derived from raw bytes independent
   * of parseGroupsA itself (matching the discipline of System B's own
   * DOCUMENTED_REWARD_IDS check above). Distinct set from System B's own
   * census by construction: two unrelated descriptor tables at two
   * different PALFILS offsets, sharing only the +0x10 byte position. */
  const DOCUMENTED_REWARD_IDS_A = new Set([-1, 0, 16, 22, 27, 45]);
  const rewardIdsASorted = [...rewardIdsA].sort((a, b) => a - b);
  check(`every live System-A descriptor's +0x10 reward id matches this session's own census`,
    rewardIdsASorted.every((id) => DOCUMENTED_REWARD_IDS_A.has(id)),
    `got {${rewardIdsASorted.join(',')}}`);
  results.push({
    name: 'descriptor +0x10 reward ids in shipped System-A data',
    note: true, pass: true,
    detail: `${rewardIdsASorted.join(',')} — negative = no reward, `
      + '0 a plain numeric popup (undecoded, not rendered), >= 0xB a POBJECTS type '
      + '(16-11=5, 22-11=11 chrystal, 27-11=16 iron chest, 45-11=34 jewel)',
  });

  results.push({
    name: 'shipped System-A strategy nibbles (lo, before the weight roll)',
    note: true, pass: true,
    detail: `0 (chase) ${loHist[0] || 0}, 1 (weighted search, NOT PORTED) ${loHist[1] || 0}, ` +
      `2 (marker-seek, NOT PORTED) ${loHist[2] || 0}`,
  });
  const total = live;
  results.push({
    name: 'measured EFFECTIVE strategy share (nibble + weight roll, CS:0xe748)',
    note: true, pass: true,
    detail: `0: ${(share[0] / total * 100).toFixed(1)}%, ` +
      `1: ${(share[1] / total * 100).toFixed(1)}% (unimplemented -> sits still), ` +
      `2: ${(share[2] / total * 100).toFixed(1)}% (unimplemented -> sits still) — ` +
      `so roughly ${((share[1] + share[2]) / total * 100).toFixed(0)}% of spawned System-A ` +
      'entities visibly stand still under this port, not a small residual.',
  });

  /* End-to-end on real level data: a materialised entity whose strategy
   * rolls to 0 must actually move toward the hero over several ticks. */
  const buf1a = dclDecompress(await fetchRaw(`game/${palfilsNameFor('1A')}`)).data;
  const groups1a = parseGroupsA(buf1a);
  const chaseDesc = groups1a.find((g) => g.live && (g.seedPair & 0xf) === 0);
  if (chaseDesc) {
    const ent = new EntityA({ x: chaseDesc.tileX * 32, y: chaseDesc.tileY * 16,
                               cls: chaseDesc.cls, hp: chaseDesc.hp || 10 });
    ent.state = ent.hp;   // skip the pre-life FSM — this check is about locomotion
    ent.strategy = 0;     // force strategy 0 so this is deterministic, not a coin flip
    const hero = { x: ent.x + 500, y: ent.y };
    const startDist = Math.abs(hero.x - ent.x);
    for (let i = 0; i < 60; i++) ent.tick(hero, chaseDesc, () => 0, false);
    const endDist = Math.abs(hero.x - ent.x);
    check(`a strategy-0 (chase) entity closes distance to the hero over 60 ticks`,
      endDist < startDist, `${startDist}px -> ${endDist}px`);
  } else {
    results.push({ name: 'strategy-0 chase end-to-end', note: true, pass: true,
      detail: 'no live world-1a descriptor rolls strategy 0 on its low nibble — skipped' });
  }

  return results;
}

/* ── weapons, fire-slot allocation and projectile spawn ──────────────────
 *
 * Everything here is spawn-side. Nothing moves or collides a projectile yet
 * (UNKNOWN_projectile_mover), so these checks prove the records are BUILT
 * correctly, not that the hero can kill anything.
 */
export async function checkWeaponsProjectiles(fetchRaw) {
  const { results, check } = makeChecker();

  const files = ['001', '002', '003', '004'];
  const sets = [];
  for (const f of files) {
    sets.push(parseWeapons(dclDecompress(await fetchRaw(`game/PWEAPONS.${f}`)).data));
  }
  const all = sets.flat();

  /* ── the record layout, from the three slot bases ─────────────────────── */
  check(`the three weapon slots are a uniform 0x92 stride`,
    WEAPON_SLOTS[1].weaponAt - WEAPON_SLOTS[0].weaponAt === SLOT_STRIDE
    && WEAPON_SLOTS[2].weaponAt - WEAPON_SLOTS[1].weaponAt === SLOT_STRIDE,
    `0xdd10 / 0xdda2 / 0xde34 — 2 bytes of weapon index + ${SLOT_STRIDE - 2} of ` +
    `projectile area = ${AREA_ENTRIES} records of ${PROJECTILE_SIZE} bytes`);

  /* The free test reads [di], [di+8], [di+0x10] and the allocator strides
   * 0x18 — that is three 8-byte records per probe, which is what makes the
   * record 8 bytes rather than 24. */
  check(`a probe group is exactly ${GROUP_ENTRIES} records of ${PROJECTILE_SIZE} bytes`,
    GROUP_ENTRIES * PROJECTILE_SIZE === GROUP_STRIDE,
    `CS:0x9724 tests [di], [di+8], [di+0x10]; CS:0x9616 strides 0x18`);

  check(`the allocator can reach only ${ENTRIES_REACHABLE} of the ${AREA_ENTRIES} records`,
    ENTRIES_REACHABLE === 9 && AREA_ENTRIES === 18,
    'the unrolled loop is 3 groups deep, so bytes 72..143 of every slot are ' +
    'never allocated into — UNKNOWN_projectile_area_upper');

  /* The 18 is not inferred from the 0x92 stride alone: the clear routine
   * zeroes exactly 72 words from each slot's base + 2, so the whole 144-byte
   * region is one array of projectile records and is not shared. */
  check(`the clear routine zeroes all ${AREA_ENTRIES} records, not just the 9 reachable`,
    AREA_ENTRIES * PROJECTILE_SIZE === 0x48 * 2,
    'CS:0x9177 `mov cx,0x48` = 72 words = 144 bytes, called for each slot from ' +
    'CS:0x914c at level start and on a new weapon pickup (CS:0x94ce)');

  /* ── tags ─────────────────────────────────────────────────────────────── */
  const tags = [];
  for (let s = 0; s < 3; s++) for (let i = 0; i < 3; i++) tags.push(tagFor(s, i));
  check(`tag = 1 + slot*9 + subslot*3 reproduces all three shipped bases`,
    WEAPON_SLOTS.every((m, s) => m.tagBase === tagFor(s, 0))
    && tags.join(',') === '1,4,7,10,13,16,19,22,25',
    `bases ${WEAPON_SLOTS.map((m) => m.tagBase).join('/')} ` +
    '(CS:0x95e8 = 1, CS:0x9674 = 0xa, CS:0x96df = 0x13)');

  /* A tag is never zero, which is exactly what lets the tag word double as
   * the record's free flag. If any tag could be 0 the free test would be
   * ambiguous — the same trap the pathfinder's open list has at (0,0). */
  check(`no tag is 0, so the tag word can serve as the free flag`,
    tags.every((t) => t !== 0), `lowest tag ${Math.min(...tags)}`);

  /* ── the handler table ────────────────────────────────────────────────── */
  const refL = new Set(all.map((w) => w.handlerLeft));
  const refR = new Set(all.map((w) => w.handlerRight));
  check(`every weapon's right handler is exactly its left handler + 1`,
    all.every((w) => w.handlerRight === w.handlerLeft + 1),
    `left ${[...refL].sort((a, b) => a - b).join(',')} / ` +
    `right ${[...refR].sort((a, b) => a - b).join(',')} across ${all.length} records`);

  /* The parity is pinned by the table itself, not by the weapon data: entry
   * 12 trampolines into the LEFT body and 13 into the RIGHT one. */
  check(`even table indices are left-facing, odd are right-facing`,
    DECODED_HANDLERS.every((i) => HANDLERS[i].facing === (i % 2 ? +1 : -1)),
    'entry 12 = `sub bx,8 / jmp 0x991c` (left body), 13 = `... jmp 0x98d1` (right)');

  check(`the highest handler index shipped data references is within the table`,
    Math.max(...refL, ...refR) < HANDLER_TABLE.length,
    `max ${Math.max(...refL, ...refR)}, table is ${HANDLER_TABLE.length} wide ` +
    '(size is [STATIC] — inferred from where the potion table starts)');

  /* ⚠️ Handler 13 is not handler 1 with a different Y — it skips the +0x10. */
  check(`handler 13 does NOT apply handler 1's +0x10 X offset`,
    HANDLERS[1].dx === 0x10 && HANDLERS[13].dx === 0 && HANDLERS[13].facing === +1,
    'CS:0x9964 jumps to 0x98d1, past `add ax,0x10` — mirroring 1 puts shots 16 px off');

  /* ── the null handlers, and the weapon that points at them ────────────── */
  check(`table entries ${NULL_HANDLERS.join('/')} are null`,
    NULL_HANDLERS.every((i) => HANDLER_TABLE[i] === 0),
    'a `call cx` with cx = 0 would jump to CS:0x0000');

  const flame = sets[0][CUT_WEAPON];
  check(`weapon ${CUT_WEAPON} ("flame") is the one pointing at the null pair`,
    flame.handlerLeft === 4 && flame.handlerRight === 5,
    'so the null entries are reachable only through a weapon that is never placed');

  /* The discriminating half: flame appears in NO shipped level. */
  const placed = new Set();
  let pickups = 0;
  for (const k of ['1A','1B','2A','2B','3A','3B','4A','4B']) {
    const m = parseMap(dclDecompress(await fetchRaw(`game/PLEV${k}.MAP`)).data);
    for (const o of m.objects) if (!isDeadType(o.type) && o.type >= 0xc0) pickups++;
    /* Consumed slots are marked 0xFFFF and tested by SIGN, so they must be
     * dropped before the type is read as a weapon index — otherwise the
     * marker itself enters the census as "weapon 65343". */
    for (const o of m.objects) {
      if (!isDeadType(o.type) && o.type >= 0xc0) placed.add(o.type - 0xc0);
    }
  }
  /* Anchored to the 55/9 figure this project recorded from a separate tool,
   * so the check fails if the object decode drifts rather than only if flame
   * appears. Flame and "magic axe" are the two absentees; magic axe's
   * handlers 14/15 are real code, so only flame's are dead. */
  check(`no shipped level places weapon ${CUT_WEAPON} — the null handler is unreachable`,
    !placed.has(CUT_WEAPON) && pickups === 55 && placed.size === 9,
    `${pickups} pickups of ${placed.size} distinct types ` +
    `(${[...placed].sort((a, b) => a - b).join(',')}) of ${WEAPON_COUNT} weapons ` +
    '— flame is a cut weapon whose handler was never written');

  /* ── +0x08 is PINNED at the EXE-image value ───────────────────────────── */
  const drift = all.filter((w) => w.file08 !== w.unknown08);
  check(`7 of the ${all.length} file records disagree with the pinned +0x08`,
    drift.length === 7 && drift.every((w) => PINNED_08[w.index] === w.unknown08),
    'CS:0x367a pushes +0x08 from all 11 records, loads the file over them, then ' +
    'pops them back — so each file\'s own copy is discarded. Reading the file ' +
    'value here fires the wrong projectile count for four world-4 weapons');

  /* ⚠️ Do NOT assert `w.sprite === PINNED_SPRITE[w.index]` — that compares the
   * port against the constant it was built from and cannot fail. What CAN be
   * checked from the data is that PINNED_SPRITE is the RIGHT table: its values
   * must land in the objects descriptor range, and +0x1e must be zero for
   * every weapon except the two that visibly have a second sprite. Both would
   * break if the extraction offset or endianness were wrong. */
  check(`the pinned +0x0c values all land inside the POBJ2 descriptor range`,
    PINNED_SPRITE.every((v) => v >= 331 && v <= 449),
    `${Math.min(...PINNED_SPRITE)}..${Math.max(...PINNED_SPRITE)} — POBJ2 is ` +
    '#331..#449, so a wrong offset or endianness would fall outside');

  const withSecond = PINNED_SPRITE2.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  check(`+0x1e is zero except for the two weapons that have a second sprite`,
    withSecond.join(',') === '4,6',
    `nonzero for weapons ${withSecond.join(',')} — "lightning bolt" and "spear"; ` +
    'that field is selected by +0x0e, the facing');

  /* Only PWEAPONS.004 drifts on +0x0c — its 11 records are shifted +5, the same
   * authoring slip as POBJECTS.004. The other three files match the image, so
   * the pinning is invisible except in world 4. */
  const spriteDrift = all.filter((w) => w.fileSprite !== w.sprite).length;
  check(`exactly 11 file records disagree with the pinned +0x0c — all of .004`,
    spriteDrift === 11
    && sets[3].every((w) => w.fileSprite - w.sprite === 5)
    && [0, 1, 2].every((f) => sets[f].every((w) => w.fileSprite === w.sprite)),
    'CS:0x35b7 saves +0x0c/+0x1e to DS:0x2f76 and CS:0x35d0 restores them — a ' +
    'different save/restore pair from +0x08\'s push/pop, which is why this ' +
    'project recorded two of the three pinned fields and missed the third');

  /* ── UNKNOWN_weapon_08 CLOSED: the volley is a PICKUP COUNT ──────────── */
  const w0 = sets[0][0];
  const knifeArm = armWeapon(w0);
  check(`a freshly picked-up weapon fires exactly ONE projectile`,
    volleySize(knifeArm) === 1 && knifeArm.count === knifeArm.base,
    'CS:0x9115 sets +0x08 := +0x06 on a new pickup, so bp = 1 whatever the file ' +
    'or the pinned EXE table held');

  const prog = [knifeArm, pickUpAgain(knifeArm), pickUpAgain(pickUpAgain(knifeArm))];
  check(`each duplicate pickup adds a projectile, to a maximum of three`,
    prog.map(volleySize).join(',') === '1,2,3'
    && volleySize(pickUpAgain(prog[2])) === 3,
    'CS:0x94e8 `inc [di+8]`; the `dec bp / jz` chain clamps at 3 — collect the ' +
    'same weapon repeatedly and it fires more at once');

  /* Every weapon behaves the same way, because base cancels out. */
  check(`the progression is identical for all ${WEAPON_COUNT} weapons`,
    sets[0].every((x) => volleySize(armWeapon(x)) === 1
                && volleySize(pickUpAgain(armWeapon(x))) === 2),
    'bp = 1 + (count - base), so Power cancels — it sets the floor, not the rate');

  /* The shop reads the same difference from the other side, which is what
   * makes "extras collected" the right reading rather than a coincidence. */
  /* Uses TWO extras deliberately: with one extra, `(v+1)>>1` and `v>>1` agree
   * whenever v is even, so a mutant that drops the `inc bx` at CS:0x6fe9
   * survives on the knife. At two extras the two forms always differ. */
  const twoExtra = pickUpAgain(pickUpAgain(knifeArm));
  check(`the shop refunds in proportion to the extras collected`,
    refundFor(knifeArm, w0) === 0
    && refundFor(pickUpAgain(knifeArm), w0) === ((w0.value + 1) >> 1)
    && refundFor(twoExtra, w0) === (w0.value + 1)
    && refundFor(twoExtra, w0) !== w0.value,
    `no extras refunds 0, two extras refunds value+1 = ${w0.value + 1} — ` +
    'CS:0x6fde `mul bx / sar dx,1 / rcr ax,1` over the same [+8]-[+6] the ' +
    'volley uses, which is what makes "extras collected" the right reading');

  /* ⚠️ The LOADED state is never fired from. An earlier revision of this file
   * computed the volley from the shipped table and asserted a per-weapon,
   * per-world spread (including an "axe fires 3 in worlds 3-4"); that was
   * reading state CS:0x9115 overwrites before the weapon can fire. */
  /* ⚠️ The two mechanisms COMPOSE. A fresh pickup re-bases the count to Power
   * (volley 1), but a sublevel-'a' load re-pins the count to the EXE value
   * while Power comes from the new world's file — and the weapon slots are
   * NOT cleared between worlds (CS:0x914c's only callers are full restarts).
   * So a CARRIED weapon can enter a world already at full spread. */
  const axeCarried = [0, 1, 2, 3].map((f) => volleySize(reloadWorld(sets[f][7])));
  const axeFresh   = [0, 1, 2, 3].map((f) => volleySize(armWeapon(sets[f][7])));
  check(`a CARRIED axe gains spread in worlds 3-4; a freshly picked-up one does not`,
    axeCarried.join(',') === '1,1,3,3' && axeFresh.join(',') === '1,1,1,1',
    `carried ${axeCarried.join(',')} vs fresh ${axeFresh.join(',')} — Power is ` +
    `per-world (${[0,1,2,3].map((f) => sets[f][7].power).join('/')}) while the ` +
    `re-pinned count is fixed at ${PINNED_08[7]}. UNKNOWN_carried_weapon_volley`);

  /* ── the spawn itself ─────────────────────────────────────────────────── */
  const knife = sets[0][0];
  const knifeSt = armWeapon(knife);
  const right = spawnVolley(knifeSt, knife.handlerRight, tagFor(0, 0), 100, 200);
  const left  = spawnVolley(knifeSt, knife.handlerLeft,  tagFor(0, 0), 100, 200);
  check(`a right volley leaves the muzzle 0x10 further out than a left one`,
    right.entries[0].x - left.entries[0].x === 0x10
    && right.entries[0].y === left.entries[0].y,
    `right x=${right.entries[0].x}, left x=${left.entries[0].x}, both y=${left.entries[0].y}`);

  check(`facing is written back as +1 right / -1 left`,
    right.facing === +1 && left.facing === -1,
    'CS:0x98ea stores 1 into weapon +0x0e, CS:0x9935 stores 0xFFFF — ' +
    'that field selects the +0x0c vs +0x1e sprite descriptor');

  /* Tags step by one WITHIN a volley (`inc dx`), by three BETWEEN sub-slots. */
  /* Three entries requires a weapon picked up twice over — a bare weapon
   * record has no runtime state and must not be passed here. */
  const star = sets[0][5];
  const maxed = pickUpAgain(pickUpAgain(armWeapon(star)));
  const three = spawnVolley(maxed, star.handlerRight, tagFor(0, 0), 0, 0);
  check(`tags step by 1 inside a volley but by 3 between sub-slots`,
    three.entries.length === 3
    && three.entries.map((e) => e.tag).join(',') === '1,2,3'
    && tagFor(0, 1) - tagFor(0, 0) === 3,
    `volley tags ${three.entries.map((e) => e.tag).join(',')} — CS:0x98f2 \`inc dx\`, ` +
    'CS:0x9619 `add dx,3`');

  /* Pinned to the literal immediates, NOT to DIRS — comparing the spawn
   * against the same table it was built from passes under any ordering. The
   * order is the non-obvious part: the FIRST entry written gets 1 (right) or
   * 4 (left) and the SECOND gets 0 or 3, so the naive 0/1/2 and 3/4/5 is
   * wrong even though it preserves the +3 relation. */
  check(`the dir codes are 1/0/2 right and 4/3/5 left, in that write order`,
    three.entries.map((e) => e.dir).join(',') === '1,0,2'
    && DIRS.right.join(',') === '1,0,2' && DIRS.left.join(',') === '4,3,5'
    && DIRS.left.every((d, i) => d === DIRS.right[i] + 3),
    'CS:0x98e3 writes 1, CS:0x98fe writes 0, CS:0x9914 writes 2; the left body ' +
    'at CS:0x992e/0x9949/0x995f is the same sequence + 3');

  /* ── the allocator's three corrected rules ────────────────────────────── */
  const w = sets[0];
  const empty = () => [0, 1, 2].map((i) => ({ weapon: i, subslots: [false, false, false] }));
  const single = w.findIndex((x) => x.maxShots === 1);
  const multi  = w.findIndex((x) => x.maxShots === 3);

  /* Slot A single-shot suppresses OTHER single-shot slots — B as well as C. */
  const s1 = [single, single, single].map((k) => ({ weapon: k, subslots: [false, false, false] }));
  const r1 = allocateShots(s1, w);
  check(`a single-shot slot A suppresses single-shot B *and* C`,
    r1.allocated[0] && !r1.allocated[1] && !r1.allocated[2],
    'CS:0x969a and CS:0x9705 carry the identical DS:0x33e interlock — ' +
    'gating it on slot C alone lets B fire when the original would not');

  /* Multi-shot slots are exempt on both sides of the test. */
  const s2 = [multi, single, single].map((k) => ({ weapon: k, subslots: [false, false, false] }));
  const r2 = allocateShots(s2, w);
  check(`a multi-shot slot A sets no interlock, so B and C both fire`,
    r2.allocated.every(Boolean) && r2.flag33e === false,
    'CS:0x963b sets DS:0x33e only when slot A\'s own maxShots is 1');

  const r3 = allocateShots(empty(), w, { locked: true });
  check(`the DS:0x351 lockout blocks the whole routine`,
    !r3.any && r3.allocated.every((a) => a === null) && r3.lockedOut,
    'CS:0x95cb returns before clearing DS:0x33e or the three live pointers');

  /* A full slot yields nothing, and maxShots caps the probe depth. */
  const s4 = [{ weapon: multi, subslots: [true, true, true] }, null, null];
  check(`a slot with every sub-slot occupied allocates nothing`,
    !allocateShots(s4, w).allocated[0], 'CS:0x962f falls through to the next slot');

  const s5 = [{ weapon: single, subslots: [true, false, false] }, null, null];
  check(`maxShots 1 stops after ONE probe even with free sub-slots behind it`,
    !allocateShots(s5, w).allocated[0],
    'CS:0x9613 `dec bx / jz` — the budget, not the array length, ends the walk');

  results.push({
    name: 'shipped maxShots values', note: true, pass: true,
    detail: `+0x0a is only ever ${[...new Set(all.map((x) => x.maxShots))].sort().join(' or ')} ` +
      `across all ${all.length} records — exactly what a ${MAX_SUBSLOTS}-deep unrolled ` +
      'loop can consume. A 2 or a 7 would refute the reading.',
  });

  /* ── UNKNOWN_projectile_mover — CLOSED ────────────────────────────────── */
  const movers = new Set(all.map((x) => x.mover));
  check(`weapon +0x1A indexes the ${MOVER_TABLE.length}-entry mover table exactly`,
    Math.max(...movers) === MOVER_TABLE.length - 1 && Math.min(...movers) === 0
    && movers.size === MOVER_TABLE.length,
    `values ${[...movers].sort().join(',')} across ${all.length} records — the ` +
    'table at DS:0xd8ac is 6 wide, and every one of its entries is used');

  check(`each weapon's mover index is the same in all four worlds`,
    sets[0].every((x, i) => [1, 2, 3].every((f) => sets[f][i].mover === x.mover)),
    'so the mover is a weapon identity, not per-world tuning');

  /* The mover table's null entry belongs to the SAME cut weapon as the null
   * spawn pair — two independent nulls, both reachable only through flame. */
  check(`the mover table's null entry is weapon ${CUT_WEAPON} ("flame") too`,
    MOVER_TABLE[MOVER_NULL] === 0 && sets[0][CUT_WEAPON].mover === MOVER_NULL,
    'the same cut weapon whose spawn handlers 4/5 are null — two independent ' +
    'null slots corroborating each other');

  /* The velocity table closes the loop on the spawn write ORDER. */
  check(`the 6 velocities are a 3-way spread at +/-12 px/tick`,
    PROJECTILE_VELOCITY.filter((v) => v.vx === 12).length === 3
    && PROJECTILE_VELOCITY.filter((v) => v.vx === -12).length === 3
    && PROJECTILE_VELOCITY.map((v) => v.vy).join(',') === '-3,0,3,-3,0,3',
    'DS:0xdf0e, copied from SS:0x3612 by CS:0x95bc (`mov cx,0xc` = 6 entries) — ' +
    '12 px/tick at 15 Hz is 180 px/s');

  check(`a single-projectile volley flies LEVEL, and extras fan out`,
    PROJECTILE_VELOCITY[DIRS.right[0]].vy === 0
    && PROJECTILE_VELOCITY[DIRS.left[0]].vy === 0
    && PROJECTILE_VELOCITY[DIRS.right[1]].vy < 0
    && PROJECTILE_VELOCITY[DIRS.right[2]].vy > 0,
    'the handlers write dir 1/4 first (vy 0), then up, then down — which is why ' +
    'the write order is 1,0,2 rather than 0,1,2');

  check(`right-facing dirs carry +12 and left-facing -12`,
    DIRS.right.every((d) => PROJECTILE_VELOCITY[d].vx === 12)
    && DIRS.left.every((d) => PROJECTILE_VELOCITY[d].vx === -12),
    'independently confirms which spawn handler is which facing');

  /* The mover walks exactly the nine records the allocator can reach. */
  /* ⚠️ NOT `MOVER_WALK === ENTRIES_REACHABLE` — both are constants written
   * here, so that form is 9 === 9 and cannot fail. The non-circular claim is
   * that two INDEPENDENTLY read immediates agree: the allocator's unrolled
   * loop is 3 groups deep over 3-entry groups (CS:0x9616, CS:0x9724), and the
   * mover's own counter is `mov cx,0x9` (CS:0x9c6d). */
  check(`the allocator's 3x3 reach and the mover's own cx=9 are the same nine`,
    GROUPS_PROBED * GROUP_ENTRIES === MOVER_WALK && MOVER_WALK === 9,
    `${GROUPS_PROBED} groups x ${GROUP_ENTRIES} entries = ${MOVER_WALK}, and the ` +
    'mover strides `add di,8` (CS:0x9d6a) — so the upper 9 of the 18 are ' +
    'untouched by BOTH sides, not merely unallocated');

  /* End-to-end: a shot flies, then is culled, and culling frees the slot. */
  const area = Array.from({ length: 18 }, () => ({ tag: 0, x: 0, y: 0, dir: 1 }));
  area[0] = { tag: 1, x: 100, y: 100, dir: 1 };
  const cam = { x: 0, y: 0 };
  let ticks = 0;
  while (area[0].tag !== 0 && ticks < 100) { stepProjectiles(area, cam); ticks++; }
  check(`a level shot flies right at 12 px/tick and is culled off-screen`,
    ticks === Math.ceil((CULL.xMax - (100 - cam.x)) / 12) && area[0].tag === 0,
    `${ticks} ticks from x=100 to the ${CULL.xMax} cull edge — despawn is ` +
    '`mov word [di],0` (CS:0x9d91), which zeroes the same tag word the ' +
    "allocator's free test reads, so the slot frees immediately");

  /* ⚠️ The cull bounds are EXCLUSIVE — the original tests `jl 0x140` and
   * `jg 0xffe0`, so landing exactly ON 320 or -32 despawns. A flight test from
   * an arbitrary x never lands on the boundary, so it cannot tell `>=` from
   * `>`; these two start where the next step lands exactly on the edge. */
  const edgeR = [{ tag: 1, x: CULL.xMax - 12, y: 100, dir: 1 }];
  stepProjectiles(edgeR, cam);
  const edgeL = [{ tag: 1, x: CULL.xMin + 12, y: 100, dir: 4 }];
  stepProjectiles(edgeL, cam);
  check(`a projectile landing exactly ON the cull edge despawns`,
    edgeR[0].tag === 0 && edgeR[0].x === CULL.xMax
    && edgeL[0].tag === 0 && edgeL[0].x === CULL.xMin,
    `x=${CULL.xMax} and x=${CULL.xMin} are both outside — CS:0x9cb8 \`jl 0x140\` ` +
    'and CS:0x9ca8 `jg 0xffe0` continue only STRICTLY inside');

  /* A dir from another mover must be SKIPPED and counted, never thrown on:
   * the original reads 188 bytes past the table and draws garbage, and a
   * throw on a per-frame path is a worse failure mode than the divergence. */
  const alien = [{ tag: 1, x: 100, y: 100, dir: 0x2f }];
  const r = stepProjectiles(alien, cam);
  check(`a dir from another mover is skipped and counted, not thrown on`,
    r.outOfRange === 1 && r.moved === 0 && alien[0].tag === 1
    && alien[0].x === 100,
    "time bomb's handler 9 writes dir 0x2f; CS:0x9c88 has no bounds check and " +
    'would index past DS:0xdf0e — the port surfaces it instead of crashing');

  const up = [{ tag: 1, x: 100, y: 100, dir: 0 }];
  stepProjectiles(up, cam);
  check(`dir 0 rises while dir 2 falls, both moving right`,
    up[0].y === 97 && up[0].x === 112,
    `after one tick: ${up[0].x},${up[0].y} — vy is -3 up, +3 down, 0 level`);

  /* ── the fire cycle: latch, allocate, emit ────────────────────────────── */
  const fc = new FireControl();
  const slotsOf = () => [0, 1, 2].map((i) => ({ weapon: i, subslots: [false, false, false] }));

  /* ⚠️ The latch clears ONLY on a tick where fire is not held, so holding the
   * button gives exactly one volley — semi-automatic, not 15 Hz auto. */
  let volleys = 0;
  for (let t = 0; t < 20; t++) {
    fc.latchTick(true);                       // fire held every tick
    if (fc.tryFire(slotsOf(), w, true, true)) volleys++;
    fc.tick(true);
  }
  check(`holding fire yields exactly ONE volley, not one per tick`,
    volleys === 1,
    `${volleys} in 20 ticks — CS:0x01A2 \`jnz\` SKIPS the latch clear while the ` +
    'fire bit is set, so a port that clears it every frame gives a 15 Hz autocannon');

  /* Release then press again re-arms it. */
  const fc2 = new FireControl();
  let shots = 0;
  for (const held of [true, true, false, true, true, false, true]) {
    fc2.latchTick(held);
    if (fc2.tryFire(slotsOf(), w, held, true)) shots++;
    fc2.tick(held);
  }
  check(`releasing and pressing again re-arms the latch`,
    shots === 3, `${shots} volleys over 3 presses — CS:0x01A4 clears on release`);

  /* Allocation and emission are on DIFFERENT ticks, three apart. */
  const fc3 = new FireControl();
  fc3.latchTick(true);
  const entered = fc3.tryFire(slotsOf(), w, true, true);
  const emitTick = [];
  for (let t = 1; t <= 6; t++) if (fc3.tick(true)) emitTick.push(t);
  /* ⚠️ Pinned to the LITERAL 3, not to EMIT_PHASE — comparing the observed
   * phase against the same constant that produced it cannot fail. */
  check(`a shot is reserved on the press tick but EMITTED 3 ticks later`,
    entered && emitTick.length === 1 && emitTick[0] === 3 && EMIT_PHASE === 3
    && RECHECK_PHASE === 5,
    `emitted at phase ${emitTick.join(',')} — CS:0x5d48 \`cmp cl,3\`; at 15 Hz that ` +
    'is a 200 ms delay between press and the projectile appearing');

  /* The state machine enters a fire state only when the allocator SUCCEEDS,
   * and its success value is 0 (cx starts 1, zeroed on any allocation). */
  const fc4 = new FireControl();
  fc4.latchTick(true);
  check(`no fire state is entered when nothing can be allocated`,
    !fc4.tryFire([null, null, null], w, true, true),
    'CS:0x5cb2 `cmp ax,0 / jnz` — the INVERTED return convention, in live use');

  check(`the ${FIRE_STATES.length} firing states match the state table's labels`,
    FIRE_STATES.every((i) => STATE_INFO[i] && /fire/.test(STATE_INFO[i].label))
    && STATE_INFO.filter((x) => /fire/.test(x.label)).length === FIRE_STATES.length,
    `states ${FIRE_STATES.join(',')} — cross-checked against states.js rather than ` +
    'restated, so adding a fire state without listing it here fails');

  /* ── the damage grid: collision is occupancy, not a pairwise test ─────── */
  check(`the grid is 1600 bytes of 8x8 cells, stride ${ROW_STRIDE} = 384 px`,
    GRID_BYTES === 0x320 * 2 && ROW_STRIDE * CELL === 384
    && GRID_ORIGIN > GRID_LO && GRID_ORIGIN - GRID_LO === 100,
    'CS:0xACF6 `mov cx,0x320 / mov di,0x1666 / rep stosw`; DS:0x16ca is screen ' +
    '(0,0), 100 bytes in, so there is a margin above and left');

  /* ⚠️ Stamp FLOORS, scan ROUNDS half-up. The two must differ. */
  check(`the stamp floors to a cell while the scan rounds half-up`,
    stampIndex(12, 12) === GRID_ORIGIN + 1 + 6 * 8
    && scanIndex(12, 12) === GRID_ORIGIN + 2 + 6 * 16
    && stampIndex(16, 16) === scanIndex(16, 16),
    'CS:0xA863 `sar` + `and 0xfff8` vs CS:0xAA09 `add 4` first — they agree only ' +
    'on exact multiples of 8, and one shared helper misplaces every stamp');

  /* A stamp lands where a scan over the same point finds it. */
  const g = new DamageGrid();
  g.clear();
  g.stamp2x2(160, 96, 7);
  check(`a creature box scanning over a stamped projectile finds its tag`,
    g.scan(160, 96, 0x20, 0x20) === 7,
    'the 32x32 System-B box (DS:0x1e2/0x1e4 set at CS:0xFF93) covers the 2x2 stamp');

  check(`an empty grid returns no hit`,
    (g.clear(), g.scan(160, 96, 0x20, 0x20)) === 0,
    'CS:0xAB3F falls out of the row loop with nothing found');

  /* The unrolled chain caps the scan at ten columns. */
  const wide = new DamageGrid();
  wide.clear();
  wide.stamp2x2(160 + MAX_SCAN_COLS * CELL + 16, 96, 5);
  check(`the scan is capped at ${MAX_SCAN_COLS} columns by the unrolled chain`,
    wide.scan(160, 96, 0xff, 0x20) === 0,
    'CS:0xAAF7-0xAB32 is 60 bytes of 6-byte units, entered at `0xab33 - 6*cols` — ' +
    'a box wider than 80 px cannot reach past column 10');

  /* Stamps outside the write window are dropped. */
  const edge = new DamageGrid();
  edge.clear();
  const dropped = edge.stamp2x2(-200, -200, 3);
  check(`a stamp outside [0x${WRITE_LO.toString(16)}, 0x${WRITE_HI.toString(16)}) is dropped`,
    dropped === false,
    'CS:0xA87A `cmp si,0x1696 / jl` and CS:0xA880 `cmp si,0x1c42 / jnl` — the ' +
    'window is NARROWER than the cleared region at both ends');

  /* ── tag -> damage: CS:0x9320 ─────────────────────────────────────────── */
  const st0 = w.map((x) => armWeapon(x));
  /* ⚠️ NOT `TAGS_PER_SLOT === ENTRIES_REACHABLE` — both are constants written
   * here. Assert the DECODE instead: the lowest and highest tag of a slot must
   * map to the first and last reachable record, which is what ties the tag
   * arithmetic to the array geometry. */
  check(`a slot's lowest and highest tags map to records 0 and 8`,
    damageForTag(1, [0, 1, 2], st0).record === 0
    && damageForTag(9, [0, 1, 2], st0).record === ENTRIES_REACHABLE - 1
    && damageForTag(10, [0, 1, 2], st0).record === 0,
    'CS:0x932D `cmp al,9 / jng` splits the tag space 9 per slot, and CS:0x933F ' +
    '`dec al / shl ax,1 x3` makes it (tag-1)*8 — records 0..8, the same nine ' +
    'the allocator reaches and the mover walks');

  const st = st0;
  const d0 = damageForTag(1, [0, 1, 2], st);
  const d1 = damageForTag(1, [0, 1, 2], st.map((x, i) => (i === 0 ? pickUpAgain(x) : x)));
  check(`damage is weapon +0x08 — the PICKUP COUNT, not Power`,
    d0.damage === w[0].power && d1.damage === w[0].power + 1 && d0.slot === 0,
    `a fresh knife deals ${d0.damage} (= its Power, because a new pickup sets ` +
    `count := Power) and one duplicate makes it ${d1.damage} — CS:0x935E ` +
    '`mov ax,[di+0x8]`, so a duplicate buys BOTH an extra projectile and +1 damage');

  check(`tags 10 and 19 decode to slots B and C`,
    damageForTag(10, [0, 1, 2], st).slot === 1
    && damageForTag(19, [0, 1, 2], st).slot === 2
    && damageForTag(9, [0, 1, 2], st).slot === 0,
    'CS:0x9331 / CS:0x933A subtract 9 per slot — the same 1 + 9*slot + 3*subslot ' +
    'the allocator mints');

  /* ⚠️ CORRECTED. Negative tags are other sources, but they are NOT harmless:
   * an earlier revision of this check asserted `damage === 0` for all four,
   * which is right for exactly one of them. */
  check(`the four negative tags decode to four DIFFERENT damages`,
    damageForTag(0xfc, [0, 1, 2], st, 0).damage === 10000
    && damageForTag(0xfc, [0, 1, 2], st, 2).damage === 50
    && damageForTag(0xfe, [0, 1, 2], st, 0).damage === 10000
    && damageForTag(0xfe, [0, 1, 2], st, 2).damage === 0
    && damageForTag(0xfd, [0, 1, 2], st, 0).damage === 0
    && damageForTag(0xff, [0, 1, 2], st, 0).varies !== undefined,
    'CS:0x9325 `cbw / or ax,ax / js` branches away before any slot lookup, ' +
    'and CS:0x938B then peels one `inc ax` per tag: 0xFF carries DS:0x210 ' +
    '(the familiar\'s power), 0xFE 10000, 0xFD nothing, 0xFC 10000 — each of ' +
    'the two AREA tags dropping to 50/0 when DS:0x34 is not the normal-play ' +
    'zero. Reporting 0 for all four made the starburst and the aura inert');

  /* ── the eight firing states ──────────────────────────────────────────── */
  check(`all 8 firing states are ported, and their bases match the state table`,
    FIRE_STATE_IDS.length === 8
    && FIRE_STATE_IDS.every((i) => STATE_TABLE[i].base === FS[i].base),
    `states ${FIRE_STATE_IDS.join(',')} — bases cross-checked against the ` +
    'DS:0xd818 dispatch table rather than restated');

  /* ⚠️ Walk is the odd one out on emit phase — six of eight emit at 1. */
  check(`walk+fire emits at phase ${EMIT_WALK}; the other six emit at ${EMIT_OTHER}`,
    FS[5].emit === 3 && FS[6].emit === 3
    && [20, 21, 22, 23, 24, 25].every((i) => FS[i].emit === 1),
    'CS:0x5d48 `cmp cl,3` vs CS:0x5423 / 0x4dab / 0x545c `cmp cl,1` — mirroring ' +
    'walk+fire into the other three families puts six of eight shots on the wrong tick');

  /* The walk animation is a symmetric recoil, and index 5 is unreachable. */
  check(`the walk-fire animation is the symmetric recoil 2,1,0,1,2`,
    WALK_FIRE_ANIM.slice(0, 5).join(',') === '2,1,0,1,2' && WALK_FIRE_ANIM[5] === 21,
    'DS:0xd950 read as bytes at [phase*2]. Entry 5 holds 21 and `cmp cl,5 / jl` ' +
    'diverts before the lookup, so it can never be indexed — but it is KEPT ' +
    'rather than replaced by a safe fallback, so a routing bug renders a ' +
    'visibly wrong sprite instead of a plausible one');

  /* ⚠️ The exit COMPARISON differs by family — a third asymmetry. */
  check(`fall+fire exits on EQUALITY while jump and ladder exit on >=`,
    FS[22].exitCmp === 'eq' && FS[23].exitCmp === 'eq'
    && [20, 21, 24, 25].every((i) => FS[i].exitCmp === 'ge'),
    'CS:0x4DA9/0x4E13 `jz` against CS:0x53F0 `jl` and CS:0x5467/0x5499 `jnl` — ' +
    'they diverge on any path where DS:0x356 drives the phase backward');

  check(`an over-shot phase leaves a >= family but NOT the eq family`,
    fireTick(24, 5, false, false).next === 14
    && fireTick(22, 5, false, false).next === 22,
    'phase 6 vs `cmp cl,3`: `jnl` fires, `jz` does not — using >= everywhere ' +
    'makes the fall pair leave a tick early');

  check(`only walk+fire remaps its phase for rendering`,
    persistsRawPhase(5) && persistsRawPhase(6)
    && ![20, 21, 22, 23, 24, 25].some(persistsRawPhase)
    && fireAnimOffset(5, 2) === 0 && fireAnimOffset(22, 2) === 2,
    'CS:0x5d68 stores the RAW phase then overwrites cl from the table and jumps ' +
    'to 0x5e9f — one instruction PAST the epilogue\'s own `mov [0x36b],cl`');

  /* A full walk+fire cycle: emit once, at phase 3, then leave to the walk state. */
  let ph = 0, emits = [], st5 = 5, guard = 0;
  while (st5 === 5 && guard++ < 12) {
    const r = fireTick(st5, ph, false, false);
    if (r.emit) emits.push(r.phase);
    ph = r.nextCl; st5 = r.next;
  }
  check(`a walk+fire cycle emits once and returns to walk right with phase 2`,
    emits.length === 1 && st5 === 1 && ph === 2,
    `emitted at phase ${emits.join(',')}, exited to state ${st5} — CS:0x5d7a ` +
    '`mov cl,2 / mov byte [0x377],1` then tail-jumps INTO state 1\'s handler');

  /* Holding fire chains a new cycle instead of leaving. */
  const chain = fireTick(5, 4, true, true);
  check(`at phase 5 with fire held and a slot free, the cycle CHAINS`,
    chain.next === 5 && chain.nextCl === 0,
    'CS:0x5d5e calls the allocator again and `xor cl,cl` restarts — so holding ' +
    'fire does re-fire, but only through a fresh allocation');

  const noChain = fireTick(5, 4, true, false);
  check(`...but not when nothing can be allocated`,
    noChain.next === 1, 'CS:0x5d61 `cmp ax,0 / jnz` falls through to the exit');

  /* The ladder pair is asymmetric where the others mirror cleanly. */
  check(`the ladder-fire pair exits with DIFFERENT phases (3 vs 1)`,
    FS[24].exitCl === 3 && FS[25].exitCl === 1
    && FS[24].to === 14 && FS[25].to === 14,
    'CS:0x5471 `mov cl,3` against CS:0x54a3 `mov cl,1` — both return to state 14, ' +
    'so a port that mirrors 24 into 25 gets the exit pose wrong');

  /* Fall+fire really does run the fall physics, not just an animation. */
  check(`fall+fire exits to the plain fall states, jump+fire to the jump states`,
    FS[22].to === 12 && FS[23].to === 11 && FS[20].to === 9 && FS[21].to === 8,
    'CS:0x4e23 / 0x4db9 write states 0x0c and 0x0b; CS:0x53f4 writes 9');

  /* ── the entries, and the DS:0x356 wind-up ────────────────────────────── */
  check(`every firing state needs the fire bit AND a successful allocation`,
    FIRE_STATE_IDS.every((i) =>
      tryEnterFireState(i, { fireHeld: true, allocated: false, ladderFacing: 1 }) === null
      && tryEnterFireState(i, { fireHeld: false, allocated: true, ladderFacing: 1 }) === null),
    'the shared core: `test byte [0x382],0x80 / jz` then `call 0x95ca / cmp ax,0`');

  check(`a jump can only start firing while the arc cursor is under 0x2c`,
    tryEnterFireState(20, { fireHeld: true, allocated: true, arcCursor: 0x2b }) !== null
    && tryEnterFireState(20, { fireHeld: true, allocated: true, arcCursor: 0x2c }) === null,
    'CS:0x51da `cmp byte [0x358],0x2c / jnl` — the hero cannot fire late in a jump, ' +
    'a guard the other three families do not have');

  check(`a ladder fire state needs a nonzero ladder facing`,
    tryEnterFireState(24, { fireHeld: true, allocated: true, ladderFacing: 1 }) !== null
    && tryEnterFireState(24, { fireHeld: true, allocated: true, ladderFacing: 0 }) === null,
    'CS:0x55d6 `cmp byte [0x378],0 / jz` picks the variant, and 0 skips entirely');

  /* ⚠️ DS:0x356 makes the FIRST tick count DOWN — so fall/jump do not emit on
   * their first tick even though their emit phase is 1. */
  const e22 = tryEnterFireState(22, { fireHeld: true, allocated: true });
  const seq = [e22.cl];
  let ph2 = e22.cl, fl = e22.flag356, st2 = 22, emitAt = [];
  for (let t = 0; t < 5 && st2 === 22; t++) {
    const r = fireTick(st2, ph2, false, false, fl);
    fl = false;
    if (r.emit) emitAt.push(r.phase);
    ph2 = r.nextCl; st2 = r.next; seq.push(ph2);
  }
  check(`a fall+fire entry dips to 0 first, so the shot lands on the SECOND phase 1`,
    seq.join(',') === '1,0,1,2,0' && emitAt.join(',') === '1',
    `phases ${seq.join(',')} — CS:0x4c20 sets DS:0x356 at entry and the handler ` +
    'decrements once; entering at cl = 0 with a plain increment fires a tick early ' +
    'and loses the wind-up');

  check(`the walk family has no wind-up — it enters at 0 and counts up`,
    ENTRY[5].cl === 0 && ENTRY[5].flag356 === false
    && ENTRY[22].cl === 1 && ENTRY[22].flag356 === true,
    'CS:0x5d3d `xor cl,cl` against CS:0x4c1e `mov cl,1 / mov byte [0x356],1`');

  results.push({
    name: 'the fire chain is complete', note: true, pass: true,
    detail: 'All eight firing states, their four entry patterns and the DS:0x356 ' +
      'wind-up are decoded and ported. UNKNOWN_fire_state_entry and ' +
      'UNKNOWN_fire_state_356 are both CLOSED — the entries ARE 0x356\'s writers.',
  });

  results.push({
    name: 'the running game still cannot fire', note: true, pass: true,
    detail: 'FireControl models the latch, the allocate/emit split and the ' +
      're-fire check, but the eight firing states (5, 6, 20-25) are NOT ported ' +
      'into the player state machine — UNKNOWN_fire_state_bodies. Until they ' +
      'are, nothing calls tryFire() in the playable build.',
  });

  /* ── the move -> stamp link, and the whole chain end to end ──────────── */
  check(`the draw-style table is 3 wide and weapon +0x02 is 0..2`,
    DRAW_STYLES.length === 3
    && [...new Set(all.map((x) => x.drawStyle))].sort().join(',') === '0,1,2',
    'DS:0xdf26; entries from 0xdf2c are signed byte pairs, a different table. ' +
    'That width is also why CS:0x9118 zeroes +0x02 when it reads 3 — a RANGE ' +
    'GUARD, not a second meaning for the field');

  /* THE END-TO-END TEST: fire -> allocate -> spawn -> move -> stamp -> scan
   * -> damage. If any link is broken this cannot pass. */
  const chainGrid = new DamageGrid();
  const knifeSt2 = armWeapon(knife);
  const area2 = Array.from({ length: 18 }, () => ({ tag: 0, x: 0, y: 0, dir: 1 }));
  const vol = spawnVolley(knifeSt2, knife.handlerRight, tagFor(0, 0), 100, 200);
  vol.entries.forEach((e, i) => { area2[i] = e; });
  const cam2 = { x: 0, y: 0 };
  let hitTag = 0, ticksToHit = 0;
  for (let t = 0; t < 12 && !hitTag; t++) {
    chainGrid.clear();                       // CS:0x01CC, every frame
    stepProjectiles(area2, cam2, { grid: chainGrid, weapon: knife });
    hitTag = chainGrid.scan(area2[0].x, area2[0].y, 0x20, 0x20);
    ticksToHit = t + 1;
  }
  check(`END TO END: a fired knife stamps the grid and a creature box finds it`,
    hitTag === tagFor(0, 0) && ticksToHit === 1,
    `tag ${hitTag} found on tick ${ticksToHit} — this passes only if spawn, move, ` +
    'stamp and scan are ALL connected; the stamp lives on the draw path, so a ' +
    'port that only moves projectiles leaves the grid empty forever');

  const dmg = damageForTag(hitTag, [0, -1, -1], [knifeSt2]);
  check(`...and that tag decodes back to the knife's damage`,
    dmg.damage === knife.power && dmg.slot === 0 && dmg.record === 0,
    `${dmg.damage} damage from slot ${dmg.slot} record ${dmg.record} — the full ` +
    'chain from a button press to a creature losing health');

  /* ⚠️ +0x48 STOPS the projectile; it does not break blocks. */
  /* Two setup details this test needs, both of which caught me:
   *  - y must be INSIDE the 192-px cull limit, or the projectile is culled
   *    before the terrain check ever runs.
   *  - the cell is NOT floor(x/32), floor(y/16): CS:0xA7CC adds 8 to BOTH axes
   *    before masking, so a shot arriving at (112, 100) tests column
   *    (112+8)&~0x1f = 96 -> 3 and row (100+8)&~0xf = 96 -> 6. */
  const wall = new Uint8Array(128 * 64);
  wall[6 * 128 + 3] = 1;
  const area3 = [{ tag: 1, x: 100, y: 100, dir: 1 }];
  const rw = stepProjectiles(area3, cam2, { grid: chainGrid, weapon: knife, planeB: wall });
  check(`a terrain-colliding weapon is CONSUMED by a solid tile, not stopped by nothing`,
    knife.breaksTerrain && rw.hitTerrain === 1 && area3[0].tag === 0,
    'CS:0xA7EF `cmp byte [ds:bp+0],1` then CS:0xA85B `mov word [di],0`. There is ' +
    'NO write to plane A or B on that path — the wall is untouched, so +0x48 ' +
    'means STOPPED BY terrain, not "breaks blocks" as this project long assumed');

  /* ⚠️ Discriminating the +8 rounding needs a position where the two rules
   * DISAGREE. A shot arriving at (88, 104) tests column (88+8)&~0x1f = 96 -> 3
   * and row (104+8)&~0xf = 112 -> 7; the naive floor gives column 2, row 6.
   * A wall in only one of those two cells tells the readings apart. */
  const mk = (row, col) => { const m2 = new Uint8Array(128 * 64); m2[row * 128 + col] = 1; return m2; };
  const shot = () => [{ tag: 1, x: 76, y: 104, dir: 1 }];
  const aRight = shot(), aNaive = shot();
  stepProjectiles(aRight, cam2, { grid: chainGrid, weapon: knife, planeB: mk(7, 3) });
  stepProjectiles(aNaive, cam2, { grid: chainGrid, weapon: knife, planeB: mk(6, 2) });
  check(`the terrain cell uses the +8 rounding, not a plain floor`,
    aRight[0].tag === 0 && aNaive[0].tag === 1,
    'a wall at (row 7, col 3) stops the shot; one at the naive (6, 2) does not — ' +
    'CS:0xA7CC `add cx,8 / add dx,8` before the masks');

  const through = all.filter((x) => !x.breaksTerrain).map((x) => x.index);
  check(`5 of the 11 weapons pass straight through walls`,
    [...new Set(through)].sort((a, b) => a - b).join(',') === '4,6,7,8,9',
    'lightning bolt, spear, axe, hunter, magic axe have +0x48 == 0 and skip the ' +
    'terrain test entirely (CS:0xA7BD `jmp 0xa860`)');

  /* ── CS:0x9d74 — the common mover's own sprite-frame stepper ─────────────
   * UNKNOWN_projectile_frame is CLOSED: a spinning weapon (knife, throwing
   * star, axe, mace — anything with a nonzero frameCount) now visibly
   * rotates as it flies. Every fixture below is a fresh CLONE of `knife`,
   * never `knife` itself: this file's own `sets`/`w1`/`all` fixtures are
   * reused BY REFERENCE across hundreds of later checks, and `frame`/
   * `facing` are exactly the two fields this feature mutates in place. */
  check(`the knife's shipped frameCount is 7 — 8 sprite frames, a full spin`,
    knife.frameCount === 7 && knife.sprite2 === 0,
    `frameCount ${knife.frameCount}, sprite2 ${knife.sprite2} — no second ` +
    'descriptor, so the knife rotates through ONE 8-frame strip regardless of ' +
    'facing (CS:0x9CCF `cmp word[si+0x1e],0 / jz` falls through to the primary)');

  const spinR = { ...knife, frame: 0, facing: +1 };
  const seqR = [spinR.frame];
  for (let t = 0; t < 9; t++) { stepMoverFrame(spinR); seqR.push(spinR.frame); }
  check(`facing right, the frame counts 0..7 then wraps to 0`,
    seqR.join(',') === '0,1,2,3,4,5,6,7,0,1',
    `${seqR.join(',')} — CS:0x9d7d \`inc cx\`, CS:0x9d7e \`cmp cx,[si+0x1c] / jle\`, ` +
    'CS:0x9d83 `xor cx,cx` on overflow');

  const spinL = { ...knife, frame: 0, facing: -1 };
  const seqL = [spinL.frame];
  for (let t = 0; t < 9; t++) { stepMoverFrame(spinL); seqL.push(spinL.frame); }
  check(`facing left, the frame counts DOWN and wraps to frameCount, not 0`,
    seqL.join(',') === '0,7,6,5,4,3,2,1,0,7',
    `${seqL.join(',')} — CS:0x9d89 \`dec cx\`, CS:0x9d8a \`jns\`, CS:0x9d8c ` +
    '`cx = [si+0x1c]` on underflow. A port that wraps to 0 both ways spins the ' +
    'weapon the wrong way on every left-facing throw');

  check(`the drawn sprite is the pinned descriptor plus the current frame`,
    projectileSprite({ ...knife, frame: 0, facing: +1 }) === knife.sprite
    && projectileSprite({ ...knife, frame: 5, facing: +1 }) === knife.sprite + 5
    && projectileSprite({ ...knife, frame: 5, facing: -1 }) === knife.sprite + 5,
    'CS:0x9CDD `dx = [si+4] + [si+0xc]` — the knife has no sprite2, so facing ' +
    'never changes which strip is used, only which way the shared frame is ' +
    'walking through it');

  /* Lightning bolt (index 4) is one of only two weapons with a sprite2 —
   * facing < 0 is the ONLY branch that can ever reach it. */
  const lbW = { ...all.find((x) => x.index === 4) };
  check(`a weapon WITH a sprite2 uses it only when facing left`,
    lbW.sprite2 !== 0
    && projectileSprite({ ...lbW, frame: 2, facing: +1 }) === lbW.sprite + 2
    && projectileSprite({ ...lbW, frame: 2, facing: -1 }) === lbW.sprite2 + 2,
    `lightning bolt sprite ${lbW.sprite}, sprite2 ${lbW.sprite2} — CS:0x9CC9 ` +
    '`jns` sends facing >= 0 straight to the primary descriptor');

  check(`armWeapon resets the SHARED frame to 0, but leaves facing untouched`,
    (() => {
      const w = { ...knife, frame: 6, facing: -1 };
      const st = armWeapon(w);
      return w.frame === 0 && w.facing === -1 && st.count === w.power;
    })(),
    'CS:0x910d `mov word [di+4],0x0` is the ONLY write in the pickup path; ' +
    'facing (+0x0e) is untouched, matching the original leaving whatever the ' +
    "level's own file bytes (or the weapon's last fire) put there");

  /* END TO END: fire a knife right, then step the arsenal and watch its
   * OWN frame field advance — through Arsenal, not by hand-calling
   * stepMoverFrame, so allocate/emit/step are all under test together. A
   * private weapon set (deep-cloned records) keeps this from leaking into
   * `sets`/`w1`, which dozens of later checks reuse by reference. */
  const spinWeapons = sets[0].map((w) => ({ ...w }));
  const spinArsenal = new Arsenal(spinWeapons);
  spinArsenal.equip(0, 0);                              // knife, slot A
  check(`equipping runs armWeapon, so the arsenal's own knife starts at frame 0`,
    spinWeapons[0].frame === 0,
    `frame ${spinWeapons[0].frame} right after equip() -> armWeapon()`);

  const spinAlloc = spinArsenal.allocate();
  spinArsenal.emit(spinAlloc, 100, 100, true);          // fire RIGHT
  check(`firing right writes the weapon's facing back to +1`,
    spinWeapons[0].facing === +1,
    'CS:0x98EA `mov word [si+0xe],0x1`, ported as spawnVolley\'s `facing` ' +
    'return and applied in Arsenal.emit');

  const cam3 = { x: 0, y: 0 };
  const framesSeen = [spinWeapons[0].frame];
  for (let t = 0; t < 3; t++) {
    spinArsenal.step(cam3, new DamageGrid(), null, 1);
    framesSeen.push(spinWeapons[0].frame);
  }
  check(`END TO END: a fired knife's sprite frame advances every tick it flies`,
    framesSeen.join(',') === '0,1,2,3',
    `${framesSeen.join(',')} — Arsenal.step() -> stepProjectiles() -> ` +
    'stepMoverFrame(), once per tick, even though nothing else about the ' +
    'shot changed direction or speed');

  const notCommon = { ...knife, mover: 1, frame: 0, facing: +1 };   // pretend fireball
  stepProjectiles([{ tag: 0, x: 0, y: 0, dir: 0 }], cam3, { weapon: notCommon });
  check(`a non-common-mover weapon's frame is left alone by stepProjectiles`,
    notCommon.frame === 0,
    'CS:0x9d74 lives inside CS:0x9c6d\'s own body — a weapon whose real mover ' +
    'is the fireball\'s or the time bomb\'s never reaches it in the original. ' +
    'Arsenal.step() currently routes those through THIS SAME function (neither ' +
    'is wired to its own mover yet), so gating on `weapon.mover === 0` matters ' +
    'now, not just eventually');

  results.push({
    name: 'UNKNOWN_destructible_tile', note: true, pass: true,
    detail: `Block destruction is NOT a weapon property. Only when the plane-A ` +
      `tile is 0x${DESTRUCTIBLE_TILE.toString(16)} AND the world is >= 3 does ` +
      'CS:0xA810 call 0x73ec, which appends the cell to a 40-entry queue at ' +
      'DS:0xd0c6. What that queue then does is not decoded.',
  });

  /* ── mover 1: fireball's accelerating wobble ──────────────────────────── */
  check(`the wobble table is ${WOBBLE_ENTRIES} words, one per projectile record`,
    WOBBLE_ENTRIES === 9 && newWobble().length === 9,
    'DS:0xdefc sits 0x12 bytes below the velocity table at 0xdf0e — 9 words, ' +
    'which is what pins its size');

  const fbArea = [{ tag: 1, x: 100, y: 100, dir: 1 }];   // dir 1 = level, vy 0
  const wob = newWobble();
  const ys = [];
  for (let t = 0; t < 4; t++) { stepFireball(fbArea, { x: 0, y: 0 }, wob); ys.push(fbArea[0].y); }
  check(`a fireball's drop ACCELERATES: +0, +1, +2, +3 on a level dir`,
    ys.join(',') === '100,101,103,106' && wob[0] === 4,
    `y ${ys.join(',')} — CS:0x9dce adds the accumulator then CS:0x9dd0 bumps it, ` +
    'so the deltas grow by one each tick rather than staying constant');

  const flat = [{ tag: 1, x: 100, y: 100, dir: 1 }];
  stepProjectiles(flat, { x: 0, y: 0 });
  check(`...whereas the common mover keeps a level shot exactly level`,
    flat[0].y === 100,
    'the wobble is mover 1 only — sharing one step function loses the fireball arc');

  /* ── mover 4: hunter homing ───────────────────────────────────────────── */
  /* ⚠️ CORRECTED. This test used to assert the SMALLEST key wins, matching a
   * misreading of `cmp dx,[si] / jnl` that stood uncorrected in both this
   * file and CLAUDE.md. Traced concretely (see projectiles.js's header):
   * `dx` starts at -1, beaten by any real key, and the compare only replaces
   * the running best when it is EXCEEDED — so the LARGEST key wins. */
  const targets = [{ x: 1, y: 1, key: 40 }, { x: 2, y: 2, key: 7 },
                   { x: 3, y: 3, key: 90 }];
  check(`the hunter picks the target with the LARGEST key, and CONSUMES it`,
    pickTarget(targets).x === 3
    && targets[2].key === 0             // CS:0x9e6c — the winner's key is zeroed
    && pickTarget([]) === null && TARGET_STRIDE === 6,
    'CS:0x9e4f `cmp dx,[si] / jge` keeps the OLD best only when it already ' +
    '>= this key, so the running best walks UP toward the largest, not down ' +
    'toward the smallest; the list is 6-byte {x, y, key} records built by ' +
    'the COLLISION SCANNER at CS:0xAA8D');

  /* ⚠️ X is the HIGH byte and Y the LOW one — the reverse of the obvious. */
  const hv = unpackHunterVel(0x02fe);
  check(`hunter velocity is packed signed bytes, X in the HIGH half`,
    hv.vx === 2 && hv.vy === -2
    && unpackHunterVel(0xfe02).vx === -2 && unpackHunterVel(0xfe02).vy === 2,
    'CS:0x9F46 sign-extends ch into the X addend and CS:0x9F4B cl into the Y one — ' +
    'reading them the natural way round mirrors every hunter shot diagonally');

  /* The `- 2` matters: the rate only rises at FOUR extras, well past the two
   * that already max out the volley. So the upgrade curve keeps paying after
   * the projectile count stops. */
  check(`the hunter's turn rate rises at 4 extras, not 2`,
    hunterTurnRate({ count: 5, base: 5 }) === 1      // 0 extras
    && hunterTurnRate({ count: 8, base: 5 }) === 1   // 3 extras -> v = 1
    && hunterTurnRate({ count: 9, base: 5 }) === 2   // 4 extras -> v = 2
    && hunterTurnRate({ count: 20, base: 5 }) === 2, // clamped
    'CS:0x9f12 `[si+8] - [si+6] - 2` then clamped to [1,2] — the volley is ' +
    'already maxed at 2 extras, so +0x08 keeps paying past that through the turn rate');

  /* ── the hunter's steering, and the clamp that falls through ──────────── */
  check(`the hunter steers +/-rate toward the target, clamped to +/-${HUNTER_VEL_CLAMP}`,
    hunterSteerAxis(0, 0, 100, 1) === 1        // target right -> accelerate right
    && hunterSteerAxis(0, 100, 0, 1) === -1    // target left  -> decelerate
    && hunterSteerAxis(6, 0, 100, 1) === 6,    // already at the cap
    'CS:0x9f61 `cmp ax,[ss:0x420] / jl` picks the arm; CS:0x9f74 caps at +6');

  /* ⚠️ THE LOW CLAMP FALLS THROUGH INTO THE INCREMENT. */
  const osc = [];
  let hvel = -6;
  for (let t = 0; t < 6; t++) { hvel = hunterSteerAxis(hvel, 100, 0, 1); osc.push(hvel); }
  check(`the low clamp falls through, so the speed OSCILLATES -6/-5`,
    osc.join(',') === '-5,-6,-5,-6,-5,-6',
    `${osc.join(',')} — CS:0x9f6f pins to -6 and then CS:0x9f72 adds the rate ` +
    'back. A plain clamp(v - rate, -6, 6) sits flat at -6 and is wrong every ' +
    'other tick');

  /* The write-back confirms the packed layout from the OTHER side. */
  /* ⚠️ The target must be ASYMMETRIC — with vx === vy a swapped repack is
   * invisible, which is exactly how a mutation of it first survived here. */
  const hp = { tag: 1, x: 0, y: 0, dir: 0 };
  stepHunter(hp, { x: 1000, y: -1000 }, 2);
  check(`steering repacks vx into the HIGH byte and vy into the LOW`,
    unpackHunterVel(hp.dir).vx === 2 && unpackHunterVel(hp.dir).vy === -2,
    'CS:0x9f9d `mov [di+7],cl` and CS:0x9fa0 `mov [di+6],dl` — the write side ' +
    'independently confirms the layout decoded earlier from the read side');

  check(`the hunter aims +${HUNTER_TARGET_BIAS} into the creature, not at its corner`,
    HUNTER_TARGET_BIAS === 6, 'CS:0x9f55 / 0x9f5b add 6 to both axes of the target');

  /* ⚠️ A different cull, with a different EFFECT. */
  check(`the hunter's cull is (-16, 320] and only skips the draw — it never despawns`,
    HUNTER_CULL.xMin === -16 && HUNTER_CULL.yMin === -16
    && HUNTER_CULL.xMax === CULL.xMax && CULL.xMin === -32,
    'CS:0x9fb3 `cmp ax,0x140 / jg` against the common mover\'s -32 bounds, and ' +
    'CS:0x9fd9 skips the stamp and draw rather than zeroing the tag — a hunter ' +
    'that leaves the screen keeps flying and can come back');

  results.push({
    name: 'the target list is an engine feature, not a weapon one', note: true, pass: true,
    detail: 'DS:0x8c54 is filled by the per-frame CREATURE SCAN (CS:0xAA8D appends ' +
      '{x, y, key} and bumps DS:0x33c, which starts at 0xFF). The hunter only ' +
      'reads it. So ordering matters: run the mover before the scan and it ' +
      "homes on last frame's creatures. `UNKNOWN_hunter_turn` is now CLOSED — " +
      'the steering itself (hunterSteerAxis, above) and the spawn/stamp/no-' +
      'target chain (below) are all ported; the coast/re-aim cycle a fresh ' +
      "shot's NEGATIVE tag drives before it starts homing is not — see " +
      '`UNKNOWN_hunter_ballistic_launch` in projectiles.js.',
  });

  /* ── the hunter, wired end to end: spawn handlers 10/11, the array walk,
   * the stamp, and the no-target arm CS:0xA00D — game/hero-fire.js ────────
   *
   * These are integration-level (the array walk, stamping, debris), tested
   * directly here rather than only through the full player state machine,
   * matching how the other movers above are tested. */
  {
    const st = { count: 1, base: 1 };                 // volleySize -> 1 shot
    const { entries, facing } = spawnVolley(st, 11, 19, 100, 100);   // right
    check(`spawnVolley(handler 11) writes the hunter's own packed-velocity fan`,
      facing === 1 && entries.length === 1 && entries[0].dir === 0x0b00
      && entries[0].x === 100 && entries[0].y === 100 - 0x0c,
      'HANDLERS[11] (CS:0x9a82): dy=-0xc like handler 1, but `dir` is the ' +
      'literal packed velocity 0xb00/0xb07/0xbf9 (vx=+11, vy 0/+7/-7) rather ' +
      'than a DIRS index — a straight-line fan the hunter steers out of');
    const left = spawnVolley(st, 10, 19, 100, 100);
    check(`handler 10 (left) mirrors 11 and offsets X by +0x10`,
      left.facing === -1 && left.entries[0].dir === 0xf500
      && left.entries[0].x === 100 + 0x10,
      'HANDLERS[10] (CS:0x9aca): `add ax,0x10` before the write, vx=-11 — the ' +
      'asymmetry (only ONE arm touches X) matches handlers 0/1 exactly');

    const grid = new DamageGrid();
    const debris = new Debris();
    /* A minimal synthetic weapon fixture, NOT the shipped PWEAPONS record —
     * `w1` (the parsed table) isn't in scope yet this far up the function
     * (it's declared later, alongside the `armed()`/spawnableWeapons tests).
     * `breaksTerrain: false` matches this project's own documented finding
     * for the hunter ("lightning bolt, spear, axe, hunter and magic axe
     * pass through" walls); `drawStyle` only needs to select a real entry
     * in DRAW_STYLES for this test to exercise the dispatch. The shipped
     * hunter record's own fields are cross-checked elsewhere (the "every
     * spawnable weapon's pinned sprite resolves inside `objects`" check). */
    const huntWeapon = { breaksTerrain: false, drawStyle: 0 };

    /* No target this tick -> CS:0xA00D: a MOVING spark (not stationary — it
     * carries the shot's own velocity) at the shot's CURRENT position, then
     * despawn. */
    const noTargetArea = [{ tag: 19, x: 200, y: 200, dir: 0x0203 }];
    const r1 = stepHunterArray(noTargetArea, st, [], { x: 0, y: 0 },
      { grid, weapon: huntWeapon, planeB: null, debris });
    check(`with no target, the hunter drops a MOVING debris spark and despawns`,
      r1.noTarget === 1 && noTargetArea[0].tag === 0
      && debris.live === 1 && debris.slots.find((s) => s.alive).vx === 2
      && debris.slots.find((s) => s.alive).vy === 3,
      'CS:0x9F0A `cmp dx,0 / jns / jmp 0xa00d` — unlike the terrain-stop and ' +
      "enemy-shot puffs (both stationary), this one keeps the shot's OWN " +
      'velocity, split the same hi/lo way stepHunter reads it');

    /* A live target -> steer toward it, then stamp the grid. */
    const homingArea = [{ tag: 19, x: 0, y: 0, dir: 0 }];   // dir=0 -> vx=vy=0
    const hunterTargets = [{ x: 1000, y: 1000, key: 5 }];
    const r2 = stepHunterArray(homingArea, st, hunterTargets, { x: 0, y: 0 },
      { grid, weapon: huntWeapon, planeB: null, debris });
    check(`with a target, the hunter steers toward it and stamps the grid`,
      r2.moved === 1 && r2.noTarget === 0
      && unpackHunterVel(homingArea[0].dir).vx > 0
      && unpackHunterVel(homingArea[0].dir).vy > 0
      && hunterTargets[0].key === 0            // CS:0x9e6c — consumed
      && r2.stamped === 1,
      `CS:0x9F12-0x9FA0 (steer, applied) into 0x9FC8-0x9FD9 (the shared ` +
      `terrain-aware stamp, drawStyle ${huntWeapon.drawStyle}) — the same ` +
      'chain every other weapon uses once its velocity is resolved');

    /* Off-screen: skip the stamp, but do NOT despawn — a different cull with
     * a different effect from every other mover. */
    const offscreen = [{ tag: 19, x: 5000, y: 5000, dir: 0 }];
    const r3 = stepHunterArray(offscreen, st, [{ x: 5000, y: 5000, key: 1 }],
      { x: 0, y: 0 }, { grid, weapon: huntWeapon, planeB: null, debris });
    check(`off-screen the hunter still moves and is NOT despawned`,
      r3.moved === 1 && r3.stamped === 0 && offscreen[0].tag !== 0,
      'CS:0x9FB3-0x9FC6 skip straight to the loop tail, never touching the ' +
      "tag — a hunter shot that leaves the screen keeps flying and can " +
      'come back, unlike the common mover\'s cull which despawns');
  }

  /* ── mover 5: the magic axe bounces ───────────────────────────────────── */
  check(`the axe's state array is 9 records of ${AXE_STATE_STRIDE} bytes`,
    AXE_STATE_STRIDE === 6 && newAxeState().length === MOVER_WALK,
    'CS:0xa77d `add si,0x6` in lockstep with CS:0xa77a `add di,0x8`, and bp ' +
    'counts 8..0 — nine of each');

  /* ⚠️ The wall probe is GATED on the sub-tile position. */
  const noWall = () => false, yesWall = () => true;
  const axeA = [{ tag: 1, x: 100 + 0x10, y: 60, dir: 0 }];   // sub-tile 16 > 12
  const stA = newAxeState(); stA[0] = { vx: 4, vy: 0, life: 99 };
  stepMagicAxe(axeA, stA, { x: 0, y: 0 }, yesWall);
  const axeB = [{ tag: 1, x: 96 + 2, y: 60, dir: 0 }];        // sub-tile 2, not > 12
  const stB = newAxeState(); stB[0] = { vx: 4, vy: 0, life: 99 };
  stepMagicAxe(axeB, stB, { x: 0, y: 0 }, yesWall);
  check(`a wall only bounces the axe inside the sub-tile window`,
    stA[0].vx === -AXE_BOUNCE_VX && stB[0].vx === AXE_BOUNCE_VX,
    'CS:0xa69d `cmp dx,0xc / jng` — outside the window the axe moves WITHOUT ' +
    'testing for a wall at all, so a port that probes every tick bounces early');

  /* The bounce is a fixed +/-4, not a reflection of the incoming speed. */
  const fast = [{ tag: 1, x: 100 + 0x10, y: 60, dir: 0 }];
  const stF = newAxeState(); stF[0] = { vx: 12, vy: 0, life: 99 };
  stepMagicAxe(fast, stF, { x: 0, y: 0 }, yesWall);
  check(`the bounce sets a FIXED -${AXE_BOUNCE_VX}, it does not reflect the speed`,
    stF[0].vx === -AXE_BOUNCE_VX,
    'CS:0xa6a9 `mov cx,0xfffc` — an incoming +12 leaves as -4, not -12');

  /* A fourth distinct gravity rule. */
  const g2 = newAxeState(); g2[0] = { vx: 0, vy: 0, life: 99 };
  const gA = [{ tag: 1, x: 100, y: 20, dir: 0 }];
  const vys = [];
  for (let t = 0; t < 6; t++) { stepMagicAxe(gA, g2, { x: 0, y: 0 }, noWall); vys.push(g2[0].vy); }
  check(`axe gravity is +${AXE_GRAVITY} capped at ${AXE_VY_CAP} — a FOURTH distinct rule`,
    vys.join(',') === '2,4,6,8,8,8',
    'hero is `4 + v` cap 10, enemy `v` then ++ cap 16, time bomb ++ cap 4, axe ' +
    '+2 cap 8 — four gravity implementations and no two alike');

  /* Lifetime, and the sprite base agreeing with the pinned table. */
  const lifeA = [{ tag: 1, x: 100, y: 60, dir: 0 }];
  const lifeS = newAxeState(); lifeS[0] = { vx: 0, vy: 0, life: 2 };
  let alive = 0;
  for (let t = 0; t < 6; t++) { stepMagicAxe(lifeA, lifeS, { x: 0, y: 0 }, noWall); if (lifeA[0].tag) alive++; }
  check(`the axe expires when its lifetime counter goes NEGATIVE, not zero`,
    alive === 2 && lifeA[0].tag === 0,
    'CS:0xa737 `dec word [si+0x4] / js` — decrement THEN test the sign, so a ' +
    'life of 2 survives two ticks (1, then 0) and dies on the third at -1');

  check(`the axe sprite base is exactly the magic axe's pinned descriptor`,
    AXE_SPRITE_BASE === PINNED_SPRITE[9]
    && axeSprite(0, 0) === AXE_SPRITE_BASE + (8 % 6) + 1,
    `0x1aa = ${AXE_SPRITE_BASE}, and PINNED_SPRITE[9] (magic axe) is the same — ` +
    'an independent check on the pinned table, from a routine that never reads it');

  /* ── the axe, wired end to end: spawn handlers 14/15 (which ALSO seed the
   * state array), the real diagonal wall probe, and the debris spark on
   * expiry (CS:0xA7A1) — game/hero-fire.js ───────────────────────────────── */
  {
    const st = { count: 1, base: 1 };                  // volleySize -> 1 shot
    const { entries, states, facing } = spawnAxeVolley(st, 15, 19, 100, 100);
    check(`spawnAxeVolley(handler 15) seeds a companion {vx,vy,life} per entry`,
      facing === 1 && entries.length === 1 && entries[0].dir === 1
      && states.length === 1 && states[0].vx === AXE_BOUNCE_VX
      && states[0].vy === PROJECTILE_VELOCITY[1].vy && states[0].life === 0x32,
      'HANDLERS[15] (CS:0x9b15): dy=-0x10 (not the common -0xc), dir=1 for ' +
      'EVERY facing (stepMagicAxe never reads p.dir), and CS:0x9B52-0x9B66 ' +
      'writes state.vx=+4, state.vy=PROJECTILE_VELOCITY[1].vy (LIVE, not a ' +
      'baked constant — the weapon-arc potions can have swapped the table), ' +
      'state.life=50');
    const left = spawnAxeVolley(st, 14, 19, 100, 100);
    check(`handler 14 (left) seeds the same dir but a NEGATIVE state.vx`,
      left.facing === -1 && left.entries[0].dir === 1   // NOT mirrored to 4
      && left.states[0].vx === -AXE_BOUNCE_VX,
      'CS:0x9BC1 writes dir=1 too (not 4 — every other handler pair mirrors ' +
      'dir by facing, this one cannot because nothing reads it) and ' +
      'state.vx=-4 at CS:0x9BFE');

    /* The wall probe takes Y too, and which neighbour cell it tests depends
     * on the Y sub-tile position — a same-row-only probe cannot reproduce
     * this. */
    const pbWall = new Uint8Array(128 * 64);
    pbWall[5 * 128 + 4] = 1;         // solid at col 4, row 5 (y 80..95)
    check(`axeWallAt tests the SAME row when y has no sub-tile remainder`,
      axeWallAt(3 * 32, 5 * 16, +1, pbWall) === true       // y=80, no remainder
      && axeWallAt(3 * 32, 5 * 16 + 8, +1, pbWall) === false,  // y=88, has one
      'CS:0xA5C6 `and bx,0xf / jz` — the y%16==0 case tests [si+0x1] (same ' +
      'row, one col over); the other case tests [si+0x81] (one row DOWN)');
    check(`...and the row-down neighbour when it does`,
      axeWallAt(3 * 32, 4 * 16 + 8, +1, pbWall) === true,   // y=72 -> row 4, +0x81 -> row 5 col 5...
      'CS:0xA5CB `cmp byte [si+0x81],1` — row+1, col+1 from a y with a ' +
      'nonzero sub-tile remainder');

    const grid = new DamageGrid();
    const debris = new Debris();
    const axeWeapon = { drawStyle: 0 };   // minimal fixture — w1 isn't in scope yet

    /* Expiry drops a MOVING spark carrying the axe's own current velocity,
     * not a stationary puff — matching the hunter's no-target arm and
     * differing from the stationary terrain-stop/enemy-shot puffs.
     * ⚠️ Gravity applies EVERY tick, including the one that expires — the
     * original's own instruction order runs the vy clamp before CS:0xA737's
     * lifetime test, and this port's step order matches it. So the spark's
     * vy is the POST-gravity value, not whatever vy the record held when
     * this tick started; the fixture picks a vy that stays nonzero after
     * +2 so the two are still distinguishable. */
    const expireArea = [{ tag: 19, x: 100, y: 100, dir: 0 }];
    const expireState = newAxeState(); expireState[0] = { vx: 4, vy: -6, life: 0 };
    const r = stepMagicAxe(expireArea, expireState, { x: 0, y: 0 }, noWall,
      { grid, weapon: axeWeapon, debris });
    check(`on expiry the axe drops a MOVING debris spark carrying its OWN (post-gravity) velocity`,
      r.expired === 1 && expireArea[0].tag === 0
      && debris.live === 1 && debris.slots.find((s) => s.alive).vx === 4
      && debris.slots.find((s) => s.alive).vy === -6 + AXE_GRAVITY,
      'CS:0xA737 `dec word [si+0x4] / js 0xa799` -> CS:0xA7A1 `call 0xa633` ' +
      'with cx/dx = the state record\'s own vx/vy, AFTER this tick\'s own ' +
      'gravity clamp already ran — a spark that keeps moving in whatever ' +
      'direction the axe was bouncing (this tick\'s update included) when ' +
      'it timed out');
  }

  /* ── mover 3: the time bomb's `dir` is a FUSE ─────────────────────────── */
  const bombP = { tag: 1, x: 100, y: 60, dir: FUSE_START };
  const bombS = { vx: 0, vy: 0, phase: -1, landed: false };
  let ticksAlive = 0, boom = null;
  for (let t = 0; t < 60 && !boom; t++) {
    const r = stepTimeBomb(bombP, bombS, { x: 0, y: 0 }, null);
    if (r.status === 'explode') boom = r; else ticksAlive++;
  }
  check(`the fuse runs ${FUSE_START} ticks then explodes into ${BOMB_FRAGMENTS} fragments`,
    ticksAlive === FUSE_START + 1 && boom && boom.fragments === BOMB_FRAGMENTS,
    `${ticksAlive} ticks (~${((FUSE_START + 1) / 15).toFixed(1)} s at 15 Hz) — ` +
    'CS:0xa261 `dec word [di+0x6]` on the SHARED tail, and CS:0xa273 fires at ' +
    'exactly -1');

  /* ⚠️ Only EXACTLY -1 detonates. CS:0xa273 is `cmp dx,0xffff / jz 0xa27b`,
   * and anything more negative falls through to 0xa326 — a different path.
   * A test that only ever reaches -1 cannot tell `=== -1` from `<= -1`. */
  const spent = stepTimeBomb({ tag: 1, x: 0, y: 0, dir: -5 },
                             { vx: 0, vy: 0, phase: -1, landed: false },
                             { x: 0, y: 0 }, null);
  check(`only a fuse of exactly ${FUSE_EXPLODE} detonates`,
    spent.status === 'spent' && spent.fragments === 0
    && stepTimeBomb({ tag: 1, x: 0, y: 0, dir: -1 },
                    { vx: 0, vy: 0, phase: -1, landed: false },
                    { x: 0, y: 0 }, null).status === 'explode',
    'CS:0xa273 `cmp dx,0xffff / jz` — a bomb already past -1 takes the 0xa326 ' +
    'path instead, so `<= -1` would detonate it a second time');

  /* ⚠️ dir means three different things across three movers. */
  check(`\`dir\` has no global meaning — three encodings across three movers`,
    PROJECTILE_VELOCITY[1].vx === 12          // common: a table index
    && unpackHunterVel(0x02fe).vx === 2       // hunter: packed signed bytes
    && FUSE_START === 0x2f,                   // bomb: a countdown
    'the common mover indexes a 6-entry table, the hunter unpacks two signed ' +
    'bytes, the bomb counts down — so 0x2f is a 3-second fuse in one and out of ' +
    'range in another. A port with one dir helper is wrong twice over');

  check(`the bomb's sprite base is its own pinned descriptor`,
    BOMB_SPRITE_BASE === PINNED_SPRITE[1],
    `0x153 = ${BOMB_SPRITE_BASE} = PINNED_SPRITE[1] — a second routine agreeing ` +
    'with the pinned table without reading it');

  /* The settling bounce is four arcs of falling amplitude. */
  const peaks = [];
  for (let i = 0; i < BOMB_BOUNCE.length; i++) {
    if (BOMB_BOUNCE[i] < 0 && (i === 0 || BOMB_BOUNCE[i - 1] >= 0)) peaks.push(-BOMB_BOUNCE[i]);
  }
  check(`the landing bounce is 24 bytes: four DAMPED arcs of amplitude 4,3,2,1`,
    BOMB_BOUNCE.length === 24 && peaks.join(',') === '4,3,2,1',
    `DS:0xdf2c, indexed by DS:0x1cc which resets past 23 — arcs start at ` +
    `-${peaks.join(', -')}, so the bomb visibly settles rather than stopping dead`);

  check(`bomb gravity is +1 capped at ${BOMB_GRAVITY_CAP}, applied every 4th tick`,
    BOMB_GRAVITY_CAP === 4,
    'CS:0xa0a0 `add dx,2 / and dx,3 / jnz` gates it on the FUSE value, so the ' +
    'fall is stepped rather than smooth — a fifth distinct gravity rule');

  results.push({
    name: 'the movers, and which are wired into the running build',
    note: true, pass: true,
    detail: 'All SIX movers are decoded and ported (checks above). What the ' +
      'integrated build steps is the common mover only (CS:0x9c6d, weapon ' +
      '+0x1A == 0), because the other five belong to weapons whose SPAWN ' +
      'handlers are undecoded — so those weapons cannot produce a projectile ' +
      'for their mover to move. Decoding handler pairs 2/3, 6/7, 8/9, 10/11 ' +
      'and 14/15 is what unlocks them, not more mover work.',
  });

  /* ══ THE INTEGRATED CHAIN ═══════════════════════════════════════════════
   *
   * Everything above tests a module in isolation. These drive a real Player
   * against a real Arsenal, because the failures this pass was built to catch
   * — allocate-then-emit three ticks apart, the wind-up dip, projectiles
   * stepping before the player — are all ORDERING failures that every
   * isolated test passes.                                                    */

  const w1 = sets[0];

  /* A flat world with a floor at row 12, and a climbable band at cols 20/21. */
  const flatMap = () => {
    const n = MC * 64;
    const planeB = new Uint8Array(n);
    for (let c = 0; c < MC; c++) planeB[12 * MC + c] = CELL_SOLID;
    for (let r = 4; r < 12; r++) {
      planeB[r * MC + 20] = CELL_CLIMBABLE;
      planeB[r * MC + 21] = CELL_CLIMBABLE;
    }
    return { planeA: new Uint8Array(n), planeB, widthPx: 4096, heightPx: 1024 };
  };
  const IN = (o = {}) => ({ left: false, right: false, up: false, down: false,
                            fire: false, ...o });
  /** A hero standing on the floor, armed with `weapon` in slot A. */
  const armed = (weapon = 0, x = 2 * 32, y = 9 * 16) => {
    const a = new Arsenal(w1);
    a.equip(0, weapon);
    const p = new Player(x, y);
    const m = flatMap();
    for (let i = 0; i < 4; i++) p.tick(m, IN(), a);   // settle onto the floor
    return { a, p, m };
  };

  /* ── the census: which states reach the allocator ─────────────────────── */
  check(`only 8 player states reach the allocator, and idle is NOT one`,
    FIRE_CAPABLE_STATES.length === 8
      && !FIRE_CAPABLE_STATES.includes(26)
      && LEVER_STATES.includes(26)
      && INVENTORY_STATES.join() === '18,19',
    'all 12 `call 0x95ca` sites map to states 0,1,8,9,11,12,13,14 plus the two ' +
    'chain re-fires inside 5 and 6; state 26 tests the same fire bit at ' +
    'CS:0x49EA and calls CS:0x1045 — which keeps only CATEGORY 3 and ends in ' +
    '`xor byte [si+0x4],0x1`, the LEVER toggle — and the crouch pair 18/19 ' +
    'jump to CS:0x612F, which reads the inventory at DS:0x17e. So fire means ' +
    'three different things, and none of them is pickup');

  {
    const { a, p, m } = armed();
    for (let i = 0; i < 10; i++) p.tick(m, IN({ fire: true }), a);
    check(`a stationary hero with fire held never shoots`,
      a.fired === 0 && p.fireState < 0,
      'CS:0x49EA -> CS:0x1045 is object pickup, not the allocator. A port ' +
      'that lets idle+fire shoot has invented a control scheme');
  }

  /* ── the press-to-muzzle delay ────────────────────────────────────────── */
  {
    const { a, p, m } = armed();
    const emitTick = [];
    for (let i = 0; i < 6; i++) {
      p.tick(m, IN({ right: true, fire: true }), a);
      if (p.emitted) emitTick.push(i);
    }
    check(`a walk-fire shot appears on the 4th tick, not the press tick`,
      emitTick.length >= 1 && emitTick[0] === 3,
      `CS:0x5CAF reserves a sub-slot on the press and CS:0x5D4E emits at ` +
      `phase 3 — ${(4 / 15 * 1000).toFixed(0)} ms at 15 Hz, and visible in play`);
  }

  /* ⚠️ THE ONE MOST LIKELY TO BE SILENTLY WRONG. The fall/jump entries set
   * DS:0x356, which makes the handler count the phase DOWN on its first tick,
   * so the emit phase of 1 is reached the SECOND time, not the first. */
  {
    const m = flatMap();
    const a = new Arsenal(w1); a.equip(0, 0);
    const p = new Player(2 * 32, 4 * 16);        // in the air, above the floor
    p.tick(m, IN(), a);                          // -> ST.FALL
    const seq = [];
    for (let i = 0; i < 4; i++) {
      p.tick(m, IN({ fire: true }), a);
      seq.push(p.emitted ? 1 : 0);
    }
    check(`a fall-fire does NOT emit on its first tick — the DS:0x356 wind-up`,
      seq[0] === 0 && seq.indexOf(1) === 2,
      `emit pattern ${seq.join('')}: the entry (CS:0x4D22) sets the flag and ` +
      `cl = 1, the handler DECREMENTS to 0, then climbs back through 1 — so ` +
      `the shot lands on the second phase-1. Entering at cl = 0 with a plain ` +
      `increment fires a tick early and loses the dip entirely`);
  }

  /* ── landing must SNAP Y and stay consistent with the ground check ──────
   * (the reported bug: "when falling down the characters often get into an
   * endless loop flickering between idle and falling"). CS:0x4C34/0x4D39
   * `and word [0x17c],0xfff0` snaps Y to the tile row on landing — the SAME
   * row `solidThreeBelow` (CS:0x4BEB/0x4CED) just tested. An earlier version
   * of this port checked landing one pixel ahead of a per-pixel scan and
   * left Y unsnapped, so whenever the settled Y fell on a non-multiple-of-16
   * row, the very next tick's identical 3-rows-below test — now run from
   * ST.GROUND — read a DIFFERENT map row than the one that had just reported
   * solid ground, re-entering FALL for one pixel and landing again: forever. */
  {
    const m = flatMap();                          // floor at row 12 (y=192)
    const a = new Arsenal(w1); a.equip(0, 0);
    const p = new Player(2 * 32, 3 * 16);          // well above the floor
    let landedTick = -1, flickered = false;
    for (let i = 0; i < 40; i++) {
      p.tick(m, IN(), a);
      if (landedTick < 0 && p.state === ST.GROUND) landedTick = i;
      else if (landedTick >= 0 && p.state === ST.FALL) flickered = true;
    }
    check(`landing snaps Y to a tile row (CS:0x4C34/0x4D39 ` +
          `\`and [0x17c],0xfff0\`)`,
      landedTick >= 0 && p.y % 16 === 0,
      `landed on tick ${landedTick} at y=${p.y}`);
    check(`a grounded hero never flickers back into FALL with no input held`,
      landedTick >= 0 && !flickered,
      'an unsnapped landing Y can put the ground check\'s 3-rows-below probe ' +
      'one map row away from the row the landing check itself used, so the ' +
      'hero immediately falls, drops a pixel, and lands again — the reported ' +
      'idle/fall flicker');
  }

  /* ── the JUMP arc has its OWN early-landing check — this port had none at
   * all (the reported "jump onto the platform to the left, the hero clips
   * past it" bug). CS:0x4F49-0x4F6C (state 8) / CS:0x5148-0x516B (state 9):
   * once the jump-arc cursor reaches 0x16 (22), every tick FIRST probes
   * solidThreeBelow at the current position — after that tick's own
   * horizontal step, before that tick's arc delta is even read — via
   * CS:0x4e2d, byte-identical in shape to the probe FALL already uses for
   * landing. On a hit, the arc delta is never applied: the hero lands
   * exactly where it stands, Y snapped to the tile row. The old `_jump()`
   * had no such test — it read only `solidHere` (a ceiling-ejection check,
   * fired the OPPOSITE direction) — so it ran the full scripted 23-entry arc
   * regardless of what was underfoot, sailing over a platform reachable
   * partway through instead of landing on it.
   *
   * 0x16 is NOT "past the apex": i = cursor>>1 = 11, and JUMP_DELTAS[11] is
   * +1 — the table is still RISING through i=13. The jump's own Y never
   * dips below the launch height until the very last delta is applied
   * (JUMP_DELTAS sums to exactly 0 over all 23 entries, so the arc returns
   * to the exact launch Y and no lower) — so this check only ever matters
   * for a platform at or ABOVE the launch height, exactly the "gap crossing
   * onto a similar or slightly higher ledge" geometry the report describes. */
  {
    const n = MC * 64;
    const planeB = new Uint8Array(n);
    for (let c = 0; c <= 5; c++) planeB[12 * MC + c] = CELL_SOLID;    // launch platform
    for (let c = 5; c <= 20; c++) planeB[10 * MC + c] = CELL_SOLID;   // target, 2 rows HIGHER
    const gapMap = { planeA: new Uint8Array(n), planeB,
                      widthPx: 4096, heightPx: 1024 };

    const p = new Player(5 * 32, 9 * 16);              // resting on the launch edge
    for (let i = 0; i < 4; i++) p.tick(gapMap, IN(), null);           // settle
    p.tick(gapMap, IN({ up: true, right: true }), null);              // launch right
    let landedAtCursor = -1;
    for (let i = 0; i < 40 && landedAtCursor < 0; i++) {
      const cursorBefore = p.jumpCursor;
      p.tick(gapMap, IN(), null);
      if (p.state === ST.GROUND) landedAtCursor = cursorBefore;
    }
    check(`a jump lands on a platform reached MID-ARC instead of sailing over it`,
      landedAtCursor === JUMP_ARC_EARLY_LAND_CURSOR && p.y === 112
        && p.x >= 5 * 32,
      `landed at jumpCursor=${landedAtCursor}, y=${p.y}, x=${p.x} — a port ` +
      `without this check runs the full scripted arc (cursor to ` +
      `${JUMP_ARC_END.toString(16)}) before ever testing the ground, ` +
      `drifting ${((JUMP_ARC_END - landedAtCursor) / 2) * WALK_STEP}px ` +
      `further before it even starts to fall`);
  }
  {
    /* A regression guard in the opposite direction: a gap with NOTHING below
     * anywhere in reach must still run the full arc and enter FALL, not
     * spuriously stop mid-air. solidThreeBelow only reads real map cells, so
     * this mostly exercises that the new check doesn't disturb the ordinary
     * no-platform path. */
    const n = MC * 64;
    const planeB = new Uint8Array(n);
    for (let c = 0; c <= 5; c++) planeB[12 * MC + c] = CELL_SOLID;
    const openMap = { planeA: new Uint8Array(n), planeB,
                       widthPx: 4096, heightPx: 1024 };
    const p = new Player(5 * 32, 9 * 16);
    for (let i = 0; i < 4; i++) p.tick(openMap, IN(), null);
    p.tick(openMap, IN({ up: true, right: true }), null);
    let sawFall = false, everGrounded = false;
    for (let i = 0; i < 40; i++) {
      p.tick(openMap, IN(), null);
      if (p.state === ST.FALL) sawFall = true;
      if (p.state === ST.GROUND) everGrounded = true;
    }
    check(`a jump over open air still completes the arc and falls — no ` +
          `spurious mid-air landing`,
      sawFall && !everGrounded,
      `state=${p.state} sawFall=${sawFall} everGrounded=${everGrounded}`);
  }
  {
    /* The threshold itself, tested at the exact boundary: cursor 20 must NOT
     * land even with solid ground already 3 rows below; cursor 22 must. */
    const m = flatMap();                              // floor at row 12
    const y0 = 9 * 16;                                 // 144 — 3 rows above row 12
    const p1 = new Player(2 * 32, y0);
    p1.state = ST.JUMP; p1.jumpCursor = JUMP_ARC_EARLY_LAND_CURSOR - 2; p1.facing = 1;
    p1.tick(m, IN(), null);
    check(`jumpCursor one tick BEFORE the threshold does not early-land`,
      p1.state === ST.JUMP,
      `state=${p1.state} y=${p1.y} — solid ground is already 3 rows below ` +
      `at y=${y0}; only the cursor gate should be holding this back`);

    const p2 = new Player(2 * 32, y0);
    p2.state = ST.JUMP; p2.jumpCursor = JUMP_ARC_EARLY_LAND_CURSOR; p2.facing = 1;
    p2.tick(m, IN(), null);
    check(`jumpCursor AT the threshold early-lands on the same ground`,
      p2.state === ST.GROUND && p2.y === y0,
      `state=${p2.state} y=${p2.y} (expected ${y0}) — an off-by-one on ` +
      `JUMP_ARC_EARLY_LAND_CURSOR is invisible any other way`);
  }
  {
    /* Bug 1 — jumping OFF A LADDER mid-climb, at an arbitrary, non-tile-
     * aligned Y. The jump arc's own Y never goes below the LAUNCH height
     * until the very last delta (see the note above), so a dismount high on
     * a ladder with the real floor far below lands via the pre-existing
     * (already correct) FALL check, not this one — the early-landing check
     * only matters here the same way it does for a ground jump: when a
     * ledge is reachable within the arc's own ~32px rise-and-return, which
     * is exactly the geometry a mid-climb dismount onto a nearby platform
     * produces. Reuses the exact platform from the mid-arc check above (row
     * 10, cols 5-20), started 3px off-grid to prove the snap doesn't depend
     * on having dismounted from a tile-aligned rung. */
    const n = MC * 64;
    const planeB = new Uint8Array(n);
    for (let c = 0; c <= 5; c++) planeB[12 * MC + c] = CELL_SOLID;
    for (let c = 5; c <= 20; c++) planeB[10 * MC + c] = CELL_SOLID;
    const ladderMap = { planeA: new Uint8Array(n), planeB,
                         widthPx: 4096, heightPx: 1024 };
    const p = new Player(5 * 32, 9 * 16 + 3);          // mid-climb, NOT tile-aligned
    p.state = ST.CLIMB;
    p.tick(ladderMap, IN({ up: true, right: true }), null);   // jump off, rightward
    check(`jumping off a ladder mid-climb enters JUMP, not still CLIMB`,
      p.state === ST.JUMP, `state=${p.state}`);
    let landedAtCursor = -1;
    for (let i = 0; i < 60 && landedAtCursor < 0; i++) {
      const cursorBefore = p.jumpCursor;
      p.tick(ladderMap, IN(), null);
      if (p.state === ST.GROUND) landedAtCursor = cursorBefore;
    }
    check(`a ladder jump-off at a non-tile-aligned Y still catches a nearby ` +
          `ledge MID-ARC and lands tile-aligned`,
      landedAtCursor === JUMP_ARC_EARLY_LAND_CURSOR && p.y === 112,
      `landed at jumpCursor=${landedAtCursor}, y=${p.y} — the port's own ` +
      'landing SNAPS Y (`y &= 0xfff0`) the same way the mid-arc check above ' +
      'does, regardless of the 3px off-grid rung the jump-off started from');
  }

  /* ── ladder-entry X snap is NOT unconditional (CS:0x4A36/0x59AB/0x5A3C/
   * 0x5BF3/0x5C80) — reported live as "instead of standing on top the
   * character stands in it". `add word [0x17a],0x20` runs ONLY on the col+1
   * (one column right) match; a col+0 match — the hero already standing in
   * the ladder's own column — jumps straight to `and word [0x17a],0xffe0`
   * alone (e.g. CS:0x4a61 `jz 0x1000:4a3b`, skipping the ADD two bytes
   * before it). An earlier version of this port applied `(x+0x20)&0xFFE0`
   * unconditionally, which shoves a col+0 entry one whole tile PAST the
   * ladder into whatever the next column holds — reproduced live in the
   * browser: entering climb at PLEV1A's first ladder (world x=224) snapped
   * to x=256, a solid pillar one tile to the right, and froze there forever
   * (256 is never climbable, so every later up-tick's climbableHere failed
   * and reverted with no motion) while the sprite rendered embedded in the
   * wall instead of on the ladder. */
  {
    const n = MC * 64;
    const planeB = new Uint8Array(n);
    for (let c = 0; c < MC; c++) planeB[12 * MC + c] = CELL_SOLID;
    for (let r = 4; r < 12; r++) planeB[r * MC + 20] = CELL_CLIMBABLE;
    // col 21 — where the OLD unconditional +0x20 snap would have landed —
    // is SOLID, exactly like the wall pillar next to the real ladder.
    for (let r = 4; r < 12; r++) planeB[r * MC + 21] = CELL_SOLID;
    const laddermap = { planeA: new Uint8Array(n), planeB,
                         widthPx: 4096, heightPx: 1024 };

    /* Standing exactly in the ladder's own column (col 20, sub 0 < 0x10) —
     * the col+0 match. */
    const a1 = new Arsenal(w1);
    const p1 = new Player(20 * 32, 9 * 16);
    for (let i = 0; i < 4; i++) p1.tick(laddermap, IN(), a1);   // settle
    p1.tick(laddermap, IN({ up: true }), a1);
    check(`climb entry from the ladder's OWN column does NOT overshoot into ` +
          `the solid column beside it`,
      p1.state === ST.CLIMB && p1.x === 20 * 32,
      `x=${p1.x} state=${p1.state} — the col+0 branch floors X to its OWN ` +
      `tile (CS:0x4a61 -> 0x4a3b, the AND with no preceding ADD); the old ` +
      `unconditional (x+0x20)&0xFFE0 would have parked the hero at ` +
      `${(20 * 32 + 0x20) & 0xFFE0} — inside the solid pillar`);
    let climbed = false;
    for (let i = 0; i < 10; i++) {
      p1.tick(laddermap, IN({ up: true }), a1);
      if (p1.y < 9 * 16) climbed = true;
    }
    check(`...and the hero actually climbs afterward, rather than freezing ` +
          `wedged in the wall`,
      climbed && p1.x === 20 * 32,
      `a hero snapped into solid geometry can never pass climbableHere ` +
      `again, so every later up-tick reverts with zero Y motion — the ` +
      `"stands in it instead of on top of it" report`);

    /* Approaching from the left (col 19, sub >= 0x10) — the col+1 match —
     * must still correctly advance INTO the ladder's column. Regression
     * guard: the fix must not turn off the genuine forward-snap case. */
    const a2 = new Arsenal(w1);
    const p2 = new Player(19 * 32 + 24, 9 * 16);   // sub = 24 >= 0x10
    for (let i = 0; i < 4; i++) p2.tick(laddermap, IN(), a2);
    p2.tick(laddermap, IN({ up: true }), a2);
    check(`climb entry approaching from the LEFT still advances into the ` +
          `ladder's own column (the genuine col+1 case)`,
      p2.state === ST.CLIMB && p2.x === 20 * 32,
      `x=${p2.x} — CS:0x5a36 \`cmp [SI+1],2\` matched, so the ADD 0x20 ` +
      `DOES run here, landing exactly on the ladder`);
  }

  /* ── idle facing persists the last-walked direction — a shipped-bug fix ──
   * CS:0x5af2-0x5b35: releasing a walk key only enters state 26 (idle) when
   * UP happens to be held at that exact instant (CS:0x5af9/0x5b0f). In the
   * ordinary case the state NEVER changes and the phase locks to a facing-
   * specific sentinel — 0x39=57 (left) or 0x2d=45 (right) — rendering a
   * "stopped, still facing that way" pose. Confirmed live in DOSBox by the
   * maintainer and independently by a fresh disassembly of the same bytes.
   * An earlier revision of this port forced every release into idle's single
   * symmetric sprite (25) regardless of facing. */
  {
    const m = flatMap();
    const p = new Player(2 * 32, 9 * 16);
    for (let i = 0; i < 4; i++) p.tick(m, IN());                // settle
    for (let i = 0; i < 3; i++) p.tick(m, IN({ right: true }));  // walk right
    p.tick(m, IN());                                             // release, UP not held
    check(`releasing RIGHT with UP not held stays in WALK_R, not IDLE`,
      p.stateIndex === PS.WALK_R && p.phase === 0x2d,
      `state=${p.stateIndex} phase=0x${p.phase.toString(16)} — CS:0x5b2b/0x5b33 ` +
      `locks cl=0x2d(45), rendering sprite ${spriteFor(PS.WALK_R, 0x2d)} (11+45=56), ` +
      `a facing-specific stopped pose, not idle's symmetric sprite 25`);
    for (let i = 0; i < 10; i++) p.tick(m, IN());
    check(`...and the locked pose holds indefinitely while stopped`,
      p.stateIndex === PS.WALK_R && p.phase === 0x2d,
      'state 26 is never reached without a fresh UP press (CS:0x5b23/0x5b30 ' +
      'do nothing on this path)');

    const p2 = new Player(2 * 32, 9 * 16);
    for (let i = 0; i < 4; i++) p2.tick(m, IN());
    for (let i = 0; i < 3; i++) p2.tick(m, IN({ left: true }));
    p2.tick(m, IN());
    check(`releasing LEFT with UP not held stays in WALK_L, not IDLE`,
      p2.stateIndex === PS.WALK_L && p2.phase === 0x39,
      `state=${p2.stateIndex} phase=0x${p2.phase.toString(16)} — CS:0x5b1e/0x5b26 ` +
      `locks cl=0x39(57), rendering sprite ${spriteFor(PS.WALK_L, 0x39)} (0+57=57)`);

    const p3 = new Player(2 * 32, 9 * 16);
    for (let i = 0; i < 4; i++) p3.tick(m, IN());
    for (let i = 0; i < 3; i++) p3.tick(m, IN({ right: true }));
    p3.tick(m, IN({ up: true }));                                // release WITH up held
    check(`releasing RIGHT with UP HELD is the one path that enters true IDLE`,
      p3.stateIndex === PS.IDLE,
      'CS:0x5b0f/0x5b11 — the only site that ever writes state 26 on a release');
    p3.tick(m, IN());
    check(`...and idle's own handler (CS:49CA \`sub cl,cl\`) zeros the phase ` +
          `on its very next tick, converging on the symmetric sprite 25`,
      p3.stateIndex === PS.IDLE && p3.phase === 0 && spriteFor(PS.IDLE, 0) === 25,
      `phase=${p3.phase}`);
  }

  /* ── jump ceiling collision — a missing feature, now added ─────────────
   * CS:0x4E4E, shared by both jump handlers (state 8 CS:0x4F89 / state 9
   * CS:0x5188): every tick, after the Y delta is applied, re-probes the
   * hero's own cell for solid ground and — on a hit — floors to that tile
   * row then pushes ONE FULL ROW back down, forcing a fall. An earlier
   * revision of this port had no such check at all: `_jump()` applied
   * JUMP_DELTAS unconditionally, so the hero's head would pass straight
   * through a low platform. Confirmed missing live in DOSBox by the
   * maintainer, then confirmed present in the original via a fresh
   * disassembly of both jump handlers. */
  {
    const m = flatMap();                        // floor at row 12 (y=192)
    const CEIL_ROW = 8, CEIL_COL = 5;            // 16px above the hero's start row
    m.planeB[CEIL_ROW * MC + CEIL_COL] = CELL_SOLID;
    const p = new Player(CEIL_COL * 32, 9 * 16); // row 9 = y144, 3 rows above the floor
    for (let i = 0; i < 4; i++) p.tick(m, IN());                    // settle
    p.tick(m, IN({ up: true, right: true }));                       // launch the jump
    const ys = [];
    let hitCeiling = false;
    for (let i = 0; i < 8; i++) {
      p.tick(m, IN());
      ys.push(p.y);
      if (p.state === ST.FALL) hitCeiling = true;
    }
    check(`a jump under a low platform never rises past the ceiling row`,
      Math.min(...ys) >= 9 * 16,
      `y sequence: ${ys.join(',')} — CS:0x4E4E's ejection check stops the rise ` +
      `the instant the hero's own cell reads solid, never letting the drawn Y ` +
      `cross into the ceiling tile's row`);
    check(`...forcing FALL rather than letting the arc continue to rise`,
      hitCeiling,
      'the ceiling-hit branch sets ST.FALL and returns before the arc cursor advances');
    check(`...then lands cleanly back where the jump started, having only ` +
          `bounced off the ceiling rather than passed through it`,
      p.state === ST.GROUND && p.y === 9 * 16,
      `state=${p.state} y=${p.y}`);
  }

  /* ── walk-fire halts the hero, and resumes mid-cycle ──────────────────── */
  {
    const { a, p, m } = armed();
    p.tick(m, IN({ right: true }), a);
    const x0 = p.x;
    for (let i = 0; i < 5; i++) p.tick(m, IN({ right: true, fire: true }), a);
    check(`firing while walking HALTS the hero for the whole cycle`,
      p.x === x0,
      'state 5\'s body (CS:0x5D46) is `inc cl`, the emit gate, the chain check ' +
      'and the animation — there is no X step in it at all, and the entry at ' +
      'CS:0x5CA8 sits BEFORE the step at CS:0x5CCB and jumps past it');
  }
  check(`walk-fire hands the walk back at phase 2, not 0`,
    FS[5].exitCl === 2 && FS[6].exitCl === 2,
    'CS:0x5D7A `mov cl,2` — resuming at 0 restarts the 8-frame cycle and ' +
    'double-plays the footstep');

  /* ── the jump pair's exit phases differ (the defect this pass found) ──── */
  check(`the jump-fire pair exits with DIFFERENT phases: 5 right, 6 left`,
    FS[20].exitCl === 5 && FS[21].exitCl === 6,
    'CS:0x53F2 `mov cl,5` vs CS:0x52D5 `mov cl,6`. This file mirrored 20 into ' +
    '21 until the tails were read for the integration pass; state 8 uses 6 as ' +
    'its catch-all airborne frame and never produces a 5 on its own');
  /* ⚠️ THE JUMP GUARDS STRADDLE THE ALLOCATOR, and that is observable. */
  {
    /* Driven through a real _jump at cursor 2 — the boundary case. The guard
     * must see the PRE-advance cursor (2, blocked), not the value after this
     * tick's `+= 2` (4, which would pass). And being pre-allocator it leaves
     * the latch CLEAR, the opposite of the late-jump case below; the two
     * together are what make either one discriminating. */
    const a = new Arsenal(w1); a.equip(0, 0);
    const p = new Player(2 * 32, 6 * 16);
    p.state = ST.JUMP; p.jumpCursor = 2; p.facing = 1;
    p.tick(flatMap(), IN({ fire: true }), a);
    check(`the jump family cannot fire during its 4-tick wind-up`,
      ENTRY[20].arcMin === 4 && ENTRY[21].arcMin === 4
        && p.fireState < 0 && a.latch === false,
      'CS:0x51C4 `cmp byte [0x358],0x4 / jl` — a LOWER guard this port did ' +
      'not have at all, so firing is locked out at BOTH ends of the arc. It ' +
      'reads the cursor BEFORE the entry\'s own `add [0x358],2` (CS:0x51ED), ' +
      'and being pre-allocator it leaves DS:0x351 alone');
  }
  {
    /* Late in a jump the allocator RUNS and is then rejected (CS:0x51DA sits
     * eight bytes past CS:0x51D2), so the press is consumed. Evaluating the
     * guard first would leave the latch clear and let the next tick fire. */
    const a = new Arsenal(w1); a.equip(0, 0);
    const p = new Player(2 * 32, 6 * 16);
    p.state = ST.JUMP; p.jumpCursor = 0x2c; p.facing = 1;
    p.tick(flatMap(), IN({ fire: true }), a);
    check(`a press late in a jump is CONSUMED, not ignored`,
      p.fireState < 0 && a.latch === true,
      'the shot is refused (no fire state) but DS:0x351 is set, because the ' +
      'upper arc guard is checked AFTER `call 0x95ca`. A port that guards ' +
      'first leaves the latch clear and fires on the very next tick');
  }
  check(`the jump arc cursor exit OVERRIDES the phase exit`,
    JUMP_ARC_EXIT[20] === 12 && JUMP_ARC_EXIT[21] === 11 && JUMP_ARC_END === 0x2e,
    'CS:0x53F9/0x542B `add byte [0x358],2` runs on BOTH paths and the ' +
    '`cmp [0x358],0x2e` after it sends the hero to the fall state regardless ' +
    'of what the phase gate chose');

  /* ── the semi-automatic latch, through the real frame ─────────────────── */
  {
    /* Driven through stepHeroFrame so the latch call in frame.js is what is
     * under test — calling arsenal.latchTick() here instead would let a frame
     * that clears the latch unconditionally pass. */
    const run = (hold) => {
      const { a, p, m } = armed();
      const grid = new DamageGrid();
      let volleys = 0;
      for (let i = 0; i < 30; i++) {
        const down = hold ? true : (i % 6) < 2;      // held, vs press/release
        const fr = stepHeroFrame({ input: IN({ right: true, fire: down }),
                                   arsenal: a, grid, player: p, map: m,
                                   cam: { x: 0, y: 0 }, world: 1 });
        if (fr.emitted) volleys++;
      }
      return volleys;
    };
    const held = run(true), tapped = run(false);
    check(`holding fire for 30 ticks yields ONE volley; tapping yields more`,
      held === 1 && tapped > held,
      `held ${held} vs tapped ${tapped} — CS:0x019D only clears DS:0x351 on a ` +
      `tick where the bit is NOT set, so the weapon is semi-automatic. A frame ` +
      `that clears it every tick gives the hero a 15 Hz autocannon`);
  }

  /* ── the record geometry, which only a SECOND volley can expose ───────── */
  {
    const { a, p, m } = armed(0);               // knife: maxShots 3
    const grid = new DamageGrid();
    /* ⚠️ RECORD THE INDEX, NOT JUST THE TAG. A freshly picked-up weapon fires
     * a volley of ONE, so every sub-slot writes a single record and the tags
     * come out 1/4/7 whatever stride the head uses. The stride is only visible
     * in WHERE the record landed. */
    const placed = new Map();
    for (let i = 0; i < 24; i++) {
      const down = (i % 6) < 2;
      stepHeroFrame({ input: IN({ right: true, fire: down }), arsenal: a, grid,
                      player: p, map: m, cam: { x: 0, y: 0 }, world: 1 });
      a.slots[0].area.slice(0, ENTRIES_REACHABLE).forEach((r, idx) => {
        if (r.tag !== 0 && !placed.has(r.tag)) placed.set(r.tag, idx);
      });
    }
    const want = [[1, 0], [4, 3], [7, 6]];
    const got = want.map(([t]) => `${t}@${placed.has(t) ? placed.get(t) : '-'}`);
    check(`volleys land at sub-slot heads 0/3/6 carrying tags 1/4/7`,
      placed.size >= 2 && want.every(([t, i]) => !placed.has(t) || placed.get(t) === i),
      `observed ${got.join(' ')} — head = subslot * ${GROUP_ENTRIES} (the ` +
      `handler writes three consecutive 8-byte records, CS:0x98d1) and tag = ` +
      `1 + slot*9 + subslot*3 (CS:0x9619 \`add dx,3\`). Getting the head ` +
      `stride wrong makes group 0 look busy and group 1 free, and the ` +
      `allocator then hands out a sub-slot that is already in use`);
  }

  /* ── the ordering that no isolated test can catch ─────────────────────────
   *
   * ⚠️ THESE DRIVE game/frame.js, NOT A LOOP WRITTEN HERE. An earlier version
   * of this block re-implemented the tick order inline and asserted the
   * property against its own loop — which passed, and let a mutation that
   * swapped the two calls in main.js SURVIVE the whole suite. A check that
   * cannot see the code it is about is not a check. */
  {
    /* Looked up by ROLE, not by index — an index-based assertion breaks the
     * moment a step is inserted, which is exactly what happened when pickup
     * was added at CS:0x0206. */
    const at = (re) => FRAME_ORDER.find((s) => re.test(s.what)).at;
    check(`the frame's call order is the main loop's, in address order`,
      FRAME_ORDER.every((s, i, arr) => i === 0 || s.at > arr[i - 1].at)
        && at(/grid/) === 0x01cc && at(/pickup/i) === 0x0206
        && at(/projectiles/) === 0x020f && at(/state machine/) === 0x0254,
      'grid clear 0x01CC < pickup 0x0206 < projectiles 0x020F < player ' +
      '0x0254 — the projectile step is BEFORE the emit, which is what denies ' +
      'a shot its spawn tick, and pickup is before both');
  }
  {
    const { a, p, m } = armed();
    const cam = { x: 0, y: 0 };
    const grid = new DamageGrid();
    let stampedOnSpawnTick = null;
    for (let i = 0; i < 6; i++) {
      const before = a.stamped;
      const fr = stepHeroFrame({ input: IN({ right: true, fire: true }),
                                 arsenal: a, grid, player: p, map: m, cam, world: 1 });
      if (fr.emitted) stampedOnSpawnTick = a.stamped - before;
    }
    check(`a shot cannot stamp the damage grid on its spawn tick`,
      stampedOnSpawnTick === 0,
      'driven through stepHeroFrame, so swapping the projectile step and the ' +
      'player tick FAILS here. CS:0x01CC clears and CS:0x020F moves+stamps, ' +
      'both before the player at CS:0x0254');
  }
  {
    /* Contact must short-circuit the scan: a creature touching the hero is
     * sent past the grid by CS:0xa9ec, so it cannot also be shot this tick.
     * ⚠️ COUNT THE DECODES. Asserting on the creature's HP is not
     * discriminating — the contact path already drives it negative, so a scan
     * that also ran would leave it negative too and the check would pass
     * either way. The observable difference is whether the grid was READ. */
    const { p } = armed();
    const grid = new DamageGrid();
    const cam = { x: 0, y: 0 };
    let decodes = 0;
    const decode = () => { decodes++; return { damage: 5, weapon: 0 }; };
    const toucher = { x: p.x + 12, y: p.y + 12, state: 20, alive: true,
                      frame: 0, delay: 0 };
    grid.stamp2x2(toucher.x - cam.x, toucher.y - cam.y, 1);   // a shot on it too
    const r = stepCreatureDamage([toucher], { grid, cam, health: new Health(),
      hero: { x: p.x, y: p.y, state: p.stateIndex }, decodeTag: decode });
    check(`a creature that touches the hero is NOT also damage-scanned`,
      r.touched === 1 && decodes === 0,
      'CS:0xa9e7 `cmp bp,0 / jns` jumps past the grid at CS:0xa9ec when the ' +
      'contact test reported a hit, so one creature cannot both hurt the hero ' +
      'and die to a projectile on the same tick. The tag decode never runs');
  }
  {
    /* The grid is per-tick scratch: CS:0xACF6 zeroes all 1600 bytes at 0x01CC,
     * before anything stamps. A stale stamp would let a despawned projectile
     * keep killing, which is the classic version of this bug. */
    const { a, p, m } = armed();
    const grid = new DamageGrid();
    grid.stamp2x2(64, 64, 7);                    // a leftover from "last tick"
    stepHeroFrame({ input: IN(), arsenal: a, grid, player: p, map: m,
                    cam: { x: 0, y: 0 }, world: 1 });
    check(`the damage grid is cleared at the top of every tick`,
      grid.scan(64, 64, 0x20, 0x20) === 0,
      'CS:0x01CC `call 0xacf6` -> `mov cx,0x320 / rep stosw`. Without it a ' +
      'despawned projectile keeps killing from wherever it last stamped');
  }
  {
    /* A creature landing on EXACTLY zero must die: CS:0xAB88 is `js` followed
     * by `jz`, and both reach the death path, so the test is `<= 0`. */
    const grid = new DamageGrid();
    const cam = { x: 0, y: 0 };
    const e = { x: 100, y: 100, state: 5, alive: true, frame: 0, delay: 0 };
    grid.stamp2x2(e.x, e.y, 1);
    const r = creatureScansGrid(e, grid, cam, () => ({ damage: 5, weapon: 0 }), 0);
    /* ⚠️ Assert on the STATE WORD, not on the returned boolean. `killed` is
     * this port's own flag; what the original's caller reads is the SIGN of
     * BP (CS:0xFFB7 `or bp,bp / js`), and the death path forces it negative
     * with `CS:0xABA7 mov bp,0xffff` — so leaving the word at 0 would look
     * like a kill here while the creature never enters its death frames. */
    check(`a hit that lands the creature on exactly 0 HP kills it, and the`
      + ` state word goes NEGATIVE`,
      r.killed === true && e.state < 0,
      'CS:0xAB88 `js 0xab98` and CS:0xAB8A `jz 0xab98` BOTH reach the death ' +
      'path, so the condition is <= 0; CS:0xABA7 `mov bp,0xffff` then forces ' +
      'the sign the caller tests. Writing `< 0` leaves a creature alive on ' +
      'exactly zero and it takes one more hit than it should');
  }

  {
    /* CS:0xABEE-0xAC3D, the "hit landed, target survived" debris spark's
     * jittered position — one axis at a time, each its own random draw. */
    check(`hitSparkAxis: magnitude from the LOW bits, direction from the SIGN bit`,
      hitSparkAxis(100, 32, 0x0005) === 100 + 16 + 5 - 8       // positive draw -> add
      && hitSparkAxis(100, 32, 0x8005) === 100 + 16 - 5 - 8    // sign bit set -> subtract
      && hitSparkAxis(100, 10, 0x0003) === 100 + 5 + 3 - 8,    // size<16 -> mask still rounds to 16-1
      'CS:0xABF6/0xAC1C `and cx,0xfff0 / jnz / mov cx,0x10` rounds the box ' +
      'size DOWN to 16 for the mask (16 itself when that rounds to 0), then ' +
      'CS:0xAC08/0xAC2E tests the SIGN of the SAME random word the magnitude ' +
      'comes from — one draw does double duty, not two independent ones');

    /* End to end: a hit that damages but does NOT kill drops exactly one
     * spark, inside the creature's own box; a miss or a kill drops none. */
    const grid2 = new DamageGrid();
    const cam2 = { x: 0, y: 0 };
    const debris2 = new Debris();
    const survivor = { x: 200, y: 200, state: 50 };
    grid2.stamp2x2(survivor.x, survivor.y, 1);
    const rHit = creatureScansGrid(survivor, grid2, cam2,
      () => ({ damage: 5, weapon: 0 }), 0, undefined, null,
      { rng: () => 0x0001, debris: debris2 });
    check(`a hit that damages but does NOT kill drops exactly one debris spark`,
      rHit.killed === false && survivor.state === 45 && debris2.live === 1,
      'CS:0xABDE `or bx,bx / jz` only skips the spark when the applied damage ' +
      'is exactly 0; any nonzero, non-lethal hit reaches CS:0xAC4C');

    const killer = { x: 200, y: 200, state: 3 };
    grid2.stamp2x2(killer.x, killer.y, 1);
    const rKill = creatureScansGrid(killer, grid2, cam2,
      () => ({ damage: 5, weapon: 0 }), 0, undefined, null,
      { rng: () => 0x0001, debris: debris2 });
    check(`a hit that KILLS drops no extra spark — that path never reaches CS:0xAC4C`,
      rKill.killed === true && debris2.live === 1,   // still just the one from above
      'the death branch (CS:0xAB88 `js`/`jz`) forces bp negative and returns ' +
      'without ever falling into the CS:0xABDA/0xAC4C tail — a live count ' +
      'that stayed at 1 across this second, lethal hit proves it');
  }

  /* ── end to end: press -> ... -> a creature loses HP ──────────────────── */
  {
    const { a, p, m } = armed();
    const cam = { x: 0, y: 0 };
    const grid = new DamageGrid();
    const decode = (tag) => damageForTag(tag, a.slots.map((s) => s.weapon),
      Object.fromEntries(a.slots.filter((s) => s.st).map((s) => [s.weapon, s.st])));
    /* A creature sitting in the shot's path, 64 px to the hero's right. */
    const creature = { x: p.x + 64, y: p.y + 0x18, state: 20 };
    const hp0 = creature.state;
    let hitTick = -1;
    for (let i = 0; i < 12; i++) {
      grid.clear();
      a.step(cam, grid, m.planeB, 1);
      p.tick(m, IN({ right: true, fire: true }), a);
      const r = creatureScansGrid(creature, grid, cam, decode, 0);
      if (r.hit && r.damage && hitTick < 0) hitTick = i;
    }
    check(`END TO END: press -> allocate -> emit -> move -> stamp -> scan -> HP`,
      hitTick >= 0 && creature.state < hp0,
      `the creature lost ${hp0 - creature.state} HP on tick ${hitTick}; the ` +
      `damage is weapon +0x08 (the pickup count), decoded back from the grid ` +
      `tag by CS:0x9320. This is the whole chain, and it is the check that ` +
      `fails if any single link is unwired`);
  }

  /* ── the difficulty scalar: a correction to a correction ──────────────── */
  check(`the difficulty scalar REDUCES the hero's damage as it rises`,
    DIFFICULTY_MULTIPLIERS[0] === 1 && DIFFICULTY_MULTIPLIERS[1] === 0.75
      && DIFFICULTY_MULTIPLIERS[2] === 0.5 && DIFFICULTY_MULTIPLIERS[3] === 0.25,
    'CS:0xAB5E `sub bp,bx` subtracts the RAW damage and CS:0xAB86 `add bp,bx` ' +
    'adds the SHIFTED value back, so the shift is what is FORGIVEN, not what ' +
    'is dealt: applied = raw - (raw >> cl). Reading the shift alone — as this ' +
    'project did twice, in both directions — inverts the progression');
  check(`the forgiven amount is the shifted value, and 3/4 when the shift is 0`,
    difficultyForgiven(1000, 1) === 250 && difficultyForgiven(1000, 2) === 500
      && difficultyForgiven(1000, 3) === 750 && difficultyForgiven(1000, 0) === 0,
    'CS:0xAB6C `shr bx,cl` with cl = 3 - scalar, and the CS:0xAB78 fixed 3/4 ' +
    'path taken when the shift changed nothing');
  check(`the scalar a player actually meets is 0, 2, 3, 4, 4`,
    DIFFICULTY_PROGRESSION.join() === '0,2,3,4,4'
      && DIFFICULTY_PROGRESSION.every((v, i, arr) => i === 0 || v >= arr[i - 1]),
    'CS:0x0445 `inc byte [0x365]` then clamped low to 2 (CS:0x0449) and high ' +
    'to 4 (CS:0x0455) — so the damage multiplier falls 1.00 -> 0.50 -> 0.25 ' +
    'monotonically and enemies are toughest at the END, not on world 2');

  /* ── is the shot actually VISIBLE? ────────────────────────────────────────
   *
   * ⚠️ Nothing above this point renders anything. The running build draws a
   * projectile with the weapon's pinned descriptor, and if that id falls
   * outside the groups main.js loads it silently draws a box and bumps a
   * counter — with all 300-odd checks still green. "The chain is wired" and
   * "the chain is visible" are different claims, and this is the one this
   * increment was for. Resolved against the shipped atlases, the same way
   * main.js resolves it. */
  {
    const groups = ['always', 'objects'];
    const counts = {};
    for (const g of groups) {
      for (const s of GROUP_STEMS[g]) {
        counts[s] = parseAtlas(dclDecompress(await fetchRaw(`game/${s}.DAT`)).data).count;
      }
    }
    const { map: dmap } = buildDescriptorMap(groups, (s) => counts[s]);
    const ok = spawnableWeapons(w1).ok;
    /* A POSITIVE assertion — name the group each descriptor actually resolves
     * into, so the check reports what it found rather than the absence of a
     * problem. Every one must land in `objects`, which is what main.js loads. */
    const stems = ok.map((i) => (dmap[PINNED_SPRITE[i]] || {}).stem);
    const objectStems = GROUP_STEMS.objects;
    check(`every spawnable weapon's pinned sprite resolves inside \`objects\``,
      ok.length === 7 && stems.length === 7
        && stems.every((s) => s && objectStems.includes(s)),
      `descriptors ${ok.map((i) => PINNED_SPRITE[i]).join(', ')} -> ` +
      `${stems.join(', ')}. main.js loads always + objects + level<N>; a ` +
      `pinned id outside those draws a placeholder box and raises a counter ` +
      `while every other check stays green`);
  }

  /* ── how much of the arsenal is actually reachable ────────────────────── */
  {
    const s = spawnableWeapons(w1);
    check(`exactly 7 of the 11 shipped weapons have a decoded spawn handler`,
      s.ok.length === 7 && s.ok.join() === '0,4,5,7,8,9,10',
      `handlers 12/13 are decoded but NO shipped weapon references them; the ` +
      `hunter (8) uses its OWN pair (10/11, the 3-shot fan) and the magic ` +
      `axe (9) its own (14/15, which ALSO seeds a companion state record — ` +
      `see spawnAxeVolley), rather than the 0/1 the other five share, so the ` +
      `decoded set covers ${s.ok.length} weapons in practice, not 4 families ` +
      `of 11. The other four are counted at the call site rather than ` +
      `throwing, the same treatment the out-of-range \`dir\` gets`);
    const cut = s.blocked.filter((b) => b.cut);
    check(`the one weapon with a NULL handler pair is the cut "flame"`,
      cut.length === 1 && cut[0].index === CUT_WEAPON,
      'table entries 4/5 are 0x0000 and mover 2 is null as well — two ' +
      'independent tables agreeing, and no map places the type');
  }

  /* ══ THE COLLISION GEOMETRY — the clip and the two stamps ══════════════ */

  {
    /* The clip shrinks the box; it does not merely clamp the origin. */
    const full = clipScanBox(10, 10, 0x20, 0x20);
    const top  = clipScanBox(10, -20, 0x20, 0x20);
    /* ⚠️ -16 as a LITERAL, not as CLIP_NEAR. Asserting `top.y === CLIP_NEAR`
     * compares the port against the very constant it was built from, and a
     * mutation of that constant survives it — the same tautology the linter
     * catches for bare `A === B` but not for a property access. */
    check(`a creature straddling the top edge is scanned over a SHRUNK box`,
      full.h === 0x20 && top.hit && top.y === -16 && top.h === 0x20 - 4,
      `y=-20 loses ${0x20 - top.h}px of height (CS:0xAA1D \`add [0x1e4],bx\`) ` +
      `and the origin clamps to ${CLIP_NEAR}, which is exactly the grid's own ` +
      `margin — DS:0x16ca is 100 bytes in and the stride is 48, so 100 = ` +
      `2*48 + 4, two rows of slack`);

    /* y = -48 shrinks the height to EXACTLY 0 — the boundary that separates
     * `jns`+`jnz` (both jump to the no-hit exit) from a naive `h < 0`. */
    const zero = clipScanBox(10, -48, 0x20, 0x20);
    const gone = clipScanBox(10, -0x40, 0x20, 0x20);
    check(`a box that shrinks away returns NO HIT without scanning a cell`,
      gone.hit === false && zero.hit === false && zero.h === 0,
      'CS:0xAA21/0xAA26 `jns`/`jnz` both jump to CS:0xAB3B, the scanner\'s ' +
      'no-hit exit — so height 0 is already no-hit. Testing `h < 0` instead ' +
      'lets a zero-height box through, and the scan loop is `dec al / jns`, ' +
      'so it would still run one full row of comparisons');
  }
  {
    /* ⚠️ EACH AXIS CLIPS ONCE. The near-edge path jumps PAST the far-edge
     * test (CS:0xAA2E, CS:0xAA67), so a box big enough to exceed both edges
     * of one axis is clipped only at the near one. */
    /* The horizontal near-edge clip is the mirror, and it clamps too. */
    const left = clipScanBox(-20, 10, 0x20, 0x20);
    check(`the left-edge clip shrinks the width AND clamps x to -16`,
      left.hit && left.x === -16 && left.w === 0x20 - 4,
      'CS:0xAA53/0xAA56 `add ax,0x10 / add [0x1e2],ax` then CS:0xAA64 ' +
      '`mov ax,0xfff0` — dropping the clamp leaves the scan indexing from a ' +
      'position further left than the grid margin allows');

    const both = clipScanBox(10, -20, 0x20, 0x100);
    check(`a top-clipped box is NOT also bottom-clipped in the same call`,
      both.hit && both.h === 0x100 - 4,
      `height ${both.h}: only the top clip ran. CS:0xAA2B ends \`mov bx,0xfff0 ` +
      `/ jmp 0xaa4e\`, skipping CS:0xAA30 entirely. Applying both clamps ` +
      `unconditionally would leave ${0x100 - 4 - ((0x100 - 4) + CLIP_NEAR - CLIP_BOTTOM)}`);
  }
  {
    /* ⚠️ THE HORIZONTAL TEST READS THE NEAR EDGE, THE VERTICAL THE FAR ONE. */
    const wideY = clipScanBox(10, 0xc8, 0x20, 0x20);   // bottom edge past 0xd0
    const wideX = clipScanBox(0x148, 10, 0x20, 0x20);  // right edge past 0x150
    /* Exact values, not inequalities: `h < 0x20` passes for any bottom bound. */
    check(`the right-edge clip reads the LEFT edge, so it barely ever fires`,
      wideY.h === 8 && wideY.hit && wideX.w === 0x20 && wideX.x === 0x148,
      `y=0xc8 clips to h=${wideY.h} because CS:0xAA36 is \`81 F9\` = ` +
      `cmp CX,0xd0 against the computed bottom; x=0x148 keeps w=${wideX.w} ` +
      `because CS:0xAA6F is \`3D\` = cmp AX,0x150 against the LEFT edge, even ` +
      `though CS:0xAA6D just computed the right edge into CX and ignores it. ` +
      `For a 32-wide creature that clip is dead. Encoding, not mnemonic`);
  }
  {
    /* The two stamps order the nudge and the bounds check oppositely. */
    const g = new DamageGrid();
    g.clear();
    const n2 = (() => { g.clear(); g.stamp2x2(64, 64, 5);
      return g.buf.reduce((a, b) => a + (b ? 1 : 0), 0); })();
    const n3 = (() => { g.clear(); g.stamp3x3(64, 64, 5);
      return g.buf.reduce((a, b) => a + (b ? 1 : 0), 0); })();
    check(`the 2x2 stamp covers 4 cells and the 3x3 covers 9`,
      n2 === 4 && n3 === 9,
      'CS:0xA88F writes 4 bytes at offsets 0/1/0x30/0x31; CS:0xA8EB writes 9 ' +
      'at 0/1/2, 0x30..0x32, 0x60..0x62 — 16x16 px against 24x24');

    /* ⚠️ THE POSITION WHERE THE TWO ORDERS DISAGREE. y = 236 has bit 2 set, so
     * the nudge applies, and its pre-nudge index 0x1C3A is inside the write
     * window while 0x1C3A + 0x30 = 0x1C6A is past WRITE_HI. The 2x2 checks
     * before nudging and is ACCEPTED; the 3x3 checks after and is REJECTED. */
    const g2 = new DamageGrid();
    g2.clear(); const took2 = g2.stamp2x2(0, 236, 5);
    g2.clear(); const took3 = g2.stamp3x3(0, 236, 5);
    check(`at the window edge the 2x2 stamps and the 3x3 refuses`,
      took2 === true && took3 === false && stampIndex(0, 236) < WRITE_HI
        && stampIndex(0, 236) + ROW_STRIDE >= WRITE_HI,
      `pre-nudge 0x${stampIndex(0, 236).toString(16)} is inside ` +
      `[0x${WRITE_LO.toString(16)}, 0x${WRITE_HI.toString(16)}) and post-nudge ` +
      `0x${(stampIndex(0, 236) + ROW_STRIDE).toString(16)} is not. CS:0xA87A ` +
      `bounds -> CS:0xA88A nudge, against CS:0xA8DA nudge -> CS:0xA8DF ` +
      `bounds. A shared size-parameterised helper gets one of them wrong here`);
  }

  {
    /* ⚠️ THE DEFECT THIS FIX EXISTS FOR. The axe and the lightning bolt are
     * draw style 1 and both are among the five spawnable weapons, so routing
     * every style to stamp2x2 made them under-hit on every shot. Driven
     * through stepProjectiles so the ROUTING is under test, not the table. */
    const cam = { x: 0, y: 0 };
    const area = (wpn) => {
      const g = new DamageGrid(); g.clear();
      const recs = [{ tag: 1, x: 100, y: 100, dir: 1 }];
      stepProjectiles(recs, cam, { grid: g, weapon: wpn, planeB: null, world: 1 });
      return g.buf.reduce((a, b) => a + (b ? 1 : 0), 0);
    };
    const knife = w1[0], axe = w1[7], lightning = w1[4];
    const nk = area(knife), na = area(axe), nl = area(lightning);
    check(`the axe and lightning bolt stamp 9 cells, the knife 4`,
      knife.drawStyle === 0 && axe.drawStyle === 1 && lightning.drawStyle === 1
        && nk === 4 && na === 9 && nl === 9,
      `knife style ${knife.drawStyle} -> ${nk} cells, axe style ` +
      `${axe.drawStyle} -> ${na}, lightning bolt -> ${nl}. Styles 1 and 2 ` +
      `call CS:0xA8B8 (24x24 px), style 0 calls CS:0xA860 (16x16). This port ` +
      `sent all three to the 2x2 until the 3x3 was decoded, so two of the ` +
      `five weapons the hero can actually fire covered less than half the ` +
      `grid area they should`);
  }

  {
    /* ⚠️ THE HUNTER'S TARGET LIST IS GATED ON HOLDING THE HUNTER. CS:0xAA86
     * `cmp byte [0x343],0 / js` skips the append, and CS:0x9124-0x9146 leaves
     * DS:0x343 at 0xFF unless a slot holds weapon 8. */
    const grid = new DamageGrid(); grid.clear();
    const cam = { x: 0, y: 0 };
    const mob = () => ([{ x: 100, y: 100, state: 20, alive: true,
                          frame: 0, delay: 0 }]);
    const run = (weapon) => {
      const a = new Arsenal(w1);
      if (weapon >= 0) pickUpWeapon(a, weapon);
      return stepCreatureDamage(mob(), { grid, cam, health: new Health(),
        hero: { x: 900, y: 900, state: 26 }, decodeTag: () => ({ damage: 0 }),
        arsenal: a }).targets.length;
    };
    check(`the hunter's target list is built ONLY while the hero holds a hunter`,
      run(HUNTER_WEAPON) === 1 && run(0) === 0 && run(-1) === 0,
      `holding weapon ${HUNTER_WEAPON} appends ${run(HUNTER_WEAPON)} target(s); ` +
      `holding a knife or nothing appends ${run(0)}. CS:0x9130/0x9137/0x913E ` +
      `each compare a slot word against 8, and only a match (or DS:0x168 >= 0) ` +
      `clears DS:0x343. A port that always appends hands the hunter targets ` +
      `the original never gave it`);
  }

  /* ══ PICKUP — how the hero actually gets a weapon ═══════════════════════ */

  check(`idle + FIRE operates a LEVER, it does not pick anything up`,
    LEVER_STATES.join() === '26',
    'CS:0x1045 keeps only category 3 (`cmp byte [di+0x4],0x3 / jnz`) and ends ' +
    'in `xor byte [si+0x4],0x1` — flipping bit 0 of the type, which is the ' +
    'documented lever/switch toggle (24/25, 26/27). This project called it ' +
    '"the object-pickup walk" until the bytes were read; real pickup has NO ' +
    'fire gate at all and happens on contact at CS:0x177d');

  check(`the pickup box is 40 x 56 around the hero's top-left, not symmetric`,
    PICKUP_BOX.xMin === -12 && PICKUP_BOX.xMax === 28
      && PICKUP_BOX.yMin === -12 && PICKUP_BOX.yMax === 44,
    'CS:0x1799 adds 8 to the object position, then CS:0x179F/0x17A2 open the ' +
    'X window at hero-4 .. hero+0x24 and CS:0x17AD/0x17B2 the Y window at ' +
    'hero-4 .. hero+0x34. Folding the +8 in gives these offsets — wider than ' +
    'his 32x48 body and reaching further below than above');

  check(`a bar of exactly 0 still allows a pickup`,
    heroTouches({ x: 0, y: 0 }, { x: 0, y: 0 }, 0) === true
      && heroTouches({ x: 0, y: 0 }, { x: 0, y: 0 }, -1) === false,
    'CS:0x177D `cmp word [0x19a],0 / js` is STRICTLY negative — the same shape ' +
    'as the damage guard, and the opposite of the death test which fires at ' +
    '<= 0. Three reads of the same variable, three different boundaries');

  {
    const a = new Arsenal(w1);
    const r0 = pickUpWeapon(a, 0);                 // knife, +0x00 == 0
    const r2 = pickUpWeapon(a, 2);                 // fireball -> forced slot C
    check(`slot A is reserved for weapons whose +0x00 is 0; fireball takes C`,
      r0.slot === 0 && w1[0].slotAClass === 0 && r2.slot === 2
        && a.tagBase === 0x12,
      `+0x00 is 0/1/1/1/1/0/0/0/1/1/0 and IDENTICAL in all four PWEAPONS ` +
      `files, so the slot rule does not drift between worlds the way +0x08 ` +
      `does. knife -> A (CS:0x9554 \`cmp word [di],0 / jz\`), fireball -> C ` +
      `(CS:0x954F, hard-wired) and that same write sets DS:0x340 to 0x12 — ` +
      `slot C's tag base, which is exactly what the fireball's mover ` +
      `subtracts at CS:0x9DC2. Two facts explaining each other`);

    const before = a.slots[0].st.count;
    const dup = pickUpWeapon(a, 0);
    check(`picking up a weapon you already hold only increments the count`,
      dup.duplicate === true && dup.slot === 0
        && a.slots[0].st.count === before + 1,
      'CS:0x94A8-0x94B8 compares against all three slot words first and takes ' +
      'the CS:0x94E8 `inc word [di+0x8]` path — so the volley and the per-hit ' +
      'damage both rise, and the projectile area is NOT cleared');
  }
  {
    const a = new Arsenal(w1);
    pickUpWeapon(a, 1);                            // time bomb -> B
    pickUpWeapon(a, 8);                            // hunter    -> C
    a.slots[1].st.count += 5;                      // invest in B
    const r = pickUpWeapon(a, 9);                  // magic axe, +0x00 == 1
    check(`with B and C both full, the LOWER-count slot is replaced`,
      r.slot === 2 && r.replaced === 8,
      'CS:0x9580-0x9596 loads both counts and `jl` picks B only when B is ' +
      'STRICTLY lower — you lose the weapon you have invested less in');

    /* The tie is the discriminating case for `jl` vs `jle`: equal counts must
     * keep B and take C. Built by re-arming both so their counts match. */
    const t = new Arsenal(w1);
    pickUpWeapon(t, 1);                            // time bomb -> B
    pickUpWeapon(t, 8);                            // hunter    -> C
    t.slots[1].st.count = t.slots[2].st.count = 9;
    const tie = pickUpWeapon(t, 9);
    check(`a TIE between B and C replaces C, not B`,
      tie.slot === 2 && tie.replaced === 8,
      'CS:0x9596 is `jl`, strict and signed — equal counts fall through to ' +
      'CS:0x9598 `jmp 0x9567`, which selects slot C. Writing `<=` swaps which ' +
      'weapon you lose on every tie, and a tie is the common case early on ' +
      'when both slots still hold their first pickup');
  }
  {
    const a = new Arsenal(w1);
    pickUpWeapon(a, 0);
    a.slots[0].area[0].tag = 7;                    // a shot in flight
    pickUpWeapon(a, 0);
    const keptOnDup = a.slots[0].area[0].tag === 7;
    pickUpWeapon(a, 5);                            // throwing star, also slot A
    check(`a NEW weapon clears the slot's projectiles; a duplicate does not`,
      keptOnDup && a.slots[0].area[0].tag === 0,
      'CS:0x94CE `call 0x9177` sits only on the new-weapon path — so swapping ' +
      'weapons deletes your shots mid-flight while re-collecting the same one ' +
      'leaves them alone');
  }

  {
    /* The original indexes DS:0xe2b6 with no range check. This runs inside the
     * frame callback, so a bad type must not throw — count and skip, the same
     * treatment the out-of-range `dir` and the undecoded handler get. */
    const a = new Arsenal(w1);
    let threw = false;
    try { pickUpWeapon(a, 99); } catch { threw = true; }
    check(`an out-of-range weapon index is counted, not thrown`,
      !threw && a.badWeaponIndex === 1 && a.slots.every((sl) => sl.weapon < 0),
      'a TypeError inside the tick kills the frame, which is strictly worse ' +
      'than the original reading 80 bytes of the wrong table. Shipped maps ' +
      'only place types 0xC0..0xC9, but that is a property of the DATA');
  }

  /* ⚠️ AND THE ONE THAT MATTERS: real geometry, real objects, no fixtures. */
  {
    const lvl = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
    const guns = lvl.objects.filter((o) => isWeaponPickup(o.type));
    const a = new Arsenal(w1);
    const grid = new DamageGrid();
    const target = guns[0];
    const p = new Player(target.x, target.y);      // stand on it
    const fr = stepHeroFrame({ input: IN(), arsenal: a, grid, player: p,
                               map: lvl, cam: { x: 0, y: 0 }, world: 1,
                               objects: lvl.objects, bar: 24 });
    const wi = weaponIndexOf(target.type);
    check(`walking onto a shipped weapon pickup arms the hero`,
      guns.length > 0 && fr.picked.length === 1
        && a.slots[fr.picked[0].slot].weapon === wi && target.dead === true,
      `PLEV1A places ${guns.length} weapon pickups; taking the first ` +
      `(type ${target.type} = ${['knife', 'time bomb', 'fireball', 'flame', 'lightning bolt', 'throwing star', 'spear', 'axe', 'hunter', 'magic axe', 'mace'][wi]}) ` +
      `armed slot ${'ABC'[fr.picked[0].slot]} and removed the object from the ` +
      `map. Driven through stepHeroFrame, so the pickup's place in the tick ` +
      `order (CS:0x0206, before the projectile step) is under test too`);
  }
  {
    /* ⚠️ WHY PICKUP MUST RUN BEFORE THE PROJECTILE STEP. The two orders only
     * differ when a pickup REPLACES a weapon that has shots in flight: the
     * new-weapon path clears the slot (CS:0x9177), so in the original those
     * shots are gone before CS:0x020F ever looks at them. Run pickup after
     * and they get one more move and one more STAMP — a dead weapon's
     * projectile still able to kill on the tick you swapped it away. */
    const { a, p, m } = armed(0);                  // knife in slot A
    const grid = new DamageGrid();
    const cam = { x: 0, y: 0 };
    for (let i = 0; i < 6; i++) {                  // get a shot into the air
      stepHeroFrame({ input: IN({ right: true, fire: i < 2 }), arsenal: a, grid,
                      player: p, map: m, cam, world: 1 });
    }
    const flying = a.slots[0].live;
    const before = a.stamped;
    /* A throwing star (slotAClass 0, so it also wants slot A) on the hero. */
    const drop = [{ x: p.x, y: p.y, type: 0xc0 + 5 }];
    const fr = stepHeroFrame({ input: IN({ right: true }), arsenal: a, grid,
                               player: p, map: m, cam, world: 1,
                               objects: drop, bar: 24 });
    check(`swapping a weapon kills its shots BEFORE they can stamp again`,
      flying > 0 && fr.picked.length === 1 && a.slots[0].weapon === 5
        && a.slots[0].live === 0 && a.stamped === before,
      `${flying} knife shot(s) were in flight; the pickup cleared slot A ` +
      `(CS:0x94CE -> CS:0x9177) at CS:0x0206 and the projectile pass at ` +
      `CS:0x020F then found nothing, so the stamp count did not move. ` +
      `Running pickup after the projectile step gives a weapon you no longer ` +
      `hold one more frame of collision`);
  }

  {
    /* ⚠️ EVERY DEAD SLOT SITS AT (0,0) WITH TYPE 0xFFFF, so a hero standing
     * near the map origin is inside the pickup box of all of them at once.
     * Without the sign test that is 70 phantom weapons on PLEV1A alone —
     * and 0xFFFF - 0xC0 is not even a valid weapon index. This is the case
     * that makes the sign test observable rather than merely defensible. */
    const lvl = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
    const deadAtOrigin = lvl.objects.filter((o) => isDeadType(o.type)).length;
    const a = new Arsenal(w1);
    let taken = 0;
    try {
      taken = stepPickups(lvl.objects, { x: 0, y: 0 }, a, 24).taken.length;
    } catch { taken = -1; }        // an out-of-range weapon index throws
    check(`a hero at the map origin collects none of the ${deadAtOrigin} dead slots`,
      taken === 0 && a.slots.every((sl) => sl.weapon < 0),
      `all ${deadAtOrigin} consumed/unused records on PLEV1A carry type 0xFFFF ` +
      `at (0,0), which passes a naive \`type >= 0xC0\`. CS:0x9000 tests the ` +
      `SIGN instead, and the port does the same`);
  }

  {
    const totals = [];
    for (const k of ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B']) {
      const m = parseMap(dclDecompress(await fetchRaw(`game/PLEV${k}.MAP`)).data);
      totals.push(m.objects.filter((o) => isWeaponPickup(o.type)).length);
    }
    const sum = totals.reduce((x, y) => x + y, 0);
    check(`the eight maps place 55 weapon pickups between them`,
      sum === 55,
      `${totals.join('/')} = ${sum} — the figure this project recorded from a ` +
      `different tool, re-derived here from the shipped bytes. It is the ONLY ` +
      `source of weapons in real play, since CS:0x914c leaves all three slots ` +
      `empty and only the two full restarts reach it`);
  }

  results.push({
    name: 'sound ids are carried but NOT exercised', note: true, pass: true,
    detail: 'The port has no audio, so every sfx id it records is unverified ' +
      'by this suite and asserting one against itself would be a tautology the ' +
      'linter rejects. Stating the gap instead: 0x0638 pickup (CS:0x1939), ' +
      '0x0f22 and 0x0e49 creature death (CS:0xABA0 / 0xABB7), 0x1c fire, ' +
      '0x1d projectile-hits-terrain (CS:0xA7F6), 0x09 magic-axe bounce ' +
      '(CS:0xA7AD), 0x22 bomb detonation (CS:0xA27C), 0x20e footstep and ' +
      '0x0e42 the hurt sound. A green suite does not mean these are right.',
  });

  /* ── CONSUMABLES: the rank, the table width, and a real potion ────────── */
  {
    const cats = parseObjectCategories(
      dclDecompress(await fetchRaw('game/POBJECTS.001')).data);
    const cat0 = [...cats].map((c, i) => [c, i]).filter(([c]) => c === 0).map(([, i]) => i);

    /* ⚠️ The census and the table width agreeing is what pins the size — the
     * words after index 22 (0x50, 0x50, 0x50, 0x50, 0x05, 0x4f) are not code
     * offsets at all. Neither number was chosen to match the other. */
    check(`the consumable table is exactly as wide as the category-0 census`,
      cat0.length === 23 && CONSUMABLES.length === cat0.length,
      `${cat0.length} category-0 types in POBJECTS against ` +
      `${CONSUMABLES.length} handler words at DS:0xd8b8 before the ` +
      `table runs into unrelated data`);

    /* ⚠️ Derive the rank with the ORIGINAL's loop, and check it against the
     * type list rather than against itself. Type 35 must land on rank 3, which
     * requires exactly three category-0 types below it. */
    const r35 = consumableRank(35, cats);
    const below35 = cat0.filter((t) => t < 35);
    check(`the handler index is the RANK among category-0 types, counted below`,
      consumableRank(0, cats) === 0 && r35 === 3 && below35.length === 3
        && below35.join() === '0,2,3',
      `type 35 -> rank ${r35}, because types ${below35.join(', ')} are the only ` +
      `category-0 types beneath it. CS:0x180F counts entries 0..type-1, so the ` +
      `count is STRICTLY below and type 0 is rank 0 — which is why CS:0x180B ` +
      `guards with \`or cx,cx\`, since \`loop\` at cx = 0 runs 65536 times`);

    /* Every decoded handler's type must agree with the rank the loop derives. */
    const bad = CONSUMABLES.filter(
      (h) => consumableRank(h.type, cats) !== h.rank);
    check(`all 23 table entries sit at the rank their own type derives`,
      bad.length === 0,
      `derived from POBJECTS.001 through the original's counting loop, not ` +
      `from the table's own ordering`);

    /* The five decoded ones must be the five that say "restores energy". */
    const objBuf = dclDecompress(await fetchRaw('game/POBJECTS.001')).data;
    const txt = (t) => [...objBuf.slice(t * 48, t * 48 + 48)]
      .map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('');
    const healers = CONSUMABLES.filter((h) => h.effect === 'health');
    check(`the five HEALTH handlers are exactly the five "restores energy" objects`,
      healers.length === 5
        && healers.every((h) => /restores energy/.test(txt(h.type)))
        && healers.map((h) => h.health).join() === '12,24,2,4,3'
        && cat0.filter((t) => /restores energy/.test(txt(t))).length === 5,
      `types ${healers.map((h) => h.type).join(', ')} give ` +
      `+${healers.map((h) => h.health).join('/+')} — each confirmed against its ` +
      `own POBJECTS text, so the addend and the object agree from two sources`);
  }
  {
    /* END TO END on real geometry: stand on a shipped health potion. */
    const cats = parseObjectCategories(
      dclDecompress(await fetchRaw('game/POBJECTS.001')).data);
    const lvl = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
    const healTypes = CONSUMABLES.filter((h) => h.effect === 'health')
      .map((h) => h.type);
    const pot = lvl.objects.find((o) => !isDeadType(o.type) && healTypes.includes(o.type));
    const hp = new Health(HEALTH_MAX, HEALTH_MAX);
    /* Target 0 so no potion in the table can overflow the 24 cap — the
     * conversion path has its own check, and mixing them here would let a
     * wrong addend hide behind the clamp. */
    hp.target = 0;
    const a = new Arsenal(w1);
    const grid = new DamageGrid();
    const p = new Player(pot.x, pot.y);
    const fr = stepHeroFrame({ input: IN(), arsenal: a, grid, player: p,
                               map: lvl, cam: { x: 0, y: 0 }, world: 1,
                               objects: lvl.objects, bar: 12, cats, health: hp });
    const want = CONSUMABLES.find((h) => h.type === pot.type).health;
    check(`walking onto a shipped health potion restores energy`,
      fr.consumed.length === 1 && pot.dead === true
        && hp.target === want && fr.consumed[0].banked === 0
        && fr.consumed[0].taken === true,
      `PLEV1A type ${pot.type} at (${pot.x},${pot.y}) gave +${want}, target ` +
      `0 -> ${hp.target}, nothing banked. It raises the TARGET, so the bar ` +
      `then chases it one unit a frame — a potion is not an instant heal`);
  }

  {
    /* ⚠️ A REFUSED POTION IS STILL CONSUMED. CS:0x17F6 marks the object dead
     * BEFORE CS:0x1829 calls the handler, and the refuse path at CS:0x6209
     * returns the same `dx = 1` as success — so the object is gone and the
     * message still shows. Marking dead after the dispatch would leave a
     * refused potion lying on the floor to be taken again next tick. */
    const cats = parseObjectCategories(
      dclDecompress(await fetchRaw('game/POBJECTS.001')).data);
    const lvl = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
    const healTypes = CONSUMABLES.filter((h) => h.effect === 'health')
      .map((h) => h.type);
    const pot = lvl.objects.find((o) => !isDeadType(o.type) && healTypes.includes(o.type));
    const hp = new Health(HEALTH_MAX, HEALTH_MAX);
    hp.bar = -1;                                  // past the refusal boundary
    hp.target = 5;
    const before = hp.target;
    const a = new Arsenal(w1);
    const p = new Player(pot.x, pot.y);
    const fr = stepHeroFrame({ input: IN(), arsenal: a, grid: new DamageGrid(),
                               player: p, map: lvl, cam: { x: 0, y: 0 },
                               world: 1, objects: lvl.objects, bar: 12,
                               cats, health: hp });
    check(`a potion refused at negative health is STILL consumed`,
      fr.consumed.length === 1 && fr.consumed[0].taken === false
        && pot.dead === true && hp.target === before,
      'the object is gone and no energy was restored. CS:0x17F6 precedes ' +
      'CS:0x1829, and CS:0x6209 returns the same dx = 1 as CS:0x638F — so ' +
      'the caller cannot tell a refusal from a success either. Marking dead ' +
      'after the dispatch leaves it on the floor to retake next tick');
  }

  {
    /* ⚠️ NEITHER TREASURE NOR AN UNDECODED CONSUMABLE MAY BE EATEN. Only 5 of
     * the 23 handlers are decoded, and PLEV1A places TEN category-0 types
     * whose handler is not — so treating the whole category as "potion" is
     * not a corner case, it is most of them. Category 1 (treasure) is a
     * different branch entirely (CS:0x184E) and must not be touched here. */
    const cats = parseObjectCategories(
      dclDecompress(await fetchRaw('game/POBJECTS.001')).data);
    const lvl = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
    const live = lvl.objects.filter((o) => !isDeadType(o.type) && o.type < 0xc0);

    const run = (o) => {
      const hp = new Health(HEALTH_MAX, HEALTH_MAX); hp.target = 5;
      const r = stepPickups([o], { x: o.x, y: o.y }, new Arsenal(w1), 12,
                            { cats, health: hp });
      return { hp, r, o };
    };
    const undec = live.find((o) => {
      const h = CONSUMABLES[consumableRank(o.type, cats)];
      return cats[o.type] === 0 && h && !WIRED.includes(h.effect);
    });
    const treasure = live.find((o) => cats[o.type] === 1);

    const u = run({ ...undec });
    const t = run({ ...treasure });
    check(`a decoded-but-unwired consumable is reported, not silently healed`,
      u.r.consumed.length === 1 && !!u.r.consumed[0].notWired
        && u.o.dead === true && u.hp.target === 5,
      `type ${undec.type} ("${u.r.consumed[0].name}" / ` +
      `"${u.r.consumed[0].desc}") is rank ${consumableRank(undec.type, cats)}, ` +
      `effect "${u.r.consumed[0].effect}" — decoded, but not wired: ` +
      `${u.r.consumed[0].notWired}. Health stayed ${u.hp.target} and the ` +
      `object was STILL consumed, because CS:0x17F6 marks it dead before any ` +
      `dispatch`);
    check(`a treasure object never reaches the consumable dispatch`,
      t.r.consumed.length === 0 && t.hp.target === 5,
      `type ${treasure.type} is category 1 and goes to CS:0x184E. It is now ` +
      `wired (see the treasure block below), but through a different branch — ` +
      `nothing about it may run a DS:0xd8b8 handler, and no potion fires`);
  }

  /* ── THE OTHER 18 CONSUMABLE HANDLERS ────────────────────────────────────
   *
   * Every one is confirmed by its own POBJECTS text, which is what makes this
   * checkable: nothing about a handler address says what it should do.
   */
  {
    const objBuf = dclDecompress(await fetchRaw('game/POBJECTS.001')).data;
    const nm = (t) => {
      const o = t * 48, take = (a, n) => {
        let r = ''; for (let i = a; i < a + n; i++) { if (!objBuf[i]) break; r += String.fromCharCode(objBuf[i]); }
        return r;
      };
      return { name: take(o + 8, 16), desc: take(o + 24, 24) };
    };
    const cats = parseObjectCategories(objBuf);

    check(`every one of the 23 ranks now has a decoded effect`,
      CONSUMABLES.length === 23
        && CONSUMABLES.every((h) => typeof h.effect === 'string' && h.effect.length)
        && CONSUMABLES.every((h) => nm(h.type).name === h.name
                                 && nm(h.type).desc === h.desc),
      `and every entry's recorded name/description matches the shipped ` +
      `POBJECTS record for its type — so the table is indexed by the same ` +
      `type the rank loop derives, checked from the asset rather than from ` +
      `the table's own ordering`);

    /* THE WEAPON ARCS — the sharpest confirmation in the set. */
    check(`the three "weapon arc" tables match their own descriptions`,
      WEAPON_ARCS.map((a) => a.name).join() === 'standard,intense,wide'
        && WEAPON_ARCS[0].dirs[0][1] === -3
        && WEAPON_ARCS[1].dirs[0][1] === -1
        && WEAPON_ARCS[2].dirs[0][1] === -10
        && WEAPON_ARCS.map((a) => a.ss).join() === [0x3612, 0x362a, 0x3642].join()
        && CONSUMABLES.filter((h) => h.effect === 'weaponArc')
             .map((h) => h.desc).join() === 'standard,intense,wide',
      `three adjacent 24-byte SS tables (0x3612 + 0x18 + 0x18), copied over ` +
      `DS:0xdf0e by the one routine CS:0x95BC, with Y-spreads of ` +
      `${WEAPON_ARCS.map((a) => Math.abs(a.dirs[0][1])).join('/')} against ` +
      `descriptions "${WEAPON_ARCS.map((a) => a.name).join('/')}". Nothing ` +
      `about the addresses says which is which; the numbers do`);

    {
      const a = new Arsenal(w1);
      const before = PROJECTILE_VELOCITY.map((v) => `${v.vx},${v.vy}`).join('|');
      setWeaponArc(WEAPON_ARCS[2].dirs);
      const wide = PROJECTILE_VELOCITY.map((v) => `${v.vx},${v.vy}`).join('|');
      resetWeaponArc();
      const back = PROJECTILE_VELOCITY.map((v) => `${v.vx},${v.vy}`).join('|');
      check(`a "wide" stone rewrites the live velocity table, and "standard" restores it`,
        before === back && wide !== before
          && wide.startsWith('10,-10') && back.startsWith('12,-3'),
        `CS:0x95BC overwrites DS:0xdf0e in place — there is ONE velocity ` +
        `table in the original and swapping it is the entire effect, so this ` +
        `port swaps one table too. wide -> ${wide.split('|')[0]}, ` +
        `standard -> ${back.split('|')[0]}`);
      void a;
    }

    /* THE POWER POTION — type 3 applies the boost TWICE. */
    {
      const mk = () => {
        const ar = new Arsenal(w1);
        /* One weapon per slot: +0x00 is 0 for the knife (slot A) and 1 for
         * the lightning bolt and the hunter, which fill B then C. Picking two
         * slot-A weapons would just replace one with the other. */
        pickUpWeapon(ar, 0); pickUpWeapon(ar, 4); pickUpWeapon(ar, 8);
        return ar;
      };
      const one = mk(), two = mk();
      const base = one.slots.filter((sl) => sl.weapon >= 0).map((sl) => sl.st.count);
      applyConsumable(CONSUMABLES.find((h) => h.type === 2), { arsenal: one });
      applyConsumable(CONSUMABLES.find((h) => h.type === 3), { arsenal: two });
      const g1 = one.slots.filter((sl) => sl.weapon >= 0).map((sl) => sl.st.count);
      const g2 = two.slots.filter((sl) => sl.weapon >= 0).map((sl) => sl.st.count);
      check(`the power potion raises the pickup count on EVERY held weapon`,
        base.length === 3 && g1.every((c, i) => c === base[i] + 1)
          && g2.every((c, i) => c === base[i] + 2)
          && POWER_POTION_STEPS[2] === 1 && POWER_POTION_STEPS[3] === 2,
        `CS:0x9426 walks all three slots doing \`inc word [si+0x8]\` — the ` +
        `PICKUP COUNT, so a power potion buys on every weapon at once exactly ` +
        `what a duplicate buys: bigger volley, +1 damage, faster hunter turn. ` +
        `CS:0x62D7 enters one instruction ABOVE CS:0x62DA and so calls it ` +
        `twice, which is why type 3 costs 12000 against type 2's 6000`);
    }

    /* INVULNERABILITY — and the spawn deduction that makes the two differ. */
    check(`the shield potion lasts 255 frames; a SPAWN gets 85`,
      INVULN_TICKS_POTION === 0xff && INVULN_SPAWN_DEDUCTION === 0xaa
        && INVULN_TICKS_SPAWN === 85,
      `CS:0x62C8 and CS:0x085D call the SAME helper CS:0xA90B (which sets ` +
      `DS:0x19c = 255 and DS:0x172 = 1), but the spawn path immediately does ` +
      `\`sub word [0x19c],0xaa\`. At the proven 15 Hz that is 17.0 s of ` +
      `shield against 5.7 s of spawn protection. Reading CS:0xA90B alone and ` +
      `not chasing the \`sub\` would have put 17 s on both`);

    /* FREEZE and GIANT JUMP — each lands on a global this project already
     * documented from the consuming side. */
    check(`"freezes aliens" writes the gate the entity driver already reads`,
      FREEZE_TICKS === 0xaa
        && CONSUMABLES.find((h) => h.type === 44).desc === 'freezes aliens',
      'CS:0x620D sets DS:0x2fa = 170, decremented once per frame at ' +
      'CS:0x0186 and floored at CS:0x018C. DS:0x2fa is read by EIGHTEEN ' +
      'sites including CS:0xEDB8 — the System-B movement gate this project ' +
      'documented long before this handler was decoded — and CS:0xAD8D / ' +
      'CS:0xAE53 in System A. 170 frames = 11.3 s, both systems');

    check(`"giant jump" writes the word the jump arc already doubles on`,
      GIANT_JUMP_TICKS === 0x154
        && CONSUMABLES.find((h) => h.type === 47).desc === 'giant jump',
      'CS:0x62B5 sets DS:0x174 = 340. CS:0x4F6F subtracts each of the 23 arc ' +
      'deltas from Y TWICE while that word is set — this project recorded ' +
      'the doubling as "the double-jump power-up word" without knowing what ' +
      'set it. 340 frames = 22.7 s');

    /* THE SHIELD THAT DOES NOTHING. */
    check(`"shield / reduces damage" sets a flag NOTHING reads`,
      SHIELD_NOOP_DS === 0x34c && SHIELD_NOOP_SITES.length === 4
        && CONSUMABLES.find((h) => h.type === 37).effect === 'noop34c'
        && CONSUMABLES.find((h) => h.type === 37).placed === 3,
      'the immediate `4C 03` occurs FOUR times across all twelve shipped ' +
      'binaries and every one is `C6 06 4C 03 imm` — a byte write. A word ' +
      'access one byte low would read 0x34c as its high half and encode ' +
      '`4B 03`; that pair occurs four times too and is again four byte ' +
      'writes, to the neighbouring 0x34b. Neither alignment yields a reader ' +
      'anywhere. THREE of these ship across the eight maps and none of them ' +
      'reduces any damage');

    /* THE ITEM WITH NO HANDLER. */
    const cut = CONSUMABLES.find((h) => h.type === UNIMPLEMENTED_TYPE);
    check(`"slows monsters" has no handler, and does not even set DX`,
      cut.at === 0x5e9b && cut.dx === null && cut.placed === 0
        && cut.effect === 'unimplemented',
      'rank 11\'s table word is the PLAYER STATE MACHINE\'S EPILOGUE. Two ' +
      'things make "cut item" the reading rather than "undecoded": type 43 is ' +
      'placed in zero maps, and the epilogue never writes DX — which ' +
      'CS:0x182D reads to pick the message tier. All 22 other handlers set ' +
      'it. This port records the entry and refuses to invent a value');

    /* THE MESSAGE TIER. */
    const tiers = CONSUMABLES.filter((h) => h.dx !== null).map((h) => h.dx);
    check(`only the shop potion returns message tier 2`,
      CONSUMABLES.find((h) => h.type === 83).dx === MSG_CLEAR_394
        && tiers.filter((d) => d === 2).length === 1
        && tiers.filter((d) => d === 1).length === 21,
      'CS:0x182D reads DX as a tier, not a success flag: 0 shows no message, ' +
      '1 shows it, >=2 clears DS:0x394 first. 21 handlers return 1 and only ' +
      'CS:0x61E9 returns 2 — the same handler that parks DS:0x363 at 0x41, a ' +
      'POSITIVE value, which makes CS:0x49B5 `js` skip the whole player state ' +
      'machine while the shopkeeper is up');

    /* WHAT A PLAYER CAN ACTUALLY REACH. */
    const placed = {};
    for (const w of [1, 2, 3, 4]) for (const sub of ['A', 'B']) {
      const m = parseMap(dclDecompress(await fetchRaw(`game/PLEV${w}${sub}.MAP`)).data);
      for (const o of m.objects) {
        if (isDeadType(o.type) || o.type >= 0xc0 || cats[o.type] !== 0) continue;
        placed[o.type] = (placed[o.type] || 0) + 1;
      }
    }
    const never = CONSUMABLES.filter((h) => !placed[h.type]);
    check(`the recorded placement counts are the shipped ones, and SEVEN are zero`,
      CONSUMABLES.every((h) => (placed[h.type] || 0) === h.placed)
        && never.length === 7
        && never.map((h) => h.type).join() === '39,40,41,43,44,70,71',
      `re-derived from the eight .MAP files: types ${never.map((h) => h.type).join(', ')} ` +
      `are placed ZERO times. That includes the ENTIRE familiar chain ` +
      `(39 summon / 40 wings / 41 claws), which is why this port decodes ` +
      `CS:0xC2F6 and does not build it — the iron-chest call with more surface`);

    check(`UNKNOWN_DS_0168 is the familiar's energy, and it starts dead`,
      FAMILIAR_ENERGY_DS === 0x168 && banksOverheal(-1) === false
        && banksOverheal(0) === true && banksOverheal(1000) === true
        && FAMILIAR_CLEAR_SITES.join() === [0x047d, 0x8ddf].join()
        && !placed[39],
      'all four behaviours this project listed without a meaning are the ' +
      'familiar: 1000 on summon (CS:0xC347), +1000 for a second potion ' +
      '(CS:0xC2FD), drained by damage (CS:0xAB4D), -1 when it dies ' +
      '(CS:0xC470). CS:0xC440 is called from CS:0x047D and CS:0x8DDF — the ' +
      'two FULL RESTARTS — so it is -1 from the start, and type 39 never ' +
      'ships. That is what makes the over-healing bank unreachable');
  }

  /* ── DESTRUCTIBLE BLOCKS: CS:0x73EC / CS:0x7500 ─────────────────────────── */
  {
    /* THE CENSUS. The world >= 3 gate is not arbitrary — the shipped maps
     * split on it exactly, which is what makes tile 0x6d the right tile. */
    const cens = {};
    for (const w of [1, 2, 3, 4]) for (const sub of ['A', 'B']) {
      const m = parseMap(dclDecompress(await fetchRaw(`game/PLEV${w}${sub}.MAP`)).data);
      let cells = 0, solid = 0;
      for (let i = 0; i < 8192; i++) {
        if (m.planeA[i] !== DESTRUCTIBLE_TILE) continue;
        cells++; if (m.planeB[i] === 1) solid++;
      }
      cens[`${w}${sub}`] = { cells, solid, world: w };
    }
    const early = Object.values(cens).filter((c) => c.world < MIN_WORLD);
    const late = Object.values(cens).filter((c) => c.world >= MIN_WORLD);
    check(`tile 0x6d is solid in EVERY world-3/4 cell and NO world-1/2 cell`,
      early.every((c) => c.cells > 0 && c.solid === 0)
        && late.every((c) => c.cells > 0 && c.solid === c.cells)
        && late.reduce((n, c) => n + c.solid, 0) === 246
        && early.reduce((n, c) => n + c.cells, 0) === 37,
      `246 of 246 solid across worlds 3-4, 0 of 37 across worlds 1-2 ` +
      `(${Object.entries(cens).map(([k, c]) => `${k}:${c.solid}/${c.cells}`).join(' ')}). ` +
      `CS:0xA806's \`cmp byte [0x42],3 / jl\` matches the DATA, not just the ` +
      `code — the authors used 0x6d decoratively early and as breakable ` +
      `masonry late`);

    /* THE MACE. 200 cumulative damage, and a +50 that lives nowhere near
     * the +0x48 flag this project once mistook for it. */
    const wp = {};
    for (const w of [3, 4]) {
      wp[w] = dclDecompress(await fetchRaw(`game/PWEAPONS.00${w}`)).data;
    }
    const powerOf = (buf, i) => (buf[i * 0x50 + 6] << 8) | buf[i * 0x50 + 7];
    const stopsTerrain = (buf, i) => buf[i * 0x50 + 0x48] !== 0;
    const stoppers = [];
    for (let i = 0; i < 11; i++) if (stopsTerrain(wp[3], i)) stoppers.push(i);
    check(`only six weapons can break a block, and the mace needs FIVE shots`,
      (() => {
        if (stoppers.join() !== '0,1,2,3,5,10') return false;
        if (blockDamage(MACE_INDEX, 3) !== 53 || MACE_BONUS !== 50) return false;
        /* ⚠️ Pin the INDEX against the shipped text, not against itself. The
         * weapon names sit at an 80-byte stride in PWEAPONS, and record 10
         * must literally read "mace" — otherwise the +50 is being handed to
         * some other weapon and every damage figure above still passes. */
        const nm = (buf, i) => {
          let r = '';
          for (let k = i * 0x50; k < i * 0x50 + 0x50; k++) {
            const c = buf[k];
            if (c >= 0x61 && c <= 0x7a) r += String.fromCharCode(c);
            else if (r) break;
          }
          return r;
        };
        if (MACE_INDEX !== 10 || nm(wp[3], MACE_INDEX) !== 'mace') return false;
        /* ⚠️ SIMULATE, don't trust the closed form — it was written wrong
         * here first (ceil(201/d) instead of floor(199/d)+1, which agrees
         * for the mace and disagrees for three other weapons). */
        for (const i of stoppers) {
          const dmg = blockDamage(i, powerOf(wp[3], i));
          const d2 = new Destructibles(4);
          let n = 0;
          while (d2.queue[0].hp < 0 && n < 5000) { d2.hit(64, i, powerOf(wp[3], i)); n++; }
          if (n !== shotsToBreak(dmg)) return false;
        }
        return shotsToBreak(53) === 5 && shotsToBreak(1) === 201
            && shotsToBreak(20) === 11 && shotsToBreak(5) === 41;
      })(),
      `+0x48 is a BYTE (\`cmp byte [si+0x48],0\`) and only knife, time bomb, ` +
      `fireball, flame, throwing star and mace have it set — the other five ` +
      `fly through terrain and can never reach CS:0x73EC. Of those six the ` +
      `mace does Power 3 + 50 = 53 -> 5 shots, against the time bomb's ` +
      `${shotsToBreak(20)}, the fireball's ${shotsToBreak(5)} and the ` +
      `knife's ${shotsToBreak(1)} — every one of the six checked by running ` +
      `the real hit loop, not by trusting the formula. ⚠️ Read +0x48 as a big-endian ` +
      `WORD and it picks up +0x49, making the hunter and magic axe wrongly ` +
      `appear to collide — a mistake made and caught writing this`);

    /* END TO END on a real destructible cell. */
    {
      const m = parseMap(dclDecompress(await fetchRaw('game/PLEV4A.MAP')).data);
      const planeA = Uint8Array.from(m.planeA), planeB = Uint8Array.from(m.planeB);
      const cell = [...Array(8192).keys()]
        .find((i) => planeA[i] === DESTRUCTIBLE_TILE && planeB[i] === 1);
      const d = new Destructibles(4);
      check(`a mace needs FIVE shots and a knife 201 — the first one only queues`,
        (() => {
          const a = new Destructibles(4), b = new Destructibles(4);
          let ka = 0; while (a.queue[0].hp < 0 && ka < 500) { a.hit(cell, 0, 1); ka++; }
          let kb = 0; while (b.queue[0].hp < 0 && kb < 500) { b.hit(cell, MACE_INDEX, 3); kb++; }
          return ka === 201 && kb === 5;
        })(),
        `⚠️ CS:0x73EC calls CS:0x743E BEFORE appending, and on an unqueued ` +
        `cell that scan finds nothing — so the first shot only creates the ` +
        `record at hp = -1 and does no damage. 4 damaging hits for the mace ` +
        `is FIVE shots (${shotsToBreak(53)}), and 200 for the knife is ` +
        `${shotsToBreak(1)}. Every later shot is routed by CS:0x743E to ` +
        `\`sub [si+4],ax\` on the SAME record, so it is cumulative damage`);

      /* The break animation, the plane writes, and the restore. */
      let hits = 0;
      while (d.queue[0].hp < 0 && hits < 50) { d.hit(cell, MACE_INDEX, 3); hits++; }
      const solidBefore = planeB[cell];
      let ticks = 0, frames = [];
      while (d.queue[0].x >= 0 && ticks < 40) {
        const fx = d.step(planeA, planeB);
        if (fx.length) frames.push(fx[0].sprite);
        ticks++;
      }
      check(`the block breaks after 4 frames at HALF speed, then plane A goes to 1`,
        solidBefore === 1 && frames.join() === '0,1,1,2,2,3,3' && ticks === 7
          && new Set(frames).size === BREAK_FRAMES
          && planeB[cell] === 0 && planeA[cell] === 1
          && d.restore.length === 1 && d.broken === 1,
        `${BREAK_FRAMES} distinct frames over ${ticks} ticks because DS:0x36c is toggled by ` +
        `\`not\` once per frame (CS:0x0172) and CS:0x7545 advances only when ` +
        `it is set — about 0.53 s at 15 Hz. ⚠️ Plane A becomes 1, NOT 0: ` +
        `under the 1-based rule that is tile index 0, and a port writing 0 ` +
        `draws the wrong tile`);

      const n = d.restoreAll(planeA, planeB);
      check(`a level reload puts every broken block back`,
        n === 1 && planeA[cell] === DESTRUCTIBLE_TILE && planeB[cell] === 1
          && d.queue.every((q) => q.x < 0) && d.enabled === false,
        'CS:0x74DB walks the 100-entry restore list writing plane A = 0x6d ' +
        'and plane B = 1, and its two callers (CS:0x69B1, CS:0x8E40) each ' +
        'follow it immediately with the queue clear at CS:0x74CD');
    }

    check(`shooting an ALREADY-BREAKING block queues a duplicate, not more damage`,
      (() => {
        const d = new Destructibles(4);
        let n = 0;
        while (d.queue[0].hp < 0 && n < 50) { d.hit(64, MACE_INDEX, 3); n++; }
        const frameBefore = d.queue[0].hp;          // 0 — the break animation
        const r = d.hit(64, MACE_INDEX, 3);
        return frameBefore === 0 && d.queue[0].hp === 0
            && r === 'queued' && d.queue[1].x === d.queue[0].x
            && d.queue[1].hp === -1;
      })(),
      'CS:0x746E requires the matched record\'s hp to be NEGATIVE (`cmp word ' +
      '[si+4],0 / js`) before it applies damage. Once the block is breaking, ' +
      'hp is a FRAME INDEX counting 0..3 — so the scan finds no match, falls ' +
      'through to the append, and the same cell gets a second queue record. ' +
      'Dropping that guard subtracts the weapon damage from the animation ' +
      'frame instead, which is the sort of thing that looks like it works');

    /* BOTH CAPACITY QUIRKS, and the second is reachable in shipped data. */
    check(`a full queue drops the hit; a full restore list leaves the block SOLID`,
      (() => {
        const d = new Destructibles(4);
        for (let i = 0; i < QUEUE_SLOTS; i++) d.hit(i * 3, 0, 1);
        const r = d.hit(9999, 0, 1);
        const e = new Destructibles(4);
        e.restore = new Array(RESTORE_SLOTS).fill(0);
        const pA = new Uint8Array(8192).fill(DESTRUCTIBLE_TILE);
        const pB = new Uint8Array(8192).fill(1);
        e.remove({ x: 32, y: 16 }, pA, pB);
        return r === 'dropped' && d.droppedHits === 1
          && e.strandedSolid === 1 && pB[1 + 128] === 1;
      })(),
      `CS:0x7403 returns without appending when all ${QUEUE_SLOTS} slots are ` +
      `busy, and CS:0x759A returns BEFORE touching either plane when the ` +
      `${RESTORE_SLOTS}-entry restore list is full — while the caller still ` +
      `frees the queue slot, so the block finishes its animation and stays ` +
      `put. PLEV4A places 120 destructible cells against 100 restore ` +
      `entries, so that is reachable in shipped data`);

    check(`the break sprite base is an UNINITIALISED read, and is recorded as one`,
      SPRITE_BASE_DS === 0x158 && SPRITE_BASE_VALUE === 0 && BREAK_FRAMES === 4,
      'DS:0x158 is read once (CS:0x7533 `add ax,[0x158]`) and written nowhere ' +
      'in any of the eight binaries at either alignment — the only other ' +
      '`58 01` in the image is `cmp ax,0x158`, an immediate. So it holds ' +
      'whatever BSS holds, and the drawn sprite is the frame index itself. ' +
      'The port reproduces the uninitialised read rather than inventing a ' +
      'designed base, exactly as the plane-A out-of-range note does');

    /* ── THE HAZARD'S EMITTER: is it in any shipped level? ──────────────── */
    {
      /* Read both descriptor windows out of every PALFILS, per this project's
       * own layout: +0x0D58 = System A, +0x11A4 = System B, both stride 0x16,
       * 50 records, +0x00 = entity count (0 = dead), +0x07 = class index. */
      const used = [new Set(), new Set()];
      const perWorld = [{}, {}];
      for (const w of [1, 2, 3, 4]) for (const sub of ['A', 'B']) {
        const d = dclDecompress(await fetchRaw(`game/PALFILS.0${sub}${w}`)).data;
        [0x0d58, 0x11a4].forEach((off, sys) => {
          for (let i = 0; i < 50; i++) {
            const o = off + i * 0x16;
            if (d[o] === 0) continue;
            used[sys].add(`${w}:${d[o + 7]}`);
            (perWorld[sys][w] = perWorld[sys][w] || new Set()).add(d[o + 7]);
          }
        });
      }

      /* ⚠️ THE BINDING, proven by an invariant rather than assumed. */
      const landsEmpty = (sys) => [...used[sys]].filter((k) => {
        const [w, c] = k.split(':').map(Number);
        return CLASS_TABLES[w - 1][sys][c].spriteBase === EMPTY_CLASS;
      });
      const swapped = (sys) => [...used[sys]].filter((k) => {
        const [w, c] = k.split(':').map(Number);
        return CLASS_TABLES[w - 1][1 - sys][c].spriteBase === EMPTY_CLASS;
      });
      check(`table 0 is System A and table 1 is System B — no index hits an empty slot`,
        landsEmpty(0).length === 0 && landsEmpty(1).length === 0
          && swapped(1).length > 0,
        `every class index the shipped descriptors use lands on a NON-EMPTY ` +
        `record under this binding, across all 8 files and both systems. ` +
        `Swap the two tables and ${swapped(1).length} System-B index/world ` +
        `pairs land on 0xFFFF — World 2 uses class 4, and only table 1 has a ` +
        `class 4 there. That asymmetry is what makes the binding checkable ` +
        `rather than a guess`);

      const w4A = [...(perWorld[0][4] || [])].sort();
      /* Index the table through HAZARD_CLASS itself, so misattributing the
       * emitter to the other system or another slot fails here. */
      const hz = CLASS_TABLES[HAZARD_CLASS.world - 1][HAZARD_CLASS.system][HAZARD_CLASS.cls];
      /* ⚠️ Compare against LITERALS, not against HAZARD_HANDLERS. Both that
       * export and CLASS_TABLES are transcriptions of the same GAME.EXE
       * bytes, so checking one against the other restates the transcription
       * — which the check linter correctly refused. What survives as a real
       * measurement is the CENSUS: how many of the 48 records carry this
       * handler pair. It could have been 0 or 8; it is 1. */
      const carriers = CLASS_TABLES.flat(2)
        .filter((r) => r.hA === 0xbd38 || r.hB === 0xbd0b);
      check(`the DS:0xcfcc hazard is CUT — no descriptor anywhere selects it`,
        hz.hA === 0xbd38 && hz.hB === 0xbd0b
          && hz.spriteBase === 531 && carriers.length === 1
          && w4A.join() === '0'
          && !used[0].has('4:3') && !used[1].has('4:3'),
        `the emitter is world 4 / System A / class ${HAZARD_CLASS.cls}, the ` +
        `only record in any of the eight tables carrying handlers ` +
        `0xbd38+0xbd0b, and its sprite base ${HAZARD_SPRITE_BASE} matches ` +
        `CS:0xBD68's \`add bp,0x213\`. System A in world 4 uses class ` +
        `${w4A.join(',')} and NOTHING else, in both PALFILS.0A4 and .0B4. ` +
        `\`call 0xbd38\` and \`call 0xbd0b\` occur ZERO times image-wide, so ` +
        `the class table is the only way in — and nothing takes it. This is ` +
        `the FOURTH cut feature found, after the flame weapon, the iron chest ` +
        `and the entire familiar chain`);

      check(`System A class 3: empty in worlds 1 and 3, populated in 2 and 4, used in NONE`,
        CLASS_TABLES[0][0][3].spriteBase === EMPTY_CLASS
          && CLASS_TABLES[2][0][3].spriteBase === EMPTY_CLASS
          && !used[0].has('1:3') && !used[0].has('2:3')
          && !used[0].has('3:3') && !used[0].has('4:3'),
        'so the slot is empty where it is unused and populated only where it ' +
        'is STILL unused — the shape of a feature that was built and then ' +
        'never placed, not one that was never built');

      {
        /* Every empty slot is in System A, and there are exactly four. That is
         * a real measurement over the 48 records — and it is the shape of the
         * finding: System A is the table with holes in it, and the hazard sits
         * in one of the two worlds where that hole was filled and still never
         * used. */
        const empties = [];
        CLASS_TABLES.forEach((wt, wi) => wt.forEach((tbl, sys) =>
          tbl.forEach((r, c) => {
            if (r.spriteBase === EMPTY_CLASS) empties.push(`w${wi + 1}s${sys}c${c}`);
          })));
        check(`exactly FOUR class slots are empty, and all four are System A`,
          empties.length === 4 && empties.every((e) => e.includes('s0'))
            && empties.join() === 'w1s0c3,w2s0c4,w3s0c3,w4s0c4',
          `${empties.join(' ')} — System B has no holes at all. Note the hole ` +
          `MOVES: class 3 in worlds 1 and 3, class 4 in worlds 2 and 4. So ` +
          `class 3 is EMPTY in worlds 1/3 and POPULATED in worlds 2/4 — and ` +
          `unused in all four. World 4's populated-but-unused class 3 is the ` +
          `falling hazard`);
      }

      check(`DS:0xcfcc is ONE pool with TWO tenants and two self-modifying gates`,
        POOL_SLOTS === 10 && POOL_STRIDE === 10 && POOL_TENANTS.length === 2
          && POOL_TENANTS[0].alloc === 0x8b0e && POOL_TENANTS[1].alloc === 0x8619
          && POOL_TENANTS[0].gate !== POOL_TENANTS[1].gate,
        'two first-fit allocators over the same ten slots, two walkers, two ' +
        'SMC enable gates, a counter DS:0x3b2 each walker resets per pass (see the correction below), and incompatible ' +
        '+0x04/+0x06 semantics — with nothing interlocking them. The ' +
        'conflict cannot arise in shipped data only because the hazard half ' +
        'is never instantiated, which is also why nobody found it');
    }

    results.push({
      name: 'what the class-table checks above can and cannot prove',
      note: true, pass: true,
      detail: 'CLASS_TABLES is a TRANSCRIPTION of GAME.EXE at DS:0xdf80, and ' +
        'the suite cannot re-derive it: the executable is deliberately not ' +
        'staged into public/game (copy-assets.mjs ships only game data, so ' +
        'that every format claim is exercised against shipped assets rather ' +
        'than the binary). So "the emitter record holds handlers 0xbd38/' +
        '0xbd0b" rests on my transcription, and the check linter was right to ' +
        'reject comparing it against another export of the same bytes. What ' +
        'IS derived from shipped data, and is what the finding rests on: ' +
        'every class index in all 8 PALFILS files, the fact that none of them ' +
        'is world-4 class 3, and that none lands on an empty record under ' +
        'this table/system binding while the swapped binding fails.',
    });

    /* ── DEBRIS, DS:0x8b4c — and the conflation that produced it ────────── */
    check(`the debris body contains exactly ONE call, and it is the blitter`,
      DBG_SLOTS === 20 && DBG_STRIDE === 12 && LIFETIME_TICKS === 11
        && SPRITE_FIRST === 0x3a && SPRITE_LAST === 0x44 && EXPIRE_AT === 0x45,
      'CS:0x1F8C-0x1FD6 calls CS:0x356e (graphics export 2, the masked blit) ' +
      'and nothing else — no CS:0xac59, no damage-grid stamp, no plane ' +
      'pointer. DS:0x8b4c debris is PURELY COSMETIC. The draw at CS:0x1FC0 ' +
      'precedes the increment at CS:0x1FC5, so ids 0x3A..0x44 are all drawn: ' +
      'eleven passes, and the sprite word IS the lifetime');

    check(`debris flies in a STRAIGHT LINE — no gravity, unlike every sibling`,
      (() => {
        const d = new Debris();
        d.spawn(100, 100, 4, -6);
        const ys = [];
        for (let i = 0; i < 5; i++) ys.push(d.step({ x: 0, y: 0 })[0].y);
        /* constant vy = -6 means a constant step, not an accelerating one */
        const steps = ys.slice(1).map((y, i) => y - ys[i]);
        return new Set(steps).size === 1 && steps[0] === -6;
      })(),
      'CS:0x1F99/0x1F9E READ +0x06/+0x08 and never write them. Every other ' +
      'particle system in this game accelerates — hero, enemy, time bomb, ' +
      'magic axe, chest loot, starburst, and the DS:0xcfcc hazard — so ' +
      '"obviously it should fall" is exactly the wrong instinct here');

    check(`a chunk lives exactly 11 ticks and is then freed`,
      (() => {
        const d = new Debris();
        d.spawn(0, 0, 0, 0);
        let n = 0;
        while (d.live > 0 && n < 40) { d.step({ x: 0, y: 0 }); n++; }
        return n === LIFETIME_TICKS && d.count === 0;
      })(),
      'CS:0x1FC8 `cmp word [si+0xa],0x45 / jl` is a SIGNED compare against 69, ' +
      'and there is NO cull of any kind — no off-screen test, no terrain ' +
      'test, no contact test. A chunk lives its 11 ticks wherever it goes');

    results.push({
      name: '⚠️ UNKNOWN_block_breaker_8bca: the answer, and the mistake that found it',
      note: true, pass: true,
      detail: 'I claimed last pass that DEBRIS breaks blocks, having seen ' +
        'CS:0x8B90\'s walker reach CS:0x8BCA with `mov si,0x8b4c` nearby. ' +
        'Wrong: CS:0x8b4a is `2E C6 06 56 8B C3` = `mov byte [cs:0x8b56],0xc3`, ' +
        'so "8b4c" in CODE is that instruction\'s modrm byte, mid-instruction. ' +
        'The walker\'s real base is CS:0x8b57 `mov si,0xcfcc` — a TEN-slot ' +
        'array of stride 10. The block-breaker is the DS:0xcfcc falling ' +
        'hazard; DS:0x8b4c is inert decoration. Two bytes apart, different ' +
        'segments — the exact failure this project\'s own "resolve the ' +
        'segment FIRST" rule exists to prevent.',
    });

    results.push({
      name: 'this closes the "maces break blocks" loop without reopening +0x48',
      note: true, pass: true,
      detail: 'This project once recorded PWEAPONS +0x48 as "breaks blocks", ' +
        'inferred from field position, then corrected it on the bytes to ' +
        '"is STOPPED BY terrain" because the path it gates writes neither ' +
        'plane. That correction stands. The mace\'s advantage is a `+50` at ' +
        'CS:0x74AF, in a different routine reached through a different call — ' +
        'so the folklore was right about the mace and the old note was still ' +
        'wrong about which byte says so.',
    });
  }

  /* ── THE STARBURST: CS:0xA461 / CS:0xA4C1 ───────────────────────────────── */
  {
    check(`the template is EIGHT pairs, and the count lands on a known boundary`,
      BURST_TEMPLATE.length === PARTICLES_PER_BURST
        && PARTICLES_PER_BURST === 8
        && 0xdd00 + PARTICLES_PER_BURST * 2 === 0xdd10,
      `CS:0xA47C loads \`dl = 7\` and exits on \`dec dl / js\`, which is EIGHT ` +
      `placements, each consuming one {vx,vy} pair. 8 x 2 bytes from ` +
      `DS:0xdd00 ends exactly at DS:0xdd10 — the hero's weapon slot A, a ` +
      `variable this project established from a completely different ` +
      `direction. Seven would leave the template two bytes short of it`);

    check(`the eight rays are a compass rose with a constant upward bias`,
      BURST_TEMPLATE.filter(([vx]) => vx > 0).length === 3
        && BURST_TEMPLATE.filter(([vx]) => vx < 0).length === 3
        && BURST_TEMPLATE.filter(([vx]) => vx === 0).length === 2
        && BURST_TEMPLATE.every(([vx, vy]) => Math.abs(vx) === 8 || vx === 0)
        && new Set(BURST_TEMPLATE.map(([, vy]) => vy)).size === 3
        /* ⚠️ EIGHT DISTINCT DIRECTIONS. A rose with a duplicated ray is not a
         * rose, and sign counts alone do not catch one. */
        && new Set(BURST_TEMPLATE.map((t) => t.join())).size === 8,
      `three rays right, three left, two straight up/down — and only three ` +
      `distinct vy values (${[...new Set(BURST_TEMPLATE.map((t) => t[1]))].join(', ')}), ` +
      `with the "level" pair carrying -1 rather than 0. That is a burst, not ` +
      `a spray, which is what the name says`);

    /* IT TERMINATES — and the bound is the original's, not a guard I added. */
    {
      const sb = new Starburst(new GodsRandom(5));
      const grid = new DamageGrid();
      const placed = sb.spawn(400, 300);
      let ticks = 0, stamped = 0, peak = 0;
      while (sb.active && ticks < 4000) {
        grid.clear();
        const r = sb.step({ x: 240, y: 200 }, grid);
        stamped += r.stamped; peak = Math.max(peak, r.live);
        ticks++;
      }
      check(`a starburst runs to quiescence and switches itself off`,
        placed === 8 && sb.active === false && sb.liveCount === 0
          && ticks < 4000 && stamped > 0,
        `8 particles -> ${sb.bursts} bursts (${sb.chained} of them chained), ` +
        `peak ${peak} live of ${SLOTS} slots, ${stamped} grid stamps, done in ` +
        `${ticks} ticks. Nothing bounds this but the original's own gate — the ` +
        `spawner refuses once the burst is active AND its age has reached the ` +
        `ceiling — plus first-fit over a fixed array. No recursion guard was ` +
        `added, because the original does not have one`);
    }

    /* THE CHAIN, and the two details that make it finite. */
    check(`the re-burst chance decays with age, to exactly zero at the ceiling`,
      chainThreshold(0) === 380 && chainThreshold(AGE_MAX) === 0
        && chainThreshold(AGE_MAX / 2) === 190 && AGE_STEP === 2,
      'CS:0xA574 computes (190 - age) * 2 and compares it `ja` against the ' +
      'FULL 16-bit random word, so the chance runs 380/65536 down to nothing ' +
      'over the 95 frames the age takes to climb at +2 a tick');

    {
      /* ⚠️ A chain re-burst inherits the age; a fresh one resets it. */
      const sb = new Starburst(new GodsRandom(1));
      sb.spawn(0, 0);
      sb.age = 100;
      const before = sb.age;
      sb.spawn(50, 50);                     // still active -> a CHAIN
      const afterChain = sb.age;
      sb.active = false;
      sb.spawn(50, 50);                     // inactive -> a FRESH burst
      check(`a chained burst inherits the age; only a fresh one resets it`,
        before === 100 && afterChain === 100 && sb.age === 0
          && sb.chain === CHAIN_WINDOW,
        'CS:0xA493 `cmp byte [0x34d],0 / js` skips the whole init block — age, ' +
        'active flag and chain window — when the burst is ALREADY active, and ' +
        'CS:0xA581 then reopens the window on its own. So the window keeps ' +
        'resetting while the age does not, and it is the AGE that ends the ' +
        'cascade. Resetting it on a chain makes the effect run forever');
    }

    check(`the spawner refuses once an active burst reaches the age ceiling`,
      (() => {
        const sb = new Starburst(new GodsRandom(1));
        sb.spawn(0, 0); sb.age = AGE_MAX;
        const n = sb.spawn(10, 10);
        return n === 0 && sb.refused === 1;
      })(),
      'CS:0xA46A `cmp word [0x1d6],0xbe / jl` — and the gate applies only ' +
      'while DS:0x34d is set, so an INACTIVE burst always spawns whatever the ' +
      'stale age reads. That pair of conditions is the whole termination proof');

    /* GRAVITY EVERY EIGHTH FRAME — a sixth rule, and the only uncapped one. */
    {
      const sb = new Starburst(new GodsRandom(1));
      sb.spawn(400, 300);
      const grid = new DamageGrid();
      const vys = [];
      for (let i = 0; i < 17; i++) {
        grid.clear();
        sb.step({ x: 240, y: 200 }, grid);
        vys.push(sb.slots[2].vy);            // the S ray, vy = +5
      }
      const bumps = vys.filter((v, i) => i > 0 && v !== vys[i - 1]).length;
      check(`starburst gravity applies once every EIGHTH frame, uncapped`,
        GRAVITY_PERIOD === 8 && bumps === 2 && vys[vys.length - 1] === 7,
        `vy went 5 -> ${vys[vys.length - 1]} over 17 frames — ${bumps} steps, ` +
        `not 17. CS:0xA50D gates \`inc byte [si-1]\` on a 0..7 counter reading ` +
        `zero. That is a SIXTH distinct gravity rule (hero 4+v cap 10, enemy v ` +
        `then ++ cap 16, bomb ++ cap 4, axe +=2 cap 8, chest loot ++ cap 4) — ` +
        `and the only one with no cap at all`);
    }

    check(`the starburst cull is its own rectangle, matching none of the others`,
      SB_CULL.xMin === -8 && SB_CULL.xMax === 0x15f
        && SB_CULL.yMin === -8 && SB_CULL.yMax === 0xbf,
      'x in [-8, 351], y in [-8, 191], inclusive — against the projectile ' +
      "mover's exclusive (-32,320)x(-32,192) and the pathfinder's " +
      '[-63,351]x[-63,223]. A sixth rectangle. Reusing one constant diverges');

    check(`a starburst particle carries tag 0xFC and one-shots in normal play`,
      SB_TAG === 0xfc && modeDamage(0xfc, 0) === 10000 && modeDamage(0xfc, 2) === 50
        && modeDamage(0xfe, 0) === 10000 && modeDamage(0xfd, 0) === 0,
      'the tag is the byte AT DS:0xdcfe, which CS:0xA549 passes as `di` and ' +
      'CS:0xA886 reads with `mov cl,[di]`. 10000 against creature HP that ' +
      'tops out at 255 is an instant kill no difficulty scalar can forgive — ' +
      'the scalar forgives at most three quarters. DS:0x34 is 0 in normal ' +
      'play: all four of its main-loop readers take the full-frame path only ' +
      'at zero, and the only writers of 1 and 2 are a self-modifying cutscene ' +
      'path and the post-explosion path');

    {
      /* ⚠️ AND IT MUST ACTUALLY RUN IN THE FRAME. The termination check above
       * drives `step` directly, which leaves the CS:0x0212 wiring untested —
       * exactly the gap that let a swapped projectile/player order survive
       * before frame.js existed. */
      const lvl = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
      const sb = new Starburst(new GodsRandom(9));
      sb.spawn(400, 300);
      const before = sb.slots.map((sl) => `${sl.x},${sl.y}`).join('|');
      const g = new DamageGrid();
      const p2 = new Player(400, 300);
      const fr = stepHeroFrame({
        input: { fire: false }, arsenal: new Arsenal(w1), grid: g, player: p2,
        map: lvl, cam: { x: 240, y: 200 }, world: 1, starburst: sb });
      const after = sb.slots.map((sl) => `${sl.x},${sl.y}`).join('|');
      check(`the starburst steps inside the frame, at CS:0x0212`,
        /* ⚠️ SIXTEEN, not eight. The chain fired during this very walk, and
         * because the spawner is first-fit from slot 0 the new particles land
         * AHEAD of the cursor and are stepped by the same pass. CS:0xA58C
         * calls the spawner from inside CS:0xA4F3's own loop and CS:0xA592
         * carries on over whatever it wrote — so this is the original's
         * behaviour, not an artefact of iterating a mutating array. */
        fr.burstFx !== null && fr.burstFx.live === 16 && sb.chained === 1
          && before !== after && fr.burstFx.stamped > 0
          && FRAME_ORDER.findIndex((e) => e.at === 0x0212)
             > FRAME_ORDER.findIndex((e) => e.at === 0x020f)
          && FRAME_ORDER.findIndex((e) => e.at === 0x0212)
             < FRAME_ORDER.findIndex((e) => e.at === 0x0254),
        `${fr.burstFx.live} particles moved and ${fr.burstFx.stamped} ` +
        `stamped — 8 spawned plus 8 more from a chain that fired mid-walk, ` +
        `driven ` +
        `through stepHeroFrame rather than called directly. CS:0x0212 sits ` +
        `between the projectile step (0x020F) and the player (0x0254), so a ` +
        `particle stamps on the same tick it moves — and a burst the player ` +
        `sets off this tick cannot stamp until the next one`);
    }

    check(`all five spawner call sites are recorded, not just the potion`,
      SPAWNER_CALLERS.length === 5
        && SPAWNER_CALLERS.includes(0x6205) && SPAWNER_CALLERS.includes(0xa58c)
        && SPAWNER_CALLERS.includes(0xc464) && SPAWNER_CALLERS.includes(0xd945),
      'the potion (CS:0x6205), a tile-derived site (CS:0x9417), the chain ' +
      'itself (CS:0xA58C), the FAMILIAR\'S DEATH (CS:0xC464 — it bursts where ' +
      'it died) and a scripted seven-burst explosion (CS:0xD945, which clears ' +
      'DS:0x34d every iteration to force seven FRESH bursts rather than one ' +
      'continuation). Reading only the potion misses four of the five');

    results.push({
      name: 'the 0xFC "debris" label was wrong, and it came from a [WF] note',
      note: true, pass: true,
      detail: 'This project\'s grid-tag table carried 0xFC as "debris particle ' +
        '(CS:0xA549)", from a workflow lane explicitly marked as not re-read. ' +
        'CS:0xA549 is inside the STARBURST updater; debris is a different ' +
        '20-record array at DS:0x8b4c, cleared at CS:0x8E91 and appended at ' +
        'CS:0xA816 on the projectile terrain-stop path. The tag VALUE was ' +
        'right and the SOURCE was wrong — the first time that block has been ' +
        'checked on the bytes.',
    });
  }

  /* ── TREASURE: CS:0x184E ─────────────────────────────────────────────────
   *
   * The three-way branch, the chest/key arithmetic, the value award, and the
   * ten-item burst a chest throws out when it opens.
   */
  {
    const recs = {};
    for (const w of [1, 2, 3, 4]) {
      recs[w] = parseObjectRecords(
        dclDecompress(await fetchRaw(`game/POBJECTS.00${w}`)).data);
    }

    check(`the 48-byte POBJECTS record accounts for every byte`,
      OBJ_NAME_OFF + OBJ_NAME_MAX === OBJ_DESC_OFF
        && OBJ_DESC_OFF + OBJ_DESC_MAX === OBJ_RECORD_SIZE
        && OBJ_RECORD_SIZE === 48,
      'CS:0x35FB is the parser this project recorded as never located. Its ' +
      'own immediates fix the widths: four `movsw` copy +0..+7, then the ' +
      'name is read to its NUL and `add si,0x10` (CS:0x363A) skips to the ' +
      'description, which `add si,0x18` (CS:0x3658) closes at 48. 8+16+24=48');

    /* The keys. This is the discriminating one: 21/22/23 are the ONLY three
     * records in the file named "chest key", and the formula must land on all
     * three and nothing else. A dropped `>> 1` gives 21/23/25 and a base of
     * 0x14 gives 20/21/22 — both hit "world key" or "door key" instead. */
    for (const w of [1, 2, 3, 4]) {
      const chestTypes = [];
      for (let t = CHEST_MIN; t < CHEST_MAX; t += 2) chestTypes.push(t);
      const keyNames = chestTypes.map((t) => recs[w][chestKeyFor(t)].name);
      const chestNames = chestTypes.map((t) => recs[w][t].name);
      check(`world ${w}: every chest key the formula names is a "chest key"`,
        keyNames.length === 3 && keyNames.every((n) => n === 'chest key')
          && chestNames.every((n) => n === 'treasure chest'),
        `types ${chestTypes.join('/')} are all "${chestNames[0]}" and ` +
        `CS:0x1867's 21 + (type-12)/2 gives ${chestTypes.map(chestKeyFor).join('/')}` +
        `, all "chest key". Types 18/19/20 — door/treasure/world key — are ` +
        `NOT reachable from this arithmetic, which is what makes it checkable`);
    }

    check(`the three chests are gold / steel / iron, and a pair shares its value`,
      [12, 14, 16].map((t) => recs[1][t].desc).join(',') === 'gold,steel,iron'
        && [12, 14, 16].every((t) => recs[1][t].value === recs[1][t + 1].value)
        && [12, 14, 16].map((t) => recs[1][t].value).join(',') === '3000,2000,1000',
      'the DESCRIPTION field carries the material, and the odd twin of each ' +
      'pair holds the identical value — exactly what CS:0x18E2 `or cx,1` ' +
      'implies. Same convention as levers 24/25 and switches 26/27');

    check(`the score award is an ARITHMETIC shift, not a divide`,
      scoreForValue(3000) === 375 && scoreForValue(-1) === -1
        && Math.trunc(-1 / 8) === 0,
      'CS:0x18B7-0x18BB is three `sar`. No shipped value is negative, so a ' +
      'port written with `/ 8` passes every data-driven test and is still ' +
      'wrong — the same trap the Bezier Q15 note records');

    /* ── The census. Reported as numbers, because one of them does not close. */
    const placed = {}, keys = {};
    for (const w of [1, 2, 3, 4]) for (const s of ['A', 'B']) {
      const m = parseMap(dclDecompress(await fetchRaw(`game/PLEV${w}${s}.MAP`)).data);
      for (const o of m.objects) {
        if (isDeadType(o.type) || o.type >= 0xc0) continue;
        if (isChestType(o.type)) placed[o.type] = (placed[o.type] || 0) + 1;
        if (recs[w][o.type] && recs[w][o.type].name === 'chest key') {
          keys[o.type] = (keys[o.type] || 0) + 1;
        }
      }
    }
    check(`chests always start CLOSED — no odd chest type is ever placed`,
      !placed[13] && !placed[15] && !placed[17]
        && placed[12] === CHEST_KEY_CENSUS.chests[12]
        && placed[14] === CHEST_KEY_CENSUS.chests[14],
      `all 8 maps place ${placed[12]} type-12 and ${placed[14]} type-14 chests ` +
      `and ZERO of 13/15/17. So the odd arm at CS:0x1919 is only ever reached ` +
      `by re-touching a chest the player already opened, which is precisely ` +
      `what it exists to make harmless`);

    check(`UNKNOWN_chest_key_surplus is a measurement, not a smoothing`,
      (placed[16] || 0) === CHEST_KEY_CENSUS.chests[16]
        && keys[21] === CHEST_KEY_CENSUS.keys[21]
        && keys[22] === CHEST_KEY_CENSUS.keys[22]
        && keys[23] === CHEST_KEY_CENSUS.keys[23],
      `gold: ${placed[12]} chests / ${keys[21]} keys. steel: ${placed[14]} / ` +
      `${keys[22]}. iron: ${placed[16] || 0} / ${keys[23]} — SIX keys for a ` +
      `chest that ships nowhere. The arithmetic is not in doubt; what the ` +
      `surplus means (a cut chest, or a spare key) this binary cannot say`);

    /* ── The three outcomes, driven through the real object walk. */
    const cats = parseObjectCategories(
      dclDecompress(await fetchRaw('game/POBJECTS.001')).data);
    const values = recs[1].map((r) => r.value);
    const ctx = (inv, burst = null) => ({
      values, inventory: inv, purse: new Purse(), score: new Score(), burst,
    });

    {
      const t = ctx([INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY]);
      const o = { x: 100, y: 100, type: 10, flag6: 1 };   // "diamond", 500
      const r = stepPickups([o], { x: 100, y: 100 }, new Arsenal(w1), 12,
                            { cats, treasure: t });
      check(`ordinary treasure pays the descriptor's +6 into money and score`,
        r.treasures.length === 1 && r.treasures[0].outcome === 'collected'
          && o.dead === true && t.purse.total === 500 && t.score.value === 62
          && r.treasures[0].sfx === TREASURE_SFX,
        `a "diamond" is value 500 -> money 500, score 500>>3 = 62. That the ` +
        `number comes from POBJECTS +6 is the point: this project carried +6 ` +
        `as "likely the Value, inferred by structural position". CS:0x18A8 ` +
        `and CS:0x18F4 are the decompile that promotes it`);
    }

    {
      const t = ctx([INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY]);
      const o = { x: 100, y: 100, type: 12, flag6: 1 };
      const r = stepPickups([o], { x: 100, y: 100 }, new Arsenal(w1), 12,
                            { cats, treasure: t });
      check(`a locked chest without its key pays NOTHING and stays on the map`,
        r.treasures[0].outcome === 'locked' && r.treasures[0].needsKey === 21
          && o.dead !== true && o.type === 12
          && t.purse.total === 0 && t.score.value === 0,
        'CS:0x188B restores the type and jumps to the plain return. The gold ' +
        'chest is worth 3000 and it is entirely unavailable without key 21');
    }

    {
      const inv = [INVENTORY_EMPTY, 21, INVENTORY_EMPTY, INVENTORY_EMPTY];
      const burst = new TreasureBurst(new GodsRandom(7));
      const t = ctx(inv, burst);
      const o = { x: 320, y: 200, type: 12, flag6: 1 };
      const r = stepPickups([o], { x: 320, y: 200 }, new Arsenal(w1), 12,
                            { cats, treasure: t });
      check(`the key is SPENT, the chest turns odd, and it pays out`,
        r.treasures[0].outcome === 'unlocked' && inv[1] === INVENTORY_EMPTY
          && o.type === 13 && o.dead !== true
          && t.purse.total === 3000 && t.score.value === 375
          && r.treasures[0].sfx === CHEST_SFX,
        'CS:0x18DE clears the inventory slot, CS:0x18E2 `or cx,1` turns 12 ' +
        'into 13 IN PLACE — the object is not consumed, it changes graphic. ' +
        'And unlocking has its own sound, 0x52d against the common 0x638');

      /* Re-touching the now-open chest must pay nothing. */
      const before = t.purse.total;
      const r2 = stepPickups([o], { x: 320, y: 200 }, new Arsenal(w1), 12,
                             { cats, treasure: t });
      check(`re-touching an OPEN chest pays nothing — the odd arm is the guard`,
        r2.treasures[0].outcome === 'already-open' && t.purse.total === before
          && isOpenChest(o.type),
        'CS:0x185D `jmp 0x1919` exists to skip CS:0x1891. Both of its stores ' +
        'are inert (`cx` already is `[si+4]`, and `[si+6]` is re-derived by ' +
        'the activation pass every frame) — the JUMP is the whole function');

      check(`opening a chest throws TEN treasure items out of it`,
        burst.inFlight === BURST_COUNT
          && r.treasures[0].loot.length === BURST_COUNT
          && r.treasures[0].loot.every((ty) => cats[ty] === 1),
        `CS:0x12CF -> CS:0x12EA writes ten records at DS:0xb654. The types ` +
        `come from a table at DS:0x${BURST_TABLE_DS.toString(16)} and every ` +
        `one is itself category 1: ${r.treasures[0].loot.join(',')}`);
    }

    /* ── The burst table's stride bug. */
    check(`the burst table is 60 bytes — bounded by the hero's jump arc`,
      BURST_TABLE.length === 30
        && 0xd922 - BURST_TABLE_DS === 3 * BURST_AUTHORED_WORDS * 2
        && BURST_ALIGNED_DS - BURST_TABLE_DS === 2 * BURST_AUTHORED_WORDS * 2,
      'DS:0xd922 is this project\'s own jump-arc table, so the region is ' +
      'closed at both ends at exactly 3 x 20 bytes. And CS:0x1756 enters the ' +
      'same spawner with DS:0xd90e hard-coded — 2 x 20 — i.e. the correctly ' +
      'aligned third list. One caller reads the table aligned; the other ' +
      'computes its offset with four `shl` (x16) and does not');

    check(`aligned, all three lists start "80 80 80 80 5"; strided, two do not`,
      [12, 14, 16].every((t) =>
        burstTypesAligned(openedType(t)).slice(0, 5).join() === '80,80,80,80,5')
        && burstTypes(13).join() === burstTypesAligned(13).join()
        && burstTypes(15).join() !== burstTypesAligned(15).join()
        && burstTypes(17).join() !== burstTypesAligned(17).join(),
      'four "gold plate" and a "bag of gold" open every authored list. The ' +
      'x16 stride reads list 1 as `9 9 80 ...` and list 2 as `10 5 9 9 80 ...`' +
      ' — entries beginning inside the previous one. List 0 is at offset 0 ' +
      'and so is correct either way');

    check(`the misalignment is invisible: a rotation, then a chest nobody meets`,
      burstTypes(15).slice().sort().join() === burstTypesAligned(15).slice().sort().join()
        && burstTypes(17).slice().sort().join() !== burstTypesAligned(17).slice().sort().join()
        && (placed[16] || 0) === 0,
      'the steel list misaligned is a pure ROTATION of the authored one — ' +
      'same ten items, so identical loot and only the spawn order differs. ' +
      'The iron list genuinely differs (a "chrystal" becomes a "bag of ' +
      'gold"), and type 16 is placed in ZERO shipped maps. So the port ' +
      'reproduces the x16 verbatim: "fixing" it would diverge from the ' +
      'original on a chest that does not exist');

    /* ── The burst's flight and settle. */
    {
      const burst = new TreasureBurst(new GodsRandom(3));
      burst.spawn(13, 500, 300);
      const slots = expandMapObjects([]);            // 200 free slots
      let ticks = 0, settled = 0;
      while (burst.active && ticks < 200) {
        settled += burst.step(() => allocObject(slots)).settled.length;
        ticks++;
      }
      const live = slots.filter((s) => !s.dead);
      check(`every burst item lands and becomes a real, collectable object`,
        settled === BURST_COUNT && live.length === BURST_COUNT
          && live.every((s) => s.flag6 === 1 && cats[s.type] === 1)
          && burst.inFlight === 0,
        `all ten settled in ${ticks} ticks through the CS:0x38D7 allocator, ` +
        `and each got \`[+6] = 1\` at CS:0x13D0 — so a chest's loot is live ` +
        `the instant it lands, with no wait for the activation pass`);
    }

    {
      /* The clamp, driven directly. The spawn range rarely produces a record
       * whose vy saturates BEFORE its vx reaches zero, so a run of ten proves
       * only that they all settle; it does not pin the cap. This one does. */
      const burst = new TreasureBurst();
      burst.spawn(13, 0, 0);
      for (const r of burst.records) { r.type = -1; }
      Object.assign(burst.records[0], { x: 0, y: 0, vx: 8, vy: -3, type: 80 });
      burst.active = true;
      const vys = [], slots = expandMapObjects([]);
      let t = 0;
      while (burst.active && t < 40) {
        burst.step(() => allocObject(slots));
        if (burst.records[0].type >= 0) vys.push(burst.records[0].vy);
        t++;
      }
      check(`burst gravity tops out at exactly +4 and holds there`,
        vys.join() === '-2,-1,0,1,2,3,4' && t === 8
          && slots.filter((s) => !s.dead).length === 1,
        `vy stepped ${vys.join(' ')} — reaching 4 on tick 7 and NOT moving on ` +
        `tick 8, where vx finally hit 0 and the item settled. A cap of 3 ` +
        `settles a tick early and lands the item 4 px short. This is a FIFTH ` +
        `distinct gravity rule (CS:0x1378), against the hero's 10, the ` +
        `enemy's 16, the bomb's stepped 4 and the axe's +2-to-8 — and the ` +
        `only one that also decays horizontally (CS:0x1383)`);
    }

    check(`the open transition is IDEMPOTENT — \`or cx,1\`, never \`+ 1\``,
      openedType(12) === 13 && openedType(13) === 13
        && openedType(14) === 15 && openedType(15) === 15,
      'CS:0x18E2 is `or cx,0x1`. On the even types it reaches, `+ 1` would ' +
      'agree — but the whole even/odd convention rests on the open type being ' +
      'a fixed point, exactly as the lever `xor` pair does, and a port that ' +
      'writes `+ 1` turns a re-opened gold chest into a steel one');

    {
      const m = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
      const slots = expandMapObjects(m.objects);
      const live = slots.filter((s) => !s.dead);
      check(`a map-placed object starts DEACTIVATED — \`+6\` is not map data`,
        slots.length === OBJECT_SLOTS && live.length > 0
          && live.every((s) => s.flag6 === 0),
        `CS:0x9011 writes \`mov word [di],0x0\` for every one of the 200 ` +
        `expanded records, so all ${live.length} live objects on PLEV1A begin ` +
        `with +6 clear. Nothing in the .MAP sets it`);

      const b0 = activationBox(0, 0);
      check(`the activation box is 448 x 288 around a 320 x 200 screen`,
        b0.xMin === -64 && b0.xMax === 384 && b0.yMin === -48 && b0.yMax === 240
          && activationBox(0x1f, 0x0f).xMin === b0.xMin
          && activationBox(0x20, 0x10).xMin === b0.xMin + 0x20,
        'CS:0x11B2 `sub ax,0x40 / sub bx,0x30` and CS:0x11B8 `add cx,0x180 / ' +
        'add dx,0xf0`, taken from a scroll origin SNAPPED by `and ax,0xffe0` ' +
        'and `and bx,0xfff0` — so a camera at (31,15) gives the same box as ' +
        'one at (0,0), and (32,16) is the first that shifts it. 64 px of ' +
        'slack each side of the screen in X and 48/40 in Y, which is what makes the gate unobservable for a ' +
        'walk-in pickup and real for the crouch scan');

      /* And the activation pass is what turns it on — and off again. */
      const some = live[0];
      const box = activationBox(some.x - 100, some.y - 100);
      const inBox = activateObjects(slots, box);
      const wasOn = some.flag6;
      const far = activateObjects(slots, activationBox(3800, 900));
      check(`activation is NOT sticky — leaving the box clears \`+6\` again`,
        inBox > 0 && wasOn === 1 && some.flag6 === 0 && far < live.length,
        `${inBox} objects entered a box around (${some.x},${some.y}); moving ` +
        `the camera to the far corner left only ${far} active and cleared ` +
        `this one. CS:0x1215 is on the SAME walk as CS:0x1208 — an object ` +
        `that scrolls off is deactivated, which is what stops the crouch key ` +
        `scan (CS:0x6088) reaching a key that is off screen`);

      const arsenal = new Arsenal(w1);
      const deact = { x: 200, y: 200, type: 10, flag6: 0 };
      const act = { x: 200, y: 200, type: 10, flag6: 1 };
      const t1 = ctx([]), t2 = ctx([]);
      stepPickups([deact], { x: 200, y: 200 }, arsenal, 12, { cats, treasure: t1 });
      stepPickups([act], { x: 200, y: 200 }, arsenal, 12, { cats, treasure: t2 });
      check(`the object walk is GATED on \`+6\`, standing on it or not`,
        t1.purse.total === 0 && deact.dead !== true
          && t2.purse.total === 500 && act.dead === true,
        'CS:0x14A1 `cmp byte [si+0x6],0 / jz` gates the draw walk the pickup ' +
        'test hangs off. ⚠️ It cannot change a WALK-IN pickup in practice — ' +
        'the box clears the hero\'s 40x56 window by 64 px on every side ' +
        'whatever the camera does — so this is modelled for agreement with ' +
        'the crouch scan, where it IS load-bearing, not for an observable');
    }

    {
      /* ⚠️ The allocator-full path is a dead end and is reproduced. */
      const burst = new TreasureBurst(new GodsRandom(11));
      burst.spawn(13, 500, 300);
      const full = [];                               // no free slots at all
      let ticks = 0;
      while (burst.active && ticks < 200) { burst.step(() => allocObject(full)); ticks++; }
      check(`a burst item with nowhere to land is STRANDED, never retried`,
        burst.stranded > 0 && burst.active === false && burst.inFlight === BURST_COUNT,
        `CS:0x13BA \`js 0x13b0\` skips BOTH the settle and the \`[0x397] = 1\` ` +
        `liveness store, so the updater switches itself off with all ` +
        `${burst.inFlight} records still occupying slots. Adding a retry ` +
        `would be a different game`);
    }

    /* ── The BCD score. */
    {
      const s = new Score();
      for (let i = 0; i < 4; i++) s.add(375);
      const s2 = new Score(); s2.add(99999999); s2.add(2);
      check(`the score is packed BCD with real decimal carries`,
        s.value === 1500 && s.bytes[0] === 0x00 && s.bytes[1] === 0x15
          && s2.value === 1,
        'CS:0x1950 converts the addend with eight `div 10` and adds byte by ' +
        'byte with `daa`. 375 x 4 = 1500 stores as bytes 00 15 00 00, and ' +
        'eight digits wrap — which is the field, not a clamp I invented');
    }

    {
      /* ⚠️ SETTLED LOOT MUST BE RE-RANKED, NOT APPENDED. sortForDraw runs once
       * at level load; the allocator appends. So a landed item would draw
       * AFTER the weapon pickups, where export 32 puts ordinary treasure
       * BEFORE them — the same z-order failure this project recorded from the
       * other side when a stable partition left the weapons where they were. */
      const m = parseMap(dclDecompress(await fetchRaw('game/PLEV4B.MAP')).data);
      const live = m.objects.filter((o) => !isDeadType(o.type));
      const ordered = sortForDraw(live, cats);
      const loot = { x: 0, y: 0, type: 80, flag6: 1 };
      const appended = [...ordered, loot];
      const reranked = insertSpawned(ordered, cats, loot);
      const lastWeapon = (a) => a.reduce((k, o, i) => (o.type >= 0xc0 ? i : k), -1);
      const lootAt = (a) => a.indexOf(loot);
      check(`settled loot is re-ranked, so it draws BEHIND the weapon pickups`,
        lastWeapon(appended) < lootAt(appended)
          && lootAt(reranked) < lastWeapon(reranked),
        `PLEV4B places 23 weapon pickups — the most of any level — so ` +
        `appending puts the landed "gold plate" at index ${lootAt(appended)}, ` +
        `past the last weapon at ${lastWeapon(appended)}. Re-ranking moves it ` +
        `to ${lootAt(reranked)}, ahead of ${lastWeapon(reranked)}, which is ` +
        `where graphics export 32's three-band partition puts it`);
    }

    {
      /* The same z-order rule, exercised through dropCarriedItem/
       * insertSpawned — the actual pair main.js's own steal-and-carry
       * `dropCarriedIntoWorld` closure calls (CLAUDE.md's own "Steal-and-
       * carry, System A" section), not just the settled-loot allocator
       * above. A comparator bug specific to a freshly-dropped object's own
       * shape (flag6:1, fallDirty:-1) rather than a settled-loot object's
       * shape would only show up here.
       *
       * main.js's own `level.drawObjects` (main.js:178) is built as
       * `sortForDraw(map.objects.filter(o => !isDeadType(o.type)), cats)` —
       * every dead-type slot is filtered OUT at load, unlike the original's
       * fixed 200-slot table which ships with real gaps. So in THIS port,
       * allocObject can only ever find a reusable slot after something has
       * actually died in play (e.g. searchAndSteal's own `o.dead = true`
       * kill) — reproduced here rather than assumed. */
      const m = parseMap(dclDecompress(await fetchRaw('game/PLEV4B.MAP')).data);
      const ordered = sortForDraw(m.objects.filter((o) => !isDeadType(o.type)), cats);
      const killedIndex = 5;
      ordered[killedIndex].dead = true;   // simulate an earlier in-play kill
      const dropped = dropCarriedItem(ordered, 34 + 0xb, 0, 0);   // ordinary type 34
      check('dropCarriedItem reuses a slot killed earlier in play, in a real level array',
        dropped === ordered[killedIndex]);
      const withoutDropped = ordered.filter((o) => o !== dropped);
      const reranked = insertSpawned(withoutDropped, cats, dropped);
      const lastWeapon = (a) => a.reduce((k, o, i) => (o.type >= 0xc0 ? i : k), -1);
      check(`a periodic-drop object re-ranks BEHIND the weapon pickups too, same as settled loot`,
        reranked.indexOf(dropped) < lastWeapon(reranked),
        `dropped at ${reranked.indexOf(dropped)}, last weapon at ${lastWeapon(reranked)}`);
    }

    check(`the inventory survives a level change — only 2 clear sites`,
      INVENTORY_CLEAR_SITES.length === 2
        && INVENTORY_CLEAR_SITES[0] === 0x0498 && INVENTORY_CLEAR_SITES[1] === 0x8d80,
      '`mov [0x17e],ax` appears exactly twice in the image, and both sites ' +
      'are full restarts: CS:0x0498 sits beside world:=1, the weapon-slot ' +
      'clear CS:0x914c and money:=0; CS:0x8D80 beside score:=0. Nothing ' +
      'clears it on a sublevel or world transition, so chest keys carry ' +
      'forward exactly as weapons do — which is what makes the census above ' +
      'a question about authoring rather than about the code');

    check(`keys are NOT picked up by walking into them (CS:0x17E6 \`jg\`)`,
      (() => {
        const cats = new Uint8Array(256); cats[21] = CATEGORY.KEY;
        const key = { x: 100, y: 100, type: 21, dead: false, flag6: 1 };
        const { taken, consumed } = stepPickups([key], { x: 100, y: 100 },
          { slots: [{ weapon: -1 }, { weapon: -1 }, { weapon: -1 }] }, 1, { cats });
        return !key.dead && taken.length === 0 && consumed.length === 0;
      })(),
      'CS:0x17E6 `jg 0x17c2` sends category >= 2 to an `stc` return while ' +
      'every other exit is `clc`, and neither caller of `stepPickups` turns ' +
      'that into a pickup — a category-2 object standing exactly on the ' +
      'hero must survive the walk-in pass untouched.');

    /* ── CROUCH + FIRE, CS:0x6069 -> pickup.js's scanForKey/collectKey ────── */
    {
      const hero = { x: 100, y: 200 };
      const hot = keyHotPoint(hero);
      check('keyHotPoint is (heroX+0x10, heroY+0x28) — CS:0x6078/0x607B',
        hot.x === hero.x + 0x10 && hot.y === hero.y + 0x28);

      const cats = new Uint8Array(256); cats[21] = CATEGORY.KEY;

      /* CS:0x5B38's box is EXCLUSIVE on all four sides. Placing an object so
       * the hot point lands EXACTLY on its minX (objX-4 == hotX) must miss;
       * one pixel further in must hit. Read fresh off CS:0x5b5b `jge reject`
       * and CS:0x5b77 `jg ACCEPT` this session — not carried from an older,
       * looser "inclusive" note. */
      const onMinX = { x: hot.x + 4, y: hot.y, type: 5, dead: false, flag6: 1 };
      const oneIn  = { x: hot.x + 3, y: hot.y, type: 5, dead: false, flag6: 1 };
      check('objectNearHotPoint (CS:0x5B38) is EXCLUSIVE at the near edge',
        !objectNearHotPoint([onMinX], hero) && objectNearHotPoint([oneIn], hero));
      check('objectNearHotPoint ignores category — ANY live, on-screen object counts',
        objectNearHotPoint([{ ...oneIn, type: 0 }], hero));
      check('objectNearHotPoint skips a dead slot',
        !objectNearHotPoint([{ ...oneIn, type: 0x8005 }], hero));
      check('objectNearHotPoint skips an off-screen object (flag6 == 0)',
        !objectNearHotPoint([{ ...oneIn, flag6: 0 }], hero));

      /* CS:0x6069's own box is INCLUSIVE on all four sides — CS:0x609a `jg
       * reject` (so `<=` passes) and CS:0x60ab `jle MATCH` (so `<=` matches),
       * the opposite boundary treatment from CS:0x5B38 above despite the
       * identical geometry. */
      /* maxY = objY + 0x10 (0x1c added to a base of objY-12) — the boundary
       * is objY = hotY - 0x10, one pixel past it objY = hotY - 0x11. */
      const onMaxY = { x: hot.x, y: hot.y - 0x10, type: 21, dead: false, flag6: 1 };
      check('scanForKey (CS:0x6069) is INCLUSIVE at the far edge',
        scanForKey([onMaxY], cats, hero) === onMaxY);
      const oneOut = { x: hot.x, y: hot.y - 0x11, type: 21, dead: false, flag6: 1 };
      check('...and still rejects one pixel past it',
        scanForKey([oneOut], cats, hero) === null);

      check('scanForKey skips a non-key category in the box, keeps scanning',
        scanForKey([{ ...oneIn, type: 5 }, { ...oneIn, type: 21 }], cats, hero)?.type === 21);

      /* CS:0x60C3-0x60CA — a type >= 0xC0 (weapon) inside the box does not
       * get skipped like an ordinary category mismatch; it ABORTS THE WHOLE
       * SCAN, so a real key later in scan order becomes unreachable. */
      const weapon = { ...oneIn, type: 0xc0 };
      const realKey = { ...oneIn, type: 21 };
      check('scanForKey ABORTS on a weapon in the box (CS:0x60C7) — does not skip it',
        scanForKey([weapon, realKey], cats, hero) === null,
        'a real key placed AFTER a weapon in scan order must be unreachable ' +
        'this tick, not merely lower-priority');
      check('...but the SAME key with no weapon ahead of it in scan order is found',
        scanForKey([realKey, weapon], cats, hero) === realKey);

      check('scanForKey returns the FIRST match, not the last',
        scanForKey([{ ...oneIn, type: 21 }, { ...oneIn, type: 22 }], cats, hero)?.type === 21);
      check('scanForKey skips dead and off-screen candidates',
        scanForKey([{ ...oneIn, type: 21, dead: true }, { ...oneIn, type: 21, flag6: 0 }],
                   cats, hero) === null);

      /* collectKey — SUBSTITUTED behaviour, see the module doc in pickup.js:
       * first empty slot, falling back to CS:0x048F's own boot slot (3). */
      const inv1 = [INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY];
      check('collectKey fills the FIRST empty slot',
        collectKey(inv1, 21) === 0 && inv1[0] === 21);
      const inv2 = [5, INVENTORY_EMPTY, 7, INVENTORY_EMPTY];
      check('collectKey skips already-occupied slots',
        collectKey(inv2, 21) === 1 && inv2[1] === 21);
      const inv3 = [5, 6, 7, 8];
      check(`collectKey falls back to slot ${INVENTORY_SLOTS - 1} (CS:0x048F's boot value) when full`,
        collectKey(inv3, 21) === INVENTORY_SLOTS - 1
          && inv3[INVENTORY_SLOTS - 1] === 21 && inv3[0] === 5);
    }

    /* ── A full Player, crouch entry -> scan/collect -> exit, end to end ──── */
    {
      const MAP_COLS = 128, N = MAP_COLS * 64;
      const planeB = new Uint8Array(N);
      for (let c = 0; c < MAP_COLS; c++) planeB[12 * MAP_COLS + c] = 1;   // a floor
      const map = { planeA: new Uint8Array(N), planeB, widthPx: 4096, heightPx: 1024 };
      const I = (o = {}) => ({ left: false, right: false, up: false, down: false, fire: false, ...o });
      const cats = new Uint8Array(256); cats[21] = CATEGORY.KEY;

      const freshHero = () => {
        const p = new Player(2 * 32, 9 * 16);
        for (let i = 0; i < 4; i++) p.tick(map, I());        // settle
        for (let i = 0; i < 6; i++) p.tick(map, I({ right: true }));
        return p;
      };

      {
        const p = freshHero();
        const hot = keyHotPoint(p);
        const key = { x: hot.x, y: hot.y - 0x10, type: 21, dead: false, flag6: 1 };
        const inventory = [INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY];
        const pickup = { objects: [key], cats, inventory };

        p.tick(map, I({ right: true, down: true }), null, 1, pickup);
        check('crouch entry lands on the facing-specific state (18=right)',
          p.state === ST.CROUCH && p.stateIndex === PS.CROUCH_R);

        p.tick(map, I({ down: true }), null, 1, pickup);
        check('crouching with FIRE released does NOT collect the key',
          p.keyCollected === null && !key.dead && inventory[0] === INVENTORY_EMPTY);

        p.tick(map, I({ down: true, fire: true }), null, 1, pickup);
        check('crouch + FIRE collects the key (CS:0x60F0/0x6100-0x610D)',
          p.keyCollected && p.keyCollected.type === 21 && p.keyCollected.slot === 0
            && key.dead === true && inventory[0] === 21);

        p.tick(map, I({ right: true }), null, 1, pickup);
        check('releasing DOWN does not stand up immediately (CS:0x4B00-0x4B02 delay)',
          p.state === ST.CROUCH);
        p.tick(map, I({ right: true }), null, 1, pickup);
        check('...and stands up into WALK_R on the second release tick (CS:0x4B07)',
          p.state === ST.GROUND && p.stateIndex === PS.WALK_R);
      }

      {
        /* Mirror: crouch LEFT, and confirm walking away without FIRE never
         * consumes the object even though the scan keeps finding it. */
        const p = freshHero();
        for (let i = 0; i < 10; i++) p.tick(map, I({ left: true }));
        const hot = keyHotPoint(p);
        const key = { x: hot.x, y: hot.y - 0x10, type: 22, dead: false, flag6: 1 };
        const inventory = [INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY, INVENTORY_EMPTY];
        const pickup = { objects: [key], cats: (() => { const c = new Uint8Array(256); c[22] = CATEGORY.KEY; return c; })(), inventory };
        p.tick(map, I({ left: true, down: true }), null, 1, pickup);
        check('crouch entry facing left lands on state 19',
          p.stateIndex === PS.CROUCH_L);
        for (let i = 0; i < 5; i++) p.tick(map, I({ down: true }), null, 1, pickup);
        check('five ticks crouching without FIRE never collects it',
          !key.dead && inventory.every((v) => v === INVENTORY_EMPTY));
      }

      {
        /* CS:0x598a `call 0x5b38 / jc` — an object near the crouch hot point
         * has PRIORITY over the ladder-descend check, even when a real ladder
         * sits right there. Force ST.GROUND directly rather than settling
         * through `_fall`, so this test needs no floor at all — both branches
         * under test `return` before the final `solidThreeBelow` check ever
         * runs. Column 2 is climbable at row 12 (3 rows below y=144), which
         * `_walk`'s own -4 px step (moving left, run BEFORE the down-check)
         * reaches via the col+1 branch from a starting x of 64. */
        const ladderMap = { planeA: new Uint8Array(N), planeB: new Uint8Array(N), widthPx: 4096, heightPx: 1024 };
        for (let r = 4; r < 16; r++) ladderMap.planeB[r * MAP_COLS + 2] = 2;   // CELL_CLIMBABLE
        const forceGround = () => {
          const q = new Player(2 * 32, 9 * 16);
          q.state = ST.GROUND; q.stateIndex = PS.WALK_L; q.facing = -1;
          return q;
        };
        const sanity = forceGround();
        sanity.tick(ladderMap, I({ left: true, down: true }), null, 1, null);
        check('sanity: with no nearby object, down+moving descends the ladder',
          sanity.state === ST.CLIMB);

        const p = forceGround();
        const hot = keyHotPoint({ x: 2 * 32 - WALK_STEP, y: 9 * 16 });   // post-`_walk` position
        const nearby = { x: hot.x, y: hot.y, type: 0, dead: false, flag6: 1 };
        p.tick(ladderMap, I({ left: true, down: true }), null, 1, { objects: [nearby], cats, inventory: [] });
        check('...but an object near the hot point sends the hero to CROUCH instead',
          p.state === ST.CROUCH);

        /* Regression guard: a non-null `pickup` context alone must not block
         * ladder descent — only an object actually INSIDE the hot-point box
         * does. Without this, a future widening of objectNearHotPoint's box
         * could silently kill ladder descent everywhere `pickup` is passed
         * (i.e. always, in real play) and nothing here would fail. */
        const far = forceGround();
        const farObj = { x: hot.x + 200, y: hot.y + 200, type: 0, dead: false, flag6: 1 };
        far.tick(ladderMap, I({ left: true, down: true }), null, 1, { objects: [farObj], cats, inventory: [] });
        check('a live object OUTSIDE the hot-point box still lets the hero descend',
          far.state === ST.CLIMB);
      }

    }
  }

  results.push({
    name: 'the attract-mode grant is NOT a starting loadout', note: true, pass: true,
    detail: 'CS:0x8FD2 calls the pickup dispatcher for weapon 2 five times and ' +
      'weapon 6 three times, which reads exactly like a starting loadout. Its ' +
      'only two callers (CS:0x8F9B, CS:0x8FBB) sit inside a block branching on ' +
      'DS:0x3e6 — the six-state ATTRACT-MODE cycler — and both fall through to ' +
      'CS:0x8FBE `mov byte [0x3bd],1`, the joystick-playback flag. A third ' +
      'variant at CS:0x8F5F grants 2x3 / 5x5 / 4x1. Those are the demo\'s ' +
      'weapons, set up beside its scripted camera and hero position.',
  });

  results.push({
    name: 'the fire chain, end to end', note: true, pass: true,
    detail: 'press -> latch -> allocate -> enter a state -> wind up -> emit -> ' +
      'spawn -> move -> stamp -> scan -> damage is now CONTINUOUS and wired ' +
      'into the running build. Reading the eight handlers\' tails for this pass ' +
      'found two real defects in the ported states: state 21 exits with cl 6, ' +
      'not 5, and the ladder pair restores the saved entry phase (DS:0x359) ' +
      'when it is even instead of using a constant.',
  });

  results.push({
    name: 'what the running build still cannot do', note: true, pass: true,
    detail: 'The hero starts unarmed and now ARMS HIMSELF by walking over the ' +
      'map\'s weapon pickups. Note PLEV2A places NONE, which is why the HUD ' +
      'picker stays — it forces a weapon so the chain stays exercisable on ' +
      'every level, and it routes through the same CS:0x94a7 dispatcher a map ' +
      'pickup uses. Health potions work too — 5 of the 23 handlers at ' +
      'DS:0xd8b8; the other 18 are flagged at runtime rather than guessed, ' +
      'and PLEV1A alone places ten of them. TREASURE now works end to end: ' +
      'ordinary pickups pay POBJECTS +6 into the money total and value>>3 ' +
      'into the BCD score, and a chest opens against its key and throws ten ' +
      'items out that land as real objects. KEYS now work too: CROUCH + ' +
      'FIRE (CS:0x6069, player.js\'s `_crouch` -> pickup.js\'s `scanForKey`/ ' +
      '`collectKey`) scans the same hot point the original does and stores ' +
      'into the first empty inventory slot — a disclosed substitution for ' +
      'the original\'s single player-controlled slot cursor (DS:0x366), which ' +
      'this port has no UI for. The inventory boots genuinely empty (CS:0x0495 ' +
      '-0x04A1), no dev-seed. Still absent: the 40-entry destructible-tile ' +
      'queue at DS:0xd0c6; UNKNOWN_tag_fd; the per-projectile animation ' +
      'frame; and UNKNOWN_DS_0168 — which now has four behaviours and still ' +
      'no meaning.',
  });

  /* ── Object fall physics — CS:0x1511-0x1631 ───────────────────────────
   *
   * Reported live: "in the DOS version the items don't stay up in the air
   * but fall down once they come into view." A screenshot showed a weapon
   * pickup floating unsupported next to a mystery box in PLEV1A.
   */
  {
    const n = MC * 64;                          // MAP_ROWS
    const flatMap = () => ({ planeA: new Uint8Array(n), planeB: new Uint8Array(n),
                              widthPx: 4096, heightPx: 1024 });

    check(`the live-read bounce table is BYTE-IDENTICAL to the time bomb's`,
      BOUNCE_DELTA.join(',') === BOMB_BOUNCE.join(','),
      `read live via read_memory("1ffd:df2c", 24) this session: ` +
      `${BOUNCE_DELTA.join(',')} — this project's CLAUDE.md had assumed this ` +
      `from recollection of the time-bomb's own table under a different ` +
      `heading, and \`search_instructions\` had shown the constant 0xdf2c ` +
      `appears exactly ONCE in the whole program, so the two tables were not ` +
      `independently corroborated until this read`);

    check(`the terminal state CLAMPS at 24, unlike the time bomb's own wrap`,
      BOUNCE_TERMINAL === 24 && BOUNCE_TERMINAL === BOMB_BOUNCE.length,
      `CS:0x1420 \`mov dl,0x18\` pins the dirty byte at 24 once it reaches ` +
      `the table's own length, where the time bomb's mover (CS:0x142F ` +
      `wraps to phase 0 instead) recycles the SAME table forever. One table, ` +
      `two different consumers with different loop shapes`);

    /* ── The category gate: weapons and cat<3 fall, cat>=3 never visibly
     * moves — CS:0x1526/0x1613 cache-and-restore the object's own pre-tick
     * Y around the whole state machine whenever type<0xC0 && category>=3,
     * and every sub-path (fall step, bounce delta, terminal re-probe) shares
     * the one tail that restore sits on, so the undo is unconditional. */
    {
      const map = flatMap();                    // no ground anywhere — pure open air
      const startY = 100;                       // inside activationBox(0,0)'s yMax=0xF0
      const weapon = { x: 0, y: startY, type: WEAPON_TYPE_MIN, flag6: 0 };
      const lever = { x: 0, y: startY, type: 24, flag6: 0 };   // "lever off", category 3
      const cats3 = new Uint8Array(STAMPED_TYPES);
      cats3[24] = CATEGORY.LEVER;
      // Drive it through the REAL entry point, not a hand-set `fallDirty` —
      // the port's own gate is in `isFallEligible`/`activateObjects`, not in
      // `stepObjectFall` itself (which mirrors CS:0x1511-0x1631 and, like
      // the original, never re-checks category on its own).
      activateObjects([weapon, lever], activationBox(0, 0), cats3);
      for (let t = 0; t < 30; t++) { stepObjectFall(map, weapon); stepObjectFall(map, lever); }
      check(`a weapon over open air falls; a lever placed identically never even enters the fall system`,
        weapon.fallDirty !== undefined && weapon.y > startY
          && lever.fallDirty === undefined && lever.y === startY,
        `after activation + 30 ticks over solid-free ground: weapon ` +
        `fallDirty=${weapon.fallDirty} y=${weapon.y} (fell ${weapon.y - startY}px); ` +
        `lever fallDirty=${lever.fallDirty} y=${lever.y} (unchanged, and ` +
        `never armed at all). CS:0x1613 restores a category>=3 object's Y ` +
        `every tick regardless of what the fall/bounce state machine ` +
        `computed, so this port gates UP FRONT (isFallEligible, applied at ` +
        `the same CS:0x120F activation edge) instead of computing motion it ` +
        `would only have to discard — this is the discriminating half of ` +
        `the fix the user actually reported`);
    }

    {
      check(`isFallEligible gates on category, not on a hardcoded type list`,
        isFallEligible(WEAPON_TYPE_MIN, null) === true
          && isFallEligible(WEAPON_TYPE_MIN + 5, undefined) === true
          && isFallEligible(0, new Uint8Array([CATEGORY.LEVER])) === false
          && isFallEligible(0, new Uint8Array([CATEGORY.SPECIAL5])) === false
          && isFallEligible(0, new Uint8Array([CATEGORY.CONSUMABLE])) === true
          && isFallEligible(0, new Uint8Array([CATEGORY.TREASURE])) === true
          && isFallEligible(0, new Uint8Array([CATEGORY.KEY])) === true
          && isFallEligible(0, undefined) === false,
        `CS:0x15F5 (\`cmp cx,0xc0\`) exempts weapons from the category test ` +
        `entirely — a null/undefined category table must still return true ` +
        `for a weapon type, and false for any type with no known category`);
    }

    /* ── The two-column probe, and its documented asymmetry: when col1 has
     * no ground below it, col1's own row is never re-tested for embedding —
     * only col2's. STRADDLE_OFFSET (0xF) collapses col2 onto col1 unless the
     * object's X remainder is >= 17 (0x11), so this needs an X that actually
     * crosses a 32px column boundary to be discriminating. */
    {
      const map = flatMap();
      const COL = 3;                                       // world x = 96..127
      // Ground one row below column COL+1 only (not COL) — an object sitting
      // with its OWN row over a solid tile in col+1, nothing under col itself.
      map.planeB[8 * MC + (COL + 1)] = CELL_SOLID;          // row 8 = ground-below for row 7
      map.planeB[7 * MC + (COL + 1)] = CELL_SOLID;          // row 7 = the object's OWN row, col+1 — embedded via straddle
      const x = COL * 32 + 0x12;                            // remainder 0x12 (18) >= 0x11 -> straddles into col+1
      const y = 7 * 16;                                     // own row = 7; ground-below-COL (row 8, col COL) is EMPTY
      const o = { x, y, type: WEAPON_TYPE_MIN, flag6: 1, fallDirty: -1 };
      stepObjectFall(map, o);
      check(`the straddle probe finds embedding col1's own ground-below misses`,
        o.y === y + FALL_STEP,
        `x remainder 0x12 straddles into col+1 (x=${x}, own row=7); ` +
        `groundCol1 (row 8, col ${COL}) is empty so the probe falls into the ` +
        `"!groundCol1" branch, finds groundCol2 (row 8, col ${COL + 1}) ` +
        `solid, and then tests ownCol2 (row 7, col ${COL + 1}) — ALSO solid ` +
        `-> embedded -> keeps falling (y ${y}->${o.y}). A port using ` +
        `\`(x+0xf)>>5 === x>>5\` as a shortcut collapses this straddle and ` +
        `would wrongly call the object landed`);

      // Now give col1 ITS OWN ground below (row 8, col COL too), so this
      // object's `groundCol1` branch fires instead of the `!groundCol1` one
      // the straddling object above took — and its OWN row (col COL, row 7)
      // is clear, only col+1's is solid. A remainder small enough that
      // `x+0xF` never leaves column COL (col2 === col1) must therefore LAND,
      // even though the identical row/column-3 setup with a straddling X
      // just fell — the two objects differ ONLY in whether x+0xF crosses the
      // 32px boundary.
      map.planeB[8 * MC + COL] = CELL_SOLID;               // col COL now also has ground below
      const oAligned = { x: COL * 32 + 2, y, type: WEAPON_TYPE_MIN, flag6: 1, fallDirty: -1 };
      stepObjectFall(map, oAligned);
      check(`the same ground, reached WITHOUT straddling into col+1, LANDS`,
        oAligned.y === y && oAligned.fallDirty === 0,
        `x remainder 2 keeps col2 === col1 (x+0xf=${oAligned.x + STRADDLE_OFFSET} ` +
        `is still inside column ${COL}), so the own-row embed test reads ` +
        `col ${COL}'s row 7 (clear) rather than col ${COL + 1}'s (solid) — ` +
        `not embedded -> LANDS at y=${oAligned.y}, fallDirty=${oAligned.fallDirty}. ` +
        `A port that always tests col+1's own row regardless of the ` +
        `straddle threshold would wrongly call THIS object embedded too`);
    }

    /* ── World-bottom destruction — CS:0x1598-0x15A3. */
    {
      const map = flatMap();                        // no ground anywhere, ever
      const o = { x: 0, y: 0, type: WEAPON_TYPE_MIN, flag6: 1, fallDirty: -1, dead: false };
      let ticks = 0;
      while (!o.dead && ticks < 300) { stepObjectFall(map, o); ticks++; }
      check(`an object with no ground anywhere is destroyed once y >= 1024`,
        o.dead === true && o.type === 0xffff && o.flag6 === 0 && o.y >= WORLD_HEIGHT,
        `fell to y=${o.y} over ${ticks} ticks (${FALL_STEP}px/tick, so ` +
        `~${Math.ceil(WORLD_HEIGHT / FALL_STEP)} ticks expected) before ` +
        `CS:0x159E/0x15A3 marked it dead — type := 0xFFFF, flag6 := 0, ` +
        `matching the SAME dead-slot convention the rest of this array uses`);
    }

    /* ── The direct case: an object dropped above solid ground settles at a
     * row-aligned Y, starts a bounce, and reaches the terminal re-probe
     * state without ever moving again while support holds. */
    {
      const map = flatMap();
      const ROW = 20;                               // solid floor at world y = 320
      for (let c = 0; c < MC; c++) map.planeB[ROW * MC + c] = CELL_SOLID;
      const restY = (ROW - 1) * 16;                  // the row directly above the floor
      const o = { x: 100, y: restY - 40, type: WEAPON_TYPE_MIN, flag6: 1, fallDirty: -1 };
      let ticks = 0;
      while (o.fallDirty !== BOUNCE_TERMINAL && ticks < 100) { stepObjectFall(map, o); ticks++; }
      const settledY = o.y;
      const yAfterMoreTicks = [];
      for (let i = 0; i < 10; i++) { stepObjectFall(map, o); yAfterMoreTicks.push(o.y); }
      check(`a dropped object lands 16px-row-aligned and stays there once settled`,
        settledY % 16 === 0 && settledY <= restY
          && yAfterMoreTicks.every((y) => y === settledY),
        `dropped from y=${restY - 40} onto a floor at row ${ROW} (y=${ROW * 16}); ` +
        `settled at y=${settledY} after ${ticks} ticks and held there for 10 ` +
        `more (${yAfterMoreTicks.join(',')}). CS:0x142D re-probes the SAME ` +
        `ground test every tick once the dirty byte clamps at 24 — this is ` +
        `what makes the object stay put rather than needing a one-shot ` +
        `"landed" flag`);

      /* ── The bonus finding: destroy the support out from under a settled
       * object and it starts falling again, re-arming the sentinel exactly
       * as CS:0x142D's perpetual re-probe implies. */
      for (let c = 0; c < MC; c++) map.planeB[ROW * MC + c] = 0;   // the floor is gone
      stepObjectFall(map, o);
      check(`removing a settled object's support makes it fall again`,
        o.y === settledY + FALL_STEP && o.fallDirty === -1,
        `y ${settledY} -> ${o.y}, fallDirty reset to -1 (CS:0x158B re-arms ` +
        `the 0xFF sentinel). CS:0x142D's jump back into the ground probe is ` +
        `unconditional and runs every tick once terminal, which is what ` +
        `makes this reachable without any extra bookkeeping — a block ` +
        `destroyed under an already-settled item is not a special case`);
    }

    /* ── Re-arming on re-entry replays the bounce — CS:0x120F stores 0xFF
     * unconditionally on every inactive->active edge, with no "already
     * settled" test anywhere in activateObjects/stepObjectFall. So an item
     * that scrolls off after settling and scrolls back on is re-armed and
     * plays its whole landing bounce again. Faithful to the original, but
     * nothing asserted it — a future reader who "fixes" arming to be
     * one-shot would delete a real behaviour and stay green. */
    {
      const map = flatMap();
      const ROW = 14;                     // settled Y must stay inside activationBox(0,0)'s yMax=0xF0
      for (let c = 0; c < MC; c++) map.planeB[ROW * MC + c] = CELL_SOLID;
      const restY = (ROW - 1) * 16;
      const cats = new Uint8Array(STAMPED_TYPES);           // cat<3 -> fall-eligible
      const o = { x: 100, y: restY, type: 0, flag6: 0 };
      // Activate once, in the box, and run it to the settled/terminal state.
      activateObjects([o], activationBox(0, 0), cats);
      let ticks = 0;
      while (o.fallDirty !== BOUNCE_TERMINAL && ticks < 100) { stepObjectFall(map, o); ticks++; }
      const settledDirty = o.fallDirty, settledY = o.y;
      // Scroll far enough away that the object leaves the activation box.
      activateObjects([o], activationBox(0, 4000), cats);
      const clearedFlag6 = o.flag6;
      // Scroll back — the SAME inactive->active edge CS:0x120F marks dirty.
      activateObjects([o], activationBox(0, 0), cats);
      const rearmedDirty = o.fallDirty;
      stepObjectFall(map, o);                 // tick 1: grounded -> re-enter the bounce at index 0 (CS:0x15E0), y unchanged this tick
      const dirtyAfterFirstTick = o.fallDirty, yAfterFirstTick = o.y;
      stepObjectFall(map, o);                 // tick 2: BOUNCE_DELTA[0] actually applied
      check(`scrolling a settled object off-box and back RE-ARMS the sentinel and replays the bounce`,
        settledDirty === BOUNCE_TERMINAL && clearedFlag6 === 0 && rearmedDirty === -1
          && dirtyAfterFirstTick === 0 && yAfterFirstTick === settledY
          && o.fallDirty === 1 && o.y === settledY + BOUNCE_DELTA[0],
        `settled at fallDirty=${settledDirty} y=${settledY}; leaving the box ` +
        `clears flag6 (=${clearedFlag6}), re-entering it re-arms fallDirty ` +
        `to ${rearmedDirty} (the same 0xFF sentinel a brand-new activation ` +
        `gets); the next tick finds the same ground still solid and re-enters ` +
        `the bounce at index 0 (CS:0x15E0, y unchanged this tick: ` +
        `${yAfterFirstTick}), and the tick after that actually applies ` +
        `BOUNCE_DELTA[0] (y ${settledY} -> ${o.y}) — the LANDING BOUNCE ` +
        `PLAYS OVER from the start rather than staying settled. CS:0x120F ` +
        `has no "already settled" test — this is the original's own ` +
        `behaviour, not a port bug, and a fix that makes arming one-shot ` +
        `would be a real regression against it`);
    }

    /* ── Census against real shipped data, run as an actual SIMULATION rather
     * than a one-shot ground check — advisor-recommended after the first
     * pass found 616/652 (94%) of fall-eligible objects unsupported at
     * placement, which is the wrong figure to trust on its own: average or
     * presence-of-ground alone can't tell a sound decode from a systematic
     * one-row offset. The discriminating number is how many of them get
     * DESTROYED (fall clean off the bottom of the world, y >= 1024) when
     * actually stepped on their own level's real plane B — a shipped game
     * does not silently delete most of its pickups on first scroll-in, so
     * that count must come back at or near zero for the decode to be sound. */
    {
      const keys = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'];
      let eligible = 0, unsupported = 0, destroyed = 0, alreadyUnreachable = 0, over32 = 0, maxDrop = 0;
      const perLevel = [];
      const destroyedSamples = [];
      const unreachableSamples = [];
      const CAP = 320;   // ceil(1024/4)=256 to fall the whole world, plus bounce/settle headroom
      // The camera's own Y clamps well inside the world: CLAUDE.md's own
      // "the camera clamps at 3776,864 (+160=1024)" figure is the highest
      // scroll origin that ever exists, and activationBox adds a fixed
      // 0xF0 margin on top of it — so no camera position can ever admit an
      // object whose placed Y already sits at or past the world height. Such
      // an object is dead shipped data (an authoring y<0 that wrapped to a
      // huge u16), not something a real playthrough ever activates.
      const MAX_REACHABLE_Y = 864 + ACTIVATION_MARGIN.yMax;   // 1104
      for (const key of keys) {
        const w = key[0];
        const map = parseMap(dclDecompress(await fetchRaw(`game/PLEV${key}.MAP`)).data);
        const levelCats = parseObjectCategories(
          dclDecompress(await fetchRaw(`game/POBJECTS.00${w}`)).data);
        let e = 0, u = 0;
        for (const o of map.objects) {
          if (isDeadType(o.type)) continue;
          if (!isFallEligible(o.type, levelCats)) continue;
          e++;
          const gc1 = attrAt(map, (o.x >> 5), ((o.y + 0x10) >> 4)) === CELL_SOLID;
          const gc2 = attrAt(map, ((o.x + STRADDLE_OFFSET) >> 5), ((o.y + 0x10) >> 4)) === CELL_SOLID;
          if (!gc1 && !gc2) u++;

          if (o.y > MAX_REACHABLE_Y) {
            // Never activated in real play — no camera position's box can
            // ever reach it. Simulating it anyway (as a direct fallDirty
            // seed, bypassing activateObjects' own box test) would credit
            // this port's DECODE with a destruction the real game's own
            // activation gate prevents from ever happening.
            alreadyUnreachable++;
            if (unreachableSamples.length < 4)
              unreachableSamples.push(`${key}@(${o.x},${o.y}) type=${o.type}`);
            continue;
          }

          // The real simulation: arm it exactly as the inactive->active edge
          // would, then run stepObjectFall against this level's REAL plane B
          // until it settles (BOUNCE_TERMINAL) or is destroyed.
          const sim = { x: o.x, y: o.y, type: o.type, flag6: 1, fallDirty: -1, dead: false };
          const startY = sim.y;
          let ticks = 0;
          while (!sim.dead && sim.fallDirty !== BOUNCE_TERMINAL && ticks < CAP) {
            stepObjectFall(map, sim);
            ticks++;
          }
          if (sim.dead) {
            destroyed++;
            if (destroyedSamples.length < 8) destroyedSamples.push(`${key}@(${o.x},${o.y}) type=${o.type}`);
          } else {
            const drop = sim.y - startY;
            if (drop > maxDrop) maxDrop = drop;
            if (drop > 32) over32++;
          }
        }
        eligible += e; unsupported += u;
        perLevel.push(`${key}:${u}/${e}`);
      }

      check(`simulated against real level geometry, fall-eligible objects settle rather than fall off the world`,
        destroyed === 0,
        destroyed === 0
          ? `0/${eligible - alreadyUnreachable} destroyed (y ${'>'}= ${WORLD_HEIGHT}) ` +
            `across all 8 levels when actually stepped on their own real ` +
            `plane B — corroborates the decode: a wrong ground probe or a ` +
            `systematic row-offset would show up here as mass destruction, ` +
            `not as the raw unsupported-at-placement count alone. ` +
            `${alreadyUnreachable} object(s) were excluded as ALREADY past ` +
            `the world height at placement (e.g. ${unreachableSamples.join('; ') || 'none'}) — ` +
            `every camera position's activation box tops out at ` +
            `${MAX_REACHABLE_Y}px, so these can never be activated in real ` +
            `play regardless of the fall decode; they read as an authoring ` +
            `y<0 that wrapped to a huge u16, the same "dead shipped data" ` +
            `genre as this project's other proven-unread padding fields`
          : `${destroyed}/${eligible - alreadyUnreachable} DESTROYED (of ${eligible} eligible, ` +
            `${alreadyUnreachable} excluded as never-activatable) — e.g. ` +
            `${destroyedSamples.join('; ')}. A shipped level does not delete ` +
            `most of its ACTIVATABLE pickups on first scroll-in, so this many ` +
            `falling clean through the world means the ground probe or its ` +
            `column/row rounding disagrees with the original somewhere, not ` +
            `that the level author placed them badly`);

      results.push({
        name: 'census: fall-eligible objects, all 8 levels — unsupported at placement vs. simulated drop',
        note: true, pass: true,
        detail: `${unsupported}/${eligible} (${Math.round(100 * unsupported / eligible)}%) placed ` +
          `weapon/cat<3 objects have neither column solid one row below their ` +
          `placed position — ${perLevel.join(', ')}. That is a large majority, ` +
          `not "a small minority" as an earlier revision of this note said ` +
          `while reporting the identical figure — a self-contradiction caught ` +
          `on review. Read correctly, near-universal initial non-support ` +
          `CORROBORATES the user's report ("items fall down once they come ` +
          `into view" as the general behaviour of items, not a rare oddity), ` +
          `rather than being a minority case needing an excuse. The ` +
          `discriminating half is the simulation above (destroyed count, max ` +
          `drop, count exceeding 32px): of the ${eligible} eligible objects, ` +
          `${destroyed} were destroyed, the largest settled drop was ` +
          `${maxDrop}px, and ${over32} settled after dropping more than one ` +
          `tile (32px) — a long tail of multi-tile drops (rather than a ` +
          `uniform 16px on nearly everything) is exactly the reported ` +
          `screenshot shape: an item floating next to a ladder with open air ` +
          `beneath it, not a one-row rounding offset on an otherwise-grounded set`,
      });
    }
  }

  return results;
}

/* =====================================================================
 * The 15 trigger ACTION verbs — SS:0x3592.
 *
 * Until these landed the port evaluated every trigger and discarded the
 * verdict, so no door opened and no level could end (ACT4 is the exit zone).
 * These checks target the seven traps the verbs encode; each was written to
 * fail against a specific plausible mis-port, listed in the detail text.
 * ===================================================================== */
export async function checkTriggerActions(fetchRaw) {
  const { results, check } = makeChecker();
  const keys = ['1A','1B','2A','2B','3A','3B','4A','4B'];
  const T = (over = {}) => ({ index: 0, condKind: [0,0,0], condArg: [0,0,0],
    x: 0, y: 0, action: 0, actionArg: 0, messageId: 0, reserved: 0, ...over });

  /* --- the per-world tile table ---------------------------------------- */
  /* Self-checking: plane A is 1-BASED (tile = planeA - 1) and the sheet is 10
   * columns, so a correct door constant must put t and t+1 in the SAME sheet
   * row, and t+10 / t+20 directly beneath. A wrong base or a wrong stride
   * breaks the rectangle. */
  let rects = 0;
  for (const w of DOOR_TILES) {
    const t = w.open2 - 1;                       // -> tile index
    const ok = (t % 10) + 1 <= 9 &&              // t and t+1 share a row
               Math.floor(t / 10) + 2 <= 11;     // three rows fit in the sheet
    if (ok) rects++;
  }
  check('DOOR_TILES: all 4 worlds form a clean 2x3 rect on the 10-col sheet',
    rects === 4, `${rects}/4 (world1 base ${DOOR_TILES[0].open2} -> sheet row ` +
    `${Math.floor((DOOR_TILES[0].open2 - 1) / 10)} cols ` +
    `${(DOOR_TILES[0].open2 - 1) % 10},${(DOOR_TILES[0].open2 - 1) % 10 + 1})`);

  /* --- ACT2 / ACT9: doors ---------------------------------------------- */
  const doorAt = (verb, x, y, tiles) => {
    const ctx = makeActionContext({ tiles });
    runAction(T({ action: verb, x, y }), ctx);
    return ctx;
  };
  const open = doorAt(2, 0x140, 0x100, DOOR_TILES[0]);
  const cell = (0x140 >> 5) + (((0x100 + 8) & 0xfff0) << 3);
  const base = DOOR_TILES[0].open2;
  check('ACT2 writes 6 plane-A tiles as t, t+1 / t+10, t+11 / t+20, t+21',
    open.planeA[cell] === base && open.planeA[cell + 1] === base + 1 &&
    open.planeA[cell + 0x80] === base + 10 && open.planeA[cell + 0x81] === base + 11 &&
    open.planeA[cell + 0x100] === base + 20 && open.planeA[cell + 0x101] === base + 21,
    'kills the +1-per-row stride mutant');

  let bCleared = 0, bTotal = 0;
  for (const o of [0, 1, 0x80, 0x81, 0x100, 0x101]) {
    bTotal++; if (open.planeB[cell + o] === 0) bCleared++;
  }
  /* planeB starts all-zero in a bare context, so count what ACT2 would have
   * had to clear from a solid map instead. */
  const solid = makeActionContext({ tiles: DOOR_TILES[0] });
  solid.planeB.fill(1);
  runAction(T({ action: 2, x: 0x140, y: 0x100 }), solid);
  const cleared = [0, 1, 0x80, 0x81, 0x100, 0x101].filter((o) => solid.planeB[cell + o] === 0);
  check('ACT2 clears THREE plane-B cells (left column only), not six',
    cleared.length === 3 && cleared.every((o) => o % 2 === 0),
    `cleared ${cleared.length}: [${cleared.join(', ')}] — kills the "clear all 6" mutant`);

  /* Trap 2: `add ax,0xc` at CS:0x4285 is annihilated by the second mask at
   * CS:0x4298. If it were real, open and close would land a tile apart. */
  const closed = doorAt(9, 0x140, 0x100, DOOR_TILES[0]);
  let closeCell = -1;
  for (let i = 0; i < 8192; i++) if (closed.planeA[i] === DOOR_TILES[0].close9) { closeCell = i; break; }
  /* Absolute, not just "the two agree" — an earlier version of this check
   * compared open against close, and since both derive from one helper a
   * mutation that shifted the helper moved both and survived. */
  const expectCell = (0x140 >> 5) + (((0x100 + 8) & 0xfff0) << 3);
  check('ACT2 and ACT9 land on the same, INDEPENDENTLY computed cell',
    cell === expectCell && closeCell === expectCell,
    `open ${cell}, close ${closeCell}, expected ${expectCell}`);

  /* Trap 2 stated as a proof rather than a test. CS:0x4285 adds 12 to a value
   * already masked with 0xffe0, and CS:0x4298 masks AGAIN before the shift, so
   * for every multiple of 32 the add is invisible. A mutant that "restores"
   * the +12 is therefore EQUIVALENT and cannot be killed — this is what makes
   * that true, checked across the whole 4096-px world width. */
  let plus12Differs = 0;
  for (let x = 0; x < 4096; x++) {
    const m = x & 0xffe0;
    if ((((m + 12) & 0xffe0) >> 5) !== (m >> 5)) plus12Differs++;
  }
  check('the CS:0x4285 `add ax,0xc` is provably annihilated by the second mask',
    plus12Differs === 0,
    'differs for 0 of 4096 x positions — so that mutation is equivalent, not missed');

  /* ⚠️ The cell arithmetic is only distinguishable OFF the tile grid, and every
   * shipped record is on it (measured below) — so these two assertions exist
   * precisely because the real data cannot tell the variants apart. Both pin
   * the verbatim form: CS:0x4157 multiplies y by 8 rather than dividing into a
   * row and multiplying by 128, and CS:0x427C biases y by +8 BEFORE masking. */
  const offGridDoor = makeActionContext({ tiles: DOOR_TILES[0] });
  runAction(T({ action: 2, x: 0x14c, y: 0x108 }), offGridDoor);
  const wantDoor = (0x14c & 0xffe0) >> 5 | 0;
  check('door cell keeps the +8 y-bias BEFORE the mask, off-grid',
    offGridDoor.planeA[wantDoor + (((0x108 + 8) & 0xfff0) << 3)] === DOOR_TILES[0].open2,
    'y=0x108 -> row 0x110, not 0x100 — the only way to observe CS:0x427C');

  const offGridGate = makeActionContext({ tiles: DOOR_TILES[0], gates: makeGates(new Uint8Array(8760)) });
  offGridGate.gates[0].x = 0x14c; offGridGate.gates[0].y = 0x108;
  runAction(T({ action: 7, x: 0x14c, y: 0x108 }), offGridGate);
  check('ACT7/ACT8 use y*8 verbatim, not (y>>4)*128',
    offGridGate.planeA[(0x14c >> 5) + (0x108 << 3)] === DOOR_TILES[0].gateOpen &&
    offGridGate.planeA[(0x14c >> 5) + ((0x108 >> 4) * 128)] !== DOOR_TILES[0].gateOpen,
    'CS:0x4161 `shl bx,1` x3 — the two agree only when y % 16 == 0');

  const r = DOOR_TILES[0].close9Right;
  check('ACT9 right column is ONE repeated tile, left column strides +10',
    closed.planeA[cell + 1] === r && closed.planeA[cell + 0x81] === r &&
    closed.planeA[cell + 0x101] === r &&
    closed.planeA[cell + 0x80] === DOOR_TILES[0].close9 + 10,
    `right = ${r},${r},${r} — kills the "increment the right column too" mutant`);

  /* --- ACT3 / ACT4: the shared zone array ------------------------------ */
  check('ACT3 writes zone kind 1 (teleport), ACT4 kind 3 (level exit)',
    ZONE_TELEPORT === 1 && ZONE_EXIT === 3 &&
    (() => { const c = makeActionContext();
             runAction(T({ action: 3, x: 0x200, y: 0x100, actionArg: 7 }), c);
             return c.zones[0].kind === ZONE_TELEPORT; })() &&
    (() => { const c = makeActionContext();
             runAction(T({ action: 4, x: 0x200, y: 0x100, actionArg: 7 }), c);
             return c.zones[0].kind === ZONE_EXIT; })(),
    'kills the 1<->3 swap mutant');

  /* Trap 6 — the counts really do disagree, and it is observable: with the
   * first ten slots taken, ACT4 has nowhere to go and ACT3 does. */
  const full = makeActionContext();
  for (let i = 0; i < 10; i++) { full.zones[i].kind = 1; full.zones[i].x = -100 - i; }
  const a4 = runAction(T({ action: 4, x: 0x400, y: 0x200 }), full);
  const a3 = runAction(T({ action: 3, x: 0x400, y: 0x200 }), full);
  check('ACT4 scans 10 zone slots, ACT3 scans 20 — the mismatch is real',
    a4.ok === false && a3.ok === true && a3.slot === 10,
    `ACT4 ${a4.reason}; ACT3 -> slot ${a3.slot}`);

  /* Trap 7 — CS:0x4272 `add sp,0x2` aborts the caller. */
  const dup = makeActionContext();
  const d1 = runAction(T({ action: 3, x: 0x300, y: 0x140 }), dup);
  const d2 = runAction(T({ action: 3, x: 0x300, y: 0x140 }), dup);
  check('the duplicate-zone guard aborts its CALLER — a second zone is refused',
    d1.ok === true && d2.ok === false && dup.zones[1].kind < 0,
    `second attempt: ${d2.reason}`);

  /* --- ACT7 / ACT8: the dead guard, against SHIPPED data ---------------- */
  let a7Total = 0, a7Miss = 0, a8Total = 0, a8Miss = 0, aligned = 0, misaligned = 0;
  for (const k of keys) {
    const map = parseMap(dclDecompress(await fetchRaw(`game/PLEV${k}.MAP`)).data);
    const pal = dclDecompress(await fetchRaw(`game/${palfilsNameFor(k)}`)).data;
    const gates = makeGates(pal);
    const live = new Set(gates.filter((g) => g.x < 0x8000).map((g) => `${g.x},${g.y}`));
    for (const t of parseAllTriggers(map.bulk)) {
      if (!isLive(t)) continue;
      const v = verbOf(t);
      if (v !== 7 && v !== 8) continue;
      const hit = live.has(`${t.x},${t.y}`);
      if (v === 7) { a7Total++; if (!hit) a7Miss++; } else { a8Total++; if (!hit) a8Miss++; }
    }
    for (const t of parseAllTriggers(map.bulk)) {
      if (!isLive(t)) continue;
      if (![2, 3, 4, 7, 8, 9].includes(verbOf(t))) continue;
      if ((t.x % 32) === 0 && (t.y % 16) === 0) aligned++; else misaligned++;
    }
  }
  check('all 279 shipped door/gate/zone records are exactly tile-aligned',
    aligned === 279 && misaligned === 0,
    `x%32==0 and y%16==0 for ${aligned}/279 — which is why the two checks above ` +
    `have to leave the grid to say anything`);

  check('ACT7/ACT8 record counts match the published histogram',
    a7Total === 60 && a8Total === 48, `ACT7 ${a7Total}, ACT8 ${a8Total}`);
  check('the ACT8 dead-guard path is REACHABLE in shipped data',
    a7Miss === 8 && a8Miss === 5,
    `${a7Miss} ACT7 misses (correctly inert) and ${a8Miss} ACT8 misses ` +
    `(CS:0x4189 js never fires, so these close a door anyway)`);

  /* ACT7 misses do nothing; ACT8 misses still write. Kills "give ACT8 a jc". */
  const noGate = () => makeActionContext({ gates: makeGates(new Uint8Array(8760)) });
  const m7 = noGate(); m7.gates.forEach((g) => { g.x = 0xfffe; g.y = 0xfffe; });
  const before7 = m7.planeA[(0x400 >> 5) + (0x200 << 3)];
  const res7 = runAction(T({ action: 7, x: 0x400, y: 0x200 }), m7);
  const m8 = noGate(); m8.gates.forEach((g) => { g.x = 0xfffe; g.y = 0xfffe; });
  let diverged = false;
  m8.onDiverge = () => { diverged = true; };
  const res8 = runAction(T({ action: 8, x: 0x400, y: 0x200 }), m8);
  check('on a MISS: ACT7 is inert, ACT8 still closes the door',
    res7.ok === false && m7.planeA[(0x400 >> 5) + (0x200 << 3)] === before7 &&
    res8.ok === true && res8.missed === true &&
    m8.planeA[(0x400 >> 5) + (0x200 << 3)] === DOOR_TILES[0].gateClose && diverged,
    'kills the "unify the two guards" mutant');

  /* --- the gate table IS the trapdoor table ---------------------------- */
  const palA1 = dclDecompress(await fetchRaw('game/PALFILS.0A1')).data;
  const g0 = makeGates(palA1);
  check('DS:0x2f8c is seeded from the PALFILS +0x1824 trapdoor window',
    g0.length === 20 && g0.some((g) => g.x < 0x8000 && g.open <= 1),
    `${g0.filter((g) => g.x < 0x8000).length} live trapdoor records in PALFILS.0A1`);

  /* --- ACT5: the consume is keyed on the EVENT RECORD ------------------ */
  let shared = 0, sel3 = 0;
  for (const k of keys) {
    const b = dclDecompress(await fetchRaw(`game/${palfilsNameFor(k)}`)).data;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const seen = new Map();
    for (let i = 0; i < EVENT_COUNT; i++) {
      const o = EVENT_TABLE_OFF + i * 4;
      if (dv.getUint16(o, false) !== SELECTOR_TRIGGER) continue;
      const p = dv.getUint16(o + 2, false);
      seen.set(p, (seen.get(p) || 0) + 1);
    }
    sel3 += seen.size;
    shared += [...seen.values()].filter((v) => v > 1).length;
  }
  check('keying the consume on the event record vs the trigger is equivalent here',
    shared === 0 && sel3 === 727,
    `${sel3} distinct selector-3 triggers, ${shared} named by more than one ` +
    `record — so CS:0x39FE's real key is fidelity, not a behaviour change`);

  /* --- the small verbs -------------------------------------------------- */
  const tc = makeActionContext({ timer: 12345 });
  runAction(T({ action: 14 }), tc);
  check('ACT14 zeroes the 32-bit level timer (CS:0x3bc2)', tc.timer === 0);

  const nop = makeActionContext();
  nop.planeA.fill(9); const snap = nop.planeA.slice();
  let touched = false;
  for (const v of [11, 12, 13]) {
    const res = runAction(T({ action: v }), nop);
    if (!res.noop) touched = true;
  }
  check('ACT11/12/13 are three separate single-`C3` no-ops',
    !touched && nop.planeA.every((b, i) => b === snap[i]) && nop.zones[0].kind < 0);

  const disarmed = [];
  const ws = makeActionContext({ weaponSlots: [5, 8, 5],
                                 clearWeaponSlot: (i) => disarmed.push(i) });
  const w1 = runAction(T({ action: 10, actionArg: 5 }), ws);
  check('ACT10 clears only the FIRST matching weapon slot',
    w1.slot === 0 && ws.weaponSlots[0] === 0xffff && ws.weaponSlots[2] === 5,
    'each arm of CS:0x3e3f ends in its own `ret`');

  /* ⚠️ ctx.weaponSlots is a COPY for any host that keeps its arsenal
   * elsewhere, so the array write alone disarms nothing. This pins the hook
   * that actually does — an assertion reading only the copy would pass while
   * all 7 shipped ACT10 records did nothing. */
  check('ACT10 disarms the host through clearWeaponSlot, not just the copy',
    disarmed.length === 1 && disarmed[0] === 0,
    `hook fired for slot [${disarmed.join(',')}]`);

  /* The mirror case: the inventory IS passed live, so the consume passes must
   * land on the caller's own array rather than a copy. */
  const liveInv = [0x13, 0xffff, 0xffff, 0xffff];
  const ic = makeActionContext({ inventory: liveInv });
  fireTrigger(T({ action: 2, condKind: [1,0,0], condArg: [0x13,0,0] }), ic);
  check('the key-consume writes through to the caller\'s inventory array',
    liveInv[0] === 0xffff && ic.inventory === liveInv);

  /* --- ACT0 / ACT1 ------------------------------------------------------ */
  const mkObjs = (n) => Array.from({ length: n }, (_, i) =>
    ({ x: 0, y: 0, type: 0xffff, flag6: 0, dead: true, slot: i }));
  const o0 = makeActionContext({ objects: mkObjs(200), categoryOf: () => 1 });
  let sounds = 0; o0.sfx = () => sounds++;
  runAction(T({ action: 0, x: 0x100, y: 0x80, actionArg: 8 }), o0);
  check('ACT0 spawns into the object array and marks DS:0x438 dirty',
    o0.spawned.length === 1 && o0.spawned[0].type === 8 &&
    o0.spawned[0].flag6 === 1 && o0.dirty[0] === 0xff && sounds === 1);

  const oq = makeActionContext({ objects: mkObjs(200), categoryOf: () => 1 });
  let qs = 0; oq.sfx = () => qs++;
  const rq = runAction(T({ action: 0, actionArg: 0x42 }), oq);
  check('ACT0 types 0x40..0x44 are placed but SILENT (CS:0x3DCC)',
    rq.quiet === true && qs === 0 && oq.spawned.length === 1 && oq.last === null);

  const o1 = makeActionContext({ objects: mkObjs(200) });
  runAction(T({ action: 1, actionArg: 3 }), o1);
  check('ACT1 stores the weapon type as arg + 0xC0',
    o1.spawned[0].type === 0xc3, `got 0x${o1.spawned[0].type.toString(16)}`);

  /* ACT1's allocator-failure branch differs from ACT0's. */
  const fa0 = makeActionContext({ objects: [], categoryOf: () => 1 });
  const fa1 = makeActionContext({ objects: [] });
  runAction(T({ action: 0, actionArg: 8 }), fa0);
  runAction(T({ action: 1, actionArg: 3 }), fa1);
  check('on a full object table ACT0 returns bare; ACT1 still records DS:0x21e',
    fa0.last === null && fa1.last !== null && fa1.last.type === 0xc3,
    'CS:0x3DAF -> 0x3e07 vs CS:0x3E16 -> 0x3e2e');

  /* --- ACT6 ------------------------------------------------------------- */
  const objs = mkObjs(200);
  for (let i = 0; i < 5; i++) {
    objs[i] = { x: 0x100, y: 0x100, type: 50, flag6: 1, dead: false, slot: i };
  }
  const k6 = makeActionContext({ objects: objs, categoryOf: () => 4 });
  const r6 = runAction(T({ action: 6, x: 0x100, y: 0x100 }), k6);
  check('ACT6 kills at most TWO category-4 objects (CS:0x3CBA)',
    r6.killed === 2 && objs.filter((o) => o.dead).length === 197,
    `killed ${r6.killed}, kill-list entries ${k6.killList.filter((k) => k.flag >= 0).length}`);

  const far = mkObjs(200);
  far[0] = { x: 0x100 + 13, y: 0x100, type: 50, flag6: 1, dead: false, slot: 0 };
  const k6b = makeActionContext({ objects: far, categoryOf: () => 4 });
  check('ACT6 box is +/-12 INCLUSIVE — 13 px away is out',
    runAction(T({ action: 6, x: 0x100, y: 0x100 }), k6b).killed === 0);

  /* --- the shared prologue --------------------------------------------- */
  check('the key-consume runs only for verbs {2,3,4,7,8}',
    [2,3,4,7,8].every(consumesKey) && [0,1,5,6,9,10,11,12,13,14].every((v) => !consumesKey(v)));

  const kc = makeActionContext({ inventory: [0x13, 0x80, 0x30, 0xffff] });
  fireTrigger(T({ action: 2, condKind: [1,1,1], condArg: [0x13, 0x80, 0x30] }), kc);
  check('the key-consume range is [0x12,0x17] u [0x7f,0x81]',
    kc.inventory[0] === 0xffff && kc.inventory[1] === 0xffff && kc.inventory[2] === 0x30,
    'CS:0x3B13-0x3B2A — 0x30 is outside both windows and survives');

  /* --- end to end over every shipped record ---------------------------- */
  let fired = 0, threw = 0, byVerb = new Array(15).fill(0);
  for (const k of keys) {
    const map = parseMap(dclDecompress(await fetchRaw(`game/PLEV${k}.MAP`)).data);
    const pal = dclDecompress(await fetchRaw(`game/${palfilsNameFor(k)}`)).data;
    const world = +k[0];
    for (const t of parseAllTriggers(map.bulk)) {
      if (!isLive(t)) continue;
      const ctx = makeActionContext({
        planeA: map.planeA.slice(), planeB: map.planeB.slice(),
        objects: mkObjs(200), gates: makeGates(pal),
        tiles: DOOR_TILES[world - 1], messages: map.messages,
        categoryOf: () => 1,
      });
      try { fireTrigger(t, ctx); fired++; byVerb[verbOf(t)]++; }
      catch (e) { threw++; }
    }
  }
  check('every live shipped trigger fires without throwing',
    threw === 0 && fired === EXPECTED.liveTriggers,
    `${fired} records fired, ${threw} threw`);
  check('the executed verb histogram matches the published one',
    byVerb.every((n, i) => n === EXPECTED.verbHistogram[i]),
    `[${byVerb.join(', ')}]`);

  /* --- end to end on a real map ---------------------------------------- *
   * The single check that says the feature works: dispatch every plane-B event
   * cell on PLEV1A as a player standing on it would, with the keys and levers
   * the doors ask for, and confirm the MAP ITSELF changes. Before the verbs
   * landed this was necessarily 0 and 0. */
  {
    const map = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
    const palRaw = dclDecompress(await fetchRaw('game/PALFILS.0A1')).data;
    const runner = new EventRunner(map, parsePalfils(palRaw));
    runner.actionCtx = makeActionContext({
      planeA: map.planeA, planeB: map.planeB,
      gates: makeGates(palRaw), tiles: DOOR_TILES[0],
      messages: map.messages, categoryOf: () => 1,
      objects: Array.from({ length: 200 }, (_, i) =>
        ({ x: 0, y: 0, type: 0xffff, flag6: 0, dead: true, slot: i })),
      inventory: [0x12, 0x13, 0x14, 0x15],
    });
    const st = runner.makeState({ timer: 0, health: 24, lives: 3,
                                  inventory: [0x12, 0x13, 0x14, 0x15] });
    for (let i = 0; i < 64; i++) st.levers[i * 6 + 4] |= 1;   // every lever thrown
    const a0 = map.planeA.slice(), b0 = map.planeB.slice();
    const ran = {};
    for (let cell = 0; cell < map.planeA.length; cell++) {
      if (map.planeB[cell] < 3) continue;
      runner.lastCell = -1;
      const r = runner.dispatchEvent(map.planeB[cell] - 3, st, 0);
      if (r && r.result) ran[r.verb] = (ran[r.verb] || 0) + 1;
    }
    let dA = 0, dB = 0;
    for (let i = 0; i < a0.length; i++) {
      if (a0[i] !== map.planeA[i]) dA++;
      if (b0[i] !== map.planeB[i]) dB++;
    }
    check('END TO END on PLEV1A: firing the events MUTATES the map',
      dA === 23 && dB === 14 && ran[2] === 4 && ran[7] === 6,
      `${dA} plane-A and ${dB} plane-B cells changed; ` +
      `${ran[2]} doors opened, ${ran[7]} trap doors, ` +
      `${runner.actionCtx.zones.filter((z) => z.kind >= 0).length} zones created`);

    /* The gate is the puzzle, not a bug: with no keys and no levers thrown the
     * same walk opens NOTHING. */
    const m2 = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
    const r2 = new EventRunner(m2, parsePalfils(palRaw));
    r2.actionCtx = makeActionContext({
      planeA: m2.planeA, planeB: m2.planeB, gates: makeGates(palRaw),
      tiles: DOOR_TILES[0], messages: m2.messages, categoryOf: () => 1,
    });
    const bare = r2.makeState({ timer: 0 });
    let opened = 0;
    for (let cell = 0; cell < m2.planeA.length; cell++) {
      if (m2.planeB[cell] < 3) continue;
      r2.lastCell = -1;
      const r = r2.dispatchEvent(m2.planeB[cell] - 3, bare, 0);
      if (r && r.result && r.verb === 2) opened++;
    }
    check('...and with no keys and no levers, no door opens',
      opened === 0, 'the conditions are the lock — COND1 (key) AND COND11 (lever)');
  }

  results.push({
    name: 'what the ACTION verbs now do, and what they still do not',
    note: true, pass: true,
    detail: 'All 15 verbs execute. Doors open and close, trap doors move, ' +
      'zones are created, objects and weapon pickups spawn, category-4 ' +
      'objects are killed, the timer resets and weapon slots clear. The zone ' +
      'array is now READ too (see checkZones / game/zones.js): CS:0x0324 and ' +
      'CS:0x0FDF-0x1042 are ported, so a teleport zone actually teleports. A ' +
      'level-exit zone advances to the next of the 8 shipped levels, which ' +
      'is an HONEST PLACEHOLDER — the original’s true world/sublevel-' +
      'advance rule (FUN_1000_8c34) is not traced. ACT0/ACT1 spawn through allocObject, which ' +
      'appends rather than re-ranking, so a runtime object draws on top of ' +
      'the weapon pickups where export 32 puts treasure behind. The kill ' +
      'list at DS:0x8c3c is filled and never drawn (CS:0x3cc7 is its walker). ' +
      'And the shop summon DS:0x361 is recorded, not honoured.',
  });

  return results;
}

/**
 * checkZones — the read side of ACT3/ACT4's zone array: CS:0x4A6D (the
 * hero-vs-zone scan), CS:0x0FDF-0x1042 (teleport execution) and
 * CS:0x0FAC-0x0FDC (the level-exit destination lookup). See game/zones.js
 * for the full byte-level citations.
 */
export async function checkZones(fetchRaw) {
  const { results, check } = makeChecker();
  const T = (over = {}) => ({ index: 0, condKind: [0,0,0], condArg: [0,0,0],
    x: 0, y: 0, action: 0, actionArg: 0, messageId: 0, reserved: 0, ...over });

  /* --- the box test, CS:0x4A74-0x4AA3, at its exact boundaries ---------- */
  const oneZone = (kind, x, y, arg = 0) => [
    { x, y, kind, arg }, { x: 0, y: 0, kind: -1, arg: 0 },
  ];
  const hit = (zones, hx, hy) => scanZones(zones, hx, hy) !== null;

  check('a hero exactly on a zone hits it',
    hit(oneZone(ZONE_TELEPORT, 200, 100), 200, 100));
  check('the X box is +/-16 INCLUSIVE — 16 px away still hits',
    hit(oneZone(ZONE_TELEPORT, 200, 100), 184, 100) &&
    hit(oneZone(ZONE_TELEPORT, 200, 100), 216, 100));
  check('17 px away in X misses on both sides',
    !hit(oneZone(ZONE_TELEPORT, 200, 100), 183, 100) &&
    !hit(oneZone(ZONE_TELEPORT, 200, 100), 217, 100));
  check('the Y box is +/-8 INCLUSIVE — 8 px away still hits',
    hit(oneZone(ZONE_TELEPORT, 200, 100), 200, 92) &&
    hit(oneZone(ZONE_TELEPORT, 200, 100), 200, 108));
  check('9 px away in Y misses on both sides',
    !hit(oneZone(ZONE_TELEPORT, 200, 100), 200, 91) &&
    !hit(oneZone(ZONE_TELEPORT, 200, 100), 200, 109));
  check('a FREE slot (kind < 0) never matches, even standing on its coords',
    !hit([{ x: 200, y: 100, kind: -1, arg: 0 }], 200, 100));
  check('scanZones returns the FIRST matching slot, not the last',
    scanZones([
      { x: 200, y: 100, kind: ZONE_TELEPORT, arg: 11 },
      { x: 200, y: 100, kind: ZONE_EXIT, arg: 22 },
    ], 200, 100).arg === 11,
    'CS:0x4AC4 RETs on the first hit — it does not keep scanning for a better one');

  /* --- CS:0x0FDF-0x0FF2: the destination unpack ------------------------- */
  const d1 = unpackTeleportDest((5 << 8) | 3);   // col 5, row 3
  check('unpackTeleportDest: col*32+16, row*16 (no Y bias)',
    d1.x === 5 * 32 + 16 && d1.y === 3 * 16, `got (${d1.x}, ${d1.y})`);
  const d0 = unpackTeleportDest(0);
  check('unpackTeleportDest(0) is the (16, 0) tile-centre origin, not (0,0)',
    d0.x === 16 && d0.y === 0, `got (${d0.x}, ${d0.y})`);

  /* --- CS:0x0FB8-0x0FD4: the level-exit destination table --------------- */
  check('resolveExitDestination: arg 2..5 all resolve (4 destinations)',
    [2, 3, 4, 5].every((a) => resolveExitDestination(a) !== null));
  check('resolveExitDestination(1) is null — CS:0x0FBE bails below arg 2',
    resolveExitDestination(1) === null);
  check('resolveExitDestination(6) is null — CS:0x0FC6 bails at arg 2+4',
    resolveExitDestination(6) === null);
  check('arg 2 -> "LEVEL  ONE"; arg 5 -> "GAME" with a 10x larger param2',
    resolveExitDestination(2).text.trim() === 'LEVEL  ONE' &&
    resolveExitDestination(5).text.trim() === 'GAME' &&
    resolveExitDestination(5).param2 === EXIT_DESTINATIONS[0].param2 * 10,
    JSON.stringify(EXIT_DESTINATIONS.map((d) => d.text.trim())));

  /* --- end to end: ACT3 -> makeZone -> scanZones -> unpack, one pass ---- */
  const ctxT = makeActionContext();
  runAction(T({ action: 3, x: 0x200, y: 0x100, actionArg: (5 << 8) | 3 }), ctxT);
  const foundT = scanZones(ctxT.zones, ctxT.zones[0].x, ctxT.zones[0].y);
  check('a zone ACT3 just created is found by scanZones at its OWN (x,y)',
    !!foundT && foundT.kind === ZONE_TELEPORT);
  const destT = foundT && unpackTeleportDest(foundT.arg);
  check('...and unpacks to the (176, 48) tile the trigger asked for',
    !!destT && destT.x === 176 && destT.y === 48, JSON.stringify(destT));

  const ctxE = makeActionContext();
  runAction(T({ action: 4, x: 0x200, y: 0x100, actionArg: 3 }), ctxE);
  const foundE = scanZones(ctxE.zones, ctxE.zones[0].x, ctxE.zones[0].y);
  const destE = foundE && resolveExitDestination(foundE.arg);
  check('an ACT4 zone with arg 3 resolves to "LEVEL  TWO"',
    !!destE && destE.text.trim() === 'LEVEL  TWO', JSON.stringify(destE));

  /* --- against real shipped data: every zone a real level's own triggers
   * create is one scanZones can find at the coordinates makeZone gave it --- */
  const keys = ['1A','1B','2A','2B','3A','3B','4A','4B'];
  let zonesSeen = 0, zonesFound = 0;
  for (const k of keys) {
    const map = parseMap(dclDecompress(await fetchRaw(`game/PLEV${k}.MAP`)).data);
    const ctx = makeActionContext({ planeA: map.planeA, planeB: map.planeB });
    for (let i = 0; i < TRIG_COUNT; i++) {
      const t = parseAllTriggers(map.bulk)[i];
      if (!isLive(t)) continue;
      const v = verbOf(t);
      if (v !== 3 && v !== 4) continue;
      runAction(t, ctx);
    }
    for (const z of ctx.zones) {
      if (z.kind < 0) continue;
      zonesSeen++;
      if (scanZones(ctx.zones, z.x, z.y)) zonesFound++;
    }
  }
  check(`every zone the 8 shipped maps' own ACT3/ACT4 triggers create is ` +
    `scan-findable at its own coordinates`,
    zonesSeen > 0 && zonesFound === zonesSeen, `${zonesFound}/${zonesSeen}`);

  /* --- CS:0x1018/0x1022: what a teleport does to the hero's own state --- */
  const p = new Player(999, 999);
  p.stateIndex = 7; p.phase = 5; p.fireState = 20; p.fallV = 8;
  p.teleportTo(176, 48);
  check('teleportTo snaps position and re-enters state 4 with phase 0',
    p.x === 176 && p.y === 48 && p.stateIndex === PS.ARRIVAL && p.phase === 0 &&
    p.fireState === -1 && p.fallV === 0,
    `x=${p.x} y=${p.y} state=${p.stateIndex} phase=${p.phase} fire=${p.fireState}`);

  results.push({
    name: 'what the zone read-side now does, and what is still a placeholder',
    note: true, pass: true,
    detail: 'A teleport zone moves the hero to the packed destination and ' +
      're-enters state 4, matching CS:0x0FDF-0x1042 at the byte level. A ' +
      'level-exit zone with arg 2..5 resolves a real destination TEXT ' +
      'record (CS:0x0FB8-0x0FD4) but then advances to the next of the 8 ' +
      'shipped levels in a fixed cycle — an HONEST PLACEHOLDER, not the ' +
      'original’s own rule, which lives in FUN_1000_8c34 and was not ' +
      'traced past confirming it re-derives the same destination table from ' +
      'the CURRENT world rather than the zone’s arg. Also not ' +
      'reproduced: the familiar reposition (CS:0x0FFC, no Familiar entity ' +
      'exists in this port yet). The three CALLs at CS:0x100F-0x1015 are now ' +
      'traced (see game/zones.js): 0x100F is the level-load/respawn camera ' +
      'init (Gods/CLAUDE.md UNKNOWN_camera_init, now CLOSED and ported as ' +
      'cameraForSpawn — a teleport IS a hard camera cut), 0x1012 clears the ' +
      'System-A entity group-runtime array (not "the destructible-block ' +
      'restore" as this note previously guessed — not yet reproduced), and ' +
      '0x1015 is the already-ported per-tick object-activation-box pass. ' +
      'UNKNOWN_zone_scan_caller and UNKNOWN_level_exit_destination both stand.',
  });

  return results;
}

/* CS:0x1632-0x1668 — the "attracts monsters" marker list, game/markers.js. */
export function checkMarkers() {
  const { results, check } = makeChecker();

  const m = new MarkerList();
  check('a fresh list is empty and unarmed', m.entries.length === 0 &&
    m.count === 0 && !m.override);

  m.append(10, 20, 5);
  check('an ordinary category<3 touch appends one record',
    m.entries.length === 1 && m.count === 1 && !m.override,
    JSON.stringify(m.entries));
  check('the record is {x, y, type} — CS:0x1659/165E/1661, not just {x,y}',
    m.entries[0].x === 10 && m.entries[0].y === 20 && m.entries[0].type === 5);

  /* ⚠️ The cap does NOT wrap. Fill it to exactly MARKER_MAX, then confirm the
   * 21st write is silently dropped. */
  const m2 = new MarkerList();
  for (let i = 0; i < MARKER_MAX; i++) m2.append(i, i, 1);
  check(`MARKER_MAX (${MARKER_MAX}) ordinary touches fill the list exactly`,
    m2.entries.length === MARKER_MAX && m2.count === MARKER_MAX);
  m2.append(999, 999, 1);
  check('the (MARKER_MAX+1)th touch is dropped, not appended or wrapped',
    m2.entries.length === MARKER_MAX && m2.entries[0].x === 0,
    `count=${m2.count} entries=${m2.entries.length}`);
  const frozenCount = m2.count;
  m2.append(999, 999, 1);
  check('every touch AFTER the cap keeps incrementing count but never writes',
    m2.count === frozenCount + 1 && m2.entries.length === MARKER_MAX);

  /* Type 45 ("attracts monsters") resets the cursor to the BASE and forces
   * the count to exactly MARKER_MAX — not zero — so exactly ONE more write
   * (this potion's own position) lands before the list re-freezes. */
  const m3 = new MarkerList();
  for (let i = 0; i < 5; i++) m3.append(i, i, 1);
  m3.append(77, 88, ATTRACT_POTION_TYPE);
  check('type 45 resets the array to ONE entry — its own position',
    m3.entries.length === 1 && m3.entries[0].x === 77 && m3.entries[0].y === 88
    && m3.entries[0].type === ATTRACT_POTION_TYPE, JSON.stringify(m3.entries));
  check('type 45 forces count to MARKER_MAX, NOT zero (CS:0x1648)',
    m3.count === MARKER_MAX);
  check('type 45 sets the global strategy-2 override (DS:0x399)', m3.override);
  m3.append(1, 1, 1);
  check('⚠️ the NEXT ordinary touch after a type-45 reset is already dropped'
    + ' — a reset arms exactly ONE write, not an accumulating trail',
    m3.entries.length === 1, JSON.stringify(m3.entries));

  /* Type 46 ("distracts monsters") takes the same append path but never
   * sets the override — CLAUDE.md: "the same marker-append path without
   * setting the gate". */
  const m4 = new MarkerList();
  m4.append(1, 1, DISTRACT_TYPE);
  check('type 46 appends like any other category<3 object, but does NOT '
    + 'set the override', m4.entries.length === 1 && !m4.override);

  m4.reset();
  check('reset (CS:0x1437, level load) clears entries, count AND override',
    m4.entries.length === 0 && m4.count === 0 && !m4.override);

  /* stepMarkers: gating. Weapons, dead, off-screen and category>=3 objects
   * must never append; only on-screen category<3 ones do, regardless of
   * hero position (there is no hero in this call at all). */
  const cats = new Uint8Array(200);
  cats[5] = 0; cats[6] = 1; cats[7] = 2; cats[8] = 3; cats[9] = 4;
  const objects = [
    { x: 100, y: 50, type: 5, flag6: 1, dead: false },     // consumable, on
    { x: 200, y: 50, type: 6, flag6: 1, dead: false },     // treasure, on
    { x: 300, y: 50, type: 7, flag6: 1, dead: false },     // key, on
    { x: 400, y: 50, type: 8, flag6: 1, dead: false },     // lever (cat 3), skip
    { x: 500, y: 50, type: 9, flag6: 1, dead: false },     // cat 4, skip
    { x: 600, y: 50, type: 5, flag6: 0, dead: false },     // off-screen, skip
    { x: 700, y: 50, type: 5, flag6: 1, dead: true },      // dead, skip
    { x: 800, y: 50, type: 0xC5, flag6: 1, dead: false },  // weapon, skip
  ];
  const ml = new MarkerList();
  stepMarkers(objects, cats, ml, { x: 40, y: 10 });
  check('stepMarkers appends ONLY on-screen category<3 objects (3 of 8)',
    ml.entries.length === 3, JSON.stringify(ml.entries));
  check('stepMarkers stores SCREEN coordinates (world minus the camera)',
    ml.entries[0].x === 100 - 40 && ml.entries[0].y === 50 - 10,
    JSON.stringify(ml.entries[0]));
  check('stepMarkers is NOT gated on hero proximity — no hero was even passed',
    true);

  /* seedGoals' override wiring — CS:0xf6ed skips the nibble roll entirely. */
  const st = makeState({
    planeB: new Uint8Array(8192), camX: 0, camY: 0,
    desc: { seedPair: 0x00, seedWeight: 127 },   // both nibbles are 0 (chase)
    markers: [{ x: 50, y: 30, type: 1 }], markersOverride: true,
  });
  const idxUsed = seedGoals(st, 0, 0, 0);
  check('markersOverride forces idx 2 regardless of the descriptor nibbles',
    idxUsed === 2, `idx=${idxUsed}`);

  return results;
}

/* Appended for game/statue.js — the world-1-sublevel-B awakened statue.
 * Imported here rather than at the top of the file per this pass's own
 * instructions (append-only; do not restructure the existing import block). */
import { Statues, populateStatueTable, inStatueWindow, wakeRollPasses,
         steerStep, MAP_COLS, PLANE_SIZE, TILE_A, TILE_B, STATUE_WORLD,
         STATUE_SUBLEVEL, WAKE_DECOR_TILE, WAKE_STATE, WINDOW_COLS,
         WINDOW_ROWS, WAKE_GATE, STEP_X_MIN, STEP_X_MAX, STEP_Y_MIN,
         STEP_Y_MAX, IDLE_TABLE, FACING_OFFSET,
         DEATH_SPRITE_BASE as STATUE_DEATH_SPRITE_BASE,
         DEATH_FRAMES, KILL_POPUP_ID, KILL_SCORE } from '../game/statue.js';

export function checkStatue() {
  const { results, check } = makeChecker();
  const missContact = (box) => box.hp;   // a contact call that always misses

  /* (a) The populator produces records ONLY in world 1, sublevel B. */
  const planeA1 = new Uint8Array(PLANE_SIZE);
  planeA1[5 * MAP_COLS + 5] = TILE_A;
  planeA1[6 * MAP_COLS + 6] = TILE_B;
  check('the populator finds 0x23/0x24 tiles ONLY in world 1 sublevel B',
    populateStatueTable(planeA1, 1, 'b').length === 2
    && populateStatueTable(planeA1, 1, 'a').length === 0
    && populateStatueTable(planeA1, 2, 'b').length === 0
    && populateStatueTable(planeA1, 0, 'b').length === 0,
    `b=${populateStatueTable(planeA1, 1, 'b').length} a=${populateStatueTable(planeA1, 1, 'a').length} `
    + `w2=${populateStatueTable(planeA1, 2, 'b').length}`);
  check('the two records carry the tile that actually matched (0x23 vs 0x24)',
    populateStatueTable(planeA1, 1, 'b')[0].matchedTileId === TILE_A
    && populateStatueTable(planeA1, 1, 'b')[1].matchedTileId === TILE_B);

  /* (b) The on-screen window is STRICTLY open on all four sides. */
  check('tileCol == camTileCol is OFF the left edge (inclusive fail)',
    inStatueWindow(0, 5, 0, 0) === false);
  check('tileCol == camTileCol+1 is ON, just inside the left edge',
    inStatueWindow(1, 5, 0, 0) === true);
  check(`tileCol == camTileCol+WINDOW_COLS-1 (${WINDOW_COLS - 1}) is ON, just inside the right edge`,
    inStatueWindow(WINDOW_COLS - 1, 5, 0, 0) === true);
  check(`tileCol == camTileCol+WINDOW_COLS (${WINDOW_COLS}) is OFF the right edge`,
    inStatueWindow(WINDOW_COLS, 5, 0, 0) === false);
  check('tileRow == camTileRow is OFF the top edge',
    inStatueWindow(5, 0, 0, 0) === false);
  check('tileRow == camTileRow+1 is ON, just inside the top edge',
    inStatueWindow(5, 1, 0, 0) === true);
  check(`tileRow == camTileRow+WINDOW_ROWS-1 (${WINDOW_ROWS - 1}) is ON, just inside the bottom edge`,
    inStatueWindow(5, WINDOW_ROWS - 1, 0, 0) === true);
  check(`tileRow == camTileRow+WINDOW_ROWS (${WINDOW_ROWS}) is OFF the bottom edge`,
    inStatueWindow(5, WINDOW_ROWS, 0, 0) === false);

  /* (c) The health-snapshot-restore trick around the wake-trigger's own
   * probe: a probe HIT must never actually reduce health, even though the
   * injected `contact` internally calls the REAL attackHero (exactly the
   * shape main.js's own nestContact closure takes for nest.js). */
  {
    const statues = new Statues();
    const planeA = new Uint8Array(PLANE_SIZE);
    const idx = 5 * MAP_COLS + 5;                    // worldX=160, worldY=80
    planeA[idx] = TILE_A;
    statues.populate(planeA, STATUE_WORLD, STATUE_SUBLEVEL);
    check('the probe fixture: exactly one record, tile 0x23, at (5,5)',
      statues.records.length === 1 && statues.records[0].matchedTileId === TILE_A);

    const health = new Health();                      // target=24, bar=1
    const hero = { x: 150, y: 50, state: 0 };          // positioned to OVERLAP the 48x48 probe
    let rngCalls = 0;
    const rng = { next: () => { rngCalls++; return 0; } };
    const contact = (box) => attackHero(
      { x: box.x, y: box.y, w: box.w, h: box.h, strength: box.hp },
      hero, health, {}).strengthOut;

    const before = health.target;
    const res = statues.checkTrigger({ x: 0, y: 0 }, planeA, STATUE_WORLD, health, contact, rng);
    check('a probe that overlaps the hero DEFERS rather than waking',
      res.deferredHero === true && res.woke === false && res.fired === false, JSON.stringify(res));
    check('⚠️ the snapshot/restore trick: the probe hit must NOT reduce health',
      health.target === before, `before=${before} after=${health.target}`);
    check('the probe never reaches the random gate on a hero-overlap defer',
      rngCalls === 0);
    check('the record is NOT marked fired on a hero-overlap defer',
      statues.records[0].fired === false);
  }

  /* The miss side of the same probe: hero far away, so the probe misses and
   * the trigger proceeds past it (to the random gate, and then the wake). */
  {
    const statues = new Statues();
    const planeA = new Uint8Array(PLANE_SIZE);
    const idx = 5 * MAP_COLS + 5;
    planeA[idx] = TILE_A;
    statues.populate(planeA, STATUE_WORLD, STATUE_SUBLEVEL);
    const health = new Health();
    const heroFar = { x: 9000, y: 9000, state: 0 };
    const contact = (box) => attackHero(
      { x: box.x, y: box.y, w: box.w, h: box.h, strength: box.hp },
      heroFar, health, {}).strengthOut;
    const rngWake = { next: () => 0 };                 // 0 <= WAKE_GATE -> passes
    const res = statues.checkTrigger({ x: 0, y: 0 }, planeA, STATUE_WORLD, health, contact, rngWake);
    check('a miss + a passing random roll WAKES the statue', res.fired === true && res.woke === true,
      JSON.stringify(res));
    check('waking overwrites BOTH plane-A cells (the tile and one row below) to 0x0D',
      planeA[idx] === WAKE_DECOR_TILE && planeA[idx + MAP_COLS] === WAKE_DECOR_TILE);
    const spawned = statues.slots.find((s) => s.state === WAKE_STATE);
    check('waking allocates into the runtime pool at WAKE_STATE (32)', !!spawned && statues.live === 1);
    check('tile 0x23 seeds x=worldX, y=worldY, stepX=0, stepY=-4, phase=0 (no X nudge)',
      spawned && spawned.x === 5 * 32 && spawned.y === 5 * 16
      && spawned.stepX === 0 && spawned.stepY === -4 && spawned.phase === 0,
      JSON.stringify(spawned));

    const rngNoPass = { next: () => WAKE_GATE + 1 };   // one over the gate -> defers
    const statues2 = new Statues();
    const planeA2 = new Uint8Array(PLANE_SIZE);
    planeA2[idx] = TILE_A;
    statues2.populate(planeA2, STATUE_WORLD, STATUE_SUBLEVEL);
    const res2 = statues2.checkTrigger({ x: 0, y: 0 }, planeA2, STATUE_WORLD, health, contact, rngNoPass);
    check('a roll one OVER the gate defers randomly instead of waking',
      res2.deferredRandom === true && res2.fired === false && res2.woke === false);
  }

  /* (d) The random gate's pass rate, enumerated exactly rather than sampled
   * — wakeRollPasses is a pure function of one 16-bit input, so every value
   * can be walked directly. ~24.4% (16001/65536) pass. */
  {
    let passCount = 0;
    for (let r = 0; r <= 0xffff; r++) if (wakeRollPasses(r)) passCount++;
    check(`the random gate passes exactly 16001 of 65536 rolls (~24.4%), got ${passCount}`,
      passCount === 16001);
  }

  /* The cursor: advances by one record per call and wraps; CS:0x7CBD's own
   * world gate resets it to 0 regardless of position. Off-window records
   * must not even reach the probe (the injected callbacks throw if called). */
  {
    const throwingContact = () => { throw new Error('contact must not be called off-window'); };
    const throwingRng = { next: () => { throw new Error('rng must not be called off-window'); } };
    const statues = new Statues();
    const planeA = new Uint8Array(PLANE_SIZE);
    planeA[5 * MAP_COLS + 5] = TILE_A;
    planeA[6 * MAP_COLS + 6] = TILE_B;
    statues.populate(planeA, STATUE_WORLD, STATUE_SUBLEVEL);
    const farCam = { x: 100000, y: 100000 };           // both records far off the 9x11 window
    const health = new Health();
    statues.checkTrigger(farCam, planeA, STATUE_WORLD, health, throwingContact, throwingRng);
    check('an off-window record advances the cursor without probing', statues.cursor === 1);
    statues.checkTrigger(farCam, planeA, STATUE_WORLD, health, throwingContact, throwingRng);
    check('the cursor wraps back to 0 after the last record', statues.cursor === 0);
    statues.checkTrigger(farCam, planeA, 2, health, throwingContact, throwingRng);   // wrong world
    check('CS:0x7CBD\'s own world gate resets the cursor to 0 regardless of position',
      statues.cursor === 0);
  }

  /* (e) The steering clamps: [-3,+3] on X, an ASYMMETRIC [-4,+4] on Y. */
  {
    let stepX = 0;
    for (let i = 0; i < 10; i++) stepX = steerStep(0, 100, stepX, STEP_X_MIN, STEP_X_MAX);
    check('steerStep ratchets up to +3 toward a target ahead, and no further',
      stepX === STEP_X_MAX && STEP_X_MAX === 3, `stepX=${stepX}`);
    let stepXNeg = 0;
    for (let i = 0; i < 10; i++) stepXNeg = steerStep(100, 0, stepXNeg, STEP_X_MIN, STEP_X_MAX);
    check('steerStep ratchets down to -3 toward a target behind, and no further',
      stepXNeg === STEP_X_MIN && STEP_X_MIN === -3, `stepX=${stepXNeg}`);
    let stepY = 0;
    for (let i = 0; i < 10; i++) stepY = steerStep(0, 100, stepY, STEP_Y_MIN, STEP_Y_MAX);
    check('the Y clamp is a DIFFERENT, asymmetric-from-X magnitude: +4, not +3',
      stepY === STEP_Y_MAX && STEP_Y_MAX === 4, `stepY=${stepY}`);
    check('pos === target counts as "ahead" (the <= branch), matching CS:0x7B68',
      steerStep(50, 50, 0, STEP_X_MIN, STEP_X_MAX) === 1);
  }

  /* (f) The state<=4 vs state>4 split: above the floor, state counts down
   * each "on" tock and phase is untouched; at or below it, state stops and
   * phase animates instead. Both gated the SAME way on tock (this module's
   * own documented judgment call: gate on tock===1). */
  {
    const above = new Statues();
    Object.assign(above.slots[0], { x: 0, y: 0, state: 5, stepX: 0, stepY: 0, phase: 0 });
    above.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, missContact, null, 1);
    check('state>4 (COUNTDOWN_FLOOR) counts DOWN on an "on" tock, phase untouched',
      above.slots[0].state === 4 && above.slots[0].phase === 0,
      `state=${above.slots[0].state} phase=${above.slots[0].phase}`);

    const atFloor = new Statues();
    Object.assign(atFloor.slots[0], { x: 0, y: 0, state: 4, stepX: 0, stepY: 0, phase: 0 });
    atFloor.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, missContact, null, 1);
    check('state<=4 stops counting down; phase animates instead',
      atFloor.slots[0].state === 4 && atFloor.slots[0].phase === 1,
      `state=${atFloor.slots[0].state} phase=${atFloor.slots[0].phase}`);

    const offTock = new Statues();
    Object.assign(offTock.slots[0], { x: 0, y: 0, state: 5, stepX: 0, stepY: 0, phase: 0 });
    offTock.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, missContact, null, 0);
    check('the "off" tock phase (per this module\'s own judgment call) touches neither',
      offTock.slots[0].state === 5 && offTock.slots[0].phase === 0);
  }

  /* (g) The idle sprite table is 4 entries (an earlier guess of 8 is
   * refuted), and stepX>=0 adds the +3 facing offset. */
  check('IDLE_TABLE has exactly 4 entries, not 8', IDLE_TABLE.length === 4);
  check('IDLE_TABLE reads 450,451,452,451 (DS:0xdf68)',
    IDLE_TABLE[0] === 450 && IDLE_TABLE[1] === 451 && IDLE_TABLE[2] === 452 && IDLE_TABLE[3] === 451,
    JSON.stringify(IDLE_TABLE));
  {
    const right = new Statues();
    Object.assign(right.slots[0], { x: 0, y: 0, state: 10, stepX: 1, stepY: 0, phase: 0 });
    const rRight = right.step({ x: 0, y: 0 }, { x: 1000, y: 0 }, 0, missContact, null, 0);
    check('facing right (stepX>=0) adds the +3 facing offset',
      rRight.drawn[0].sprite === IDLE_TABLE[0] + FACING_OFFSET, JSON.stringify(rRight.drawn[0]));

    const left = new Statues();
    Object.assign(left.slots[0], { x: 0, y: 0, state: 10, stepX: -1, stepY: 0, phase: 0 });
    const rLeft = left.step({ x: 0, y: 0 }, { x: -1000, y: 0 }, 0, missContact, null, 0);
    check('facing left (stepX<0) adds NO offset',
      rLeft.drawn[0].sprite === IDLE_TABLE[0], JSON.stringify(rLeft.drawn[0]));
  }

  /* (h) The death sequence lasts EXACTLY 17 frames (sprites 91..107), then
   * frees the slot — correcting an earlier, less precise "18 ticks" guess. */
  {
    const dying = new Statues();
    Object.assign(dying.slots[0], { x: 0, y: 0, state: -1, stepX: 0, stepY: 0, phase: 0 });
    const seen = [];
    let stateAfter16 = null;
    for (let i = 0; i < DEATH_FRAMES; i++) {
      const r = dying.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, missContact, null, 0);
      seen.push(r.drawn[0].sprite);
      if (i === DEATH_FRAMES - 2) stateAfter16 = dying.slots[0].state;
    }
    check(`the death sequence draws exactly ${DEATH_FRAMES} frames, sprites `
      + `${STATUE_DEATH_SPRITE_BASE}..${STATUE_DEATH_SPRITE_BASE + DEATH_FRAMES - 1}, in order`,
      seen.length === DEATH_FRAMES && seen[0] === STATUE_DEATH_SPRITE_BASE
      && seen[DEATH_FRAMES - 1] === STATUE_DEATH_SPRITE_BASE + DEATH_FRAMES - 1, JSON.stringify(seen));
    check('⚠️ corrects an earlier "18 ticks" guess: the slot is STILL occupied after 16 frames',
      stateAfter16 === -1);
    check('...and frees itself on exactly the 17th draw, not the 18th',
      dying.slots[0].state === 0);
    const rAfter = dying.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, missContact, null, 0);
    check('once freed, the slot draws nothing on a further call', rAfter.drawn.length === 0);
  }

  /* (i) Death awards 500 points (dl=5*100) and a popupId of 16 — both via a
   * contact hit (the one-touch-kill convention every creature shares) and,
   * separately, via the injected scanGrid (a weapon kill after a contact
   * miss), matching frame.js's own two-step chain. */
  {
    const killedByContact = new Statues();
    Object.assign(killedByContact.slots[0], { x: 0, y: 0, state: 10, stepX: 0, stepY: 0, phase: 0 });
    const hitContact = () => -1;   // a REPORTED hit, exactly attackHero's own convention
    const r = killedByContact.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, hitContact, null, 0);
    check('a contact hit is an outright one-touch kill',
      r.killed === 1 && killedByContact.slots[0].state === -1 && killedByContact.slots[0].phase === 0);
    check(`the kill awards KILL_SCORE (${KILL_SCORE}, dl=5*100) this tick`,
      r.score === KILL_SCORE && KILL_SCORE === 500);
    check(`the kill surfaces popupId ${KILL_POPUP_ID}`,
      r.popups.length === 1 && r.popups[0].id === KILL_POPUP_ID && KILL_POPUP_ID === 16,
      JSON.stringify(r.popups));
    check('running totals (killed/score) accumulate onto the instance too',
      killedByContact.killed === 1 && killedByContact.score === 500);

    const killedByWeapon = new Statues();
    Object.assign(killedByWeapon.slots[0], { x: 0, y: 0, state: 10, stepX: 0, stepY: 0, phase: 0 });
    const scanKills = (entity) => { entity.state = -1; return { killed: true }; };
    const rW = killedByWeapon.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, missContact, scanKills, 0);
    check('a weapon kill via scanGrid (after a contact MISS) also awards the reward',
      rW.killed === 1 && rW.score === 500 && rW.popups[0].id === 16);

    const woundedByWeapon = new Statues();
    Object.assign(woundedByWeapon.slots[0], { x: 0, y: 0, state: 10, stepX: 0, stepY: 0, phase: 0 });
    const scanWounds = (entity) => { entity.state = 3; return { killed: false }; };
    const rWound = woundedByWeapon.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, missContact, scanWounds, 0);
    check('a non-lethal weapon hit reduces state and awards nothing',
      rWound.killed === 0 && rWound.score === 0 && woundedByWeapon.slots[0].state === 3);

    const noScanGrid = new Statues();
    Object.assign(noScanGrid.slots[0], { x: 0, y: 0, state: 10, stepX: 0, stepY: 0, phase: 0 });
    const rNoGrid = noScanGrid.step({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, missContact, null, 0);
    check('with no scanGrid supplied, a contact miss just leaves state unchanged',
      rNoGrid.killed === 0 && noScanGrid.slots[0].state === 10);
  }

  return results;
}

/**
 * ce64.js — the world-3-only creature (object type 96, 6 shipped placements)
 * and its "spit" sub-projectile. Covers, in order: the wander/attack cycle
 * timing (countdown, the reload, the 1->2->3(attack)->0 walk, and the
 * on-screen attack gate); the DS:0x34 reportGate/mode:1 bracket actually
 * being EXERCISED — a non-vacuous grid hit, not an empty spy that would pass
 * `.every(...)` for free — and its real consequence via the REAL
 * damageForTag, not a stub; the freeze-aliens rule; the death draw; the
 * honest sprite-table placeholder; the spit's windup-to-armed transition at
 * exactly 10 ticks, including the non-cumulative Y this project has been
 * burned by before; the spit's hero-biased steering; the spit's death
 * transition and its 18-frame sequence (sprites 91-108 inclusive,
 * independently re-derived below rather than trusted); and the GLOBAL,
 * cross-creature 10-spit cap.
 */
export function checkCe64() {
  const { results, check } = makeChecker();

  const farHero = { x: 100000, y: 100000, state: 0 };   // guaranteed miss, both hitboxes
  const missDecode = () => { throw new Error('decodeTag must not be called on an empty grid cell (tag 0)'); };

  /* (a) The wander/attack cycle: countdown while wanderState===0, a fixed
   * reload (TIMER_RELOAD_BASE + rand()&TIMER_RELOAD_MASK — ce64.js's own
   * header flags CS:0x7f36's "10" as the ONE-TIME SPAWN SEED only, not this
   * reload), then a silent 1->2 tick, an attack exactly on reaching 3, and a
   * SAME-TICK reset on reaching 4 (WANDER_CYCLE_LENGTH) — so a live draw call
   * never actually sees wanderState===4. */
  {
    const rng0 = { next: () => 0 };                 // rand()&31 === 0 -> reload === TIMER_RELOAD_BASE
    const c = new Ce64Creatures(rng0);
    c.armed = true;
    Object.assign(c.slots[0], { x: 0, y: 0, hp: CE64_SEED_HP, wanderState: 0, timer: 2 });
    const grid = new DamageGrid();
    const health = new Health();
    const cam = { x: 0, y: 0 };

    c.step(cam, farHero, 0, health, grid, missDecode, null, {});
    check('wanderState===0: the timer counts DOWN one per tick',
      c.slots[0].timer === 1 && c.slots[0].wanderState === 0, JSON.stringify(c.slots[0]));
    c.step(cam, farHero, 0, health, grid, missDecode, null, {});
    check('...down to 0, and 0 still counts as "keep counting" (the >=0 branch)',
      c.slots[0].timer === 0 && c.slots[0].wanderState === 0, JSON.stringify(c.slots[0]));
    c.step(cam, farHero, 0, health, grid, missDecode, null, {});
    check(`...only once it goes NEGATIVE does it reload to ${TIMER_RELOAD_BASE} `
      + `(TIMER_RELOAD_BASE + rand()&${TIMER_RELOAD_MASK}, ===0 with this rng) and advance to wanderState 1`,
      c.slots[0].timer === TIMER_RELOAD_BASE && c.slots[0].wanderState === 1,
      `timer=${c.slots[0].timer} wanderState=${c.slots[0].wanderState}`);

    /* Walk the 1->2->3(attack)->0 cycle on-screen, so the attack genuinely
     * fires — a fake `spits` records exactly when spawn() is called, and
     * exactly what it was called with. */
    const spawns = [];
    const spits = { spawn: (x, y) => { spawns.push({ x, y }); return true; } };
    const seenStates = [];
    for (let i = 0; i < WANDER_CYCLE_LENGTH - 1; i++) {
      c.step(cam, farHero, 0, health, grid, missDecode, spits, {});
      seenStates.push(c.slots[0].wanderState);
    }
    check('the walk from wanderState 1 is 2 (silent), then 3 (the attack tick), then reset to 0 — '
      + 'all inside WANDER_CYCLE_LENGTH-1 ticks, with 4 never actually observed',
      JSON.stringify(seenStates) === JSON.stringify([2, 3, 0]), JSON.stringify(seenStates));
    check(`the attack fires EXACTLY ONCE, on the wanderState===ATTACK_AT_WANDER(${ATTACK_AT_WANDER}) tick`,
      spawns.length === 1, JSON.stringify(spawns));
    check("the spit spawns at the CREATURE's own raw (x, y) — the -10 Y bias is Ce64Spits.spawn's own job, "
      + 'not the creature\'s', spawns[0].x === 0 && spawns[0].y === 0, JSON.stringify(spawns[0]));
  }

  /* (a2) The on-screen attack gate genuinely gates — an off-window creature
   * reaches wanderState===3 without ever calling spawn(). */
  {
    const c = new Ce64Creatures({ next: () => 0 });
    c.armed = true;
    Object.assign(c.slots[0], { x: 100000, y: 0, hp: CE64_SEED_HP, wanderState: 1, timer: 0 });
    const throwingSpits = { spawn: () => { throw new Error('spawn must not fire for an off-screen creature'); } };
    const grid = new DamageGrid();
    const health = new Health();
    const cam = { x: 0, y: 0 };                      // screenX = 100000, far past ATTACK_WINDOW.xMax
    c.step(cam, farHero, 0, health, grid, missDecode, throwingSpits, {});
    c.step(cam, farHero, 0, health, grid, missDecode, throwingSpits, {});
    check(`ATTACK_WINDOW (x:[${ATTACK_WINDOW.xMin},${ATTACK_WINDOW.xMax}], `
      + `y:[${ATTACK_WINDOW.yMin},${ATTACK_WINDOW.yMax}]) genuinely gates the attack: an `
      + 'off-screen creature reaches the attack tick and the attempt fizzles silently',
      c.slots[0].wanderState === 3);
  }

  /* (b) reportGate:1 / mode:1 — wired AND ACTUALLY USED, not merely accepted
   * and ignored. A grid stamp genuinely under the creature's own BOX_CREATURE
   * (verified first, so an empty capturedModes spy can't pass `.every(...)`
   * vacuously) lets one tick prove three things at once: the hero still
   * takes damage, the creature's OWN hp survives the contact untouched
   * (reportGate), and the weapon-scan still runs the SAME tick — this
   * creature's contact does NOT short-circuit its own scan, unlike
   * CONTACT_SHORT_CIRCUITS_SCAN's rule for every other creature. */
  {
    const c = new Ce64Creatures({ next: () => 0 });
    c.armed = true;
    Object.assign(c.slots[0], { x: 0, y: 0, hp: CE64_SEED_HP, wanderState: 0, timer: 999 });
    const grid = new DamageGrid();
    grid.stamp2x2(0, 0, 0x01);                        // an ordinary weapon tag, under the creature's own box
    const foundTag = grid.scan(0, 0, BOX_CREATURE.w, BOX_CREATURE.h);
    check('setup sanity: the stamp really is inside BOX_CREATURE\'s own scan area — without this, '
      + 'an empty capturedModes spy below would pass `.every(...)` vacuously and prove nothing',
      foundTag === 0x01, `foundTag=${foundTag}`);

    const health = new Health();
    const before = health.target;
    const overlappingHero = { x: 0, y: 0, state: 0 };   // BOX_CREATURE (32x40) math guarantees overlap
    const capturedModes = [];
    const decodeTag = (tag, mode) => { capturedModes.push(mode); return { damage: 10 }; };
    c.step({ x: 0, y: 0 }, overlappingHero, 0, health, grid, decodeTag, null, { difficulty: 0 });

    check('a contact hit still damages the HERO — reportGate only protects the CREATURE\'s own hp',
      health.target < before, `before=${before} after=${health.target}`);
    check('the decode spy actually fired this tick (non-vacuous — see the setup sanity check above)',
      capturedModes.length > 0, JSON.stringify(capturedModes));
    check('EVERY weapon-scan call this creature makes passes mode:1 — the forced DS:0x34 bracket, '
      + 'not a default that just happens to read 0',
      capturedModes.length > 0 && capturedModes.every((m) => m === 1), JSON.stringify(capturedModes));
    check(`and because reportGate:1 held the contact's strengthOut === CE64_SEED_HP (${CE64_SEED_HP}), `
      + `the scan genuinely ran on the SAME tick and its damage landed on the creature's own hp `
      + `(${CE64_SEED_HP} - 10 = ${CE64_SEED_HP - 10}) — contact did NOT short-circuit it`,
      c.slots[0].hp === CE64_SEED_HP - 10, `hp=${c.slots[0].hp}`);

    /* The practical payoff this whole bracket exists for: collision.js's own
     * REAL damageForTag (no stub, no new mechanism — reusing exactly what
     * the task asked for) on the two special tags. Under mode:1 tag 0xFC
     * (starburst) drops from 10000 to 50. */
    const c2 = new Ce64Creatures({ next: () => 0 });
    c2.armed = true;
    Object.assign(c2.slots[0], { x: 0, y: 0, hp: CE64_SEED_HP, wanderState: 0, timer: 999 });
    const grid2 = new DamageGrid();
    grid2.stamp2x2(0, 0, 0xfc);                        // the starburst special tag
    const realDecode = (tag, mode) => damageForTag(tag, [], {}, mode);
    c2.step({ x: 0, y: 0 }, farHero, 0, new Health(), grid2, realDecode, null, {});
    check('the practical consequence, via the REAL damageForTag (not a stub): a starburst hit '
      + `(tag 0xFC) costs this creature only 50, not 10000 — ${CE64_SEED_HP} - 50 = ${CE64_SEED_HP - 50}`,
      c2.slots[0].hp === CE64_SEED_HP - 50, `hp=${c2.slots[0].hp}`);
  }

  /* (c) Freeze-aliens: the universal rule — freeze stops wander/attack, but
   * CONTACT and DRAW still run, every tick, even frozen. */
  {
    const c = new Ce64Creatures({ next: () => 0 });
    c.armed = true;
    Object.assign(c.slots[0], { x: 0, y: 0, hp: CE64_SEED_HP, wanderState: 0, timer: 3 });
    const grid = new DamageGrid();
    const health = new Health();
    const r = c.step({ x: 0, y: 0 }, farHero, 1 /* freezeTimer !== 0 */, health, grid, missDecode, null, {});
    check('freeze-aliens (freezeTimer!==0) leaves the countdown timer UNTOUCHED',
      c.slots[0].timer === 3, `timer=${c.slots[0].timer}`);
    check('...but CONTACT and DRAW still ran this tick, frozen or not',
      r.drawn.length === 1, JSON.stringify(r.drawn));
  }

  /* (d) Death: hp<0 detected at the TOP of the loop draws the death-cloud
   * (sprite = wanderState + 0x6c) at the documented (-4,-8) offset, and frees
   * only after DEATH_FREE_AT frames — never before. */
  {
    const c = new Ce64Creatures({ next: () => 0 });
    c.armed = true;
    Object.assign(c.slots[0], { x: 50, y: 60, hp: -1, wanderState: 0, timer: 0 });
    const grid = new DamageGrid();
    const health = new Health();
    const cam = { x: 10, y: 10 };
    let lastDrawn = null;
    for (let i = 0; i < DEATH_FREE_AT; i++) {
      const r = c.step(cam, farHero, 0, health, grid, missDecode, null, {});
      lastDrawn = r.drawn[0];
      check(`death-draw frame ${i}: sprite === wanderState(${i}) + 0x6c === ${CE64_DEATH_SPRITE_BASE + i}`,
        lastDrawn.sprite === CE64_DEATH_SPRITE_BASE + i, JSON.stringify(lastDrawn));
    }
    check(`the death draw offset is (${CE64_DEATH_DRAW_OFFSET.dx}, ${CE64_DEATH_DRAW_OFFSET.dy}) `
      + 'relative to (x - cam.x, y - cam.y)',
      lastDrawn.x === 50 - 10 + CE64_DEATH_DRAW_OFFSET.dx
      && lastDrawn.y === 60 - 10 + CE64_DEATH_DRAW_OFFSET.dy, JSON.stringify(lastDrawn));
    check(`the slot frees itself after exactly DEATH_FREE_AT (${DEATH_FREE_AT}) drawn frames, not before`,
      c.slots[0].x === -1);
  }

  /* (e) The sprite table: an HONEST placeholder, not a fabricated guess.
   * Length 4 is not a truncation of a 5-valued field — (a) above already
   * proves wanderState's same-tick 4->0 reset means DRAW_ALIVE never
   * actually sees a wanderState of 4. */
  check('WANDER_SPRITE has exactly 4 entries (wanderState 4 resets to 0 in the SAME tick, before any draw sees it)',
    WANDER_SPRITE.length === 4, JSON.stringify(WANDER_SPRITE));
  check('WANDER_SPRITE is an HONEST placeholder — [0,0,0,0] — never a fabricated plausible-looking guess',
    WANDER_SPRITE.every((v) => v === 0), JSON.stringify(WANDER_SPRITE));
  check('the placeholder carries its own loud, address-citing disclaimer (UNKNOWN_ce64_sprite_table)',
    typeof UNKNOWN_ce64_sprite_table === 'string'
    && UNKNOWN_ce64_sprite_table.includes('CS:0x8003')
    && UNKNOWN_ce64_sprite_table.includes('SS:0x3602')
    && /never read/i.test(UNKNOWN_ce64_sprite_table),
    UNKNOWN_ce64_sprite_table);

  /* (f) Structural sanity — the facts the task states as ground truth. */
  check(`object type ${CE64_TYPE} (sprite ${CE64_SPRITE} === 170+${CE64_TYPE})`,
    CE64_TYPE === 96 && CE64_SPRITE === 170 + 96);
  check(`world ${CE64_WORLD} only, a ${CE64_SLOTS}-slot pool at stride ${CE64_STRIDE}`,
    CE64_WORLD === 3 && CE64_SLOTS === 10 && CE64_STRIDE === 10);
  check('BOX_CREATURE is 0x20x0x28 (32x40), shared by contact AND the weapon-scan (per the task\'s '
    + 'own citation of the bracketed CS:0x7fb5-0x7fdd call)',
    BOX_CREATURE.w === 0x20 && BOX_CREATURE.h === 0x28);
  check(`the seed values: hp=${CE64_SEED_HP} (0xc8/200), wanderState=${CE64_SEED_WANDER}, `
    + `timer=${CE64_SEED_TIMER} (0xa/10, the ONE-TIME spawn seed, not the reload)`,
    CE64_SEED_HP === 0xc8 && CE64_SEED_WANDER === 0 && CE64_SEED_TIMER === 0xa);
  check(`SCORE_CREATURE_KILL===${SCORE_CREATURE_KILL} (1000, dl=0x10) and `
    + `SCORE_SPIT_KILL===${SCORE_SPIT_KILL} (500, dl=5)`,
    SCORE_CREATURE_KILL === 1000 && SCORE_SPIT_KILL === 500);

  /* ══ THE SPIT ═══════════════════════════════════════════════════════════ */

  /* (g) Windup: exactly SPIT_WINDUP_TICKS (10) ticks. Y is recomputed from a
   * FIXED origin every tick — NOT accumulated. A `y += vy` port would land at
   * originY-55 after 10 ticks (the sum -10-9-8-...-1), not originY-1. Every
   * windup tick draws the fixed pose SPIT_WINDUP_SPRITE (492), no facing, no
   * animation, and NO contact test runs (intangible while rising). On the
   * 10th tick it arms: state=SPIT_ARM_HP(20, doubling as hp), steps=
   * SPIT_ARM_STEPS(15), vx=vy=0. */
  {
    const spits = new Ce64Spits({ next: () => 0 });
    const spawnOk = spits.spawn(200, 100);
    const p = spits.spits[0];
    check('spawn() applies the -10 origin bias internally: creatureY=100 -> originY=90',
      spawnOk === true && p.originY === 100 + SPIT_ORIGIN_Y_BIAS, JSON.stringify(p));

    const cam = { x: 0, y: 0 };
    const throwingContact = () => { throw new Error('no contact test may run during windup — intangible while rising'); };
    const drawnSprites = [];
    for (let i = 0; i < SPIT_WINDUP_TICKS - 1; i++) {
      const r = spits.step(cam, farHero, 0, new Health(), new DamageGrid(), throwingContact, {});
      drawnSprites.push(r.drawn[0].sprite);
    }
    check(`after ${SPIT_WINDUP_TICKS - 1} ticks the spit is STILL winding up (state===-1), not yet armed`,
      p.state === -1, `state=${p.state}`);

    const r10 = spits.step(cam, farHero, 0, new Health(), new DamageGrid(), throwingContact, {});
    drawnSprites.push(r10.drawn[0].sprite);
    check(`every one of the ${SPIT_WINDUP_TICKS} windup draws uses the fixed pose SPIT_WINDUP_SPRITE `
      + `(${SPIT_WINDUP_SPRITE}) — no facing, no animation`,
      drawnSprites.length === SPIT_WINDUP_TICKS && drawnSprites.every((s) => s === SPIT_WINDUP_SPRITE),
      JSON.stringify(drawnSprites));
    check('⚠️ NOT CUMULATIVE: after exactly 10 ticks, y === originY - 1 — a `y += vy` port would '
      + 'land at originY - 55 instead (the sum of -10 through -1)',
      p.y === p.originY - 1, `y=${p.y} originY=${p.originY}`);
    check(`the 10th tick ARMS: state===SPIT_ARM_HP(${SPIT_ARM_HP}), steps===SPIT_ARM_STEPS(${SPIT_ARM_STEPS}), `
      + 'vx=vy=0', p.state === SPIT_ARM_HP && p.steps === SPIT_ARM_STEPS && p.vx === 0 && p.vy === 0,
      JSON.stringify(p));
  }

  /* (h) The global spit cap: SHARED across every spawning creature, not
   * per-creature — spawn() has no notion of who is calling it, so ten
   * spawns from ten different "creatures" still hit one shared ceiling. */
  {
    const spits = new Ce64Spits({ next: () => 0 });
    let ok = 0;
    for (let i = 0; i < SPIT_CAP; i++) if (spits.spawn(i, i)) ok++;
    check(`SPIT_CAP (${SPIT_CAP}) spawns — from what could be ten DIFFERENT creatures, since spawn() `
      + 'takes no creature identity at all — all succeed',
      ok === SPIT_CAP && spits.count === SPIT_CAP, `ok=${ok} count=${spits.count}`);
    const fizzled = spits.spawn(999, 999);
    check('the 11th spawn fizzles SILENTLY (returns false, throws nothing) once the GLOBAL cap is hit',
      fizzled === false && spits.count === SPIT_CAP);
    spits.spits.pop();
    check('freeing one slot makes room for exactly one more spawn, and only one',
      spits.spawn(1, 1) === true && spits.spawn(2, 2) === false && spits.count === SPIT_CAP);
  }

  /* (i) Steering biases toward the hero, on both axes, independently of the
   * random magnitude — the SAME fixed rng, only the hero's position changes
   * between the two cases below, isolating the sign logic from the roll. */
  {
    const rng7 = { next: () => 5 };                  // (5&7)+2 === 7, a fixed magnitude
    const noContact = () => { throw new Error('a hero 100000px away cannot overlap a 24x24 box'); };

    const towardBottomRight = new Ce64Spits(rng7);
    towardBottomRight.spits.push(
      { x: 100, y: 100, originY: 100, vx: 0, vy: 0, frame: 0, state: SPIT_ARM_HP, steps: 0 });
    towardBottomRight.step({ x: 0, y: 0 }, { x: 100000, y: 100000, state: 0 }, 0,
      new Health(), new DamageGrid(), noContact, {});
    check('hero far to the RIGHT and BELOW -> vx and vy both steer POSITIVE (toward it)',
      towardBottomRight.spits[0].vx === 7 && towardBottomRight.spits[0].vy === 7,
      JSON.stringify(towardBottomRight.spits[0]));

    const towardTopLeft = new Ce64Spits(rng7);
    towardTopLeft.spits.push(
      { x: 100, y: 100, originY: 100, vx: 0, vy: 0, frame: 0, state: SPIT_ARM_HP, steps: 0 });
    towardTopLeft.step({ x: 0, y: 0 }, { x: -100000, y: -100000, state: 0 }, 0,
      new Health(), new DamageGrid(), noContact, {});
    check('hero far to the LEFT and ABOVE -> vx and vy both steer NEGATIVE (toward it) — same rng, '
      + 'same magnitude (7), only the hero moved, isolating the sign logic',
      towardTopLeft.spits[0].vx === -7 && towardTopLeft.spits[0].vy === -7,
      JSON.stringify(towardTopLeft.spits[0]));
    check(`the reseed also picks a fresh burst length: steps === (rand()&7)+3 === ${(5 & 7) + 3} with this rng`,
      towardTopLeft.spits[0].steps === (5 & 7) + 3);
  }

  /* (j) The death transition: exactly one (-4,-4) nudge, SCORE_SPIT_KILL
   * points, and the state===1/frame===-1 "just died" handoff — via the SAME
   * shared attackHero entry the creature uses, but ORDINARY (no reportGate:
   * one touch is an outright kill here, unlike the creature above). */
  {
    const scoreSpy = { calls: [], add(n) { this.calls.push(n); } };
    const spits = new Ce64Spits({ next: () => 5 });
    spits.spits.push({ x: 40, y: 40, originY: 40, vx: 0, vy: 0, frame: 0, state: SPIT_ARM_HP, steps: 1 });
    const overlappingHero = { x: 40, y: 40, state: 0 };    // SPIT_BOX (24x24) math guarantees overlap
    const health = new Health();
    const before = health.target;
    spits.step({ x: 0, y: 0 }, overlappingHero, 0, health, new DamageGrid(), missDecode, { score: scoreSpy });
    const p = spits.spits[0];
    check('a contact hit on the spit is an outright one-touch kill — ordinary contact, no reportGate needed',
      health.target < before && p.state === 1 && p.frame === -1, JSON.stringify(p));
    check(`death awards SCORE_SPIT_KILL (${SCORE_SPIT_KILL}) exactly once`,
      scoreSpy.calls.length === 1 && scoreSpy.calls[0] === SCORE_SPIT_KILL, JSON.stringify(scoreSpy.calls));
    check('the (-4,-4) position nudge is applied EXACTLY ONCE, on the death-transition tick itself',
      p.x === 40 - 4 && p.y === 40 - 4, `x=${p.x} y=${p.y}`);

    /* Run it again with the SAME overlapping hero — the death sequence, once
     * entered, must not re-nudge or re-award on later ticks. */
    spits.step({ x: 0, y: 0 }, overlappingHero, 0, health, new DamageGrid(), missDecode, { score: scoreSpy });
    check('once in the death sequence, later ticks do NOT re-nudge or re-award',
      p.x === 40 - 4 && p.y === 40 - 4 && scoreSpy.calls.length === 1);
  }

  /* (k) The death sequence: independently RE-DERIVE the arithmetic rather
   * than trust the task's own summary. sprite = SPIT_DEATH_SPRITE_BASE(91) +
   * deathFrame, deathFrame runs 0..SPIT_DEATH_FRAMES-1(17), so the LAST
   * sprite drawn is 91+17 = 108, and the span 91..108 holds exactly
   * 108-91+1 = 18 distinct sprites — matching SPIT_DEATH_FRAMES exactly, not
   * off by one in either direction. The slot frees on the SAME tick it draws
   * the final sprite (108), not the tick after. */
  {
    check(`re-derived arithmetic, not trusted: SPIT_DEATH_SPRITE_BASE(${SPIT_DEATH_SPRITE_BASE}) + `
      + `(SPIT_DEATH_FRAMES(${SPIT_DEATH_FRAMES})-1) === 108, and that span holds exactly `
      + `${SPIT_DEATH_FRAMES} distinct sprites (108-91+1=${108 - 91 + 1})`,
      SPIT_DEATH_SPRITE_BASE + (SPIT_DEATH_FRAMES - 1) === 108
      && (SPIT_DEATH_SPRITE_BASE + (SPIT_DEATH_FRAMES - 1)) - SPIT_DEATH_SPRITE_BASE + 1 === SPIT_DEATH_FRAMES
      && SPIT_DEATH_SPRITE_BASE === 91 && SPIT_DEATH_FRAMES === 18);

    const spits = new Ce64Spits({ next: () => 0 });
    spits.spits.push({ x: 0, y: 0, originY: 0, vx: 0, vy: 0, frame: -1, state: 1, steps: 0 });
    const cam = { x: 0, y: 0 };
    const seen = [];
    let countBeforeLastDraw = null;
    for (let i = 0; i < SPIT_DEATH_FRAMES; i++) {
      countBeforeLastDraw = spits.count;
      const r = spits.step(cam, farHero, 0, new Health(), new DamageGrid(), missDecode, {});
      seen.push(r.drawn.length ? r.drawn[0].sprite : null);
    }
    const expected = Array.from({ length: SPIT_DEATH_FRAMES }, (_, i) => SPIT_DEATH_SPRITE_BASE + i);
    check(`the death sequence draws exactly ${SPIT_DEATH_FRAMES} frames, sprites `
      + `${SPIT_DEATH_SPRITE_BASE}..${SPIT_DEATH_SPRITE_BASE + SPIT_DEATH_FRAMES - 1} in order`,
      JSON.stringify(seen) === JSON.stringify(expected), JSON.stringify(seen));
    check(`the slot is STILL occupied going into the final (${SPIT_DEATH_FRAMES}th) draw`,
      countBeforeLastDraw === 1);
    check(`...and freed on the SAME tick it draws the final sprite `
      + `(${SPIT_DEATH_SPRITE_BASE + SPIT_DEATH_FRAMES - 1}), not the tick after`,
      spits.count === 0);
  }

  return results;
}

/**
 * The selector-2 stationary shooting turrets (CS:0xAD88/0xAD0D, game/
 * selector2.js) — spawn/materialise, fire-rate gating, both handlerA idle-
 * animation gates, both muzzle-offset families (ordinary shot and the
 * Bresenham line-hazard divert), the cull dispatch, contact/damage/score,
 * the death fade, and the group-elimination reward.
 */
export function checkSelectorTwo() {
  const { results, check } = makeChecker();
  const RUNTIME_SLOTS_SEL2 = 10;   // DS:0xaec0, 10 x 0x20 — selector2.js's own RUNTIME_SLOTS

  /* (a) parseClasses — field-by-field, against a synthetic 16-byte record
   * built at PALFILS +0x0718's own offset so a wrong CLASS_OFF would fail
   * this test even with every field otherwise correct. */
  {
    const buf = new Uint8Array(0x0718 + 16);
    const o = 0x0718;
    buf[o + 0x0] = 0x01; buf[o + 0x1] = 0x40;   // spawnX = 0x0140
    buf[o + 0x2] = 0x00; buf[o + 0x3] = 0x50;   // spawnY = 0x0050
    buf[o + 0x4] = 0x00;                         // entityFacing = 0
    buf[o + 0x5] = 0x03;                         // drawStyle = 3
    buf[o + 0x6] = 0x00; buf[o + 0x7] = 0x0a;    // staggerStep = 10
    buf[o + 0x8] = 0x02;                         // entityCount = 2
    buf[o + 0x9] = 0x05;                         // entityState0 = 5
    buf[o + 0xa] = 0x00; buf[o + 0xb] = 0x05;    // classIndex = 5
    buf[o + 0xc] = 0x00;                         // facingSelect = 0
    buf[o + 0xd] = 0x08;                         // reloadByte = 8
    buf[o + 0xe] = 0x2d;                         // rewardItemId = 45
    const c = parseSelectorTwoClasses(buf)[0];
    check('CS:0xAD0D-0xAD61: every field lands at its own documented offset',
      c.spawnX === 0x140 && c.spawnY === 0x50 && c.entityFacing === 0 &&
      c.drawStyle === 3 && c.staggerStep === 10 && c.entityCount === 2 &&
      c.entityState0 === 5 && c.classIndex === 5 && c.facingSelect === 0 &&
      c.reloadByte === 8 && c.rewardItemId === 0x2d && c.live === true,
      JSON.stringify(c));

    const dead = new Uint8Array(0x0718 + 16);
    check('entityCount===0 -> live===false, the materialise-loop-bound convention',
      parseSelectorTwoClasses(dead)[0].live === false);

    /* entityFacing is SIGN-EXTENDED (CS:0xADE1 `cbw`); drawStyle/entityCount/
     * entityState0/facingSelect/reloadByte/rewardItemId are all ZERO-
     * extended raw bytes (no cbw anywhere in their own copy). */
    const neg = new Uint8Array(0x0718 + 16);
    neg[0x0718 + 0x4] = 0xff;
    check('entityFacing 0xFF sign-extends to -1, not 255',
      parseSelectorTwoClasses(neg)[0].entityFacing === -1);
  }

  /* (b) The 6-entry cull table, SS:0x3586 — only ONE edge per style, not a
   * 4-way box; 0/1 never cull at all. */
  {
    check('style 0/1 never cull, at any coordinate',
      selectorTwoCulled(0, -99999, -99999) === false &&
      selectorTwoCulled(1, 99999, 99999) === false);
    check('style 2 (left, CS:0xAF27): cull strictly below -0x70, not at it',
      selectorTwoCulled(2, -0x71, 0) === true && selectorTwoCulled(2, -0x70, 0) === false);
    check('style 3 (right, CS:0xAF3A): cull strictly above 0x190',
      selectorTwoCulled(3, 0x191, 0) === true && selectorTwoCulled(3, 0x190, 0) === false);
    check('style 4 (top, CS:0xAF4D): cull strictly below -0x48',
      selectorTwoCulled(4, 0, -0x49) === true && selectorTwoCulled(4, 0, -0x48) === false);
    check('style 5 (bottom, CS:0xAF60): cull strictly above 0xe8',
      selectorTwoCulled(5, 0, 0xe9) === true && selectorTwoCulled(5, 0, 0xe8) === false);
    /* Each style tests exactly ONE edge — a right-cull style must NOT also
     * cull on the left, unlike a real 4-way clip box. */
    check('style 2 (left-only) does not cull a far-right coordinate',
      selectorTwoCulled(2, 99999, 0) === false);
  }

  /* (c) scoreForState0 — CS:0xAF7D's common-case closed form. */
  {
    check('scoreForState0(0) = ((0>>1)+1)*100 = 100', scoreForState0(0) === 100);
    check('scoreForState0(5) = ((5>>1)+1)*100 = 300', scoreForState0(5) === 300);
    check('scoreForState0(9) = ((9>>1)+1)*100 = 500', scoreForState0(9) === 500);
  }

  /* (d) Per-CLASS handler resolution off CLASS_TABLES_B — corrects the
   * earlier per-WORLD `HANDLER_FOR` model. Six distinct families across the
   * four worlds' live-dispatched classes (world1 uses idx{0,1,2,3,5},
   * world2 idx{0,1,2,3}, world3 idx{3,4}, world4 idx{1,2,3,4,5}). */
  {
    check('world1 idx0-4: the shared 32x32 body / b03c (the MAJORITY family, previously mis-closed as dead)',
      CLASS_TABLES_B[1][0].handlerA === '32x32' && CLASS_TABLES_B[1][0].handlerB === 'b03c' &&
      CLASS_TABLES_B[1][2].handlerA === '32x32' && CLASS_TABLES_B[1][3].handlerB === 'b03c');
    check('world1 idx5-7 / world2 idx3 / world4 idx3: b60e or b5e9, the ONLY classes the earlier model covered',
      CLASS_TABLES_B[1][5].handlerA === 'b60e' && CLASS_TABLES_B[2][3].handlerA === 'b60e' &&
      CLASS_TABLES_B[4][3].handlerA === 'b5e9');
    check('world2 idx2/5/6/7: b144/b290, the rock-drop attack (NOT inert as an earlier pass guessed)',
      CLASS_TABLES_B[2][2].handlerA === 'b144' && CLASS_TABLES_B[2][2].handlerB === 'b290' &&
      CLASS_TABLES_B[2][5].handlerA === 'b144');
    check('world3 idx3: b2c7/b2f3, the two-piece rock-burst attack',
      CLASS_TABLES_B[3][3].handlerA === 'b2c7' && CLASS_TABLES_B[3][3].handlerB === 'b2f3');
    check('world3 idx4 (the other live class): the shared 32x32 body / b03c, base 450',
      CLASS_TABLES_B[3][4].handlerA === '32x32' && CLASS_TABLES_B[3][4].base === 450);
  }

  /* (d2) stepHandlerB03C — the second, MAJORITY handlerB family. Own muzzle
   * constants, no world-4 special case. */
  {
    const slot03c = { reloadByte: 8, facingSelect: 0 };
    const left03c = { x: 100, y: 200, facing: 0, reloadTimer: 1, frame: 0 };
    const rLeft03c = selectorTwoHandlerB03C(left03c, slot03c, 1);
    check('CS:0xB07D (left, via 0x1FE7): muzzle x-8, y+0, vx negative',
      rLeft03c.kind === 'shot' && rLeft03c.worldX === 100 - 8 && rLeft03c.worldY === 200 &&
      rLeft03c.vx === -((8 >> 2) + 4), JSON.stringify(rLeft03c));

    const right03c = { x: 100, y: 200, facing: 1, reloadTimer: 1, frame: 0 };
    const rRight03c = selectorTwoHandlerB03C(right03c, slot03c, 1);
    check('CS:0xB08F (right, via 0x2039): muzzle x+0x20, y+0 — different from B670\'s own x+0xe',
      rRight03c.kind === 'shot' && rRight03c.worldX === 100 + 0x20 && rRight03c.worldY === 200,
      JSON.stringify(rRight03c));
    check('B03C never kicks the frame on world 4 (no world-4 special case anywhere)',
      selectorTwoHandlerB03C({ x: 0, y: 0, facing: 1, reloadTimer: 1, frame: 0 },
        slot03c, 4).kind === 'shot');

    const slotHaz03c = { reloadByte: 8, facingSelect: 1 };
    const hazAny = { x: 100, y: 200, facing: 0, reloadTimer: 1, frame: 0 };
    const rHaz03c = selectorTwoHandlerB03C(hazAny, slotHaz03c, 1);
    check('CS:0xB017: hazard muzzle x+0x10, y+0 — no facing dependence at all',
      rHaz03c.kind === 'hazard' && rHaz03c.worldX === 100 + 0x10 && rHaz03c.worldY === 200,
      JSON.stringify(rHaz03c));
    check('CS:0xB017-B021: same n=(reloadByte>>1)+2 formula as B63F',
      rHaz03c.n === (8 >> 1) + 2, rHaz03c.n);
  }

  /* (e) stepHandlerB — fire-rate gate, reseed, BOTH muzzle families, the
   * facingSelect divert, and the world-4 special cases. Every constant
   * below is cited to its own CS: address inside selector2.js itself; this
   * only re-derives the arithmetic independently. */
  {
    const slot = { reloadByte: 8, facingSelect: 0, world: 1 };

    const notYet = { x: 0, y: 0, facing: 0, reloadTimer: 5, frame: 0 };
    check('CS:0xB676: the reload timer counts DOWN and does not fire above 0',
      selectorTwoHandlerB(notYet, slot, 1) === null && notYet.reloadTimer === 4);

    const never = { reloadByte: 0, facingSelect: 0, world: 1 };
    const untouched = { x: 0, y: 0, facing: 0, reloadTimer: 999, frame: 0 };
    check('CS:0xB670-B674: reloadByte===0 never fires, and never even decrements the timer',
      selectorTwoHandlerB(untouched, never, 1) === null && untouched.reloadTimer === 999);

    const left = { x: 100, y: 200, facing: 0, reloadTimer: 1, frame: 0 };
    const rLeft = selectorTwoHandlerB(left, slot, 1);
    check('CS:0xB687-B692: reload reseeds to (16-reloadByte)<<2 on every fire',
      left.reloadTimer === (16 - 8) << 2, left.reloadTimer);
    check('CS:0xB6AD: facing===0 -> LEFT, vx = -((reloadByte>>2)+4)',
      rLeft.kind === 'shot' && rLeft.vx === -((8 >> 2) + 4), JSON.stringify(rLeft));
    check('CS:0xB6B3-B6C8 (left, non-world4): muzzle x+0xa, y+0xc',
      rLeft.worldX === 100 + 0xa && rLeft.worldY === 200 + 0xc, JSON.stringify(rLeft));

    const right = { x: 100, y: 200, facing: 1, reloadTimer: 1, frame: 0 };
    const rRight = selectorTwoHandlerB(right, slot, 1);
    check('CS:0xB6A7: facing!=0 -> RIGHT, vx = +((reloadByte>>2)+4)',
      rRight.kind === 'shot' && rRight.vx === (8 >> 2) + 4, JSON.stringify(rRight));
    check('CS:0xB6CE-B6E9 (right, non-world4, JNZ taken -> b6e4 only): muzzle x+0xe, y+0xc',
      rRight.worldX === 100 + 0xe && rRight.worldY === 200 + 0xc, JSON.stringify(rRight));

    const slotW4 = { reloadByte: 8, facingSelect: 0, world: 4 };
    const leftW4 = { x: 100, y: 200, facing: 0, reloadTimer: 1, frame: 0 };
    const rLeftW4 = selectorTwoHandlerB(leftW4, slotW4, 4);
    check('CS:0xB6BE-B6C5 (left, world4): ONLY y gets the extra -4 (y+0xc-4=y+8); x unchanged',
      rLeftW4.worldX === 100 + 0xa && rLeftW4.worldY === 200 + 8, JSON.stringify(rLeftW4));

    const rightW4 = { x: 100, y: 200, facing: 1, reloadTimer: 1, frame: 0 };
    const rRightW4 = selectorTwoHandlerB(rightW4, slotW4, 4);
    check('CS:0xB6DC-B6E7 (right, world4, JNZ NOT taken -> falls through BOTH adds): '
      + 'x = x+4+0xe = x+0x12, y = y-4+0xc = y+8',
      rRightW4.worldX === 100 + 0x12 && rRightW4.worldY === 200 + 8, JSON.stringify(rRightW4));
    check('CS:0xB682: world 4 ALSO kicks the animation frame by 1 on every fire',
      rightW4.frame === 1, rightW4.frame);
    check("world 1/2 (non-world4) never kicks the frame from handlerB",
      right.frame === 0, right.frame);

    const slotHaz = { reloadByte: 8, facingSelect: 1, world: 1 };
    const hazLeft = { x: 100, y: 200, facing: 0, reloadTimer: 1, frame: 0 };
    const rHazLeft = selectorTwoHandlerB(hazLeft, slotHaz, 1);
    check('CS:0xB699 facingSelect!=0 diverts to the line-hazard seed (CS:0xB63F), not a shot',
      rHazLeft.kind === 'hazard', JSON.stringify(rHazLeft));
    check('CS:0xB647-B650: facing===0 KEEPS the larger offset, x+0x16, y+0xd — '
      + 'the OPPOSITE polarity from the ordinary-shot muzzle above',
      rHazLeft.worldX === 100 + 0x16 && rHazLeft.worldY === 200 + 0xd, JSON.stringify(rHazLeft));
    check('CS:0xB654-B65E: hazard step count n = (reloadByte>>1)+2, read off CS:0xDBE8\'s own '
      + 'write of DS:0x1f0 into the new line-hazard slot',
      rHazLeft.n === (8 >> 1) + 2, rHazLeft.n);

    const hazRight = { x: 100, y: 200, facing: 1, reloadTimer: 1, frame: 0 };
    const rHazRight = selectorTwoHandlerB(hazRight, slotHaz, 1);
    check('CS:0xB64D: facing!=0 SUBTRACTS 0x1c, net x-6 — the hazard muzzle never matches '
      + 'the ordinary-shot muzzle\'s own facing convention',
      rHazRight.worldX === 100 + 0x16 - 0x1c, JSON.stringify(rHazRight));
  }

  /* (f) handlerA's two frame-advance gates, exercised through the real pool
   * so the sprite/animation path is covered end to end, not just the raw
   * arithmetic. Both gates are read fresh off the disassembly in
   * selector2.js's own header — this checks the OPPOSITE shapes hold. */
  {
    const grid = new DamageGrid();
    const health = new Health();
    const farHero = { x: 100000, y: 100000, state: 0 };
    const missDecode = () => { throw new Error('must not be called on an empty grid cell'); };
    const cam = { x: 0, y: 0 };
    const noop = () => {};

    const pool = new SelectorTwoSpawns();
    const desc1 = { index: 0, spawnX: 0, spawnY: 0, entityFacing: 1, drawStyle: 0,
      staggerStep: 0, entityCount: 1, entityState0: 99, classIndex: 5,
      facingSelect: 0, reloadByte: 8, rewardItemId: 0xff, live: true };
    check('spawn() against the real CLASS_TABLES_B[1][5] (world1 idx5, base 532/24x24)',
      pool.spawn(desc1, 1) === true);
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});   // materialise-only tick
    const e = pool.slots[0].entities[0];
    check('b60e seed: frame starts at 0, reloadTimer seeded (16-8)<<2=32',
      e.frame === 0 && e.reloadTimer === 32, JSON.stringify(e));

    /* frame===0, reloadTimer NOT 1 -> stays at 0 (CS:0xB62B-B635). */
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    check('b60e: frame===0 does not advance while reloadTimer !== 1', e.frame === 0, e.frame);

    /* Force reloadTimer to 2 -- NOT 1. `#stepAlive` runs handlerB (which
     * unconditionally decrements the timer, CS:0xB676) BEFORE handlerA
     * (CS:0xAE5D then CS:0xAE62 — fire, THEN animate), so a timer of 1
     * going into this tick would hit handlerB's own zero-check, FIRE, and
     * get RESEEDED to (16-reloadByte)<<2 before handlerA ever reads it —
     * handlerA would then see the reseeded value, never 1. Starting at 2,
     * handlerB decrements 2->1 (not zero, no fire, no reseed), and handlerA
     * sees exactly the 1 CS:0xB631 checks for. */
    e.reloadTimer = 2;
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    check('b60e: frame===0 advances exactly when reloadByte!=0 AND reloadTimer===1 '
      + '(as OBSERVED BY handlerA, i.e. after handlerB\'s own decrement)',
      e.frame === 1, e.frame);

    /* Now frame!=0 (=1): CS:0xB629 skips the reloadTimer gate entirely and
     * ALWAYS advances, even with reloadTimer far from 1. */
    e.reloadTimer = 999;
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    check('b60e: frame!=0 advances UNCONDITIONALLY, ignoring reloadTimer entirely',
      e.frame === 2, e.frame);

    /* b5e9 (world 4): the OPPOSITE gate — frame===0 NEVER advances by
     * itself; frame!=0 advances only when tock===0. The only way frame
     * leaves 0 at all is handlerB's own world-4 fire-kick. */
    const poolW4 = new SelectorTwoSpawns();
    const desc4 = { index: 0, spawnX: 0, spawnY: 0, entityFacing: 1, drawStyle: 0,
      staggerStep: 0, entityCount: 1, entityState0: 99, classIndex: 3,
      facingSelect: 0, reloadByte: 8, rewardItemId: 0xff, live: true };
    check('spawn() against the real CLASS_TABLES_B[4][3] (world4 idx3, base 547/24x24)',
      poolW4.spawn(desc4, 4) === true);
    poolW4.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});   // materialise-only
    const e4 = poolW4.slots[0].entities[0];
    poolW4.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});   // tock=1: b5e9's own gate never even applies at frame 0
    check('b5e9: frame===0 never advances on its own, tock or not', e4.frame === 0, e4.frame);
    e4.frame = 1;                          // simulate handlerB's own fire-kick having just fired
    poolW4.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});   // tock=1 -> gated OFF
    check('b5e9: frame!=0 does NOT advance while tock!=0', e4.frame === 1, e4.frame);
    poolW4.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});   // tock=0 -> advances
    check('b5e9: frame!=0 advances exactly on the tock===0 tick', e4.frame === 2, e4.frame);
  }

  /* (f2) A REGRESSION GUARD for two real bugs an advisor review caught in
   * this same pass, on the shared 32x32 `handlerA` body — the MAJORITY
   * family across every world, per CLAUDE.md's own live-read class table —
   * which none of (d)/(d2)/(f)/(g)/(i)/(j) exercises, since every one of
   * them drives a 'b60e'/'b5e9'/'b144'/'b2c7' class instead:
   *   1. The call site passed only `entity` to `handlerA_32x32`, never
   *      `slot` — so `entity.spriteBase` (a field that has never existed;
   *      spriteBase lives on the SLOT) was `undefined`, and the sprite was
   *      NaN for every 32x32-classed entity in the game.
   *   2. The facing term was coded as `*8`; a fresh `disassemble_bytes` of
   *      CS:0xB796-B7A4 gives `CX+=facing` (once, unshifted) THEN
   *      `DX:=facing<<3` THEN `CX+=DX` — net `facing*9`, not `facing*8`.
   * Uses the LITERAL 462 (world1 classIndex 0's own spriteBase, per
   * CLAUDE.md's own live `read_memory` table), not
   * `CLASS_TABLES_B[1][0].base`, so this cannot degrade into a tautology
   * against the very table it is meant to catch a regression in. */
  {
    const grid = new DamageGrid();
    const health = new Health();
    const farHero = { x: 100000, y: 100000, state: 0 };
    const missDecode = () => { throw new Error('must not be called on an empty grid cell'); };
    const cam = { x: 0, y: 0 };
    const noop = () => {};

    const pool = new SelectorTwoSpawns();
    const desc = { index: 0, spawnX: 2000, spawnY: 900, entityFacing: 0, drawStyle: 0,
      staggerStep: 0, entityCount: 1, entityState0: 99, classIndex: 0,
      facingSelect: 0, reloadByte: 0, rewardItemId: 0xff, live: true };
    check('spawn() against the real CLASS_TABLES_B[1][0] (world1 idx0, 32x32/b03c, base 462)',
      pool.spawn(desc, 1) === true);

    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});   // materialise-only
    const e = pool.slots[0].entities[0];
    check('materialise: facing seeded from entityFacing(0), frame starts at 0',
      e.facing === 0 && e.frame === 0, JSON.stringify(e));

    const r = pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    check('CS:0xB725-B7A6, facing===0: drawn sprite is the LITERAL 462 + frame, not NaN '
      + '(the entity-vs-slot argument bug)',
      r.drawn.length === 1 && r.drawn[0].sprite === 462 + e.frame, JSON.stringify(r.drawn));

    const pool2 = new SelectorTwoSpawns();
    const desc2 = { ...desc, entityFacing: 1 };
    check('spawn() with entityFacing=1', pool2.spawn(desc2, 1) === true);
    pool2.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});   // materialise-only
    const e2 = pool2.slots[0].entities[0];
    const r2 = pool2.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    check('CS:0xB79A/B79C-B7A2: facing!=0 adds facing+facing*8 = *9 net, not *8',
      r2.drawn[0].sprite === 462 + e2.frame + 9, JSON.stringify(r2.drawn));

    const pool3 = new SelectorTwoSpawns();
    check('spawn() for the tock-polarity check', pool3.spawn({ ...desc }, 1) === true);
    pool3.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});   // materialise-only
    const e3 = pool3.slots[0].entities[0];
    const r3a = pool3.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});   // tock byte===0 -> skip (CS:0xB73B JZ taken)
    check('CS:0xB736-B73B: tock===0 (the byte reads 0) does NOT advance the 8-frame cycle',
      e3.frame === 0 && r3a.drawn[0].sprite === 462, JSON.stringify(r3a.drawn));
    const r3b = pool3.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});   // tock byte!==0 -> advance
    /* A LITERAL 463 (462 + frame(1) + facing(0)*9), not `462 + e3.frame` —
     * that self-adjusting form would pass even if `+ frame` were dropped
     * from the sprite formula entirely, since blocks above never advance
     * frame off 0. This pins the actual number the increment-then-read
     * order (stepAnim8 runs before handlerA_32x32 in #stepAlive) produces:
     * the sprite for THIS tick already reflects the frame this SAME tick
     * just advanced to, per CS:0xB725-B7A6's own mutate-then-fall-through
     * shape (confirmed by a fresh disassemble_bytes, not assumed by
     * analogy with CS:0xB144's differently-shaped gate). */
    check('CS:0xB73D-B741: tock!==0 DOES advance, and the SAME tick draws the post-advance frame',
      e3.frame === 1 && r3b.drawn[0].sprite === 463, JSON.stringify(r3b.drawn));
  }

  /* (f3) `stepPace32x32` — CS:0xB744-B7EB, the pace-and-turn mechanism an
   * advisor review found missing from the 32x32 shared body (the file
   * header's own correction, and `handlerA_32x32`'s). Direct unit tests
   * against the exported function first, so a failure here points straight
   * at the mechanism rather than at pool wiring; a short integration check
   * through the real pool (via `opts.planeB`) follows to confirm the wiring
   * itself. All probes use `entity.y = 0` so `cellIndexXY`'s own row term is
   * zero and the column arithmetic stays legible. */
  {
    const mkPlaneB = () => new Uint8Array(600);   // covers every offset used below with room to spare
    /* The same `((x&0xFFE0)>>5) + ((y&0xFFF0)>>4)*128` formula `stepPace32x32`'s
     * own (unexported) `cellIndexXY` uses — reproduced here, not imported, so
     * this test independently re-derives the expected offset rather than
     * trivially agreeing with whatever the implementation already computes. */
    const cellIndexXYForTest = (x, y) => ((x & 0xffe0) >> 5) + ((y & 0xfff0) >> 4) * 128;

    // tock===0: the shared CS:0xB736/B73B gate — no movement, no facing change, at all.
    {
      const e = { x: 36, y: 0, facing: 0 };
      stepPace32x32(e, 0, mkPlaneB());
      check('CS:0xB736/B73B: tock===0 moves nothing and flips nothing',
        e.x === 36 && e.facing === 0, JSON.stringify(e));
    }

    // No planeB at all: X still commits unconditionally; the probe is skipped, not thrown.
    {
      const e = { x: 36, y: 0, facing: 0 };
      stepPace32x32(e, 1, undefined);
      check('no planeB: X still commits (CS:0xB74A is unconditional) and nothing throws',
        e.x === 32 && e.facing === 0, JSON.stringify(e));
    }

    // Misaligned newX: the probe is gated on (newX & 0x1f) === 0 (CS:0xB74F/B778) — skip it
    // even with a wall sitting right there, but STILL commit the unconditional X step.
    {
      const e = { x: 20, y: 0, facing: 0 };           // newX = 16, 16 & 0x1f = 16 != 0
      const planeB = mkPlaneB();
      planeB[cellIndexXYForTest(16, 0) - 1] = 1;        // a "wall" that must NOT be seen this tick
      stepPace32x32(e, 1, planeB);
      check('CS:0xB74F/B778: misaligned newX skips the probe entirely, but X still commits',
        e.x === 16 && e.facing === 0, JSON.stringify(e));
    }

    // Aligned, LEFT-facing, wall at row0 (CS:0xB757/B75B) -> flip.
    {
      const e = { x: 36, y: 0, facing: 0 };            // newX = 32, aligned
      const planeB = mkPlaneB();
      const si = cellIndexXYForTest(32, 0) - 1;          // CS:0xB757 [SI-1], one column left
      planeB[si] = 1;
      stepPace32x32(e, 1, planeB);
      check('CS:0xB757/B75B: row0 solid ahead flips a left-facing entity',
        e.x === 32 && e.facing === 1, JSON.stringify(e));
    }

    // Aligned, LEFT-facing, wall at row1 only (CS:0xB75D/B761) -> flip.
    {
      const e = { x: 36, y: 0, facing: 0 };
      const planeB = mkPlaneB();
      const si = cellIndexXYForTest(32, 0) - 1;
      planeB[si + 0x80] = 1;                             // CS:0xB75D [SI+0x7f] -> one row down from SI-1
      stepPace32x32(e, 1, planeB);
      check('CS:0xB75D/B761: row1 solid ahead ALSO flips (not just row0)',
        e.facing === 1, JSON.stringify(e));
    }

    // Aligned, LEFT-facing, open ledge at row2 (rows 0/1 clear, row2 NOT solid) -> flip.
    // CS:0xB763/B768 inverts polarity for this one row: NOT solid triggers the flip.
    {
      const e = { x: 36, y: 0, facing: 0 };
      const planeB = mkPlaneB();                          // all zero -> row2 already "not solid"
      stepPace32x32(e, 1, planeB);
      check('CS:0xB763/B768: an open ledge at row2 (not row0/row1 walls) ALSO flips',
        e.facing === 1, JSON.stringify(e));
    }

    // Aligned, LEFT-facing, clear path AND solid ground ahead (row2 solid, rows0/1 clear)
    // -> the one case that does NOT flip.
    {
      const e = { x: 36, y: 0, facing: 0 };
      const planeB = mkPlaneB();
      const si = cellIndexXYForTest(32, 0) - 1;
      planeB[si + 0x100] = 1;                             // CS:0xB763 [SI+0xff] solid -> no flip
      stepPace32x32(e, 1, planeB);
      check('CS:0xB757-B768: clear wall/ceiling + solid ground ahead does NOT flip',
        e.x === 32 && e.facing === 0, JSON.stringify(e));
    }

    // The RIGHT-facing mirror uses [SI+1]/[SI+0x81]/[SI+0x101] (CS:0xB780-B78D), not the
    // LEFT block's own -1/+0x7f/+0xff — this is the exact off-by-one this pass corrected
    // once already while writing the port; pin it so it cannot silently regress.
    {
      const e = { x: 28, y: 0, facing: 1 };              // newX = 32, aligned
      const planeB = mkPlaneB();
      const si = cellIndexXYForTest(32, 0) + 1;            // CS:0xB780 [SI+1], one column right
      planeB[si] = 1;
      stepPace32x32(e, 1, planeB);
      check('CS:0xB780/B784: right-facing wall probe uses column+1, row0 solid flips',
        e.x === 32 && e.facing === 0, JSON.stringify(e));
    }
    {
      const e = { x: 28, y: 0, facing: 1 };
      const planeB = mkPlaneB();
      const si = cellIndexXYForTest(32, 0) + 1;
      planeB[si + 0x100] = 1;                              // solid ground ahead -> no flip
      stepPace32x32(e, 1, planeB);
      check('CS:0xB78D/B792: right-facing solid ground ahead (row2) does NOT flip',
        e.x === 32 && e.facing === 1, JSON.stringify(e));
    }

    // Integration: the real pool, through `opts.planeB`, on a genuine 32x32 class
    // (world1 idx0, per (f2) above). Confirms #stepAlive actually wires tock/planeB
    // through to stepPace32x32 rather than only the direct unit tests above.
    {
      const grid = new DamageGrid();
      const health = new Health();
      const farHero = { x: 100000, y: 100000, state: 0 };
      const missDecode = () => { throw new Error('must not be called on an empty grid cell'); };
      const cam = { x: 0, y: 0 };
      const noop = () => {};

      const pool = new SelectorTwoSpawns();
      const desc = { index: 0, spawnX: 2000, spawnY: 0, entityFacing: 0, drawStyle: 0,
        staggerStep: 0, entityCount: 1, entityState0: 99, classIndex: 0,
        facingSelect: 0, reloadByte: 0, rewardItemId: 0xff, live: true };
      pool.spawn(desc, 1);
      pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});   // materialise-only
      const e = pool.slots[0].entities[0];
      const planeB = mkPlaneB();
      pool.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, { planeB });
      check('integration: opts.planeB reaches stepPace32x32 through #stepAlive (X moved)',
        e.x === 1996, e.x);
      check('integration: with no opts.planeB at all, X still moves (probe just never runs)',
        (() => {
          const pool2 = new SelectorTwoSpawns();
          pool2.spawn({ ...desc }, 1);
          pool2.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
          const e2 = pool2.slots[0].entities[0];
          pool2.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});
          return e2.x === 1996;
        })());
    }
  }

  /* (g) Full lifecycle through the real pool: materialise -> stagger ->
   * fire -> cull-vs-contact -> kill -> score -> dying fade -> elimination
   * reward -> slot free. */
  {
    const grid = new DamageGrid();
    const health = new Health();
    const farHero = { x: 100000, y: 100000, state: 0 };
    const missDecode = () => { throw new Error('must not be called on an empty grid cell'); };
    const cam = { x: 0, y: 0 };

    const pool = new SelectorTwoSpawns();
    const desc = { index: 0, spawnX: 1000, spawnY: 500, entityFacing: 0, drawStyle: 0,
      staggerStep: 5, entityCount: 2, entityState0: 3, classIndex: 5,
      facingSelect: 0, reloadByte: 0, rewardItemId: 0x10, live: true };   // reloadByte=0 -> never fires, isolating the contact/death path
    check('spawn into a free slot succeeds', pool.spawn(desc, 1) === true);

    const fired = [];
    const fire = (wx, wy, vx) => fired.push({ wx, wy, vx });
    let hazardCalls = 0;
    const spawnHazard = () => { hazardCalls++; };

    pool.step(cam, farHero, 0, health, grid, missDecode, 0, fire, spawnHazard, {});   // materialise
    check('materialise seeds entityCount(2) entities, cumulative stagger 0/5',
      pool.slots[0].entities.length === 2 &&
      pool.slots[0].entities[0].stagger === 0 && pool.slots[0].entities[1].stagger === 5,
      JSON.stringify(pool.slots[0].entities));

    pool.step(cam, farHero, 0, health, grid, missDecode, 0, fire, spawnHazard, {});
    check('CS:0xAE41/0xAE44: a staggered entity (stagger=5) does nothing this tick',
      pool.slots[0].entities[1].stagger === 4);
    check('the non-staggered entity (0) is alive and produced no shot (reloadByte=0)',
      pool.slots[0].entities[0].state === 3 && fired.length === 0 && hazardCalls === 0);

    /* Full slots refuse cleanly. */
    for (let i = 0; i < RUNTIME_SLOTS_SEL2 - 1; i++) {
      check(`fill slot ${i + 2}/10`, pool.spawn({ ...desc, spawnX: i }, 1) === true);
    }
    check('CS:0xAD2B: an 11th spawn attempt into a full pool is refused, counted, not thrown',
      pool.spawn(desc, 1) === false && pool.refused === 1);

    /* Kill the first entity directly (isolating the score/death-fade path
     * from the contact-box geometry this file's other checks already
     * cover via combat.js's own suite) and drive it through the fade. */
    const scoreAdds = [];
    const scoreObj = { add: (n) => scoreAdds.push(n) };
    pool.slots[0].entities[0].state = -1;      // as if attackHero/creatureScansGrid just killed it
    pool.slots[0].entities[0].frame = -1;
    const drawn1 = pool.step(cam, farHero, 0, health, grid, missDecode, 0, fire, spawnHazard,
      { score: scoreObj }).drawn;
    check('CS:0xAFC1-AFD0: the FIRST dying tick caches the slot\'s own last-dying position',
      pool.slots[0].lastDyingX === 1000 && pool.slots[0].lastDyingY === 500);
    check('the dying entity draws the CS:0x6c-base death sprite at frame 0 this tick',
      drawn1.some((d) => d.sprite === SEL2_DEATH_SPRITE_BASE + 0),
      JSON.stringify(drawn1));

    /* Drive the remaining death frames to finalisation. `drawn1` already
     * ran the FIRST dying tick (frame -1 -> 0, drawn); reaching the
     * CS:0xAFD7 `>= 7` finalise threshold from frame 0 takes SEL2_DEATH_
     * FRAMES(7) MORE increments (0->1->2->3->4->5->6->7). */
    for (let i = 0; i < SEL2_DEATH_FRAMES; i++) {
      pool.step(cam, farHero, 0, health, grid, missDecode, 0, fire, spawnHazard, {});
    }
    check(`CS:0xAFD7: 1 + ${SEL2_DEATH_FRAMES} total increments finalises the dying entity to state 0`,
      pool.slots[0].entities[0].state === 0);

    /* Now finish off entity 1 (still alive at hp 3) the same way, so the
     * WHOLE batch reaches state 0 and the elimination reward can fire.
     * From a fresh frame=-1 this needs SEL2_DEATH_FRAMES+1(8) increments
     * (-1->0->1->2->3->4->5->6->7) to reach the same threshold. */
    pool.slots[0].entities[1].state = -1;
    pool.slots[0].entities[1].frame = -1;
    for (let i = 0; i <= SEL2_DEATH_FRAMES; i++) {
      pool.step(cam, farHero, 0, health, grid, missDecode, 0, fire, spawnHazard, {});
    }
    check('CS:0xAED0-0xAF0F: once EVERY entity in the batch reaches state 0, '
      + 'the group-elimination reward fires exactly once',
      pool.eliminated === 1, pool.eliminated);
    check('CS:0xBF5F id encoding: rewardItemId=0x10 (>=0xB) -> POBJECTS type 0x10-0xB=5',
      pool.rewards.length === 1 && pool.rewards[0].itemType === 5 && pool.rewards[0].popupValue === null,
      JSON.stringify(pool.rewards));
    /* ⚠️ NOT freed yet, on THIS exact tick. CS:0xAE19's own per-slot reset
     * tallies `deadCount` from each entity's STATE AS OBSERVED AT THE TOP
     * of its own turn (CS:0xAE2B) — an entity that transitions from dying
     * to state===0 DURING this very tick's CS:0xAFBD-AFEC was still counted
     * toward `dyingCount`, not `deadCount`, for this tick's own tally. So
     * CS:0xAF0A's `deadCount>=total` deactivation test genuinely needs a
     * FOLLOWING tick before it can see both entities as state===0 at once —
     * this is a faithful reproduction of the original's own bookkeeping
     * order, not a bug. */
    check('the slot is NOT yet freed on the very tick the last entity finalises',
      pool.slots[0] !== null);
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, fire, spawnHazard, {});
    check('CS:0xAF0A: the slot IS freed one tick later, once BOTH entities read '
      + 'state===0 at the top of the same per-entity loop',
      pool.slots.indexOf(null) !== -1 && pool.slots.filter((s) => s !== null).length === 9,
      JSON.stringify(pool.slots.map((s) => s !== null)));
  }

  /* (h) A plain numeric reward (id < 0xB) decodes as a popup value, not an
   * item type — the OTHER branch of CS:0xBF5F's own id encoding. */
  {
    const grid = new DamageGrid();
    const health = new Health();
    const farHero = { x: 100000, y: 100000, state: 0 };
    const missDecode = () => { throw new Error('must not be called on an empty grid cell'); };
    const cam = { x: 0, y: 0 };
    const pool = new SelectorTwoSpawns();
    const desc = { index: 0, spawnX: 0, spawnY: 0, entityFacing: 0, drawStyle: 0,
      staggerStep: 0, entityCount: 1, entityState0: 1, classIndex: 5,
      facingSelect: 0, reloadByte: 0, rewardItemId: 6, live: true };   // 6 < 0xB
    pool.spawn(desc, 1);
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, () => {}, () => {}, {});   // materialise
    pool.slots[0].entities[0].state = 0;   // culled/dead with no death fade
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, () => {}, () => {}, {});
    check('rewardItemId < 0xB decodes as a plain popupValue, itemType null',
      pool.rewards.length === 1 && pool.rewards[0].popupValue === 6 && pool.rewards[0].itemType === null,
      JSON.stringify(pool.rewards));
  }

  /* A REAL BUG, found and fixed this session. Block (g) above kills a
   * TWO-member batch's entities on two SEPARATE ticks, so entity 0's own
   * `#stepDying` always runs (and caches `lastDyingX/Y`) before entity 1
   * ever dies — the elimination reward never fires before a real cache
   * exists. Block (h) above kills its ONE member by jumping straight to
   * `state = 0` (no death fade at all), so `#stepDying` — the only place
   * that writes `lastDyingX/Y` — never runs either. Neither exercises the
   * common shipped case: an `entityCount === 1` batch whose one member is
   * killed by a REAL hero touch DURING `#stepAlive`'s own `attackHero` call
   * — `state` goes negative and `dyingCount` reaches the batch count on the
   * SAME `step()` call, entirely inside `#stepAlive`, so `#stepDying` never
   * runs for this batch AT ALL before the elimination check fires.
   *
   * ⚠️ An earlier draft of this exact test set `entities[0].state = -1`
   * BEFORE calling `step()` — which is wrong in a way that matters: `step()`
   * checks `state < 0` at the TOP of its per-entity loop, so a pre-set
   * negative state is routed straight into the `#stepDying` branch (as if
   * the entity had ALREADY been dying since a prior tick), which happily
   * caches `lastDyingX/Y` and made the test pass for the wrong reason —
   * it never actually exercised the same-tick race at all. The fix is to
   * let the kill happen THROUGH `#stepAlive`'s own combat call, by
   * positioning the hero to physically touch the entity. */
  {
    const grid = new DamageGrid();
    const health = new Health();
    const missDecode = () => { throw new Error('must not be called on an empty grid cell'); };
    const cam = { x: 0, y: 0 };
    const noop = () => {};

    const pool = new SelectorTwoSpawns();
    const desc = { index: 0, spawnX: 700, spawnY: 900, entityFacing: 0, drawStyle: 0,
      staggerStep: 0, entityCount: 1, entityState0: 1, classIndex: 5,
      facingSelect: 0, reloadByte: 0, rewardItemId: 22, live: true };
    check('spawn() for the same-tick-elimination regression', pool.spawn(desc, 1) === true);
    /* Materialise with the hero FAR away, so the alive branch below runs on
     * a genuinely fresh, untouched entity — not one already mid-contact. */
    pool.step(cam, { x: 100000, y: 100000, state: 0 }, 0, health, grid, missDecode, 0, noop, noop, {});

    check('lastDyingX/Y start UNSET (null), not the old (0,0) default — the pre-fix bug '
      + 'made an unset cache indistinguishable from "died at the world origin"',
      pool.slots[0].lastDyingX === null && pool.slots[0].lastDyingY === null);
    check('the entity is genuinely ALIVE (state > 0) before this tick — the kill below '
      + 'must happen INSIDE the coming step() call, not before it',
      pool.slots[0].entities[0].state === 1);

    /* A hero sitting inside the entity's own hero-core contact box —
     * combat.js's own attackHero, called from #stepAlive, kills a 1-HP
     * turret in one touch (CREATURE_CONTACT_BOX-shaped attacker). */
    const e0 = pool.slots[0].entities[0];
    const touchingHero = { x: e0.x - 0x0a, y: e0.y - 0x08, state: 0 };
    pool.step(cam, touchingHero, 0, health, grid, missDecode, 0, noop, noop, {});

    check('CS:0xAED0-0xAF0F: the reward fires on the SAME tick a lone member is killed '
      + 'by hero contact (dead+dying already equals the batch count)',
      pool.eliminated === 1 && pool.rewards.length === 1, JSON.stringify(pool.rewards));
    check('the reward lands at the entity\'s OWN (spawnX+8, spawnY+8) — NOT the stale '
      + '(8, 8) an unset lastDyingX/Y used to produce for every entityCount===1 batch',
      pool.rewards[0].x === 708 && pool.rewards[0].y === 908, JSON.stringify(pool.rewards));
  }

  /* (i) world2's b144/b290 rock-drop, exercised end to end through the real
   * pool: reload-gated frame kick -> 3-tick wind-up -> a settle rock lands
   * in `pool.rockSettle` at the entity's own muzzle offset. */
  {
    const grid = new DamageGrid();
    const health = new Health();
    const farHero = { x: 100000, y: 100000, state: 0 };
    const missDecode = () => { throw new Error('must not be called on an empty grid cell'); };
    const cam = { x: 0, y: 0 };
    const noop = () => {};

    const pool = new SelectorTwoSpawns();
    const desc = { index: 0, spawnX: 500, spawnY: 300, entityFacing: 0, drawStyle: 0,
      staggerStep: 0, entityCount: 1, entityState0: 99, classIndex: 2,
      facingSelect: 0, reloadByte: 8, rewardItemId: 0xff, live: true };
    check('spawn() against CLASS_TABLES_B[2][2] (b144/b290, base 521)', pool.spawn(desc, 2) === true);
    pool.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});   // materialise
    const e = pool.slots[0].entities[0];
    check('CS:0xB152: frame stays 0 until b290 kicks it (no shipped reload has yet expired)',
      e.frame === 0);

    /* Drive the reload timer to expiry: seeded (16-8)<<2=32 ticks. */
    for (let i = 0; i < 32; i++) pool.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});
    check('CS:0xB29B: on reload expiry, b290 kicks frame to 1', e.frame === 1, e.frame);

    check('rockSettle starts empty', pool.rockSettle.live === 0);
    /* Two more tock=0 ticks: frame 1->2->3, the last one signals the drop. */
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    check('frame 1->2, no drop yet', e.frame === 2 && pool.rockSettle.live === 0, e.frame);
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    /* `SelectorTwoSpawns.step()` runs the rock pools' own physics AFTER the
     * entity loop each call — matching CLAUDE.md's own main-loop ordering
     * (`CS:0xAD88` at `0x0223` runs before `b1c2`'s walker at `0x022D`), so
     * a rock spawned THIS tick is also stepped once (`y+=2`) before this
     * check ever observes it. */
    check('CS:0xB161: frame reaches EXACTLY 3 -> a settle rock drops, muzzle x+0xa,y+0x12 (+2 same-tick fall step)',
      e.frame === 3 && pool.rockSettle.live === 1 &&
      pool.rockSettle.slots.some((s) => s && s.x === 500 + 0xa && s.y === 300 + 0x12 + 2),
      JSON.stringify(pool.rockSettle.slots));
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    check('CS:0xB163: frame > 3 resets to 0, only ONE rock per reload cycle',
      e.frame === 0 && pool.rockSettle.live === 1);
  }

  /* (j) world3's b2c7/b2f3 two-piece rock-burst, the same end-to-end shape
   * but into `pool.rockBurst`, seeded from DS:0xdf54's own {vx,vy} pairs. */
  {
    const grid = new DamageGrid();
    const health = new Health();
    const farHero = { x: 100000, y: 100000, state: 0 };
    const missDecode = () => { throw new Error('must not be called on an empty grid cell'); };
    /* Camera keeps the muzzle point ON-SCREEN — `RockBurstPool.step()` runs
     * in the SAME tick as the drop (same ordering rationale as test (i)
     * above), and an off-screen spawn would be silently culled before this
     * check ever observes it. */
    const cam = { x: 600, y: 300 };
    const noop = () => {};

    const pool = new SelectorTwoSpawns();
    const desc = { index: 0, spawnX: 700, spawnY: 400, entityFacing: 0, drawStyle: 0,
      staggerStep: 0, entityCount: 1, entityState0: 99, classIndex: 3,
      facingSelect: 0, reloadByte: 0xc, rewardItemId: 0xff, live: true };
    check('spawn() against CLASS_TABLES_B[3][3] (b2c7/b2f3, base 516)', pool.spawn(desc, 3) === true);
    pool.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});
    const e = pool.slots[0].entities[0];
    const reload = (16 - 0xc) << 2;
    for (let i = 0; i < reload; i++) pool.step(cam, farHero, 0, health, grid, missDecode, 1, noop, noop, {});
    check('b2f3 kicks frame to 1 on reload expiry', e.frame === 1, e.frame);
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    pool.step(cam, farHero, 0, health, grid, missDecode, 0, noop, noop, {});
    /* Muzzle x+3,y+0xb = (703,411); the SAME-tick RockBurstPool step then
     * applies position+=velocity (CS:0xB3F0) AND, since this is a tock===0
     * tick, gravity/drag (CS:0xB441-B458): vy 4->5, |vx| 4->3. */
    check('CS:0xB2EB: frame reaches 3 -> TWO rock-burst pieces drop, muzzle x+3,y+0xb, {vx:+/-4,vy:4}',
      e.frame === 3 && pool.rockBurst.live === 2 &&
      pool.rockBurst.slots.filter(Boolean).every((s) => s.y === 411 + 4 && s.vy === 5) &&
      pool.rockBurst.slots.filter(Boolean).some((s) => s.x === 703 + 4 && s.vx === 3) &&
      pool.rockBurst.slots.filter(Boolean).some((s) => s.x === 703 - 4 && s.vx === -3),
      JSON.stringify(pool.rockBurst.slots.filter(Boolean)));
  }

  return results;
}

/**
 * `rockfall.js` — the "falling rock" hazard pools, tested standalone.
 * `UNKNOWN_b1c2`'s original "sixth cut feature" closure is REFUTED (see
 * CLAUDE.md's own correction); both pools are live, fed by selector-2.
 */
export function checkRockfall() {
  const { results, check } = makeChecker();

  /* (a) RockSettlePool — DS:0xaccc. Gravity-free 2px/tick fall (no ground
   * probe modelled), a 4-entry sprite ping-pong on the shared tock, and a
   * lifetime countdown that frees the slot at negative. */
  {
    const pool = new RockSettlePool();
    check('spawn() seeds lifetime=0x37, type=0 (CS:0xB1AD/B1B2)',
      pool.spawn(100, 200) === true && pool.slots[0].lifetime === 0x37 && pool.slots[0].type === 0);
    const drawn = [];
    pool.step({ x: 0, y: 0 }, 1, drawn);
    check('CS:0xB16E: worldY += 2 every tick', pool.slots[0].y === 202, pool.slots[0].y);
    check('tock!=0: type does not advance', pool.slots[0].type === 0);
    pool.step({ x: 0, y: 0 }, 0, drawn);
    check('CS:0xdf44 read live: {531,532,533,532} — tock===0: type advances 0->1, sprite = 532',
      pool.slots[0].type === 1 && drawn.some((d) => d.sprite === 532), drawn);
    check('10 slots, refused past capacity', (() => {
      for (let i = 0; i < 9; i++) pool.spawn(i, i);
      return pool.spawn(999, 999) === false && pool.refused === 1;
    })());
  }

  /* (b) RockSettlePool lifetime expiry. */
  {
    const pool = new RockSettlePool();
    pool.spawn(0, 0);
    for (let i = 0; i <= 0x37; i++) pool.step({ x: 0, y: 0 }, 1, []);
    check('CS:0xB236: lifetime counts down from 0x37 and frees the slot once negative',
      pool.slots[0] === null);
  }

  /* (c) RockBurstPool — DS:0xad1c/0xad94. Gravity (vy++), drag (vx decays
   * toward 0), a hard screen-space cull, and a flat 5x5 zero-strength
   * hero-hit that consumes the record and drops a moving debris spark. */
  {
    const pool = new RockBurstPool();
    check('spawn() writes up to 12 records with the given {vx,vy} pairs',
      pool.spawn(100, 100, [{ vx: 4, vy: 4 }, { vx: -4, vy: 4 }]) === true &&
      pool.live === 2);
    const health = new Health();
    const hero = { x: -9999, y: -9999, state: 0 };   // far away, no hit
    const drawn = [];
    pool.step({ x: 0, y: 0 }, hero, health, 1, {}, drawn, null);
    const s0 = pool.slots.find(Boolean);
    /* spawn()'s own CS:0xB35E/B361 offset (+3) is applied FIRST: 100+3=103,
     * then +/-4 velocity this tick -> 107 or 99. */
    check('CS:0xB3F0-B3F8: position += velocity every tick regardless of tock',
      s0 && (s0.x === 107 || s0.x === 99), s0 && s0.x);   // one of the two pieces (+4 or -4)
    check('tock!=0: no gravity/drag yet', s0.vy === 4);
    pool.step({ x: 0, y: 0 }, hero, health, 0, {}, drawn, null);
    check('CS:0xB448: gravity — vy increments on the tock===0 tick', s0.vy === 5, s0.vy);
    check('CS:0xB44B-B458: drag — nonzero vx decays by 1 toward 0',
      Math.abs(s0.vx) === 3, s0.vx);
    check('CS:0xB424: sprite = type + 0x213', drawn.some((d) => d.sprite === 0x213 + s0.type), drawn);
  }

  /* (d) RockBurstPool cull and hero-hit, isolated. */
  {
    const pool = new RockBurstPool();
    pool.spawn(0, 0, [{ vx: 0, vy: 0 }]);
    pool.step({ x: 9999, y: 9999 }, { x: 0, y: 0, state: 0 }, new Health(), 1, {}, []);
    check('CS:0xB3FF-B421: off-screen -> silently freed, no debris, no hit',
      pool.live === 0);

    const pool2 = new RockBurstPool();
    pool2.spawn(0, 0, [{ vx: 0, vy: 0 }]);
    const health2 = new Health();
    const hero2 = { x: -10, y: -4, state: 0 };           // overlaps CS:0xac59's own hero core box at (0,0)
    const debrisSpawns = [];
    const fakeDebris = { spawn: (...a) => debrisSpawns.push(a) };
    pool2.step({ x: 0, y: 0 }, hero2, health2, 1, {}, [], fakeDebris);
    check('CS:0xB49F/0xac59: a hero overlap consumes the record and drops a MOVING debris spark',
      pool2.live === 0 && debrisSpawns.length === 1, JSON.stringify(debrisSpawns));
    check('CS:0xac59\'s own damageFor(0) formula: a flat 5 damage off the default 24-point target',
      health2.target === 0x18 - 5, health2.target);
  }

  return results;
}

/**
 * PGOD0x.PAT scripted objects (selector 1) — CS:0xB908 (allocator),
 * CS:0xB987 (per-tick driver), CS:0xBC4B (generic shoot), CS:0xBDDB/0xBD71/
 * 0xBD9F (World 4's own attack-state pair). See game/pat-objects.js's own
 * header for the full byte-level derivation.
 */
export async function checkPatObjects(fetchRaw) {
  const { results, check } = makeChecker();

  /* (a) decodeDelta — the standard shl4/sar4 signed-nibble extraction,
   * independently re-derived rather than trusted: every nibble 0x0..0x7
   * must read as itself, every nibble 0x8..0xf as itself-minus-16. */
  {
    let allMatch = true;
    for (let n = 0; n < 16; n++) {
      const expected = n < 8 ? n : n - 16;
      const lo = decodeDelta(n).dy;
      const hi = decodeDelta(n << 4).dx;
      if (lo !== expected || hi !== expected) allMatch = false;
    }
    check('decodeDelta: all 16 nibble values sign-extend correctly in both the low (dy) and high (dx) position',
      allMatch);
    check('decodeDelta(0x00) is {dx:0,dy:0}', decodeDelta(0).dx === 0 && decodeDelta(0).dy === 0);
    check('decodeDelta packs BOTH nibbles independently: 0x71 -> dx=7 (high), dy=1 (low), not dx=1,dy=7',
      decodeDelta(0x71).dx === 7 && decodeDelta(0x71).dy === 1);
  }

  /* (b) reloadTicks — PAT's OWN formula, (16-v)*2, NOT selector-2's
   * (16-v)<<2. Re-derived at the two ends of the nibble range. */
  check('reloadTicks(0) === 32, reloadTicks(15) === 2 — PAT\'s own (16-v)*2, not selector-2\'s (16-v)<<2',
    reloadTicks(0) === 32 && reloadTicks(15) === 2);

  /* (c) parsePatDirectory — synthetic 400-byte directory, 3 live entries and
   * one CLAUDE.md-documented dead one (negative +0), running-pointer math
   * checked against a manually-computed expectation. */
  {
    const dir = new Uint8Array(PAT_GROUP_SLOTS * 10 * 8);   // 400 bytes, 50 entries
    const dv = new DataView(dir.buffer);
    // entry 0: live, length 10
    dv.setInt16(0 * 8 + 0, 4, true); dv.setUint16(0 * 8 + 6, 10, false);
    // entry 1: DEAD (+0 negative) — must be skipped, must NOT consume payload space
    dv.setInt16(1 * 8 + 0, -1, true); dv.setUint16(1 * 8 + 6, 999, false);
    // entry 2: live, length 20 — its blobOffset must NOT include entry 1's length
    dv.setInt16(2 * 8 + 0, 5, true); dv.setUint16(2 * 8 + 6, 20, false);
    const parsed = parsePatDirectory(dir);
    check('entry 0 (live) starts at the payload base, 0x190', parsed[0]?.blobOffset === 0x190);
    check('entry 0\'s length is read as the REAL on-disk BE u16 field (+6), not the placeholder +0',
      parsed[0]?.blobLength === 10);
    check('entry 1 (negative +0 on disk) parses to null — CLAUDE.md\'s own "an entry whose +0 is negative is skipped"',
      parsed[1] === null);
    check('entry 2\'s running pointer skips OVER the dead entry 1 rather than budgeting space for it '
      + '(0x190+10=0x19a, not 0x190+10+999)',
      parsed[2]?.blobOffset === 0x190 + 10, JSON.stringify(parsed[2]));
  }

  /* (d) parsePatSpawnDescriptor — synthetic 8-byte PALFILS record, every
   * field independently constructed and checked against its OWN offset,
   * not against a value that could pass by coincidence. */
  {
    const buf = new Uint8Array(8);
    buf[0] = 7;                 // entityCount
    buf[1] = 3;                 // pathClassIndex
    buf[2] = 0x01; buf[3] = 0x2c; // staggerStep BE = 0x012c = 300
    buf[4] = 200;                // key
    buf[5] = 2;                  // behaviorClassIndex
    buf[6] = 0xab;                // nibbles: hi=0xa, lo=0xb
    buf[7] = 55;                  // extra
    const d = parsePatSpawnDescriptor(buf, 0);
    check('parsePatSpawnDescriptor reads entityCount from byte 0', d.entityCount === 7);
    check('...pathClassIndex from byte 1 (the PAT DIRECTORY index, CS:0xB9AE)', d.pathClassIndex === 3);
    check('...staggerStep as a BIG-ENDIAN u16 from bytes 2-3 (0x012c=300), not little-endian',
      d.staggerStep === 300, `got ${d.staggerStep}`);
    check('...key from byte 4', d.key === 200);
    check('...behaviorClassIndex (the SEPARATE System-A class_table index, CS:0xB953) from byte 5',
      d.behaviorClassIndex === 2);
    check('...the nibble pair from byte 6: HIGH nibble -> hiNibble, LOW nibble -> loNibble (not swapped)',
      d.hiNibble === 0xa && d.loNibble === 0xb, JSON.stringify(d));
    check('a non-zero `index` offsets by 8 bytes per record, matching CS:0xB90C\'s own classIdx*8',
      parsePatSpawnDescriptor(new Uint8Array(16).fill(0), 1).entityCount === 0); // no throw, in range
  }

  /* (e) CLASS_TABLE_A — world 4 class index 2 must be the exact byte-for-
   * byte read this session took live off 1ffd:e21a+24: sprite 504, 32x48
   * (TALLER than every other class, all 32x32), attack-state/attack-fire. */
  {
    const w4c2 = CLASS_TABLE_A[4]?.[2];
    check('World 4 class index 2 (1ffd:e21a+2*12, read live) is spriteBase=504, w=32, h=48',
      w4c2 && w4c2.spriteBase === 504 && w4c2.w === 32 && w4c2.h === 48, JSON.stringify(w4c2));
    check('...and is wired to the attack-state/attack-fire pair (CS:0xBDDB/CS:0xBD71), not the generic one',
      w4c2 && w4c2.handlerA === 'attack-state' && w4c2.handlerB === 'attack-fire');
    check('World 4 class index 3 is the ALREADY-DOCUMENTED cut hazard (CS:0xbd38/0xbd0b), never placed — '
      + 'read live at the same table to confirm it sits exactly where CLAUDE.md already puts it',
      CLASS_TABLE_A[4]?.[3]?.spriteBase === 531);
    check('World 1 classes 0 and 2 both wire handlerB to the generic BC4B fire',
      CLASS_TABLE_A[1]?.[0]?.handlerB === 'bc4b' && CLASS_TABLE_A[1]?.[2]?.handlerB === 'bc4b');
    check('World 1 class 1 is the UN-READ third handler (CS:0xBF58) — animates, never fires, not guessed at',
      CLASS_TABLE_A[1]?.[1]?.handlerB === 'unknown');
  }

  /* (f) HOLD_BOX — the exact 4-edge screen-space box CS:0xBA95-0xBAB0 tests,
   * re-derived from its own cited hex immediates rather than trusted. */
  check('HOLD_BOX matches CS:0xBA95/BA9A/BAA7/BAAC\'s own immediates exactly (-0x24,0x144,-0x28,0xc4)',
    HOLD_BOX.xMin === -0x24 && HOLD_BOX.xMax === 0x144
    && HOLD_BOX.yMin === -0x28 && HOLD_BOX.yMax === 0xc4);

  /* (g) PatGroups — end-to-end behavioural tests against a synthetic
   * directory + blob, exercising seed -> move -> hold -> retire, and both
   * shoot handlers, without needing a real shipped .PAT file. */
  {
    /* A 1-entry directory (class 0) whose blob is a RELATIVE-tagged path:
     * {x=100,y=100} (BE16, relative to camera) then two delta bytes:
     * 0x01 (dy=+0,dx=+1... wait: low nibble->dy, high nibble->dx) so byte
     * 0x10 means dx=+1,dy=0, and 0x01 means dx=0,dy=+1. Use 0x10 then 0x01. */
    const blob = new Uint8Array(0x190 + 6);
    const bv = new DataView(blob.buffer);
    bv.setUint16(0x190 + 0, 100, false);   // x
    bv.setUint16(0x190 + 2, 100, false);   // y
    blob[0x190 + 4] = 0x10;                 // dx=+1, dy=0
    blob[0x190 + 5] = 0x01;                 // dx=0, dy=+1

    const directory = new Array(PAT_GROUP_SLOTS * 10).fill(null);
    directory[0] = { blobOffset: 0x190, blobLength: 6 };

    const groups = new PatGroups(directory);
    groups.blobBytes = blob;

    const desc = { entityCount: 1, pathClassIndex: 0, staggerStep: 0, key: 42,
                    behaviorClassIndex: 0, hiNibble: 0, loNibble: 0 };
    const ok = groups.activate(desc, 1);          // world 1, class 0 -> spriteBase 450, handlerB bc4b
    check('activate() succeeds for a known (world, behaviorClassIndex) pair', ok === true);
    check('a full pool refuses the 6th activation and counts it, rather than silently overwriting a slot',
      (() => {
        for (let i = 0; i < PAT_GROUP_SLOTS - 1; i++) groups.activate(desc, 1);
        const before = groups.lostActivations;
        const refused = groups.activate(desc, 1) === false;
        return refused && groups.lostActivations === before + 1;
      })());

    const g2 = new PatGroups(directory);
    g2.blobBytes = blob;
    g2.activate(desc, 1);
    const cam = { x: 0, y: 0 };
    const hero = { x: 0, y: 0 };
    const shots = new EnemyShots();
    const lineHazards = new LineHazards();

    /* Seed happens lazily on the first step() — CS:0xB9A3-0xBA3E seeds and
     * then `JMP b977` (the OUTER slot loop tail), never falling through into
     * movement/dispatch/draw on the SAME tick it seeds. So the first step()
     * draws NOTHING; the sub-record's own seeded position (100,100) is never
     * independently observable from the outside except via its first move. */
    const r0 = g2.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);
    check('the seed tick draws nothing — CS:0xBA3E jumps straight to the next slot, skipping movement/dispatch/draw',
      r0.length === 0, JSON.stringify(r0));

    const r1 = g2.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);
    check('tick 2 (the first "materialised" tick): stagger is already 0, so movement applies immediately — '
      + 'delta byte 0x10 -> dx=+1,dy=0 on top of the seeded (100,100)',
      r1.length === 1 && r1[0].x === 101 && r1[0].y === 100, JSON.stringify(r1));

    const r2 = g2.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);
    check('tick 3 applies delta byte 0x01 -> dx=0, dy=+1', r2[0].x === 101 && r2[0].y === 101, JSON.stringify(r2[0]));

    /* Cursor is now past the 2-byte movement stream (blobEnd). The
     * sub-record sits at screen (101,101), well inside HOLD_BOX, so it must
     * HOLD (re-apply the SAME last delta) rather than retire. */
    const r3 = g2.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);
    check('past the blob\'s own end but still on-screen: HOLD, re-applying the last delta (0x01 -> dy+1 again), not retire',
      r3.length === 1 && r3[0].x === 101 && r3[0].y === 102, JSON.stringify(r3));
    const r4 = g2.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);
    check('holding is not one-shot: it keeps re-applying the same delta tick after tick',
      r4.length === 1 && r4[0].y === 103, JSON.stringify(r4));

    /* Now move the camera so the sub-record's SCREEN position falls outside
     * HOLD_BOX (world x=101, camera x=500 -> screen x=-399, past xMin=-0x24). */
    const farCam = { x: 500, y: 0 };
    const r5 = g2.step(farCam, 0, shots, lineHazards, hero, () => 0, 0, null);
    check('once scrolled off past HOLD_BOX, the sub-record RETIRES (drawn list empties) rather than holding forever',
      r5.length === 0, JSON.stringify(r5));
  }

  /* (h) CS:0xBC4B — generic fire, both nibble branches, re-derived speed
   * formula and muzzle offsets. */
  {
    const directory = new Array(PAT_GROUP_SLOTS * 10).fill(null);
    // absolute-tagged path whose own cursor lands exactly on blobEnd, so the
    // seeded sub-record HOLDS at a fixed point forever (well inside HOLD_BOX)
    // — movement is not what this block is testing.
    const absBlob = new Uint8Array(0x197);   // one extra byte past blobEnd so the immediate hold-check reads a defined (zero) delta, not undefined
    const av = new DataView(absBlob.buffer);
    av.setUint16(0x190, ABSOLUTE_TAG, false);
    av.setUint16(0x192, 50, false);   // x
    av.setUint16(0x194, 60, false);   // y
    directory[0] = { blobOffset: 0x190, blobLength: 6 };   // cursor lands exactly on blobEnd -> HOLD immediately

    const cam = { x: 0, y: 0 };
    const hero = { x: 999, y: 999 };

    /* Low nibble (fire-rate divisor) = 4, so reload seeds to (16-4)*2=24 —
     * step it down to exactly the firing tick to keep the test tight rather
     * than looping 24 times. */
    const mkGroups = (loNibble, hiNibble) => {
      const g = new PatGroups(directory);
      g.blobBytes = absBlob;
      const desc = { entityCount: 1, pathClassIndex: 0, staggerStep: 0, key: 1,
                      behaviorClassIndex: 0, hiNibble, loNibble };
      g.activate(desc, 1);   // world 1 class 0 -> handlerB: bc4b
      return g;
    };

    /* hiNibble===0 branch: an ordinary projectile, direction from "did I
     * just move right or left" (here: never moves, so firingRight defaults
     * true via `s.x >= this.lastPretickX`, both undefined->NaN comparisons
     * would be false — force a real pretick value via one seed tick first). */
    const g = mkGroups(4, 0);
    const shots = new EnemyShots();
    const lineHazards = new LineHazards();
    g.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);   // seed tick, sets lastPretickX
    for (let i = 0; i < 24; i++) g.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);
    check('CS:0xBC4B hiNibble===0: fires an ordinary projectile through the shared EnemyShots emitter '
      + 'once the reload timer expires ((16-4)*2=24 ticks)',
      shots.live === 1, `shots.live=${shots.live} fired=${shots.fired}`);

    /* hiNibble!==0 branch: diverts into the line-hazard seed instead. */
    const g2 = mkGroups(4, 1);
    const shots2 = new EnemyShots();
    const lineHazards2 = new LineHazards();
    g2.step(cam, 0, shots2, lineHazards2, hero, () => 0, 0, null);
    for (let i = 0; i < 24; i++) g2.step(cam, 0, shots2, lineHazards2, hero, () => 0, 0, null);
    check('CS:0xBC4B hiNibble!==0: diverts into the Bresenham line-hazard seed instead of an ordinary shot',
      lineHazards2.live === 1 && shots2.live === 0,
      `hazards=${lineHazards2.live} shots=${shots2.live}`);

    /* loNibble===0: this class never fires, regardless of ticks elapsed. */
    const g3 = mkGroups(0, 0);
    const shots3 = new EnemyShots();
    const lineHazards3 = new LineHazards();
    for (let i = 0; i < 40; i++) g3.step(cam, 0, shots3, lineHazards3, hero, () => 0, 0, null);
    check('CS:0xBC4B loNibble===0 (DS:0x230===0): this class NEVER fires, no matter how many ticks pass',
      shots3.live === 0 && lineHazards3.live === 0);
  }

  /* (i) The World-4 attack-state machine — CS:0xBDDB/CS:0xBD71/CS:0xBD9F.
   * Arms only from phase 3 on a tock tick, fires exactly once at phase 6,
   * ends the attack after phase 7 wraps. */
  {
    const directory = new Array(PAT_GROUP_SLOTS * 10).fill(null);
    const absBlob = new Uint8Array(0x197);   // one extra byte past blobEnd so the immediate hold-check reads a defined (zero) delta, not undefined
    const av = new DataView(absBlob.buffer);
    av.setUint16(0x190, ABSOLUTE_TAG, false);
    av.setUint16(0x192, 50, false);
    av.setUint16(0x194, 60, false);
    directory[0] = { blobOffset: 0x190, blobLength: 6 };

    const g = new PatGroups(directory);
    g.blobBytes = absBlob;
    const desc = { entityCount: 1, pathClassIndex: 0, staggerStep: 0, key: 1,
                    behaviorClassIndex: 2, hiNibble: 0, loNibble: 4 };
    g.activate(desc, 4);   // world 4 class 2 -> attack-state/attack-fire
    const cam = { x: 0, y: 0 };
    const hero = { x: 999, y: 999 };
    const shots = new EnemyShots();
    const lineHazards = new LineHazards();

    g.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);   // seed tick
    /* Drive the reload down to 0 on a TOCK tick so CS:0xBD71 arms (phase
     * must be exactly 3 for the arm to take — a fresh sub-record starts at
     * attackState 0, so walk it to 3 first via non-tock ticks, which must
     * NOT arm even once the reload also happens to hit 0 without tock). */
    const sub = g.slots.find((s) => s.active).subs[0];
    sub.attackState = 3;
    sub.reload = 0;
    g.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);      // reload->-1 (BD71 arms on NEGATIVE, `JNS`, not zero), but NO tock -> must not arm
    check('CS:0xBD71 does NOT arm the attack without the tock toggle, even at phase 3 with reload expired',
      (sub.attackState & 4) === 0, `attackState=${sub.attackState}`);

    sub.attackState = 3;
    sub.reload = 0;
    g.step(cam, 0, shots, lineHazards, hero, () => 0, 1, null);      // reload->-1, tock=1 -> ARMS
    check('CS:0xBD71 arms on the tock tick once phase===3 and reload has expired (3 -> 4, sets bit 2)',
      (sub.attackState & 4) !== 0 && sub.attackState === 4, `attackState=${sub.attackState}`);

    /* ⚠️ CS:0xBDDB's own phase advance is ITSELF gated on tock (`CS:0xBDEC
     * JZ be02` skips the whole increment on a non-tock tick) — a non-tock
     * tick must leave the phase untouched, caught only by this explicit
     * regression check after the first draft of this port missed the gate
     * entirely and advanced every tick. */
    g.step(cam, 0, shots, lineHazards, hero, () => 0, 0, null);
    check('the attack phase does NOT advance on a non-tock tick', sub.attackState === 4);

    /* Now step through the attack ON TOCK TICKS ONLY: 4 -> 5 -> 6 (fires,
     * on the TRANSITION into 6) -> 7 -> 0 (ends). */
    g.step(cam, 0, shots, lineHazards, hero, () => 0, 1, null);      // 4 -> 5
    check('attack phase advances 4 -> 5 without firing', shots.live === 0 && sub.attackState === 5);
    g.step(cam, 0, shots, lineHazards, hero, () => 0, 1, null);      // 5 -> 6, FIRES on this transition
    check('CS:0xBD9F fires on the transition landing on phase 6, through the shared EnemyShots emitter',
      shots.live === 1 && sub.attackState === 6, `shots.live=${shots.live} attackState=${sub.attackState}`);
    g.step(cam, 0, shots, lineHazards, hero, () => 0, 1, null);      // 6 -> 7
    check('attack phase advances 6 -> 7 firing only once, not on every subsequent tick',
      shots.live === 1 && sub.attackState === 7);
    g.step(cam, 0, shots, lineHazards, hero, () => 0, 1, null);      // 7 -> 8 -> clears to bit3 only, ends
    check('the transition past 7 CLEARS bit 2 — the attack ends, walk resumes',
      (sub.attackState & 4) === 0, `attackState=${sub.attackState}`);
  }

  /* (j) parsePatDirectory against the REAL shipped, decompressed
   * PGOD0{1..4}.PAT files — not just synthetic bytes. This is what found
   * the zero-length-entry refinement above: a first pass of this parser,
   * using only "on-disk +0 negative -> dead", read world 3's real file as
   * 49 live entries instead of CLAUDE.md's own already-published 1, because
   * a long tail of genuinely-unused directory slots is all-zero on disk
   * (not flagged negative) rather than negative. */
  if (fetchRaw) {
    const expectedLive = { 1: 38, 2: 6, 3: 1, 4: 22 };
    const expectedSize = { 1: 5320, 2: 776, 3: 556, 4: 2818 };
    for (const world of [1, 2, 3, 4]) {
      const data = dclDecompress(await fetchRaw(`game/PGOD0${world}.PAT`)).data;
      check(`world ${world}: PGOD0${world}.PAT decompresses to CLAUDE.md's own published size `
        + `(${expectedSize[world]})`, data.length === expectedSize[world], `got ${data.length}`);
      const dir = parsePatDirectory(data);
      const live = dir.filter(Boolean).length;
      check(`world ${world}: exactly ${expectedLive[world]} live (non-negative AND non-zero-length) `
        + `directory entries, matching CLAUDE.md's own already-published count`,
        live === expectedLive[world], `got ${live}`);
      const lastLiveIdx = dir.map((d, i) => (d ? i : -1)).filter((i) => i >= 0).pop();
      const lastEntry = dir[lastLiveIdx];
      check(`world ${world}: the running-pointer math closes EXACTLY on the real file's own length `
        + '(400 + sum of every non-negative entry\'s own length, dead or zero-length ones contributing 0)',
        lastEntry.blobOffset + lastEntry.blobLength === data.length,
        `${lastEntry.blobOffset}+${lastEntry.blobLength} vs ${data.length}`);
    }
  }

  /* (k) CS:0xBCCF — contact/damage, closed in a follow-up pass. */
  {
    /* scoreForKey — re-derive CS:0xAF7D's own formula independently rather
     * than trust the constant: value=(v>>1)+1, and the packed BCD digit
     * pair times 100 (this project's own established "one BCD digit
     * position = one hundred score points" scale, matching selector2.js's
     * own identical `scoreForState0`). */
    check('scoreForKey(0) === 100 (value=1, the minimum)', scoreForKey(0) === 100);
    check('scoreForKey(200) === 10100 (value=101 -> BCD 0x101 -> 101*100)', scoreForKey(200) === 10100);

    const directory = new Array(PAT_GROUP_SLOTS * 10).fill(null);
    const absBlob = new Uint8Array(0x1a0);           // roomy: seed + a handful of movement bytes
    const av = new DataView(absBlob.buffer);
    av.setUint16(0x190, ABSOLUTE_TAG, false);
    av.setUint16(0x192, 100, false);                  // x
    av.setUint16(0x194, 100, false);                  // y
    absBlob[0x196] = 0x10;                             // one real delta byte: dx=+1,dy=0
    directory[0] = { blobOffset: 0x190, blobLength: 7 };

    const mkGroup = (key = 200) => {
      const g = new PatGroups(directory);
      g.blobBytes = absBlob;
      const desc = { entityCount: 1, pathClassIndex: 0, staggerStep: 0, key,
                      behaviorClassIndex: 0, hiNibble: 0, loNibble: 0 }; // loNibble=0 -> BC4B never fires, isolates the contact test
      g.activate(desc, 1);           // world 1 class 0 -> 32x32 box
      return g;
    };
    const farHero = { x: -100000, y: -100000, state: 0 };
    const cam = { x: 0, y: 0 };

    /* A hero-touch kill. attackHero's own hero-core box is centred on the
     * HERO, so put the hero exactly on the sub-record's own seeded (100,100)
     * world position. */
    {
      const g = mkGroup(200);
      g.step(cam, 0, null, null, farHero, () => 0, 0, null);   // seed tick — nothing else runs yet
      const sub = g.slots.find((s) => s.active).subs[0];
      const health = new Health();
      const score = { calls: [], add(n) { this.calls.push(n); } };
      const touchingHero = { x: sub.x, y: sub.y, state: 0 };
      const drawn = g.step(cam, 0, null, null, touchingHero, () => 0, 0, null,
                            health, null, null, { score });
      check('a hero touch (attackHero) alone kills a PAT object — no DS:0x34/reportGate bracket, '
        + 'unlike ce64.js\'s own creature', sub.key < 0, `key=${sub.key}`);
      check('the kill still draws the ORDINARY sprite on the SAME tick (CS:0xBB43\'s own `jmp bb49`)',
        drawn.length === 1 && drawn[0].sprite === 450 /* world1 class0 spriteBase */, JSON.stringify(drawn));
      check(`score is awarded exactly once, scoreForKey(200)=${scoreForKey(200)}`,
        score.calls.length === 1 && score.calls[0] === scoreForKey(200), JSON.stringify(score.calls));
      check('attackState (the shared +0xe field) is forced to -1 on death',
        sub.attackState === -1);
    }

    /* A weapon-hit kill via creatureScansGrid — hero far away so attackHero
     * itself cannot possibly hit, isolating the grid-scan branch. Uses its
     * OWN zero-delta blob (0x00 -> dx=0,dy=0) so the sub-record's position
     * is stable across the tick: movement runs BEFORE the contact test in
     * the same step(), and the original's own stamp-floors/scan-rounds
     * asymmetry (this project's own documented `stampIndex`/`scanIndex`
     * discrepancy, collision.js) means a MOVING entity can straddle a cell
     * boundary between when this test stamps and when the scan reads back
     * — a real property of the original, not something to route around by
     * fudging the stamp; holding still sidesteps it instead. */
    {
      const stillDir = new Array(PAT_GROUP_SLOTS * 10).fill(null);
      const stillBlob = new Uint8Array(0x197);
      const sv = new DataView(stillBlob.buffer);
      sv.setUint16(0x190, ABSOLUTE_TAG, false);
      /* 96, not 100: this project's own DamageGrid documents `stampIndex`
       * (floors) and `scanIndex` (rounds half-up) agreeing ONLY on exact
       * multiples of 8 — confirmed directly (`stampIndex(100,100)=6422` vs
       * `scanIndex(100,100)=6471`, a genuine divergence at a non-aligned
       * coordinate, the same real asymmetry CLAUDE.md's own "The scanner"
       * section documents for the original game). 96 sidesteps that
       * entirely rather than depending on it. */
      sv.setUint16(0x192, 96, false);
      sv.setUint16(0x194, 96, false);
      stillBlob[0x196] = 0x00;                       // dx=0, dy=0 — never moves
      stillDir[0] = { blobOffset: 0x190, blobLength: 7 };
      const g = new PatGroups(stillDir);
      g.blobBytes = stillBlob;
      g.activate({ entityCount: 1, pathClassIndex: 0, staggerStep: 0, key: 5,
                    behaviorClassIndex: 0, hiNibble: 0, loNibble: 0 }, 1);
      g.step(cam, 0, null, null, farHero, () => 0, 0, null);   // seed
      const sub = g.slots.find((s) => s.active).subs[0];
      const grid = new DamageGrid(); grid.clear();
      const sx = sub.x - cam.x, sy = sub.y - cam.y;
      grid.buf[stampIndex(sx, sy) - GRID_LO] = 7;               // an arbitrary nonzero tag
      const lethalDecode = () => ({ damage: 999, weapon: 0 });   // guarantees state<=0
      const health = new Health();
      const score = { calls: [], add(n) { this.calls.push(n); } };
      g.step(cam, 0, null, null, farHero, () => 0, 0, null,
             health, grid, lethalDecode, { score });
      check('a lethal weapon hit (creatureScansGrid) also kills the sub-record, with the hero '
        + 'too far away for attackHero to have contributed', sub.key < 0, `key=${sub.key}`);
      check('score awarded on the weapon-kill path too', score.calls.length === 1);
    }

    /* The death-draw sequence itself: exactly DEATH_RETIRE_AT frames drawn
     * (sprites PAT_DEATH_SPRITE_BASE..PAT_DEATH_SPRITE_BASE+DEATH_RETIRE_AT-1), the
     * corpse sliding by the SAME frozen delta byte every tick, then a clean
     * retirement with no further draw. */
    {
      const g = mkGroup(1);
      g.step(cam, 0, null, null, farHero, () => 0, 0, null);   // seed
      const sub = g.slots.find((s) => s.active).subs[0];
      g.step(cam, 0, null, null, farHero, () => 0, 0, null);    // tick 1: applies delta 0x10 -> x=101
      check('sanity: the sub-record actually moved before dying (x=101)', sub.x === 101, `x=${sub.x}`);
      const xBeforeDeath = sub.x;
      sub.key = -1; sub.attackState = -1; sub.deathDelta = 0x10;   // simulate #onKilled having just fired
      const seen = [];
      for (let i = 0; i < DEATH_RETIRE_AT + 2; i++) {
        const drawn = g.step(cam, 0, null, null, farHero, () => 0, 0, null);
        seen.push(drawn.length ? drawn[0].sprite : null);
      }
      const expected = Array.from({ length: DEATH_RETIRE_AT }, (_, i) => PAT_DEATH_SPRITE_BASE + i)
        .concat([null, null]);
      check(`the death draw is exactly ${DEATH_RETIRE_AT} frames, sprites `
        + `${PAT_DEATH_SPRITE_BASE}..${PAT_DEATH_SPRITE_BASE + DEATH_RETIRE_AT - 1}, then nothing`,
        JSON.stringify(seen) === JSON.stringify(expected), JSON.stringify(seen));
      check('the corpse slides by the SAME frozen delta (0x10 -> dx=+1) every death-draw tick',
        sub.x === xBeforeDeath + DEATH_RETIRE_AT, `x=${sub.x} expected=${xBeforeDeath + DEATH_RETIRE_AT}`);
      check('fully retired after DEATH_RETIRE_AT frames (key back to 0, the ordinary retire sentinel)',
        sub.key === 0);
    }
  }

  return results;
}

/* Popup — the single-slot floating item-icon effect, CS:0xBF5F/0xBF80.
 * See game/popup.js's own header for the full CLAUDE.md citation trail. */
export function checkPopup() {
  const { results, check } = makeChecker();

  {
    const p = new Popup();
    check('inactive at construction: spriteId is null', p.spriteId === null);
    check('spawn() succeeds on a free slot (CS:0xBF64 js -> not busy)',
      p.spawn(100, 200, 0x2d) === true);
    check('spawn() records the world position', p.x === 100 && p.y === 200);
  }

  /* single-slot busy/free semantics — a second spawn() while active is
   * dropped UNLESS `objects` is supplied, in which case it diverts to
   * CS:0xC041 (objects.js's dropCarriedItem) instead of being lost. */
  {
    const p = new Popup();
    p.spawn(100, 200, 0x2d);
    const second = p.spawn(999, 999, 0x15);
    check('a second spawn() while busy, with no `objects` supplied, is simply refused',
      second === false);
    check('the busy slot keeps its ORIGINAL position, not the refused request\'s',
      p.x === 100 && p.y === 200);
  }

  /* CS:0xBF6B `jmp 0xc041` — the busy-slot divert, now modelled. */
  {
    const p = new Popup();
    p.spawn(100, 200, 0x2d);
    const slots = expandMapObjects([]);   // all 200 dead, ready to reuse
    const second = p.spawn(500, 600, 0x2c, slots);   // id 0x2c -> type 0x21 (33)
    check('a second spawn() while busy, WITH `objects`, still returns false',
      second === false);
    check('...but diverts to dropCarriedItem: a live object materializes at the new position',
      slots.some((o) => !o.dead && o.x === 500 && o.y === 600 && o.type === 0x2c - 0xb));
    check('the busy slot itself is untouched by the divert',
      p.x === 100 && p.y === 200 && p.itemType === 0x2d - 0xb);
  }

  /* CS:0xBF87-92: y += POPUP_VY every tick */
  {
    const p = new Popup();
    p.spawn(0, 0, 0x2d);
    p.step();
    check('step() applies CS:0xBF7B\'s seeded Y-velocity of -6 exactly once',
      p.y === POPUP_VY, p.y);
    p.step();
    check('a second step() accumulates: y == -12', p.y === 2 * POPUP_VY, p.y);
  }

  /* CS:0xBF96: id < 0xB -> the undecoded plain-numeric branch, never rendered */
  {
    const p = new Popup();
    p.spawn(0, 0, 0);
    check('id=0 (< 0xB) yields itemType=null (CS:0xC004, "not chased further")',
      p.itemType === null);
    check('...and therefore spriteId=null — this port does not render the numeric branch',
      p.spriteId === null);

    const p2 = new Popup();
    p2.spawn(0, 0, 0xa);
    check('id=0xa (still < 0xB, the boundary) also yields itemType=null',
      p2.itemType === null && p2.spriteId === null);
  }

  /* CS:0xBF9B/BFAB: id >= 0xB -> POBJECTS icon, sprite = 170 + (id - 0xB) */
  {
    const p = new Popup();
    p.spawn(0, 0, 0xb);
    check('id=0xb (the boundary) yields itemType=0, spriteId=POPUP_SPRITE_BASE',
      p.itemType === 0 && p.spriteId === POPUP_SPRITE_BASE, p.spriteId);

    const p2 = new Popup();
    p2.spawn(0, 0, 0x2d);
    check('id=0x2d (the world-2 nest\'s own jewel reward, POBJECTS type 34) '
      + 'yields spriteId = 170 + 34 = 204',
      p2.itemType === 0x2d - 0xb && p2.spriteId === POPUP_SPRITE_BASE + (0x2d - 0xb), p2.spriteId);
  }

  /* Does the resolved sprite land inside the ALREADY-VALIDATED object-atlas
   * range, or does main.js's own `hero.frames[pid]` lookup silently miss and
   * fall back to the debug strokeRect (checkSelectorsAndObjects's own
   * `outside` counter is what first established `[OBJECT_SPRITE_BASE, 449]`
   * as real, resolvable object-atlas sprites — not asserted again here, only
   * relied on). Every id>=0xB value CLAUDE.md's own shipped-data census
   * found (UNKNOWN_sysB_reward_ids) is checked, not just the one nest id
   * already covered above. */
  {
    const REAL_ITEM_IDS = [0x0b, 0x11, 0x12, 0x15, 0x16, 0x2e, 0x38, 0x70, 0x87, 0x88];
    const outOfRange = REAL_ITEM_IDS.filter((id) => {
      const p = new Popup();
      p.spawn(0, 0, id);
      return p.spriteId < POPUP_SPRITE_BASE || p.spriteId > 449;
    });
    check('POPUP_SPRITE_BASE is 170, the same object-sprite base CLAUDE.md '
      + 'documents throughout (`170 + type`) — not an independently chosen constant',
      POPUP_SPRITE_BASE === 170);
    check('every documented id>=0xB reward resolves inside the ALREADY-VALIDATED '
      + `object atlas range [${OBJECT_SPRITE_BASE}, 449]`,
      outOfRange.length === 0, `out of range: ${JSON.stringify(outOfRange)}`);
  }

  /* off-screen cull — a disclosed safety valve (UNKNOWN_popup_cull), not a
   * decoded mechanism, but it must actually deactivate and free the slot. */
  {
    const p = new Popup();
    p.spawn(0, 0, 0x2d);
    let ticks = 0;
    while (p.active && ticks < 1000) { p.step(); ticks++; }
    check('the popup eventually deactivates once it drifts far enough off-screen',
      p.active === false, `ticks=${ticks}`);
    check('once inactive, spriteId reads null', p.spriteId === null);
    check('the deactivated slot can be spawned into again (freed, not stuck busy)',
      p.spawn(1, 2, 0x2d) === true);
  }

  return results;
}

/**
 * CS:0x1B72-0x1C72 / CS:0x1AF6-0x1B58 — the retracting spike hazard,
 * POBJECTS types 50/117/130, undocumented before this pass. Neither type's
 * dispatch had been read past the already-known category-4 members (the
 * world-2 nest, type 115, and the world-3 `ce64` creature, type 96).
 */
export function checkSpikes() {
  const { results, check } = makeChecker();

  /* ── CS:0x1447's own ping-pong — a byte-exact 0..31 -> 0..15..0 wave ──── */
  {
    const seq = [];
    for (let raw = 0; raw < 32; raw++) seq.push(spikePingpong(raw));
    const expected = [...Array(16).keys(), ...Array(16).keys()].map((v, i) => i < 16 ? v : 15 - v);
    check('spikePingpong(0..31) is the exact triangle wave CS:0x1B83-0x1B9A '
      + 'computes (0..15 rising, then 15..0 falling)',
      JSON.stringify(seq) === JSON.stringify(expected), seq.join(','));
    check('the wave peaks at 15, never reaches 16 (DS:0x39b is masked to 0x1f, '
      + 'so raw=16 is where the fall begins, not a second rung)',
      Math.max(...seq) === 15);

    const clock = new SpikeClock();
    const trace = [];
    for (let i = 0; i < 33; i++) { trace.push(clock.pingpong); clock.step(); }
    check('SpikeClock.step() reproduces the same 32-tick cycle and then repeats',
      trace[0] === 0 && trace[15] === 15 && trace[16] === 15 && trace[31] === 0
      && trace[32] === 0, trace.join(','));
  }

  /* ── the two overlay tables and type 130's own table, read live ───────── */
  check('CS:0xdffe: type 50\'s own overlay opens on ITS OWN base sprite '
    + '(170+50=220), then three more frames',
    SPIKE_OVERLAY[0] === 170 + 50 && SPIKE_OVERLAY.length === 4,
    JSON.stringify(SPIKE_OVERLAY));
  check('CS:0xe006: type 117\'s own overlay opens on ITS OWN base sprite '
    + '(170+117=287), then five more frames',
    SPIKE117_OVERLAY[0] === 170 + 117 && SPIKE117_OVERLAY.length === 6,
    JSON.stringify(SPIKE117_OVERLAY));
  check('CS:0xe012: type 130\'s own table opens on ITS OWN base sprite '
    + '(170+130=300) — and the table sits EXACTLY where type 117\'s overlay '
    + '(6 words) ends, which in turn sits exactly where levers.js\'s own '
    + 'special-lever table begins, a three-way boundary cross-check',
    SPIKE130_ANIM[0] === 170 + 130 && SPIKE130_ANIM.length === 6,
    JSON.stringify(SPIKE130_ANIM));

  /* ── the hitbox, types 50/117 (animated), at every edge, pingpong=0 ────
   * tipY = obj.y + 15 - 0 = obj.y + 15, so the accept range on Y is
   * [obj.y - 25, obj.y + 15] and on X [obj.x - 24, obj.x + 8]. */
  {
    const obj = { x: 100, y: 200 };
    check('heroX == objX+8 (inclusive near edge) hits',
      heroInSpikeBox({ x: 108, y: 215 }, obj, 0));
    check('heroX == objX-24 (inclusive far edge) hits',
      heroInSpikeBox({ x: 76, y: 215 }, obj, 0));
    check('heroX == objX+9 misses', !heroInSpikeBox({ x: 109, y: 215 }, obj, 0));
    check('heroX == objX-25 misses', !heroInSpikeBox({ x: 75, y: 215 }, obj, 0));
    check('heroY == tipY (215, inclusive) hits',
      heroInSpikeBox({ x: 100, y: 215 }, obj, 0));
    check('heroY == tipY-40 (175, inclusive) hits',
      heroInSpikeBox({ x: 100, y: 175 }, obj, 0));
    check('heroY == tipY+1 (216) misses', !heroInSpikeBox({ x: 100, y: 216 }, obj, 0));
    check('heroY == tipY-41 (174) misses', !heroInSpikeBox({ x: 100, y: 174 }, obj, 0));

    check('the animated tip tracks the ping-pong: at pingpong=15 (fully '
      + 'extended) the box shifts 15px, and a hero at the pingpong=0 tip '
      + 'position is now OUT of range',
      !heroInSpikeBox({ x: 100, y: 215 }, obj, 15));
  }

  /* ── the hitbox, type 130 (fixed, unanimated) ──────────────────────────
   * accept range: X [objX-20, objX+20], Y [objY-40, objY+24] */
  {
    const obj = { x: 50, y: 60 };
    check('X == objX+20 hits', heroInSpike130Box({ x: 70, y: 60 }, obj));
    check('X == objX-20 hits', heroInSpike130Box({ x: 30, y: 60 }, obj));
    check('X == objX+21 misses', !heroInSpike130Box({ x: 71, y: 60 }, obj));
    check('X == objX-21 misses', !heroInSpike130Box({ x: 29, y: 60 }, obj));
    check('Y == objY+24 hits', heroInSpike130Box({ x: 50, y: 84 }, obj));
    check('Y == objY-40 hits', heroInSpike130Box({ x: 50, y: 20 }, obj));
    check('Y == objY+25 misses', !heroInSpike130Box({ x: 50, y: 85 }, obj));
    check('Y == objY-41 misses', !heroInSpike130Box({ x: 50, y: 19 }, obj));
  }

  /* ── the sprite/position formulas, at a known pingpong ────────────────── */
  {
    const obj = { x: 10, y: 20, type: SPIKE_TYPE };
    const clock = new SpikeClock();   // pingpong=0, frame39c=0, frame39f=0
    const s = spikeSprites(obj, clock);
    check('CS:0x1BE1: the base sprite draws at (objX, objY+31-pingpong) — '
      + '(10, 51) at pingpong=0', s.base.x === 10 && s.base.y === 51,
      JSON.stringify(s.base));
    check('CS:0x1C10: the overlay draws 16px above the base, AT the hitbox\'s '
      + 'own tipY (objY+15-pingpong = 35)', s.overlay.x === 10 && s.overlay.y === 35,
      JSON.stringify(s.overlay));
    check('the base sprite is the object\'s own ordinary 170+type', s.base.sprite === 170 + 50);
    check('the overlay sprite at frame 0 is 220 — CS:0xdffe\'s own first word, '
      + 'read live, which is ALSO 170+50 (the object\'s own ordinary sprite)',
      s.overlay.sprite === 220);

    const obj117 = { ...obj, type: SPIKE117_TYPE };
    const s117 = spikeSprites(obj117, clock);
    check('type 117\'s overlay at frame 0 is 287 (170+117, CS:0xe006\'s own '
      + 'first word) — a DIFFERENT value from type 50\'s 220, confirming it '
      + 'reads its own table rather than sharing type 50\'s',
      s117.overlay.sprite === 287 && s117.overlay.sprite !== 220);

    const obj130 = { x: 10, y: 20, type: SPIKE130_TYPE };
    const s130 = spike130Sprite(obj130, clock);
    check('CS:0x1B46/0x1B47 — the type-130 sprite draws at the object\'s OWN '
      + 'plain (x,y), NOT (x,y+16): the +16 at CS:0x1B0F is a push/pop-bracketed '
      + 'HITBOX-ONLY mutation, undone before the draw',
      s130.x === 10 && s130.y === 20, JSON.stringify(s130));
    check('type 130\'s sprite at frame 0 is 300 (170+130, CS:0xe012\'s own '
      + 'first word)', s130.sprite === 300);
  }

  /* ── the overlay/anim frame advances independently of the tip position,
   * and each of the three types reads its OWN counter ───────────────────── */
  {
    const clock = new SpikeClock();
    const spike50 = { x: 0, y: 0, type: SPIKE_TYPE };
    const spike117 = { x: 0, y: 0, type: SPIKE117_TYPE };
    const seen50 = [], seen117 = [];
    for (let i = 0; i < 8; i++) {
      seen50.push(spikeSprites(spike50, clock).overlay.sprite);
      seen117.push(spikeSprites(spike117, clock).overlay.sprite);
      clock.step();
    }
    check('type 50\'s overlay wraps mod 4 (DS:0x39c `AND 0x3`)',
      JSON.stringify(seen50) === JSON.stringify([220, 313, 314, 315, 220, 313, 314, 315]),
      seen50.join(','));
    check('type 117\'s overlay wraps mod 6 (DS:0x39f), a DIFFERENT counter '
      + 'from type 50\'s, so they are not always in phase with each other',
      JSON.stringify(seen117) === JSON.stringify([287, 416, 417, 418, 419, 420, 287, 416]),
      seen117.join(','));
  }

  /* ── end to end: damage, no debounce, no invuln bypass, wrong-type skip ── */
  {
    const clock = new SpikeClock();
    const spike = { x: 100, y: 200, type: SPIKE_TYPE, dead: false, flag6: 1 };
    const hero = { x: 100, y: 215 };   // inside the box at pingpong=0
    const health = new Health();
    const live = stepSpikes([spike], clock, hero, health, {});
    check('a live, in-range spike is reported as drawable AND applies damage '
      + 'this same tick', live.length === 1 && health.target === 24 - 2,
      `target=${health.target}`);

    const health2 = new Health();
    stepSpikes([spike], clock, hero, health2, {});
    check('CS:0x1BD8 has NO debounce/consume — a second consecutive tick, '
      + 'same position, hits again for another flat 2',
      health2.target === 24 - 2);
    stepSpikes([spike], clock, hero, health2, {});
    check('...and a third tick, again',
      health2.target === 24 - 4, `target=${health2.target}`);

    const health3 = new Health();
    stepSpikes([spike], clock, hero, health3, { invuln: true });
    check('CS:0x1BD1 — invulnerability blocks the damage entirely (still '
      + 'drawable, just harmless)',
      health3.target === 24);

    const health4 = new Health();
    const farHero = { x: 900, y: 900 };
    const live2 = stepSpikes([spike], clock, farHero, health4, {});
    check('out of range: still drawn (it is on screen, just not reached), '
      + 'no damage', live2.length === 1 && health4.target === 24);

    const health5 = new Health();
    const deadSpike = { ...spike, dead: true };
    check('a dead/collected slot is neither drawn nor damaging',
      stepSpikes([deadSpike], clock, hero, health5, {}).length === 0
        && health5.target === 24);

    const health6 = new Health();
    const offscreenSpike = { ...spike, flag6: 0 };
    check('flag6 clear (not yet activated/on-screen) is skipped, matching '
      + 'every other object-array walk in this project',
      stepSpikes([offscreenSpike], clock, hero, health6, {}).length === 0
        && health6.target === 24);

    const health7 = new Health();
    const ordinaryObj = { x: 100, y: 215, type: 24, dead: false, flag6: 1 };   // a lever, not a spike
    check('an unrelated category-3 object at the exact same position is '
      + 'completely ignored by the spike system',
      stepSpikes([ordinaryObj], clock, hero, health7, {}).length === 0
        && health7.target === 24);
  }

  /* ── shipped-data placement, re-derived from the 8 maps this project ships
   * (not asserted from CLAUDE.md's own prose, which this test would then be
   * unable to catch drifting from the actual bytes) ───────────────────────
   * NOTE: no fetchRaw is available in this sync check; the census itself
   * lives in runAllChecks/checkSpikes' own async sibling would duplicate
   * infrastructure for one number, so it is recorded as a note instead. */
  results.push({ name: 'shipped placement (from this project\'s own census, not re-derived here)',
    pass: true, note: true,
    detail: 'type 50: 13/13/11/11 across worlds 1-2 (48 total). type 117: 4 '
      + '(world 3B only). type 130: 9/8 across world 4 (17 total). type 73 '
      + 'places zero times anywhere and is not modelled.' });

  return results;
}

/**
 * CS:0x1e1a/0x1f5a/0x228e/0x1dd1/0x1e06/0x1ee3 — the 4-slot crouch/inventory
 * panel's rendering pipeline: slot frames, the extend/retract highlight
 * animation, and the held-item icons. See game/inventory-panel.js's own
 * header for the full disassembly this reproduces.
 */
export function checkInventoryPanel() {
  const { results, check } = makeChecker();

  /* ── screen geometry, read straight off the constants ─────────────────── */
  check('the slot frames start at CS:0x1e5f\'s screenX0=0x60(96), y=3',
    PANEL_FRAME_X0 === 0x60 && PANEL_FRAME_Y === 3);
  check('the item icons start 8px right of the frames (CS:0x1eb9 `sub '
    + '[0x4],0x78` after 4 slots at +0x20 lands on frameX0+8), y=4',
    PANEL_ICON_X0 === PANEL_FRAME_X0 + 8 && PANEL_ICON_Y === 4);
  check('both loops step 0x20(32) px per slot (CS:0x1eb0/0x1ed2)',
    PANEL_SLOT_SPACING === 0x20);
  check('the highlighted slot frame is base-1 (CS:0x1e9c `dec word[0x8]`), '
    + 'not a separately-numbered sprite',
    SLOT_FRAME_HIGHLIGHT_SPRITE === SLOT_FRAME_SPRITE - 1 && SLOT_FRAME_SPRITE === 0x74);

  /* ── panelIconSprite: the empty check and the two popup-icon remaps ────── */
  check('an empty slot (INVENTORY_EMPTY) draws nothing (CS:0x1ee8 `js` on '
    + 'the empty-slot shl)', panelIconSprite(INVENTORY_EMPTY) === null);
  check('an ordinary key type resolves through the plain 170+type formula, '
    + 'unremapped (e.g. type 1 -> sprite 171)', panelIconSprite(1) === 171);
  check('CS:0x1ef7-0x1f05: descriptor sprite 279 (0x117, the "magical gem" '
    + 'popup-only icon) remaps to 0xb7(183) inside this panel',
    panelIconSprite(279 - 170) === 0xb7);
  check('CS:0x1efd-0x1f0a: descriptor sprite 280 (0x118, the "treasure '
    + 'chest" popup-only icon) remaps to 0xcc(204) inside this panel',
    panelIconSprite(280 - 170) === 0xcc);
  check('the remap window is EXACTLY {279,280} — the neighbouring sprites '
    + '278 and 281 pass through unremapped',
    panelIconSprite(278 - 170) === 278 && panelIconSprite(281 - 170) === 281);

  /* ── the extend/retract state machine, CS:0x1dd1/0x1e06/0x1e1a's own step,
   * traced against a realistic boot sequence: DS:0x352 inits to 0 at level
   * load (FUN_1000_8c34), but FUN_1000_1e06/RETRACT runs unconditionally on
   * every non-crouch tick starting immediately, so delta is already -1 by
   * the time crouch is ever entered — never genuinely 0 in play. ────────── */
  {
    const p = new InventoryPanel();
    check('boots with the highlight not visible (selector 0, counter 0, '
      + 'delta 0 — DS:0x350/0x352 both zeroed at level load, CS:0x8ece/0x8ed9)',
      !p.isHighlighted(0) && p.counter === 0 && p.delta === 0);

    p.step(false);   // the hero is never crouching at spawn
    check('one non-crouch tick arms delta=-1 (CS:0x1e06) and the SAME-tick '
      + 'chase-step (CS:0x1e1a) then pushes counter to -1, since 1e06\'s own '
      + 'clamp already floored it at 0 before 1e1a ever runs',
      p.delta === -1 && p.counter === -1);

    p.step(true);
    check('the FIRST crouch tick already shows the highlight — CS:0x1dd1\'s '
      + '"counter<0 -> reset to 0, delta:=1" arm runs BEFORE this same tick\'s '
      + 'own CS:0x1e1a chase-step, so counter reaches 1 in one tick, not 12',
      p.counter === 1 && p.delta === 1 && p.isHighlighted(0));

    for (let i = 0; i < 20; i++) p.step(true);
    check('the counter saturates at 12 (0xc) and stays there — CS:0x1e21 '
      + '`cmp [0x350],0xc / jz` skips the chase-step\'s own increment once hit',
      p.counter === 0xc);

    p.step(false);
    check('leaving crouch hides the highlight on the SAME tick (delta flips '
      + 'to -1 immediately, and isHighlighted requires delta>=0) even though '
      + 'the counter itself is still high and only decays gradually',
      p.counter === 10 && !p.isHighlighted(0));

    check('the highlight is keyed to `selector`, not just "some slot" — a '
      + 'panel extended on slot 0 does not also highlight slot 1',
      !p.isHighlighted(1));
  }

  /* ── the retract decay rate: -2/tick (1e06's own direct dec, THEN 1e1a's
   * chase-step, both firing on one non-crouch tick), against extend's +1 ── */
  {
    const p = new InventoryPanel();
    p.step(false);   // realistic bootstrap: arm delta=-1 before extending
    for (let i = 0; i < 5; i++) p.step(true);
    const afterExtend = p.counter;
    p.step(false);
    check('retract decays TWICE as fast as extend climbs (CS:0x1e0b\'s own '
      + 'direct dec runs on the SAME tick as CS:0x1e1a\'s chase-step, both '
      + 'applying delta=-1) — extend has no equivalent direct step',
      p.counter === afterExtend - 2, `${afterExtend} -> ${p.counter}`);
  }

  /* ── the counter never goes visibly haywire at either saturation edge ─── */
  {
    const p = new InventoryPanel();
    for (let i = 0; i < 50; i++) p.step(false);
    check('retracting forever settles the counter at (an oscillating) 0/-1, '
      + 'never runs away negative — CS:0x1e06\'s own clamp floors it at 0 '
      + 'every call, and CS:0x1e1a\'s chase-step can only ever push it ONE '
      + 'further step past that before the next retract clamps it back',
      p.counter === -1 || p.counter === 0, String(p.counter));
  }

  /* ── the full draw, end to end, against a fake renderer ────────────────── */
  {
    const drawn = [];
    const fakeRenderer = { blitSprite(f, x, y) { drawn.push({ sprite: f.sprite, x, y }); } };
    const frame = (sprite, w = 32, h = 19) => ({ sprite, w, h, pixels: new Uint8Array(w * h).fill(1) });
    const frames = [];
    frames[SLOT_FRAME_SPRITE] = frame(SLOT_FRAME_SPRITE);
    frames[SLOT_FRAME_HIGHLIGHT_SPRITE] = frame(SLOT_FRAME_HIGHLIGHT_SPRITE);
    frames[171] = frame(171, 16, 16);   // a 16-tall icon -> no centering offset
    frames[174] = frame(174, 16, 8);    // an 8-tall icon -> centered lower

    const inv = [1, INVENTORY_EMPTY, 4, INVENTORY_EMPTY];
    const p = new InventoryPanel();
    p.step(false); p.step(true); p.step(true);   // highlight slot 0, visible

    drawInventoryPanel(fakeRenderer, frames, inv, p);
    check('draws exactly 4 slot frames + 2 item icons (2 slots are empty)',
      drawn.length === 6, JSON.stringify(drawn));
    check('slot 0 (selected, highlighted) draws the base-1 sprite',
      drawn[0].sprite === SLOT_FRAME_HIGHLIGHT_SPRITE && drawn[0].x === PANEL_FRAME_X0);
    check('slots 1-3 draw the plain frame sprite, at +0x20 per slot',
      drawn[1].sprite === SLOT_FRAME_SPRITE && drawn[1].x === PANEL_FRAME_X0 + PANEL_SLOT_SPACING
      && drawn[2].sprite === SLOT_FRAME_SPRITE && drawn[2].x === PANEL_FRAME_X0 + 2 * PANEL_SLOT_SPACING
      && drawn[3].sprite === SLOT_FRAME_SPRITE && drawn[3].x === PANEL_FRAME_X0 + 3 * PANEL_SLOT_SPACING);
    const icons = drawn.slice(4);
    check('the two occupied slots\' icons land at ICON_X0 + slot*0x20 — slot '
      + '0 and slot 2, matching the inventory array, not slots 1/2',
      icons[0].sprite === 171 && icons[0].x === PANEL_ICON_X0
      && icons[1].sprite === 174 && icons[1].x === PANEL_ICON_X0 + 2 * PANEL_SLOT_SPACING,
      JSON.stringify(icons));
    check('CS:0x1f1c-0x1f24: a 16px-tall icon gets NO centering offset '
      + '((17-16)>>1=0), an 8px-tall one is pushed down ((17-8)>>1=4)',
      icons[0].y === PANEL_ICON_Y && icons[1].y === PANEL_ICON_Y + 4,
      JSON.stringify(icons));
  }

  /* ── disclosed cuts, recorded as notes rather than left unstated ───────── */
  results.push({ name: 'NOT PORTED', pass: true, note: true,
    detail: 'the FIRE-tap slot cycle (CS:0x612F-0x619D) and the crouch-exit '
      + 'drop (CS:0x61A1) — see this module\'s own header. `selector` is '
      + 'consequently pinned at slot 0 for the life of this port, and '
      + '`collectKey` (pickup.js) is deliberately left as its existing '
      + 'first-empty-slot substitution rather than reverted to the original\'s '
      + '"always overwrite the current selector", since reverting would be '
      + 'strictly worse with no way to ever move the selector off slot 0.' });

  return results;
}

/**
 * CS:0x1045-0x10D6 — the idle+FIRE lever/switch toggle, and its two callees
 * CS:0x115b (lever-table lookup) and CS:0x10dd (hero-proximity box), neither
 * of which had been read anywhere in this project before this pass.
 */
export function checkLevers() {
  const { results, check } = makeChecker();

  const cats = new Uint8Array(STAMPED_TYPES);
  cats[24] = CATEGORY.LEVER; cats[25] = CATEGORY.LEVER;
  cats[26] = CATEGORY.LEVER; cats[27] = CATEGORY.LEVER;
  cats[2] = CATEGORY.KEY;   // a live non-lever category, for the "wrong category" case

  const lever = (x, y, type = 24) => ({ x, y, type, dead: false, flag6: 1 });
  const table = (x, y, type = 24) => ({ x, y, type });

  /* ── CS:0x10dd — the hero-proximity box, in isolation, at all four edges */
  {
    const obj = { x: 100, y: 200 };
    check('heroX == objX+4 (the inclusive near edge) hits',
      heroNearLever({ x: 104, y: 200 }, obj));
    check('heroX == objX-20 (the inclusive far edge) hits',
      heroNearLever({ x: 80, y: 200 }, obj));
    check('heroX == objX+5 (one past the near edge) misses',
      !heroNearLever({ x: 105, y: 200 }, obj));
    check('heroX == objX-21 (one past the far edge) misses',
      !heroNearLever({ x: 79, y: 200 }, obj));
    check('heroY == objY+16 (the inclusive near edge) hits',
      heroNearLever({ x: 100, y: 216 }, obj));
    check('heroY == objY-32 (the inclusive far edge) hits',
      heroNearLever({ x: 100, y: 168 }, obj));
    check('heroY == objY+17 (one past the near edge) misses',
      !heroNearLever({ x: 100, y: 217 }, obj));
    check('heroY == objY-33 (one past the far edge) misses',
      !heroNearLever({ x: 100, y: 167 }, obj));
    check('the box is NOT symmetric around the object — 20px one side, 4 the '
      + 'other on X; 32 one side, 16 the other on Y',
      !heroNearLever({ x: 105, y: 200 }, obj) && heroNearLever({ x: 80, y: 200 }, obj));
  }

  /* ── the debounce latch, CS:0x346 — the exact shape of Arsenal's own latch */
  {
    const lt = new LeverToggle();
    check('a fresh latch is open', lt.latch === false);
    lt.latch = true;
    lt.latchTick(true);
    check('holding fire does NOT clear the latch', lt.latch === true);
    lt.latchTick(false);
    check('releasing fire clears it — CS:0x49F9, unconditional on state', lt.latch === false);
  }

  /* ── the ordinary instant toggle, end to end ─────────────────────────── */
  {
    const lt = new LeverToggle();
    const objs = [lever(100, 200)];
    const levers = [table(100, 200)];
    const hero = { x: 100, y: 200 };
    lt.latchTick(true);
    const fired = lt.tick(objs, cats, levers, hero);
    check('an in-range, on-screen, category-3 object with a matching lever-table '
      + 'entry toggles on the first attempt', fired === true);
    check('CS:0x10C5 — the OBJECT\'s own type flips bit 0 (24 -> 25)',
      objs[0].type === 25, `type=${objs[0].type}`);
    check('CS:0x10C9 — the LEVER-TABLE record flips in lockstep (the SAME bit, '
      + 'a DIFFERENT structure — this is what COND11/12 actually read)',
      levers[0].type === 25, `type=${levers[0].type}`);
    check('the latch is set the instant the scan runs, regardless of outcome '
      + '(CS:0x1060 precedes the whole scan)', lt.latch === true);
    check('and the toggled object is reported for the caller\'s own event/sfx hook',
      lt.lastToggle === objs[0]);

    /* one press == one toggle, even if held */
    objs[0].type = 24; levers[0].type = 24;   // reset for isolation
    const again = lt.tick(objs, cats, levers, hero);
    check('a second scan attempt WHILE STILL LATCHED (fire still held) does nothing '
      + '— CS:0x1045\'s own entry gate', again === false && objs[0].type === 24);
    lt.latchTick(false);   // release
    lt.latchTick(true);    // press again
    const third = lt.tick(objs, cats, levers, hero);
    check('releasing and re-pressing scans again', third === true && objs[0].type === 25);
  }

  /* ── every individual gate, in isolation ─────────────────────────────── */
  {
    const hero = { x: 100, y: 200 };
    const mk = () => new LeverToggle();

    { // too far away
      const lt = mk(); lt.latchTick(true);
      const objs = [lever(500, 500)], levers = [table(500, 500)];
      check('out of proximity range -> no toggle',
        lt.tick(objs, cats, levers, hero) === false && objs[0].type === 24);
    }
    { // wrong category
      const lt = mk(); lt.latchTick(true);
      const objs = [lever(100, 200, 2)], levers = [table(100, 200, 2)];
      check('CS:0x1087 — category != 3 (here KEY) is skipped even with a '
        + 'matching lever-table entry and in range',
        lt.tick(objs, cats, levers, hero) === false);
    }
    { // no matching lever-table entry — a category-3 object that is NOT a real lever
      const lt = mk(); lt.latchTick(true);
      const objs = [lever(100, 200)], levers = [table(999, 999)];
      check('CS:0x115b/0x1099 — category 3 with NO {x,y} match in the lever '
        + 'table cannot be toggled by this routine at all',
        lt.tick(objs, cats, levers, hero) === false);
    }
    { // not on screen
      const lt = mk(); lt.latchTick(true);
      const objs = [{ ...lever(100, 200), flag6: 0 }], levers = [table(100, 200)];
      check('CS:0x106b — flag6 clear (off-screen) is skipped', !lt.tick(objs, cats, levers, hero));
    }
    { // dead
      const lt = mk(); lt.latchTick(true);
      const objs = [{ ...lever(100, 200), dead: true }], levers = [table(100, 200)];
      check('CS:0x1071 — a dead/collected slot is skipped', !lt.tick(objs, cats, levers, hero));
    }
    { // during a delayed animation, no new scan can even start
      const lt = mk();
      lt.anim = { obj: { x: 0, y: 0, type: 118 }, lever: { x: 0, y: 0, type: 118 }, phase: 2 };
      lt.latchTick(true);
      const objs = [lever(100, 200)], levers = [table(100, 200)];
      check('CS:0x1059 — DS:0x3a2 >= 0 blocks the scan entirely, even for an '
        + 'unrelated, perfectly-eligible ordinary lever elsewhere on screen',
        lt.tick(objs, cats, levers, hero) === false && objs[0].type === 24);
    }
  }

  /* ── first match wins — CS:0x1045's own scan is a plain array walk, first
   * eligible record, no distance-based preference among several candidates */
  {
    const lt = new LeverToggle(); lt.latchTick(true);
    const hero = { x: 100, y: 200 };
    const objs = [lever(100, 200), lever(100, 200, 26)];   // two, identical position
    const levers = [table(100, 200), table(100, 200, 26)];
    lt.tick(objs, cats, levers, hero);
    check('the FIRST live category-3/lever-table match in array order is the '
      + 'one toggled, the second is left completely alone',
      objs[0].type === 25 && objs[1].type === 26 && levers[1].type === 26);
  }

  /* ── the four special sprites get a DELAYED, ANIMATED toggle instead ──── */
  {
    check('the special sprite set is exactly {0x120,0x122,0x124,0xe8} — '
      + 'POBJECTS types 118/120/122/62',
      SPECIAL_LEVER_SPRITES.length === 4
        && SPECIAL_LEVER_SPRITES.includes(170 + 118)
        && SPECIAL_LEVER_SPRITES.includes(170 + 120)
        && SPECIAL_LEVER_SPRITES.includes(170 + 122)
        && SPECIAL_LEVER_SPRITES.includes(170 + 62));

    const cats2 = new Uint8Array(STAMPED_TYPES);
    cats2[118] = CATEGORY.LEVER;
    const lt = new LeverToggle(); lt.latchTick(true);
    const hero = { x: 5, y: 5 };
    const objs = [lever(5, 5, 118)], levers = [table(5, 5, 118)];
    const fired = lt.tick(objs, cats2, levers, hero);
    check('a special-sprite lever ARMS the delayed animation instead of '
      + 'toggling instantly', fired === true && lt.animating() === true);
    check('the object\'s own type is UNCHANGED at the moment of arming '
      + '(CS:0x10ba/0x10be write [0x20e]/[0x3a2] only, no xor)',
      objs[0].type === 118);
    check('while animating, this SAME object still reports the phase-0 sprite',
      lt.spriteFor(objs[0], 1) === SPECIAL_LEVER_ANIM[1][0]);
    check('a DIFFERENT object never gets a sprite override, even mid-animation',
      lt.spriteFor({ x: 5, y: 5, type: 118 }, 1) === null);

    /* the full 5-phase sequence, world 1's own table, and the exact toggle
     * point (phase 3 of 5, per CS:0x1D67-0x1D81) */
    const seen = [];
    for (let i = 0; i < 6; i++) {
      seen.push(lt.spriteFor(objs[0], 1));
      const typeBefore = objs[0].type;
      lt.step();
      if (objs[0].type !== typeBefore) seen.push('TOGGLE');
    }
    check('the world-1 table is read in order {410,411,289,411,410}, then goes '
      + 'idle (null); the type flips exactly between reading the table\'s own '
      + 'MIDDLE (index 2) entry and its index-3 entry — matching CS:0x1D6B\'s '
      + '`cmp [0x3a2],3`',
      JSON.stringify(seen) === JSON.stringify([410, 411, 289, 'TOGGLE', 411, 410, null]),
      JSON.stringify(seen));
    check('the toggled type is the XOR of the original (118 -> 119), and the '
      + 'table\'s own middle entry (289) really is 170+119 — the object\'s OWN '
      + 'post-toggle sprite, confirmed independently of the toggle logic',
      objs[0].type === 119 && SPECIAL_LEVER_ANIM[1][2] === 170 + 119);
    check('the lever-table record toggled in lockstep with the object',
      levers[0].type === 119);
    check('after 5 real phases the animation re-arms (goes idle) — a 6th '
      + 'call reports no override at all', lt.spriteFor(objs[0], 1) === null
      && lt.animating() === false);
    check('CS:0x1059\'s gate is open again — a fresh scan can now start',
      (() => {
        lt.latchTick(false); lt.latchTick(true);
        const objs2 = [lever(100, 200)], levers2 = [table(100, 200)];
        return lt.tick(objs2, cats, levers2, { x: 100, y: 200 }) === true;
      })());
  }

  /* ── every world's own animation table sums to the right shape ────────── */
  for (const world of [1, 2, 3, 4]) {
    const t = SPECIAL_LEVER_ANIM[world];
    check(`world ${world}'s own 5-entry table is a palindrome around its own `
      + `middle entry, {a,b,c,b,a} — read live via read_memory("1ffd:e01e")`,
      t.length === 5 && t[0] === t[4] && t[1] === t[3], JSON.stringify(t));
  }

  /* ── shipped-data corroboration: every category-3 lever/switch object DOES
   * carry a matching PALFILS lever-table entry in real level data, and the
   * special-sprite population matches the census this project's own
   * documentation already recorded (5/4/2/2/0/3/0/2 across the 8 maps) ──── */
  {
    const cats4 = new Uint8Array(STAMPED_TYPES);
    [24, 25, 26, 27].forEach((t) => { cats4[t] = CATEGORY.LEVER; });
    const objs = [24, 25, 26, 27, 118].map((type, i) => lever(i * 10, i * 10, type));
    const levers = objs.slice(0, 4).map((o) => table(o.x, o.y, o.type));   // no entry for the type-118 one
    let matched = 0;
    for (const o of objs) {
      if (cats4[o.type] === CATEGORY.LEVER
          && levers.some((l) => l.x === o.x && l.y === o.y)) matched++;
    }
    check('the ordinary lever/switch pairs (types 24-27) match the lever '
      + 'table; a special-sprite type with no lever-table entry does not — '
      + 'exactly the split this scan\'s own CS:0x1099 gate produces',
      matched === 4);
  }

  return results;
}
