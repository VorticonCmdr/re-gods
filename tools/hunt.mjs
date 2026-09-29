/* hunt.mjs — does an enemy actually pursue?
 *
 * There is no differential test available for this subsystem: the seed choice
 * is randomised from a wall-clock-seeded replay table, so the original is not
 * reproducible run-to-run either. But the randomness enters at exactly ONE
 * point — the `rnd` draw in CS:0xf6f7's nibble choice — so pinning that value
 * makes the whole chain deterministic without faking any of it.
 *
 * The test is behavioural and two-sided:
 *   1. On a real level, put an enemy on real ground with the hero some tiles
 *      away and step it. Does its distance to the hero go DOWN?
 *   2. Wall it off. Does the search correctly report "no path"?
 * A pursuit test that only passes on an open field proves very little.
 *
 * Usage: node tools/hunt.mjs [levelKey]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const key = process.argv[2] || '1A';

const { dclDecompress } = await import('../src/formats/dcl.js');
const { parseMap } = await import('../src/formats/map.js');
const { runSearch } = await import('../src/game/pathfind-producers.js');
const { applyVerdict, VERDICT, VERDICT_NONE } = await import('../src/game/pathfind.js');
const { EntityB, MODE, groundBelow } = await import('../src/game/entity.js');
const { parseGroupsB, DESC_B_OFF, DESC_STRIDE } = await import('../src/game/spawn.js');
const { palfilsNameFor } = await import('../src/game/events.js');

const raw = (n) => {
  const p = join(ROOT, 'game', n);
  if (!existsSync(p)) throw new Error(`missing ${n} — run: npm run assets`);
  return new Uint8Array(readFileSync(p));
};

const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
const pf = dclDecompress(raw(palfilsNameFor(key))).data;
const groups = parseGroupsB(pf);

/* Take a real shipped descriptor and read the four fields the search uses. */
const descOf = (i) => {
  const o = DESC_B_OFF + i * DESC_STRIDE;
  return {
    index: i,
    seedPair:   pf[o + 0x08],
    seedWeight: pf[o + 0x09],
    hopUnlock:  pf[o + 0x0c],
    budget:     pf[o + 0x0d],
    speed:      pf[o + 0x0b],
  };
};

/* Find a wide run of solid ground with headroom — somewhere a chase can
 * actually happen. We do not invent geometry; we look for it in the map. */
function findCorridor(minWidth) {
  for (let row = 4; row < 60; row++) {
    let run = 0;
    for (let col = 1; col < 127; col++) {
      const solidBelow = map.planeB[(row + 2) * 128 + col] === 1;
      const clear = map.planeB[row * 128 + col] === 0
                 && map.planeB[(row + 1) * 128 + col] === 0;
      if (solidBelow && clear) { run++; if (run >= minWidth) return { row, col: col - run + 1, run }; }
      else run = 0;
    }
  }
  return null;
}

const corr = findCorridor(9);
if (!corr) { console.log(`PLEV${key}: no corridor wide enough — try another level`); process.exit(0); }
console.log(`PLEV${key}: corridor row ${corr.row}, cols ${corr.col}..${corr.col + corr.run - 1}\n`);

const dist = (e, hx) => Math.abs(e.x - hx);

function chase({ desc, rnd, enemyCol, heroCol, ticks, walls = [] }) {
  const planeB = Uint8Array.from(map.planeB);
  /* A wall must be taller than a hop can clear or the test proves nothing:
   * seed 7 rises 32 px = 2 tiles, seed 13 rises 80 px = 5. Six tiles is out
   * of reach of both. */
  for (const c of walls) {
    for (let r = corr.row - 4; r <= corr.row + 1; r++) planeB[r * 128 + c] = 1;
  }
  const y = corr.row * 16;
  const heroX = heroCol * 32, heroY = y;
  const e = Object.assign(
    new EntityB({ x: enemyCol * 32, y, mode: MODE.WALK_L, speed: desc.speed || 9 }),
    { state: 1 });

  /* Both actors must sit inside the search cull (screen x in (-64, 352)),
   * or CS:0xf586 returns before it does anything — which is a real behaviour,
   * not a test artefact, so the camera has to be placed as the game would. */
  const camX = Math.max(0, Math.min(enemyCol, heroCol) * 32 - 48);
  const camY = Math.max(0, y - 80);
  const start = dist(e, heroX);
  const verdicts = [];
  let seedUsed = -1;
  /* The original's gate exactly: the search runs ONLY from the two walk
   * handlers, only on a tile crossing, and only when standing on ground
   * (CS:0xf11f -> 0xf136 -> 0xf141). Everything else just runs its mode.
   * Applying a verdict outside that gate re-seeds the hop cursor every tick
   * and freezes the entity mid-air — which is what a first version of this
   * harness did, and it looked exactly like a broken pathfinder. */
  const walking = () => e.mode === MODE.WALK_L || e.mode === MODE.WALK_R;
  for (let t = 0; t < ticks; t++) {
    let verdict = VERDICT_NONE;
    if (walking() && (e.x & 0x1c) === 0 && groundBelow(planeB, e.x, e.y)) {
      const r = runSearch(e, { planeB, camX, camY, heroX, heroY, desc, rnd });
      seedUsed = r.seed;
      verdict = r.verdict;
      verdicts.push(verdict);
    }
    e.tick(planeB, verdict);     // _walk itself decides patrol / keep / apply
  }
  return { start, end: dist(e, heroX), verdicts, seedUsed, e };
}

/* Use a descriptor whose LOW nibble is strategy 0 (direct pursuit) and pin
 * rnd so that nibble is the one chosen. */
const cands = groups.map((g, i) => descOf(i))
  .filter((d) => (d.seedPair & 0xf) === 0 && d.budget >= 8);
const desc = cands[0] || descOf(0);
console.log(`descriptor #${desc.index}: seedPair 0x${desc.seedPair.toString(16)}, ` +
            `weight ${desc.seedWeight}, budget ${desc.budget}, hopUnlock ${desc.hopUnlock}`);

const eCol = corr.col, hCol = corr.col + corr.run - 1;

/* rnd = 0 can never lose to the weight (`swap only when weight < rnd`), so
 * the LOW nibble always wins — strategy 0, direct pursuit. */
const open = chase({ desc, rnd: 0, enemyCol: eCol, heroCol: hCol, ticks: 60 });
console.log(`\nOPEN corridor  enemy col ${eCol} -> hero col ${hCol}`);
console.log(`  seed strategy used : ${open.seedUsed}`);
console.log(`  distance ${open.start} -> ${open.end} px   ` +
            `${open.end < open.start ? 'CLOSED IN' : 'did not close'}`);
console.log(`  verdicts: ${open.verdicts.slice(0, 12).map(
  (v) => (v < 0 ? 'none' : `${v}:${VERDICT[v].label.split(',')[0]}`)).join(' ')}`);

/* Now wall the enemy off between it and the hero. */
const wallCol = eCol + 3;
const blocked = chase({ desc, rnd: 0, enemyCol: eCol, heroCol: hCol, ticks: 60,
                        walls: [wallCol] });
console.log(`\nWALLED at col ${wallCol}`);
console.log(`  distance ${blocked.start} -> ${blocked.end} px`);
const noPath = blocked.verdicts.filter((v) => v < 0).length;
console.log(`  ${noPath}/${blocked.verdicts.length} searches reported NO PATH`);
const tally = {};
for (const v of blocked.verdicts) {
  const k = v < 0 ? 'none' : `${v}:${VERDICT[v].label}`;
  tally[k] = (tally[k] || 0) + 1;
}
console.log(`  verdict tally: ${Object.entries(tally).map(([k, n]) => `${k} x${n}`).join(', ')}`);
console.log(`  final: x ${blocked.e.x} (col ${blocked.e.x >> 5}), mode ${blocked.e.mode}, vel ${blocked.e.vel}`);

/* And the hero on the other side: the verdict should reverse. */
const away = chase({ desc, rnd: 0, enemyCol: hCol, heroCol: eCol, ticks: 60 });
console.log(`\nMIRROR  enemy col ${hCol} -> hero col ${eCol}`);
console.log(`  distance ${away.start} -> ${away.end} px   ` +
            `${away.end < away.start ? 'CLOSED IN' : 'did not close'}`);
console.log(`  first verdicts: ${away.verdicts.slice(0, 6).map(
  (v) => (v < 0 ? 'none' : v)).join(' ')}`);
