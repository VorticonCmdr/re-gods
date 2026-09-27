/* zones.js — teleport and level-exit zones: the hero-in-box scan, the
 * teleport destination unpack, and the level-exit destination table.
 *
 * trigger-actions.js already ports the WRITE side (ACT3/ACT4 -> DS:0x8f68,
 * `makeZones()`/`makeZone()`). Until now nothing read that array back, which
 * is why the README could say "ACT4 records a level exit that cannot be
 * walked through and ACT3 a teleport that does not teleport." This file is
 * the READ side: CS:0x4A6D (the per-tick hero-vs-zone scan) and CS:0x0FAC-
 * 0x1042 (what firing a zone actually does).
 *
 * ⚠️ WHERE CS:0x4A6D IS CALLED FROM IS NOT ESTABLISHED. It sits inside the
 * player-state-machine's un-Ghidra'd gap, textually beside ladder-dismount
 * code (`DS:0x347/0x348/0x353/0x378` reset, state := 14), and no CALL or
 * jump-table word targeting it was found by either an operand-text search or
 * a raw `6D 4A` byte-pattern search across the whole image — meaning its
 * caller is itself undisassembled bytes in this Ghidra project, not that it
 * has no caller. Two things ARE established: the scan's own body (read
 * directly, below) and that it is reached at least once per relevant tick,
 * because `[0x370]`'s consumer (CS:0x0324) is unconditional in the main
 * loop. This port calls it every tick, matching the cadence of the other
 * universal per-tick probe this project already ported (the plane-B event
 * probe, `CS:0x5FAB`). `UNKNOWN_zone_scan_caller`.
 *
 * THE SCAN — CS:0x4A6D-0x4AC4, read in full, not decompiled.
 *     4A74  cmp word [si+0x4],0x0        ; kind
 *     4A78  js 0x4AC5 / jz 0x4AC5        ; free (kind < 0) or inert (kind==0)
 *     4A7C  ax = zone.x
 *     4A7E  bx = heroX - 0x10
 *     4A85  cmp ax,bx / jl 0x4AC5        ; zone.x <  heroX-16 -> miss
 *     4A89  bx += 0x20
 *     4A8C  cmp ax,bx / jg 0x4AC5        ; zone.x >  heroX+16 -> miss
 *     4A90  ax = zone.y
 *     4A93  bx = heroY - 0x8
 *     4A9C  cmp ax,bx / jl 0x4AC5        ; zone.y <  heroY-8  -> miss
 *     4A9E  bx += 0x10
 *     4AA3  cmp ax,bx / jg 0x4AC5        ; zone.y >  heroY+8  -> miss
 *     4AA5  mov byte [0x370],0x1         ; teleport-pending flag (CS:0x0324's own)
 *     4AAA  al = zone.kind ; [0x3a8] = al
 *     4AB0  cx = zone.arg  ; [0x22e] = cx
 *     4AB7  cmp al,0x1 / jnz -> skip     ; sound only for a TELEPORT kind
 *     4ABF  call 0x22ca with ax=0x193a   ; sfx
 *     4AC5  add si,0x8 / loop            ; next of 20 slots, 8 bytes each
 * A hit returns the FIRST matching slot in index order and stops scanning
 * that tick; a miss falls through to the next of the 20 slots.
 *
 * THE TELEPORT EXECUTION — CS:0x0FDF-0x1042, kind == ZONE_TELEPORT.
 *     0FDF  ax = [0x22e]            ; the packed destination
 *     0FE2  bl = al                 ; ROW  (low byte)
 *     0FE4  al = ah ; ah = 0        ; COL  (high byte), zero-extended
 *     0FEA  ax <<= 5                ; COL * 32
 *     0FEE  bx <<= 4                ; ROW * 16   (no +bias on Y, unlike X)
 *     0FF2  ax += 0x10              ; +16 -> the CENTRE of the destination tile
 *     0FF5  [0x17a] = ax ; [0x17c] = bx     ; hero world position, snapped
 *     0FFC  if [0x168] >= 0 (a familiar is alive): reposition it too, Y-0x28
 *           (this port has no Familiar entity yet — see hero-fire.js's own
 *           note on `UNKNOWN_DS_0168` — so that half is not reproduced here)
 *     100F  CALL FUN_1000_2189 — the level-load/respawn camera-init routine
 *           (Gods/CLAUDE.md's `UNKNOWN_camera_init`, now CLOSED): camera =
 *           clamp(dest - (0x90,0x48)) against the same world-edge bounds the
 *           per-tick pan uses. So a teleport is a hard camera cut too, not a
 *           dead-zone catch-up — see main.js, now ported as cameraForSpawn().
 *     1012  CALL FUN_1000_de6f — `rep stosb` 0x8e8 (2280) bytes at SS:0x3768,
 *           i.e. the System-A entity group-RUNTIME array clear (10 slots x
 *           0xe4), not "the destructible-block restore" as an earlier
 *           revision of this comment guessed (that guess is wrong: de6f
 *           never touches plane A/B or the DS:0xd0c6 damage queue). A
 *           teleport wipes every active System-A creature group's runtime
 *           state — NOT System B's (de6f's own literal base is 0x3768,
 *           System A's array; System B's separate runtime at SS:0x36b4 is
 *           untouched). NOW PORTED: main.js's own teleport branch resets
 *           slotsA/groupsA/enemiesA to fresh/empty, the complete mirror of
 *           zeroing the one array these three port-side structures stand
 *           in for (every enemiesA entity is pushed exactly once alongside
 *           a groupsA record, by runSpawnsA() — there is no other
 *           producer, so clearing all three together is exact, not an
 *           approximation). Checked in checkZones().
 *     1015  CALL FUN_1000_1196, falling into the already-documented CS:0x11D3
 *           object-activation-box recompute (`UNKNOWN_object_flag6 — CLOSED`)
 *           — already faithfully reproduced every tick by this port's own
 *           `activateObjects(level.drawObjects, activationBox(...))` call, so
 *           nothing extra is needed here: the very next tick recomputes it
 *           against the freshly-teleported camera regardless.
 *     1018  [0x36b] = 0             ; animation phase reset
 *     101D  [0x370] = 0             ; pending flag cleared
 *     1022  [0x377] = 4             ; STATE 4 — already documented in this
 *           project as the "spawn / arrival idle pose", and CS:0x1022 is one
 *           of its own three named entrants (level start, respawn, teleport
 *           arrival) — this line is the third one, now traced to its zone
 *     103C/103F  a SIXTH call site for the palette fade-in thunk (CS:0x3596),
 *           previously documented with exactly five sites (all `si=0x86`);
 *           this one runs with `si=0x43e` instead — a DIFFERENT source table,
 *           not traced this pass. `UNKNOWN_ds_43e_palette`
 *
 * THE LEVEL-EXIT TRIGGER — CS:0x0FAC-0x0FDC, kind == ZONE_EXIT.
 *     0FB8  ax = [0x22e] - 2        ; the zone's arg, validated
 *     0FBE  js -> bail              ; arg < 2 does nothing
 *     0FC3  cmp ax,4 / jl continue / else bail   ; arg > 5 does nothing
 *           (so only arg in [2, 5] resolves — 4 destinations)
 *     0FCB  ax <<= 1 ; si = 0xe67c + ax ; ax = word [si]   ; a POINTER, not data
 *     0FD4  [0x178] = ax            ; the resolved destination record
 *     0FD7  [0x36a] = 1             ; "an exit is pending" — the ONLY other
 *           writer of this flag is FUN_1000_8c34 (the level-load/respawn
 *           master routine), which re-derives [0x178] from a WORLD-indexed
 *           table at DS:0xe674 (the four words immediately BEFORE 0xe67c —
 *           same table family, different index) every time a level loads.
 * [0x36a] is read back at CS:0x02F0 (a longer post-frame pause, `call
 * 0x6553`) and CS:0x0D2F (a scripted-camera range test unrelated to which
 * file loads next). NEITHER of those, nor FUN_1000_8c34, was traced far
 * enough this pass to recover the actual WORLD/SUBLEVEL increment rule —
 * i.e. which of the 8 shipped `.MAP` files loads after a given exit zone is
 * `UNKNOWN_level_exit_destination`. What IS established at the byte level:
 * the four destination records themselves, read directly at their pointer
 * targets (`DS:0xe6ea`, `0xe796`, `0xe7fe`, `0xe8a8`), each
 * `{ u16 param, u16 (always 0), u16 param2, ASCIIZ text }`:
 *
 *   arg 2  -> {12,  2500}  "    LEVEL  ONE   "
 *   arg 3  -> {16,  2500}  "    LEVEL  TWO     "
 *   arg 4  -> {100, 2500}  "   LEVEL  THREE   "
 *   arg 5  -> {20, 25000}  "        GAME        "
 *
 * The text is legible and load-bearing evidence; `param`/`param2` are NOT —
 * they are read verbatim (param2 jumping 10x on the arg-5 "GAME" record is
 * suggestive of a score bonus, since world 4's own exit is the only one that
 * would plausibly end the whole game rather than advance a level) but no
 * consumer of either field was located, so neither is asserted as
 * "score bonus" or anything else — see EXIT_DESTINATIONS below.
 *
 * `UNKNOWN_level_exit_destination` IS NOW CLOSED (Gods/CLAUDE.md's own
 * section of that name) and the real mechanism is what this file ports
 * below, replacing the "cycles the 8 shipped .MAP files in a fixed order"
 * placeholder an earlier revision of this file (and of main.js) used. Three
 * findings from that closure explain the shape of the code below:
 *
 *   1. FUN_1000_8c34 (level load) ALSO writes [0x178], from a DIFFERENT,
 *      WORLD-indexed table at DS:0xe674 (word[0xe674 + (world-1)*2]) — NOT
 *      this file's own arg-indexed DS:0xe67c table. DS:0xe674's own last 4
 *      words are byte-identical to DS:0xe67c's 4 pointers, so the two tables
 *      are adjacent, not the same, in memory. This second writer just
 *      re-derives the SAME record on every level (re)load and plays no
 *      further role in the exit mechanism itself. (⚠️ Superseded: it is the
 *      start of the world's selector-6 progress chain — see game/progress.js,
 *      which ports it.)
 *   2. Each record carries a THIRD field, at +0x1e (a u16), read by
 *      CS:0x6553's own score-tally screen as a bit-dispatch selector via
 *      CS:0x694d. A prior pass mis-derived the bit mapping (claimed 11/6/1);
 *      the corrected mapping — re-simulated by hand AND confirmed against a
 *      raw read of the SS:0x35aa dispatch table — is bits 11/10/9/8/1, and
 *      only four of those five ever fire from shipped data: bit 1 (world++,
 *      wrapped 5->1, sublevel FORCED to A — FUN_1000_6b00), bit 8 (clear
 *      every inventory slot whose held item's own category != 0, i.e. every
 *      key, potions untouched — FUN_1000_6ad4), bit 9 (a per-level-runtime-
 *      pool reset, LEVEL THREE ONLY — FUN_1000_6992), bit 10 (generate and
 *      store a password for the just-completed world, only if that slot is
 *      still empty — FUN_1000_69d7). Bit 11 (FUN_1000_4828, sublevel B)
 *      never fires from any of the 4 real destination records — see
 *      `EXIT_DESTINATIONS`' own `bits` field and `EXIT_BIT`/`exitEffects`
 *      below.
 *   3. Records are NOT fixed-size. A raw 204-byte read starting at 0xe6ea
 *      shows LEVEL ONE is 36 bytes (an extra +0x22=0xFFFF trailer word) while
 *      the records after it (a "WORLD ONE" record at EXACTLY 0xe674's own
 *      world-2 pointer, then "WORLD TWO", then two blank-text records) are
 *      34 bytes each — landing EXACTLY on 0xe796 (LEVEL TWO, this file's own
 *      arg-3 pointer) after 3 more 34-byte steps. So 0xe674 and 0xe67c point
 *      into ONE SHARED, non-uniform-stride record stream, not two
 *      independent tables. That non-uniformity REFUTES the obvious reading
 *      of CS:0x6557's own `ADD word[0x178],0x22` as "walk to the next
 *      record" (from a 36-byte LEVEL record, +0x22 lands 2 bytes short of
 *      the true next one) — but nothing ported below relies on that cursor,
 *      so the refutation doesn't touch the world/sublevel-advance answer.
 *      See CLAUDE.md's own `UNKNOWN_level_exit_destination` section for the
 *      full trace. (⚠️ Resolved since: `[0x178]+=0x22` walks each world's
 *      selector-6 progress chain, which starts at DS:0xE674's record, not
 *      at an exit record; the 36-byte LEVEL records are each world's last
 *      link, so the stride mismatch after them is never walked — a world
 *      advance re-seeds the pointer. game/progress.js.)
 *
 * A shipped .MAP census (all 8 files) confirms the mechanism end to end:
 * exactly 3 ACT4 records exist in the whole game, one per world-1/2/3
 * sublevel B (`PLEV1B #11 arg=2`, `PLEV2B #95 arg=3`, `PLEV3B #84 arg=4`);
 * `arg=5` ("GAME") is never placed, so world 4 has no level-exit trigger at
 * all and `EXIT_DESTINATIONS[3]`'s all-zero `bits` never fires anything.
 */

import { ZONE_TELEPORT, ZONE_EXIT } from './trigger-actions.js';
import { INVENTORY_EMPTY } from './treasure.js';

export { ZONE_TELEPORT, ZONE_EXIT };

/**
 * CS:0x4A6D-0x4AC4. Scans `zones` (the same 20-slot array `makeZones()`
 * produces and ACT3/ACT4 populate) against the hero's world position and
 * returns the first occupied slot whose box contains it, or null.
 * @param {{x:number,y:number,kind:number,arg:number}[]} zones
 * @param {number} heroX
 * @param {number} heroY
 * @returns {?{kind:number, arg:number, slot:number}}
 */
export function scanZones(zones, heroX, heroY) {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.kind <= 0) continue;                       // CS:0x4A74 js/jz
    if (z.x < heroX - 0x10 || z.x > heroX + 0x10) continue;   // CS:0x4A7C-0x4A8E
    if (z.y < heroY - 0x8 || z.y > heroY + 0x8) continue; // CS:0x4A90-0x4AA3
    return { kind: z.kind, arg: z.arg, slot: i };
  }
  return null;
}

/**
 * CS:0x0FDF-0x0FF8. Unpacks a teleport zone's (or the teleport STONE's,
 * CS:0x6217 — same field, same unpack) packed destination into a world
 * position.
 * @param {number} arg  packed `(col << 8) | row`
 * @returns {{x:number, y:number}}
 */
export function unpackTeleportDest(arg) {
  const row = arg & 0xff;
  const col = (arg >> 8) & 0xff;
  return { x: (col << 5) + 0x10, y: row << 4 };
}

/* DS:0xe6ea / 0xe796 / 0xe7fe / 0xe8a8 — read directly, not decompiled.
 * Indexed by `arg - 2` for arg in [2, 5]. `bits` is each record's own +0x1e
 * field, read live off the same four addresses; see `EXIT_BIT` below for
 * what each bit does. `param`/`param2` remain unestablished — see the
 * header note above. */
/* `word2` is the record's +2 word (read at 1ffd:e6ea: `0c 00 | 00 00 | c4 09 | text`),
 * 0 in all four — the one FUN_1000_67f5 tests for the tally fanfare. */
export const EXIT_DESTINATIONS = [
  { param: 12, word2: 0, param2: 2500, text: '    LEVEL  ONE   ', bits: 0x0502 },
  { param: 16, word2: 0, param2: 2500, text: '    LEVEL  TWO     ', bits: 0x0502 },
  { param: 100, word2: 0, param2: 2500, text: '   LEVEL  THREE   ', bits: 0x0702 },
  { param: 20, word2: 0, param2: 25000, text: '        GAME        ', bits: 0x0000 },
];

/**
 * CS:0x0FB8-0x0FD4. `null` outside [2, 5] — the original bails to its main
 * loop without writing DS:0x178, i.e. a zone with an out-of-range arg is
 * inert exactly like a miss.
 * @param {number} arg
 * @returns {?{param:number, param2:number, text:string, bits:number}}
 */
export function resolveExitDestination(arg) {
  const idx = arg - 2;
  if (idx < 0 || idx >= EXIT_DESTINATIONS.length) return null;
  return EXIT_DESTINATIONS[idx];
}

/* ── The bit-dispatch table, CS:0x694d -> SS:0x35aa ─────────────────────
 *
 * ⚠️ SUPERSEDED for the game itself: main.js now walks ALL twelve bits
 * through game/progress.js's `progressActions`, for the exit records AND
 * the mid-world records selector 6 reaches (the four exit records above are
 * only the chain's last link per world). Bit 11 — and bits 0 and 3, the same
 * handler — is how sublevel B is entered: a world's mid-world record, not an
 * exit record. `EXIT_BIT`/`exitEffects` stay as the exit records' own
 * four-bit decoder, which the suite still checks against the bytes. */
export const EXIT_BIT = {
  WORLD_ADVANCE: 1 << 1,    // 0x0002 — FUN_1000_6b00
  KEY_CLEAR:     1 << 8,    // 0x0100 — FUN_1000_6ad4
  POOL_RESET:    1 << 9,    // 0x0200 — FUN_1000_6992, LEVEL THREE only
  PASSWORD_GEN:  1 << 10,   // 0x0400 — FUN_1000_69d7
};

/**
 * Decodes a destination record's `bits` into the four effects a caller
 * needs to act on. Pure — no state, so `exitEffects(dest.bits)` is testable
 * in isolation from the world/inventory/password state main.js owns.
 * @param {number} bits `dest.bits`, an EXIT_DESTINATIONS record's +0x1e
 * @returns {{advance:boolean, clearKeys:boolean, poolReset:boolean, genPassword:boolean}}
 */
export function exitEffects(bits) {
  return {
    advance: (bits & EXIT_BIT.WORLD_ADVANCE) !== 0,
    clearKeys: (bits & EXIT_BIT.KEY_CLEAR) !== 0,
    poolReset: (bits & EXIT_BIT.POOL_RESET) !== 0,
    genPassword: (bits & EXIT_BIT.PASSWORD_GEN) !== 0,
  };
}

/**
 * CS:0x6B00-0x6B0B (FUN_1000_6b00), the ENTIRE world/sublevel advance rule.
 * `INC AL` wrapped 5->1 — never a jump to a specific world, so reaching
 * world 4 from LEVEL THREE's own record is coincidental to the wrap, not an
 * explicit target — and `[0x43] := 0` UNCONDITIONALLY: every real level
 * exit forces sublevel A. Sublevel B is reached some other way, not this
 * one (`UNKNOWN_sublevel_b_entry_point` remains open).
 * @param {number} world current 1-based world, DS:0x42
 * @returns {{world:number, sublevel:0}}
 */
export function advanceWorld(world) {
  return { world: world >= 4 ? 1 : world + 1, sublevel: 0 };
}

/**
 * CS:0x6AD4-0x6AFF (FUN_1000_6ad4). Clears every inventory slot whose held
 * item's own POBJECTS category is NOT 0 (consumable/potion) — in practice
 * every key, since this 4-slot array (DS:0x17e) never holds anything else.
 * Mutates `inventory` in place, matching the original's own `MOV [SI],
 * 0xFFFF` per slot.
 * @param {number[]} inventory the live 4-slot array (INVENTORY_EMPTY-filled)
 * @param {Uint8Array|number[]} cats POBJECTS category table, indexed by type
 */
export function clearNonPotionInventory(inventory, cats) {
  for (let i = 0; i < inventory.length; i++) {
    const item = inventory[i];
    if (item === INVENTORY_EMPTY) continue;
    if (cats[item] !== 0) inventory[i] = INVENTORY_EMPTY;   // CS:0x6AED/0x6AF3
  }
}

/* ── The level-select password, CS:0x69D7 (FUN_1000_69d7) / CS:0x6A6B ─────
 *
 * DS:0x432/0x436/0x43a — three 3-character passwords, one per unlockable
 * world (2/3/4), generated for the JUST-COMPLETED world (1/2/3) when bit 10
 * fires and that world's own slot is still empty. They are stored in a
 * plain 3-slot array main.js owns. `UNKNOWN_password_entry_ui` is CLOSED —
 * game/title-menu.js's `PasswordEntry` is the grid-entry UI that types one
 * of these back in; main.js's own title-screen dispatch checks a submitted
 * guess against `passwordToString(passwordSlots[i])` for each slot and, on
 * a match, calls `passwordWorldForSlot(i)` for the world to jump to. The
 * freshly-generated code is also shown to the player immediately, as part
 * of the same bonus-tally sequence this world-advance is deferred into —
 * see `game/tally.js`'s own header ("LEVEL 2 PASSWORD" / code / "FIRE TO
 * CONTINUE", `FUN_1000_69d7`'s reveal, live-confirmed under DOSBox). */
export const PASSWORD_LENGTH = 3;     // 3 chars per world, DS:0x432/0x436/0x43a
export const PASSWORD_SLOTS = 3;      // one per unlockable world: 2, 3, 4

/**
 * World 1/2/3 completing generates the password for world 2/3/4
 * respectively — the slot the "ENTER A PASSWORD" screen's own table
 * (DS:0x42a) would map a correct guess back to.
 * @param {number} completedWorld 1..3, DS:0x42 BEFORE FUN_1000_6b00's advance
 * @returns {number} 0..2
 */
export function passwordSlotForWorld(completedWorld) {
  return completedWorld - 1;
}

/**
 * The exact inverse of `passwordSlotForWorld`: which world a CORRECT guess
 * against `passwordSlots[slot]` should jump to (DS:0x42a's own table entry
 * ordering, `dl==1 -> 2` folded in — see the header table above: slot 0's
 * password unlocks world 2, slot 1's world 3, slot 2's world 4).
 * @param {number} slot 0..2, PASSWORD_SLOTS index
 * @returns {number} 2..4
 */
export function passwordWorldForSlot(slot) {
  return slot + 2;
}

/**
 * CS:0x6A6B — NOT a stub: three draws through the shared random source,
 * each reduced via `random/2521 + 1` to this project's own 1-based
 * hiscore-name alphabet (A=1..Z=26). `rng` is this port's own GodsRandom,
 * which — unlike the mixer — DOES faithfully replay FUN_1000_3836's draw
 * shape (see random.js's own header), so matching the original's divisor
 * costs nothing and is kept rather than swapped for a plain 1..26 roll.
 * The original's own password is wall-clock seeded and so was never
 * reproducible run-to-run either way.
 * @param {{next(): number}} rng
 * @returns {number[]} PASSWORD_LENGTH ints, each 1..26
 */
export function generatePassword(rng) {
  const chars = [];
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    chars.push(Math.min(26, Math.floor(rng.next() / 2521) + 1));
  }
  return chars;
}

/** 1-based alphabet (A=1..Z=26) -> a display string, for UI/debug text. */
export function passwordToString(chars) {
  return chars.map((c) => String.fromCharCode(0x40 + c)).join('');
}
