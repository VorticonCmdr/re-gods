/* message-compose.js — the two composers that build the bytes `message.js`
 * displays, and the gates that decide whether a pickup gets to speak at all.
 *
 * There are four composers in `GAME.EXE`, all sharing one buffer allocator
 * (`CS:0x4737`, exactly 4 callers) and one submit gate (`CS:0x434e`, exactly 8
 * callers). Two of them are reachable from in-level play and are ported here:
 *
 *   CS:0x4609   the OBJECT message — name, description and value, priority 25
 *   CS:0x6409   the HINT TABLET    — "<> Hint <> " + text,        priority 100
 *
 * The other two belong to the shop screen (`CS:0x474c`, priority 30) and the
 * endgame crawl (`CS:0xcc5c`, priority 255), neither of which this port has.
 *
 * ── THE BUFFER ALLOCATOR, CS:0x4737 ──────────────────────────────────────
 *   Not an initialiser — a two-slot alternator, so composing never overwrites
 *   the string `CS:0x434e`'s prefix-compare is still reading through DS:0x260:
 *
 *     4737  mov di,0xd1b6 / cmp di,[0x260] / jz 0x4747
 *     4740  cmp di,[0x11c] / jz 0x4747
 *     4746  ret                         ; slot A
 *     4747  add di,0x58 / ret           ; slot B, 88 bytes on
 *
 *   This port allocates a fresh array per message, which subsumes the whole
 *   mechanism. ⚠️ The second guard is dead anyway: an operand scan finds
 *   `DS:0x11c` referenced exactly ONCE program-wide — by that `cmp` itself —
 *   so it sits at its zeroed BSS value and never equals 0xd1b6.
 */

import { PRIORITY, DIAMOND, SPACE } from './message.js';
import { NO_TEXT, stringAt, nextStringOffset } from './text-arena.js';

/** `CS:0x46c3` — the literal at DS:0xecf3, read out of the image: "Value". */
export const VALUE_LABEL = 'Value';
/** `CS:0x640d` — DS:0xed0e, nine bytes: `11 20 48 69 6e 74 20 11 00`. */
export const HINT_PREFIX = [DIAMOND, SPACE, 0x48, 0x69, 0x6e, 0x74, SPACE, DIAMOND];
/** `CS:0x6440`/`DS:0xed17` — the string the no-match arm was written to show.
 *  ⚠️ Reached in the original through a stack-underflow bug; see `composeHint`. */
export const HINT_ERROR = 'Hint Error';

/** `CS:0x4609`'s own emitted value field is exactly five zero-padded digits. */
export const VALUE_DIGITS = 5;

/** POBJECTS type 69 / 0x45 — the hint tablet, handler `CS:0x63D5`. */
export const HINT_TABLET_TYPE = 0x45;

/* ── The once-per-type "already seen" bitmap, DS:0x8cea ─────────────────── */

/** 16 bytes = 128 bits — `CS:0x8ee9 mov cx,0x10` + `rep stosb`. */
export const SEEN_BYTES = 0x10;

/**
 * `CS:0x462e-0x464c` (test-and-set) and `CS:0x471b-0x4731` (undo).
 * An object message is shown at most once per type per level.
 */
export class SeenBitmap {
  constructor() { this.bits = new Uint8Array(SEEN_BYTES); }
  /** Clear on a full level entry — NOT on the light re-entry path. */
  reset() { this.bits.fill(0); }
  /** @returns {boolean} true if this type had NOT been seen (i.e. show it). */
  testAndSet(type) {
    const i = type >> 3, m = 1 << (type & 7);        // CS:0x4630-0x4643
    const wasClear = (this.bits[i] & m) === 0;       // CS:0x4645 `test`
    this.bits[i] |= m;                               // CS:0x4648 `or`
    return wasClear;                                 // CS:0x464c `jz`
  }
  /** `CS:0x472d-0x4731` `mov ch,0xfe / rol ch,cl / and [si],ch`. */
  clear(type) { this.bits[type >> 3] &= ~(1 << (type & 7)) & 0xff; }
}

/**
 * `CS:0x4613-0x462b` — may this object type produce a message at all?
 *
 * ⚠️ THE WORLD GATE IS NOT "WORLD 1 ONLY", and reading it that way ships the
 * wrong behaviour in three of the four worlds. `DS:0x3ab` is the SHOP-ACTIVE
 * flag (its live setter, `CS:0x6c58`, sits three instructions before the shop
 * main loop), and the shop is entered only when the world is NOT 1. So the two
 * halves partition: world 1 shows object messages in-level, worlds 2-4 show
 * them on the shop screen between levels. Both halves are load-bearing.
 *
 * Two bypasses jump PAST the gate and past the seen-bitmap both:
 *   - category 2 (keys), `CS:0x4613` — only reachable via the shop wrapper,
 *     because `CS:0x17EA` rejects category > 1 before the composer is called;
 *   - type 0x53 (the shop potion), `CS:0x4618` — reachable from the ordinary
 *     in-level pickup path in ANY world, and it re-shows every time.
 */
export function messageGate({ type, category, world, shopActive, seen }) {
  if (category === 2) return true;                   // CS:0x4613 `jz 0x4651`
  if (type === 0x53) return true;                    // CS:0x4618 `jz 0x4651`
  if (!shopActive && world !== 1) return false;      // CS:0x461d-0x462b
  return seen ? seen.testAndSet(type) : true;        // CS:0x462e-0x464c
}

/**
 * `CS:0x4609` — compose an object's name / description / value message.
 * Returns null when the type has no text (`descriptor[+8] == 0xFFFF`, tested
 * at `CS:0x4679` as a signed `jge` against the arena base).
 *
 * The emitted shape, byte for byte:
 *     11 20  <name>  20 11 20  <desc>  [20 11 20]  ["Value" 20 <5 digits> 20 11]  20 00
 * where the `20 11 20` after the description is emitted only if the
 * description was non-empty (`CS:0x46b0` tests the append helper's own
 * character counter, which `CS:0x46a7` zeroed first), and the whole Value
 * clause only if `descriptor[+6] != 0`.
 *
 * @param {number} type
 * @param {{arena: Uint8Array, textOff: Uint16Array, value: Uint16Array}} pool
 * @returns {Uint8Array|null} NUL-terminated message bytes
 */
export function composeObjectMessage(type, pool) {
  if (type < 0) return null;                         // CS:0x465b-0x465f `jns`
  const off = pool.textOff[type];
  if (off === NO_TEXT || off === undefined) return null;      // CS:0x4679
  const b = [];
  b.push(DIAMOND, SPACE);                            // CS:0x466d/0x4670
  pushZ(b, stringAt(pool.arena, off));               // CS:0x4684 -> CS:0x481d
  b.push(SPACE, DIAMOND, SPACE);                     // CS:0x4689-0x4691
  const descOff = nextStringOffset(pool.arena, off); // CS:0x4692-0x46a5
  const desc = stringAt(pool.arena, descOff);
  const n = pushZ(b, desc);                          // CS:0x46a7-0x46ae, dl
  if (n !== 0) b.push(SPACE, DIAMOND, SPACE);        // CS:0x46b0-0x46bc
  const value = pool.value[type];
  if (value !== 0) {                                 // CS:0x46bd `jz 0x4707`
    pushAscii(b, VALUE_LABEL);                       // CS:0x46c3-0x46cb
    b.push(SPACE);                                   // CS:0x46cd
    /* CS:0x46d0-0x4700: five zero-padded decimal digits, most significant
     * first, built by five `cwd/idiv 10` steps with the remainders stacked. */
    let v = value;
    const digits = [];
    for (let i = 0; i < VALUE_DIGITS; i++) { digits.push(v % 10); v = (v / 10) | 0; }
    for (let i = VALUE_DIGITS - 1; i >= 0; i--) b.push(0x30 + digits[i]);
    b.push(SPACE, DIAMOND);                          // CS:0x4701/0x4704
  }
  b.push(SPACE, 0);                                  // CS:0x4707/0x470a
  return Uint8Array.from(b);
}

/**
 * `CS:0x6409` — compose the hint-tablet message.
 *
 * ⚠️ THIS BYPASSES THE OBJECT COMPOSER ENTIRELY. The handler `CS:0x63d5`
 * builds its own buffer and calls the submit gate directly at `CS:0x6467`,
 * then returns `DX = 0` (`CS:0x646c sub dx,dx`), which makes the pickup
 * dispatcher's tier decode at `CS:0x182D` skip `CS:0x4609` altogether — so the
 * player never sees the tablet's own "tablet / reveals clues" text.
 *
 * It also touches NEITHER the once-per-type bitmap NOR the world gate, which
 * is what lets all 46 shipped tablets each show their own distinct line in
 * every world. Both facts were re-checked against the handler body this pass:
 * it references only DS:0x208, DS:0xa, the key/offset tables, DS:0x27c,
 * DS:0xed0e, DS:0x1fc6, DS:0xe94a, DS:0x368 and DS:0x212.
 *
 * @param {Uint8Array|null} hint  the arena text, or null on no key match
 */
export function composeHint(hint) {
  const b = [];
  b.push(...HINT_PREFIX);                            // CS:0x640d-0x6415
  b.push(SPACE);                                     // CS:0x6416/0x6418
  if (hint) pushZ(b, hint);                          // CS:0x644e-0x6453
  else pushAscii(b, HINT_ERROR);                     // CS:0x6440-0x644c
  b.push(SPACE, DIAMOND, 0);                         // CS:0x6456-0x645e
  return Uint8Array.from(b);
}

/** The hint's own submit priority — the highest in ordinary play. */
export const HINT_PRIORITY = PRIORITY.hint;
/** The object message's. */
export const OBJECT_PRIORITY = PRIORITY.object;

/* ── helpers ──────────────────────────────────────────────────────────── */

/** `CS:0x481d` — copy to the destination up to (but not storing) the NUL,
 *  returning the number of characters appended. */
function pushZ(b, src) {
  if (!src) return 0;
  let n = 0;
  for (const c of src) { if (c === 0) break; b.push(c); n++; }
  return n;
}

function pushAscii(b, s) { for (let i = 0; i < s.length; i++) b.push(s.charCodeAt(i)); }
