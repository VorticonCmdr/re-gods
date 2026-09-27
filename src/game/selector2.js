/* selector2.js — the trigger-selector-2 spawn system: stationary shooting
 * turrets, spawned from PALFILS +0x0718 (`DS:0x9720`, stride 0x10, 100
 * records) into a 10-slot runtime pool (`DS:0xaec0`, stride 0x20).
 *
 * ⚠️⚠️ CORRECTION, a later session — the system is per-CLASS, not per-WORLD,
 * and `CS:0xB03C` is NOT dead code. The first pass over this system sampled
 * only the one `handlerA`/`handlerB` pair each world's shipped data happened
 * to reach through its FIRST scan (`B60E`/`B670`, or `B5E9`/`B670` for world
 * 4), and concluded — wrongly — that this was the only live pair, with
 * `B03C` (a documented sibling of `B670`) dead because `get_xrefs_to` found
 * zero direct callers. A fresh read of all four worlds' own `DS:0xdf80`
 * class tables (12 bytes/record: `{spriteBase, one, handlerA, w, h,
 * handlerB}`, confirmed by direct `read_memory`, not decompile) shows every
 * world has SEVERAL classes with DIFFERENT handler pairs, and a live-dispatch
 * census against real shipped `PALFILS` classIndex values (world1 uses
 * {0,1,2,3,5}, world2 {0,1,2,3}, world3 {3,4}, world4 {1,2,3,4,5}) shows
 * EVERY one of those extra classes is genuinely reachable. `CS:0xB03C` turns
 * out to be the MAJORITY handlerB across every world — it was invisible to
 * `get_xrefs_to` because the driver reaches it through a DATA-TABLE field
 * (`class_table[cls].handlerB`, loaded into a register and called
 * indirectly), not a direct `CALL`/`JMP` instruction. The same blind spot
 * hid two genuine writers of the "falling rock" hazard pools from an
 * "exhaustive operand search for the address" — see the correction under
 * CLAUDE.md's `UNKNOWN_b1c2` section. `HANDLER_FOR[world]` (a per-world
 * lookup) is consequently GONE from this module; every class now resolves
 * its own `handlerA`/`handlerB` off `spawn.js`'s `CLASS_TABLES_B`, the same
 * table this module already used for `spriteBase`/`w`/`h`.
 *
 * SIX distinct `handlerA`/`handlerB` families are now known, not one:
 *   - `B60E`/`B670`  — 24x24, per-world ping-pong idle, world 1/2's own
 *                       single class each + world 2's own idx3
 *   - `B5E9`/`B670`  — 24x24, world 4's own idx3, hardcoded sprite base
 *   - the shared 32x32 body (`CS:0xB725`, ten distinct entry stubs —
 *     `B70E/B718/B722/B704/B71D/B6FF/B709/B6FA/B6F5/B83D`, each loading its
 *     own hardcoded sprite base then falling into one shared animation +
 *     wall/hero-visibility facing-flip body) / `B03C`+`B017` — the MAJORITY
 *     family across every world
 *   - `B144`/`B290`  — world 2's own idx2/5/6/7, a periodic rock-drop attack
 *                       into the `DS:0xaccc` settle pool (`rockfall.js`'s
 *                       `RockSettlePool`), NOT the inert "reload-only, no
 *                       emitter" reading an earlier pass guessed
 *   - `B2C7`/`B2F3`  — world 3's own idx3, a periodic TWO-piece rock-drop
 *                       attack that ARMS AND FEEDS the `DS:0xad1c`/`0xad94`
 *                       burst-physics pool (`rockfall.js`'s `RockBurstPool`)
 *
 * This document's own selector table already named the pieces:
 *   "| 2 | 1 | 0xad06 | spawn from PALFILS +0x0718 (DS:0x9720) -> runtime
 *      DS:0xaec0 | < 100 |"
 * and "The five other emitter-pair owners" section had already traced TWO of
 * this driver's own emitter calls (CS:0xB07D/0xB08F, CS:0xB6C8/0xB6EA) without
 * yet locating the driver itself. This session reads the whole thing —
 * CS:0xAD0D-0xAD61 (the allocator) and CS:0xAD88-0xB020 (the per-tick driver,
 * self-modifying-gated at its own entry, the same trick CS:0xf5c/CS:0x8687
 * use) — end to end, and ties it to the ALREADY-PORTED shared per-world
 * class tables (`spawn.js`'s `CLASS_TABLES_B`), the shared hero-contact and
 * damage-grid scan (`combat.js`), the shared enemy-shot emitter
 * (`enemy-shots.js`), and the shared line-hazard seed (`line-hazard.js`).
 *
 * THE ENTITIES DO NOT MOVE. Both sampled `handlerA` bodies (CS:0xB60E for
 * worlds 1/2, CS:0xB5E9 for world 4) touch only the entity's own animation
 * frame (`+4`) — neither ever writes `[di]`/`[di+2]` (x/y). So this is a
 * stationary shooting-turret family, not a roaming creature: a materialise-
 * time spawn point, a small idle animation, and a periodic shot (or a
 * Bresenham line-hazard fragment) toward whichever side the class faces.
 *
 * THE CLASS DESCRIPTOR — PALFILS +0x0718, 16 bytes, verbatim from
 * CS:0xAD0D-0xAD61's own consumption order (each field's width and byte-swap
 * convention is exactly what that routine's `LODSW`/`XCHG AH,AL`/`STOSW`
 * (byte-swapped) vs `MOVSW` (RAW, unswapped) choice produces — do not
 * "clean up" a raw-copied field to native-endian, the original never does):
 *
 *   +0x00  BE u16   spawnX          world X, CONSTANT for the whole batch
 *   +0x02  BE u16   spawnY          world Y, CONSTANT for the whole batch
 *   +0x04  raw byte entityFacing    sign-extended into every entity's own
 *                                   facing field; 0 => faces left (negates
 *                                   the shared "direction" scratch and fires
 *                                   through the LEFT emitter), nonzero =>
 *                                   right
 *   +0x05  raw byte drawStyle       0..5, indexes the 6-entry SS:0x3586
 *                                   cull/dispatch table (`CULL_STYLES` below)
 *   +0x06  BE u16   staggerStep     added CUMULATIVELY across entities —
 *                                   entity 0 always staggers 0 ticks, entity
 *                                   1 by `staggerStep`, entity 2 by
 *                                   `2*staggerStep`, etc.
 *   +0x08  raw byte entityCount     1..N, the materialise loop bound
 *   +0x09  raw byte entityState0    every entity's own starting `state`
 *                                   (HP-like), AND separately re-read at
 *                                   kill time as the input to the kill-score
 *                                   formula (CS:0xAF7D, `scoreForState0`)
 *   +0x0a  BE u16   classIndex      index into the CURRENT WORLD's SYSTEM-B
 *                                   per-world class table (`DS:0x1fc`,
 *                                   `spawn.js`'s `CLASS_TABLES_B[world]`) —
 *                                   supplies spriteBase/w/h AND (per a later
 *                                   session's correction) handlerA/handlerB,
 *                                   now transcribed there too, per-CLASS
 *   +0x0c  raw byte facingSelect    nonzero => this class fires via the
 *                                   Bresenham line-hazard seed instead of an
 *                                   ordinary shot (CS:0xB699 `jnz 0xb63f`)
 *   +0x0d  raw byte reloadByte      the fire-rate divisor: reload timer =
 *                                   `(16 - reloadByte) << 2` ticks, and (for
 *                                   the ordinary-shot branch) shot speed =
 *                                   `(reloadByte >> 2) + 4`
 *   +0x0e  raw byte rewardItemId    the GROUP-elimination reward's popup id
 *                                   (CS:0xBF5F's own id encoding: `< 0xB` a
 *                                   plain numeric popup, `>= 0xB` a
 *                                   `POBJECTS` type `id-0xB`) — ⚠️ CORRECTS
 *                                   CLAUDE.md's own prior close of this
 *                                   field, see the note below
 *   +0x0f  —                       unconsumed by CS:0xAD0D-0xAD61 (15 of 16
 *                                   bytes read; the same "one trailing
 *                                   padding byte" shape this project already
 *                                   documents for other PALFILS records)
 *
 * ⚠️ CORRECTION TO CLAUDE.md's OWN "UNKNOWN_bf5f_special_sprite_callers"
 * CLOSURE. That section says of the selector-2 elimination reward: "But
 * `[si+0x1e]` is never set to anything meaningful... not in the allocator
 * CS:0xAD0D–0xAD61 (which copies the class's +0xC/+0xD/+0x11/+0x13 bytes
 * into other runtime offsets... but never into +0x1E)". A fresh,
 * instruction-by-instruction re-read of that exact allocator this session
 * shows otherwise: tracking `DI` through every `STOSW`/`MOVSW` from its
 * `ADD DI,0x6` entry (`CS:0xAD2C`) to its `RET` (`CS:0xAD61`) lands the
 * allocator's OWN closing `LODSB`/`STOSB` pair (`CS:0xAD49`/`CS:0xAD60`)
 * exactly on slot `+0x1E`, writing PALFILS class byte `+0xE` (the 15th byte
 * of the 16-byte record) there — verbatim, unswapped. So the reward id DOES
 * have a real writer, and the elimination-reward mechanism this project's
 * `UNKNOWN_f030_item_drop`-family closures already document for other
 * systems is, for THIS system, genuinely live rather than "wired but always
 * zero". `parseClasses` below reads it as `rewardItemId`.
 *
 * THE RUNTIME SLOT (`DS:0xaec0`, 10 x 0x20 bytes) — only the fields this
 * port actually needs are modelled as object properties; the original's own
 * byte offsets are cited per-field below rather than reproduced as a literal
 * byte array, matching every other module in this project.
 *
 * THE PER-TICK DRIVER, CS:0xAD88, exactly as disassembled:
 *   - Not-yet-materialised slot (`bit1` set, `bit0` clear): spawn
 *     `entityCount` entities at the SAME point, apply the cumulative
 *     stagger, seed the reload timer, mark `bit0` (fully materialised).
 *     CS:0xADCF's own one-shot "spawn flash" call on entity 0
 *     (`CALL 0x1000:b095`, into the ALREADY-DOCUMENTED `DS:0xac90` pool
 *     System-A's own `CS:0xFF59` also uses) is DELIBERATELY NOT PORTED —
 *     matching this project's existing precedent (`entity.js`'s own header:
 *     "The materialise effect itself (CS:0xff59) is not ported") — it is
 *     purely decorative and this port has no consumer for that pool yet.
 *   - Materialised slot: per entity, dispatch on `state`:
 *       state === 0            -> already fully dead, count it, skip
 *       state < 0               -> DYING: an 8-tick fade (frames 0..6 drawn,
 *                                   frame 7 finalises to state 0), caching
 *                                   the entity's own world position into the
 *                                   slot's own "last dying position" the
 *                                   FIRST tick of the fade (CS:0xAFC1-AFD0)
 *       state > 0 (ALIVE)       -> handlerB (fire, unless frozen), handlerA
 *                                   (animate, unconditional), a cull check
 *                                   (drawStyle-selected), then the SHARED
 *                                   hero-contact-and-damage-grid-scan
 *                                   (combat.js), a kill score on death, draw
 *     Once every entity in the batch reaches `state === 0` (by kill OR by
 *     scrolling off-screen), the slot fires its ONE group-elimination
 *     reward and deactivates.
 *
 * WHAT THIS PORT DOES NOT MODEL:
 *   - The one-shot "spawn flash" visual (see above — matches existing
 *     project precedent for the identical DS:0xac90 pool elsewhere).
 *   - ⚠️ CORRECTION: the popup-rendering gap above is CLOSED. `popup.js`
 *     exists, and `main.js` drains this slot's own `rewards` array into it
 *     every tick (`popup.spawn(r.x, r.y, id, level.drawObjects)`), the same
 *     single popup slot the world-2 nest's and System-A/B's own group-
 *     elimination rewards share. `statue.js`'s cross-reference to this note
 *     is stale for the same reason — check it before trusting it too.
 *   - ⚠️⚠️ CORRECTION, a later session — THE ENTITIES DO MOVE, and this bullet
 *     was wrong about both the mechanism and the stakes. An advisor review
 *     flagged this claim as SAMPLED: it names only `handlerA_b60e`/
 *     `handlerA_b5e9` as read for x/y writes, never the 32x32 shared body —
 *     the MAJORITY family across every world, including world 1's own
 *     classIndex 2/3, spawned within a few hundred px of the world-1 hero
 *     spawn point. A fresh `disassemble_bytes` of `CS:0xB725`-`0xB800`
 *     settles it: "no `[di+0]`/`[di+2]` write anywhere in the shared body"
 *     is technically true (the body itself never writes those fields) but
 *     misses that its CALLER (`FUN_1000_ad88`, decompiled: `*puVar11 =
 *     uVar5; puVar11[1] = uVar9;`) commits the body's own RETURN VALUE (AX)
 *     into the entity's X field every tock!=0 tick, while Y is explicitly
 *     restored from a value saved before the handler call — the same
 *     "trust the summary, not the bytes" trap this file's own `facing*9`
 *     fix (see `stepAnim8`'s header) already caught once in this exact
 *     function. See `handlerA_32x32`'s own header for the full mechanism
 *     (a 4px pace per tock tick, turning at walls/ledges) and what remains
 *     unported (a second, `facingSelect`-gated hero-column flip whose exit
 *     loop was not confidently resolved from the bytes).
 *   ~~The `RockBurstPool`'s own ground-probe-based landing and its
 *   recursive 3-piece SHATTER on landing~~ — CLOSED, a later pass. Both
 *   pools' ground-probe/landing bodies were read in full and `DS:0xdf5c`'s
 *   own 3-entry `{vx,vy}` shatter table read live; `step()` now threads
 *   `opts.planeB` into both `rockSettle.step`/`rockBurst.step`. See
 *   `rockfall.js`'s own header for the full trace, including a genuine
 *   settle-pool tock-polarity bug this same pass found and fixed.
 */

import { CLASS_TABLES_B } from './spawn.js';
import { SFX_MATERIALISE } from './entity.js';
import { attackHero, creatureScansGrid } from './combat.js';
import { RockSettlePool, RockBurstPool } from './rockfall.js';

export const CLASS_OFF = 0x0718;      // -> DS:0x9720
export const CLASS_STRIDE = 0x10;
export const CLASS_COUNT = 100;
export const RUNTIME_SLOTS = 10;      // DS:0xaec0, stride 0x20
export const ENTITY_STRIDE = 0xe;     // CS:0xADF8 `add di,0xe`

/** Parse the 100 selector-2 class descriptors out of a decompressed PALFILS.
 *  See the file header for the exact field-by-field CS:0xAD0D-0xAD61 trace. */
export function parseClasses(buf) {
  const out = [];
  for (let i = 0; i < CLASS_COUNT; i++) {
    const o = CLASS_OFF + i * CLASS_STRIDE;
    const b = buf.subarray(o, o + CLASS_STRIDE);
    out.push({
      index: i,
      spawnX: (b[0x00] << 8) | b[0x01],
      spawnY: (b[0x02] << 8) | b[0x03],
      entityFacing: signByte(b[0x04]),
      drawStyle: b[0x05],
      staggerStep: (b[0x06] << 8) | b[0x07],
      entityCount: b[0x08],
      entityState0: b[0x09],
      classIndex: (b[0x0a] << 8) | b[0x0b],
      facingSelect: b[0x0c],
      reloadByte: b[0x0d],
      rewardItemId: b[0x0e],
      live: b[0x08] !== 0,
    });
  }
  return out;
}

const signByte = (v) => (v & 0x80 ? v - 0x100 : v);

/**
 * CS:0x8EF9 / CS:0x8F16 — `DS:0x1a2`, a 4-word ping-pong sprite table
 * populated ONCE at level-init, hardcoded per WORLD (not per class):
 *   world 1: {0x214, 0x215, 0x216, 0x215}  ->  base, base+1, base+2, base+1
 *   world 2: {0x20d, 0x20e, 0x20f, 0x20e}  ->  base, base+1, base+2, base+1
 * the SAME 3-unique-frame ping-pong idiom this project documents everywhere
 * else for idle animations. It is a single, WORLD-LEVEL shared table, not a
 * per-class one — reproduced here as a literal per-world constant (matching
 * the original's own two hardcoded `MOV word[0x1a2],imm` sites) rather than
 * derived generically from `CLASS_TABLES_B`, so that if a world ever had two
 * different-spriteBase classes both routed through `handlerA:'b60e'` this
 * port reproduces the ORIGINAL's own single-shared-table limitation rather
 * than silently "fixing" it. World 4 does not populate this table at all
 * (CS:0x8EF2's own world===1/2 gate) — consistent with world 4's class using
 * the different, non-table `b5e9` handler instead.
 */
const PING_PONG_BASE = Object.freeze({ 1: 0x214, 2: 0x20d });

/** CS:0xB60E's own `[frame]` index into the world's ping-pong table. */
const PING_PONG_OFFSET = Object.freeze([0, 1, 2, 1]);

/**
 * CS:0xB60E — worlds 1/2's handlerA. Returns the sprite id; DOES NOT touch
 * x/y. `+3` when `entityFacing === 0` — a facing offset, not a table index,
 * matching this project's own "+3 facing offset" convention used everywhere
 * else for a left-facing default variant.
 *
 * ⚠️ THE FRAME-ADVANCE GATE, READ VERBATIM (CS:0xB625-B63E), IS NOT
 * SYMMETRIC and does NOT involve any tock toggle at all — an earlier draft
 * of this port wrongly copied B5E9's own tock gate onto this function; there
 * is no `[0x36d]` read anywhere in B60E's own body:
 *   frame != 0  -> ALWAYS advances, unconditionally (`JNZ 0xb637` skips
 *                  straight to the increment)
 *   frame == 0  -> advances ONLY when `slot.reloadByte !== 0` AND the
 *                  entity's own reload timer reads exactly 1 this tick —
 *                  i.e. only a class that fires can ever leave frame 0, and
 *                  only on the specific tick its next shot is about to seed
 */
function handlerA_b60e(entity, world, slot) {
  const table = PING_PONG_BASE[world];
  const sprite = (table !== undefined ? table + PING_PONG_OFFSET[entity.frame & 3]
                                       : 0) + (entity.facing === 0 ? 3 : 0);
  if (entity.frame !== 0) {
    entity.frame = (entity.frame + 1) & 3;                                    // CS:0xB629/B637
  } else if (slot.reloadByte !== 0 && entity.reloadTimer === 1) {
    entity.frame = (entity.frame + 1) & 3;                                    // CS:0xB62B/0xB637
  }
  return sprite;
}

/**
 * CS:0xB5E9 — world 4's own handlerA. Sprite base 0x223 is HARDCODED in this
 * routine (not read from the class table), matching the byte verbatim —
 * reproduced as a literal here rather than substituted with
 * `CLASS_TABLES_B[4][cls].base` (which happens to equal it for the one
 * sampled class, but the original genuinely hardcodes the constant).
 *
 * ⚠️ THE FRAME-ADVANCE GATE IS THE OPPOSITE SHAPE FROM B60E's — an earlier
 * draft of this port had it backwards. Read verbatim (CS:0xB5F9-B60D):
 *   frame == 0  -> NEVER advances (`JZ 0xb60d` returns immediately) — this
 *                  handler alone can never move the entity off frame 0
 *   frame != 0  -> advances only on the tick `tock` (`DS:0x36d`, a SEPARATE
 *                  toggle from the game's usual `DS:0x36c`) reads 0
 * The ONLY way this entity's frame ever becomes nonzero at all is
 * `stepHandlerB`'s own world-4-only kick on every shot fired
 * (`CS:0xB682 INC byte[di+4]`) — so world 4's turret sits frozen at frame 0
 * between shots and plays a short, tock-paced wind-down after each one.
 */
function handlerA_b5e9(entity, tock) {
  const sprite = 0x223 + entity.frame + (entity.facing === 0 ? 4 : 0);
  if (entity.frame !== 0 && tock === 0) entity.frame = (entity.frame + 1) & 3;   // CS:0xB5FF/0xB606
  return sprite;
}

/**
 * CS:0xB670 — the shared `handlerB` (fire). Fire-rate-gated on `reloadByte`,
 * reseeds the reload timer to `(16-reloadByte)<<2` on every fire (the SAME
 * formula used at materialise time), then dispatches on `facingSelect`:
 * nonzero -> a Bresenham line-hazard fragment (CS:0xB63F -> CS:0xdbc6,
 * `BP:=1`, matching `line-hazard.js`'s own `spawnJittered`); zero -> an
 * ordinary shot through the shared emitter (`enemy-shots.js`'s `fire()`,
 * which already picks the correct emitter/cull side from the sign of `vx`).
 * @returns {?{kind:'shot', worldX, worldY, vx}|{kind:'hazard', worldX,
 *   worldY, n}} what to spawn this tick, or null when nothing fired.
 */
export function stepHandlerB(entity, slot, world) {
  if (slot.reloadByte === 0) return null;             // CS:0xB670-B674
  entity.reloadTimer -= 1;                             // CS:0xB676
  if (entity.reloadTimer !== 0) return null;           // CS:0xB679
  if (world === 4) entity.frame = (entity.frame + 1) & 3;   // CS:0xB682, world-4 extra kick
  entity.reloadTimer = (16 - slot.reloadByte) << 2;    // CS:0xB687-B692, RESEED

  const facingRight = entity.facing !== 0;             // CS:0xB6A7/B6AB
  if (slot.facingSelect !== 0) {                       // CS:0xB695/B699 -> B63F -> dbc6
    /* CS:0xB63F's OWN muzzle, read verbatim — its polarity is the OPPOSITE
     * of the ordinary-shot muzzle below (facing===0 gets the LARGER offset
     * here; facing!=0 gets it there). The Bresenham line-hazard is a ray
     * toward the hero, not a left/right shot, so there is no reason to
     * expect the two conventions to match, and they do not: `entity+0xa==0`
     * -> keep `ax:=x+0x16`; `!=0` -> `ax -= 0x1c` (net `x-6`). `bx:=y+0xd`
     * always, no world-4 adjustment on this path.
     *
     * ⚠️ `n` (the seed's own step count, DS:0x1f0) is computed by THIS
     * caller, not read off any fixed constant: CS:0xB654-B65E
     * `n = (reloadByte >> 1) + 2` — confirmed by reading CS:0xDBE8
     * (`MOV BP,word[0x1f0] / MOV word[SI+0x12],BP`), the seed's own write of
     * that value into the newly-claimed line-hazard slot's `n` field.
     *
     * ⚠️ Also confirmed by reading CS:0xDBC6 itself: its target is a bare,
     * UNJITTERED `heroX+8, heroY+6` (`MOV CX,[0x17a] / ADD CX,8`) — the
     * caller's own `BP:=1` (CS:0xB664) is DEAD for this call, since
     * CS:0xDBD4 overwrites BP unconditionally before ever reading it. So
     * this does NOT match `line-hazard.js`'s own `spawnJittered` (which
     * jitters the target) — closer to `spawnAtHero`'s OWN target formula,
     * but that helper ALSO adds its own fixed muzzle offset to the source
     * X, which would double up with the muzzle math already done here. Use
     * the low-level `LineHazards.spawn(sourceX, sourceY, targetX, targetY,
     * n)` primitive directly, not either pre-built helper. */
    const mx = entity.x + 0x16 - (facingRight ? 0x1c : 0);
    const my = entity.y + 0xd;
    const n = (slot.reloadByte >> 1) + 2;
    return { kind: 'hazard', worldX: mx, worldY: my, n };
  }

  /* CS:0xB69B-B6A4: vx magnitude = (reloadByte>>2)+4, negated when facing
   * left. The muzzle offsets are NOT symmetric between the two directions —
   * read each branch's own bytes rather than mirroring one into the other
   * (CS:0xB6B3-B6C8 left; CS:0xB6CE-B6E9 right, whose own world-4 case is a
   * FALL-THROUGH add on top of the non-world-4 add, not a replacement). */
  const vx = ((slot.reloadByte >> 2) + 4) * (facingRight ? 1 : -1);
  const world4 = world === 4;
  let mx, my;
  if (!facingRight) {                                   // CS:0xB6B3-B6C8
    mx = entity.x + 0xa;
    my = entity.y + 0xc - (world4 ? 4 : 0);
  } else {                                               // CS:0xB6CE-B6E9
    mx = entity.x + (world4 ? 0x12 : 0xe);
    my = entity.y + (world4 ? 8 : 0xc);
  }
  return { kind: 'shot', worldX: mx, worldY: my, vx };
}

/**
 * CS:0xB03C/0xB017 — the MAJORITY handlerB family across every world (see
 * the file header's correction). Structurally parallel to `stepHandlerB`
 * (`B670`) — same fire-gate/reseed shape, same `facingSelect` divert to a
 * Bresenham line-hazard — but with its OWN muzzle constants and no world-4
 * special case anywhere in either branch.
 */
export function stepHandlerB03C(entity, slot, world) {
  if (slot.reloadByte === 0) return null;             // CS:0xB03C-B040
  entity.reloadTimer -= 1;                             // CS:0xB042
  if (entity.reloadTimer !== 0) return null;           // CS:0xB045
  entity.reloadTimer = (16 - slot.reloadByte) << 2;    // CS:0xB04B-B056, RESEED (no world-4 kick)

  const facingRight = entity.facing !== 0;
  if (slot.facingSelect !== 0) {
    /* CS:0xB017's own muzzle, `x+0x10, y+0` — no facing dependence at all,
     * unlike B63F's own hazard-branch muzzle. */
    const n = (slot.reloadByte >> 1) + 2;              // CS:0xB017-B021, the SAME formula as B63F
    return { kind: 'hazard', worldX: entity.x + 0x10, worldY: entity.y, n };
  }

  const vx = ((slot.reloadByte >> 2) + 4) * (facingRight ? 1 : -1);
  /* CS:0xB07D (left, via CS:0x1FE7) / CS:0xB08F (right, via CS:0x2039).
   * Muzzle Y is always +0 — neither branch touches Y at all, unlike B670's
   * own `+0xc`/`+0xd` offsets. */
  const mx = entity.x + (facingRight ? 0x20 : -8);
  return { kind: 'shot', worldX: mx, worldY: entity.y, vx };
}

/**
 * The shared 32x32 `handlerA` body, `CS:0xB725`-`0xB7FE`. Ten distinct entry
 * stubs (`B70E/B718/B722/B704/B71D/B6FF/B709/B6FA/B6F5/B83D`) each load their
 * own hardcoded sprite base (already captured as `slot.spriteBase`, per
 * `CLASS_TABLES_B`) then jump into this ONE shared body. An 8-frame,
 * tock-gated (`DS:0x36c`) animation cycle; sprite = `spriteBase + frame +
 * facing*9` (`CS:0xB796`'s own shared tail — see `handlerA_32x32`'s own
 * header for the fresh byte-level trace; an earlier pass of this file said
 * `facing*8`, which is wrong by one). See the file header for what this
 * does NOT model (the wall/hero-visibility facing flip) — confirmed by
 * reading the entire body that no x/y write exists anywhere in it.
 */
function handlerA_32x32(entity, slot) {
  /* ⚠️ `entity.facing * 9`, NOT `facing !== 0 ? 9 : 0` — CS:0xB79A/B7A2 add
   * the RAW word twice (`CX += DX` then `CX += DX<<3`), not a boolean. This
   * matters because `entity.facing` is `entityFacing` verbatim (sign-
   * extended from the class descriptor's own raw `+0x04` byte, `checks.js`'s
   * own (a)-section proves a 0xFF byte parses to `-1`) with no runtime
   * normalisation — `stepPace32x32`'s own `XOR facing,1` (the ported wall-
   * flip) only ever produces 0/1, but a class whose seeded `entityFacing`
   * itself starts outside {0,1} would render outside its own 18-slot range
   * until the first flip corrects it, exactly matching the original's own
   * uncorrected behaviour (nothing in `CS:0xB744`-`B7FE` normalises the
   * seeded byte either). Writing the boolean form would be byte-exact only
   * for classes whose descriptor `+0x04` happens to be exactly 0 or 1. */
  return slot.spriteBase + entity.frame + entity.facing * 9;
}

/** `((x & 0xFFE0) >> 5) + ((y & 0xFFF0) >> 4) * 128` — the same normalised
 *  (no `0x5004` base) plane-B index every other module in this project uses;
 *  see `entity.js`'s own `cellIndex`, not duplicated here as an import to
 *  keep this module's own dependency list unchanged. */
const cellIndexXY = (x, y) => ((x & 0xffe0) >> 5) + ((y & 0xfff0) >> 4) * 128;

/**
 * CS:0xB744-B7EB — the 32x32 shared body's own PACE-AND-TURN step, run once
 * per tock!=0 tick (the SAME gate `stepAnim8` uses, `CS:0xB736/B73B`),
 * BEFORE the sprite formula above. See `handlerA_32x32`'s own header for why
 * this exists — an advisor-flagged correction to this file's own prior
 * "these are genuinely stationary" claim.
 *
 * The step (`CS:0xB74A`-`B771` facing==0 / `CS:0xB773`-`B794` facing!=0) is
 * UNCONDITIONAL: `entity.x` moves 4px in the current facing direction every
 * qualifying tick, committed by the ORIGINAL's own caller regardless of
 * whether the wall probe below even runs. Only the PROBE is gated, on
 * `(newX & 0x1f) === 0` — i.e. one in every 8 steps, the tick the new X
 * lands on a tile boundary.
 *
 * The probe (`CS:0xB757`-`B768` left / `CS:0xB780`-`B78D` right) is the
 * IDENTICAL 3-cell, one-column-over shape this project already documents
 * for the hero's own left-wall probe (`entity.js`'s header on
 * `groundUnderCell`'s sibling, and `player.js`'s own `[si-1]/[si+0x7f]/
 * [si+0xff]`): the column ONE TILE FURTHER in the facing direction, at the
 * entity's own 3-row height. Flip (`XOR [di+0xa],1`, `CS:0xB76D`) when
 * EITHER of the top two rows is solid, OR the bottom row is NOT solid (an
 * open ledge ahead) — a combined wall-ahead / floor-ahead check, not a
 * uniform "any solid blocks" rule.
 *
 * NOT PORTED: a second, `facingSelect`-gated flip toward the hero's own
 * tile column (`CS:0xB7A9`-`B834`), reached only when the wall/ledge probe
 * above does not already flip. Its own exit condition repeatedly decrements
 * the entry-time SLOT pointer and compares it against a freshly computed
 * plane-B pointer (`CS:0xB7C7`-`B7D0`, looped at `CS:0xB7E3`) — two operands
 * in memory regions too far apart (`~0x5004+` vs `~0xaec0+`) to plausibly
 * become equal by single-byte decrements in any bounded iteration count.
 * Read fresh, twice, and still not confidently resolved — flagged rather
 * than guessed. Omitting it means a `facingSelect` class paces and turns at
 * walls/ledges correctly but never additionally turns to face the hero.
 */
export function stepPace32x32(entity, tock, planeB) {
  if (tock === 0) return;                                         // CS:0xB736/B73B — the shared tock gate
  const dir = entity.facing === 0 ? -1 : 1;                       // CS:0xB744 facing==0 -> LEFT
  const newX = entity.x + dir * 4;                                // CS:0xB74A/B773 — always committed
  if (planeB && (newX & 0x1f) === 0) {                            // CS:0xB74F/B778 — probe once per 8 steps
    const base = cellIndexXY(newX, entity.y);
    let flip;
    if (dir < 0) {                                                // CS:0xB757-B768, LEFT: column base-1
      const si = base - 1;
      flip = planeB[si] === 1 || planeB[si + 0x80] === 1 || planeB[si + 0x100] !== 1;
    } else {                                                       // CS:0xB780-B78D, RIGHT: column base+1
      const si = base + 1;
      flip = planeB[si] === 1 || planeB[si + 0x80] === 1 || planeB[si + 0x100] !== 1;
    }
    if (flip) entity.facing ^= 1;                                 // CS:0xB76D
  }
  entity.x = newX;                                                // committed unconditionally either way
}

/**
 * ⚠️⚠️ CORRECTION, a later session — this function had TWO bugs, caught by
 * a fresh advisor review and confirmed against a fresh `disassemble_bytes`
 * of `CS:0xB725`-`0xB7A6` (not merely re-read from memory of the earlier
 * disassembly):
 *   1. This function's own caller passed only `entity`, never `slot` — so
 *      `entity.spriteBase` (a field that has never existed; spriteBase lives
 *      on the SLOT, per `handlerA_b144`/`handlerA_b2c7`'s own `slot.spriteBase`
 *      convention) was `undefined`, and every 32x32 class — the MAJORITY
 *      family across every world, per the file header — drew sprite `NaN`.
 *      No test caught it because (d)/(d2)/(f)/(g)/(i)/(j) never drive a
 *      '32x32' class through the pool itself, only through table-content
 *      assertions or other families.
 *   2. The facing term is `*9`, not `*8`. `CS:0xB797-B7A4`, read fresh:
 *      `DX := [DI+0xa]` (facing) / `CX += DX` (facing added ONCE, before any
 *      shift) / `DX <<= 1` x3 (`DX := facing*8`) / `CX += DX` / `CX += BP`
 *      (spriteBase). Net: `spriteBase + frame + facing + facing*8 =
 *      spriteBase + frame + facing*9`. CLAUDE.md's own prose ("sprite =
 *      class_base + frame + facing*8") carried the same off-by-one and has
 *      been corrected alongside this fix.
 */
function stepAnim8(entity, tock) {
  /* ⚠️⚠️ CORRECTION — the gate polarity was backwards. Fresh
   * `disassemble_bytes` of `CS:0xB736-B744`: `CMP byte[0x36c],0 / JZ 0xb796`
   * — the increment block (`INC CX / AND CX,7 / MOV [DI+4],CX`) is SKIPPED
   * when the byte is 0 and runs only when it is NONZERO, the identical
   * byte-verified shape `statue.js` already documents for its own,
   * independent `CS:0x7C4B` read (`tock===1` is the byte-verified polarity
   * for a `cmp byte[0x36c],0/jz<skip>` shape; `nest.js`'s own `tock===0` is a
   * DIFFERENT, independently-correct site — polarity is per-instruction, not
   * global, exactly as `statue.js`'s own header already warns). An earlier
   * draft of this port used `tock === 0`, inverting which of every pair of
   * ticks this 8-frame cycle actually advances on.
   *
   * NOT MODELLED: `CS:0xB729-B734`'s own overflow guard (`frame > 7` ->
   * force `CX:=8` for the sprite calc and decrement the STORED byte back to
   * 7). `entity.frame` here can never exceed 7 — `AND CX,7` on every
   * advance and a materialise-time seed of 0 both keep it in `[0,7]` — so
   * this branch is provably unreachable from this port's own state machine,
   * flagged rather than silently dropped. */
  if (tock !== 0) entity.frame = (entity.frame + 1) & 7;   // CS:0xB725-B73E
}

/**
 * CS:0xB144 — world 2's own idx2/5/6/7 `handlerA`. An 8-tick-total, 4-frame
 * (0..3) tock-gated animation, but frame 0 is FROZEN — it can only ever
 * leave 0 via `stepHandlerRockDrop`'s own frame-kick (CS:0xB152/0xB156's
 * `JZ` returns immediately when `frame===0`, exactly like `handlerA_b5e9`).
 * At the tick frame reaches EXACTLY 3, this signals a rock-drop (returned to
 * the caller as `{drop:true}` rather than reached into `rockfall.js`
 * directly, keeping this module's own layering: `SelectorTwoSpawns` owns
 * the pool references).
 */
function handlerA_b144(entity, slot, tock) {
  const sprite = slot.spriteBase + entity.frame;                      // CS:0xB144-B147
  let drop = false;
  if (tock === 0 && entity.frame !== 0) {                              // CS:0xB14B/B152
    entity.frame += 1;                                                 // CS:0xB158
    if (entity.frame === 3) drop = true;                                // CS:0xB161
    else if (entity.frame > 3) entity.frame = 0;                        // CS:0xB163
  }
  return { sprite, drop };
}

/**
 * CS:0xB2C7 — world 3's own idx3 `handlerA`. Structurally identical gate to
 * `B144` above, but the sprite comes from a LOOKUP TABLE (`DS:0xdf4c`, read
 * live: `{base, base+1, base+2, base+1}` where `base` equals this class's
 * own `spriteBase` — the SAME 3-unique-frame ping-pong idiom this project
 * documents everywhere else, just data-driven instead of arithmetic).
 */
function handlerA_b2c7(entity, slot, tock) {
  const sprite = slot.spriteBase + [0, 1, 2, 1][entity.frame];        // CS:0xB2C7-B2D2, DS:0xdf4c
  let drop = false;
  if (tock === 0 && entity.frame !== 0) {                              // CS:0xB2D5/B2DC
    entity.frame += 1;                                                 // CS:0xB2E2
    if (entity.frame === 3) drop = true;                                // CS:0xB2EB
    else if (entity.frame > 3) entity.frame = 0;                        // CS:0xB2ED
  }
  return { sprite, drop };
}

/**
 * CS:0xB290 (world 2) / CS:0xB2F3 (world 3) — BYTE-IDENTICAL reload-gated
 * "kick the animation" triggers, the actual attack mechanism behind
 * `B144`/`B2C7`'s own frame-3 drop signal. On reload expiry: kick
 * `entity.frame := 1` (the only way frame ever leaves its 0-frozen start)
 * and reseed the timer with the same `(16-reloadByte)<<2` formula every
 * other reload trigger in this system uses.
 */
function stepHandlerRockDrop(entity, slot) {
  if (slot.reloadByte === 0) return;                   // CS:0xB290-B294 / B2F3-B2F7
  entity.reloadTimer -= 1;                              // CS:0xB296 / B2F9
  if (entity.reloadTimer !== 0) return;                 // CS:0xB299 / B2FC
  entity.frame = 1;                                     // CS:0xB29B / B2FE
  entity.reloadTimer = (16 - slot.reloadByte) << 2;     // CS:0xB2A0-B2AA / B303-B30D
}

/* CS:0xDF54 — the 2-entry `{vx,vy}` velocity table world 3's own rock-drop
 * seeds its two-piece burst from, read live. */
const BURST_ROCK_VELOCITIES = Object.freeze([{ vx: 4, vy: 4 }, { vx: -4, vy: 4 }]);

/**
 * CS:0xB63F/0x93A8-family kill-score. `V` is `slot.entityState0` (the SAME
 * byte that seeded the entity's own starting HP). Reproduces CS:0xAF7D
 * exactly for the COMMON case: `score = (((V>>1)+1)) * 100`.
 * ⚠️ NOT MODELLED: the overflow branch CS:0xAF8E-AFB1 takes when
 * `(V>>1)+1 > 9` after the base-10 split (i.e. `V > 178`ish), which issues a
 * SECOND `CALL 0x1000:0c8b` at a higher BCD digit position. Every sampled
 * class's own `entityState0` byte was not read from shipped level data this
 * pass (PALFILS is runtime-loaded asset data, not present in the static
 * EXE image), so whether shipped data ever reaches that branch is not
 * established — flagged rather than guessed, matching this project's own
 * convention for a narrow, possibly-unreachable edge case.
 */
export function scoreForState0(v) {
  return ((v >> 1) + 1) * 100;
}

/** CS:0xAA36/0xAA6F-style edge culls, SS:0x3586's own 6-entry table, decoded
 *  fresh this session (see the file header). Index 0/1 never cull; 2/3/4/5
 *  each test exactly ONE screen edge and fall through to the shared body
 *  when in bounds — NOT a 4-way box. */
export function culled(drawStyle, sx, sy) {
  switch (drawStyle) {
    case 2: return sx < -0x70;    // CS:0xAF27, left
    case 3: return sx > 0x190;    // CS:0xAF3A, right
    case 4: return sy < -0x48;    // CS:0xAF4D, top
    case 5: return sy > 0xe8;     // CS:0xAF60, bottom
    default: return false;        // 0, 1 — no cull check at all
  }
}

export const DEATH_FRAMES = 7;             // CS:0xAFD7 `cmp di+4,7`
export const DEATH_SPRITE_BASE = 0x6c;     // the universal death-burst base

/**
 * The selector-2 spawn pool: 10 runtime slots, each a materialised (or
 * pending) batch of stationary shooting entities. Imports combat.js
 * directly (the ce64.js/nest.js "injection pattern" note applies the same
 * way here — this creature is architecturally closer to ce64's simple
 * contact-and-scan shape than to statue.js/nest.js's callback shape).
 */
export class SelectorTwoSpawns {
  constructor() {
    this.slots = Array.from({ length: RUNTIME_SLOTS }, () => null);
    this.refused = 0;         // CS:0xAD2B — allocator found no free slot
    this.killed = 0;
    this.eliminated = 0;      // group-elimination-reward events fired
    this.rewards = [];        // {itemType|null, popupValue|null, x, y} — see the header note
    /* World 2's B144/B290 and world 3's B2C7/B2F3 both feed these — see the
     * file header's correction and `rockfall.js`'s own header. Owned here
     * (not injected) matching this class's own "imports combat.js directly"
     * convention rather than nest.js/statue.js's callback-injection shape. */
    this.rockSettle = new RockSettlePool();
    this.rockBurst = new RockBurstPool();
  }

  get live() {
    return this.slots.reduce((n, s) => n + (s ? s.entities.filter((e) => e.state !== 0).length : 0), 0);
  }

  /** CS:0xAD0D-0xAD61. `world` selects the class-table lookup (`DS:0x1fc`). */
  spawn(classDesc, world) {
    const free = this.slots.findIndex((s) => s === null);
    if (free < 0) { this.refused++; return false; }
    const rec = CLASS_TABLES_B[world]?.[classDesc.classIndex];
    if (!rec) return false;                 // class index past the table's own terminator
    this.slots[free] = {
      desc: classDesc, world,
      spriteBase: rec.base, w: rec.w, h: rec.h,
      handlerA: rec.handlerA, handlerB: rec.handlerB,
      reloadByte: classDesc.reloadByte,
      facingSelect: classDesc.facingSelect,
      rewardItemId: classDesc.rewardItemId,
      lastDyingX: null, lastDyingY: null,
      materialised: false,
      entities: [],
    };
    return true;
  }

  clear() {
    this.slots.fill(null);
    this.rockSettle.clear();
    this.rockBurst.clear();
    return this;
  }

  /**
   * One tick. `fire(worldX,worldY,vx,cam)` is `enemy-shots.js`'s
   * `EnemyShots.fire`. `spawnHazard(worldX,worldY,n,cam)` should call
   * `line-hazard.js`'s `LineHazards.spawn(worldX, worldY, hero.x+8,
   * hero.y+6, n)` directly (NOT `spawnJittered`/`spawnAtHero` — see
   * `stepHandlerB`'s own header for why neither pre-built helper matches
   * CS:0xDBC6's exact, unjittered target and already-computed muzzle).
   * @param {{invuln?:boolean, score?:{add:(n:number)=>void}, debris?:object,
   *   planeB?:Uint8Array}} [opts] `opts.planeB` feeds `stepPace32x32`'s own
   *   wall/ledge probe (CS:0xB744-B7EB) — omit it and the 32x32 family still
   *   paces (X always commits), it just never turns around.
   */
  step(cam, hero, freezeTimer, health, grid, decodeTag, tock, fire, spawnHazard, opts = {}) {
    const drawn = [];
    for (const slot of this.slots) {
      if (!slot) continue;
      if (!slot.materialised) { this.#materialise(slot, opts); continue; }

      let deadCount = 0, dyingCount = 0;
      for (const e of slot.entities) {
        if (e.state === 0) { deadCount++; continue; }
        if (e.state < 0) {
          dyingCount++;
          this.#stepDying(slot, e, cam, drawn);
          continue;
        }
        this.#stepAlive(slot, e, cam, hero, freezeTimer, health, grid, decodeTag, tock, fire, spawnHazard, drawn, opts);
        if (e.state === 0) deadCount++;         // culled this same tick
        else if (e.state < 0) dyingCount++;      // killed this same tick — draws via the ALIVE path once more
      }

      if (deadCount + dyingCount >= slot.entities.length) {
        this.#maybeAwardElimination(slot);
        if (deadCount >= slot.entities.length) { this.slots[this.slots.indexOf(slot)] = null; }
      }
    }
    /* ⚠️ CLOSED, this pass: `CS:0x022D-0x0233` (`b1c2`/`b3ce`/`b4e7`, all
     * three) sit behind `cmp byte[0x34],0 / jnz 0x23c` — the scripted-
     * cutscene engine — NOT `DS:0x2fa` "freezes aliens" as this comment
     * used to guess. Stepped unconditionally here regardless, since this
     * port has no model of `DS:0x34`'s cutscene engine at all. */
    this.rockSettle.step(cam, tock, drawn, opts.planeB, hero, health, { invuln: opts.invuln }, opts.debris);
    this.rockBurst.step(cam, hero, health, tock, { invuln: opts.invuln }, drawn, opts.debris, opts.planeB);
    return { drawn };
  }

  /** CS:0xB095 — sfx 0x446 (ADL draws a random number for it), then a
   *  record in the DS:0xAC90 flash pool (game/flash.js). Only if one is free
   *  does the entity's stagger become -5 (CS:0xB0B6): five more ticks, each
   *  counted up by CS:0xAE11, before it acts. */
  #flash(e, opts) {
    if (opts.sfx) opts.sfx(SFX_MATERIALISE);
    if (opts.flashPool && opts.flashPool.alloc(e.x, e.y)) e.stagger = -5;
  }

  /** CS:0xADAE-0xAE0E. */
  #materialise(slot, opts = {}) {
    const d = slot.desc;
    let stagger = 0;
    for (let i = 0; i < d.entityCount; i++) {
      slot.entities.push({
        x: d.spawnX, y: d.spawnY, frame: 0,
        state: d.entityState0, facing: d.entityFacing,
        stagger, reloadTimer: (16 - d.reloadByte) << 2,
      });
      /* CS:0xADC7-0xADCF — `or cx,cx / jnz / call 0xb095`: an entity whose
       * stagger is 0 flashes at once. */
      if (stagger === 0) this.#flash(slot.entities[slot.entities.length - 1], opts);
      stagger += d.staggerStep;
    }
    slot.materialised = true;
  }

  /** CS:0xAE39-0xAE49 (stagger countdown) folded into the alive-tick path —
   *  an entity whose stagger has not yet elapsed does nothing this tick. */
  #stepAlive(slot, e, cam, hero, freezeTimer, health, grid, decodeTag, tock, fire, spawnHazard, drawn, opts) {
    if (e.stagger > 0) {                                    // CS:0xAE41/0xAE44
      e.stagger -= 1;
      if (e.stagger === 0) this.#flash(e, opts);            // CS:0xAE46 call 0xb095
      return;
    }
    if (e.stagger < 0) { e.stagger += 1; return; }         // CS:0xAE3F/0xAE11 — after a flash (-5)

    this.#cacheScratchX(e, cam);                            // CS:0xAE50, DS:0x200

    if (freezeTimer === 0) {                                // CS:0xAE53/0xAE58 — handlerB unless frozen
      if (slot.handlerB === 'b670' || slot.handlerB === 'b03c') {
        const shot = slot.handlerB === 'b03c'
          ? stepHandlerB03C(e, slot, slot.world)
          : stepHandlerB(e, slot, slot.world);
        if (shot) {
          if (shot.kind === 'shot' && fire) fire(shot.worldX, shot.worldY, shot.vx, cam);
          else if (shot.kind === 'hazard' && spawnHazard) spawnHazard(shot.worldX, shot.worldY, shot.n, cam);
        }
      } else if (slot.handlerB === 'b290' || slot.handlerB === 'b2f3') {
        stepHandlerRockDrop(e, slot);
      }
    }

    let sprite;                                              // CS:0xAE5F/0xAE62 — unconditional
    if (slot.handlerA === 'b60e') {
      sprite = handlerA_b60e(e, slot.world, slot);
    } else if (slot.handlerA === 'b5e9') {
      sprite = handlerA_b5e9(e, tock);
    } else if (slot.handlerA === '32x32') {
      stepAnim8(e, tock);
      stepPace32x32(e, tock, opts.planeB);          // CS:0xB744-B7EB — see the file header's correction
      sprite = handlerA_32x32(e, slot);
    } else if (slot.handlerA === 'b144') {
      const r = handlerA_b144(e, slot, tock);
      sprite = r.sprite;
      if (r.drop) this.rockSettle.spawn(e.x + 0xa, e.y + 0x12);       // CS:0xB169-B1B7
    } else if (slot.handlerA === 'b2c7') {
      const r = handlerA_b2c7(e, slot, tock);
      sprite = r.sprite;
      if (r.drop) this.rockBurst.spawn(e.x, e.y, BURST_ROCK_VELOCITIES);   // CS:0xB311-B388
    } else {
      /* An unrecognised/unimplemented family degrades honestly: draw at the
       * class's own sprite base, don't animate, don't fire — never silently
       * run a different family's math. */
      sprite = slot.spriteBase;
    }

    const sx = e.x - cam.x, sy = e.y - cam.y;
    if (culled(slot.desc.drawStyle, sx, sy)) {               // SS:0x3586 dispatch
      e.state = 0; slot.rewardItemId = 0xff;                 // CS:0xAF2F/0xAF34 etc — spend, no award
      return;
    }

    /* ⚠️ NO `reportGate` — B8DE never brackets DS:0x34 (unlike ce64.js's own
     * deliberate `mode:1`-style bracket for its own creature), so this uses
     * the ordinary, un-bracketed CS:0xac59 convention: a hero-touch is a
     * ONE-TOUCH KILL for the entity, exactly like every other creature in
     * this project's default (non-ce64) contact path. */
    const r = attackHero({ x: e.x, y: e.y, w: slot.w, h: slot.h, strength: e.state },
                          hero, health, { invuln: opts.invuln, sfx: opts.sfx });
    e.state = r.strengthOut;
    let killed = e.state < 0;
    if (!killed && decodeTag) {
      const proxy = { x: e.x, y: e.y, state: e.state };
      /* CS:0xABDE — a damaging hit that does not kill drops a spark whose
       * position draws two random numbers (combat.js hitSparkAxis). */
      creatureScansGrid(proxy, grid, cam, decodeTag, opts.difficulty || 0, { w: slot.w, h: slot.h },
                         null, { sfx: opts.sfx, rng: opts.rng, debris: opts.debris });
      e.state = proxy.state;
      killed = e.state < 0;
    }
    if (killed) {
      this.killed++;
      /* CS:0xAF74: the score input is the CLASS's own entityState0 byte
       * (slot+0x11), NOT the entity's own (possibly already-damaged) state —
       * every kill in a batch scores identically. */
      opts.score?.add(scoreForState0(slot.desc.entityState0));
      e.frame = -1;                                          // enter the dying fade next tick
    }
    drawn.push({ x: sx, y: sy, sprite, gfxExport: 1 });        // DS:0xdf90[1] == CS:0x3569, export 1
  }

  /** Cross-system scratch: CS:0xAE50 writes `DS:0x200` to the entity's own
   *  (pre-handler) SCREEN X every tick. The PAT-driven-shooting system
   *  (CS:0xBC4B, ported separately) reads this SAME address to decide which
   *  way a PAT object last moved. Exposed as a plain instance field so a
   *  future wiring pass can share it — whichever system runs last in a
   *  given tick simply leaves the value, matching the original's own
   *  last-write-wins shared global exactly. */
  #cacheScratchX(e, cam) { this.lastScreenX = e.x - cam.x; }

  /** CS:0xAFBD-0xAFEC. */
  #stepDying(slot, e, cam, drawn) {
    if (e.frame < 0) { slot.lastDyingX = e.x; slot.lastDyingY = e.y; }   // CS:0xAFC1-AFD0, first tick only
    e.frame += 1;
    if (e.frame >= DEATH_FRAMES) { e.state = 0; e.stagger = 0; e.facing = 0; return; }
    drawn.push({ x: e.x - cam.x, y: e.y - cam.y, sprite: DEATH_SPRITE_BASE + e.frame, gfxExport: 1 });
  }

  /** CS:0xAED0-0xAF0F. Fires once, the tick every entity in the batch first
   *  reaches dead-or-dying; the id is spent (0xFF) whether or not it was
   *  ever awarded, so a slot can only ever pay out once.
   *
   * ⚠️ CORRECTION: `slot.lastDyingX/Y` is only written by `#stepDying`
   * (CS:0xAFC1-AFD0), which an entity killed by THIS SAME tick's own
   * `#stepAlive` call has not reached yet — it goes straight to `dyingCount`
   * without ever running `#stepDying` on the tick it dies (see `step()`'s
   * own loop). For any batch whose members all die on one tick — trivially
   * true for `entityCount === 1`, the common case in shipped data — this
   * fired with `lastDyingX/Y` still at their unset default, landing the
   * reward at (8,8) instead of near the kill. Falling back to whichever
   * entity just died this tick (`frame === -1`) is exact, not approximate:
   * a DYING entity never moves, so its live x/y already equals what
   * `#stepDying` would have cached on the next tick. */
  #maybeAwardElimination(slot) {
    if (slot.rewardItemId === 0xff) return;
    this.eliminated++;
    let bx = slot.lastDyingX, by = slot.lastDyingY;
    if (bx === null) {
      const justDied = slot.entities.find((e) => e.frame === -1) || slot.entities[0];
      bx = justDied.x; by = justDied.y;
    }
    const x = bx + 8, y = by + 8;                               // CS:0xAEEA/0xAEED
    const id = slot.rewardItemId;
    this.rewards.push(id < 0xb
      ? { popupValue: id, itemType: null, x, y }
      : { popupValue: null, itemType: id - 0xb, x, y });
    slot.rewardItemId = 0xff;
  }
}
