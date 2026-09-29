import { readFileSync } from 'node:fs';
const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1, sliceTiles } = await import('../src/formats/pi1.js');
const { parseMap, MAP_COLS, MAP_ROWS } = await import('../src/formats/map.js');
const raw = (n) => new Uint8Array(readFileSync(new URL('../game/' + n, import.meta.url)));

console.log('Does PLEVEL<key>.PI1 supply tile indices 120-239?');
console.log('For each map: which HIGH tile indices are used, and are those tiles blank');
console.log('in PLEVEL (hypothesis) vs in a WRONG sheet (control: the other sublevel)?\n');
console.log('key   cells@120+  distinct  blank-in-PLEVEL  blank-in-WRONG-SHEET');
let goodT=0, goodC=0, ctrlT=0, ctrlC=0;
for (const key of ['1A','1B','2A','2B','3A','3B','4A','4B']) {
  const other = key[0] + (key[1]==='A'?'B':'A');           // control: wrong sublevel
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const hyp  = sliceTiles(decodePI1(dclDecompress(raw(`PLEVEL${key}.PI1`)).data));
  const ctrl = sliceTiles(decodePI1(dclDecompress(raw(`PLEVEL${other}.PI1`)).data));
  const used = new Map();
  for (const v of map.planeA) if (v>=120 && v<240) used.set(v,(used.get(v)||0)+1);
  let cells=0, blankH=0, blankC=0, distinct=0;
  for (const [v,n] of used) {
    distinct++; cells+=n;
    const th = hyp[v-120], tc = ctrl[v-120];
    if (th.every(p=>p===0)) blankH+=n;
    if (tc.every(p=>p===0)) blankC+=n;
  }
  if (cells) { goodT+=cells; goodC+=blankH; ctrlT+=cells; ctrlC+=blankC; }
  console.log(`${key}   ${String(cells).padStart(8)}  ${String(distinct).padStart(8)}  ${String(blankH).padStart(14)}  ${String(blankC).padStart(19)}`);
}
console.log(`\nTOTAL cells referencing tiles 120-239: ${goodT}`);
console.log(`  blank under HYPOTHESIS (own PLEVEL sheet) : ${goodC}  (${(100*goodC/goodT).toFixed(1)}%)`);
console.log(`  blank under CONTROL   (other sublevel)    : ${ctrlC}  (${(100*ctrlC/ctrlT).toFixed(1)}%)`);
