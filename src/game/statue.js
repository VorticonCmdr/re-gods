/* statue.js — the awakened statue: a scripted hazard exclusive to WORLD 1,
 * SUBLEVEL B.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────
 *
 * A decorative two-tile statue baked into world 1's sublevel-B map data
 * (plane A tiles 0x23/0x24). Once the tile scrolls on screen — and the hero
 * is not already standing on top of it — it has a randomised chance each
 * visit to replace itself with plain decor tile 0x0D and spawn a homing,
 * damage-dealing creature in its place. Three separate CS: addresses, three
 * separate concerns:
 *
 *   CS:0x7E9B   THE POPULATOR — scans the WHOLE of plane A once per level
 *               (re)load and records every 0x23/0x24 cell, but ONLY in
 *               world 1 sublevel B. Everywhere else the table is empty.
 *   CS:0x7CBD   THE TRIGGER — once per game tick, advances a persistent
 *               cursor by one record and decides whether THAT record wakes:
 *               on-screen test, then a "don't wake on top of the hero" probe
 *               (with a health-snapshot/restore trick so the probe itself
 *               can never hurt the hero), then a random gate.
 *   CS:0x7B68   THE LIVE STATUE — movement (ratchet-steer toward the hero),
 *   CS:0x7C4B   animation (a state-doubles-as-countdown split at state 4),
 *   CS:0x7C7C   and contact/death (hero-touch one-shots it; otherwise a
 *               weapon hit can wound or kill it), for a SEPARATE 10-slot
 *               runtime pool of awakened statues.
 *
 * ── DS:0x8014 IS A RED HERRING FOR A PORT ─────────────────────────────────
 * This project's own CLAUDE.md calls the trigger table "DS:0x8014" — but
 * that exact memory is ALSO the world-2 nest creature's brood-child array
 * (see nest.js's own BROOD_ARRAY_DS = 0x8014 and its closing note: "DS:0x8014
 * IS ITSELF SHARED... a WORLD-1 subsystem owns the same 256 bytes"). The two
 * are mutually exclusive by world in the original, which is exactly why
 * nothing in DOS needed to interlock them — a real memory-layout accident,
 * not a game rule. A JS port has no shared memory to economise on, so this
 * module owns its OWN array (`this.records`) and does not attempt to
 * reproduce the address collision. Reproducing it would be modelling a DOS
 * memory-allocation coincidence, not game behaviour.
 *
 * ── THE INJECTION PATTERN, matching nest.js ───────────────────────────────
 * This module never imports combat.js. It receives:
 *   `contact`   a `(box) => strengthOut` callback, EXACTLY nest.js's own
 *               `contact` convention: box = {x, y, w, h, hp}, in WORLD
 *               coordinates; the callback is expected to internally call
 *               combat.js's `attackHero` (or `creatureTouchesHero`) bound to
 *               the real hero + Health, and return the CS:0xac59 `strengthOut`
 *               (negative on a REPORTED hit, unchanged `hp` on a miss). See
 *               main.js's own `nestContact` for the shape the real closure
 *               will take.
 *   `scanGrid`  OPTIONAL. A `(entity) => {killed, ...}` callback matching
 *               combat.js's `creatureScansGrid` MUTATION contract: it is
 *               expected to mutate `entity.state` in place (exactly the way
 *               `creatureScansGrid` mutates `entity.state` today) and report
 *               whether that mutation killed it. frame.js's own
 *               `stepCreatureDamage` is the two-step "try contact, on miss
 *               try the weapon grid" chain this mirrors — see its header —
 *               but that function is typed for entity.js/entity-a.js's own
 *               frame/delay fields, which this creature does not have, so
 *               the shape is reproduced here rather than reused directly.
 *
 * ── A DELIBERATE JUDGMENT CALL: THE SCORE/POPUP CONVENTION ────────────────
 * The task this module was written against asserted nest.js already has "its
 * own 1000-point kill reward" to copy. IT DOES NOT: nest.js's own kill path
 * (`#death`) only does `this.killed++` — it never touches any Score, and no
 * popup module exists anywhere in this project's `src/game/` yet (checked by
 * grep). So there is no existing convention to copy verbatim. What IS
 * established, and what this module follows instead, is treasure.js's own
 * shape for surfacing an award: return `{score: N}` as PLAIN DATA from the
 * event that caused it (see `collectTreasure`'s own `score: gained` field)
 * rather than mutate a `Score` instance directly, since accepting a `Score`
 * here would be a new, uninvited coupling this module does not otherwise
 * need. `step()` therefore returns a per-tick `score` (this tick's award, in
 * the raw units `Score#add` expects) and a `popups` array of `{id, x, y}`
 * descriptors — plain data, exactly as this task's own instructions permit
 * ("a callback or a returned {score: N} field is fine... just return a plain
 * {popupId: N} descriptor... do NOT invent your own popup rendering").
 */

/* ── The world/sublevel this hazard exists in at all ──────────────────────
 * CS:0x7EB6 (populator) / CS:0x7CBD (trigger, its own independent gate). */
export const STATUE_WORLD = 1;
/** CS:0x7EAB — `cmp byte[sublevel],0 / jz`; sublevel 0 is 'a', so this is 'b'. */
export const STATUE_SUBLEVEL = 'b';

/* ── The map, restated locally rather than imported ───────────────────────
 * This project's own CLAUDE.md: "The world is 128 columns x 64 rows of
 * 32x16px tiles... row*128+col addresses a cell" — matches formats/map.js's
 * own MAP_COLS/MAP_ROWS exactly. Kept local (no import) to stay as
 * self-contained as nest.js/destructible.js, which do the same. */
export const MAP_COLS = 128;
export const MAP_ROWS = 64;
export const PLANE_SIZE = MAP_COLS * MAP_ROWS;   // 8192

/* ── THE POPULATOR, CS:0x7E9B ──────────────────────────────────────────── */
export const TILE_A = 0x23;                 // CS:0x7EBD
export const TILE_B = 0x24;                 // CS:0x7EC1
/** CS:0x7EC7 `cmp bp,0x20` — the fixed-size backing table's own capacity. */
export const RECORDS_MAX = 32;

/**
 * CS:0x7E9B. Scans the WHOLE of plane A and records every 0x23/0x24 cell —
 * but only in world 1 sublevel B (CS:0x7EAB/0x7EB6); everywhere else this
 * produces zero records, which is the single most important invariant here.
 *
 * @param {Uint8Array} planeA
 * @param {number} world      DS:0x42
 * @param {string} sublevel   'a' or 'b'
 * @returns {Array<{tileCol:number, tileRow:number, fired:boolean, matchedTileId:number}>}
 */
export function populateStatueTable(planeA, world, sublevel) {
  const records = [];
  if (world !== STATUE_WORLD || sublevel !== STATUE_SUBLEVEL) return records;  // CS:0x7EAB/0x7EB6
  for (let off = 0; off < PLANE_SIZE; off++) {
    const tile = planeA[off];                                    // CS:0x7EB5 `lodsb`
    if (tile !== TILE_A && tile !== TILE_B) continue;             // CS:0x7EBD/0x7EC1
    if (records.length >= RECORDS_MAX) break;                     // CS:0x7EC7
    records.push({
      tileCol: off & (MAP_COLS - 1),         // CS:0x7EEA — off & 0x7F
      tileRow: off >> 7,                     // CS:0x7ED9 — off >> 7 (stride 128 = 2^7)
      fired: false,                          // CS:0x7EF0
      matchedTileId: tile,                   // CS:0x7EF8
    });
  }
  return records;
}

/* ── THE TRIGGER, CS:0x7CBD ────────────────────────────────────────────── */

/** CS:0x7CFA/0x7D04 — the on-screen window is STRICTLY open at all four
 *  edges: (camTileCol, camTileCol+9) x (camTileRow, camTileRow+11). */
export const WINDOW_COLS = 9;
export const WINDOW_ROWS = 11;

/**
 * CS:0x7CF2-0x7D04. True when the record's tile is strictly inside the
 * camera's own visible tile window, open at both ends on both axes.
 */
export function inStatueWindow(tileCol, tileRow, camTileCol, camTileRow) {
  if (tileCol <= camTileCol) return false;                       // CS:0x7CF2
  if (tileRow <= camTileRow) return false;                       // CS:0x7CF6
  if (tileCol >= camTileCol + WINDOW_COLS) return false;          // CS:0x7CFA
  if (tileRow >= camTileRow + WINDOW_ROWS) return false;          // CS:0x7D04
  return true;
}

/* CS:0x7D30 — the wake-trigger's own PURE PROBE, distinct from the live
 * statue's 32x32 contact box below. Strength is irrelevant (only hit/miss
 * matters), so it is a named constant rather than something meaningful to
 * tune. */
export const WAKE_PROBE_BOX = Object.freeze({ w: 48, h: 48, dx: -8, dy: -8 });
export const WAKE_PROBE_STRENGTH = 50;

/** CS:0x7D80 — the random gate. `roll` is one raw 0..0xFFFF draw from the
 *  shared table (GodsRandom#next). ~24.4% (16001/65536) pass. */
export const WAKE_GATE = 0x3e80;             // 16000
export const wakeRollPasses = (roll) => roll <= WAKE_GATE;

/** CS:0x7DD8/0x7DDB — the decorative tile a woken statue leaves behind, in
 *  BOTH the tile it occupied and the one row below it (the statue art is two
 *  tiles tall). */
export const WAKE_DECOR_TILE = 0x0d;

/** The runtime pool's initial state — doubles as HP/countdown. */
export const WAKE_STATE = 32;

/**
 * CS:0x7DD6-0x7DEC — the wake seed, keyed by which tile actually matched.
 * Tile 0x23 seeds a plain upward drift with no positional nudge; tile 0x24
 * (or, per the decode's own "or anything else" fallback, ANY other value —
 * this can only ever be 0x23/0x24 in practice, since the populator's own
 * match set is exactly those two, but the fallback is kept verbatim rather
 * than narrowed to an assertion) seeds a downward drift with a genuine,
 * deliberate 1px X nudge.
 */
export function seedForWake(matchedTile, worldX, worldY) {
  if (matchedTile === TILE_A) {
    return { x: worldX, y: worldY, state: WAKE_STATE, stepX: 0, stepY: -4, phase: 0 };
  }
  return { x: worldX + 1, y: worldY, state: WAKE_STATE, stepX: 2, stepY: 4, phase: 2 };
}

/* ── THE LIVE STATUE, CS:0x7B68 (movement) / CS:0x7C4B (animation) /
 *    CS:0x7C7C (contact + death) ─────────────────────────────────────────── */

/** CS:0x7B68's ratchet steer: +/-1 per tick toward `target`, clamped. Shared
 *  shape for both axes; the CLAMPS differ (X: [-3,3], Y: [-4,4] — kept as
 *  separate min/max args rather than a shared constant pair, because the
 *  asymmetry is real and a shared constant would invite collapsing it). */
export function steerStep(pos, target, step, min, max) {
  return pos <= target ? Math.min(step + 1, max) : Math.max(step - 1, min);
}
export const STEP_X_MIN = -3, STEP_X_MAX = 3;
export const STEP_Y_MIN = -4, STEP_Y_MAX = 4;

/** State<=16 is the steerable range; above it (fresh off WAKE_STATE=32) the
 *  statue sits still for its first (32-16)=16 tock-gated ticks. */
export const STEER_MAX_STATE = 16;

/** CS:0x7C4B — above this, `state` counts down each "on" tock; at or below
 *  it, the countdown stops and `phase` free-runs the idle cycle instead. */
export const COUNTDOWN_FLOOR = 4;
export const PHASE_MASK = 3;                 // (phase+1) & 3 — a 4-frame cycle

/**
 * ⚠️ CORRECTS AN EARLIER PASS OF THIS PROJECT. A prior pass speculated an
 * EIGHT-entry idle table (450,451,452,451,456,457,458,457 — "two idle
 * cycles, one per tile variant"). This session's fresh trace of the actual
 * consumer refutes that: the phase index is masked to exactly 0..3
 * ((phase+1)&3), so entries past index 3 are NEVER READ. Both tile-0x23 and
 * tile-0x24 statues share this IDENTICAL 4-sprite table, differing only in
 * their starting phase (0 vs 2, see seedForWake) and their initial
 * stepX/stepY. Facing-right sprites are therefore 453,454,455,454 — NOT
 * 456/457/458 as the earlier guess had it. DS:0xdf68, verified live in-game
 * by a prior pass (for the first 4 entries only).
 */
export const IDLE_TABLE = Object.freeze([450, 451, 452, 451]);
/** `if (stepX >= 0) sprite += 3` — the standard left/right facing offset. */
export const FACING_OFFSET = 3;

/**
 * ⚠️ CORRECTS AN EARLIER, LESS PRECISE READING. An earlier pass of this
 * project's own notes guessed "18 ticks" for the death sequence. This
 * session's fresh trace of CS:0x7C7C's own death draw shows exactly 17
 * frames (sprites 91..107, phase 0..16) before the slot frees — the death
 * frame counter (reusing the `phase` field) starts at 0 and the slot frees
 * once it reaches 17, not 18.
 */
export const DEATH_SPRITE_BASE = 91;         // 0x5b — the universal death-burst
                                              // base this game reuses for the
                                              // hero's own death, the world-2
                                              // nest, and the DS:0xce64 creature
export const DEATH_FRAMES = 17;

/** CS:0x7C7C — the LIVE contact/death box. NOT the wake-trigger's own 48x48
 *  probe above; the two are different tests over different boxes. */
export const LIVE_BOX = Object.freeze({ w: 32, h: 32 });

/** CS:0xBF5F (the shared popup spawner) and CS:0x0C8B (the shared BCD score
 *  entry, dl=5 -> 5*100). ⚠️ CORRECTION: `popup.js` now exists and IS drained
 *  by main.js for the nest/selector2/System-A/B group rewards — but NOT for
 *  this module's own `step()`-returned `popups` array, which main.js reads
 *  only for `.drawn`/`.score` and silently drops `.popups`. A real, narrow,
 *  still-open gap: wire `statueResult.popups` into the shared `popup.js`
 *  instance the same way `selectorTwo.rewards` already is. */
export const KILL_POPUP_ID = 16;
export const KILL_SCORE = 500;

/**
 * The world-1-sublevel-B awakened statue: a trigger table plus a separate
 * 10-slot runtime pool. See the file header for the injection pattern.
 */
export class Statues {
  constructor() {
    this.records = [];               // {tileCol, tileRow, fired, matchedTileId}
    this.cursor = 0;                 // the persistent CS:0x7CBD cursor
    this.slots = Array.from({ length: 10 }, () => (
      { x: 0, y: 0, state: 0, stepX: 0, stepY: 0, phase: 0 }
    ));                               // state===0 means the slot is free

    /* Running totals, mirroring nest.js's own instance counters. */
    this.woke = 0;
    this.killed = 0;
    this.score = 0;
    this.refused = 0;                 // a wake happened but the pool was full
    this.deferredHero = 0;            // the probe found the hero standing on it
    this.deferredRandom = 0;          // the random gate refused
    this.popups = [];                 // lifetime, WORLD coords — inspection
                                       // only, exactly like nest.js's own
                                       // `this.shots` accumulator.
  }

  /** CS:0x7E9B — called once per level (re)load. */
  populate(planeA, world, sublevel) {
    this.records = populateStatueTable(planeA, world, sublevel);
    this.cursor = 0;
    return this;
  }

  /** Level-(re)load convenience: also clears the runtime pool. The trigger
   *  table itself is already freshly rebuilt by `populate()`, so clearing it
   *  here too is redundant but harmless — matching every other particle
   *  pool this project has ported, which clear on level init regardless of
   *  whether the table is about to be repopulated anyway. */
  clear() {
    for (const s of this.slots) s.state = 0;
    this.records = [];
    this.cursor = 0;
    return this;
  }

  get live() { return this.slots.reduce((n, s) => n + (s.state !== 0 ? 1 : 0), 0); }

  /**
   * CS:0x7CBD — ONE trigger record per call; the cursor wraps. Mutates
   * `planeA` and allocates into the runtime pool on a wake.
   *
   * @param {{x:number,y:number}} cam   DS:0xa/0xc — the WORLD scroll origin
   *   (cam.snapX/cam.snapY in this port).
   * @param {Uint8Array} planeA         mutated in place on a wake.
   * @param {number} world              DS:0x42 — CS:0x7CBD's OWN world gate,
   *   independent of whatever gated `populate()` at load time.
   * @param {{target:number}} health    DS:0x192 — snapshotted and restored
   *   around the probe, so the probe can never actually hurt the hero.
   * @param {(box:{x,y,w,h,hp:number})=>number} contact   see the file header.
   * @param {{next:()=>number}} rng     CS:0x3836 (GodsRandom).
   * @returns {{fired:boolean, deferredHero:boolean, deferredRandom:boolean,
   *            woke:boolean, refused:boolean}}
   */
  checkTrigger(cam, planeA, world, health, contact, rng) {
    const out = {
      fired: false, deferredHero: false, deferredRandom: false,
      woke: false, refused: false,
    };
    if (world !== STATUE_WORLD) { this.cursor = 0; return out; }   // CS:0x7CBD's own gate
    if (this.records.length === 0) return out;                    // never populated this level

    const rec = this.records[this.cursor];                        // CS:0x7CC4

    trigger: {
      if (rec.fired) break trigger;                                // CS:0x7CD4 -> ADVANCE_CURSOR

      const camTileCol = cam.x >> 5, camTileRow = cam.y >> 4;      // CS:0x7CD8 (signed >>)
      if (!inStatueWindow(rec.tileCol, rec.tileRow, camTileCol, camTileRow)) {
        break trigger;                                              // off-screen -> ADVANCE_CURSOR
      }

      const worldX = rec.tileCol * 32, worldY = rec.tileRow * 16;   // CS:0x7D30

      /* The DEFER-if-hero-overlapping probe, with health protected against
       * side effects. `contact` internally applies real damage as a side
       * effect (exactly like nest.js's own `contact`), so a snapshot/restore
       * is the ONLY way a pure geometry probe can avoid actually hurting the
       * hero when it happens to land on him. */
      const snapshot = health.target;                                // BEFORE
      const strengthOut = contact({
        x: worldX + WAKE_PROBE_BOX.dx, y: worldY + WAKE_PROBE_BOX.dy,
        w: WAKE_PROBE_BOX.w, h: WAKE_PROBE_BOX.h, hp: WAKE_PROBE_STRENGTH,
      });
      if (strengthOut < 0) {                                        // a REPORTED hit
        health.target = snapshot;                                    // UNDO it
        out.deferredHero = true;
        this.deferredHero++;
        break trigger;                                                // defer, try again next visit
      }

      if (!wakeRollPasses(rng.next())) {                              // CS:0x7D80
        out.deferredRandom = true;
        this.deferredRandom++;
        break trigger;
      }

      /* THE WAKE. */
      const idx = rec.tileRow * MAP_COLS + rec.tileCol;
      const originalTile = planeA[idx];                              // CS:0x7DD6
      planeA[idx] = WAKE_DECOR_TILE;                                 // CS:0x7DD8
      planeA[idx + MAP_COLS] = WAKE_DECOR_TILE;                      // CS:0x7DDB — one row down
      rec.fired = true;
      out.fired = true;

      const free = this.slots.find((s) => s.state === 0);
      if (!free) {
        /* ⚠️ DIVERGENCE FROM THE ORIGINAL, explicitly required by this
         * module's own spec. The original's own free-slot search has no
         * documented iteration bound and would spin forever with all 10
         * slots full. This port just skips spawning silently — the record
         * is still marked fired and the cursor still advances, exactly as
         * specified — rather than reproduce an unbounded search. */
        out.refused = true;
        this.refused++;
        break trigger;
      }
      Object.assign(free, seedForWake(originalTile, worldX, worldY));
      out.woke = true;
      this.woke++;
    }

    this.cursor = (this.cursor + 1) % this.records.length;           // ADVANCE_CURSOR
    return out;
  }

  /**
   * CS:0x7B68 (movement) + CS:0x7C4B (animation) + CS:0x7C7C (contact/death)
   * — every active slot, once per tick. Mirrors nest.js's own
   * `step(cam, hero, freezeTimer, contact, brood, tock)` signature as
   * closely as this creature's own behaviour allows.
   *
   * @param {{x:number,y:number}} cam
   * @param {{x:number,y:number}} hero        WORLD coordinates — the steer
   *   target (DS:0x17a/0x17c).
   * @param {number} freezeTimer              DS:0x2fa — "freezes aliens".
   *   Gates MOVEMENT ONLY; the animation/countdown and the contact/death
   *   test both run regardless, exactly as specified.
   * @param {(box:{x,y,w,h,hp:number})=>number} contact   see the file header.
   * @param {?(entity:{state:number})=>{killed:boolean}} scanGrid  OPTIONAL —
   *   see the file header. When omitted, a contact miss simply leaves
   *   `state` unchanged (no weapon damage is modelled for that tick).
   * @param {number} tock   DS:0x36c, the every-other-frame toggle.
   *   CONFIRMED, not a guess: CS:0x7C4B is `cmp byte[0x36c],0 / jz 0x7c60` —
   *   the countdown/phase-advance body (0x7c52-0x7c5d) is SKIPPED when
   *   [0x36c]==0 and runs only when it is NON-ZERO. So `tock === 1` (this
   *   module's own choice) is the byte-verified polarity for THIS
   *   instruction, even though other sites in this project (nest.js,
   *   player.js) happen to gate the opposite way on their own, separate
   *   DS:0x36c reads — each is independently correct for its own branch.
   * @returns {{drawn:Array<{x,y,sprite}>, popups:Array<{id,x,y}>,
   *            killed:number, score:number}} `killed`/`score` are THIS
   *   TICK's counts, not running totals (see `this.killed`/`this.score` for
   *   those).
   */
  step(cam, hero, freezeTimer, contact, scanGrid, tock) {
    const drawn = [];
    const popups = [];
    let killedNow = 0, scoreNow = 0;

    const kill = (s) => {
      const p = { id: KILL_POPUP_ID, x: s.x - cam.x, y: s.y - cam.y };  // CS:0xBF5F
      popups.push(p);
      this.popups.push({ id: KILL_POPUP_ID, x: s.x, y: s.y });          // WORLD coords, lifetime
      scoreNow += KILL_SCORE;                                            // CS:0x0C8B, dl=5
      killedNow += 1;
      s.state = -1;                                                      // the death sentinel
      s.phase = 0;                                                       // reset the death-frame counter
    };

    for (const s of this.slots) {
      if (s.state === 0) continue;                                      // free slot

      if (s.state < 0) {
        /* DYING. Death still DRIFTS using whatever velocity was last set —
         * it does not stop moving. */
        s.x += s.stepX; s.y += s.stepY;
        drawn.push({ x: s.x - cam.x, y: s.y - cam.y, sprite: DEATH_SPRITE_BASE + s.phase });
        s.phase += 1;
        if (s.phase >= DEATH_FRAMES) s.state = 0;                        // free the slot
        continue;
      }

      /* ALIVE. */
      if (s.state <= STEER_MAX_STATE && freezeTimer === 0) {             // CS:0x7B68
        s.stepX = steerStep(s.x, hero.x, s.stepX, STEP_X_MIN, STEP_X_MAX);
        s.stepY = steerStep(s.y, hero.y, s.stepY, STEP_Y_MIN, STEP_Y_MAX);
        s.x += s.stepX; s.y += s.stepY;
      }
      /* else: state > 16, or frozen — no movement at all this tick. */

      if (tock === 1) {                                                  // CS:0x7C4B — see the ⚠️ above
        if (s.state > COUNTDOWN_FLOOR) s.state -= 1;
        else s.phase = (s.phase + 1) & PHASE_MASK;
      }
      let sprite = IDLE_TABLE[s.phase];
      if (s.stepX >= 0) sprite += FACING_OFFSET;
      drawn.push({ x: s.x - cam.x, y: s.y - cam.y, sprite });

      /* CONTACT + DEATH, CS:0x7C7C — runs for every alive slot regardless of
       * the steering/animation branches above. Two-step, mirroring
       * frame.js's own stepCreatureDamage: try contact (a reported hero-touch
       * hit is an outright one-touch kill, matching every other creature's
       * shared CS:0xff93/0xac59 convention); on a miss, try the weapon-scan
       * grid, which can wound OR kill without any hero contact at all.
       *
       * ⚠️ The ROL-only alternate death sound bracket (DS:0x35e, already
       * documented for other creatures in this project) is NOT modelled: no
       * sound-effect module exists yet to route it to. */
      s.state = contact({ x: s.x, y: s.y, w: LIVE_BOX.w, h: LIVE_BOX.h, hp: s.state });
      if (s.state < 0) { kill(s); continue; }
      if (scanGrid) {
        const g = scanGrid(s);              // mutates s.state in place, creatureScansGrid-shape
        if (g && g.killed) kill(s);
      }
      /* else: s.state already holds whatever the contact/grid steps left it
       * at — unchanged on a miss, reduced on a non-lethal weapon hit. */
    }

    this.killed += killedNow;
    this.score += scoreNow;
    return { drawn, popups, killed: killedNow, score: scoreNow };
  }
}
