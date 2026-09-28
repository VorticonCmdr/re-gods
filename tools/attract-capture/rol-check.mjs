/* rol-check.mjs — check rol_trace.py's live ROL.EXE export-3 calls against
 * audio/rol-driver.js: the remap (CS:0x5BB), the variant routines
 * (CS:0x73E) and ROL's own random generator (CS:0x5FF), call by call, from
 * the state [cs:0x632] held when each call began. Also reports whether any
 * GAME random draw came from the driver (under ADL.EXE some do).
 *
 *   node tools/attract-capture/rol-check.mjs joyg1
 */
import { readFileSync } from 'fs';
import { rolRemap, ROL_SFX_RECORDS, RolRandom, rolVariantOffset } from '../../src/audio/rol-driver.js';

const here = new URL('.', import.meta.url).pathname;
const name = process.argv[2] || 'joyg1';
const { log } = JSON.parse(readFileSync(`${here}${name}.rol.json`));
let calls = 0, bad = 0, variants = 0;
const ids = new Set();
for (let i = 0; i < log.length; i++) {
  const e = log[i];
  if (e.ev !== 'play') continue;
  const b = log.slice(i + 1).find((x) => x.ev === 'blob' || x.ev === 'play');
  if (!b || b.ev !== 'blob') continue;                 // refused before the variant (no slot)
  calls++;
  ids.add(e.id & 0xff);
  const base = rolRemap(e.id & 0xff);
  const kind = ROL_SFX_RECORDS[base & 0x7f]?.[1] ?? 0;
  const rng = new RolRandom(e.rol);
  const off = rolVariantOffset(kind, rng);
  if (kind) variants++;
  const want = (base + off) & 0xff;
  const wantState = kind ? rng.state : e.rol;
  if (want !== b.dl || wantState !== b.rol) {
    bad++;
    if (bad <= 8) console.log(`c${e.c} id ${e.id.toString(16)}: port blob ${want.toString(16)} state ${wantState.toString(16)} | dos ${b.dl.toString(16)} ${b.rol.toString(16)}`);
  }
  if (e.r !== b.r) console.log(`c${e.c} id ${e.id.toString(16)}: GAME DS:0x160 moved inside ROL export 3 (${e.r} -> ${b.r})`);
}
const fromDriver = log.filter((e) => e.ev === 'rnd' && e.seg !== undefined && e.ret === '0x2a00');
console.log(`${name}: ${calls} export-3 calls (${variants} with a variant), ${bad} mismatches; ids ${[...ids].map((x) => x.toString(16)).join(',')}; ` +
            `GAME draws from the driver callback: ${fromDriver.length}`);
