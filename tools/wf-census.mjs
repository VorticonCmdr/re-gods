/* wf-census.mjs — shipped-data census for the 2026-09-29 audit's [WF] leads:
 *   (a) which placed selector-1 (PAT) descriptors name behaviour class 3 per world;
 *   (b) which placed selector-1 / selector-2 descriptors carry a score byte
 *       >= 198, the CS:0xAF7D overflow range ((v>>1)+1 >= 100).
 * "Placed" = referenced by a plane-B event cell of that level's own map. */
import { readFileSync } from 'node:fs';
const here = (n) => new URL('../public/game/' + n, import.meta.url);
const raw = (n) => new Uint8Array(readFileSync(here(n)));
const { dclDecompress } = await import('../src/formats/dcl.js');
const { parseMap } = await import('../src/formats/map.js');
const { parsePalfils } = await import('../src/game/events.js');
const { parsePatSpawnDescriptor } = await import('../src/game/pat-objects.js');
const { parseClasses } = await import('../src/game/selector2.js');
for (const w of [1, 2, 3, 4]) for (const s of ['A', 'B']) {
  const pf = dclDecompress(raw(`PALFILS.0${s}${w}`)).data;
  const map = parseMap(dclDecompress(raw(`PLEV${w}${s}.MAP`)).data);
  const pal = parsePalfils(pf);
  const sel2 = parseClasses(pf);
  const cells = new Map();
  for (let i = 0; i < map.planeB.length; i++) {
    const v = map.planeB[i]; if (v < 3) continue;
    const ev = pal.events[v - 3]; if (!ev) continue;
    const k = v - 3; if (!cells.has(k)) cells.set(k, { ev, cells: [] });
    cells.get(k).cells.push([(i % 128) * 32, Math.floor(i / 128) * 16]);
  }
  for (const [k, { ev, cells: c }] of cells) {
    if (ev.selector === 1) {
      const d = parsePatSpawnDescriptor(pf, ev.param);
      if (d.behaviorClassIndex === 3 || d.key >= 198)
        console.log(`${w}${s} ev${k} sel1 desc${ev.param}`, JSON.stringify(d), 'cells', JSON.stringify(c.slice(0, 3)));
    } else if (ev.selector === 2) {
      const d = sel2[ev.param];
      if (d && d.entityState0 >= 198)
        console.log(`${w}${s} ev${k} sel2 desc${ev.param} state0=${d.entityState0} n=${d.entityCount} cls=${d.classIndex}`, 'cells', JSON.stringify(c.slice(0, 3)));
    }
  }
}
