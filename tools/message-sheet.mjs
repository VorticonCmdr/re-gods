/* message-sheet.mjs — render the status-panel message line for real content,
 * so the hint system can be LOOKED AT rather than only asserted.
 *
 * Every row is one page of one real message, composed by game/message-compose
 * .js from the shipped bytes and laid out by game/message.js's own paginator,
 * blitted onto the shipped PSTATUS panel at the engine's own coordinates. If
 * the glyph mapping, the 10-px advance, the 28-character field, the word-wrap
 * break or the centring arithmetic were wrong, this sheet would show it.
 *
 * Usage:
 *   node tools/message-sheet.mjs                 # text only, all 8 levels
 *   node tools/message-sheet.mjs out.ppm         # + a rendered sheet
 *   node tools/message-sheet.mjs out.ppm 1A      # one level
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '..', 'public', 'game');
const raw = (n) => new Uint8Array(readFileSync(resolve(GAME, n)));

const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1 } = await import('../src/formats/pi1.js');
const { parseAtlas, cutAll } = await import('../src/formats/atlas.js');
const { parseMap } = await import('../src/formats/map.js');
const { decodeStatusPanel, PANEL_W, PANEL_H } = await import('../src/game/status-panel.js');
const { MessageEngine, PRIORITY, Y_LOCAL, ADVANCE, LINE_CHARS,
        PAGE1_TICKS } = await import('../src/game/message.js');
const { composeHint, composeObjectMessage, HINT_TABLET_TYPE } =
  await import('../src/game/message-compose.js');
const { buildObjectArena, appendHints, hintOffsetForX, stringAt } =
  await import('../src/game/text-arena.js');

const out = process.argv[2] || null;
const only = process.argv[3] || null;
const LEVELS = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B']
  .filter((k) => !only || k === only);

/* The font, indexed by raw character byte — see game/message.js's IDENTITY
 * MAPPING note. PSMLFNT is the last group of the level load order, so its
 * frames can be cut standalone here without the cumulative descriptor map. */
const fontAtlas = parseAtlas(dclDecompress(raw('PSMLFNT.DAT')).data);
const fontImg = decodePI1(dclDecompress(raw('PSMLFNT.PI1')).data);
const glyphs = cutAll(fontImg, fontAtlas);
const panel = decodeStatusPanel(dclDecompress(raw('PSTATUS.PI1')).data);

const asText = (b) => [...b].filter((c) => c !== 0)
  .map((c) => (c === 0x11 ? '◆' : c === 0x26 ? '→' : String.fromCharCode(c))).join('');

/** Every page the engine shows for one composed message, in order. */
function pagesOf(bytes, priority) {
  const eng = new MessageEngine();
  eng.post(bytes, priority);
  const pages = [];
  for (;;) {
    const p = eng.page();
    if (!p) break;
    pages.push({ chars: Uint8Array.from(p.chars), x: p.x });
    const before = eng.morePages;
    for (let i = 0; i <= PAGE1_TICKS; i++) eng.step();
    if (before < 0) break;                       // that was the last page
  }
  return pages;
}

const rows = [];
let hintCount = 0, wrapCount = 0, overrun = 0;

for (const key of LEVELS) {
  const world = +key[0];
  const pal = dclDecompress(raw(`PALFILS.0${key[1]}${key[0]}`)).data;
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const pool = buildObjectArena(dclDecompress(raw(`POBJECTS.00${world}`)).data);
  const h = appendHints(pool.arena, pal);
  pool.arena = h.arena;

  console.log(`\n=== ${key} ===`);
  for (const o of map.objects) {
    if (o.type !== HINT_TABLET_TYPE || o.dead) continue;
    const off = hintOffsetForX(h.keys, h.offs, o.x);
    const hint = off >= 0 ? stringAt(pool.arena, off) : null;
    const msg = composeHint(hint);
    const pages = pagesOf(msg, PRIORITY.hint);
    hintCount++;
    if (pages.length > 1) wrapCount++;
    const tag = off < 0 ? '  (NO KEY -> "Hint Error")' : '';
    console.log(`  tablet x=${String(o.x).padStart(4)}${tag}`);
    pages.forEach((p, i) => {
      const wide = p.x + p.chars.length * ADVANCE;
      if (p.chars.length > LINE_CHARS || wide > 320) overrun++;
      console.log(`    p${i + 1} x=${String(p.x).padStart(3)} n=${String(p.chars.length).padStart(2)} "${asText(p.chars)}"`);
      rows.push({ label: `${key} x${o.x} p${i + 1}`, ...p });
    });
  }
}

console.log(`\n${hintCount} tablets, ${wrapCount} of them wrap to two pages, ` +
            `${overrun} pages overrun the 28-char field`);

if (!out) process.exit(overrun ? 1 : 0);

/* ── render ───────────────────────────────────────────────────────────── */
const STRIP = 12;                                  // the message strip's rows
const W = PANEL_W, H = rows.length * STRIP;
const buf = new Uint8Array(W * H);
rows.forEach((r, n) => {
  const y0 = n * STRIP;
  /* the panel's own trough behind the text, so contrast is the real one */
  for (let y = 0; y < STRIP; y++) {
    const src = (Y_LOCAL + y) * PANEL_W;
    if (Y_LOCAL + y >= PANEL_H) break;
    buf.set(panel.indices.subarray(src, src + PANEL_W), (y0 + y) * W);
  }
  let x = r.x;
  for (const c of r.chars) {
    const f = glyphs[c];
    if (f) for (let y = 0; y < f.h; y++) {
      if (y0 + y >= H) break;
      for (let xx = 0; xx < f.w; xx++) {
        const px = x + xx;
        if (px < 0 || px >= W) continue;
        const v = f.pixels[y * f.w + xx];
        if (v) buf[(y0 + y) * W + px] = v;
      }
    }
    x += ADVANCE;
  }
});
const pi = decodePI1(dclDecompress(raw('PLEVEL1A.PI1')).data).palette;
const ppm = Buffer.alloc(W * H * 3);
for (let i = 0; i < buf.length; i++) {
  const c = buf[i] * 4;
  ppm[i * 3] = pi[c]; ppm[i * 3 + 1] = pi[c + 1]; ppm[i * 3 + 2] = pi[c + 2];
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), ppm]));
console.log(`wrote ${out} (${W}x${H}, ${rows.length} pages)`);
process.exit(overrun ? 1 : 0);
