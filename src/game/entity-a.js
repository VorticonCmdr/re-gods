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
 *   marker-seek, now that game/markers.js exists) are BOTH implemented — see
 *   `strategy1`/`strategy2` below — and wired into the stage-1 dispatch
 *   inside `tick()`. ⚠️⚠️ CORRECTION, a later session: this section previously
 *   said main.js's one real call site didn't pass the `camera`/`markers`
 *   arguments either needs, leaving the goal untouched. That integration pass
 *   has since landed — main.js now calls `tick()` with a real snapped camera
 *   (`{x: cam.snapX, y: cam.snapY}`) and `markerList.entries` — so strategies
 *   1 and 2 are LIVE in the running port, not just implemented-but-dormant.
 *
 *   MEASURED, not guessed: using the real nibble/weight roll formula
 *   (CS:0xe748) against all 74 live shipped System-A descriptors (PALFILS
 *   +0xD58, all 8 files), the expected effective-strategy share is
 *   strategy 0 ~43%, strategy 1 ~31%, strategy 2 ~26%. Now that main.js
 *   passes camera/markers, that ~57% (strategies 1+2) actually pick and
 *   pursue a goal rather than standing still — the verify suite's own
 *   "measured EFFECTIVE strategy share" note should be re-read against the
 *   current call site rather than the pre-integration figure.
 *
 *   STEAL-AND-CARRY (CS:0xE88C/E90E/E99F/E0C1-E198/E25C-E282) is now ported
 *   for System A: `strategy2` bails on an already-carrying entity (the
 *   degenerate half of E88C's own redirect, see `strategy2`'s own header for
 *   the disclosed simplification), then attempts a theft (`stealAttempt` ->
 *   `searchAndSteal`) after setting its goal. `stepCarriedItem` (the
 *   ease-toward-carrier + probabilistic drop, CS:0xE0C1-E198) and the
 *   death-time drop (inside `tick()`'s own DYING branch, CS:0xE25C-E282) are
 *   both implemented, but — UNLIKE every other stage in this file —
 *   `stepCarriedItem` is deliberately NOT called from inside `tick()`: it
 *   mutates the shared object array via `objects.js`'s `dropCarriedItem`,
 *   which `tick()` has no popup/objects side-effect channel for beyond the
 *   one-shot `deathDropId` bookkeeping. main.js calls it once per entity,
 *   per tick, alongside `tick()` — see main.js's own per-entity loop.
 *   ⚠️ SCOPED TO SYSTEM A ONLY THIS PASS. System B's own mirror
 *   (CS:0xEF01/EFA2/EE13-EEB9) is a disclosed, separate gap: its own theft
 *   gate tests a genuine System-B-only global (DS:0x3cd) whose writer has
 *   not been located in this port, and inventing a per-entity substitute for
 *   an untraced global would be a guess dressed as a port. See entity.js.
 *
 * WHAT IS NOT PORTED
 *   ⚠️⚠️ CORRECTION, a later session: stage 3's attack/leap (`stageAttack`,
 *   CS:0xe487 -> FUN_1000_e4e2's 48-entry two-ring reach scan) was
 *   implemented but deliberately left unwired from `tick()`, pending a
 *   collision.js DamageGrid and the snapped camera from main.js. Both have
 *   since been threaded through — main.js's `e.tick(...)` call now passes a
 *   real `camera` and `grid`, and `tick()`'s own body calls `stageAttack`
 *   whenever both are present (see `tick()` below). System-A entities DO now
 *   attack in the live port. `UNKNOWN_sysA_attack_not_wired` is CLOSED.
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
 *                CS:0xff93)              +0x20/+0x22  carried item's own
 *   +0x0e        per-entity fire/reload         EASED position (CS:0xE0C1-8)
 *                timer (stage 6)         +0x24  sticky strategy byte
 *   +0x10        carried item TYPE,      +0x25  FINE arrival flag (8px)
 *                negative = not carrying +0x26  animation reseed countdown
 *                (CS:0xE99F/E0C1/E25C)   +0x27  facing (0 = last moved left,
 *   +0x12/+0x14  velocity X / Y                  1 = last moved right)
 *   +0x16        triple-duty: steering
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
/* Steal-and-carry (strategy2's own theft attempt, below) needs the object
 * array's own dead/type convention to skip already-consumed slots, and
 * markers.js's own MARKER_MAX clamp (CS:0xE91B-E996 walks at most 20). */
import { isDeadType } from './objects.js';
import { MARKER_MAX } from './markers.js';

/** Sticky-strategy sentinel: matches EntityB's WAITING convention of -2. */
export const EST = { FREE: 0, DYING: -1, WAITING: -2, MATERIALISING: -3 };
export const MATERIALISE_TICKS = 5;    // by analogy with System B — see file header

/* DYING is written by the contact routine (combat.js's creatureTouchesHero,
 * shared with System B — CS:0xff93/0xac59 are proven common to both systems).
 * `tick()`'s own DYING branch runs CS:0xE247's fade for every tick AFTER the
 * kill tick; the kill tick itself (frame still -1) is drawn by main.js's
 * render pass using the ordinary sprite formula, matching CS:0xE0B2/E0BB/
 * E241's own kill-tick draw (already documented in CLAUDE.md's
 * UNKNOWN_df62_full_flow closure — that routine is a DIFFERENT, earlier
 * stage of the same death sequence, not this one).
 *
 * ⚠️ System A's own fade is NOT System B's fade with different numbers —
 * three concrete divergences, all read fresh off CS:0xE247-E2EC this
 * session: DEATH_FRAMES_A is 17 (0x11), not System B's 7; the sprite base
 * is 0x5B (91), not System B's 0x6C (108); and the one-shot position cache
 * (CS:0xE251/E256) has NO `+8` bias at write time — unlike System B's own
 * `+8`-on-X-only write-time bias (CS:0xED84). The `+8`-on-BOTH-axes bias
 * System A's own group-elimination reward applies is instead baked in at
 * the REWARD'S OWN READ SITE (CS:0xDFC8-DFD2) — see main.js's own groupsA
 * reward-check loop, which is where that bias belongs, not here. */
export const isDyingA = (e) => e.state === EST.DYING;
export const DEATH_SPRITE_BASE_A = 0x5b;   // CS:0xE2D2 `add cx,0x5b` — flat, not a class lookup
export const DEATH_FRAMES_A = 17;          // CS:0xE2AF `cmp word[di+4],0x11`

/* CS:0xE247's own one-shot gate: `cmp word[di+4],0 / jns e2ac` skips the
 * cache (and, in the original, the carried-item drop and the [di+0x19]
 * rank-check — both NOT ported, see below) whenever frame is already >= 0,
 * so it fires exactly once, on the first tick() call that observes DYING
 * with frame still -1 (one tick AFTER the kill tick — the kill tick itself
 * never touches frame; see the header above). Mirrors entity.js's own
 * `deathCacheSeq` exactly, including why a monotonic counter stands in for
 * the original's single shared DS:0x202/0x204 scratch pair: main.js ticks
 * every group's entities in one flat loop, not per-group like CS:0xdf39. */
let deathCacheSeqA = 0;

/**
 * Resolve a System-A group's own elimination-reward drop position —
 * CS:0xDFC8-DFD2's own "freshest cached death" read, for main.js's own
 * `groupsA` reward loop. Same shape as entity.js's own `groupRewardPosition`
 * (see that function's header for the full same-tick-kill race this guards
 * against), but with System A's own bias arrangement: the cache itself is
 * RAW (no bias at write time, unlike System B's write-time +8-on-X), and
 * the +8 bias is applied HERE, on BOTH axes, matching CS:0xDFC8/DFD2 exactly
 * (`ax=[0x202]+8`, `bx=[0x204]+8`).
 */
export function groupRewardPositionA(members) {
  const src = members.reduce((a, b) => (b.deathCacheSeq > a.deathCacheSeq ? b : a));
  const bx = src.deathCacheSeq < 0 ? src.x : src.deathCacheX;
  const by = src.deathCacheSeq < 0 ? src.y : src.deathCacheY;
  return { x: bx + 8, y: by + 8 };
}

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
 * ⚠️ ALREADY-CARRYING BAIL/REDIRECT — DEGENERATE HALF ONLY, DISCLOSED.
 * CS:0xE88C's own entry, read fresh in a later session: `cmp word[di+0x10],0
 * / js e89c` (not carrying -> the goal-pick + steal below) `/ cmp dl,cl /
 * jnz e899 (-> jmp e769, RE-DISPATCH through the alternate strategy nibble)
 * / jmp e9da (bail, RET)` (carrying, alt==self -> bail). The redirect target
 * (`alt`) is recoverable on demand from `desc.seedPair`'s own two nibbles
 * without a new persisted field (`alt = this.strategy===lo ? hi : lo`), but
 * ACTUALLY re-dispatching mid-tick through another strategy's handler would
 * need restructuring tick()'s own stage-1 dispatch to call itself
 * recursively — out of scope for this pass and risky to bolt onto already-
 * tested strategy 0/1 code for a sub-behaviour orthogonal to steal-and-carry
 * itself. This port always takes the DEGENERATE branch instead (leave the
 * goal alone, skip the steal), which is exactly what the original itself
 * does whenever `alt===2` (redirects to itself) or the marker list is empty
 * (E892's own shared tail) — i.e. it is correct in those two cases and an
 * approximation otherwise.
 *
 * @param {EntityA} entity
 * @param {?Array<{x:number,y:number,type:number}>} markers  screen-relative
 *   marker records — e.g. a MarkerList's own `.entries` (game/markers.js)
 * @param {{x:number,y:number}} camera  the CURRENT snapped scroll origin
 * @param {() => number} rand  the shared replay-table draw
 * @param {?{flags:number}} desc  the group descriptor — `flags` (the raw
 *   +0x4 BE word) is read by `stealAttempt` below; omit only from a caller
 *   that also omits `objects` (steal disabled).
 * @param {?object[]} objects  the 200-slot runtime object array (see
 *   objects.js), for the theft attempt below. Omitting it (the default)
 *   skips the steal entirely rather than throwing — the same fallback shape
 *   `camera`/`markers` already use elsewhere in this file.
 */
export function strategy2(entity, markers, camera, rand, desc = null, objects = null) {
  if (entity.carriedType >= 0) return;                  // CS:0xE88C `js e89c` fails — see above
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

  /* CS:0xE8FB `call 0xE90E` — the theft attempt, run every time this branch
   * sets a fresh goal (not gated on the goal-pick's own outcome). */
  if (objects) stealAttempt(entity, markers, desc, camera, objects);
}

/** CS:0xE90E/0xE99F's shared 2-bit descriptor-flag test: ordinary categories
 *  read bits [1:0] of the group descriptor's own +0x4 BE word directly;
 *  weapon-range types (>=0xC0) read the SAME word shifted right 2, bits
 *  [3:2]. This is a DIFFERENT bit slice from `stageFacingAndFire`'s own
 *  attackBits (bits [5:4] of the same word) — three independent 2-bit
 *  fields packed into one descriptor word.
 *
 * EXPORTED because System B's own theft attempt (CS:0xEF39-0xEF4C, inside
 * `FUN_1000_ef01`, entity.js's own `stealAttemptB`) computes the IDENTICAL
 * formula on the identical bit positions, byte-for-byte — confirmed by a
 * fresh disassembly of CS:0xEF39-EF4C, not assumed from the System-A shape.
 * One shared function for both systems rather than two copies that could
 * drift apart. */
export function stealFlagBits(flags, type) {
  return type >= 0xC0 ? (flags >> 2) & 3 : flags & 3;
}

/**
 * CS:0xE90E — the theft attempt: walk the marker list front-to-back looking
 * for the FIRST marker both eligible (nonzero `stealFlagBits`) and within a
 * 48x48 box of the entity, then hand it to `searchAndSteal`. Stops after the
 * first eligible-AND-proximate marker either way (steal success or miss) —
 * CS:0xE996's own `ret`, not a fall-through to the next marker.
 *
 *   E90E  bail if marker count==0 or already carrying (mirrors strategy2's
 *         own bail — redundant here, kept for callers that invoke this
 *         directly rather than through strategy2)
 *   E912  entityX = e.x-8, entityY = e.y-8 (computed ONCE, not per-marker)
 *   E91B..E996  for i in 0..min(count,20): bits = stealFlagBits(flags,
 *         marker.type); bits===0 -> skip (can't steal this category);
 *         else boxX = marker.x+8+camera.x, boxY = marker.y+8+camera.y;
 *         proximity: boxX-48 <= entityX <= boxX (ditto Y); on pass, the
 *         marker's world pos WITHOUT the +8 bias (worldX = marker.x+
 *         camera.x, worldY = marker.y+camera.y) feeds searchAndSteal.
 *
 * NOTE on eligibility being "per-marker": `flags` is read from the group
 * DESCRIPTOR, not from the marker itself — `stealFlagBits(flags, marker.
 * type)` varies only through `marker.type`, and in this port every marker
 * markers.js's stepMarkers ever produces has `cat < 3` (weapons, type>=0xC0,
 * are filtered out at the marker-production stage — see markers.js's own
 * header). So `stealFlagBits` collapses to the SAME `flags & 3` value for
 * every marker in the loop this port can ever observe: either every marker
 * this entity sees is eligible, or none are. There is no genuine per-marker
 * distinction to find here — don't go looking for one; it can't exist while
 * stepMarkers keeps its weapon-skip.
 *
 * @param {EntityA} entity
 * @param {Array<{x:number,y:number,type:number}>} markers  screen-relative
 * @param {?{flags:number}} desc  group descriptor; a missing `desc` (or a
 *   missing `flags`) reads as an all-zero flag word — every marker then
 *   fails the eligibility test, matching CS:0xE90E's own "bits===0 -> skip"
 *   for a group with no theft-eligible categories at all.
 * @param {{x:number,y:number}} camera
 * @param {object[]} objects  the 200-slot object array (objects.js)
 */
export function stealAttempt(entity, markers, desc, camera, objects) {
  if (!markers || markers.length === 0) return;
  if (entity.carriedType >= 0) return;

  const flags = desc ? (desc.flags ?? 0) : 0;
  const entityX = entity.x - 8;
  const entityY = entity.y - 8;
  const count = Math.min(markers.length, MARKER_MAX);
  for (let i = 0; i < count; i++) {
    const marker = markers[i];
    if (stealFlagBits(flags, marker.type) === 0) continue;   // e996 — can't steal this category

    const boxX = marker.x + 8 + camera.x;
    const boxY = marker.y + 8 + camera.y;
    if (entityX < boxX - 48 || entityX > boxX) continue;
    if (entityY < boxY - 48 || entityY > boxY) continue;

    searchAndSteal(entity, objects, marker.type, marker.x + camera.x, marker.y + camera.y);
    return;                                               // CS:0xE996 `ret` — first match only
  }
}

/**
 * CS:0xE99F — walk the 200-slot object array BACKWARD looking for a live
 * object exactly matching `type`/`worldX`/`worldY`; on a match, kill the
 * object and carry it (`carriedX/Y/Type`). Silent no-op if nothing matches
 * after the whole array — the original's own `ret` with no side effect.
 *
 * @param {EntityA} entity
 * @param {object[]} objects  the 200-slot runtime array, objects.js's own
 *   `{x, y, type, flag6, dead, slot}` representation
 * @param {number} type
 * @param {number} worldX
 * @param {number} worldY
 */
export function searchAndSteal(entity, objects, type, worldX, worldY) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.dead || isDeadType(o.type) || !(o.flag6 & 1)) continue;
    if (o.type === type && o.x === worldX && o.y === worldY) {
      entity.carriedX = worldX;
      entity.carriedY = worldY;
      entity.carriedType = type;
      o.dead = true; o.type = 0xffff; o.flag6 = 0;        // CS:0xE99F's own kill
      return;
    }
  }
}

/**
 * CS:0xE0C1-0xE198 — carried-icon ease, then a probabilistic drop back into
 * the world. Runs every tick an entity is carrying something, independent
 * of which stage-1 strategy is currently active (the original's own
 * alive-branch draw routine, a different call site from the six-stage
 * movement pipeline `tick()` already ports — see the file header). Not
 * called from `tick()` itself: the drop mutates the shared object array,
 * which `tick()` otherwise never touches directly (`stealAttempt` above is
 * the one exception, itself gated behind an explicit `objects` argument) —
 * main.js calls this once per entity, per tick, alongside `tick()`.
 *
 * EASE, CS:0xE0C1-E0E8: halve the remaining distance to (x+8, y+24) via an
 * ARITHMETIC right shift (SAR — floors toward -infinity on a negative
 * delta, not a truncating `/2`), every tick regardless of the drop roll.
 *
 * DROP, CS:0xE0EB-E198: ordinary items test descriptor `flags & 3` (0 -> drop
 * now, 2 -> never, else a 1-in-128 roll); weapons test `flags & 0xC` against
 * 0/8 the same way (CS:0xE14A-E198's own mirror) — kept as the literal
 * unshifted mask/compare rather than normalised to a shifted 0..3 value,
 * matching the actual bytes rather than `stealFlagBits`'s own different
 * (shifted) reading of the same word.
 * ⚠️ Weapons are UNREACHABLE via this port's marker producer
 * (markers.js:166 skips type>=0xC0), so `entity.carriedType` can never be
 * a weapon in practice and the `&0xC` branch below is implemented for
 * fidelity, not exercised by normal play — see `stealAttempt`'s own header
 * for the identical caveat on the theft side.
 *
 * @param {EntityA} entity
 * @param {{flags:number}} desc
 * @param {() => number} rand
 * @returns {?{id:number, x:number, y:number}} a drop request — `id` already
 *   carries the +0xB/-0xC0 bias `objects.js`'s `dropCarriedItem` expects —
 *   or null if nothing carried, or carried but not dropped this tick.
 */
export function stepCarriedItem(entity, desc, rand) {
  if (entity.carriedType < 0) return null;              // CS:0xE0C1 `js` — not carrying

  const targetX = entity.x + 8, targetY = entity.y + 24;
  entity.carriedX += (targetX - entity.carriedX) >> 1;
  entity.carriedY += (targetY - entity.carriedY) >> 1;

  const isWeapon = entity.carriedType >= 0xC0;
  const bits = isWeapon ? (desc.flags & 0xc) : (desc.flags & 3);
  const never = isWeapon ? 8 : 2;
  let drop;
  if (bits === 0) drop = true;                          // e12f/e17d — drop now
  else if (bits === never) drop = false;                 // e149 — never
  else drop = (rand() & 0x7f) === 0;                     // 1-in-128 roll

  if (!drop) return null;

  const id = isWeapon ? entity.carriedType - 0xC0 : entity.carriedType + 0xB;
  // Drop lands at the CARRIED ICON's own eased position (carriedX/Y above),
  // not the entity's own (x, y) — System A's icon visibly trails the entity
  // by up to half the remaining distance each tick, so a drop can land
  // noticeably behind where the entity currently stands. System B does the
  // OPPOSITE on BOTH counts: CS:0xEEBA recomputes the carried icon's screen
  // position fresh every frame from a fixed per-class attach-point offset (a
  // rigid attach, not an eased trail) via carryOffsetB, AND its own drop
  // uses a third, separate raw (entity.x+8, entity.y) point rather than that
  // attach position — see entity.js's stepCarriedItemB and CLAUDE.md's own
  // "Steal-and-carry, System B" section for the three-position breakdown.
  const x = entity.carriedX, y = entity.carriedY;
  entity.carriedType = -1;                               // [di+0x10] = 0xffff
  return { id, x, y };
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
 * 0xe21a (world 4). Handler pointers are recorded for provenance; stage 3's
 * attack (`stageAttack` below) IS now wired into `tick()`'s pipeline — see
 * the file header's `UNKNOWN_sysA_attack_not_wired` closure. Still not
 * modelled: handlerB's default, 0xbc4b, a generic "fire toward my last
 * direction of travel" behaviour this port does not reproduce beyond stage
 * 6's own facing/fire.
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
    /* +0x19 — NOT a bare gate flag despite the name. CS:0xE72D stamps this
     * with the group-runtime reroll-throttle counter's OWN value at the
     * moment stage 1 (CS:0xe6e4) grants this entity a strategy reroll — a
     * "my rank in this group's reroll queue this tick" number, read
     * ordinally by TWO consumers: stageAccelerate's fine-arrival gate above
     * (0 or 1 skip it, anything else arms it) and, at death, CS:0xE247's own
     * rank-1 check (only the entity stamped exactly 1 triggers a
     * synchronized whole-group strategy reset via CS:0xEBB9). This port
     * never implements the reroll-throttle mechanism that would set it
     * nonzero (see stageAccelerate's own header), so it stays 0 for the
     * life of every entity and BOTH consumers are provably unreachable —
     * the death-time rank-check/CS:0xEBB9 branches are correspondingly not
     * ported below. Kept named `fineGate` rather than renamed, since that is
     * still an accurate name for its one LIVE consumer in this port. */
    this.fineGate = 0;
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
    /* Steal-and-carry, CS:0xE99F/CS:0xE0C1-E198/CS:0xE25C-E282 — [di+0x10]/
     * [di+0x20]/[di+0x22]. Negative = carrying nothing, the same convention
     * `state`/`strategy` already use in this file. carriedX/Y are the
     * carried icon's OWN eased position (System A eases toward the entity;
     * System B rigidly attaches instead via carryOffsetB, with no easing —
     * see CLAUDE.md's "Steal-and-carry, System B" section and entity.js's
     * own stealAttemptB/carryOffsetB/stepCarriedItemB for that mirror,
     * ported in full). */
    this.carriedType = -1;
    this.carriedX = 0;
    this.carriedY = 0;
    /* Port-level bookkeeping for the death-time drop (CS:0xE25C-E282, the
     * DYING branch below): tick() records the request here, once, the same
     * tick it caches deathCacheX/Y; main.js drains it into popup.js exactly
     * like it already drains groupsA/groupsB's own reward requests. Not a
     * DS address of its own — there is no persistent original field to name,
     * since the original calls CS:0xBF5F directly from inside the death
     * branch and this port's tick() has no popup instance to call. */
    this.deathDropId = null;
    this.deathDropX = 0;
    this.deathDropY = 0;
    /* CS:0xE251/E256's own one-shot cache — RAW, no bias (unlike System B's
     * write-time `+8`-on-X-only). See DEATH_FRAMES_A's own header for why. */
    this.deathCacheX = null;
    this.deathCacheY = null;
    this.deathCacheSeq = -1;
    /* CS:0xE001's own pre-stage-2 velocity snapshot, captured by `tick()`
     * immediately before it calls `stageAccelerate`, specifically so stage 3
     * (`stageAttack`, now wired into `tick()` — see the file header) can
     * blend its own steering delta onto the velocity as it stood BEFORE
     * stage 2 ran, not stage 2's own output. */
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
   *   DS:0xa/0xc. REQUIRED for strategies 1/2 to do anything at all, and
   *   (together with `grid`) for stage 3's attack/leap; omitted (the
   *   default) falls back to leaving the goal untouched for those two
   *   strategies and skipping the attack, matching the original's own
   *   off-screen-entity behaviour. main.js's real call site passes a live
   *   snapped camera, so this default only matters for callers that omit it
   *   deliberately (e.g. tests isolating one stage).
   * @param {?Array<{x:number,y:number,type:number}>} markers  screen-relative
   *   marker records (game/markers.js's own `MarkerList#entries`), for
   *   strategy 2 only — same "goal left untouched if omitted" fallback as
   *   `camera` above.
   * @param {?object[]} objects  the 200-slot runtime object array
   *   (objects.js), for strategy 2's own theft attempt only. Omitted (the
   *   default) skips the steal for this tick, matching every other optional
   *   arg's "degrade, don't throw" fallback in this method.
   * @returns {?({x:number,y:number,dir:number}|{hazard:true,attackBits:number,n:number,x:number,y:number})}
   *   a muzzle to fire from, a line-hazard spawn request, or null
   */
  tick(hero, desc, draw, frozen = false, camera = null, markers = null, grid = null, objects = null) {
    /* Pre-life FSM — see UNKNOWN_sysA_prelife_driver in the file header. */
    if (this.state === EST.WAITING) {
      if (--this.timer <= 0) { this.state = EST.MATERIALISING; this.timer = MATERIALISE_TICKS; }
      return null;
    }
    if (this.state === EST.MATERIALISING) {
      if (--this.timer <= 0) { this.state = this.hp; this.timer = 0; }
      return null;
    }
    /* CS:0xE2EC's own dispatch — reached from the outer per-entity loop
     * (CS:0xDF94-DF9F) for any state <= 0 OTHER than the two pre-life
     * sentinels above: an UNCONDITIONAL jmp to CS:0xE247 with NO lower-bound
     * comparison at all (⚠️ CORRECTS an earlier revision of CLAUDE.md's own
     * UNKNOWN_sysA_dormant_respawn section, which read this branch as
     * "state <= -4" — the actual bytes are `cmp -2/jz` then `cmp -3/jz` then
     * a bare `jmp`, matching ANY other value, -1 included).
     *
     * ⚠️ In the ORIGINAL, that unconditional jmp is reached by literally any
     * non -2/-3 negative, because -2/-3 there mean dormant/reawaken (a live
     * entity parked mid-life) — a DIFFERENT mechanism this port never
     * produces (see CLAUDE.md's own disclosure). In THIS port, -2/-3 are
     * instead WAITING/MATERIALISING (pre-life, handled above) — a genuine
     * value collision between the two unrelated mechanisms.
     *
     * Checked whether combat.js can actually hand this branch anything other
     * than -1: it can't. Both combat paths FORCE the state to exactly -1 on
     * any kill — combat.js:461 (`if (killed) entity.state = -1;`) for the
     * weapon-vs-creature grid scan, and attackHero's own `strengthOut`
     * (either the unchanged input or a forced -1) for hero-contact — which
     * mirrors CS:0xABA7 `mov bp,0xffff`, itself reached from BOTH the `js`
     * and `jz` arms of the original's own <=0 test (CLAUDE.md's own
     * "The death path forces BP negative" — [PROVEN]). So no live path here
     * ever produces -2/-3 for an already-alive entity; the WAITING/
     * MATERIALISING checks above would intercept them first regardless.
     *
     * Still test EST.DYING by exact equality rather than `state < 0`: it
     * matches entity.js's own convention and isDyingA above, and it keeps
     * this branch honest (falling through to the FREE/DYING catch-all below,
     * not the pre-life FSM) if combat.js's forcing is ever relaxed —
     * defense-in-depth against a value collision, not a fix for a reachable
     * bug. */
    if (this.state === EST.DYING) {
      if (this.frame === -1) {                              // CS:0xE24F `jns`
        this.deathCacheX = this.x;                            // CS:0xE251 — NO bias
        this.deathCacheY = this.y;                             // CS:0xE256 — NO bias
        this.deathCacheSeq = deathCacheSeqA++;
        /* CS:0xE25C-E282 — the carried-item death-time drop, via popup.js
         * (CS:0xBF5F), NOT the periodic-drop's CS:0xC041 — a real asymmetry
         * this project's own decode of the original establishes, not a port
         * simplification: the original calls bf5f here and c041 in
         * stepCarriedItem's own drop roll. `id` uses the SAME +0xB/-0xC0
         * bias both drop sites share; popup.js's own id convention decodes
         * it identically to C041's. Recorded here, drained by main.js — see
         * `deathDropId`'s own header in the constructor for why. Uses
         * carriedX/carriedY (the icon's own eased position), matching
         * CS:0xE25C/E259's own `ax,bx=[di+0x20]/[di+0x22]` read.
         * CS:0xE283-E2A9 (the [di+0x19] rank-check / EBB9 group-reset) still
         * hangs off this SAME one-shot gate in the original and is still
         * NOT ported — fineGate's own header above already establishes it
         * is provably unreachable in this port regardless of steal-and-carry. */
        if (this.carriedType >= 0) {
          const isWeapon = this.carriedType >= 0xC0;
          this.deathDropId = isWeapon ? this.carriedType - 0xC0 : this.carriedType + 0xB;
          this.deathDropX = this.carriedX;
          this.deathDropY = this.carriedY;
          this.carriedType = -1;
        }
      }
      this.frame++;                                          // CS:0xE2AC, unconditional
      if (this.frame >= DEATH_FRAMES_A) {                     // CS:0xE2AF/E2B3
        this.state = EST.FREE; this.delay = 0;                // CS:0xE2B5/E2BA
      }
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
      if (camera) strategy2(this, markers, camera, draw, desc, objects);   // CS:0xe88c
    }

    /* CS:0xE001's own first act, before stage 2 runs, is a per-tick snapshot
     * of this entity's velocity — taken specifically so stage 3 (CS:0xe487,
     * `stageAttack` above) can blend its own steering delta onto the
     * PRE-stage-2 value rather than stage 2's own output. */
    this.prevVx = this.vx;
    this.prevVy = this.vy;

    /* Stage 2. */
    stageAccelerate(this, desc.stepCap);
    /* Stage 3, CS:0xe487 (`stageAttack`, above) — between stageAccelerate and
     * stageSpeedClamp, exactly where CS:0xE001 itself sequences it. Needs the
     * shared collision.js DamageGrid every projectile/creature contact test
     * already stamps, and the snapped camera; both are optional here so a
     * caller that omits them (e.g. a test isolating an earlier stage)
     * degrades to the pre-stage-3 behaviour rather than throwing — main.js's
     * own call site passes both. stageAttack already mutates
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
