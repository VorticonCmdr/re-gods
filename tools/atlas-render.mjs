import { readFileSync, writeFileSync } from 'node:fs';
const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1 } = await import('../src/formats/pi1.js');
const { parseAtlas, cutAll } = await import('../src/formats/atlas.js');
const raw = (n) => new Uint8Array(readFileSync(new URL('../game/' + n, import.meta.url)));
const name = process.argv[2] || 'POBJ1';
const dat = dclDecompress(raw(`${name}.DAT`)).data;
const img = decodePI1(dclDecompress(raw(`${name}.PI1`)).data);
const frames = cutAll(img, parseAtlas(dat));
// lay frames out in a grid with 2px gutters, marking each frame's box
const COLS = 16, GUT = 3;
const cw = Math.max(...frames.map(f=>f.w)) + GUT;
const ch = Math.max(...frames.map(f=>f.h)) + GUT;
const rows = Math.ceil(frames.length / COLS);
const W = COLS*cw, H = rows*ch;
const idx = new Uint8Array(W*H);
frames.forEach((f,i) => {
  const ox = (i%COLS)*cw, oy = ((i/COLS)|0)*ch;
  for (let y=0;y<f.h;y++) for (let x=0;x<f.w;x++) {
    const v=f.pixels[y*f.w+x]; if(v) idx[(oy+y)*W+ox+x]=v;
  }
});
const pal = img.palette;
const px = Buffer.alloc(W*H*3);
for (let i=0;i<idx.length;i++){ const c=idx[i]*4; px[i*3]=pal[c]; px[i*3+1]=pal[c+1]; px[i*3+2]=pal[c+2]; }
writeFileSync(`/tmp/atlas_${name}.ppm`, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), px]));
console.log(`${name}: ${frames.length} frames -> /tmp/atlas_${name}.ppm (${W}x${H})`);
