/* replay-diff.mjs — replay a recorded PJOYG*.DAT attract-mode input stream
 * through the port's own physics and compare the trajectory to a live
 * DOSBox capture of the SAME recording, tick by tick.
 *
 * WHY THIS EXISTS. Every other check in this project's suite exercises one
 * subsystem against a hand-picked scenario. This is different: `PJOYG1/2/3.
 * DAT` are the game's OWN fixed, byte-exact input scripts, so replaying one
 * is the closest thing to "run the same play session through both the
 * original and the port and diff what happens" this project has — no test
 * author bias about which inputs to try.
 *
 * SCOPE, disclosed up front, not discovered by a reader mid-file:
 *  - Only `joyg` files decode into gameplay ticks (`src/formats/joy.js`);
 *    `joyl` drives the title menu instead and is out of scope here.
 *  - This harness drives Player/Camera/Arsenal/DamageGrid via `stepHeroFrame`
 *    (game/frame.js) ONLY for the hero half. `objects`/`starburst`/`blocks`/
 *    `debris` are all still passed as null — no pickups, no destructible
 *    blocks, no starburst chain reaction. A tick where the live game had the
 *    hero walk over a pickup WILL diverge here, and that divergence is a
 *    harness limitation, not necessarily a port bug.
 *  - ENTITY TICKING (added later than the above): System-A and System-B
 *    enemies ARE now spawned and ticked, the same call order `main.js`
 *    itself uses — `events.step()` (plane-B probe -> event record -> the
 *    selector-4/5 activation branches ONLY, see below) -> `runSpawns[A]()`
 *    -> each system's own `e.tick()` loop (with the real pathfinder,
 *    `pathfind-producers.js`'s `runSearch`) -> `stepCreatureDamage` (contact,
 *    then the grid scan — the SAME call `frame.js` documents at CS:0x0285)
 *    -> the CS:0xEDAA/0xDFF9 runtime-slot RELEASE loops -> `EnemyShots`/
 *    `LineHazards` `.step()` (CS:0x02BA/0x02BD — after contact, so a shot an
 *    entity fires THIS tick can still reach the hero this same tick, exactly
 *    as frame.js's own `ENEMY_SHOTS_AT` note describes) -> the spawn-protect
 *    countdown and `health.chase()`.
 *    Still NOT ported into this harness, all cosmetic/item-flow with no
 *    effect on the hero's own x/y/state/camera fields this tool compares:
 *    steal-and-carry, the carried-item ease/drop, the death-time item drop,
 *    the group-elimination reward popup (all popup.js — no `Popup` instance
 *    exists here), nest/statue/ce64/pat-objects/selector-2/line-barriers,
 *    the message line, zone teleport/exit, and every TRIGGER ACTION verb
 *    (selector 3's own evaluator runs and consumes its event record, but
 *    `EventRunner.actionCtx` is left null, so a fired trigger's verb —
 *    door/lever/etc. — never executes; the SPAWN selectors 1/2/4/5 are
 *    handled earlier in `dispatchEvent` regardless of `actionCtx` and are
 *    unaffected by this). Debris puffs from a creature hit or a terrain-
 *    stopped enemy shot are also not spawned (`debris: null` throughout).
 *  - Entity AI randomness (`pathfind-producers.js`'s `runSearch`, the hit-
 *    spark jitter) is seeded with `new GodsRandom(1)` — the SAME arbitrary
 *    constant `main.js` itself already uses (not a new choice introduced by
 *    this file). The live capture's own `seed` field is always `null` (the
 *    real seed is the BIOS tick count at boot, unrecoverable — see
 *    `docs/camera-and-world-nav.md`'s Randomness section), so ANY rng-
 *    branching entity behavior is unvalidatable against DOSBox by
 *    construction — a limitation of what can be captured, not of this code.
 *  - Adding entity ticking is disclosed as adding SIMULATION COMPLETENESS,
 *    not VERIFICATION: `joyg1-live-capture.json` records only
 *    `{tick,heroX,heroY,state,camX,camY}` — no entity ground truth exists to
 *    diff against. If the hero/camera divergence below ever changes as a
 *    result of entity ticking being added, that is evidence this wiring
 *    perturbed the hero path (a bug to find), not a new port finding — the
 *    fixed showcase spawn is far from anything that could reach the hero in
 *    the first several ticks, and re-running `--live` after this change
 *    reproduced the exact same tick 0-2 match / tick 3 divergence as before.
 *  - A tick where the live game had an enemy touch the hero WILL still
 *    diverge here if this port's own entity spawn/AI logic disagrees with
 *    the original at that point — that's a real thing to read, same as any
 *    other divergence this tool reports; it's just not yet checkable against
 *    a live capture at the entity level, only at the hero/camera level.
 *  - The attract-mode entry point's tick-0 initial condition is now KNOWN,
 *    not derived from a live capture: full disassembly of `FUN_1000_8c34`
 *    (CS:0x8FBE-0x8FC3), called from `FUN_1000_006f`'s own per-level init
 *    and gated by the one-shot `DS:0x3e7` flag the joyg cycler dispatch
 *    sets, is what actually writes `DS:0x3bd:=1` and `DS:0x282:=0` — NOT
 *    the cycler dispatch itself (`CS:0x2DD5`-`0x2DEE`), which was this
 *    project's own earlier, superseded reading (see the `Gods` repo's
 *    corrected `docs/asset-formats.md` for the full trace). It hard-codes a
 *    fixed showcase hero/camera position keyed on `DS:0x3e6`'s value AFTER
 *    the dispatch's own increment: `JOYG_SHOWCASE_SPAWN` below is that
 *    table. Only joyg1's entry (world 1) is live-confirmed — a DOSBox
 *    capture this session matched it byte-for-byte (hero (3424,608), camera
 *    (3296,512)); joyg2/joyg3 are disassembly-derived, not yet live-checked.
 *  - `DS:0x282` (the joyg playback cursor) IS a reliable, monotonic per-tick
 *    index once you know where it resets — confirmed live this session:
 *    `tools/joyg1-live-capture.json` watched it run cleanly from a captured
 *    mid-stream value up to exactly 405 (PJOYG1.DAT's real decompressed
 *    length) before `DS:0x3bd` cleared on its own, a complete, correctly-
 *    terminated recording. An EARLIER attempt this session wrongly
 *    concluded the cursor was unrecoverable after watching it run into the
 *    thousands — that capture had anchored on the wrong event (`DS:0x3bd`
 *    going nonzero from LEFTOVER state, not from this actual reset site)
 *    and is superseded by this finding, not consistent with it.
 *
 * RESULT, joyg1 (`--live tools/joyg1-live-capture.json`): ticks 0-2 match
 * the live capture EXACTLY across hero X/Y, state and camera. Tick 3 then
 * diverges by 2px on camY (port 526, live 524). Camera fields are compared
 * using `cam.snapX/snapY` (the pre-update snapshot each tick's own physics
 * ran against), not the just-updated `cam.x/y` — matching DS:0xa/0xc's own
 * live-read timing is what made ticks 0-2 line up; comparing post-update
 * values put every tick off by one instead.
 *
 * ⚠️ **CONFIRMED, `[PROVEN]` live in DOSBox this session — this is a REAL
 * divergence, not a sampling artifact.** An earlier pass of this session left
 * it unresolved because the only live evidence was a Lua script polling
 * `DS:0x282` roughly once per frame, which samples at an unpinned point
 * within the tick. This pass settled it with an execute breakpoint at
 * `CS:0x02C6` (right after the camera epilogue, before the health-bar
 * chase — see frame.js's own `FRAME_ORDER`), reading `DS:0xa/0xc` (camera)
 * and `DS:0x282` (cursor, which tells you EXACTLY which recorded-input pass
 * you're reading — real_tick = cursor_after_increment - 1) at every hit.
 * Five consecutive samples this way:
 *
 *     pass consuming ticks[2] -> POST camY=524   (cursor 2->3)
 *     pass consuming ticks[3] -> POST camY=526   (cursor 3->4)
 *     pass consuming ticks[4] -> POST camY=527   (cursor 4->5)
 *     pass consuming ticks[5] -> POST camY=528   (cursor 5->6)
 *     pass consuming ticks[6] -> PRE  camY=528, BX register read LIVE at
 *                                 CS:0x5F33 = 0x50 (80) EXACTLY — the dead-
 *                                 zone boundary, confirming the camera has
 *                                 already settled to 608-80=528 (hero.y=608,
 *                                 unmoving throughout — confirmed by reading
 *                                 DS:0x17a/0x17c at every hit too).
 *
 * These five values are EXACTLY what the earlier, ambiguously-sampled
 * `joyg1-live-capture.json` already showed (524,526,527,528,528) — an
 * independent method (register-precise, tagged by a ground-truth counter
 * instead of frame-polling) reproducing the old capture's numbers exactly is
 * strong confirmation, not a coincidence.
 *
 * WHERE IT DIVERGES: `ticks[0]` and `ticks[1]` run normally in the original
 * (512->520->524, matching the port's own trajectory[0..2] exactly — this
 * prefix rests on the EARLIER capture plus the port's own agreement with it,
 * not on this session's own cursor-tagged reads, which start at ticks[2]).
 * The pass that consumes `ticks[2]` is where the two diverge: the ORIGINAL
 * produces a ZERO delta there (524 stays 524), while the PORT's
 * `Camera#update()` computes bx=608-524=84, dx=(84-80)>>1=2, a nonzero step
 * to 526 — one tick too early. From `ticks[3]` onward the original's own
 * deltas exactly resume the formula the port already implements, just one
 * pass later than the port assumes (real[N] for N>=3 equals what the
 * formula computes starting one index earlier) — so this is a single
 * missing no-op tick at one specific point (the pass consuming `ticks[2]`),
 * not a wrong formula and not a constant one-tick offset applied everywhere.
 *
 * WHAT IS STILL NOT KNOWN: `Camera#update()`'s own arithmetic is disassembly-
 * confirmed correct (CS:0x5F33-0x5F51 matches game/camera.js's vertical
 * branch instruction for instruction) — every pass that DOES apply a step
 * computes the SAME step the port computes. What's missing is WHY the
 * original's pass consuming `ticks[2]` specifically skips applying it. Not
 * yet located: whether `FUN_1000_4993` (the player state machine `CS:0x0254`
 * calls, which contains the camera epilogue) gates the camera call itself on
 * some condition true only for that one pass (an ARRIVAL-state artifact,
 * hero.stateIndex=4 throughout this window — untested), or something else.
 * The discriminating next probe: re-anchor to a fresh joyg1 spawn and break
 * at `CS:0x5F33` itself (not `CS:0x02C6`) on passes 0-3, reading live `BX`
 * each time — if pass 2's own `BX` reads 84 (matching the port's own
 * computed bx) but still produces no step, the bug is IN the epilogue's own
 * branch/rounding; if the epilogue's `CS:0x5EA4` entry is never reached at
 * all on that pass, something upstream (FUN_1000_4993's own dispatch) is
 * gating the call. Not done this session — this pass confirms the
 * divergence is real and pins it to one exact tick; it does not fix it.
 * `Camera#update()` itself is not touched here — its arithmetic is proven
 * correct on every pass that runs; the defect is a missing call on one pass,
 * not a wrong formula, and patching the formula (or special-casing tick 0,
 * an earlier, since-corrected hypothesis this same session) would encode a
 * guess into code that's already proven right.
 *
 * RESULT, entity ticking (all three joygN, run with no --live — no entity
 * ground truth exists to check against, see the header above): the plane-B
 * probe -> event dispatch chain fires on every recording (2/1/1 records
 * consumed for joyg1/2/3, each a real selector-3 trigger evaluation), but
 * ZERO System-A/System-B group activations occur on any of them — a static
 * census of all three levels' own plane-B cells (12/32/26 real selector-4/5
 * spawn cells on PLEV1B/2B/3B respectively) found none within reach of any
 * recording's own fixed showcase path: joyg1 walks x=[3424,3844] at y=608
 * (PLEV1B's cells top out at x=2752); joyg2 walks x=[160,448] at y=960
 * (PLEV2B's cells top out at y=928, and none share joyg2's x range at that
 * y); joyg3 walks x=[96,444] at y=[80,160] (PLEV3B's cells start at y=176).
 * So the selector-4/5 BRANCHES of `dispatchEvent` — `runSpawns[A]()`, both
 * entity `tick()` loops, `runSearch`, `stepCreatureDamage`'s loop body, the
 * slot-release loops, and every muzzle-routing branch — never execute on any
 * shipped recording; that is a measured property of these three fixed
 * paths, not a claim that spawn dispatch is broken. Those code paths were
 * smoke-tested separately this session (not left in the shipped tool): a
 * forced `events.onSpawnB(3)` — a real census-verified param on PLEV1B — ran
 * `runSpawnsB`/`e.tick()`/the release loop end to end with no error, and a
 * synthetic entity placed directly on the joyg1 showcase spawn point drove a
 * full contact through `stepCreatureDamage` (health.target 24 -> 19, entity
 * state -> dying) with no error either. Neither test is reachable from the
 * shipped recordings themselves, hence not left as a runtime option here.
 * See the `events:`/`entities:` lines this tool prints on every run, which
 * report the consumed/fired/activation counts explicitly rather than
 * silently show "0 entities" with no way to tell an untested path from an
 * exercised-but-empty one. Re-running the `--live` diff after adding entity
 * ticking reproduced the EXACT SAME tick 0-2 match / tick 3 camY divergence
 * as before this change (still port=526/live=524) — the required check that
 * this addition didn't perturb the hero/camera path it cannot itself verify.
 *
 * USAGE
 *   node tools/replay-diff.mjs <joygN> [--live capture.json] [--ticks N]
 *
 * Without --live, this just runs the decoded recording through the port and
 * prints the trajectory (position/state/camera each tick) plus the decode
 * self-check — useful on its own to sanity-check the port's physics against
 * a fixed script, and to eyeball before a DOSBox capture exists yet.
 *
 * With --live <capture.json>, diffs against ground truth captured by the
 * companion DOSBox Lua script (docs comment in that script explains the
 * capture's exact JSON shape) and reports the FIRST divergent tick and
 * field, not a pass/fail — per this project's own evidence discipline, a
 * divergence is a lead to read, not a test failure to silence.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB  = resolve(here, '..', 'public');

const { dclDecompress } = await import('../src/formats/dcl.js');
const { parseMap } = await import('../src/formats/map.js');
const { decodeJoyRecording, JOYG_WORLD } = await import('../src/formats/joy.js');
const { parseWeapons } = await import('../src/game/weapons.js');
const { Player } = await import('../src/game/player.js');
const { Arsenal } = await import('../src/game/hero-fire.js');
const { DamageGrid, damageForTag, despawnConsumedHit } = await import('../src/game/collision.js');
const { Camera } = await import('../src/game/camera.js');
const { stepHeroFrame, stepCreatureDamage } = await import('../src/game/frame.js');
const { parsePalfils, palfilsNameFor, EventRunner } = await import('../src/game/events.js');
const { parseGroupsB, parseGroupsA, GroupSlots, MAX_ENTITIES,
        groupSlotReleasable } = await import('../src/game/spawn.js');
const { EntityB, MODE, groundBelow, EST } = await import('../src/game/entity.js');
const { EntityA, EST: ESTA } = await import('../src/game/entity-a.js');
const { runSearch } = await import('../src/game/pathfind-producers.js');
const { VERDICT_NONE } = await import('../src/game/pathfind.js');
const { GodsRandom } = await import('../src/game/random.js');
const { Health } = await import('../src/game/combat.js');
const { INVULN_TICKS_SPAWN } = await import('../src/game/consumables.js');
const { EnemyShots } = await import('../src/game/enemy-shots.js');
const { LineHazards } = await import('../src/game/line-hazard.js');
const { MarkerList } = await import('../src/game/markers.js');

/* The three shipped lengths, INCLUDING the trailing 0xFF sentinel —
 * docs/asset-formats.md's own re-measured figures. Pinned here as the
 * cheapest possible guard against a stale/corrupt fixture: if `npm run
 * assets` ever stages a different PJOYG*.DAT, this catches it immediately
 * instead of silently replaying the wrong recording. */
const EXPECTED_COMPRESSED_TICKS = { 1: 404, 2: 523, 3: 888 }; // length-1 (sentinel)

/* FUN_1000_8c34, CS:0x8F40-0x8FBB — the fixed showcase hero/camera position
 * per joyg segment, keyed on DS:0x3e6's value right after the cycler
 * dispatch's own INC (CS:0x2DA9). joyg1 dispatches with the OLD value 1,
 * landing DS:0x3e6=2 by the time this runs; joyg2 similarly lands on 4;
 * joyg3 dispatches with OLD value 5, which CS:0x2DAD-0x2DB1's own special
 * case wraps back to 0 before this code ever sees it. Only n=1 (world 1) is
 * live-confirmed — see the header. */
const JOYG_SHOWCASE_SPAWN = {
  1: { heroX: 0xd60, heroY: 0x260, camX: 0xce0, camY: 0x200 }, // (3424,608)/(3296,512)
  2: { heroX: 0xa0,  heroY: 0x3c0, camX: 0xa0,  camY: 0x340 }, // (160,960)/(160,832)
  3: { heroX: 0x60,  heroY: 0x50,  camX: 0,     camY: 0 },     // (96,80)/(0,0)
};

const raw = (name) => {
  const p = join(PUB, 'game', name);
  if (!existsSync(p)) throw new Error(`missing asset: ${name} (run: npm run assets)`);
  return new Uint8Array(readFileSync(p));
};

const args = process.argv.slice(2);
const which = (args.find((a) => /^joyg[123]$/i.test(a)) || 'joyg1').toLowerCase();
const n = +which[4];
const liveArgIdx = args.indexOf('--live');
const livePath = liveArgIdx >= 0 ? args[liveArgIdx + 1] : null;
const ticksArgIdx = args.indexOf('--ticks');
const tickCap = ticksArgIdx >= 0 ? +args[ticksArgIdx + 1] : Infinity;

console.log(`GODS web port — replay-diff (PJOYG${n}.DAT, world ${JOYG_WORLD[n]} sublevel B)\n`);

/* ── 1. decode the recording ──────────────────────────────────────────── */
const rawJoy = dclDecompress(raw(`PJOYG${n}.DAT`)).data;
const { ticks, terminatorIndex, liveBitsClean } = decodeJoyRecording(rawJoy);
const expected = EXPECTED_COMPRESSED_TICKS[n];
const lenOk = ticks.length === expected && terminatorIndex === rawJoy.length - 1;
console.log(`  ${lenOk ? 'ok  ' : 'FAIL'}  decoded ${ticks.length} ticks, terminator at byte ${terminatorIndex}` +
            ` of ${rawJoy.length} (expected ${expected} ticks)`);
console.log(`  ${liveBitsClean ? 'ok  ' : 'FAIL'}  no non-terminator byte sets bits 4-6`);
if (!lenOk) { console.error('\nFixture mismatch — aborting before replay.'); process.exit(1); }

/* ── 2. load world 1B/2B/3B — planeB (collision terrain), weapons, and the
 * level's own PALFILS (events + the System-A/System-B group descriptor
 * tables entities spawn from — see the header's ENTITY TICKING section).
 * stepHeroFrame's own other systems (objects/starburst/blocks/debris) stay
 * null per this file's disclosed scope above. */
const world = JOYG_WORLD[n];
const key = `${world}B`;
const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
const weapons = parseWeapons(dclDecompress(raw(`PWEAPONS.00${world}`)).data);
const palfilsBytes = dclDecompress(raw(palfilsNameFor(key))).data;
const palfils = parsePalfils(palfilsBytes);
const levelGroupsB = parseGroupsB(palfilsBytes);
const levelGroupsA = parseGroupsA(palfilsBytes);

/* ── 3. initial conditions ────────────────────────────────────────────
 * FUN_1000_8c34's own showcase-spawn table (JOYG_SHOWCASE_SPAWN above) is
 * the disassembly-proven default. A --live capture's own tick-0 sample, if
 * present, is preferred (it's the same value for n=1, live-confirmed). */
let live = null;
if (livePath) {
  const raw = JSON.parse(readFileSync(livePath, 'utf8'));
  const byTick = new Map(raw.samples.map((s) => [s.tick, s]));
  live = { seed: raw.seed, byTick };
  console.log(`\n  loaded live capture: ${raw.samples.length} samples ` +
              `(ticks ${raw.samples[0].tick}-${raw.samples[raw.samples.length - 1].tick}), ` +
              `seed=0x${(raw.seed || 0).toString(16)}`);
}
const spawn = JOYG_SHOWCASE_SPAWN[n];
const t0 = live?.byTick?.get(0) || spawn;
const startX = t0.heroX, startY = t0.heroY;
const startCamX = t0.camX, startCamY = t0.camY;

const player = new Player(startX, startY);
player.spawnAtLevelStart(startX, startY); // CS:0x8C34-0x8C52 — the SAME init FUN_1000_8c34 runs
const arsenal = new Arsenal(weapons);
const grid = new DamageGrid();
const cam = new Camera(startCamX, startCamY);

/* ── 3b. entity systems (System A / System B) — see the header's ENTITY
 * TICKING section for exactly what is and is not ported here. */
const events = new EventRunner(map, palfils);
const slotsB = new GroupSlots();
const slotsA = new GroupSlots();
const enemiesB = [];
const enemiesA = [];
const runtimeGroupsB = [];   // {desc, members, slot, released} — release bookkeeping only
const runtimeGroupsA = [];
events.onSpawnB = (param) => {
  const d = levelGroupsB[param];
  if (!d || !d.live) return;
  if (slotsB.activate(d)) entityActivationsB++;
};
events.onSpawnA = (param) => {
  const d = levelGroupsA[param];
  if (!d || !d.live) return;
  if (slotsA.activate(d)) entityActivationsA++;
};
/* CS:0xec60 — main.js's own `runSpawns`, ported verbatim (see main.js's own
 * citation for the count-0/oversized-count quirks reproduced here too). */
const runSpawnsB = () => {
  for (const slot of slotsB.slots) {
    if (slot.state !== 2) continue;
    const d = slot.desc;
    if (d.count === 0) continue;
    const cnt = Math.min(d.count, MAX_ENTITIES);
    const x = d.tileX * 32, y = d.tileY * 16;
    const onGround = groundBelow(map.planeB, x, y);
    const mode = ((d.flags >> 9) & 1) + (onGround ? 0 : 2);
    let delay = 0;
    const members = [];
    for (let i = 0; i < cnt; i++) {
      const e = Object.assign(
        new EntityB({ x, y, mode, speed: d.speed, hp: d.hp || 1, cls: d.cls, delay }),
        { desc: d });
      enemiesB.push(e); members.push(e);
      delay += d.stagger;
    }
    runtimeGroupsB.push({ desc: d, members, slot, released: false });
    slot.state = 1;
  }
};
/* CS:0xde7d — main.js's own `runSpawnsA`, ported verbatim. */
const runSpawnsA = () => {
  for (const slot of slotsA.slots) {
    if (slot.state !== 2) continue;
    const d = slot.desc;
    if (d.count === 0) continue;
    const cnt = Math.min(d.count, MAX_ENTITIES);
    const x = d.tileX * 32, y = d.tileY * 16;
    const members = [];
    for (let i = 0; i < cnt; i++) {
      const e = Object.assign(
        new EntityA({ x, y, cls: d.cls, hp: d.hp || 1, delay: 0 }),
        { desc: d });
      enemiesA.push(e); members.push(e);
    }
    runtimeGroupsA.push({ desc: d, members, slot, released: false });
    slot.state = 1;
  }
};
const health = new Health();
let fxInvuln = INVULN_TICKS_SPAWN;                        // CS:0x0860 — spawn protection
const shots = new EnemyShots();
const lineHazards = new LineHazards();
const markerList = new MarkerList();                      // stays empty — objects is null
/* `new GodsRandom(1)` — see the header's caveat: matches main.js's own
 * pre-existing constant-seed convention, not independently chosen here. */
const rng = new GodsRandom(1);
const difficulty = 0;                                     // DS:0x365 — world 1 is unscaled
/* The SAME closure shape main.js's own `decodeTag` uses (game/collision.js's
 * `damageForTag`/`despawnConsumedHit`), needed by `stepCreatureDamage`'s grid
 * scan to resolve what a projectile-stamped cell actually is. */
const decodeTag = (tag, mode = 0) => {
  const d = damageForTag(
    tag, arsenal.slots.map((s) => s.weapon),
    Object.fromEntries(arsenal.slots.filter((s) => s.st).map((s) => [s.weapon, s.st])),
    mode);
  despawnConsumedHit(d, arsenal.weapons, arsenal.slots.map((s) => s.area));
  return d;
};
let entityActivationsB = 0, entityActivationsA = 0, contactsTotal = 0, killsTotal = 0;

/* ── 4. replay ─────────────────────────────────────────────────────────── */
const trajectory = [];
const n_ticks = Math.min(ticks.length, tickCap);
for (let i = 0; i < n_ticks; i++) {
  const input = ticks[i];
  cam.snapshot();
  stepHeroFrame({
    input, arsenal, grid, player, map,
    cam: { x: cam.snapX, y: cam.snapY }, world,
    tock: (i % 2) + 1,
  });

  /* ── entity ticking — same relative order as main.js's tick, with every
   * skipped subsystem between these calls named in the header. `events.step`
   * runs the plane-B probe; its selector-4/5 branches (System-B/System-A
   * group activation) fire regardless of `actionCtx`, so they work with no
   * further wiring — see EventRunner.dispatchEvent's own early-return shape.
   * `timer: i` is this REPLAY's own tick index, not main.js's `clock.tick` —
   * a session-global counter that, on the real attract-mode path, has
   * already been running since the title screen. A timer-comparing trigger
   * condition (COND `case 7`/`8` etc., trigger.js) would see a different
   * value here; none of the events actually reached on these three
   * recordings are timer-gated, so this has not been exercised either way. */
  events.step(player.x, player.y, events.makeState({ timer: i }));
  runSpawnsB();
  /* THE HUNT — CS:0xf11f/0xf1e5, ported verbatim from main.js's own loop
   * (only a walking entity, aligned to a tile, standing on ground searches). */
  for (const e of enemiesB) {
    let verdict = VERDICT_NONE;
    const walking = e.mode === MODE.WALK_L || e.mode === MODE.WALK_R;
    if (e.alive && walking && (e.x & 0x1c) === 0 && groundBelow(map.planeB, e.x, e.y)) {
      verdict = runSearch(e, {
        planeB: map.planeB, camX: cam.snapX, camY: cam.snapY,
        heroX: player.x, heroY: player.y, desc: e.desc,
        rnd: rng.next(), world,
        markers: markerList.entries, markersOverride: markerList.override,
      }).verdict;
    }
    const muzzleB = e.tick(map.planeB, verdict, e.desc);   // CS:0xE659, before the mode dispatch
    if (muzzleB && muzzleB.hazard) {
      if (muzzleB.attackBits === 1) {
        lineHazards.spawnJittered(muzzleB.x, muzzleB.y, player.x, player.y,
                                   muzzleB.n, () => rng.next());
      } else {
        lineHazards.spawnAtHero(muzzleB.x, muzzleB.y, player.x, player.y, muzzleB.n);
      }
    } else if (muzzleB) {
      shots.fire(muzzleB.x, muzzleB.y, muzzleB.dir, { x: cam.snapX, y: cam.snapY });
    }
    /* Steal-and-carry / death-time drop are NOT ported here — cosmetic
     * item flow with no effect on the fields this tool compares; see header. */
  }
  runSpawnsA();
  /* System A's own six-stage pipeline, CS:0xe001 — same call as main.js's. */
  for (const e of enemiesA) {
    const muzzle = e.tick({ x: player.x, y: player.y }, e.desc, () => rng.next(), false,
                           { x: cam.snapX, y: cam.snapY }, markerList.entries, grid, null);
    if (muzzle && muzzle.hazard) {
      if (muzzle.attackBits === 1) {
        lineHazards.spawnJittered(muzzle.x, muzzle.y, player.x, player.y,
                                   muzzle.n, () => rng.next());
      } else {
        lineHazards.spawnAtHero(muzzle.x, muzzle.y, player.x, player.y, muzzle.n);
      }
    } else if (muzzle) {
      shots.fire(muzzle.x, muzzle.y, muzzle.dir, { x: cam.snapX, y: cam.snapY });
    }
  }
  /* CS:0x0285 — contact, then the damage-grid scan; frame.js's own
   * stepCreatureDamage, the SAME function main.js calls. */
  const dmg = stepCreatureDamage([...enemiesB, ...enemiesA], {
    grid, cam: { x: cam.snapX, y: cam.snapY },
    hero: { x: player.x, y: player.y, state: player.stateIndex },
    health, decodeTag, difficulty, arsenal,
    rng: () => rng.next(), debris: null,
    invuln: fxInvuln > 0 ? 1 : 0, sfx: null,
  });
  contactsTotal += dmg.touched; killsTotal += dmg.killed;
  /* CS:0xEDAA/0xDFF9 — release a group's runtime slot once every member is
   * fully FREE (the reward-popup loops main.js also runs here are skipped —
   * cosmetic, see header). */
  for (const g of runtimeGroupsB) {
    if (g.released) continue;
    if (!groupSlotReleasable(g.members, g.desc.count, EST.FREE)) continue;
    g.released = true; g.slot.state = 0;
  }
  for (const g of runtimeGroupsA) {
    if (g.released) continue;
    if (!groupSlotReleasable(g.members, g.desc.count, ESTA.FREE)) continue;
    g.released = true; g.slot.state = 0;
  }
  /* CS:0x02BA/0x02BD — AFTER contact, so a shot fired by an entity THIS tick
   * can still reach the hero this same tick (frame.js's ENEMY_SHOTS_AT note). */
  const heroSnap = { x: player.x, y: player.y, state: player.stateIndex };
  const healthAdapter = { invulnerable: fxInvuln > 0, hurt: (dn) => health.damage(dn) };
  shots.step({ x: cam.snapX, y: cam.snapY }, heroSnap, map.planeB, healthAdapter, null);
  lineHazards.step({ x: cam.snapX, y: cam.snapY }, heroSnap, map.planeB, healthAdapter, null, i % 2);
  if (fxInvuln > 0) fxInvuln--;
  health.chase();

  /* Log the SNAPSHOT (camera as it stood entering this tick, what this
   * tick's own physics/render used), not the just-updated cam.x/y — the
   * live capture reads DS:0xa/0xc, which camera.js's own header documents
   * as one tick behind the snapshot the ORIGINAL draws against; matching
   * that convention is what made tick 0's camY line up. */
  trajectory.push({ tick: i, heroX: player.x, heroY: player.y, state: player.stateIndex,
                     camX: cam.snapX, camY: cam.snapY });
  cam.update(player.x, player.y, { world, sublevel: 1 });
}

/* `events.consumedEvents.size` is every plane-B event record the probe ever
 * reached and consumed (any selector); `events.log.length` is only the
 * subset that were selector-3 TRIGGER evaluations that actually fired. The
 * gap between them and `entityActivationsB/A` is what a reader needs to
 * tell "the probe found nothing at all near this path" apart from "it found
 * events, just none were spawns" — see the header's zero-activations note. */
console.log(`\n  events: ${events.consumedEvents.size} record(s) consumed, ` +
            `${events.log.length} trigger evaluation(s) fired`);
console.log(`  entities: ${entityActivationsB} System-B group activation(s), ` +
            `${entityActivationsA} System-A group activation(s), ` +
            `${enemiesB.length + enemiesA.length} entities spawned total, ` +
            `${contactsTotal} hero contact(s), ${killsTotal} kill(s), ` +
            `hero health target=${health.target} bar=${health.bar}` +
            (slotsB.lostActivations || slotsA.lostActivations
              ? ` (lost activations: B=${slotsB.lostActivations} A=${slotsA.lostActivations})` : ''));

console.log(`\n  replayed ${trajectory.length} ticks through the port's physics.`);
console.log(`  final: hero=(${player.x},${player.y}) state=${player.stateIndex} cam=(${cam.x},${cam.y})`);

/* ── 5. diff against the live capture, if given ───────────────────────── *
 * Indexed by TICK, not array position: a live capture can have gaps (see
 * tools/joyg1-live-capture.json's own two disjoint ranges), so only ticks
 * actually present in the capture are compared. */
if (live) {
  const FIELDS = ['heroX', 'heroY', 'state', 'camX', 'camY'];
  let firstDivergence = null;
  let compared = 0;
  for (const a of trajectory) {
    const b = live.byTick.get(a.tick);
    if (!b) continue;
    compared++;
    for (const f of FIELDS) {
      if (a[f] !== b[f]) { firstDivergence = { tick: a.tick, field: f, port: a[f], live: b[f] }; break; }
    }
    if (firstDivergence) break;
  }
  console.log('');
  if (compared === 0) {
    console.log(`  note  no overlap between the ${trajectory.length}-tick replay and the live capture's ticks`);
  } else if (!firstDivergence) {
    console.log(`  ok    all ${compared} live-captured ticks match exactly across ${FIELDS.join('/')}`);
  } else {
    console.log(`  FAIL  first divergence at tick ${firstDivergence.tick}, field '${firstDivergence.field}':` +
                ` port=${firstDivergence.port} live=${firstDivergence.live}`);
    const portAt = (t) => trajectory.find((x) => x.tick === t);
    const prevTick = firstDivergence.tick - 1;
    console.log(`  context (tick ${prevTick}): port=${JSON.stringify(portAt(prevTick))}` +
                ` live=${JSON.stringify(live.byTick.get(prevTick))}`);
  }
} else {
  console.log('\n  (no --live capture given — decode/replay self-check only, no diff run)');
}
