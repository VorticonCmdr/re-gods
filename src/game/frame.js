/* frame.js — the per-tick call order, as code rather than as a comment.
 *
 * WHY THIS MODULE EXISTS. The order of the main loop is load-bearing domain
 * logic, not UI plumbing, and it is invisible to every isolated test: each
 * piece behaves identically whichever order you run them in, and only the
 * combination is wrong. It lived inline in main.js, where the verification
 * suite could not reach it — a mutation that swapped the projectile step and
 * the player tick SURVIVED the whole suite, which is exactly the failure this
 * project treats as unacceptable. Pulling it out here makes the order itself
 * a thing a check can drive.
 *
 * ── THE ORDER, read off GAME.EXE's main loop `[PROVEN]` ──────────────────
 *
 *   019D  test byte [0x382],0x80 / jnz     the latch clear — CONDITIONAL
 *   01A4  mov byte [0x351],0
 *   01BD  cmp word [0x19a],0                the death test, on the BAR
 *   01CC  call 0xacf6                       CLEAR the damage grid
 *   020F  call 0x9455                       projectiles MOVE and STAMP
 *   021E  mov byte [0x33c],0xff             the hunter target list resets
 *   0254  call 0x4993                       the player state machine (EMIT)
 *   0285  call 0xed15                       System-B entities -> they SCAN
 *   02C6  call 0xdff                        the health bar chases
 */

import { creatureTouchesHero, creatureScansGrid } from './combat.js';
import { stepPickups } from './pickup.js';

/** The addresses above, in order, so a check can assert the sequence itself. */
export const FRAME_ORDER = [
  { at: 0x019d, what: 'latch clear (only when fire is NOT held)' },
  { at: 0x01bd, what: 'death test, on the displayed bar' },
  { at: 0x01cc, what: 'clear the damage grid' },
  { at: 0x01df, what: 'destructible blocks advance their break animation' },
  { at: 0x0206, what: 'the object pass — weapon PICKUP happens here' },
  { at: 0x020f, what: 'projectiles move and stamp' },
  { at: 0x0212, what: 'the STARBURST steps and stamps' },
  { at: 0x0254, what: 'the player state machine — the EMIT happens here' },
  { at: 0x0285, what: 'entities: contact, then the grid scan' },
  { at: 0x02ba, what: 'ENEMY shots move, hit and stamp nothing' },
  { at: 0x02c6, what: 'the health bar chases the target' },
];

/* ⚠️ THE TWO PROJECTILE SYSTEMS SIT ON OPPOSITE SIDES OF THE PLAYER.
 * The hero's shots step at CS:0x020F, BEFORE the state machine emits at
 * CS:0x0254 — so a hero shot cannot hit anything on its spawn tick. Enemy
 * shots step at CS:0x02BA, AFTER every emitter that fires them (the nest
 * walker at 0x0282, the entities at 0x0285), so an enemy shot moves and can
 * reach the hero on the very tick it is fired. Giving both systems the same
 * ordering is wrong for one of them whichever ordering you pick. */
export const HERO_SHOTS_AT = 0x020f;
export const ENEMY_SHOTS_AT = 0x02ba;

/**
 * CS:0x019D through CS:0x0254 — the hero half of the frame.
 *
 * ⚠️ THE PROJECTILE STEP RUNS BEFORE THE PLAYER, so a shot emitted this tick
 * does not move or stamp until the next one and cannot hit anything on its
 * spawn tick. Swapping these two gives every shot a free frame of collision at
 * the muzzle — a difference that is invisible in any per-module test.
 *
 * @returns {{projectiles:object, emitted:?object}}
 */
export function stepHeroFrame({ input, arsenal, grid, player, map, cam,
                               world = 1, objects = null, bar = 1,
                               cats = null, health = null, treasure = null,
                               burst = null, alloc = null, starburst = null,
                               blocks = null, debris = null }) {
  arsenal.latchTick(input.fire);                                    // 019D
  grid.clear();                                                     // 01CC
  /* CS:0x0206 -> CS:0x1432, the object pass. Weapon pickup lives here, and it
   * runs BEFORE the projectile step — so a weapon collected this tick has its
   * slot cleared before anything could have moved in it. */
  const picked = objects
    ? stepPickups(objects, player, arsenal, bar, { cats, health, treasure })
    : { taken: [], consumed: [], treasures: [] };
  /* CS:0x132D, the chest burst. It sits in the same object pass, and it runs
   * AFTER the pickup walk that can spawn it — so an item thrown out of a chest
   * this tick does not move until the next one. */
  const loot = burst ? burst.step(alloc) : { drawn: [], settled: [] };
  /* CS:0x01DF — the destructible-block updater runs EARLY, before the mode
   * dispatch at CS:0x01E5 and so before the object pass, the projectiles and
   * the player. A block queued by a shot this tick therefore does not begin
   * its break animation until the next one. */
  const blockFx = blocks ? blocks.step(map.planeA, map.planeB) : [];  // 01DF
  const projectiles = arsenal.step(cam, grid, map.planeB, world,
                                   map.planeA, blocks, debris);       // 020F
  /* CS:0xA816 — a shot the terrain just stopped drops a stationary debris
   * puff at the point it stopped. Fires for ANY weapon whose `breaksTerrain`
   * (+0x48) is set, whether or not the cell was also a destructible block —
   * see game/debris.js. This module has no evidence for debris's own exact
   * main-loop call site relative to the others (it "cannot hurt anything and
   * cannot touch the map", CLAUDE.md), so it is stepped once per tick here,
   * alongside the other purely-cosmetic particle systems. */
  if (debris) for (const h of projectiles.hits) debris.spawn(h.x, h.y, 0, 0);
  /* CS:0x0212 — the starburst sits between the projectile step and the
   * player, so its particles stamp on the SAME tick they move, and (like a
   * projectile) a burst spawned by the player this tick does not stamp until
   * the next one. */
  const burstFx = starburst ? starburst.step(cam, grid) : null;     // 0212
  const debrisFx = debris ? debris.step(cam) : [];
  player.tick(map, input, arsenal);                                 // 0254
  return { projectiles, emitted: player.emitted, picked: picked.taken,
           consumed: picked.consumed || [], treasures: picked.treasures || [],
           loot, burstFx, blockFx, debrisFx };
}

/**
 * CS:0x0285 -> CS:0xff93 -> CS:0xa9e4 — contact and the damage scan, which are
 * ONE call in that order.
 *
 * ⚠️ CONTACT SHORT-CIRCUITS THE SCAN: CS:0xa9e7 `cmp bp,0 / jns` sends a
 * creature that just hit the hero to CS:0xabc0, past the grid entirely. So one
 * creature cannot both hurt the hero and die to a projectile on the same tick.
 *
 * @param {?Function} rng     CS:0x3836 (GodsRandom#next) — only consumed when
 *   a hit lands and the target SURVIVES it, for the hit-spark jitter.
 * @param {?object} debris    the DS:0x8b4c owner — CS:0xAC4C's spark.
 * @returns {{touched:number, killed:number}}
 */
export function stepCreatureDamage(enemies, { grid, cam, hero, health,
                                              decodeTag, difficulty = 0,
                                              arsenal = null, rng = null,
                                              debris = null }) {
  /* CS:0x9124-0x9146 — the hunter target list is built only while the hero
   * carries the hunter (weapon 8). CS:0x021E resets its count to 0xFF every
   * frame, so it is rebuilt from scratch each tick by the scan below. */
  const wantTargets = !!arsenal
    && arsenal.slots.some((s) => s.weapon === HUNTER_WEAPON);
  const targets = wantTargets ? [] : null;
  let touched = 0, killed = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    const c = creatureTouchesHero(e, hero, health);
    if (c.strengthOut < 0) { touched++; continue; }     // CS:0xa9ec — contact won
    const s = creatureScansGrid(e, grid, cam, decodeTag, difficulty,
                                undefined, targets, { rng, debris });
    if (s.killed) { killed++; e.frame = -1; e.delay = 0; }
  }
  if (arsenal) arsenal.targets = targets || [];
  return { touched, killed, targets: targets || [] };
}

/** CS:0x9130/0x9137/0x913E all compare a slot word against 8 — the hunter. */
export const HUNTER_WEAPON = 8;
