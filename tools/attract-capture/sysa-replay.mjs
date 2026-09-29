/* sysa-replay.mjs — replay the live System A captures through the PORT's own
 * game/sysa-group.js and compare byte for byte (Gods ranked item 68).
 *
 * For every logged tick t -> t+1 with no join, death or election in between:
 * load slot 0's runtime bytes from snapshot t, walk the members in index
 * order as CS:0xDF93 does (the rank-1 leader writes the trail, CS:0xE039;
 * each strategy-4 follower recomputes its goal, CS:0xE7DB), step the
 * rotation (CS:0xEB3D), then require
 *   - every follower goal == snapshot t+1's, and
 *   - runtime bytes +0x10..+0xE3 == snapshot t+1's (the ring overrun into
 *     +0xE0/+0xE2 included).
 *
 *   node tools/attract-capture/sysa-replay.mjs
 */
import { readFileSync } from 'node:fs';
const { GroupRuntimesA } = await import('../../src/game/sysa-group.js');
const { dclDecompress } = await import('../../src/formats/dcl.js');
const { parseMap } = await import('../../src/formats/map.js');

const here = (n) => new URL('./' + n, import.meta.url);
const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const sw = (b, o) => { const v = b[o] | (b[o + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; };
const sb = (b, o) => (b[o] & 0x80 ? b[o] - 0x100 : b[o]);

let failures = 0;
for (const [file, map, flags] of [['sys2b.json', 'PLEV2B.MAP', 0x0010], ['sys4b.json', 'PLEV4B.MAP', 0x00a2]]) {
  const log = JSON.parse(readFileSync(here(file)));
  const planeA = parseMap(dclDecompress(new Uint8Array(readFileSync(new URL('../../public/game/' + map, import.meta.url)))).data).planeA;
  const desc = { flags, count: 0 };
  const snaps = log.ticks.map((t) => { const g = t.groups.find((q) => q.k === 0); return g && { rt: hex(g.rt), e: hex(g.ents) }; });
  let ticks = 0, goals = 0, goalOk = 0, bytesOk = 0, skipped = 0;
  const bad = [];
  /* ONE buffer for the whole run: slot 0 (+0..+0xE3) is reloaded from the
   * log every tick, but what the ring overran into slot 1 is not logged, so
   * it is carried from the port's own previous writes — on skipped ticks too. */
  const rt = new GroupRuntimesA();
  for (let t = 0; t + 1 < snaps.length; t++) {
    const a = snaps[t], b = snaps[t + 1];
    if (!a || !b) continue;
    const same = [0x12, 0x14, 0x15].every((o) => a.rt[o] === b.rt[o]);
    rt.bytes.set(a.rt, 0);
    if (!same || sb(a.rt, 0x12) === 0) {
      skipped++;
      for (let i = 0; i < 10; i++) {                   // the leader still writes the trail
        const o = i * 0x28;
        if (sb(b.e, o + 0x19) === 1 && sb(a.e, o + 0x19) === 1 && sw(b.e, o + 8) > 0) rt.trail(0, { x: sw(b.e, o), y: sw(b.e, o + 2) });
      }
      continue;
    }
    const n = 10;
    let ok = true;
    for (let i = 0; i < n; i++) {
      const o = i * 0x28;
      const rank = sb(b.e, o + 0x19), strat = sb(b.e, o + 0x24), hp = sw(b.e, o + 8);
      const ent = { x: sw(b.e, o), y: sw(b.e, o + 2), rank, stepCap: 2, goalX: 0, goalY: 0 };
      /* The leader writes the trail (CS:0xE039) BEFORE its own contact test
       * (CS:0xE0AA), so a leader that died this tick still wrote it. */
      if (hp <= 0) { if (sb(a.e, o + 0x19) === 1 && sw(a.e, o + 8) > 0) rt.trail(0, ent); continue; }
      if (strat === 4 && rank >= 2) {
        rt.strategy4(0, ent, desc, planeA);
        goals++;
        if (ent.goalX === sw(b.e, o + 0x1c) && ent.goalY === sw(b.e, o + 0x1e)) goalOk++;
        else { ok = false; if (bad.length < 5) bad.push({ t: t + 1, i, port: [ent.goalX, ent.goalY], dos: [sw(b.e, o + 0x1c), sw(b.e, o + 0x1e)] }); }
      }
      if (rank === 1) rt.trail(0, ent);
    }
    rt.elect(0, [], desc, () => { throw new Error('no draw expected with a leader'); });
    const mine = rt.bytes.subarray(0x10, 0xe4), dos = b.rt.subarray(0x10, 0xe4);
    const eq = mine.every((v, i) => v === dos[i]);
    ticks++;
    if (eq) bytesOk++; else { ok = false; if (bad.length < 5) bad.push({ t: t + 1, bytes: 'differ' }); }
    if (!ok) failures++;
  }
  console.log(`${file}: ${ticks} ticks replayed (${skipped} join/death/election/leaderless skipped): ` +
    `runtime bytes exact ${bytesOk}/${ticks}, follower goals ${goalOk}/${goals}`, bad.length ? JSON.stringify(bad) : '');
}
process.exitCode = failures ? 1 : 0;
