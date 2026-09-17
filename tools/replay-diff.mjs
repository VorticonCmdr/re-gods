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
 *    (game/frame.js) ONLY. It does not spawn or tick System-A/System-B
 *    entities, the starburst, destructible blocks, or objects/pickups —
 *    `objects`/`starburst`/`blocks`/`debris` are all passed as null. A tick
 *    where the live game had an enemy touch the hero, or the hero walk over
 *    a pickup, WILL diverge here, and that divergence is a harness
 *    limitation, not necessarily a port bug — read the divergence's field
 *    and tick before concluding either way.
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
 * diverges by 2px on camY (port 526, live 524); the live trace's own delta
 * sequence from tick 0 (+8,+4,+0,+2,+1,+1) is otherwise IDENTICAL to what
 * Camera#update's own proven formula produces (+8,+4,+2,+1,+1) except for
 * one extra tick's worth of stall — i.e. every observed delta is one the
 * formula can produce, just attributed to a different tick than the port's.
 * WHETHER that's a real one-tick stall in the original or an artifact of
 * this capture's own sampling (it samples on DS:0x282 changing, at
 * CS:0x24DB — early in FUN_1000_006f, well before the camera epilogue at
 * CS:0x0254 — so a sample can land before or after that SAME tick's camera
 * update depending on exactly where a `wait_frames(1)` poll fell) is NOT
 * resolved. A precise per-tick sample (an execute breakpoint at CS:0x02C6,
 * after the epilogue, instead of polling the cursor) would settle it; not
 * done this pass. Do not read this as a confirmed port bug. Camera fields
 * are compared using `cam.snapX/snapY`
 * (the pre-update snapshot each tick's own physics ran against), not the
 * just-updated `cam.x/y` — matching DS:0xa/0xc's own live-read timing is
 * what made ticks 0-2 line up; comparing post-update values put every tick
 * off by one instead.
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
const { DamageGrid } = await import('../src/game/collision.js');
const { Camera } = await import('../src/game/camera.js');
const { stepHeroFrame } = await import('../src/game/frame.js');

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

/* ── 2. load world 1B/2B/3B — planeB (collision terrain) and weapons only.
 * stepHeroFrame's other systems (objects/starburst/blocks/debris) are all
 * null per this file's disclosed scope above, so nothing else is needed. */
const world = JOYG_WORLD[n];
const key = `${world}B`;
const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
const weapons = parseWeapons(dclDecompress(raw(`PWEAPONS.00${world}`)).data);

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
  /* Log the SNAPSHOT (camera as it stood entering this tick, what this
   * tick's own physics/render used), not the just-updated cam.x/y — the
   * live capture reads DS:0xa/0xc, which camera.js's own header documents
   * as one tick behind the snapshot the ORIGINAL draws against; matching
   * that convention is what made tick 0's camY line up. */
  trajectory.push({ tick: i, heroX: player.x, heroY: player.y, state: player.stateIndex,
                     camX: cam.snapX, camY: cam.snapY });
  cam.update(player.x, player.y, { world, sublevel: 1 });
}

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
