/* spawn-census.mjs — where do the enemies go?
 *
 * Simulates a hero who visits EVERY plane-B event cell in a level, wires all
 * four enemy allocator pools, and reports — per level, per pool — how many
 * activations were attempted, how many the pool REFUSED because every runtime
 * slot was busy, and how many enemies actually materialised.
 *
 * WHY THIS EXISTS. The port drew fewer enemies than GAME.EXE and nothing said
 * so: every pool consumes its event record BEFORE it looks for a free slot
 * (CS:0xde08, CS:0xB908, CS:0xAD0D all share that shape), so a refused
 * activation is lost for good AND silent. This tool makes the loss a number.
 *
 * It deliberately does NOT model kills: it measures the pool pressure a
 * pacifist sweep creates, which is the upper bound on slot occupancy and the
 * regime the original's own free paths exist to relieve. A pool that refuses
 * nothing here can never refuse in play; a pool that refuses here depends
 * entirely on its release path being correct.
 *
 * ⚠️ READ `refused` AGAINST THE POOL'S RELEASE PATH, or you will over-read it:
 *   - TURRET (selector 2) DOES release — an entity dies, or scrolls past its
 *     own screen edge (`culled()`, selector2.js:794 -> `e.state = 0`), and the
 *     slot is nulled once every entity is down (selector2.js:717). Its number
 *     here is PRESSURE, not loss; real play recycles.
 *   - PAT (selector 1) and SysA/SysB (selectors 5/4) have NO release path in
 *     this port at all — `slot.active` is cleared only by `clear()` at level
 *     reset, and `GroupSlots` state never returns to 0. For those three pools
 *     the number here IS the loss, and it is permanent within a level.
 */
import { readFileSync } from 'node:fs';

const here = (n) => new URL('../public/game/' + n, import.meta.url);
const raw = (n) => new Uint8Array(readFileSync(here(n)));

const { dclDecompress } = await import('../src/formats/dcl.js');
const { parseMap, MAP_COLS, MAP_ROWS } = await import('../src/formats/map.js');
const { parsePalfils, palfilsNameFor } = await import('../src/game/events.js');
const { parseGroupsA, parseGroupsB, GroupSlots, MAX_ENTITIES } = await import('../src/game/spawn.js');
const { PatGroups, parsePatDirectory, parsePatSpawnDescriptor, CLASS_TABLE_A, GROUP_SLOTS } =
  await import('../src/game/pat-objects.js');
const { SelectorTwoSpawns, parseClasses: parseSelectorTwoClasses } =
  await import('../src/game/selector2.js');
const { CLASS_TABLES_B } = await import('../src/game/spawn.js');

const LEVELS = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'];
const pad = (v, n) => String(v).padStart(n);

console.log('SPAWN CENSUS — a hero who walks over every event cell, kills nothing.\n');
console.log('  attempted = selector dispatches that reached an allocator');
console.log('  refused   = allocator found no free runtime slot (event already consumed -> lost for good)');
console.log('  dropped   = allocator took the event but produced nothing (unresolvable class, dead descriptor)');
console.log('  entities  = enemies that actually materialised\n');

const totals = {};
const bump = (pool, field, n = 1) => {
  totals[pool] ||= { attempted: 0, refused: 0, dropped: 0, entities: 0 };
  totals[pool][field] += n;
};

for (const key of LEVELS) {
  const world = +key[0];
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const pfRaw = dclDecompress(raw(palfilsNameFor(key))).data;
  const pal = parsePalfils(pfRaw);
  const groupsB = parseGroupsB(pfRaw);
  const groupsA = parseGroupsA(pfRaw);
  const groupsSel2 = parseSelectorTwoClasses(pfRaw);
  const patDescriptors = Array.from({ length: 100 }, (_, i) => parsePatSpawnDescriptor(pfRaw, i));

  const slots = new GroupSlots();
  const slotsA = new GroupSlots();
  /* CS:0x3855 skips the FILE READ on sublevel 'b', but the destination
   * buffer DS:0x500 still holds the same world's blob from sublevel 'a' and
   * the walker reads it normally — see main.js's loader for the full note.
   * So the blob is available on both sublevels, and this mirrors that. */
  let patDir = [];
  try { patDir = parsePatDirectory(raw(`PGOD0${world}.PAT`)); } catch { patDir = []; }
  const pats = new PatGroups(patDir);
  const sel2 = new SelectorTwoSpawns();

  const st = { B: { a: 0, d: 0, e: 0 }, A: { a: 0, d: 0, e: 0 },
               PAT: { a: 0, d: 0, e: 0 }, SEL2: { a: 0, d: 0, e: 0 } };

  /* The four allocator callbacks, mirroring main.js's wireSpawn(). */
  const onB = (param) => {
    st.B.a++;
    const d = groupsB[param];
    if (!d || !d.live) { st.B.d++; return; }
    if (!slots.activate(d)) return;             // refused — counted by the pool
    st.B.e += Math.min(d.count, MAX_ENTITIES);  // runSpawns() materialises next tick
  };
  const onA = (param) => {
    st.A.a++;
    const d = groupsA[param];
    if (!d || !d.live) { st.A.d++; return; }
    if (!slotsA.activate(d)) return;
    st.A.e += Math.min(d.count, MAX_ENTITIES);
  };
  const onPat = (param) => {
    st.PAT.a++;
    const d = patDescriptors[param];
    if (!d) { st.PAT.d++; return; }
    const before = pats.lostActivations;
    const ok = pats.activate(d, world);
    if (!ok && pats.lostActivations === before) { st.PAT.d++; return; }   // the silent !cls drop
    if (!ok) return;                                                      // refused, counted by the pool
    /* Count at SEED time, not activate time: `#seed` reads the group's path
     * from the PGOD0<world>.PAT directory entry named by `pathClassIndex`,
     * and a missing entry seeds nothing (pat-objects.js `if (!dir)`). An
     * earlier revision of this tool counted `entityCount` on activation and
     * so over-reported by 27 enemies, all on B sublevels, hiding the fact
     * that the blob was not being loaded for them at all. */
    const dir = patDir[d.pathClassIndex];
    if (dir) st.PAT.e += Math.min(d.entityCount, 10);
    else st.PAT.d++;
  };
  const onSel2 = (param) => {
    st.SEL2.a++;
    const d = groupsSel2[param];
    if (!d || !d.live) { st.SEL2.d++; return; }
    const before = sel2.refused;
    const ok = sel2.spawn(d, world);
    /* spawn() has TWO false returns: the pool-full one (counted in `refused`)
     * and a silent `!rec` one when the class index escapes CLASS_TABLES_B. */
    if (!ok && sel2.refused === before) st.SEL2.d++;
    else if (ok) st.SEL2.e += d.entityCount;
  };

  /* Walk every event cell once. Event records self-consume, so revisits are
   * free and cell order does not change the totals. */
  const seen = new Set();
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const v = map.planeB[r * MAP_COLS + c];
      if (v < 3) continue;
      const id = v - 3;
      if (seen.has(id)) continue;
      seen.add(id);
      const ev = pal.events[id];
      if (!ev || ev.selector === 0 || (ev.selector & 0x8000)) continue;
      if (ev.selector === 1) onPat(ev.param);
      else if (ev.selector === 2) onSel2(ev.param);
      else if (ev.selector === 4) onB(ev.param);
      else if (ev.selector === 5) onA(ev.param);
    }
  }

  const rows = [
    ['PAT    (sel 1)', GROUP_SLOTS, st.PAT, pats.lostActivations],
    ['TURRET (sel 2)', sel2.slots.length, st.SEL2, sel2.refused],
    ['SysB   (sel 4)', slots.slots.length, st.B, slots.lostActivations],
    ['SysA   (sel 5)', slotsA.slots.length, st.A, slotsA.lostActivations],
  ];
  console.log(`PLEV${key}`);
  for (const [name, nslots, s, refused] of rows) {
    if (!s.a) continue;
    const flag = refused ? '  <-- LOSING ENEMIES' : '';
    console.log(`   ${name} ${pad(nslots, 2)} slots | attempted ${pad(s.a, 3)} | refused ${pad(refused, 3)}` +
                ` | dropped ${pad(s.d, 3)} | entities ${pad(s.e, 3)}${flag}`);
    const pool = name.split(' ')[0];
    bump(pool, 'attempted', s.a); bump(pool, 'refused', refused);
    bump(pool, 'dropped', s.d); bump(pool, 'entities', s.e);
  }
}

console.log('\nTOTALS ACROSS ALL 8 LEVELS');
let lost = 0;
for (const [pool, t] of Object.entries(totals)) {
  console.log(`   ${pool.padEnd(7)} attempted ${pad(t.attempted, 4)} | refused ${pad(t.refused, 4)}` +
              ` | dropped ${pad(t.dropped, 4)} | entities ${pad(t.entities, 4)}`);
  lost += t.refused + t.dropped;
}
console.log(`\n   ${lost} activations never became an enemy.`);

/* CLASS-TABLE COVERAGE — the other silent drop. An activation that finds a
 * free slot can still vanish if its behaviour-class index is past what this
 * port transcribed (pat-objects.js's `if (!cls) return false`). */
console.log('\nCLASS-TABLE COVERAGE (unresolvable behaviour-class indices)');
for (const key of LEVELS) {
  const world = +key[0];
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const pfRaw = dclDecompress(raw(palfilsNameFor(key))).data;
  const pal = parsePalfils(pfRaw);
  const miss = new Map();
  const seen = new Set();
  for (let i = 0; i < map.planeB.length; i++) {
    const v = map.planeB[i];
    if (v < 3 || seen.has(v - 3)) continue;
    seen.add(v - 3);
    const ev = pal.events[v - 3];
    if (!ev || ev.selector !== 1) continue;
    const d = parsePatSpawnDescriptor(pfRaw, ev.param);
    const table = CLASS_TABLE_A[world];
    if (!d || (table && table[d.behaviorClassIndex])) continue;
    miss.set(d.behaviorClassIndex, (miss.get(d.behaviorClassIndex) || 0) + 1);
  }
  if (miss.size) {
    console.log(`   PLEV${key}: PAT class indices unresolved -> ` +
      [...miss.entries()].map(([c, n]) => `cls ${c} x${n}`).join(', '));
  }
}
