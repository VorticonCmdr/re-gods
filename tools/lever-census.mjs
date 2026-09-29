/* lever-census.mjs — every lever-table entry of every level, what reads it,
 * and how those readers are reached.
 *
 * A lever toggle (CS:0x1045, game/levers.js) only flips bit 0 of the PALFILS
 * lever record (DS:0xa5f8 + i*6 + 4). Nothing happens until a trigger whose
 * COND11/COND12 reads that bit is EVALUATED, and a trigger is evaluated only
 * when an event record {selector 3, param = trigger} is dispatched: by the
 * hero's plane-B probe (CS:0x5FAB) or by an ACT5 action elsewhere
 * (CS:0x3D0A). So for each lever this prints:
 *   - whether a category-3 map object sits at the lever record's (x, y)
 *     (the toggle's own lookup, CS:0x115B, is an exact match);
 *   - every trigger that reads it, its other conditions and its action;
 *   - the plane-B cells / ACT5 records that dispatch that trigger.
 *
 * Usage: node tools/lever-census.mjs [levelKey ...]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '..', 'game');
const raw = (n) => new Uint8Array(readFileSync(join(GAME, n)));

const { dclDecompress } = await import('../src/formats/dcl.js');
const { parseMap, MAP_COLS, MAP_ROWS } = await import('../src/formats/map.js');
const { parsePalfils, palfilsNameFor } = await import('../src/game/events.js');
const { parseAllTriggers, isLive, verbOf, consumesInventory } = await import('../src/game/trigger.js');
const { parseObjectCategories } = await import('../src/game/objects.js');
const { ACTION_NAMES } = await import('../src/game/trigger-actions.js');

const COND = ['-', 'has item', 'lacks item', 'weapon slot', 'no weapon slot', 'event <0', 'event >=0',
  'health >', 'health <', 'timer >', 'timer <', 'lever ON', 'lever OFF', 'score >', 'score <', 'lives >', 'lives <'];
const SEL_TRIGGER = 3, ACT5 = 5;

const keys = process.argv.length > 2 ? process.argv.slice(2) : ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'];
const totals = { levers: 0, unmatched: 0, noReader: 0, unreachable: 0 };
for (const key of keys) {
  const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
  const pal = parsePalfils(dclDecompress(raw(palfilsNameFor(key))).data);
  const cats = parseObjectCategories(dclDecompress(raw(`POBJECTS.00${key[0]}`)).data);
  const trig = parseAllTriggers(map.bulk);

  /* trigger index -> dispatch sources */
  const sources = new Map();
  const add = (t, s) => { if (!sources.has(t)) sources.set(t, []); sources.get(t).push(s); };
  const eventsFor = new Map();   // event id -> trigger
  pal.events.forEach((ev, id) => { if (ev.selector === SEL_TRIGGER) eventsFor.set(id, ev.param); });
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const v = map.planeB[r * MAP_COLS + c];
      if (v >= 3 && eventsFor.has(v - 3)) add(eventsFor.get(v - 3), `cell(${c * 32},${r * 16})`);
    }
  }
  trig.forEach((t, i) => {
    if (isLive(t) && verbOf(t) === ACT5 && eventsFor.has(t.actionArg - 1)) add(eventsFor.get(t.actionArg - 1), `ACT5 of #${i}`);
  });

  console.log(`\n== PLEV${key}`);
  pal.levers.forEach((l, li) => {
    if (l.x === 0xffff || (l.x === 0 && l.y === 0)) return;   // unused slot
    totals.levers++;
    const obj = map.objects.find((o) => o.x === l.x && o.y === l.y && o.type !== 0xffff);
    const objTxt = obj ? `obj type ${obj.type} cat ${cats[obj.type]}` : 'NO MAP OBJECT';
    if (!obj || cats[obj.type] !== 3) totals.unmatched++;
    const readers = [];
    trig.forEach((t, ti) => {
      if (!isLive(t)) return;
      const j = t.condKind.findIndex((k, n) => (k === 11 || k === 12) && t.condArg[n] === li);
      if (j < 0) return;
      const conds = t.condKind.map((k, n) => k ? `${COND[k] ?? k}(${t.condArg[n]})` : null).filter(Boolean).join(' & ');
      const act = `${ACTION_NAMES[verbOf(t)] ?? verbOf(t)}(${t.actionArg}) @${t.x},${t.y}${consumesInventory(t) ? ' +consume' : ''}`;
      const src = sources.get(ti) || [];
      readers.push({ ti, conds, act, src });
    });
    if (!readers.length) totals.noReader++;
    else if (readers.every((r) => !r.src.length)) totals.unreachable++;
    console.log(`lever ${String(li).padStart(2)} (${l.x},${l.y}) type ${l.type} -> ${objTxt}` +
      (readers.length ? '' : '   [no trigger reads it]'));
    for (const r of readers) {
      console.log(`   #${r.ti}: ${r.conds}  =>  ${r.act}   via ${r.src.length ? r.src.slice(0, 4).join(', ') + (r.src.length > 4 ? ` +${r.src.length - 4}` : '') : 'NOTHING (unreachable)'}`);
    }
  });
}
console.log(`\n${totals.levers} lever records; ${totals.unmatched} without a category-3 object at their (x,y); ` +
  `${totals.noReader} read by no trigger; ${totals.unreachable} read only by unreachable triggers`);
