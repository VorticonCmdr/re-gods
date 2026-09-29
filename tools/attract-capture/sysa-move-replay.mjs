/* sysa-move-replay.mjs — one-tick movement replay of every strategy-4
 * follower in the live captures through the PORT's EntityA.tick() with its
 * group runtime (Gods ranked item 68): x, y, vx, vy and +0x25 must match the
 * next snapshot. Stage 3 is skipped (no grid), as in the captures' scenes.
 *
 *   node tools/attract-capture/sysa-move-replay.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../../', import.meta.url));
const { GroupRuntimesA } = await import(R + 'src/game/sysa-group.js');
const { EntityA } = await import(R + 'src/game/entity-a.js');
const { parseGroupsA } = await import(R + 'src/game/spawn.js');
const { dclDecompress } = await import(R + 'src/formats/dcl.js');
const { parseMap } = await import(R + 'src/formats/map.js');
const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const sw = (b, o) => { const v = b[o] | (b[o + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; };
const sb = (b, o) => (b[o] & 0x80 ? b[o] - 0x100 : b[o]);
for (const [file, pf, mp, di] of [['sys2b.json', 'PALFILS.0B2', 'PLEV2B.MAP', 2], ['sys4b.json', 'PALFILS.0B4', 'PLEV4B.MAP', 3]]) {
  const log = JSON.parse(readFileSync(R + 'tools/attract-capture/' + file));
  const d = parseGroupsA(dclDecompress(new Uint8Array(readFileSync(R + 'public/game/' + pf))).data)[di];
  const planeA = parseMap(dclDecompress(new Uint8Array(readFileSync(R + 'public/game/' + mp))).data).planeA;
  let n = 0, ok = 0; const bad = [];
  const rt = new GroupRuntimesA();
  for (let t = 0; t + 1 < log.ticks.length; t++) {
    const ga = log.ticks[t].groups.find((q) => q.k === 0), gb = log.ticks[t + 1].groups.find((q) => q.k === 0);
    if (!ga || !gb) continue;
    const a = hex(ga.ents), b = hex(gb.ents), rta = hex(ga.rt);
    rt.bytes.set(rta, 0);
    const steady = sb(rta, 0x12) === sb(hex(gb.rt), 0x12);
    for (let i = 0; i < 4; i++) {
      const o = i * 0x28;
      if (sb(a, o + 0x19) === 1 && sw(a, o + 8) > 0) { rt.trail(0, { x: sw(b, o), y: sw(b, o + 2) }); continue; }
      if (!steady || sb(a, o + 0x24) !== 4 || sw(a, o + 8) <= 0 || sw(b, o + 8) <= 0) continue;
      const e = new EntityA({ x: sw(a, o), y: sw(a, o + 2), cls: d.cls, hp: d.hp });
      Object.assign(e, { state: sw(a, o + 8), frame: sw(a, o + 4), vx: sw(a, o + 0x12), vy: sw(a, o + 0x14), stepCap: sw(a, o + 0x16),
        rank: sb(a, o + 0x19), arrivedCoarse: !!a[o + 0x1b], goalX: sw(a, o + 0x1c), goalY: sw(a, o + 0x1e), strategy: 4,
        arrivedFine: !!a[o + 0x25], animTimer: a[o + 0x26], facing: sb(a, o + 0x27), reloadTimer: sw(a, o + 0xe) });
      e.tick({ x: log.hero[0], y: log.hero[1] }, d, () => 0, false, null, null, null, null, { rt, k: 0, i, members: [], planeA });
      n++;
      const want = [sw(b, o), sw(b, o + 2), sw(b, o + 0x12), sw(b, o + 0x14), b[o + 0x25]];
      const got = [e.x, e.y, e.vx, e.vy, e.arrivedFine ? 1 : 0];
      if (want.join() === got.join()) ok++; else if (bad.length < 6) bad.push({ t: t + 1, i, want: want.join(), got: got.join() });
    }
  }
  console.log(file, `follower one-tick moves exact ${ok}/${n}`, JSON.stringify(bad));
}
