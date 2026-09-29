import { readFileSync } from 'node:fs';
const { dclDecompress } = await import('../src/formats/dcl.js');
const { parseMap, MAP_COLS, MAP_ROWS } = await import('../src/formats/map.js');
const { EventRunner, parsePalfils, palfilsNameFor } = await import('../src/game/events.js');
const raw = (n) => new Uint8Array(readFileSync(new URL('../game/' + n, import.meta.url)));

console.log('Simulating a hero visiting EVERY plane-B event cell, per level.\n');
for (const key of ['1A','1B','2A','2B','3A','3B','4A','4B']) {
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const pal = parsePalfils(dclDecompress(raw(palfilsNameFor(key))).data);
  const run = new EventRunner(map, pal);
  // a generous state so condition-gated triggers can fire
  const st = run.makeState({ timer: 17 * 400, score: 500000, lives: 5, res0192: 20 });
  let visited = 0;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (map.planeB[r * MAP_COLS + c] < 3) continue;
      visited++;
      run.step(c * 32, r * 16, st);
    }
  }
  const msgs = run.log.filter(e => e.msg);
  const unh = [...run.unhandled.entries()].sort((a,b)=>b[1]-a[1]).map(([s,n])=>`${s}:${n}`).join(' ');
  console.log(`PLEV${key}: ${visited} event cells visited -> ${run.log.length} triggers fired, ${msgs.length} with text`);
  console.log(`   unhandled selectors: ${unh || '(none)'}`);
  for (const m of msgs.slice(0, 4)) console.log(`   trigger ${String(m.trigger).padStart(2)} verb ${String(m.verb).padStart(2)}  "${m.msg}"`);
}
