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
 *           state; this port does not reproduce that yet — a disclosed gap.
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
 * consumer of either field was located this pass, so neither is asserted as
 * "score bonus" or anything else — see EXIT_DESTINATIONS below.
 */

import { ZONE_TELEPORT, ZONE_EXIT } from './trigger-actions.js';

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
 * Indexed by `arg - 2` for arg in [2, 5]; see the header note above for what
 * is and is not established about the two numeric fields. */
export const EXIT_DESTINATIONS = [
  { param: 12, param2: 2500, text: '    LEVEL  ONE   ' },
  { param: 16, param2: 2500, text: '    LEVEL  TWO     ' },
  { param: 100, param2: 2500, text: '   LEVEL  THREE   ' },
  { param: 20, param2: 25000, text: '        GAME        ' },
];

/**
 * CS:0x0FB8-0x0FD4. `null` outside [2, 5] — the original bails to its main
 * loop without writing DS:0x178, i.e. a zone with an out-of-range arg is
 * inert exactly like a miss.
 * @param {number} arg
 * @returns {?{param:number, param2:number, text:string}}
 */
export function resolveExitDestination(arg) {
  const idx = arg - 2;
  if (idx < 0 || idx >= EXIT_DESTINATIONS.length) return null;
  return EXIT_DESTINATIONS[idx];
}
