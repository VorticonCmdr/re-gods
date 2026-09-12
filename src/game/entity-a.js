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
 *                    table scan FUN_1000_e4e2 — implemented as `stageAttack`
 *                    below, but NOT WIRED into this pipeline, see below
 *     4. CS:0xe44d  clamp velocity to a second, independent speed cap [si+0xb]
 *     5. CS:0xe42b  apply — position update, or snap to the goal
 *     6. CS:0xe659  recompute facing and, if armed, fire
 *   then the shared contact test (CS:0xff93) and draw (CS:0x3569), exactly as
 *   documented for System B.
 *
 * WHAT IS PORTED
 *   Stages 1, 2, 4, 5, 6 in full, plus the sprite resolver CS:0xe199 and the
 *   spawn/materialise loop CS:0xde42-0xdf37. Strategy 0 (chase, CS:0xe77b) is
 *   simulated.
 *
 *   Strategy 1 (CS:0xe9da, the weighted min-cost ZONE search — formerly "the
 *   deepest-undecoded piece of this system") and strategy 2 (CS:0xe88c,
 *   marker-seek, now that game/markers.js exists) are BOTH implemented this
 *   session — see `strategy1`/`strategy2` below — and wired into the stage-1
 *   dispatch inside `tick()`. ⚠️ BUT `tick()`'s one real caller (main.js) does
 *   not yet pass the `camera`/`markers` arguments either needs, so in the
 *   ACTUAL running port they still leave the entity's goal untouched today —
 *   exactly the pre-this-session behaviour, unchanged until a future
 *   integration pass updates that call site. `tick()`'s own JSDoc documents
 *   the exact fallback. Stage 2 then finds the entity already at its
 *   spawn-point goal, decays velocity to zero, and it sits still — the
 *   original's own no-goal behaviour, not an invented one.
 *
 *   MEASURED, not guessed: using the real nibble/weight roll formula
 *   (CS:0xe748) against all 74 live shipped System-A descriptors (PALFILS
 *   +0xD58, all 8 files), the expected effective-strategy share is
 *   strategy 0 ~43%, strategy 1 ~31%, strategy 2 ~26%. So under this port,
 *   AS ACTUALLY WIRED TODAY, roughly HALF of spawned System-A entities
 *   visibly stand still — strategies 1/2 being implemented in this file does
 *   not change that measurement until main.js is updated to call `tick()`
 *   with a camera and a marker list. That is reported by the verify suite,
 *   not hidden.
 *
 * WHAT IS NOT PORTED
 *   - Stage 3's OWN CALL SITE. The attack/leap mechanism itself (CS:0xe487 ->
 *     FUN_1000_e4e2's 48-entry two-ring reach scan) is implemented this
 *     session as `stageAttack`, exported below with its own extensive header
 *     — but it is deliberately NOT invoked from `tick()`. It needs a
 *     collision.js DamageGrid (the same grid every projectile/creature
 *     contact test already shares) and the snapped camera, neither of which
 *     `tick()` currently receives from main.js. `tick()`'s own inline comment
 *     between its stageAccelerate and stageSpeedClamp calls marks exactly
 *     where a future integration pass inserts the call, and this file's
 *     `tick()` already takes the one other prerequisite step for it — a
 *     `prevVx`/`prevVy` snapshot of the entity's velocity taken immediately
 *     before stage 2 runs, so stage 3 can blend onto the PRE-stage-2 value
 *     rather than stage 2's own output. Until that integration pass, System-A
 *     entities still never attack. UNKNOWN_sysA_attack_not_wired (narrowed
 *     down from UNKNOWN_sysA_attack_not_ported — the mechanism itself is no
 *     longer the gap, only its wiring is).
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
 *                step cap (stage 2), attack-cooldown display (stage 3 —
 *                `stageAttack` refills this to 10 on a hit, CS:0xE496; the
 *                mechanism is implemented below, see WHAT IS NOT PORTED for
 *                why it still never fires in the live game), animation-
 *                cadence divisor (CS:0xe199)
 *   +0x19        gates whether stage 2 evaluates the fine (8px) arrival
 *                check at all — writer not located; this port defaults it
 *                so the fine check never fires (see EntityA below)
 */

import { GodsRandom } from './random.js';
/* Stage 3 (stageAttack, below) reads the SAME 8x8 screen-space occupancy
 * grid every projectile stamp and every creature contact scan already
 * shares — collision.js's DamageGrid. Only the raw index math and the public
 * `buf` array are used here, never `DamageGrid.scan()`: that method's own
 * screen-edge clip prologue (CS:0xA9EF) belongs to a different routine
 * (the projectile/creature box scan, CS:0xAAAA) and would silently apply the
 * wrong clip rule to the reach-table scan below. See stageAttack's header. */
import { cellIndex, GRID_LO, GRID_HI, ROW_STRIDE, CELL } from './collision.js';

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

/* ── Strategy 1 — CS:0xe9da, the weighted min-cost ZONE search ────────────
 * Formerly "the deepest-undecoded piece of this system", read in full this
 * session. The screen is carved into 7 fixed zones (CS:0xd9d0) and this
 * strategy picks a DESIRED zone, then either targets a fresh random point
 * inside it (when the entity is ALREADY there) or steps one hop around a
 * 6-zone ring toward it — zone 7 (the centre) never participates in the
 * ring itself, only as a `current`/`desired` endpoint.
 *
 * THE 7 ZONES, CS:0xd9d0 — screen-space rectangles, quoted verbatim off the
 * shipped binary. They do NOT tile the 320x192 playfield symmetrically;
 * do not "clean them up" to a regular grid. */
export const ZONES = [
  { loX: 0,   loY: 0,   hiX: 160, hiY: 60  },   // zone 1 — top-left
  { loX: 160, loY: 0,   hiX: 319, hiY: 60  },   // zone 2 — top-right
  { loX: 210, loY: 60,  hiX: 319, hiY: 136 },   // zone 3 — right
  { loX: 160, loY: 136, hiX: 319, hiY: 191 },   // zone 4 — bottom-right
  { loX: 0,   loY: 136, hiX: 160, hiY: 191 },   // zone 5 — bottom-left
  { loX: 0,   loY: 60,  hiX: 110, hiY: 136 },   // zone 6 — left
  { loX: 110, loY: 60,  hiX: 210, hiY: 136 },   // zone 7 — centre
];

/**
 * CS:0xec12 — which of the 7 zones the entity is currently in, screen-space.
 * ⚠️ ASYMMETRIC ON PURPOSE, and it is the SAME asymmetry `currentZone`'s own
 * name suggests, not a typo: the LOWER-bound test adds 32px (the entity's own
 * body extending past its top-left anchor) on BOTH axes; the UPPER-bound test
 * does not. Do not symmetrise it.
 * @returns {number} 1..7, or 0 if the entity is not cleanly inside any zone
 *   (e.g. far enough off-screen that no rectangle matches). The given spec
 *   does not say what should happen then; `strategy1` below handles it
 *   defensively via `stepBack6` rather than assuming it can't occur.
 */
export function currentZone(entity, camera) {
  const sx = entity.x - camera.x, sy = entity.y - camera.y;
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    if (sx + 32 < z.loX) continue;
    if (sy + 32 < z.loY) continue;
    if (sx > z.hiX) continue;
    if (sy > z.hiY) continue;
    return i + 1;
  }
  return 0;
}

/* ⚠️ THIS SIX-CELL SCRATCH ARRAY HAS NO WRITER ANYWHERE IN GAME.EXE — an
 * exhaustive search this session found none, matching this project's own
 * established pattern (POBJECTS +0x02, the .DAT atlas's word2) of authored-
 * but-dead fields. It serves TWO SEPARATE roles inside CS:0xe9da — a "which
 * zone wants me most" weighted-max search (STEP A below), and the ring-walk's
 * own "is this hop blocked" test — and the original genuinely reuses the
 * SAME SIX BYTES (DS:0x3c6..0x3cb) for both, modelled here as one shared
 * array rather than two independently-zeroed ones that happen to agree.
 * Because nothing ever writes it, both consumers are, on the shipped game,
 * DETERMINISTIC: the weighted search always yields zone 1 (index 0 is never
 * beaten by a strictly-greater later entry when everything is zero), and
 * every ring hop is unconditionally "clear" on its very first test. Left
 * mutable — not frozen — so a future pass that finds a real writer can wire
 * it in without restructuring either consumer. */
export const ZONE_SCRATCH = [0, 0, 0, 0, 0, 0];

/** CS:0xe9da's own `z = (z % 6) + 1` forward ring step. Safe over the full
 *  0..7 `currentZone()` domain, not just 1..6 — see `stepBack6`'s own note
 *  for why the backward step needs a second helper and this one does not. */
const stepFwd6 = (z) => (z % 6) + 1;

/**
 * CS:0xe9da's own `z -= 1; if (z === 0) z = 6` backward ring step,
 * generalised via modulo so it can never index `ZONES` out of range. For z
 * in 1..7 this reduces EXACTLY to the literal disassembly. `z === 0`
 * (`currentZone()`'s own "not cleanly in any zone" sentinel) is not
 * addressed by the given spec at all, and the literal `if (z===0) z=6` form
 * would leave z at -1 there — an invalid ZONES index. This project's own
 * established precedent (collision.js's DamageGrid.scan: "a wild read is
 * not a behaviour worth reproducing... the port clamps instead") is
 * followed here rather than crashing on an edge case the source material
 * doesn't cover.
 */
const stepBack6 = (z) => ((z - 2 + 6) % 6) + 1;

/** CS:0xe9da's own random-point-in-zone picker, used both when the entity is
 *  already in its desired zone and after a ring hop lands it on a new one.
 *  `((rand() & 0x7f) * extent) >> 7` is a PLAIN integer scale, no rounding
 *  correction — reproduced verbatim, not rounded to nearest.
 *  ⚠️ The `- 16` shift is this port's own reading of a half-body (32px
 *  entity) centring correction: the returned point is where the entity's
 *  own top-left ANCHOR should go so that its CENTRE (anchor + 16 on both
 *  axes) lands inside the zone, matching `currentZone`'s own use of the
 *  entity's body size in its lower-bound test. That reading is not itself
 *  re-derived from CS:0xe9da's raw bytes this session — only the formula
 *  ("-16, then convert back to world via the camera") was given — so it is
 *  flagged here rather than asserted as independently confirmed. */
function pointInZone(zoneNumber1Based, camera, rand) {
  const z = ZONES[zoneNumber1Based - 1];
  const w = z.hiX - z.loX, h = z.hiY - z.loY;
  const offX = ((rand() & 0x7f) * w) >> 7;
  const offY = ((rand() & 0x7f) * h) >> 7;
  return { x: z.loX + offX - 16 + camera.x, y: z.loY + offY - 16 + camera.y };
}

/**
 * CS:0xe9da — strategy 1, quoted end to end this session.
 *
 * ⚠️ UNLIKE STRATEGY 0, THIS NEVER STAYS STICKY. Every call unconditionally
 * re-arms the sticky-strategy byte (+0x24, `entity.strategy` in this port,
 * this file's own -1-sentinel convention used in place of the given spec's
 * generic `entity.stickyStrategy` name) to its "unset" value before doing
 * anything else, so the NEXT tick rolls a fresh strategy from scratch —
 * strategy 1 is a one-shot goal-repick, not a standing behaviour the way
 * chase (strategy 0) is.
 *
 * ⚠️ THE RING-STEPPING DELIBERATELY STEPS THE *WRONG* WAY. When only one of
 * the two ring searches (forward/backward around zones 1..6) finds a path to
 * the desired zone, the entity steps in the OTHER, FAILED direction anyway —
 * and when both find a path but of different lengths, it steps toward the
 * LONGER one, not the shorter. And on an exact tie it steps AWAY from
 * whichever neighbour scores higher in the (permanently zero, see
 * ZONE_SCRATCH) scratch array. This reads backwards on a first pass and it
 * is not a transcription slip — independently re-verified from the raw
 * disassembly twice in this project. Implemented exactly as specified;
 * `checkEntityA` asserts it explicitly.
 *
 * @param {EntityA} entity
 * @param {{zoneWeight?:number, stepCap?:number}} desc  descriptor +0x0d, the
 *   0..127 weight favouring the scratch-cell search over a uniform reroll
 *   (CS:0xe9da's own `cmp al,[si+0xd]`). ⚠️ `+0x0d` IS NOT CURRENTLY PARSED
 *   by spawn.js's `parseGroupsA` — only System B's own +0x0d ("budget", a
 *   completely different field at the same offset in the OTHER descriptor
 *   struct) is exposed there today. A future integration pass needs one
 *   line added to `parseGroupsA`: `zoneWeight: b[0x0d],`. Until then this
 *   reads `desc.zoneWeight`, defaulting to 0 when absent — meaning the
 *   weighted branch below is taken only on the rare `rand()&0x7f === 0`
 *   draw, a safe and inert default rather than a guess at the real
 *   per-descriptor value.
 * @param {{x:number,y:number}} camera  the snapped scroll origin
 * @param {() => number} rand  the shared replay-table draw, DS:0x3836
 */
export function strategy1(entity, desc, camera, rand) {
  entity.strategy = -1;                               // re-arm — see above

  /* STEP A — pick a DESIRED zone, 1..7. */
  const zoneWeight = desc.zoneWeight ?? 0;
  let desired;
  if ((rand() & 0x7f) <= zoneWeight) {
    let best = 0, bestVal = ZONE_SCRATCH[0];
    for (let i = 1; i < 6; i++) {
      if (ZONE_SCRATCH[i] > bestVal) { bestVal = ZONE_SCRATCH[i]; best = i; }
    }
    desired = best + 1;                               // ALWAYS 1 while the
  } else {                                             // scratch stays zero
    do { desired = rand() & 7; } while (desired === 0);
  }

  const current = currentZone(entity, camera);

  const setGoal = (zoneNumber1Based) => {
    const pt = pointInZone(zoneNumber1Based, camera, rand);
    entity.goalX = pt.x; entity.goalY = pt.y;
    entity.storedZone = zoneNumber1Based;
    entity.goalFresh = true;
  };

  if (desired === current) {
    if (entity.storedZone === current && entity.goalFresh) return;   // already fresh
    setGoal(current);
    return;
  }

  /* The 6-zone ring. Zone 7 is explicitly excluded from the ring itself —
   * it can only ever be `current` or `desired` directly, never a step. */
  let forwardSteps = -1, z = current;
  for (let step = 1; step <= 6; step++) {
    z = stepFwd6(z);
    if (z === desired) { forwardSteps = step; break; }
    if (ZONE_SCRATCH[z - 1] === 0) break;              // blocked — forward search FAILS
  }
  let backwardSteps = -1; z = current;
  for (let step = 1; step <= 6; step++) {
    z = stepBack6(z);
    if (z === desired) { backwardSteps = step; break; }
    if (ZONE_SCRATCH[z - 1] === 0) break;
  }

  let result;
  if (forwardSteps === -1 && backwardSteps === -1) {
    result = current;                                  // both directions blocked — stay put
  } else if (forwardSteps === -1) {
    result = stepFwd6(current);                         // ⚠️ forward FAILED — step forward anyway
  } else if (backwardSteps === -1) {
    result = stepBack6(current);                        // ⚠️ backward FAILED — step backward anyway
  } else if (forwardSteps === backwardSteps) {
    const neighborFwd = stepFwd6(current), neighborBack = stepBack6(current);
    const vf = ZONE_SCRATCH[neighborFwd - 1], vb = ZONE_SCRATCH[neighborBack - 1];
    /* ⚠️ Step toward the LOWER-valued neighbour — i.e. AWAY from whichever
     * side scores higher — the same "wrong direction" shape as both
     * branches above, applied to a tie. */
    if (vf > vb) result = neighborBack;
    else if (vf < vb) result = neighborFwd;
    else result = (rand() & 1) ? neighborFwd : neighborBack;
  } else if (forwardSteps > backwardSteps) {
    result = stepBack6(current);                         // forward path LONGER — step BACKWARD
  } else {
    result = stepFwd6(current);                          // backward path LONGER — step FORWARD
  }

  setGoal(result);
}

/**
 * CS:0xe88c — strategy 2, marker-seek. Consumes game/markers.js's marker
 * list (the "attracts monsters" potion's own trail), now that it exists in
 * this port.
 *
 * ⚠️ SEMANTICS CHOSEN: A SINGLE RANDOM MARKER, NOT "PAINT EVERY MARKER".
 * System B's own marker-seek (pathfind-producers.js, `SEED_STRATEGIES` n=2)
 * paints EVERY marker onto its search grid and lets the pathfinder decide
 * which is cheapest to reach — but System B is architecturally a grid
 * search, and System A's stage 1 is not: it only ever has ONE goal point to
 * set (`entity.goalX/Y`), with nothing downstream that could weigh multiple
 * candidates the way a search grid does. This function therefore picks one
 * marker uniformly at random and targets it directly. That reading matches
 * this strategy's own shape (a goal-setter, not a search seeder) but was
 * NOT independently confirmed by walking CS:0xe88c's own body instruction by
 * instruction this session — only the marker list itself and the general
 * "pick one and seek it" shape were given. Flagged here rather than
 * asserted with more confidence than the evidence supports.
 *
 * ⚠️ MARKERS ARE SCREEN COORDINATES, FROZEN AT WRITE TIME (game/markers.js's
 * own header). Converting one to a WORLD-space goal (`entity.goalX/Y`
 * elsewhere in this file are world coordinates) means adding the CURRENT
 * camera — which reproduces the original's own staleness automatically once
 * the camera has moved since the marker was written, rather than silently
 * erasing it. pathfind-producers.js makes exactly this same choice for
 * System B's own reader (`paintExport39Screen`, not `paintExport39`) for
 * exactly this reason: re-subtracting the current camera on top of an
 * already screen-relative value would be wrong twice over. This mirroring
 * is this port's best-understood reading, not a re-derivation from
 * CS:0xe88c's own bytes.
 *
 * @param {EntityA} entity
 * @param {?Array<{x:number,y:number,type:number}>} markers  screen-relative
 *   marker records — e.g. a MarkerList's own `.entries` (game/markers.js)
 * @param {{x:number,y:number}} camera  the CURRENT snapped scroll origin
 * @param {() => number} rand  the shared replay-table draw
 */
export function strategy2(entity, markers, camera, rand) {
  if (!markers || markers.length === 0) return;        // nothing to seek — leave the goal alone
  /* Uniform pick over the list. The specific RNG consumption for "pick one
   * marker" was not given as a cited CS:0xe88c instruction this session —
   * `rand() % length` is this port's own choice to satisfy "uniform, via
   * rand()", not a transcribed original formula. */
  const marker = markers[rand() % markers.length];
  entity.goalX = marker.x + camera.x;
  entity.goalY = marker.y + camera.y;
  entity.storedZone = -1;                               // not a zone-strategy goal — see strategy1
  entity.goalFresh = true;
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

/* ── Stage 3 — CS:0xe487 -> FUN_1000_e4e2, the attack/leap reach-table scan ─
 * Gated on descriptor +0xf (`desc.attackGate`) being non-zero. Walks a
 * 48-cell, two-ring spiral of 8x8 damage-grid cells centred on the entity's
 * OWN cell — collision.js's DamageGrid, the SAME grid every projectile stamp
 * and every creature's own contact scan already shares — looking for up to
 * two occupied cells.
 *
 * REACH_OFFSETS — 48 entries, RING 1 (20 cells, 1 cell out) followed by
 * RING 2 (28 cells, 2 cells out), each ring walked top row, left column,
 * right column, bottom row, in that exact order. */
const buildReachOffsets = () => {
  const out = [];
  for (let c = -1; c <= 4; c++) out.push({ dCol: c,  dRow: -1 });   // ring 1: row -1
  for (let r = 0;  r <= 3; r++) out.push({ dCol: -1, dRow: r  });   // ring 1: col -1
  for (let r = 0;  r <= 3; r++) out.push({ dCol: 4,  dRow: r  });   // ring 1: col +4
  for (let c = -1; c <= 4; c++) out.push({ dCol: c,  dRow: 4  });   // ring 1: row +4
  for (let c = -2; c <= 5; c++) out.push({ dCol: c,  dRow: -2 });   // ring 2: row -2
  for (let r = -1; r <= 4; r++) out.push({ dCol: -2, dRow: r  });   // ring 2: col -2
  for (let r = -1; r <= 4; r++) out.push({ dCol: 5,  dRow: r  });   // ring 2: col +5
  for (let c = -2; c <= 5; c++) out.push({ dCol: c,  dRow: 5  });   // ring 2: row +5
  return out;
};
export const REACH_OFFSETS = buildReachOffsets();             // 20 + 28 = 48

/** Each offset converted to a raw DamageGrid buffer-index delta. One grid
 *  row down is exactly ROW_STRIDE (0x30) apart in that array, per
 *  collision.js's own `cellIndex`. */
const REACH_INDEX_DELTA = REACH_OFFSETS.map((o) => o.dCol + o.dRow * ROW_STRIDE);

/**
 * DISPLACEMENT_TABLE — the parallel 48-entry {dx,dy} steer table (DS:0xda68).
 * ⚠️ THIS SESSION'S SPEC DID NOT SUPPLY THE 48 REAL VALUES — only the
 * CURSOR-DRIFT MECHANISM around them (see `stageAttack` below) was given.
 * Rather than invent numbers with no basis, this table is each
 * REACH_OFFSETS entry scaled to pixels (dCol/dRow * CELL) — directionally
 * sane (it steers roughly toward wherever the hit was found) and it keeps
 * the drift bug fully testable, since the bug is about WHICH INDEX gets
 * read, not what any particular index contains. A future pass with the real
 * DS:0xda68 bytes need only replace this array; nothing else here depends on
 * its exact contents. UNKNOWN_e4e2_displacement_values.
 */
export const DISPLACEMENT_TABLE =
  REACH_OFFSETS.map((o) => ({ dx: o.dCol * CELL, dy: o.dRow * CELL }));

/**
 * CS:0xe487 -> FUN_1000_e4e2 — stage 3. Exported but deliberately NOT wired
 * into `tick()`'s live pipeline — see the file header and the comment inside
 * `tick()` itself, right at the point (between its `stageAccelerate` and
 * `stageSpeedClamp` calls) where a future integration pass inserts a call to
 * this function, once it can supply a DamageGrid and the snapped camera.
 *
 * ⚠️ THE DISPLACEMENT CURSOR DRIFTS, DELIBERATELY REPRODUCED, NOT "FIXED".
 * It starts at 0 and advances by ONE ON EVERY SCAN STEP — hit or miss —
 * and is NEVER reset mid-scan. A hit reads DISPLACEMENT_TABLE at the
 * cursor's value AT THAT MOMENT (i.e. before that same step's own
 * increment), so a hit on the very first probed cell reads index 0 cleanly,
 * while a later hit reads whatever index the elapsed step count has
 * drifted the cursor to by then — almost certainly NOT the "next" table
 * entry. Only the FIRST of up to two hits ever steers anything (see the
 * return value below); the second is still tracked in the returned `hits`
 * array purely so this drift is independently checkable without changing
 * the entity's own observable motion — matching this project's own habit
 * of exposing a bug's mechanism for verification even where its gameplay
 * effect is nil (see pathfind-producers.js's own `UNKNOWN_fb1a_cx_intent`
 * for the same shape of thing).
 *
 * @param {EntityA} entity
 * @param {{attackGate:number, stepCap:number}} desc  descriptor +0xf and
 *   +0xc — `+0xc` (`desc.stepCap`) is the SAME field stage 2
 *   (`stageAccelerate`) already reads as its own second argument; it is
 *   reused here verbatim, not duplicated under a second `stepCap2` name.
 * @param {{buf:Uint8Array}} grid  a collision.js DamageGrid, read directly
 *   via its public `buf` array (mirroring DamageGrid's own private `_at`
 *   bounds convention: `buf[si - GRID_LO]`) rather than through `scan()` —
 *   see this file's own import comment for why `scan()`'s clip prologue
 *   would be the wrong one here.
 * @param {{x:number,y:number}} camera  the snapped scroll origin
 * @returns {?{dx:number, dy:number, step:number, hits:Array<{step:number,
 *   cursor:number, dx:number, dy:number}>}} null when nothing was found (the
 *   gate was off, the budget ran out, or the probe ran off the grid before
 *   anything was found); otherwise the already-doubled-and-clamped steering
 *   delta from the FIRST hit, plus every hit found (up to 2) for inspection.
 */
export function stageAttack(entity, desc, grid, camera) {
  if (!desc.attackGate) return null;

  const budget = (0x10 - desc.attackGate) & 0xf;       // CS:0xE4FE-E503
  const STEP_CEILING = 0x2f;                           // CS's own CL seed, 47
  const steps = Math.min(budget, STEP_CEILING);

  const sx = entity.x - camera.x, sy = entity.y - camera.y;
  const entityIdx = cellIndex(sx, sy);                 // "the entity's own damage-grid cell"

  const found = [];
  let cursor = 0;                                      // the drifting displacement-table index
  for (let step = 0; step < steps; step++) {
    const idx = entityIdx + REACH_INDEX_DELTA[step % REACH_OFFSETS.length];
    if (idx < GRID_LO || idx >= GRID_HI) break;         // off the edge of the grid — stop entirely
    const tag = grid.buf[idx - GRID_LO];
    if (tag !== 0 && tag !== 0xfd) {
      /* A cell tagged EXACTLY 0xFD is never a valid target for this scan
       * (CS:0xe5b9) — see collision.js's own SPECIAL_TAGS: nothing in the
       * shipped game ever stamps that tag, so this branch is provably dead
       * on real data. Modelled faithfully anyway, per this project's own
       * standing practice for known-dead-but-real mechanisms. */
      const d = DISPLACEMENT_TABLE[cursor % DISPLACEMENT_TABLE.length];
      found.push({ step, cursor, dx: d.dx, dy: d.dy });
    }
    cursor++;                                           // unconditional — every step, hit or miss
    if (found.length >= 2) break;
  }
  if (found.length === 0) return null;

  entity.stepCap = 10;                                  // CS:0xE496 — the windup, entity +0x16
  entity.arrivedFine = false;

  const cap = desc.stepCap;                             // descriptor +0xc, stage 2's OWN cap operand
  const dx = clamp(found[0].dx * 2, -cap, cap);
  const dy = clamp(found[0].dy * 2, -cap, cap);
  entity.vx = entity.prevVx + dx;                        // blends onto the PRE-stage-2 velocity —
  entity.vy = entity.prevVy + dy;                        // see tick()'s own prevVx/prevVy snapshot

  return { dx, dy, step: found[0].step, hits: found };
}

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
 * emitters (CS:0x1fe7 / CS:0x2039, see enemy-shots.js) OR divert to the
 * DS:0xd2be line-hazard pool (CS:0xE5E4, see line-hazard.js). Returns a
 * muzzle descriptor when a shot should be emitted, a hazard-spawn descriptor
 * when a fragment should be, or null.
 *   fireByte = descriptor +0x6: low nibble = reload-rate value, 0 = can't
 *              fire at all; high nibble = EITHER the shot direction/config
 *              value stored into DS:0x206 (ordinary fire, negated when
 *              facing left) OR the line-hazard step count `n` (the divert) —
 *              the SAME field, read two different ways depending on
 *              `attackBits`.
 *   flags = descriptor +0x4 (big-endian word). Bits [5:4] are `attackBits`
 *           (CS:0xe67d `cx=(cx>>4)&3`): 0 fires an ordinary shot; 1, 2 or 3
 *           divert to the line-hazard pool instead (CS:0xe68d `jz e692 /
 *           jmp e5e4`) — checked BEFORE the reload/velocity gates below that
 *           only apply to the ordinary-fire branch.
 * ⚠️ The divert does NOT test `e.vx` — CS:0xe6a5's "silent once stopped"
 * check sits INSIDE the attackBits==0 branch (CS:0xe692 onward), never
 * reached when attackBits != 0. A hazard-throwing entity keeps throwing even
 * after it has arrived and its own velocity has decayed to zero.
 */
export function stageFacingAndFire(e, desc) {
  const fireByte = desc.fireByte;
  const loNibble = fireByte & 0xf;
  if (fireByte === 0 || loNibble === 0) return null;

  e.reloadTimer--;
  if (e.reloadTimer > 0) return null;
  e.reloadTimer = (0x10 - loNibble) << 2;         // CS:0xe670-e67a

  const attackBits = (desc.flags >> 4) & 3;        // CS:0xe67d
  if (attackBits !== 0) {
    const n = (fireByte >> 4) & 0xf;               // CS:0xe5f5/0xe61c — hi nibble
    return { hazard: true, attackBits, n, x: e.x, y: e.y };
  }

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
 * NOT ported (stage 3's attack, `stageAttack` below, isn't WIRED into
 * tick()'s pipeline yet — see the file header — and handlerB's default,
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
    /* strategy1's own bookkeeping (CS:0xe9da): which zone the last goal was
     * picked in, and whether that goal is still "fresh" (i.e. not yet
     * superseded by a later re-roll). -1 is this file's own existing
     * unset-sentinel convention (matching `strategy` above), used in place
     * of the given spec's literal `undefined`. Neither field has a named DS
     * address of its own — they are port-level bookkeeping for a decision
     * CS:0xe9da makes in registers on the fly, not persisted state in the
     * original entity record. */
    this.storedZone = -1;
    this.goalFresh = false;
    /* CS:0xE001's own pre-stage-2 velocity snapshot, captured by `tick()`
     * immediately before it calls `stageAccelerate`, specifically so stage 3
     * (`stageAttack`, not yet wired into `tick()` — see the file header) can
     * blend its own steering delta onto the velocity as it stood BEFORE
     * stage 2 ran, not stage 2's own output. Unused until that wiring
     * lands; harmless to keep current in the meantime. */
    this.prevVx = 0;
    this.prevVy = 0;
  }

  get alive() { return this.state > 0; }

  /**
   * One 15 Hz tick.
   * @param {{x:number,y:number}} hero  world position, per stage-1 chase (e7ca adds +8 to Y)
   * @param {{stepCap:number, speedCap:number, fireByte:number, flags:number,
   *          seedPair:number, seedWeight:number, zoneWeight?:number}} desc
   *   the group descriptor fields this stage needs — `flags` only for the
   *   attackBits divert, `zoneWeight` only for strategy 1 (see `strategy1`'s
   *   own header for why it is not yet parsed by spawn.js)
   * @param {() => number} draw  the shared random-table reader, DS:0x3836
   * @param {boolean} frozen  DS:0x2fa, "freezes aliens"
   * @param {?{x:number,y:number}} camera  the snapped scroll origin,
   *   DS:0xa/0xc. REQUIRED for strategies 1/2 to do anything at all; omitted
   *   (the default) reproduces this port's PRE-this-session behaviour of
   *   leaving the goal untouched for those two strategies. ⚠️ The one real
   *   call site (main.js) does not pass this yet — a documented integration
   *   gap, not an oversight; see the file header.
   * @param {?Array<{x:number,y:number,type:number}>} markers  screen-relative
   *   marker records (game/markers.js's own `MarkerList#entries`), for
   *   strategy 2 only — same "goal left untouched if omitted" fallback as
   *   `camera` above.
   * @returns {?({x:number,y:number,dir:number}|{hazard:true,attackBits:number,n:number,x:number,y:number})}
   *   a muzzle to fire from, a line-hazard spawn request, or null
   */
  tick(hero, desc, draw, frozen = false, camera = null, markers = null, grid = null) {
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
     * stays sticky, but the goal write still runs). Strategies 1 and 2
     * (`strategy1`/`strategy2`, above) need a `camera`; a caller that omits
     * it (or `markers` for strategy 2) gets the pre-this-session fallback of
     * leaving the goal untouched, rather than a throw. */
    if (this.strategy < 0) this.strategy = rollStrategy(desc.seedPair, desc.seedWeight, draw);
    if (this.strategy === 0) {
      this.goalX = hero.x;
      this.goalY = hero.y + 8;
    } else if (this.strategy === 1) {
      if (camera) strategy1(this, desc, camera, draw);       // CS:0xe9da
    } else if (this.strategy === 2) {
      if (camera) strategy2(this, markers, camera, draw);    // CS:0xe88c
    }

    /* CS:0xE001's own first act, before stage 2 runs, is a per-tick snapshot
     * of this entity's velocity — taken specifically so stage 3 (CS:0xe487,
     * `stageAttack` above, NOT called from this pipeline yet) can blend its
     * own steering delta onto the PRE-stage-2 value rather than stage 2's
     * own output. Captured here unconditionally — harmless while nothing
     * reads it yet — so a future pass wiring `stageAttack` in does not also
     * need to find and patch this exact spot. */
    this.prevVx = this.vx;
    this.prevVy = this.vy;

    /* Stage 2. */
    stageAccelerate(this, desc.stepCap);
    /* Stage 3, CS:0xe487 (`stageAttack`, above) — between stageAccelerate and
     * stageSpeedClamp, exactly where CS:0xE001 itself sequences it. Needs the
     * shared collision.js DamageGrid every projectile/creature contact test
     * already stamps, and the snapped camera; both are optional here so a
     * caller that has not wired them (yet) degrades to the pre-stage-3
     * behaviour rather than throwing. stageAttack already mutates
     * this.vx/vy/stepCap/arrivedFine directly — nothing further to do with
     * its return value except optional telemetry. `this.prevVx`/`this.prevVy`
     * were captured above for exactly this call. */
    if (camera && grid) stageAttack(this, desc, grid, camera);
    /* Stage 4. */
    stageSpeedClamp(this, desc.speedCap);
    /* Stage 5. */
    stageApply(this, frozen);
    /* Stage 6. */
    return stageFacingAndFire(this, desc);
  }
}

/** A fresh RNG-backed draw function, for callers that don't already have one. */
export const defaultDraw = (rng = new GodsRandom(1)) => () => rng.next();
