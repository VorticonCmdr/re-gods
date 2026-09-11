/* entity-a.js — System A creature locomotion, ported from the six-stage
 * per-tick pipeline CS:0xe001.
 *
 * SCOPE
 *   GODS runs TWO parallel entity systems, discriminated by DS:0x3c2 (0x00 =
 *   System A, 0xff = System B). This file is System A: entity stride 0x28 at
 *   DS:0x0e96, group descriptors at DS:0x9d60 (PALFILS +0xD58). System B
 *   lives in entity.js.
 *
 *   Unlike System B, which dispatches through a fixed 8-entry movement-mode
 *   table (DS:0xdbe0), System A runs a FIXED SIX-STAGE PIPELINE every tick
 *   for every live entity, unconditionally — CS:0xe001:
 *     1. CS:0xe6e4  mode/strategy select (goal-picking)
 *     2. CS:0xe336  accelerate the velocity toward the goal, or decay it
 *     3. CS:0xe487  descriptor-gated ([si+0xf]) attack/leap, via the reach-
 *                    table scan FUN_1000_e4e2 — NOT PORTED, see below
 *     4. CS:0xe44d  clamp velocity to a second, independent speed cap [si+0xb]
 *     5. CS:0xe42b  apply — position update, or snap to the goal
 *     6. CS:0xe659  recompute facing and, if armed, fire
 *   then the shared contact test (CS:0xff93) and draw (CS:0x3569), exactly as
 *   documented for System B.
 *
 * WHAT IS PORTED
 *   Stages 1, 2, 4, 5, 6 in full, plus the sprite resolver CS:0xe199 and the
 *   spawn/materialise loop CS:0xde42-0xdf37. Strategy 0 (chase, CS:0xe77b) is
 *   simulated. Strategies 1 (CS:0xe9da, a weighted min-cost search over six
 *   scratch slots — itself only partly decoded, "the deepest-undecoded piece
 *   of this system") and 2 (CS:0xe88c, marker-seek — needs the "attracts
 *   monsters" potion's marker list, which this port does not have) leave the
 *   entity's goal untouched. Stage 2 then finds the entity already at its
 *   spawn-point goal, decays velocity to zero, and it sits still — the
 *   original's own no-goal behaviour, not an invented one.
 *
 *   MEASURED, not guessed: using the real nibble/weight roll formula
 *   (CS:0xe748) against all 74 live shipped System-A descriptors (PALFILS
 *   +0xD58, all 8 files), the expected effective-strategy share is
 *   strategy 0 ~43%, strategy 1 ~31%, strategy 2 ~26%. So under this port,
 *   roughly HALF of spawned System-A entities visibly stand still. That is
 *   reported by the verify suite, not hidden.
 *
 * WHAT IS NOT PORTED
 *   - Stage 3, the attack/leap (CS:0xe487 -> FUN_1000_e4e2's 48-entry two-
 *     ring reach scan, closed earlier in this project as a static-analysis
 *     exercise but never implemented in JS). System-A entities never attack.
 *     UNKNOWN_sysA_attack_not_ported.
 *   - The per-group "how many members may reroll their strategy this tick"
 *     throttle (a bitmask at [bp+0x14]/DS:0x3c4, plus a [si+0xa]-vs-random
 *     gate) that CS:0xe6e4 applies before the nibble/weight roll. This port
 *     rolls a fresh strategy for every entity whose strategy is unset,
 *     unthrottled — the SELECTION probabilities this file measures are
 *     unaffected (they come from the nibble/weight roll alone), only the
 *     PACING of when a whole group reconsiders is not reproduced.
 *   - The waiting -> materialising -> alive pre-life sequencing is modelled
 *     BY ANALOGY with System B's proven CS:0xff20 state machine, not from a
 *     System-A-specific read: the materialise loop (CS:0xde42-0xdf37, read
 *     in full this session) sets entity +0x08 to 0xfffe (= -2 signed, the
 *     IDENTICAL sentinel System B uses) at spawn, but the per-tick code that
 *     counts a stagger down and promotes -2 to a live HP value was not
 *     located for System A this session — it plausibly lives inside the
 *     outer per-group driver CS:0xdf3a, which was disassembled only in part.
 *     UNKNOWN_sysA_prelife_driver.
 *   - Entity descriptor +0x01 is read here as HP, BY STRUCTURAL ANALOGY with
 *     System B's descriptor (same 0x16-byte stride, same +0x00 entity-count
 *     position) — no System-A-specific instruction assigning HP semantics to
 *     +0x01 was read this session. UNKNOWN_sysA_descriptor_hp.
 *   - PER-ENTITY STAGGER. System B's materialise loop (CS:0xec60) advances
 *     its stagger accumulator by descriptor +0x14 per entity — documented in
 *     spawn.js. System A's materialise loop (CS:0xde7d, read in full this
 *     session) zeroes a DX register ONCE before its `loop cl` and never
 *     writes to it again anywhere in the routine, so every entity gets
 *     `[di+0x6] = 0`: NO staggering. Also unresolved: DI (the entity-record
 *     pointer) is never explicitly advanced within the loop body either —
 *     every write from `[di]` through `[di+0x27]` targets the SAME address
 *     on every one of the `count` iterations, unless the far call to
 *     graphics export 38 (`callf [ss:0x52ea]`, "the entity initialiser",
 *     called once per iteration) advances it as an undocumented side effect.
 *     That call is opaque driver-overlay code this project has not read.
 *     This port assumes export 38 DOES advance it (matching System B's own
 *     need for N separate slots) and spawns `count` independent entities
 *     with no stagger between them. UNKNOWN_sysA_materialise_di_advance.
 *
 * THE ENTITY RECORD, DS:0x0e96, stride 0x28 (from CLAUDE.md's consolidated
 * table, this session):
 *   +0x00/+0x02  world X / Y            +0x1a  spawn-zone code (CS:0xec12),
 *   +0x04        animation frame                unconsumed by any known code
 *   +0x08        state word (shared     +0x1b  COARSE arrival flag (32px)
 *                contact/death sentinel, +0x1c/+0x1e  goal X / Y
 *                CS:0xff93)              +0x24  sticky strategy byte
 *   +0x0e        per-entity fire/reload  +0x25  FINE arrival flag (8px)
 *                timer (stage 6)         +0x26  animation reseed countdown
 *   +0x12/+0x14  velocity X / Y          +0x27  facing (0 = last moved left,
 *   +0x16        triple-duty: steering            1 = last moved right)
 *                step cap (stage 2), attack-cooldown display (stage 3, NOT
 *                ported here), animation-cadence divisor (CS:0xe199)
 *   +0x19        gates whether stage 2 evaluates the fine (8px) arrival
 *                check at all — writer not located; this port defaults it
 *                so the fine check never fires (see EntityA below)
 */

import { GodsRandom } from './random.js';

/** Sticky-strategy sentinel: matches EntityB's WAITING convention of -2. */
export const EST = { FREE: 0, DYING: -1, WAITING: -2, MATERIALISING: -3 };
export const MATERIALISE_TICKS = 5;    // by analogy with System B — see file header

/* ── Stage 1 — CS:0xe6e4, the strategy nibble/weight roll, CS:0xe748 ──────
 * cl = [si+0x8] & 0xf (lo nibble), dl = ([si+0x8] >> 4) & 0xf (hi nibble),
 * bl = [si+0x9] (7-bit weight). rand = draw() & 0x7f. If bl < rand, swap
 * cl/dl — i.e. the LOW nibble is used when weight >= rand, probability
 * (weight+1)/128. */
export function rollStrategy(seedPair, seedWeight, draw) {
  const lo = seedPair & 0xf;
  const hi = (seedPair >> 4) & 0xf;
  const rand = draw() & 0x7f;
  return seedWeight < rand ? hi : lo;
}

/** CS:0xe336 — accelerate toward the goal, or decay and mark arrival.
 * Both position checks round position+16 down to a multiple of 32 (a nearest-
 * cell test), matching the original's `add bp,0x10 / and bp,0xffe0` twice. */
export function stageAccelerate(e, stepCap) {
  const cellOf = (v) => (v + 16) & ~31;
  const arrived = cellOf(e.x) === cellOf(e.goalX) && cellOf(e.y) === cellOf(e.goalY);

  if (arrived) {
    const cap = Math.min(e.stepCap, stepCap);
    e.vx = decayToward(e.vx, cap);
    e.vy = decayToward(e.vy, cap);
    e.arrivedCoarse = true;
    /* CS:0xe3fa: the fine (8px) check runs only when +0x19 is NEITHER 0 NOR
     * 1. This port defaults fineGate to 0, so the fine check — and hence
     * stage 5's snap-to-goal — never fires. See UNKNOWN_sysA_field_0x19 in
     * CLAUDE.md. */
    if (e.fineGate !== 0 && e.fineGate !== 1) {
      const cell8 = (v) => (v + 4) & ~7;
      if (cell8(e.x) === cell8(e.goalX) && cell8(e.y) === cell8(e.goalY)) {
        e.arrivedFine = true;
      }
    }
    return;
  }

  e.arrivedCoarse = false;
  const dx = (e.goalX - e.x) >> 3;   // arithmetic shift — 1/8 of the remaining distance
  const dy = (e.goalY - e.y) >> 3;
  const cap = Math.min(e.stepCap, stepCap);
  e.vx += clamp(dx, -cap, cap);
  e.vy += clamp(dy, -cap, cap);
}

const decayToward = (v, step) => {
  if (v === 0) return 0;
  if (v > 0) { const n = v - step; return n < 0 ? 0 : n; }
  const n = v + step; return n > 0 ? 0 : n;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** CS:0xe44d — clamp velocity to descriptor [+0xb], sign-extended. */
export function stageSpeedClamp(e, speedCap) {
  e.vx = clamp(e.vx, -speedCap, speedCap);
  e.vy = clamp(e.vy, -speedCap, speedCap);
}

/** CS:0xe42b — apply position, gated on the global "freezes aliens" flag. */
export function stageApply(e, frozen) {
  if (frozen) return;
  if (e.arrivedFine) { e.x = e.goalX; e.y = e.goalY; return; }
  e.x += e.vx;
  e.y += e.vy;
}

/**
 * CS:0xe659 — facing, and (if armed) fire through the shared enemy-shot
 * emitters (CS:0x1fe7 / CS:0x2039, see enemy-shots.js). Returns a muzzle
 * descriptor when a shot should be emitted, or null.
 *   fireByte = descriptor +0x6: low nibble = reload-rate value, 0 = can't
 *              fire at all; high nibble = the direction/config value stored
 *              into DS:0x206 (negated when facing left).
 * A System-A entity fires only while its OWN velocity is nonzero — an
 * entity that has arrived and decayed to a stop goes silent, matching
 * `cmp word [di+0x12],0 / jz` exactly.
 */
export function stageFacingAndFire(e, fireByte) {
  const loNibble = fireByte & 0xf;
  if (fireByte === 0 || loNibble === 0) return null;

  e.reloadTimer--;
  if (e.reloadTimer > 0) return null;
  e.reloadTimer = (0x10 - loNibble) << 2;         // CS:0xe670-e67a

  if (e.vx === 0) return null;                     // CS:0xe6a5 `jz`

  const hiNibble = (fireByte >> 4) & 0xf;
  const right = e.vx > 0;
  e.facing = right ? 1 : 0;
  const dir = right ? hiNibble : -hiNibble;         // CS:0xe6ad `neg bx`
  const muzzleX = right ? e.x + 0x20 : e.x - 8;      // CS:0xe6c7/0xe6b3
  return { x: muzzleX, y: e.y, dir };
}

/* ── CS:0xe199 — the sprite resolver, read in full this session ──────────
 * World < 2, the DEFAULT class (any sprite base except the two specials):
 * the raw frame 0..3 is remapped through DS:0xdf78 = [0,1,2,1] BEFORE the
 * facing offset is added — so only 3 distinct frames are ever drawn (frame 3
 * re-shows frame 1). World >= 2 adds the raw frame directly, no remap.
 * The facing offset itself also differs by world tier: +3 (world<2) vs +4
 * (world>=2), both added only when the facing byte is 0 ("last moved left"),
 * never when it is 1 ("last moved right") — CS:0xe1ea/0xe1f6 `jnz -> skip`. */
const WORLD_LT2_FRAME_REMAP = [0, 1, 2, 1];
export const SPRITE_BASE_8FRAME = 0x1f0;   // 496 — 8-frame cycle, NO facing offset
export const SPRITE_BASE_6FRAME = 0x1e6;   // 486 — 6-frame cycle (wraps at 6, not a power of 2), NO facing offset

/** Advance the animation frame/reseed timer exactly as CS:0xe199 does, given
 *  the class's sprite base (to pick the frame-cycle length). */
export function stepAnimation(e, base) {
  if (--e.animTimer >= 0) return;                   // `dec / jns`
  if (base === SPRITE_BASE_8FRAME) {
    e.frame = (e.frame + 1) & 7;
  } else if (base === SPRITE_BASE_6FRAME) {
    e.frame = e.frame + 1; if (e.frame >= 6) e.frame = 0;
  } else {
    e.frame = (e.frame + 1) & 3;
  }
  /* dx = (10 - stepCap) >> 2 — the SAME field stage 2 uses as a steering cap
   * doubles as the animation-cadence divisor. */
  e.animTimer = (10 - e.stepCap) >> 2;
}

/** CS:0xe199's sprite composition. `world` is the level's 1-based world
 *  number (DS:0x42). Returns null for an unresolved class. */
export function spriteForEntityA(world, cls, entity, tables) {
  const table = tables[world];
  const rec = table && table[cls];
  if (!rec) return null;
  const base = rec.base;
  if (base === SPRITE_BASE_8FRAME || base === SPRITE_BASE_6FRAME) {
    return base + entity.frame;                     // no facing offset at all
  }
  const frame = world < 2 ? WORLD_LT2_FRAME_REMAP[entity.frame & 3] : (entity.frame & 3);
  const offset = entity.facing === 0 ? (world < 2 ? 3 : 4) : 0;
  return base + frame + offset;
}

/* ── The class tables, DS:0x1fe's pointer (System A's own, distinct from
 * System B's DS:0x1fc / spawn.js's CLASS_TABLES_B) ───────────────────────
 * Read directly from the shipped EXE image this session (12-byte records
 * {u16 base, u16 1, u16 handlerA, u16 w, u16 h, u16 handlerB}, 0xFFFF-
 * terminated) at DS:0xe046 (world 1), 0xe0e2 (world 2), 0xe18a (world 3),
 * 0xe21a (world 4). Handler pointers are recorded for provenance; they are
 * NOT ported (stage 3's attack isn't implemented, and handlerB's default,
 * 0xbc4b, is a generic "fire toward my last direction of travel" behaviour
 * this port does not model beyond stage 6's own facing/fire).
 * Per CLAUDE.md's "which table belongs to which entity system" census, the
 * classes actually REFERENCED by live shipped descriptors are: world 1 -
 * {0,2}; world 2 - {0,2}; world 3 - {0,1,2}; world 4 - {0} only (class 3 in
 * world 4 is the documented CUT hazard, base 0x213/531, never selected by
 * any shipped descriptor). */
export const CLASS_TABLES_A = {
  1: [
    { base: 450, w: 32, h: 32, handlerA: 0xbe6b, handlerB: 0xbc4b },
    { base: 516, w: 32, h: 32, handlerA: 0xbed3, handlerB: 0xbf58 },
    { base: 456, w: 32, h: 32, handlerA: 0xbe71, handlerB: 0xbc4b },
  ],
  2: [
    { base: 504, w: 32, h: 32, handlerA: 0xbe60, handlerB: 0xbc4b },
    { base: 512, w: 32, h: 32, handlerA: 0xbe66, handlerB: 0xbc4b },
    { base: 504, w: 32, h: 32, handlerA: 0xbe60, handlerB: 0xbc4b },
    { base: 504, w: 32, h: 32, handlerA: 0xbe60, handlerB: 0xbc4b },
  ],
  3: [
    { base: 486, w: 32, h: 32, handlerA: 0xbef4, handlerB: 0xbc4b },
    { base: 523, w: 32, h: 32, handlerA: 0xbe5a, handlerB: 0xbc4b },
    { base: 486, w: 32, h: 32, handlerA: 0xbef4, handlerB: 0xbc4b },
  ],
  4: [
    { base: 496, w: 32, h: 32, handlerA: 0xbf15, handlerB: 0xbc4b },
    { base: 524, w: 32, h: 32, handlerA: 0xbf36, handlerB: 0xbc4b },
    { base: 504, w: 32, h: 48, handlerA: 0xbddb, handlerB: 0xbd71 },
    /* class 3 — the documented CUT hazard. Never selected by shipped data;
     * kept here for completeness, matching the table's own bytes. */
    { base: 531, w: 32, h: 32, handlerA: 0xbd38, handlerB: 0xbd0b },
  ],
};

/**
 * One System-A entity. Field names carry their DS offsets so the mapping
 * back to the disassembly stays visible — mirrors entity.js's convention.
 */
export class EntityA {
  constructor({ x, y, cls = 0, hp = 1, delay = 0 }) {
    this.x = x;                 // +0x00
    this.y = y;                 // +0x02
    this.frame = 0;             // +0x04
    this.cls = cls;             // descriptor +0x07
    this.state = EST.WAITING;   // +0x08
    this.vx = 0;                // +0x12
    this.vy = 0;                // +0x14
    this.stepCap = 1;           // +0x16 — floors at 1 every tick (stage 0 preamble)
    this.fineGate = 0;          // +0x19 — UNKNOWN writer; defaults OFF (see stageAccelerate)
    this.zone = 0;              // +0x1a — CS:0xec12's spawn-time result, unconsumed
    this.arrivedCoarse = false; // +0x1b
    this.goalX = x;             // +0x1c — seeded to spawn point (materialise loop)
    this.goalY = y;             // +0x1e
    this.strategy = -1;         // +0x24 — sticky; negative = unset, rolls fresh
    this.arrivedFine = false;   // +0x25
    this.animTimer = 2;         // +0x26 — matches the materialise loop's own seed
    this.facing = 0;            // +0x27
    this.reloadTimer = 0;       // +0xe
    this.delay = delay;         // spawn stagger, port-level (see file header)
    this.hp = hp;
    this.timer = delay;
  }

  get alive() { return this.state > 0; }

  /**
   * One 15 Hz tick.
   * @param {{x:number,y:number}} hero  world position, per stage-1 chase (e7ca adds +8 to Y)
   * @param {{stepCap:number, speedCap:number, fireByte:number, seedPair:number,
   *          seedWeight:number}} desc  the group descriptor fields this stage needs
   * @param {() => number} draw  the shared random-table reader, DS:0x3836
   * @param {boolean} frozen  DS:0x2fa, "freezes aliens"
   * @returns {?{x:number,y:number,dir:number}} a muzzle to fire from, or null
   */
  tick(hero, desc, draw, frozen = false) {
    /* Pre-life FSM — see UNKNOWN_sysA_prelife_driver in the file header. */
    if (this.state === EST.WAITING) {
      if (--this.timer <= 0) { this.state = EST.MATERIALISING; this.timer = MATERIALISE_TICKS; }
      return null;
    }
    if (this.state === EST.MATERIALISING) {
      if (--this.timer <= 0) { this.state = this.hp; this.timer = 0; }
      return null;
    }
    if (this.state <= 0) return null;

    /* Stage 0 preamble, CS:0xe006-0xe00f: decrement, floor at 1. */
    if (--this.stepCap < 1) this.stepCap = 1;

    /* Stage 1 — strategy select. Strategy 0 (chase) re-targets the hero
     * EVERY tick even when already sticky (CS:0xe7c6 re-clears [di+0x24] to
     * 0 on every pass through the chase body — 0 is non-negative, so it
     * stays sticky, but the goal write still runs). Strategies 1/2 leave the
     * goal untouched, per the file header. */
    if (this.strategy < 0) this.strategy = rollStrategy(desc.seedPair, desc.seedWeight, draw);
    if (this.strategy === 0) {
      this.goalX = hero.x;
      this.goalY = hero.y + 8;
    }

    /* Stage 2. */
    stageAccelerate(this, desc.stepCap);
    /* Stage 3 — NOT PORTED. */
    /* Stage 4. */
    stageSpeedClamp(this, desc.speedCap);
    /* Stage 5. */
    stageApply(this, frozen);
    /* Stage 6. */
    return stageFacingAndFire(this, desc.fireByte);
  }
}

/** A fresh RNG-backed draw function, for callers that don't already have one. */
export const defaultDraw = (rng = new GodsRandom(1)) => () => rng.next();
