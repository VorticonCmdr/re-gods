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
 *  - The attract-mode entry point (FUN_1000_6b00, via a DS:0x3e7-gated
 *    showcase spot) is NOT reproduced — this harness cannot derive tick-0's
 *    hero position/state/camera from first principles. A live capture must
 *    supply them; see --live below.
 *  - Ground truth for `joyg` CANNOT be captured by polling DS:0x282 (the
 *    playback cursor) — confirmed by disassembly (Gods/docs/asset-formats.md,
 *    the "cursor reset only on joyl" note): CS:0x2DCC resets it to 0 on the
 *    joyl branch, but the joyg branch (CS:0x2DD5-0x2DEE) never does, so the
 *    cursor's value at joyg1's own tick 0 depends on whatever ran before it
 *    and is not a reliable tick index. A live capture attempt this session
 *    watched the cursor run past the 405-byte PJOYG1.DAT buffer into the
 *    thousands with DS:0x3bd still set (the documented "no bounds check"
 *    behavior). The next attempt at a `--live` capture should anchor tick 0
 *    with an EXECUTE breakpoint at CS:0x2DEE (the `JMP 0x6B00` itself, the
 *    instant joyg1's file is loaded and real gameplay begins) or at
 *    FUN_1000_006f's first entry for the level, not a memory-polled flag.
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
 * Deliberately NOT derived — see the header. Falls back to this level's
 * ordinary A-side spawn (cameraForSpawn's own ordinary path) only so this
 * tool is runnable stand-alone; that is almost certainly NOT where the
 * attract-mode showcase actually starts, so every field printed below is
 * suspect until --live supplies a real tick-0 capture. */
let live = null;
if (livePath) {
  live = JSON.parse(readFileSync(livePath, 'utf8'));
  console.log(`\n  loaded live capture: ${live.samples.length} samples, seed=0x${(live.seed || 0).toString(16)}`);
}
const t0 = live?.samples?.[0];
const startX = t0 ? t0.heroX : 512, startY = t0 ? t0.heroY : 900;
const startCamX = t0 ? t0.camX : startX - 0x90, startCamY = t0 ? t0.camY : startY - 0x48;

const player = new Player(startX, startY);
if (t0?.state !== undefined) { player.stateIndex = t0.state; }
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
  cam.update(player.x, player.y, { world, sublevel: 1 });
  trajectory.push({ tick: i, heroX: player.x, heroY: player.y, state: player.stateIndex,
                     camX: cam.x, camY: cam.y });
}

console.log(`\n  replayed ${trajectory.length} ticks through the port's physics.`);
console.log(`  final: hero=(${player.x},${player.y}) state=${player.stateIndex} cam=(${cam.x},${cam.y})`);

/* ── 5. diff against the live capture, if given ───────────────────────── */
if (live) {
  const FIELDS = ['heroX', 'heroY', 'state', 'camX', 'camY'];
  let firstDivergence = null;
  const m = Math.min(trajectory.length, live.samples.length);
  for (let i = 0; i < m && !firstDivergence; i++) {
    const a = trajectory[i], b = live.samples[i];
    for (const f of FIELDS) {
      if (a[f] !== b[f]) { firstDivergence = { tick: i, field: f, port: a[f], live: b[f] }; break; }
    }
  }
  console.log('');
  if (!firstDivergence) {
    console.log(`  ok    all ${m} sampled ticks match exactly across ${FIELDS.join('/')}`);
    if (trajectory.length !== live.samples.length) {
      console.log(`  note  lengths differ: port ran ${trajectory.length} ticks, live capture has ${live.samples.length}`);
    }
  } else {
    console.log(`  FAIL  first divergence at tick ${firstDivergence.tick}, field '${firstDivergence.field}':` +
                ` port=${firstDivergence.port} live=${firstDivergence.live}`);
    const ctx = (arr, i) => arr[Math.max(0, i - 1)];
    console.log(`  context (tick ${Math.max(0, firstDivergence.tick - 1)}):` +
                ` port=${JSON.stringify(ctx(trajectory, firstDivergence.tick))}` +
                ` live=${JSON.stringify(ctx(live.samples, firstDivergence.tick))}`);
  }
} else {
  console.log('\n  (no --live capture given — decode/replay self-check only, no diff run)');
}
