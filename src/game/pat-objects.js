/* pat-objects.js — PGOD0x.PAT scripted objects (selector 1), and the
 * shooting behaviour they drive.
 *
 * CLAUDE.md already closed the FILE FORMAT (`UNKNOWN_pat_payload — CLOSED`)
 * and the GROUP/SUB-RECORD FIELD MAP (`UNKNOWN_pat_class_fields`, and its
 * follow-up under "The five other emitter-pair owners"). This module is the
 * first thing in this port to actually RUN that system — nothing in gods-web
 * referenced PGOD0x.PAT, CS:0xb908, CS:0xb987, or CS:0xBC4B before this pass
 * (`grep -rn "PGOD0\|b987\|b6b8" src/` returned nothing).
 *
 * ── THE ALLOCATOR, CS:0xB908 — disassembled fresh this pass ──────────────
 * Reached from the selector-1 trigger dispatch (`0xb908`, already on record
 * in CLAUDE.md's own selector table) with AX = a 0-based index into the
 * PALFILS `+0x0000` window (`DS:0x9008`, stride 8, 100 records — the SAME
 * window System-A/B's own trigger-driven spawns use for their own group
 * descriptors, just a different byte layout here). It finds a free one of
 * FIVE runtime slots (`DS:0xb6b8`, stride 0x1c — CLAUDE.md's own already-
 * documented numbers) and copies the 8-byte PALFILS record's fields in, byte
 * for byte, exactly as read off `CS:0xB90D`-`0xB976`:
 *
 *   PALFILS[0]      RAW byte  -> entity count for this batch (also the loop
 *                                bound for the sub-record seed, CS:0xBA2C)
 *   PALFILS[1]      RAW byte  -> the PAT DIRECTORY index (`[si+0x7]`,
 *                                CS:0xB9AE — CLAUDE.md's own "a class byte at
 *                                [si+0x7] indexes the PAT directory")
 *   PALFILS[2..3]   BE u16    -> per-entity STAGGER STEP, accumulated
 *                                cumulatively across sub-records exactly like
 *                                nest.js's/entity-a.js's own materialise loops
 *   PALFILS[4]      RAW byte  -> "key", zero-extended into every sub-record's
 *                                own +0xc field (CLAUDE.md's own "+0xa (a
 *                                'key' copied to the sub-record's +0xc)")
 *   PALFILS[5]      RAW byte  -> a SECOND, independent class index — this one
 *                                into `DS:0x1fe`, System A's OWN per-world
 *                                class table (CS:0xB953 `mov bp,[0x1fe]`),
 *                                supplying spriteBase/handlerA/w/h/handlerB.
 *                                ⚠️ NOT the same table selector-2's own
 *                                allocator (CS:0xAD0D, this project's own
 *                                separate pass) reads — that one uses
 *                                `DS:0x1fc`, System B's table. Two spawn
 *                                systems, two different per-world tables.
 *   PALFILS[6]      RAW byte  -> nibble pair: HIGH nibble -> the class's
 *                                +0xb field, LOW nibble -> +0xc — read every
 *                                tick into DS:0x230 (low)/DS:0x232 (high) and
 *                                consumed directly by the shoot handlers
 *                                below as a fire-rate divisor and a
 *                                behaviour-select flag, respectively.
 *   PALFILS[7]      RAW byte  -> copied to the slot's own +0x16 (a live/dead
 *                                marker some other, unread piece of this
 *                                system tests — CS:0xBABB overwrites it to
 *                                0xFFFF on RETIRE. What reads it back was not
 *                                traced this pass; kept for parity, unused by
 *                                this module's own logic).
 *
 * class_table[cls] (`DS:0x1fe`, 12 bytes: {spriteBase, one(=1), handlerA, w,
 * h, handlerB}) is copied wholesale into the slot's own +0xe..+0x15
 * (CS:0xB96C-B975, `rep movsw` cx=4 over handlerA/w/h/handlerB, plus one
 * separate byte for `one`) — the SAME 4-word tail spawn.js's own
 * `CLASS_TABLES_B` already transcribes for the SYSTEM-B table, but this is
 * SYSTEM A's, and w/h's own THIRD reuse (see CS:0xBB35 below) needed a fresh
 * read since spawn.js only ever kept base/w/h for the B table.
 *
 * ── THE SEED (first activation), CS:0xB9A3-0xBA3E ────────────────────────
 * PAT DIRECTORY entry = `SS:0x500 + pathClassIndex*8` (already documented).
 * Its own `+0` field is the LOADER-PATCHED running pointer into the
 * decompressed .PAT payload (CLAUDE.md's own `UNKNOWN_pat_payload` closure);
 * `+6` is the real on-disk BE u16 length. `blobEnd = entryPtr + length` is
 * cached into the SLOT's own +2 field (CS:0xB9C5) — not a per-sub-record
 * field, a per-GROUP one, since every sub-record in a batch shares one path.
 *
 * The blob's own first native word decides absolute vs. relative seeding,
 * exactly as documented: `0x4523` -> `{x,y}` = BE16 at blob+2/+4, cursor
 * starts at blob+6; anything else -> `{x,y}` = BE16 at blob+0/+2 PLUS the
 * current scroll origin, cursor starts at blob+4.
 *
 * Each sub-record also gets, at seed time: frame/state=0, stagger=the
 * running accumulator (BEFORE this iteration's own add — entry 0 gets 0,
 * entry 1 gets one stagger step, etc.), a reload timer seeded to
 * `(16 - loNibble) * 2` (CS:0xBA11-BA19 — this is PAT's OWN reload formula;
 * ⚠️ it is NOT the same shift as selector-2's own `(16-value)<<2` — a
 * different system, a different constant, confirmed by reading both), and
 * `key = zero_extend(PALFILS[4])`.
 *
 * ── THE PER-TICK MOVEMENT, CS:0xBA41-0xBAF7 ──────────────────────────────
 * Skip a sub-record whose `key === 0` entirely (retired). While its own
 * stagger counter is still positive, just decrement it. Once it reaches 0:
 * read ONE byte at the stored cursor, advance the cursor, and — UNLESS the
 * cursor has run past the blob's own end (`blobEnd`, cached on the slot) —
 * decode the byte as two independent signed 4-bit deltas (low nibble -> ΔY,
 * high nibble -> ΔX, standard `shl4/sar4` sign-extraction, CS:0xBACB-BAF0)
 * and apply them to the sub-record's position.
 *
 * ⚠️ REACHING THE CURSOR'S END DOES NOT ALWAYS RETIRE. CS:0xBA8D-BAB3 first
 * re-tests the sub-record's CURRENT screen position against a 4-edge box; if
 * still inside it, the cursor is backed off by ONE (re-reading and
 * re-applying the SAME last delta byte forever) instead of retiring — this
 * is `HOLD_BOX` below, and it is a hold-last-motion behaviour, not a bounce
 * or a freeze. Only once the sub-record has genuinely scrolled outside that
 * box does it retire (`key := 0`, plus the slot-level `+0x16 := 0xFFFF`
 * marker noted above).
 *
 * `DS:0x200` — the field CLAUDE.md's own "five other emitter-pair owners"
 * section names as what CS:0xBC4B compares against — is written HERE
 * (CS:0xBAC4), to the sub-record's OWN X **before** this tick's movement is
 * applied. That is what makes "fire toward the direction I last moved" work:
 * the shoot handler runs later in the SAME tick (CS:0xBB2B-BB33, after
 * movement), so by the time it compares `[di]` (now the NEW position)
 * against `DS:0x200` (the OLD one), the sign tells it which way this
 * sub-record just travelled.
 *
 * ── THE HANDLERS, CS:0xBB2B/0xBB30 — called every tick, UNCONDITIONALLY ──
 * ⚠️ Unlike selector-2's own driver (this project's separate `selector2.js`
 * pass), freeze (`DS:0x2fa`) gates ONLY the movement step above (the
 * `ba7f JNZ baf7` skip) — both handlers still run on a frozen tick. Two
 * pairs were read fully this pass:
 *
 *   handlerA = CS:0xBE6B / CS:0xBE71 (generic, 11 of 14 live System-A
 *     classes per CLAUDE.md's own census) — a walk-cycle animation driver
 *     (`CS:0xBE99`) toggling a small facing/phase field. Purely cosmetic;
 *     this port implements it as a fixed `spriteBase` (see
 *     `UNKNOWN_pat_animation_frame` below) rather than chasing the exact
 *     4-entry table, since the actual ask this pass was the SHOOTING half.
 *   handlerB = CS:0xBC4B (generic, fully decoded below) fires toward the
 *     sub-record's own direction of travel through the SAME shared emitters
 *     (`CS:0x1FE7`/`CS:0x2039`) this port's `enemy-shots.js` already models.
 *
 *   World 4's own class index 2 is a DEDICATED pair instead:
 *   handlerA = CS:0xBDDB (an attack/walk STATE MACHINE, fully decoded below)
 *   handlerB = CS:0xBD71 (arms the attack; CS:0xBD9F does the actual fire)
 *   — this is the "World 4 class-index-2" CLAUDE.md's own "five other
 *   emitter-pair owners" section already names, confirmed here at the exact
 *   sprite/dims: `spriteBase=504(0x1f8)`, `w=32, h=48` (TALLER than every
 *   other read class, all of which are 32x32) — read live off
 *   `1ffd:e21a+2*12`, System A's own world-4 table.
 *
 * ── CS:0xBC4B, the generic shoot handler, fully decoded ──────────────────
 * Gated on the class's own low-nibble reload divisor (`DS:0x230` — zero
 * means this class never fires) and a per-sub-record reload timer at +0x12,
 * reseeded to `(16-loNibble)*2` on every shot. Then branches on the HIGH
 * nibble (`DS:0x232`):
 *   - nonzero: ALWAYS diverts into the Bresenham line-hazard seed
 *     (`CS:0xdbc6`, the exact routine this port's `line-hazard.js` already
 *     implements as `LineHazards.spawnJittered`/`spawnAtHero`), muzzle
 *     `(pos+16, pos+16)`, unconditionally LEFT-shaped in the source (no
 *     direction test at all) — reload reseeded via a BYTE-only doubling
 *     (`ADD AL,AL`), where the zero-nibble branch below uses a full 16-bit
 *     one (`ADD AX,AX`); both land on the same numeric result since the
 *     value is always < 128, but the asymmetry is real in the bytes and
 *     reproduced verbatim rather than unified.
 *     ⚠️ `CS:0xBC88`'s own `CALL 0xdbc6` does NOT set `BP` beforehand (unlike
 *     `selector2.js`'s own `CS:0xB667`, which explicitly seeds `BP:=1`) —
 *     what `BP` holds at this exact call site was not traced this pass
 *     (`UNKNOWN_bc4b_line_hazard_bp`). This port calls `spawnJittered`
 *     (the `BP=1` shape, the only one this project has independently
 *     confirmed anywhere) rather than guess a different variant.
 *   - zero: fires an ordinary projectile through the shared emitter, muzzle
 *     Y = pos.y+12 (both directions), X = pos.x+8 (left) / pos.x+24
 *     (right), direction chosen by `currentX >= DS:0x200 ? right : left`
 *     (the pre-tick X cached during movement, above) — i.e. literally
 *     "fire the way I just moved" — with `vx = ±((loNibble>>1)+4)`.
 *
 * ── CS:0xBD9F, the world-4 special fire, fully decoded ───────────────────
 * Muzzle Y = pos.y+9 (both directions); `vx = ±((loNibble>>1)+4)`, the SAME
 * magnitude formula as CS:0xBC4B (a different muzzle Y, same speed). Facing
 * is read DIRECTLY off the sub-record's own animation-state bit 3
 * (`[di+0xe] & 8`), not from a movement comparison — matching CLAUDE.md's
 * own "a fire routine using [di+0xe]'s bit3 directly as the facing test
 * rather than a movement comparison" exactly. ⚠️ What SETS bit 3 was not
 * found in the region read this pass (`CS:0xBDDB`'s own animation-phase
 * update explicitly PRESERVES it, `CS:0xBE02 AND [di+0xe],8` before OR-ing in
 * the new phase) — `UNKNOWN_pat_attack_facing_setter`. This port derives it
 * from the SAME "direction of last travel" comparison CS:0xBC4B itself uses
 * (`currentX >= DS:0x200`), which is the only facing signal this exact
 * subsystem is otherwise seen to use — flagged as this port's own choice,
 * not a re-derivation of the missing byte.
 *
 * ── THE ATTACK STATE MACHINE, CS:0xBDDB/CS:0xBD71 ────────────────────────
 * `[di+0xe]` packs: bits 0-2 = a phase counter (0..7, wrapping via
 * `AND 0x7`), bit 2 (0x4) = "in attack mode", bit 3 (0x8) = the sticky
 * facing bit CS:0xBD9F reads. `CS:0xBD71` (handlerB) is what starts an
 * attack: fire-rate-gated exactly like BC4B (low-nibble divisor, +0x12
 * reload timer), and ONLY when the phase is exactly 3 (the walk cycle's own
 * closing frame) and the tock toggle (`DS:0x36c`) fires does it reseed the
 * reload and INC the phase — 3 -> 4 sets bit 2, arming attack mode for the
 * NEXT tick's `CS:0xBDDB` call (handlerA always runs before handlerB in one
 * tick, so the flip is not visible until the following tick). Once in
 * attack mode, `CS:0xBDDB` counts the LOW 3 BITS up 4->5->6->7->8(clears
 * bit2, ending the attack), one step per TOCK tick — `CS:0xBDEC`'s own
 * `JZ be02` skips the whole increment on a non-tock tick, leaving the phase
 * untouched, not just slowing the fire rate — firing (`CALL 0xBD9F`) exactly
 * once, on the transition that LANDS on 6 (i.e. entered at phase 5), since
 * `CS:0xBDEF`'s own `CMP BP,6` tests the already-incremented value.
 *
 * ── CS:0xBCCF — CONTACT/DAMAGE, decoded and wired in a follow-up pass ────
 * Called from the driver at `CS:0xBB40` (`LES BP,[SI+0x10] / [0x1e2]:=BP /
 * [0x1e4]:=ES / CALL 0xBCCF`) — the `LES` is not a real far-pointer
 * dereference, it is a compact two-word load: `slot.cls.w`/`slot.cls.h` sit
 * at consecutive class_table words (the SAME `+0x10`/`+0x12` this module's
 * own allocator already copies them to), so one `LES` loads BOTH into
 * `BP`/`ES` at once, which the caller then stages into the shared box-size
 * scratch every contact/scan routine in this game reads. `CS:0xBCCF` itself
 * (fresh disassembly this pass, at `1000:bccf`):
 *
 *   bccf  push ax,bx,cx,si,di
 *   bcd4  ax += word[0xa] ; bx += word[0xc]      ; screen -> world (caller passes screen coords)
 *   bcdc  bp = word[di+0xc]                       ; the sub-record's own KEY (+0xc) as strength, in/out
 *   bcdf  byte[0x35e] = 0xff                      ; NOT reportGate (that's DS:0x34) — this is the
 *                                                  ;   separate ROL-only-alternate-death-sound bracket
 *                                                  ;   (CLAUDE.md's UNKNOWN_sfx_id_space), a FOURTH
 *                                                  ;   confirmed site alongside System A/B and the
 *                                                  ;   world-1 statue. No SFX model in this port, so
 *                                                  ;   not reproduced — noted, not silently dropped.
 *   bce4  call 0x1000:a9e4                        ; combat.js attackHero, THEN (if that missed)
 *                                                  ;   creatureScansGrid — the canonical two-call
 *                                                  ;   idiom frame.js's stepCreatureDamage already
 *                                                  ;   uses, NOT ce64.js's own reportGate:1 special
 *                                                  ;   case (no DS:0x34 bracket here, so a hero TOUCH
 *                                                  ;   genuinely kills a PAT object outright, exactly
 *                                                  ;   like an ordinary System-A/B entity)
 *   bce7  byte[0x35e] = 0x0                       ; un-bracket
 *   bcec  word[di+0xc] = bp                        ; write the (possibly damaged) strength back to KEY
 *   bcef  or bp,bp / js 0xbcf9                     ; negative -> killed, below; else return, no further effect
 *
 * ── THE KILL TAIL, `CS:0xBCF9`-`0xBD09`, and `CS:0xBB43`-`0xBB49` ────────
 * `CS:0xBB43` (right after the driver's own `CALL 0xBCCF`) re-tests KEY:
 * negative -> `CS:0xBBC1` (cache screen pos to the shared `DS:0x202`/`0x204`
 * "last dying position" scratch this project already documents elsewhere,
 * bump a slot-level tally at `+0x1a`, award score via `CS:0xAF7D` — THE
 * SAME BCD kill-score helper this session's own selector2.js research
 * already found and ported as `scoreForState0`, here fed `slot.desc.key`
 * i.e. `PALFILS[4]` read directly as `SI+0xa` — CS:0xAF7D's own DL input)
 * — and then `JMP 0xBB49`, rejoining the ORDINARY draw path: **a sub-record
 * killed this tick still draws its normal sprite once more**, exactly the
 * "draws ALIVE on both branches" convention ce64.js's own `#contactAndDraw`
 * already documents. The death-burst only starts on the FOLLOWING tick.
 *
 * That following-tick path is `CS:0xBA64`'s own `key < 0` branch
 * (previously undecoded in this module — `CS:0xBB43`'s own negative-KEY
 * check is a SEPARATE, later-in-the-same-tick test, not the same site),
 * `JMP 0xBBD6`:
 *
 *   bbd6  inc byte[si+0x1b]           ; a second, distinct slot-level tally (dying count)
 *   bbd9  inc word[di+0xe]             ; ⚠️ REUSES `+0xe` — the SAME field this module's
 *                                      ;   own World-4 `attackState` bitfield owns while
 *                                      ;   alive. `CS:0xBCFA` (below) already forces it to
 *                                      ;   -1(0xFFFF) the instant of death, so an in-progress
 *                                      ;   attack is simply abandoned — this is now COUNTING
 *                                      ;   UP FROM -1 as the death-frame index, the same
 *                                      ;   "counts up from -1" idiom this project documents
 *                                      ;   for nest.js's brood and System-A's own death draw.
 *   bbdc  cmp byte[di+0xe],0x11(17) / jl 0xbbe9   ; still < 17 -> draw the death frame (below)
 *   bbe2  word[di+0xc] = 0             ; counter reached 17 -> FULLY RETIRE (the SAME
 *                                      ;   key===0 sentinel this module's own `#move`
 *                                      ;   already uses) — 17 frames drawn (sprites 91..107),
 *                                      ;   the 18th tick retires with no further draw
 *   bbe9  ax=word[di]; bx=word[di+2]   ; the FROZEN world position from the moment of death
 *   bbef  dx = word[di+0x10]           ; the field `CS:0xBD06` (below) set at death — a
 *                                      ;   RAW, un-split delta byte (sign-extended to a
 *                                      ;   word purely for storage; only the low byte matters)
 *   bbf3..bc18  the IDENTICAL decodeDelta() nibble-split this module's own `#move` already
 *               implements, applied to that FROZEN byte — so the corpse keeps sliding in
 *               the direction of its last real movement step, one frozen delta per tick,
 *               for all 17 death-draw ticks
 *   bc1e  word[di]=ax; word[di+2]=bx    ; a REAL position write-back, not a draw-only offset
 *   bc2b  bp = word[di+0xe]             ; the death-frame counter
 *   bc2e  bp += 0x5b(91)                 ; sprite = 91 + counter — THE UNIVERSAL 0x5b-base
 *                                        ;   death-burst sprite family this project documents
 *                                        ;   for nest.js, System-A, ce64.js, statue.js, and
 *                                        ;   now this module too
 *
 * And the field `CS:0xBD06` writes, resolving the coordinator's own
 * flagged-as-unconfirmed `+0x8`/+0xe`/`+0x10` triple:
 *
 *   bcf9  pop di                        ; (the register-save discipline around the a9e4 call)
 *   bcfa  word[di+0xe] = 0xffff          ; CONFIRMED: the SAME field as `attackState` — see above
 *   bcff  bp = word[di+8]                ; CONFIRMED: the SAME field as this module's own
 *                                        ;   `cursor` (CS:0xB9E5/0xBA01 already establish +0x8
 *                                        ;   as the movement cursor; this is not a new field,
 *                                        ;   just a second reader of the same one)
 *   bd02  al = byte[bp-1]                ; the byte ONE BEHIND the (already-advanced) cursor —
 *                                        ;   i.e. the LAST delta byte `#move` actually consumed
 *   bd05  cbw                             ; sign-extend the WHOLE byte (not yet nibble-split —
 *                                        ;   the nibble split happens fresh every death-draw
 *                                        ;   tick, at CS:0xBBF3 above, not here)
 *   bd06  word[di+0x10] = ax              ; CONFIRMED NEW: a field this module had never
 *                                        ;   touched before this pass — the frozen delta byte
 *                                        ;   the death-draw slide reads every tick
 *
 * So none of the three fields the coordinator's own fresh read flagged as
 * unconfirmed needed a NEW slot in this module's sub-record object: `+0x8`
 * is `cursor`, `+0xe` is `attackState` (deliberately reused as a death-frame
 * counter, matching the coordinator's own suspicion), and only `+0x10` is
 * genuinely new — added below as `deathDelta`.
 *
 * ── NOT PORTED THIS PASS, flagged rather than silently dropped ──────────
 *   - `UNKNOWN_pat_animation_frame` — handlerA's own 4-phase walk-cycle
 *     sprite selection (`CS:0xBE99`, `DS:0xdf68`/`DS:0xdf70`); this module
 *     draws `spriteBase` unmodified. A visual gap only.
 *   - `CS:0xBF58` — a THIRD handlerB found live at World-1 class index 1
 *     (`1ffd:e046+12`) while reading the class table for this module. Not
 *     BC4B, not the World-4 attack pair; its own body was not read this
 *     pass. A class wired to it (`spriteBase=516`) is skipped by this
 *     module's shoot dispatch — treated as `handlerB: 'unknown'`, animated
 *     but never made to fire, rather than guessed at.
   *   - ⚠️ CORRECTION: worlds 2/3 are now transcribed too, see `CLASS_TABLE_A`
 *     below — copied from entity-a.js's own `CLASS_TABLES_A` (the same
 *     `DS:0x1fe` pointer) and cross-checked byte-for-byte against this
 *     table's own world 1/4 rows first. A class index past what any world
 *     transcribes still resolves to `null` and is silently inert (matching
 *     spawn.js's own `CLASS_TABLES_B` convention), not a guess.
 *   - No `PGOD0{1..4}.PAT` file is vendored into this port's asset
 *     directory (`public/game/` has no `.PAT` files today), so nothing
 *     currently calls `parsePatFile`/`PatGroups.activate` from a real
 *     level load — the module is complete and unit-tested against
 *     synthetic bytes, but INERT in the live game until those four files
 *     are added and wired into `main.js`'s own level loader. Flagged
 *     explicitly rather than left to look silently finished.
 */

import { attackHero, creatureScansGrid } from './combat.js';

export const GROUP_SLOTS = 5;                 // DS:0xb6b8, CS:0xB915 `mov cx,0x5`
export const SUBRECORDS_PER_GROUP = 10;        // the allocator's own DL-bound loop cap
export const SUBRECORD_STRIDE = 0x14;          // CS:0xBA27 `add di,0x14` — 20 bytes
export const ABSOLUTE_TAG = 0x4523;            // CS:0xB9CB
export const DEATH_SPRITE_BASE = 0x5b;         // CS:0xBC2E — 91, the universal death-burst base
export const DEATH_RETIRE_AT = 0x11;           // CS:0xBBDC — 17; frames 0..16 draw, 17 retires

/**
 * CS:0xBBCC/0xAF7D — the kill-score award, fed `PALFILS[4]` (this module's
 * own `desc.key`, the SAME raw byte seeded into every sub-record's own
 * `key` at spawn). Identical formula and identical unmodelled edge case to
 * this session's own `selector2.js` `scoreForState0` (CS:0xB63F's sibling
 * use of the same CS:0xAF7D helper) — reproduced independently here rather
 * than imported, so this module stays free of any selector2.js coupling.
 * ⚠️ NOT MODELLED: the overflow branch CS:0xAF8E-AFB1 (`(v>>1)+1 > 9`, i.e.
 * `v > 178`ish), which issues a SECOND `CALL 0x1000:0c8b` at a higher BCD
 * digit position. Whether any shipped PALFILS[4] byte ever reaches it was
 * not checked this pass — flagged, not guessed.
 */
export const scoreForKey = (v) => ((v >> 1) + 1) * 100;

/** CS:0xBA95-0xBAB0 — the 4-edge screen-space "still visible, hold last
 *  motion" box. Asymmetric on purpose; do not square it off. */
export const HOLD_BOX = Object.freeze({ xMin: -0x24, xMax: 0x144, yMin: -0x28, yMax: 0xc4 });

/** CS:0xBA11-BA19 / CS:0xBC6D / CS:0xBC9B / CS:0xBD98 — PAT's own reload
 *  formula. NOT the same shift as selector-2's `(16-v)<<2`. */
export const reloadTicks = (loNibble) => (0x10 - loNibble) * 2;

/** CS:0xBACB-0xBAF0 — decode one packed delta byte into signed {dx, dy}. */
export function decodeDelta(byte) {
  const signExtendNibble = (n) => (n << 4 << 24) >> 28; // shl4 then sar4, on a 32-bit host
  return { dy: signExtendNibble(byte & 0xf), dx: signExtendNibble((byte >> 4) & 0xf) };
}

/**
 * CS:0x38a8/0x3855 — the .PAT directory parser. `buf` is the DECOMPRESSED
 * file. The RUNNING-POINTER MATH is exactly CS:0x38a8's own loop: an entry
 * whose on-disk `+0` word is negative is skipped outright (CLAUDE.md's own
 * "an entry whose +0 is negative is skipped"), and every other entry's
 * `+6` BE u16 length advances the running pointer regardless of its value —
 * a zero-length entry is a genuine no-op in that loop, not a special case.
 *
 * ⚠️ BUT A ZERO-LENGTH ENTRY IS ALSO TREATED AS DEAD HERE, and that is a
 * refinement on top of the loader's own bytes, not a restatement of them —
 * found by running this parser against the REAL shipped, decompressed
 * `PGOD0{1..4}.PAT` files rather than trusting synthetic test data alone.
 * All four files have a long TAIL of directory slots that are all-zero on
 * disk (`+0=0, +6=0`) — not flagged negative, so a strict "negative -> dead"
 * reading counts them as live, empty-length entries. CLAUDE.md's own
 * already-published per-file live-entry counts (38/6/1/22) do NOT include
 * them; re-deriving those exact counts against the real files, `rawPtr>=0
 * && length>0` is the criterion that reproduces 38/6/1/22 exactly on all
 * four, while `rawPtr>=0` alone gives 38/6/49/23 — world 3 in particular is
 * one real entry (index 0, length 156) followed by 48 more all-zero slots.
 * Whether the ORIGINAL LOADER'S OWN CONSUMER (`CS:0xB9A3`'s seed) ever
 * actually gets pointed at one of these zero-length entries by a real
 * PALFILS spawn descriptor was not checked this pass — this refinement
 * exists so `PatGroups#activate` fails closed (no entry -> no seed) rather
 * than reading garbage bytes at a zero-width blob if one ever is.
 * @param {Uint8Array} buf
 * @returns {Array<?{blobOffset:number, blobLength:number}>} 50 entries,
 *   `null` for a dead (negative-+0, or genuinely zero-length) one.
 */
export function parsePatDirectory(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  let running = 0x190;
  for (let i = 0; i < GROUP_SLOTS * 10; i++) {
    const base = i * 8;
    const rawPtr = dv.getInt16(base, true);        // native i16, pre-patch value on disk
    const length = dv.getUint16(base + 6, false);  // BE u16, the one real field
    if (rawPtr < 0) { out.push(null); continue; }
    out.push(length > 0 ? { blobOffset: running, blobLength: length } : null);
    running += length;
  }
  return out;
}

/**
 * The 8-byte PALFILS `+0x0000`-window spawn descriptor this system's own
 * allocator (CS:0xB908) reads. See this file's header for the full byte map.
 * @param {Uint8Array} buf  the decompressed PALFILS front region
 * @param {number} index    0-based, into the 100-record window at `DS:0x9008`
 */
export function parsePatSpawnDescriptor(buf, index) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const base = index * 8;
  const b6 = dv.getUint8(base + 6);
  return {
    entityCount: dv.getUint8(base + 0),
    pathClassIndex: dv.getUint8(base + 1),
    staggerStep: dv.getUint16(base + 2, false),   // BE
    key: dv.getUint8(base + 4),
    behaviorClassIndex: dv.getUint8(base + 5),
    hiNibble: (b6 >> 4) & 0xf,
    loNibble: b6 & 0xf,
    extra: dv.getUint8(base + 7),                  // slot+0x16, unused by this module
  };
}

/**
 * System A's own per-world class table (`DS:0x1fe`), 12-byte records
 * {spriteBase, one, handlerA, w, h, handlerB}. Only the fields this module
 * needs are transcribed, and only for the two worlds actually read this
 * pass (`1ffd:e046` world 1, `1ffd:e21a` world 4) — see the header's own
 * "NOT PORTED THIS PASS" note for worlds 2/3.
 *
 * `handlerA`/`handlerB` are named by BEHAVIOUR, not raw address, since this
 * module dispatches on behaviour: `'generic'` = CS:0xBE6B/0xBE71 (cosmetic
 * animation only), `'attack-state'` = CS:0xBDDB, `'bc4b'` = CS:0xBC4B,
 * `'attack-fire'` = CS:0xBD71, `'unknown'` = a real handler this pass did
 * not read (CS:0xBF58 at world 1 index 1) — animated, never fires.
 */
export const CLASS_TABLE_A = {
  1: [
    { spriteBase: 450, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
    { spriteBase: 516, w: 32, h: 32, handlerA: 'generic', handlerB: 'unknown' },
    { spriteBase: 456, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
  ],
  /* Worlds 2/3, transcribed from entity-a.js's own CLASS_TABLES_A (the SAME
   * DS:0x1fe pointer, cross-checked byte-for-byte against this table's own
   * world 1/4 rows before trusting it — every field matches). Neither row
   * set needed a fresh live read: this file's own header census already
   * covers all 14 live classes across all 4 worlds ("generic, 11 of 14"),
   * and 11 == 14 minus the 3 already-named specials (world1 idx1 'unknown',
   * world4 idx2 'attack-state', world4 idx3 'cut-hazard') — so every class
   * not already special IS the generic walk-cycle/bc4b pair, not a guess. */
  2: [
    { spriteBase: 504, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
    { spriteBase: 512, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
    { spriteBase: 504, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
    { spriteBase: 504, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
  ],
  3: [
    { spriteBase: 486, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
    { spriteBase: 523, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
    { spriteBase: 486, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
  ],
  4: [
    { spriteBase: 496, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
    { spriteBase: 524, w: 32, h: 32, handlerA: 'generic', handlerB: 'bc4b' },
    { spriteBase: 504, w: 32, h: 48, handlerA: 'attack-state', handlerB: 'attack-fire' },
    { spriteBase: 531, w: 32, h: 32, handlerA: 'cut-hazard', handlerB: 'cut-hazard' }, // CS:0xbd38/0xbd0b, never placed — see CLAUDE.md
  ],
};

/* `attackState` (+0xe) is deliberately overloaded, exactly as the original
 * overloads it: an active bitfield (bits 0-2 phase, bit2 attack-mode, bit3
 * facing) while `key >= 0`, forced to -1 the instant `key` goes negative
 * (CS:0xBCFA), and from then on a plain up-counter of death frames drawn
 * (CS:0xBBD9) — three roles, one field, one memory slot in the original.
 * `deathDelta` (+0x10) is the raw, un-split byte `#move` last consumed,
 * frozen at the moment of death for the death-slide (CS:0xBD06). */
const freeSub = () => ({
  x: 0, y: 0, cursor: 0, stagger: 0, key: 0, reload: 0, attackState: 0,
  deathDelta: 0,
});

/** `DS:0xb6b8`, 5 runtime slots. Set `.blobBytes` (the decompressed .PAT
 *  file) before the first `step()` call — seeding needs the real path
 *  bytes. */
export class PatGroups {
  constructor(directory) {
    this.directory = directory || [];
    this.slots = Array.from({ length: GROUP_SLOTS }, () => ({
      active: false, materialised: false,
      cls: null, blobEnd: 0,
      subs: Array.from({ length: SUBRECORDS_PER_GROUP }, freeSub),
    }));
    this.lostActivations = 0;
  }

  clear() { for (const s of this.slots) { s.active = false; s.materialised = false; } return this; }

  get live() { return this.slots.reduce((n, s) => n + (s.active ? 1 : 0), 0); }

  /**
   * CS:0xB908. `desc` is a `parsePatSpawnDescriptor` result; `world` selects
   * which `CLASS_TABLE_A` row-set to resolve `desc.behaviorClassIndex`
   * against. Silently drops the activation if the world is unmeasured or
   * the class index is past what was transcribed — matching spawn.js's own
   * `CLASS_TABLES_B` convention for the same situation.
   */
  activate(desc, world) {
    const free = this.slots.find((s) => !s.active);
    if (!free) { this.lostActivations++; return false; }
    const table = CLASS_TABLE_A[world];
    const cls = table && table[desc.behaviorClassIndex];
    if (!cls) return false;
    free.active = true;
    free.materialised = false;
    free.desc = desc;
    free.cls = cls;
    return true;
  }

  /** CS:0xB9A3-0xBA3E. Seeds `entityCount` sub-records from the PAT
   *  directory entry named by `desc.pathClassIndex`, world-space, with the
   *  current scroll origin resolving a relative-tagged blob. */
  #seed(slot, cam, rng) {
    const dir = this.directory[slot.desc.pathClassIndex];
    if (!dir) { slot.materialised = true; return; }   // no directory entry -> nothing to seed, don't re-try every tick
    slot.blobEnd = dir.blobOffset + dir.blobLength;
    const blob = this.blobBytes;
    const dv = blob && new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    let stagger = 0;
    for (let i = 0; i < slot.desc.entityCount && i < SUBRECORDS_PER_GROUP; i++) {
      const s = slot.subs[i];
      let x, y, cursor;
      if (dv && dv.getUint16(dir.blobOffset, false) === ABSOLUTE_TAG) {
        x = dv.getUint16(dir.blobOffset + 2, false);
        y = dv.getUint16(dir.blobOffset + 4, false);
        cursor = dir.blobOffset + 6;
      } else if (dv) {
        x = dv.getUint16(dir.blobOffset, false) + cam.x;
        y = dv.getUint16(dir.blobOffset + 2, false) + cam.y;
        cursor = dir.blobOffset + 4;
      } else {
        x = cam.x; y = cam.y; cursor = dir.blobOffset;
      }
      s.x = x; s.y = y; s.cursor = cursor;
      s.stagger = stagger;                             // CS:0xBA09, BEFORE this iteration's own add
      s.key = slot.desc.key;                            // CS:0xBA21, zero_extend
      s.reload = reloadTicks(slot.desc.loNibble);        // CS:0xBA19
      s.attackState = 0;
      stagger += slot.desc.staggerStep;                  // CS:0xBA24
    }
    slot.materialised = true;
  }

  /**
   * CS:0xB987. One tick. `blobBytes` is the decompressed .PAT file's own
   * bytes (set once via `this.blobBytes = ...` before the first `step`,
   * since seeding needs to read the actual movement path).
   * @param {{x:number,y:number}} cam
   * @param {number} freezeTimer  DS:0x2fa — gates ONLY the movement step
   * @param {import('./enemy-shots.js').EnemyShots} shots
   * @param {import('./line-hazard.js').LineHazards} lineHazards
   * @param {{x:number,y:number}} hero  world position, for the line-hazard
   *   jitter target (CS:0xBC88's own dbc6 call always aims at the hero) and
   *   for the contact test (also needs `.state`, the player's state index,
   *   for the crouch box raise — pass the SAME hero object combat.js's
   *   other consumers use, not a bare `{x,y}`)
   * @param {() => number} rngNext
   * @param {number} tock  DS:0x36c — the shared every-other-frame toggle,
   *   gates CS:0xBD71's own phase-3-to-attack transition
   * @param {?Array<{x:number,y:number,key:number}>} huntTargets  the shared
   *   Hunter-weapon target list (`DS:0x1d2`/`0x33c`), appended to under the
   *   same `DS:0x343` gate this project already documents for creature
   *   contacts — pass `null` to skip (matches "gate off" behaviour).
   * @param {?import('./combat.js').Health} health  CS:0xBCE4's own contact
   *   test needs it; pass `null` to skip contact/damage entirely (objects
   *   move/animate/shoot but cannot hurt or be hurt — the pre-this-pass
   *   behaviour, preserved as a graceful degrade rather than a hard
   *   requirement).
   * @param {?import('./collision.js').DamageGrid} grid  needed for the
   *   damage-grid half of the contact test; `health` alone (grid/decodeTag
   *   omitted) still runs the hero-touch half on its own, matching
   *   CS:0xBCE4's own "attackHero, THEN IF THAT MISSED, scan" order.
   * @param {?(tag:number)=>{damage:number}} decodeTag  the shared weapon-tag
   *   decoder every other creature's own contact test also takes.
   * @param {{invuln?:boolean, difficulty?:number, rng?:()=>number,
   *   debris?:object, score?:{add:(n:number)=>void}}} opts
   * @returns {Array<{x:number,y:number,sprite:number}>}
   */
  step(cam, freezeTimer, shots, lineHazards, hero, rngNext, tock = 0, huntTargets = null,
       health = null, grid = null, decodeTag = null, opts = {}) {
    const drawn = [];
    for (const slot of this.slots) {
      if (!slot.active) continue;
      if (!slot.materialised) {
        /* CS:0xB9A3-0xBA3E seeds every sub-record for this slot and then
         * `JMP b977` — the OUTER loop tail (next of 5 slots), never falling
         * through into CS:0xBA41's own movement/dispatch body. A freshly
         * materialised group therefore does not move, shoot, or draw on the
         * very tick it seeds — that starts on the NEXT tick, once
         * `materialised` is already true. */
        this.#seed(slot, cam, rngNext);
        continue;
      }

      for (const s of slot.subs) {
        if (s.key === 0) continue;                      // CS:0xBA5B/BA61 — fully retired

        if (s.key < 0) {                                  // CS:0xBA64 `JNS ba69` fallthrough -> JMP bbd6
          const d = this.#deathDraw(slot, s, cam);
          if (d) drawn.push(d);
          continue;                                       // no stagger/movement/dispatch/contact while dying
        }

        if (s.stagger > 0) { s.stagger -= 1; continue; } // CS:0xBA6D/BA6F — waiting, not moving. NOT
                                                          // the same field as `s.reload` (di+0x12, the
                                                          // firing cooldown BC4B/attackState manage) —
                                                          // this is di+6, the seed-time movement stagger.

        if (!freezeTimer) {                              // CS:0xBA7A/BA7F — freeze skips movement only
          this.#move(slot, s, cam);
        }

        if (s.key === 0) continue;                        // #move just retired it — CS:0xBAB5 jumps
                                                            // straight to the loop tail, skipping the
                                                            // hunter-list append, both handlers AND draw
        const screenX = s.x - cam.x, screenY = s.y - cam.y;
        if (huntTargets) {
          huntTargets.push({ x: screenX, y: screenY, key: s.key });   // CS:0xBB0F-BB1A
        }

        this.#dispatch(slot, s, cam, hero, shots, lineHazards, rngNext, tock);

        /* CS:0xBB35-0xBB43 — the contact/damage test, right after the
         * handlers and before the draw. A kill THIS tick still falls
         * through to the ordinary draw below (CS:0xBB43's own `JMP bb49`) —
         * the death-burst sprite only starts on the NEXT tick, via the
         * `s.key < 0` branch at the top of this loop. */
        if (health) this.#contactAndDamage(slot, s, cam, hero, health, grid, decodeTag, opts);

        drawn.push({ x: screenX, y: screenY, sprite: slot.cls.spriteBase }); // UNKNOWN_pat_animation_frame — see header
      }
    }
    return drawn;
  }

  /** CS:0xBA75-0xBAF7 plus the CS:0xBA8D-0xBAB3 hold/retire test. */
  #move(slot, s, cam) {
    const blob = this.blobBytes;
    if (!blob) return;
    const byte = blob[s.cursor];
    let cursor = s.cursor + 1;

    if (cursor >= slot.blobEnd) {
      const sx = s.x - cam.x, sy = s.y - cam.y;
      const inBox = sx > HOLD_BOX.xMin && sx < HOLD_BOX.xMax
                 && sy > HOLD_BOX.yMin && sy < HOLD_BOX.yMax;
      if (inBox) { cursor -= 1; }                        // CS:0xBAB2 — back off, re-apply last delta
      else { s.key = 0; return; }                         // CS:0xBAB6 — retire
    }

    /* AX (the pre-movement X) is cached to DS:0x200 BEFORE the delta is
     * applied — CS:0xBAC4 — which is exactly what lets CS:0xBC4B compare
     * "new X vs old X" a few instructions later in the same tick. */
    this.lastPretickX = s.x;
    s.cursor = cursor;
    const { dx, dy } = decodeDelta(byte);
    s.y += dy;
    s.x += dx;
  }

  /**
   * CS:0xBBD6-0xBC38. Runs INSTEAD OF stagger/movement/dispatch/contact
   * once `key < 0` (a kill was registered on some earlier tick). Counts the
   * shared attackState/death-frame field up from -1, retires at
   * DEATH_RETIRE_AT (17 frames drawn, sprites 91..107), else slides the
   * FROZEN position by the SAME frozen delta byte every tick (the corpse
   * keeps travelling in the direction it died moving) and draws the
   * universal 0x5b-base burst sprite.
   */
  #deathDraw(slot, s, cam) {
    s.attackState += 1;                                     // CS:0xBBD9 — counts up from -1
    if (s.attackState >= DEATH_RETIRE_AT) {                  // CS:0xBBDC/BBE0
      s.key = 0;                                             // CS:0xBBE2 — fully retire
      return null;
    }
    const { dx, dy } = decodeDelta(s.deathDelta);            // CS:0xBBF3-BC18, re-split fresh every tick
    s.x += dx;
    s.y += dy;
    return { x: s.x - cam.x, y: s.y - cam.y, sprite: DEATH_SPRITE_BASE + s.attackState };
  }

  /**
   * CS:0xBCCF, plus the driver's own post-call tail at CS:0xBB43-0xBB49/
   * 0xBBC1-0xBBD3. The canonical "attackHero, THEN (if that missed)
   * creatureScansGrid" shape frame.js's stepCreatureDamage already uses —
   * NOT ce64.js's own reportGate:1 bracket, since CS:0xBCCF's own bytes
   * carry no DS:0x34 override (see this file's own header for the fresh
   * disassembly this pass read).
   */
  #contactAndDamage(slot, s, cam, hero, health, grid, decodeTag, opts) {
    const box = { w: slot.cls.w, h: slot.cls.h };
    const c = attackHero({ x: s.x, y: s.y, w: box.w, h: box.h, strength: s.key },
                          hero, health, { invuln: opts.invuln, sfx: opts.sfx });
    s.key = c.strengthOut;
    if (s.key < 0) { this.#onKilled(slot, s, opts); return; }    // CS:0xBCEF/BCF1 — hero touch killed it

    if (grid && decodeTag) {
      const proxy = { x: s.x, y: s.y, state: s.key };
      const r = creatureScansGrid(proxy, grid, cam, decodeTag, opts.difficulty || 0,
                                   box, null, { rng: opts.rng, debris: opts.debris, sfx: opts.sfx });
      s.key = proxy.state;
      if (r.killed) this.#onKilled(slot, s, opts);
    }
  }

  /** CS:0xBCFA-0xBD09 (the shared-field kill marker + frozen death-delta
   *  capture) and CS:0xBBC1-0xBBD3 (the score award). */
  #onKilled(slot, s, opts) {
    s.attackState = -1;                                      // CS:0xBCFA — shared with the death-frame counter
    const b = this.blobBytes;
    s.deathDelta = (b && s.cursor > 0) ? b[s.cursor - 1] : 0; // CS:0xBCFF-BD02 — the last byte #move consumed
    if (opts.score) opts.score.add(scoreForKey(slot.desc.key)); // CS:0xBBCC-BBD2
  }

  #dispatch(slot, s, cam, hero, shots, lineHazards, rngNext, tock) {
    if (slot.cls.handlerB === 'bc4b') {
      this.#bc4b(slot, s, cam, hero, shots, lineHazards, rngNext);
    } else if (slot.cls.handlerA === 'attack-state') {
      this.#attackState(slot, s, cam, shots, tock);
    }
    /* 'unknown' (CS:0xBF58) and 'cut-hazard' (never placed) fire nothing —
     * see this file's header. */
  }

  /** CS:0xBC4B, fully decoded. */
  #bc4b(slot, s, cam, hero, shots, lineHazards, rngNext) {
    if (slot.desc.loNibble === 0) return;                // never fires
    s.reload -= 1;
    if (s.reload !== 0) return;                          // CS:0xBC55 `jnz` — fires only on the EXACT tick it hits 0

    const speed = (slot.desc.loNibble >> 1) + 4;           // CS:0xBC7B/0xBCA6

    if (slot.desc.hiNibble !== 0) {
      s.reload = ((0x10 - slot.desc.loNibble) * 2) & 0xff; // CS:0xBC6B `add al,al` — byte-only double
      if (lineHazards && hero) {
        /* CS:0xBC88 -> dbc6, BP not set at this call site — see the header's
         * own UNKNOWN_bc4b_line_hazard_bp. Using the BP=1 (jittered) shape,
         * the only one this project has independently confirmed anywhere. */
        lineHazards.spawnJittered(s.x + 16, s.y + 16, hero.x, hero.y, speed, rngNext);
      }
      return;
    }

    s.reload = ((0x10 - slot.desc.loNibble) * 2) & 0xffff; // CS:0xBC99 `add ax,ax` — full-word double
    const firingRight = s.x >= this.lastPretickX;           // CS:0xBCAF `cmp ax,[0x200]`
    const muzzleY = s.y + 0xc;
    if (!shots) return;
    if (firingRight) shots.fire(s.x + 0x18, muzzleY, speed, cam);
    else shots.fire(s.x + 8, muzzleY, -speed, cam);
  }

  /** CS:0xBDDB (walk/attack state machine) + CS:0xBD71 (arms it) +
   *  CS:0xBD9F (the actual fire), collapsed into one step since they only
   *  ever run together for this one class.
   *  `attackState` packs: bits 0-2 a phase counter, bit 2 (4) "in attack
   *  mode", bit 3 (8) the sticky facing flag CS:0xBD9F reads. */
  #attackState(slot, s, cam, shots, tock) {
    const inAttack = (s.attackState & 4) !== 0;

    if (!inAttack) {
      /* CS:0xBD71 — arm. Only from phase 3, only on the tock tick, only once
       * the reload has expired. */
      if (slot.desc.loNibble !== 0) {
        s.reload -= 1;
        if (s.reload < 0 && (s.attackState & 7) === 3 && tock) {
          s.reload = (0x10 - slot.desc.loNibble) * 2;
          s.attackState += 1;                              // 3 -> 4, sets bit 2
        }
      }
      return;
    }

    /* CS:0xBDDB's own attack-substate cycle. ⚠️ GATED ON TOCK, exactly like
     * CS:0xBD71's own arm above (`CS:0xBDEC JZ be02` skips the WHOLE
     * increment-fire-wraparound block on a non-tock tick, writing the phase
     * back unchanged) — first found missing when this port's own test for
     * "fires exactly on phase 6" failed, because without the gate the phase
     * advances every tick instead of every OTHER tick. Firing happens on
     * the TRANSITION that lands on 6 (current phase 5, tock fires -> 6,
     * `CS:0xBDEF CMP BP,6` tests the INCREMENTED value, not the phase the
     * call was entered with), not on a tick that merely FINDS phase===6. */
    if (!tock) return;
    const phase = s.attackState & 7;
    const next = phase + 1;
    if (next === 6 && shots) {
      const speed = (slot.desc.loNibble >> 1) + 4;
      const facingRight = (s.attackState & 8) !== 0
        ? true
        : s.x >= this.lastPretickX;                        // UNKNOWN_pat_attack_facing_setter — see header
      if (facingRight) shots.fire(s.x + 0x1b, s.y + 9, speed, cam);
      else shots.fire(s.x - 0xc, s.y + 9, -speed, cam);
    }
    s.attackState = next >= 8 ? (s.attackState & 8) : ((s.attackState & 8) | next);
  }
}
