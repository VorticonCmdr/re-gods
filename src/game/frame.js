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
import { awardKill } from './treasure.js';
import { FACE_PHASE } from './shopkeeper.js';
import { chooseAltSlot } from './familiar.js';
import { pickTarget } from './projectiles.js';

/** The addresses above, in order, so a check can assert the sequence itself. */
export const FRAME_ORDER = [
  { at: 0x019d, what: 'latch clear (only when fire is NOT held)' },
  { at: 0x01bd, what: 'death test, on the displayed bar' },
  { at: 0x01cc, what: 'clear the damage grid' },
  { at: 0x01df, what: 'destructible blocks advance their break animation' },
  { at: 0x0206, what: 'the object pass — weapon PICKUP happens here' },
  { at: 0x020f, what: 'projectiles move and stamp' },
  { at: 0x0212, what: 'the STARBURST steps and stamps' },
  { at: 0x0215, what: 'the FAMILIAR moves and stamps (game/familiar.js)' },
  { at: 0x0254, what: 'the player state machine — the EMIT happens here' },
  { at: 0x0285, what: 'entities: contact, then the grid scan' },
  { at: 0x02ba, what: 'ENEMY shots move, hit and stamp nothing' },
  { at: 0x02bd, what: 'the DS:0xd2be line-hazard pool moves, hits and draws' },
  { at: 0x02c6, what: 'the health bar chases the target' },
];

/** CS:0x02BD, right after the enemy-shot step and before the health-bar
 *  chase — see game/line-hazard.js. */
export const LINE_HAZARDS_AT = 0x02bd;

/** `CS:0x01F2` — `CALL 0x767A`, the line-barrier rescan (game/line-barriers.js's
 *  `tick()`). `[PROVEN]`: called from THREE places, `FUN_1000_006F` at
 *  exactly this address, `FUN_1000_09BB` (the death-sequence driver) at
 *  `CS:0x09C7` and the respawn tick `FUN_1000_921B` at `CS:0x9260` — so it
 *  runs every tick UNCONDITIONALLY, dead or alive, never gated behind the
 *  death check. (`get_xrefs_to` on `0x767A` listed only the first two; a
 *  `search_instructions` for the call operand found the third, after a live
 *  rescan with neither entry stop, 2026-09-28.)
 *  Within `FUN_1000_006F` it is reached by BOTH arms of the `CS:0x01E5` mode
 *  branch, before the conditional pickup block (`0x0206`) and before every
 *  unconditional system after it (projectiles `0x020F`, starburst `0x0212`,
 *  the hunter-list reset `0x021E`, selector-2 `0x0223`, the player state
 *  machine `0x0254`, System-B entities `0x0285`, enemy shots `0x02BA`, the
 *  line-hazard pool `0x02BD` above, the health-bar chase `0x02C6`) — i.e. it
 *  is one of the EARLIEST systems in the whole tick, not one of the last.
 *  This is a correction, not a new finding: an earlier pass shipped
 *  `lineBarriers.tick()` grouped with `lineHazards.step()` near the END of
 *  main.js's tick, disclosed as "not pinned to an exact CS: call site" —
 *  that framing was wrong in a specific way: the site was one `get_xrefs_to`
 *  away, and the placement that shipped was backwards. Not exported for
 *  `stepHeroFrame` to call directly, unlike `FRAME_ORDER`'s own entries:
 *  `stepHeroFrame` is itself gated behind `!deathSeq` in main.js, and this
 *  call must NOT be — see the main.js call site for where it actually
 *  lives, matching `LINE_HAZARDS_AT`'s own citation-only precedent. */
export const LINE_BARRIERS_AT = 0x01f2;

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
 * @param {number} [tock=1] DS:0x36c, the every-other-frame toggle CS:0x0172
 *   flips with `not`. Threaded straight to `player.tick` — see there for why
 *   it defaults to always-open rather than 0.
 * @param {boolean} [invuln=false] CS:0x172 — gates fall-landing damage the
 *   same way it gates every other damage source in this project.
 * @returns {{projectiles:object, emitted:?object}}
 */
export function stepHeroFrame({ input, arsenal, grid, player, map, cam,
                               world = 1, objects = null, bar = 1,
                               cats = null, health = null, treasure = null,
                               burst = null, alloc = null, starburst = null,
                               blocks = null, debris = null, tock = 1, tock36d = tock,
                               inventory = null, levers = null,
                               leverToggle = null, invuln = false, panel = null,
                               zoneScan = null, beforePlayer = null,
                               objectPass = true, effects = null,
                               heroDead = false, familiar = null,
                               shopkeeper = null, sparkle = null }) {
  /* `heroDead`: the death driver CS:0x09BB runs this same pre-player half of
   * the tick (grid clear, blocks, barriers, object pass, projectiles,
   * starburst, selector 2) WITHOUT the fire latch (CS:0x019D) and without the
   * player, then rejoins the main loop at CS:0x0257. [PROVEN] against PJOYG2
   * 429-437: shots already in flight keep hitting the guardian while the
   * hero's death burst plays; the port used to freeze them. */
  if (!heroDead) arsenal.latchTick(input.fire);                     // 019D
  /* CS:0x49F9 — the SAME "one action per press" shape as the weapon latch
   * above, cleared every tick fire is not held. Unconditional, regardless
   * of the hero's state, exactly like arsenal's own latch clear. */
  if (leverToggle && !heroDead) leverToggle.latchTick(input.fire);
  grid.clear();                                                     // 01CC
  /* CS:0x0206 -> CS:0x1432, the object pass. Weapon pickup lives here, and it
   * runs BEFORE the projectile step — so a weapon collected this tick has its
   * slot cleared before anything could have moved in it. */
  /* `objectPass` false: DS:0x34's CS:0x01FC skip (a guardian outside world
   * 2) — no pickups and no chest burst this tick. */
  const picked = objects && objectPass
    /* `effects` carries the consumables' state (the starburst, the hero's
     * position, ...). It used to be dropped here, so the starburst potion
     * was consumed with no burst — [PROVEN] against PJOYL3 1031, where DOS
     * bursts from CS:0x6205. */
    ? stepPickups(objects, player, arsenal, bar, { cats, health, treasure, effects })
    : { taken: [], consumed: [], treasures: [], sparkles: [] };
  /* CS:0x1239, called from inside the pickup test: each collected object
   * seeds a sparkle (game/sparkle.js), walked later this frame (CS:0x0236). */
  if (sparkle) for (const p of picked.sparkles) sparkle.spawn(p.x, p.y);
  /* CS:0x132D, the chest burst. It sits in the same object pass, and it runs
   * AFTER the pickup walk that can spawn it — so an item thrown out of a chest
   * this tick does not move until the next one. */
  const loot = burst && objectPass ? burst.step(alloc) : { drawn: [], settled: [] };
  /* CS:0x01DF — the destructible-block updater runs EARLY, before the mode
   * dispatch at CS:0x01E5 and so before the object pass, the projectiles and
   * the player. A block queued by a shot this tick therefore does not begin
   * its break animation until the next one. */
  const blockFx = blocks ? blocks.step(map.planeA, map.planeB) : [];  // 01DF
  const projectiles = arsenal.step(cam, grid, map.planeB, world,
                                   map.planeA, blocks, debris,        // 020F
                                   /* the blast's hero test (CS:0xA3F4/0xA421)
                                    * reads the hero BEFORE the player moves */
                                   { hero: { x: player.x, y: player.y }, health, invuln });
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
  /* CS:0x0215 — the familiar (game/familiar.js), after the hunter (0x020F)
   * has already picked from the same target list. A summon since the last
   * tick (the object pass above, or the shop) runs CS:0xC308 then CS:0xC35E
   * first. `familiar` is {entity, rng, hero}. */
  let familiarDraw = null;
  if (familiar && health) {
    const f = familiar.entity;
    arsenal.onArmed = () => {                                         // CS:0x94D4
      arsenal.altSelect = chooseAltSlot(arsenal.slots, arsenal.weapons, health.familiarEnergy);
    };
    if (health.familiarEnergy >= 0 && !f.alive) {
      f.summon(familiar.hero);                                        // C308
      arsenal.altSelect = chooseAltSlot(arsenal.slots, arsenal.weapons,
                                        health.familiarEnergy);       // C35E
    }
    familiarDraw = f.tick({ health, hero: familiar.hero, cam, rng: familiar.rng, tock,
                            altSelect: arsenal.altSelect, grid,
                            pick: () => pickTarget(arsenal.targets) });   // 0215
  }
  /* CS:0x9757 — a shot from the slot DS:0x33D names leaves from the
   * familiar's position as it stands after this move (the emit is 0x0254). */
  if (familiar) {
    const f = familiar.entity;
    arsenal.altEmitter = f.alive ? { x: f.x, y: f.y } : null;
  }
  /* CS:0x0218/0x021E — the target list's cursor and count are reset right
   * after the familiar: this tick's scans (selector 2 at 0x0223, the
   * entities at 0x0285, the guardian driver ...) append afresh. */
  arsenal.targets = [];
  const debrisFx = debris ? debris.step(cam) : [];
  /* CROUCH + FIRE, CS:0x4B1A -> CS:0x6069 — the key scan needs the SAME live
   * object array and category table the pickup walk above just used, plus
   * the 4-slot inventory (DS:0x17e). `pickup.js` documents why the scan is
   * cheap to re-run every tick unconditionally. `levers`/`leverToggle` feed
   * IDLE+FIRE's own lever scan (CS:0x1045, game/levers.js) the same way. */
  const pickupCtx = objects ? { objects, cats, inventory, levers, leverToggle, zoneScan, panel } : null;
  /* ⚠️ ORDER MATTERS. CS:0x0206's object-draw pass (where CS:0x1D67's own
   * `inc [0x3a2]` lives) runs BEFORE CS:0x0254's player dispatch (where
   * CS:0x10BE's `[0x3a2]:=0` arms it) in the ORIGINAL's own per-tick order —
   * so the arming tick's OWN draw pass still shows the object's ordinary,
   * pre-animation sprite, and table[0] first appears on the NEXT tick.
   * This port's draw pass instead runs once, in main.js's render closure,
   * AFTER this whole logic step returns — there is no way to give that one
   * render call two different answers depending on whether `player.tick()`
   * (below) has run yet within the SAME tick. Stepping BEFORE `player.tick()`
   * is the closer of the two orderings: verified by simulation, it reproduces
   * the exact 5-sprite sequence and the exact toggle-at-index-3 timing the
   * disassembly requires, at the cost of two small, disclosed shifts neither
   * of which changes what is shown — the animation's first frame (table[0])
   * is visible one tick EARLIER (on the arming tick itself, instead of the
   * next one), and correspondingly one extra tick shows the (already
   * correctly toggled) ordinary sprite at the end before the object goes
   * fully idle. The alternative order (step AFTER player.tick()) is worse:
   * it advances a freshly-armed animation before its own first render ever
   * runs, which SKIPS table[0] outright rather than merely shifting it. */
  if (leverToggle) leverToggle.step();
  /* CS:0x4C39-0x4C4A etc. — fall-landing damage needs both the health
   * target (to subtract from) and the invulnerability flag (CS:0x172),
   * threaded as one small object matching the {invulnerable, hurt} shape
   * this project already uses at every other combat.js consumer site. */
  const healthApi = health ? { invulnerable: invuln, hurt: (n) => health.damage(n) } : null;
  /* CS:0x0223 — the selector-2 turret walker (CS:0xAD88) runs here, after the
   * projectiles and BEFORE the player. The player's epilogue fires plane-B
   * events (CS:0x5E9B -> 0x5FAB), so a selector-2 event materialises its
   * turrets on the NEXT tick; System A/B (CS:0x0285/0x028B) spawn in the same one. */
  if (beforePlayer) beforePlayer();                                   // 0223
  if (heroDead) {
    return { heroDead, projectiles, emitted: null, picked: picked.taken,
             consumed: picked.consumed || [], treasures: picked.treasures || [],
             loot, burstFx, blockFx, debrisFx, familiarDraw, keyCollected: null, dropped: null, leverToggled: null,
             footstep: false, climbStep: false, landSfx: 0, inventoryCycled: false };
  }
  /* CS:0x0248: while the shop potion's countdown runs, CS:0x06B0 turns the
   * hero toward the shopkeeper instead of the player dispatch (CS:0x4993);
   * while the shopkeeper walks, CS:0x49AA runs only the epilogue. The
   * potion is taken in the object pass above, so it already counts here. */
  if (shopkeeper && shopkeeper.turning) {
    const face = shopkeeper.faceFor(world);
    if (player.stateIndex === face.state && player.phase === FACE_PHASE) player.hold();   // CS:0x06D9/0x06F3
    else player.tick(map, { up: false, down: false, fire: false,                        // CS:0x06DB-0x0714
                            left: face.dir === 'left', right: face.dir === 'right' },
                     arsenal, tock, pickupCtx, healthApi, tock36d);
  } else if (shopkeeper && shopkeeper.active) {
    player.hold();                                                    // CS:0x49AA -> 0x5E9B
  } else {
    player.tick(map, input, arsenal, tock, pickupCtx, healthApi, tock36d);   // 0254
  }
  return { projectiles, emitted: player.emitted, picked: picked.taken,
           consumed: picked.consumed || [], treasures: picked.treasures || [],
           loot, burstFx, blockFx, debrisFx, familiarDraw, keyCollected: player.keyCollected,
           dropped: player.dropped,
           leverToggled: player.leverToggled,
           /* CS:0x5AB3/0x5AC0 (footstep) and the FUN_1000_5931 thunk's four
            * callers (climb step) — see player.js's own FOOTSTEP_SFX/
            * CLIMB_STEP_SFX for the ids. Both flags are already gated to the
            * real cadence by the phase machine itself (footstep only at
            * WALK_FOOTSTEP_PHASES, climbStep only at the ping-pong
            * turn-arounds behind the tock===0 early return) — surfacing them
            * here is not a "per tick" trigger, it is the tuned one. */
           footstep: player.footstep, climbStep: player.climbStep, landSfx: player.landSfx, inventoryCycled: player.inventoryCycled };
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
 * @param {?Function} sfx     played with `KILL_SFX` on either death branch —
 *   see combat.js's `attackHero`/`creatureScansGrid` for which reaches it.
 * @param {?Set} systemA      the System-A entities among `enemies`: their
 *   CS:0xFF93 call (CS:0xE0AA) is inside the DS:0x35E bracket CS:0xE0A5-
 *   0xE0AD, System B's (CS:0xEDF4) is not (combat.js KILL_ALT_SFX).
 * @param {?Score} score     DS:0x3B5 — the kill award, CS:0xEFE7 (treasure.js
 *   `awardKill`).
 * @returns {{touched:number, killed:number}}
 */
export function stepCreatureDamage(enemies, { grid, cam, hero, health,
                                              decodeTag, difficulty = 0,
                                              arsenal = null, rng = null,
                                              debris = null, sfx = null,
                                              systemA = null, score = null }) {
  /* The scans below append to the shared target list through combat.js's
   * sink (main.js installs it; the gate DS:0x343 is open while the hero
   * carries the hunter or the familiar lives). */
  let touched = 0, killed = 0;
  for (const e of enemies) {
    if (!e.alive || e.justAlive) continue;               // CS:0xFF48 — see entity.js
    const alt35e = !!(systemA && systemA.has(e));
    const c = creatureTouchesHero(e, hero, health, { sfx, alt35e });
    if (c.strengthOut < 0) {                             // CS:0xa9ec — contact won
      touched++;
      if (score) awardKill(score, e.hp);                 // CS:0xEDF7 -> 0xF02A / CS:0xE241
      continue;
    }
    const s = creatureScansGrid(e, grid, cam, decodeTag, difficulty,
                                undefined, null, { rng, debris, sfx, alt35e });
    if (s.killed) {
      killed++; e.frame = -1; e.delay = 0;
      /* The kill tick's score: [di+8] < 0 after the contact call sends
       * System B to CS:0xF02A and System A to CS:0xE241, both `call 0xEFE7`
       * (descriptor +1, the entity's hp). */
      if (score) awardKill(score, e.hp);
    }
  }
  return { touched, killed };
}

/** CS:0x9130/0x9137/0x913E all compare a slot word against 8 — the hunter. */
export const HUNTER_WEAPON = 8;

/** DS:0x343, the target-list gate: every writer (CS:0x9124-0x9146, 0xC359,
 *  0xC481-0xC496) computes "a familiar lives or a slot holds the hunter". */
export const targetGateOpen = (health, arsenal) =>
  (!!health && health.familiarEnergy >= 0)
  || arsenal.slots.some((s) => s.weapon === HUNTER_WEAPON);
