import { readFileSync, writeFileSync } from 'node:fs';
const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1, sliceTiles, TILE_W, TILE_H } = await import('../src/formats/pi1.js');
const { parseMap, MAP_COLS, MAP_ROWS } = await import('../src/formats/map.js');
const raw = (n) => new Uint8Array(readFileSync(new URL('../game/' + n, import.meta.url)));
const key = process.argv[2] || '1A';

const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
const bits  = decodePI1(dclDecompress(raw(`PBITS${key}.PI1`)).data);
const level = decodePI1(dclDecompress(raw(`PLEVEL${key}.PI1`)).data);
// hypothesis: tiles 0..119 from PBITS, 120..239 from PLEVEL
const tiles = [...sliceTiles(bits), ...sliceTiles(level)];
const pal = level.palette;

// how many cells use each range?
let lo=0, hi=0, over=0;
for (const v of map.planeA) { if (v===0) continue; if (v<120) lo++; else if (v<240) hi++; else over++; }
console.log(`PLEV${key}: cells using tiles 0-119=${lo}  120-239=${hi}  >=240=${over}`);

// how blank is each sheet?
const blank = (img) => (img.indices.reduce((a,v)=>a+(v?0:1),0)/img.indices.length*100).toFixed(1);
console.log(`  PBITS${key} blank=${blank(bits)}%   PLEVEL${key} blank=${blank(level)}%`);

const W = MAP_COLS*TILE_W, H = MAP_ROWS*TILE_H;
const idx = new Uint8Array(W*H);
for (let row=0; row<MAP_ROWS; row++) for (let col=0; col<MAP_COLS; col++) {
  const n = map.planeA[row*MAP_COLS+col]; if (!n) continue;
  const t = tiles[n]; if (!t) continue;
  const ox=col*TILE_W, oy=row*TILE_H;
  for (let y=0;y<TILE_H;y++){ const d=(oy+y)*W+ox, s=y*TILE_W;
    for (let x=0;x<TILE_W;x++){ const v=t[s+x]; if(v) idx[d+x]=v; } }
}
const px = Buffer.alloc(W*H*3);
for (let i=0;i<idx.length;i++){ const c=idx[i]*4; px[i*3]=pal[c]; px[i*3+1]=pal[c+1]; px[i*3+2]=pal[c+2]; }
writeFileSync(`/tmp/two_${key}.ppm`, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), px]));
