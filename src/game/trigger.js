/* trigger.js — `.MAP` section-4 trigger engine.
 *
 * Transliterated from this project's `gods_trigger.c`, which is itself a port
 * of GAME.EXE 1000:39ae plus the 17 predicates dispatched through SS:0x35b0.
 * The C version passes its invariant suite and kills 9/9 injected mutants;
 * this file deliberately mirrors it line-for-line so the two can be compared.
 *
 * FOUR TRAPS this encodes (each silently breaks level logic):
 *  1. Every predicate pair is STRICT — equality FAILS BOTH members. The
 *     original uses jnl/jng pairs whose taken branch is the FAIL store.
 *     Writing >= anywhere inverts behaviour on boundary values.
 *  2. PASS is "do nothing". Slots start 0xFF and predicates only ever store
 *     0, so clearing is monotone and slot order provably cannot matter.
 *  3. COND 0 is a bare RET — always passes, argument ignored. It is the
 *     unused-slot filler and covers 1207 of the 2268 shipped slots, so a
 *     record whose three slots are all COND0 always fires.
 *  4. The original's FAIL store is a WORD, spilling a zero into the next
 *     slot byte. Because clearing is monotone the spill can never change a
 *     verdict — which is what licenses the byte writes used here.
 *
 * One deliberate divergence: the original dispatcher at 1000:3a58 has NO
 * bounds check on cond_kind and would call through arbitrary memory. We
 * clamp and report instead of reproducing that.
 */

import { TRIG_OFF } from '../formats/map.js';

export const TRIG_COUNT   = 100;
export const TRIG_RECSIZE = 24;

const PASS = 0xFF;
const FAIL = 0x00;

/** Parse one 24-byte big-endian trigger record from a map bulk. */
export function parseTrigger(bulk, index) {
  const dv = new DataView(bulk.buffer, bulk.byteOffset, bulk.byteLength);
  const o = TRIG_OFF + index * TRIG_RECSIZE;
  const u = (k) => dv.getUint16(o + k, false);
  return {
    index,
    condKind: [u(0), u(4), u(8)],
    condArg:  [u(2), u(6), u(10)],
    x: u(12), y: u(14),
    action: u(16), actionArg: u(18),
    messageId: u(20), reserved: u(22),
  };
}

export function parseAllTriggers(bulk) {
  const out = [];
  for (let i = 0; i < TRIG_COUNT; i++) out.push(parseTrigger(bulk, i));
  return out;
}

/** A record is live if any of its 24 bytes is nonzero. */
export function isLive(t) {
  return !!(t.condKind[0] | t.condKind[1] | t.condKind[2] |
            t.condArg[0]  | t.condArg[1]  | t.condArg[2]  |
            t.x | t.y | t.action | t.actionArg | t.messageId | t.reserved);
}

/** Action index actually dispatched (bit15 masked off). */
export const verbOf = (t) => t.action & 0x7FFF;
/** bit15 selects the inventory-consume pass (call 0x3a69). */
export const consumesInventory = (t) => (t.action & 0x8000) !== 0;
/** The key-consume pass (call 0x3aeb) fires only for verbs 2,3,4,7,8. */
export const consumesKey = (verb) =>
  verb === 2 || verb === 3 || verb === 4 || verb === 7 || verb === 8;

const invHas   = (gs, a) => gs.inventory.some((v) => v === a);
const slot3Has = (gs, a) => gs.slots3.some((v) => v === a);

/**
 * Evaluate one condition slot.
 * @returns {number} 0xFF = PASS, 0x00 = FAIL — the byte the original leaves.
 */
export function evalCondition(kind, arg, gs) {
  switch (kind) {
    case 0:  return PASS;                                   // bare RET

    case 1:  return invHas(gs, arg)   ? PASS : FAIL;        // item IS held
    case 2:  return invHas(gs, arg)   ? FAIL : PASS;        // item NOT held

    case 3:  return slot3Has(gs, arg) ? PASS : FAIL;
    case 4:  return slot3Has(gs, arg) ? FAIL : PASS;

    case 5:
    case 6: {                                               // event word sign
      const i = arg ? arg - 1 : 0;
      const v = (gs.events && i < gs.events.length) ? gs.events[i] : 0;
      return kind === 5 ? (v < 0 ? PASS : FAIL)
                        : (v >= 0 ? PASS : FAIL);
    }

    /* DS:0x192 — hero HEALTH, capped at 0x18 = 24. Signed compare, strict
     * both ways.
     *   Established via the bar-chase routine CS:0x0dff, called once per frame
     *   from the main loop at CS:0x02c6: it moves DS:0x19a (the DISPLAYED bar)
     *   one unit per frame toward DS:0x192 (the target), clamping at 0x18, and
     *   fires the hurt sound once per descent via the latch DS:0x3ad.
     *   Level start sets target = 0x18 (CS:0x84B) and display = 1 (CS:0x851),
     *   so the bar visibly fills. Damage subtracts from the TARGET
     *   (CS:0xACD3 combat, CS:0x4C4A/0x4CC1/0x4D4F fall); the five potions add
     *   {2,3,4,0xc,0x18} and clamp; the DEATH test reads the BAR
     *   (CS:0x1BD `cmp word [0x19a],0`), not the target.
     *   An earlier revision of the project notes called this "ammo". It is not.
     *   These predicates read the TARGET, which is what the shipped
     *   "help bonus" triggers gate on — i.e. they help a hurt player. */
    case 7:  return (gs.health >  arg) ? PASS : FAIL;
    case 8:  return (gs.health <  arg) ? PASS : FAIL;

    case 9:
    case 10: {                                              // 32-bit level timer
      const t17 = Math.floor(gs.timer / 17);                // unsigned
      const thr = arg * 5;
      return kind === 9 ? (t17 >  thr ? PASS : FAIL)
                        : (t17 <  thr ? PASS : FAIL);
    }

    case 11:
    case 12: {                                              // lever bit0 of +4
      let bit = 0;
      if (gs.levers && arg * 6 + 4 < gs.levers.length) {
        bit = gs.levers[arg * 6 + 4] & 1;
      }
      return kind === 11 ? (bit ? PASS : FAIL)
                         : (bit ? FAIL : PASS);
    }

    case 13: return (arg * 5000 <  gs.score) ? PASS : FAIL;
    case 14: return (arg * 5000 >  gs.score) ? PASS : FAIL;

    case 15: return (gs.lives >  arg) ? PASS : FAIL;
    case 16: return (gs.lives <  arg) ? PASS : FAIL;

    default:
      /* Out of the 17-entry table. The original would call through garbage. */
      if (typeof gs.onOutOfRange === 'function') gs.onOutOfRange(kind);
      return PASS;
  }
}

/** Evaluate a whole record. AND the three slots, then test the SIGN bit. */
export function evalTrigger(t, gs) {
  const a = evalCondition(t.condKind[0], t.condArg[0], gs);
  const b = evalCondition(t.condKind[1], t.condArg[1], gs);
  const c = evalCondition(t.condKind[2], t.condArg[2], gs);
  return ((a & b & c) & 0x80) !== 0;
}

/** A neutral game state — every predicate passes except where noted. */
export function emptyState() {
  return {
    inventory: [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF],
    slots3: [0xFFFF, 0xFFFF, 0xFFFF],
    events: null, health: 0, timer: 0,
    levers: null, score: 0, lives: 0,
  };
}
