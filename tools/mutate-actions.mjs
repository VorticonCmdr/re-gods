/* mutate-actions.mjs — mutation-test the trigger ACTION verb suite.
 *
 * `node tools/mutate-actions.mjs`
 *
 * A green suite is not evidence unless it can go red. This injects plausible
 * mis-ports of the 15 verbs one at a time, runs the whole verification suite
 * against each, and reports which are caught. Every mutant here is a mistake a
 * careful reader of the disassembly could actually make.
 *
 * Expected result: 14 of 15 killed. The survivor — re-keying the ACT5 consume
 * on the trigger index instead of the event-record id — is EQUIVALENT on
 * shipped data: 0 of 727 selector-3 triggers is named by more than one event
 * record, which the suite itself asserts. Two earlier survivors were also
 * equivalent (the annihilated `+12`, and the y*8 vs (y>>4)*128 forms, which
 * agree on every tile-aligned coordinate — and all 279 shipped door/gate/zone
 * records are tile-aligned); both were replaced with non-equivalent mutants
 * once the suite gained checks that leave the tile grid.
 *
 * The script restores both source files on exit, including after a failure.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
const F = 'src/game/trigger-actions.js', E = 'src/game/events.js';
const orig = { [F]: readFileSync(F,'utf8'), [E]: readFileSync(E,'utf8') };

const MUTANTS = [
  ['ACT3/ACT4 zone kinds swapped',            F, 'export const ZONE_TELEPORT = 1;', 'export const ZONE_TELEPORT = 3;'],
  ['door cell shifted one whole tile',        F, "const doorCell = (t) => cellOf((t.x & 0xffe0), ((t.y + 8) & 0xfff0));",
                                                 "const doorCell = (t) => cellOf(((t.x & 0xffe0) + 32), ((t.y + 8) & 0xfff0));"],
  ['ACT9 y-bias dropped (the +8 before the mask)', F, "const doorCell = (t) => cellOf((t.x & 0xffe0), ((t.y + 8) & 0xfff0));",
                                                 "const doorCell = (t) => cellOf((t.x & 0xffe0), (t.y & 0xfff0));"],
  ['ACT7/ACT8 cell uses (y>>4)*128 instead of y<<3', F, "const cellOf = (x, y) => (x >> 5) + (y << 3);",
                                                 "const cellOf = (x, y) => (x >> 5) + ((y >> 4) * 128);"],
  ['ACT2 clears all 6 plane-B cells',         F, 'for (const o of [0, 0x80, 0x100]) {\n    if (c + o >= 0 && c + o < PLANE_A_CELLS) ctx.planeB[c + o] = 0;',
                                                 'for (const o of [0, 1, 0x80, 0x81, 0x100, 0x101]) {\n    if (c + o >= 0 && c + o < PLANE_A_CELLS) ctx.planeB[c + o] = 0;'],
  ['door row stride +1 instead of +10',       F, 'put(1, al);                       al = (al + 9) & 0xff;',
                                                 'put(1, al);                       al = (al + 0) & 0xff;'],
  ['ACT9 right column increments',            F, 'put(1, r); put(0x81, r); put(0x101, r);',
                                                 'put(1, r); put(0x81, (r+10)&0xff); put(0x101, (r+20)&0xff);'],
  ['ACT8 given a working guard',              F, "  if (g >= 0) {\n    ctx.gates[g].open = 0;\n  } else {",
                                                 "  if (g < 0) return { verb: 8, ok: false, reason: 'no gate' };\n  if (g >= 0) {\n    ctx.gates[g].open = 0;\n  } else {"],
  ['ACT4 scans 20 slots like ACT3',           F, 'export const EXIT_SCAN_SLOTS = 10;', 'export const EXIT_SCAN_SLOTS = 20;'],
  ['duplicate-zone guard removed',            F, 'if (zoneExists(ctx.zones, x, y)) {', 'if (false && zoneExists(ctx.zones, x, y)) {'],
  ['ACT6 bound raised to 3',                  F, 'export const KILL_MAX        = 2;', 'export const KILL_MAX        = 3;'],
  ['ACT1 drops the +0xC0 bias',               F, 'const type = (t.actionArg + 0xc0) & 0xffff;', 'const type = t.actionArg & 0xffff;'],
  ['ACT0 loses the 0x40..0x44 quiet case',    F, 'if (type >= 0x40 && type <= 0x44) return { verb: 0, ok: true, type, quiet: true };', ''],
  ['key-consume window widened',              F, 'const isKey = (a >= 0x12 && a <= 0x17) || (a >= 0x7f && a <= 0x81);',
                                                 'const isKey = a >= 0x12;'],
  ['ACT5 consume keyed on trigger index',     E, 'if (this.consumedEvents.has(id)) return null;',
                                                 'if (this.consumed.has(ev.param)) return null;'],
];
let killed = 0;
for (const [name, file, from, to] of MUTANTS) {
  const s = orig[file];
  if (!s.includes(from)) { console.log(`  ??  ${name} — PATTERN NOT FOUND`); continue; }
  writeFileSync(file, s.replace(from, to));
  let out = '';
  try { out = execSync('node tools/verify-node.mjs 2>&1', {encoding:'utf8'}); }
  catch (e) { out = (e.stdout||'') + (e.stderr||''); }
  writeFileSync(file, s);
  const dead = !out.includes('ALL CHECKS PASS');
  if (dead) killed++;
  const fails = (out.match(/^  FAIL/gm)||[]).length;
  console.log(`  ${dead ? 'KILLED  ' : 'SURVIVED'}  ${name}${dead ? ` (${fails} assertion${fails===1?'':'s'} failed)` : ''}`);
}
for (const f of Object.keys(orig)) writeFileSync(f, orig[f]);
console.log(`\n${killed}/${MUTANTS.length} mutants killed`);
