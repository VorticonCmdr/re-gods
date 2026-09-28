/* walker-compare.js — the port against walker_live.py's staged shopkeeper
 * (walker_live.json): the same poke of the shop potion's countdown at the
 * same PJOYL1 cursor, the same move of the walker next to the hero, then
 * every tick's hero, walker record and sound plays compared until the
 * contact opens the shop.
 *
 * A DOS row is read at the poller stop with the tape cursor at `c`, which
 * is the port's state after its tick `c` (the hero matches there); the poke
 * made at that stop therefore lands before the port's tick `c + 1`, and the
 * sounds the row collects until the next stop are those of tick `c + 1`.
 *
 * Browser-only (dev server, ?debug):
 *   const m = await import('/tools/attract-capture/walker-compare.js');
 *   await m.compareWalker()
 */
import { loadCapture } from './diff.js';

export async function compareWalker({ show = 12, file = 'walker_live.json' } = {}) {
  const g = window.__gods;
  const live = await (await fetch(`/tools/attract-capture/${file}?${Date.now()}`)).json();
  const rows = live.rows.filter((r) => r.c !== undefined);
  const byC = new Map(rows.map((r) => [r.c, r]));
  const shopAt = (live.rows.find((r) => r.shop !== undefined) || {}).shop;
  const moveAt = (rows.find((r) => r.moved) || {}).c;
  const dos = await loadCapture('joyl1');
  g.resetProcessJaw(); g.setLandFlag357(1); g.setStarburstGravityPhase(0);
  await g.startAttractAt(0); g.snap();
  const pend = dos.rnd.filter((e) => e.cursor <= 12).slice(-1);
  const inject = (c) => { while (pend.length && pend[0].cursor <= c) { const e = pend.shift(); g.setRandom(e.hex, e.r); } };
  inject(0);
  const diffs = [];
  let c = 0, shop = null, compared = 0;
  const k = g.shopkeeper();
  for (let i = 0; i < 4000; i++) {
    const [s] = await g.stepTicks(1);
    if (!s.attract || s.attract.state !== 0) break;
    c = s.attract.cursor;
    if (g.uiState() === 'shop') { shop = c; break; }
    inject(c);
    /* The pokes, as walker_live.py makes them: at this stop, before the row. */
    if (c === live.at) g.summonShop();
    if (c === moveAt) {
      const h = g.heroRaw(), m = byC.get(moveAt).moved;
      k.x = live.movex ?? h.x + live.gap; k.y = h.y; k.dx = live.movedx ?? -1;
      if (m[0] !== k.x || m[1] !== k.y) diffs.push(`${c}: move target dos ${m} port ${k.x},${k.y}`);
    }
    const d = byC.get(c);
    if (!d || c < live.at) continue;
    compared++;
    const h = g.heroRaw();
    const port = { hx: h.x, hy: h.y, st: h.st, ph: h.ph, cd: k.countdown, on: k.active, n35d: k.visits,
                   wx: k.active || k.countdown < 0 ? k.x : d.wx, wy: k.active || k.countdown < 0 ? k.y : d.wy,
                   wdx: k.active || k.countdown < 0 ? k.dx : d.wdx, wph: k.active || k.countdown < 0 ? k.phase : d.wph };
    const bad = Object.keys(port).filter((f) => port[f] !== (typeof d[f] === 'boolean' ? d[f] : d[f]));
    const dSfx = (byC.get(c - 1) || { sfx: [] }).sfx.map((x) => x.split('@')[0]).sort().join();
    const pSfx = (s.sfx || '').split(',').filter((x) => x && !x.startsWith('s')).map((x) => x.split('@')[0]).sort().join();
    if (dSfx !== pSfx) bad.push(`sfx dos[${dSfx}] port[${pSfx}]`);
    if (bad.length) diffs.push(`${c}: ${bad.map((f) => f.startsWith('sfx') ? f : `${f} dos ${d[f]} port ${port[f]}`).join('; ')}`);
  }
  return { compared, diffs: diffs.length, first: diffs.slice(0, show), shopDos: shopAt, shopPort: shop };
}
