import { readFileSync, writeFileSync } from 'node:fs';
const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1, sliceTiles, TILE_W, TILE_H } = await import('../src/formats/pi1.js');
const { parseMap, MAP_COLS, TILE_COUNTS } = await import('../src/formats/map.js');
const raw = (n) => new Uint8Array(readFileSync(new URL('../public/game/' + n, import.meta.url)));
const key = process.argv[2] || '1A';
const count = TILE_COUNTS[key];
const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
let tiles = sliceTiles(decodePI1(dclDecompress(raw(`PBITS${key}.PI1`)).data)).slice(0, Math.min(count,120));
if (count > 120) tiles = tiles.concat(sliceTiles(decodePI1(dclDecompress(raw(`PXTRA${key}.PI1`)).data)).slice(0, count-120));
const pal = decodePI1(dclDecompress(raw(`PLEVEL${key}.PI1`)).data).palette;

// render a window with a given bias, side by side
const C0=10, R0=20, CW=22, RH=14;               // window in cells
const W = CW*TILE_W, H = RH*TILE_H;
function render(bias) {
  const idx = new Uint8Array(W*H);
  for (let r=0;r<RH;r++) for (let c=0;c<CW;c++) {
    const B = map.planeA[(R0+r)*MAP_COLS + (C0+c)];
    const t = tiles[B-bias];
    if (!t) continue;
    for (let y=0;y<TILE_H;y++){ const d=(r*TILE_H+y)*W + c*TILE_W, s=y*TILE_W;
      for (let x=0;x<TILE_W;x++){ const v=t[s+x]; if(v) idx[d+x]=v; } }
  }
  return idx;
}
const a = render(1), b = render(0);
const OUT_W = W, OUT_H = H*2 + 4;
const px = Buffer.alloc(OUT_W*OUT_H*3);
const put=(idx,yoff)=>{ for(let i=0;i<idx.length;i++){ const c=idx[i]*4, o=((yoff+((i/W)|0))*OUT_W + (i%W))*3;
  px[o]=pal[c]; px[o+1]=pal[c+1]; px[o+2]=pal[c+2]; } };
put(a,0); put(b,H+4);
writeFileSync('/tmp/bias.ppm', Buffer.concat([Buffer.from(`P6\n${OUT_W} ${OUT_H}\n255\n`), px]));
let diff=0; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) diff++;
console.log(`${key}: top = 1-based (tile=B-1), bottom = 0-based (tile=B)`);
console.log(`differing pixels between the two: ${diff}/${a.length} (${(100*diff/a.length).toFixed(1)}%)`);
