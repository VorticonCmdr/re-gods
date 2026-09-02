import { readFileSync } from 'node:fs';
const { dclDecompress } = await import('../src/formats/dcl.js');
const { parseMap, MAP_COLS } = await import('../src/formats/map.js');
const raw = (n) => new Uint8Array(readFileSync(new URL('../public/game/' + n, import.meta.url)));
console.log('Actual plane-A values >= 120, per map:\n');
const allHi = new Set();
for (const key of ['1A','1B','2A','2B','3A','3B','4A','4B']) {
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const c = new Map();
  for (const v of map.planeA) if (v>=120) { c.set(v,(c.get(v)||0)+1); allHi.add(v); }
  const vals=[...c.keys()].sort((a,b)=>a-b);
  console.log(`PLEV${key}: min=${vals[0]} max=${vals[vals.length-1]}`);
  console.log(`   ${vals.join(' ')}`);
}
const hi=[...allHi].sort((a,b)=>a-b);
console.log(`\nUnion of all high values: min=${hi[0]} max=${hi[hi.length-1]}, count=${hi.length}`);
console.log(`   all >= 128? ${hi.every(v=>v>=128)}`);
console.log(`   all < 240?  ${hi.every(v=>v<240)}`);
console.log(`   values 120..127 present? ${hi.some(v=>v>=120&&v<128)}`);
// low-side distribution for comparison
for (const key of ['1A']) {
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const lo = new Set(); for (const v of map.planeA) if (v<120) lo.add(v);
  const l=[...lo].sort((a,b)=>a-b);
  console.log(`\nPLEV1A low values: min=${l[0]} max=${l[l.length-1]} distinct=${l.length}`);
  console.log(`   overlap of (hi-128) with low set: ${hi.filter(v=>lo.has(v-128)).length}/${hi.length}`);
  console.log(`   overlap of (hi-120) with low set: ${hi.filter(v=>lo.has(v-120)).length}/${hi.length}`);
}
