import { readFileSync, existsSync } from 'node:fs';
const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1, sliceTiles } = await import('../src/formats/pi1.js');
const { parseMap } = await import('../src/formats/map.js');
const url = (n) => new URL('../game/' + n, import.meta.url);
const has = (n) => existsSync(url(n));
const raw = (n) => new Uint8Array(readFileSync(url(n)));
const sheet = (n) => sliceTiles(decodePI1(dclDecompress(raw(n)).data));

console.log('For each map, score every candidate second sheet by how many of its');
console.log('high-index cells (120-239) land on a BLANK tile. Lower is better; 0 is a fit.\n');
for (const key of ['1A','1B','2A','2B','3A','3B','4A','4B']) {
  const w = key[0];
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const used = new Map();
  for (const v of map.planeA) if (v>=120 && v<240) used.set(v,(used.get(v)||0)+1);
  const total = [...used.values()].reduce((a,b)=>a+b,0);
  const cands = [`PLEVEL${key}.PI1`, `PLEVEL${w}A.PI1`, `PLEVEL${w}B.PI1`,
                 `PXTRA${key}.PI1`, `PXTRA${w}A.PI1`, `PXTRA${w}B.PI1`,
                 `PBITS${w}A.PI1`, `PBITS${w}B.PI1`];
  const seen = new Set(); const scores = [];
  for (const c of cands) {
    if (seen.has(c) || !has(c)) continue; seen.add(c);
    const t = sheet(c);
    let blank = 0;
    for (const [v,n] of used) if (t[v-120].every(p=>p===0)) blank += n;
    scores.push([c, blank]);
  }
  scores.sort((a,b)=>a[1]-b[1]);
  const best = scores.filter(s=>s[1]===scores[0][1]).map(s=>s[0].replace('.PI1',''));
  console.log(`PLEV${key} (${String(total).padStart(3)} cells)  best=${scores[0][1]} -> ${best.join(', ')}`);
  console.log(`    ${scores.map(([c,b])=>`${c.replace('.PI1','')}:${b}`).join('  ')}`);
}
