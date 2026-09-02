import { readFileSync } from 'node:fs';
const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1 } = await import('../src/formats/pi1.js');
const { parseAtlas, cutAll, atlasStats } = await import('../src/formats/atlas.js');
const raw = (n) => new Uint8Array(readFileSync(new URL('../public/game/' + n, import.meta.url)));

const PAIRS = ['PALWAYS1','POBJ1','PGODFONT','PSMLFNT'];
console.log('atlas          count  bytes  2+10*n  maxRight  maxBottom  OOB  word2!=0');
let bad = 0;
for (const p of PAIRS) {
  const dat = dclDecompress(raw(`${p}.DAT`)).data;
  const img = decodePI1(dclDecompress(raw(`${p}.PI1`)).data);
  const a = parseAtlas(dat);
  const s = atlasStats(a);
  const frames = cutAll(img, a);
  const nonEmpty = frames.filter(f => f.pixels.some(v => v !== 0)).length;
  console.log(`${p.padEnd(14)} ${String(a.count).padStart(5)}  ${String(dat.length).padStart(5)}  ${String(2+10*a.count).padStart(6)}  ${String(s.maxRight).padStart(8)}  ${String(s.maxBottom).padStart(9)}  ${String(s.outOfBounds).padStart(3)}  ${String(s.word2NonZero).padStart(8)}   nonEmptyFrames=${nonEmpty}/${a.count}`);
  if (s.outOfBounds) bad++;
  if (s.word2NonZero) bad++;
}
console.log(bad ? `\nFAILURES: ${bad}` : '\nall atlases parse cleanly, all frames in bounds, word2 always 0');
