/* pathfind-producers.js — the four move generators of CS:0xf586's search.
 *
 * pathfind.js holds the frame: the verdict, the open list, the grid geometry
 * and the seed. This file holds the part that actually explores. With it
 * wired in, System-B enemies HUNT instead of patrolling.
 *
 * THE PIPELINE. The expand routine CS:0xf64d calls four routines in a fixed
 * order, and they are stages feeding each other through two scratch areas —
 * not four independent neighbour generators:
 *
 *      0xfd54  walk RIGHT ray  ─┬─> DS:0xd586  staged walk steps ─┐
 *      0xfe36  walk LEFT  ray  ─┘                                 │
 *                              └─> DS:0xd576/0xd57e  a ledge each │
 *      0xfcbc  DROP  <── reads the two ledge records              │
 *      0xfb4d  HOP   <── reads the staged steps ───────────────────┘
 *
 * EVERY NUMBER AND BRANCH BELOW WAS READ OUT OF ndisasm OUTPUT IN THIS
 * PROJECT, not inferred. Addresses are CS-relative in GAME.EXE.
 *
 * ── The one thing a port must not simplify ────────────────────────────────
 * The arc simulator carries `di` (a plane-B pointer), `cx` and `dx` (sub-tile
 * X and Y) as EXPLICIT STATE alongside the world position, and they can go
 * out of phase with it:
 *   - landing right snaps X forward a tile AND increments di, but only when
 *     cx != 0 (CS:0xf945..0xf94f);
 *   - a ceiling bonk snaps Y, forces dx to 0 rather than deriving it, and
 *     moves di (CS:0xf9a7..0xf9b3).
 * Recomputing the cell from world X/Y each step diverges, and does so
 * invisibly — a "does it pursue" test still passes. They are carried
 * explicitly here for exactly that reason.
 */

import {
  GRID_PITCH, GRID_CELLS, GRID_MARGIN, MAP_PITCH, VERDICT_NONE,
  OpenList, seedStrategy, SEED_STRATEGIES, search, searchable,
  MARKER_MAX, WAYPOINTS, stealGate,
} from './pathfind.js';
import { HOP_ARC_MIN, HOP_ARC } from './entity.js';

/* ── Address helpers ──────────────────────────────────────────────────────
 * CS:0xf56a — plane-B cell index. `and cx,0xffe0 / sar cx,1 x5` is exactly
 * an arithmetic `>> 5`, so this is the whole routine. Column FLOORED (the
 * hero's own probe rounds; see pathfind.js).
 * Neighbour offsets, used verbatim throughout: +1 next column, +0x80 next
 * row, +0x100 two rows down (the cell under a 32-px-tall entity). */
export const planeIndex = (x, y) => (x >> 5) + (y >> 4) * MAP_PITCH;
const ROW = 0x80, TWO_ROWS = 0x100;

/* CS:0xf8a6 — the search grid pointer. Note it does NOT apply export 39's
 * -8 bias; see pathfind.js. Callers all add GRID_PITCH immediately. */
const gridPtrLocal = (st, x, y) =>
  ((x - st.camX) >> 5) + GRID_PITCH * ((y - st.camY) >> 4) + GRID_MARGIN;

/** Plane-B read that reports rather than wandering off the array. */
function pb(st, di) {
  if (di < 0 || di >= st.planeB.length) { st.oob++; return 0; }
  return st.planeB[di];
}
/** Grid read/write, same discipline. The grid is SIGNED: -1 (0xFF) = goal. */
function gr(st, si) {
  if (si < 0 || si >= GRID_CELLS) { st.oob++; return 0; }
  return st.grid[si];
}
function gw(st, si, v) {
  if (si < 0 || si >= GRID_CELLS) { st.oob++; return; }
  st.grid[si] = v;
}

/* ── The arc table, indexed by a BYTE cursor ──────────────────────────────
 * CS:0xf975 `mov si,0xdcde / mov ax,[bx+si]` with BX even, so index = BX/2.
 * The cursor decrements by one index per tick and ping-pongs -6/-5 at the
 * floor (CS:0xf9c3..0xf9ce). See entity.js for the sign convention: the -8
 * run is the LAUNCH. */
const arcDelta = (curByte) => {
  const i = (curByte >> 1) - HOP_ARC_MIN;
  return (i >= 0 && i < HOP_ARC.length) ? HOP_ARC[i] : 0;
};

/* ── The search state ─────────────────────────────────────────────────────
 * Field names carry their DS offsets so the mapping back stays visible.
 *
 * ⚠️ `stagedWrite` and `stagedCount` ARE INDEPENDENT ON PURPOSE. The goal
 * tails CS:0xFE13 / 0xFEF5 reset the count to 0 without rewinding the write
 * pointer, and the hop stage always reads from the base. Modelling the buffer
 * as `arr.push()` + `arr.length` makes that unrepresentable and silently
 * "fixes" a real behaviour. */
export function makeState({ planeB, camX, camY, desc, world = 1, markers = null,
                            markersOverride = false }) {
  return {
    verdict: -1,                       // DS:0x2ac
    best: 0xFFFF,                      // DS:0x2ae
    nodeCost: 0,                       // DS:0x2b0
    firstMove: 0,                      // DS:0x2b2
    grid: new Int8Array(GRID_CELLS),   // SS:0x1c70 — SIGNED, -1 = goal
    open: new OpenList(),              // DS:0xd476
    staged: [],                        // DS:0xd586
    stagedWrite: 0,                    // the BP the two walk stages share
    stagedCount: 0,                    // DS:0x3ce
    ledge: [null, null],               // DS:0xd576 (right stage), 0xd57e (left)
    budget: 0,                         // DS:0x3d0  <- desc[+0x0d]
    simX: 0, simY: 0,                  // DS:0x2b8 / 0x2ba
    arcSeed: 0, arcCost: 0,            // DS:0x2bc / 0x2be
    rec: null,                         // DS:0x2c0 — the staged record in hand
    moveCode: 0,                       // DS:0x2c4 — the hop's move code
    scrX: 0,                           // DS:0x2c6
    planeB, camX, camY, desc,
    world, markers, markersOverride,   // strategy 3's list / strategy 2's
                                        // DS:0xb5dc + its DS:0x399 override
    oob: 0,                            // out-of-range grid/plane accesses
    bailouts: 0,                       // loop guards the original lacks
    expansions: 0,
  };
}

/* ══ Stage 1 — the walk-RIGHT ray, CS:0xfd54 ═════════════════════════════ */
function walkRay(st, ax, bx, right) {
  /* The two rays are the same routine with four differences, all real:
   *  1. stage 2 has no `mov bp,imm` — it appends at whatever write cursor
   *     stage 1 left (CS:0xfe36 vs CS:0xfd72);
   *  2. stage 2 skips its own origin store at the root, because stage 1 has
   *     already staged that tile (CS:0xfe6e..0xfe74);
   *  3. the screen-edge test is one-sided and opposite;
   *  4. they write different ledge slots.
   */
  st.budget = st.desc.budget;                       // fd58 / fe3a -> [0x3d0]
  let di = planeIndex(ax, bx);                      // fd5f call 0xf554
  let si = gridPtrLocal(st, ax, bx) + GRID_PITCH;   // fd62 call 0xf8a6 / fd65 +0x14

  if (pb(st, di + TWO_ROWS) !== 1) return;          // fd68 — must be on ground
  let dx = st.nodeCost;                             // fd75
  /* ⚠️ The goal marker is -1, so any dx >= 0 is "greater" and the ray gives
   * up immediately. An entity standing on its own goal gets no verdict from
   * either walk stage. CS:0xfd79 `cmp dl,[ss:si] / jng`. */
  if (dx > gr(st, si)) return;                      // fd79

  st.scrX = ax - st.camX;                           // fd87 -> [0x2c6]
  let cx = st.firstMove;                            // fd8b
  if (dx === 0) cx = right ? 1 : 0;                 // fd93 `mov cx,1` / fe72 `sub cx,cx`

  /* Stage 2 at the root jumps past its own first store (difference 2). */
  let store = !(!right && dx === 0);                // fe6e/fe70/fe74

  for (;;) {
    if (store) {
      st.staged[st.stagedWrite++] = { x: ax, y: bx, cost: dx, firstMove: cx };
      gw(st, si, dx);                               // fdb2 `mov [ss:si],dl`
      st.stagedCount++;                             // fdb5 `inc byte [0x3ce]`
    }
    store = true;
    dx++;                                           // fdb9
    if (dx >= st.budget) return;                    // fdba `cmp dl,[0x3d0] / jnl`

    si += right ? 1 : -1;                           // fdc0 `inc si` / fea0 `dec si`
    ax += right ? 32 : -32;                         // fdc1 / fea1
    st.scrX += right ? 32 : -32;                    // fdc4 / fea4
    /* One-sided screen test — difference 3. Right: `cmp 0x160 / jnl`.
     * Left: `cmp -64 / jg` to CONTINUE, so it stops at <= -64. */
    if (right ? st.scrX >= 0x160 : st.scrX <= -64) return;   // fdc9 / fea9
    di += right ? 1 : -1;                           // fdd1 / feb3

    if (pb(st, di) === 1) return;                   // fdd2 — wall at head height
    if (pb(st, di + ROW) === 1) return;             // fdd7 — wall at body height

    const c = gr(st, si);                           // fdde
    if (c !== 0) {
      if (c < 0) return goalTailWalk(st, dx, right);   // fde4 `js` — THE GOAL
      if (dx >= c) return;                             // fde6 `jnl` — cheaper already
    }
    if (pb(st, di + TWO_ROWS) === 1) continue;      // fdeb — ground, keep going

    /* No ground: remember the ledge for the drop stage (difference 4). */
    st.ledge[right ? 0 : 1] = {                     // fdf2 / fed4
      x: ax, y: bx, cost: dx,
      firstMove: st.nodeCost === 0 ? (right ? 1 : 0) : st.firstMove,  // fe05 / fee7
    };
    return;
  }
}

/** Tails CS:0xFE13 (right) and CS:0xFEF5 (left) — reached only on a goal hit. */
function goalTailWalk(st, dx, right) {
  /* ⚠️ THE STAGED RECORDS ARE DISCARDED, but the write cursor is NOT rewound.
   * If stage 1 hits a goal, stage 2 keeps appending past the discarded run
   * while the count restarts at 0 — and the hop stage always reads from the
   * base. Reproduce it; do not tidy it. */
  st.stagedCount = 0;                               // fe13 / fef5
  let cx = st.firstMove;                            // fe18 / fefa
  if (st.nodeCost === 0) cx = right ? 1 : 0;        // fe23 `mov cx,1` / ff05 `sub cx,cx`

  if (right) {
    if (dx < st.best) { st.verdict = cx; st.best = dx; }   // fe26 `jc` — STRICT
    return;
  }
  /* The left tail is the only SIGNED one, and the only one with a
   * "nothing committed yet" bypass. CS:0xff07. */
  if (st.verdict < 0 || dx < st.best) { st.verdict = cx; st.best = dx; }
}

/* ══ Stage 3 — the DROP, CS:0xfcbc ═══════════════════════════════════════ */
function dropStage(st) {
  st.budget = st.desc.budget;                       // fcc7
  for (let n = 0; n < 2; n++) {                     // fcbc `mov bp,1`, two records
    const rec = st.ledge[n];
    if (!rec) continue;                             // fcd1/fcd6 — emptiness is x|y
    if (rec.x === 0 && rec.y === 0) continue;

    let ax = rec.x, bx = rec.y, dx = rec.cost;
    let di = planeIndex(ax, bx);                    // fce5
    let si = gridPtrLocal(st, ax, bx) + GRID_PITCH; // fce8 / fcec
    let cx = bx - st.camY;                          // fcef

    for (;;) {
      cx += 0x10;                                   // fcf5
      /* ⚠️ This stage's cull is VERTICAL ONLY, and against 0xC0 (192), not
       * the 0xE0 every other cull uses. CS:0xfcf8. */
      if (cx >= 0xc0) { dx = null; break; }         // fcfc `jnl` -> abandon
      bx += 0x10; dx++; di += ROW; si += GRID_PITCH;         // fcfe..fd06
      if (pb(st, di + TWO_ROWS) === 1) break;       // fd09 — landed
    }
    if (dx === null) continue;

    if (dx > st.budget) continue;                   // fd10 `jg` — note `>` here,
                                                    //   the walk stages use `>=`
    const c = gr(st, si);
    if (c !== 0) {
      if (c < 0) {                                  // fd1c `js` — THE GOAL
        /* Tail CS:0xFD3F — unsigned, commits on <=, verdict copied verbatim
         * from the record. This stage never mints a move code. */
        if (dx <= st.best) { st.verdict = rec.firstMove; st.best = dx; }
        continue;
      }
      if (dx >= c) continue;                        // fd1e `jnl`
    }
    gw(st, si, dx);                                 // fd23
    st.open.push({ x: ax, y: bx, cost: dx, firstMove: rec.firstMove });   // fd2f
  }
}

/* ══ The arc simulator — CS:0xf8dc (right) / 0xf9d4 (left) ═══════════════ */
function arcSim(st, ax, bx, right) {
  let di = planeIndex(ax, bx);                      // f8df
  st.simX = ax; st.simY = bx;                       // f8e2 / f8e5
  let cx = ax & 0x1f;                               // f8e9 — sub-tile X
  let dx = bx & 0x0f;                               // f8ed — sub-tile Y
  let cur = st.arcSeed * 2;                         // f8f3 `add bx,bx` — BYTE cursor
  let bp = 0;                                       // f8f9 — the step counter

  for (let guard = 0; guard < 4096; guard++) {
    bp++;                                           // f8fb — LOOP HEAD

    /* ⚠️ This gate skips the HORIZONTAL advance, not the arc. During the
     * terminal fall the cursor alternates -12/-10, so X advances only on the
     * -10 ticks — every other frame. CS:0xf8fc `cmp bx,-10 / jl`. */
    if (cur >= -10) {
      /* The wall check runs only exactly on a tile boundary (cx == 0). */
      const blocked = cx === 0 && (right
        ? (pb(st, di + 1) === 1 || pb(st, di + 0x81) === 1)     // f905 / f90b
        : (pb(st, di - 1) === 1 || pb(st, di + 0x7f) === 1));   // f9fd / fa03
      if (!blocked) {
        if (right) {
          st.simX += 4; cx = (cx + 4) & 0x1f;       // f912 / f917
          if (cx === 0) di++;                       // f91f
        } else {
          st.simX -= 4; cx -= 4;                    // fa09 / fa0e
          if (cx < 0) { di--; cx = 0x1c; }          // fa11..fa14
        }
      }
    }

    if (cur <= 0) {
      /* ⚠️ The apex probe fires ONLY when the cursor is exactly 0 — not on
       * every tick, not on every non-positive tick. CS:0xf920/0xf924. */
      if (cur === 0) probeGoal(st, bp, cx);         // f926 / fa1d

      /* Landing: ground directly below, or — when straddling at cx >= 8 —
       * ground below-right. The same straddle the walkers use, but here it
       * gates LANDING, so getting it wrong drops hops through floors. */
      const landed = pb(st, di + TWO_ROWS) === 1
        || (cx >= 8 && pb(st, di + TWO_ROWS + 1) === 1);        // f929..f93a
      if (landed) {
        st.simY &= 0xfff0;                          // f93c / fa33
        if (cx !== 0) {
          st.simX &= 0xffe0;                        // f945 / fa3c
          /* ⚠️ ASYMMETRIC. Right also advances a whole tile and moves di;
           * left does neither. CS:0xf94a/0xf94f have no mirror at 0xfa41. */
          if (right) { st.simX += 0x20; di++; }
        }
        probeGoal(st, bp, cx);                      // f950 / fa41
        ax = st.simX; bx = st.simY;                 // f953 / fa44
        /* Settle: fall to real ground, charging 8 per row. */
        while (pb(st, di + TWO_ROWS) !== 1) {       // f95a / fa4b
          di += ROW; bx += 0x10; bp += 8;
          /* The original has no guard — it would walk out of the plane. The
           * port stops at the world floor and COUNTS it, because a silent
           * bail returns a bogus landing that evalLanding then culls, which
           * is indistinguishable from "no hop was possible". */
          if (bx > 4096) { st.bailouts++; break; }
        }
        st.arcCost = bp;                            // f96d -> [0x2be]
        return { x: st.simX, y: bx };
      }
    }

    /* ── ARC: apply the table delta ── */
    const d = arcDelta(cur);                        // f975 / fa66
    st.simY += d; dx += d;                          // f97a / f97e
    if (dx < 0) { dx += 0x10; di -= ROW; }          // f980..f985 — crossed up
    else if (dx > 0x0f) { dx -= 0x10; di += ROW; }  // f98b..f993 — crossed down

    /* Ceiling bonk. ⚠️ The overhead probe is `[di+1]` in BOTH arcs — the left
     * one is NOT mirrored (CS:0xfa92 vs 0xf9a1). Left as found. */
    if (pb(st, di) === 1 || (cx >= 8 && pb(st, di + 1) === 1)) {   // f997 / fa88
      st.simY &= 0xfff0; dx = 0; st.simY += 0x10; di += ROW;       // f9a7..f9b3
      bp += (cur + 0x0c) >> 1;                      // f9b7 — SAR, a cost penalty
      cur = -10;                                    // f9c0 — straight to terminal fall
    }
    cur -= 2;                                       // f9c3 / fab4
    if (cur < -12) cur = -10;                       // f9c6..f9ce — ping-pong, not clamp
  }
  /* Falling out of the step guard means the arc never resolved — count it
   * rather than returning a plausible-looking landing. */
  st.bailouts++;
  st.arcCost = bp;
  return { x: st.simX, y: st.simY };
}

/* ── The mid-flight goal probe, CS:0xfac5 ────────────────────────────────
 * Never pushes and never marks the grid: it only commits a verdict. */
function probeGoal(st, bp, cxIn) {
  const cost = (bp >> 1) + st.rec.cost;             // facb / fad3
  if (cost > st.budget) return;                     // fada `jg`

  const ax = st.simX, bx = st.simY;                 // fae1 / fae4
  const sx = ax - st.camX, sy = bx - st.camY;
  if (sx <= -64 || sx >= 0x160 || sy <= -64 || sy >= 0xe0) return;  // faf4..fb08

  const si = gridPtrLocal(st, ax, bx) + GRID_PITCH; // fb0d / fb10
  if (gr(st, si) >= 0) return;                      // fb13/fb18 `jns` — goal only

  /* ⚠️ THE TRAP. What gets stored to `best` is `cx`, the SUB-TILE X OFFSET
   * that CS:0xfadf parked and CS:0xfb0a restored — not `cost`, which is used
   * only for the budget test above. cx is in {0,4,...,28}, so a hit with
   * cx <= 16 trips the main loop's own `<= 0x10` cutoff and ends the search.
   * UNKNOWN_fb1a_cx_intent: proven behaviour, unproven intent. */
  if (cxIn > st.best) return;                       // fb1a `ja` — unsigned, <=
  st.verdict = st.rec.cost === 0 ? st.moveCode : st.rec.firstMove;  // fb28..fb39
  st.best = cxIn;                                   // fb41 — cx, NOT cost
}

/* ── The landing evaluator, CS:0xfc21 ───────────────────────────────────── */
function evalLanding(st, ax, bx) {
  const cost = (st.arcCost >> 2) + st.rec.cost;     // fc27..fc2e — SAR
  if (cost > st.budget) return;                     // fc35 `jg`

  const sx = ax - st.camX, sy = bx - st.camY;       // fc3a..fc42
  if (sx <= -64 || sx >= 0x160 || sy <= -64 || sy >= 0xe0) return;  // fc46..fc5a

  const si = gridPtrLocal(st, ax, bx) + GRID_PITCH; // fc5d / fc61
  const c = gr(st, si);
  if (c !== 0) {
    if (c < 0) {                                    // fc6a `js` — THE GOAL
      /* Tail CS:0xFC98 — unsigned, commits on <=. */
      if (cost <= st.best) {
        st.verdict = st.rec.cost === 0 ? st.moveCode : st.rec.firstMove;  // fca2..fcb3
        st.best = cost;                             // fcb7
      }
      return;
    }
    if (cost >= c) return;                          // fc6c `jnl`
  }
  /* Never re-target the entity's own cell. CS:0xfc71..0xfc7c. */
  if (ax === st.entX && bx === st.entY) return;
  gw(st, si, cost);                                 // fc7e
  const firstMove = st.rec.cost === 0 ? st.moveCode : st.rec.firstMove;  // fc86..fc8f
  st.open.push({ x: ax, y: bx, cost, firstMove });  // fc93
}

/* ══ Stage 4 — the HOP, CS:0xfb4d ════════════════════════════════════════ */
function hopStage(st) {
  const n = st.stagedCount;                         // fb54 -> [0x3ce]
  if (n === 0) return;                              // fb5c

  for (let i = 0; i < n; i++) {
    const rec = st.staged[i];
    st.rec = rec;                                   // fb5e -> [0x2c0]
    if (!rec || (rec.x === 0 && rec.y === 0)) continue;   // fb63/fb68

    const ax = rec.x, bx = rec.y;
    const di = planeIndex(ax, bx);                  // fb7c
    /* THE CEILING GATE — no hop at all from under a solid tile. */
    if (pb(st, di - ROW) === 1) continue;           // fb7f

    /* Up to four arcs. The long pair is unlocked by descriptor +0x0c > 4
     * (signed), which is the only thing that field is proven to do. */
    const longHops = st.desc.hopUnlock > 4;         // fb9e / fbea `jng`
    const runs = [
      { seed: 7,  code: 3, right: true },           // fb88 / fb76
      ...(longHops ? [{ seed: 13, code: 7, right: true }] : []),   // fbaa / fba4
      { seed: 7,  code: 2, right: false },          // fbc9 / fbd4
      ...(longHops ? [{ seed: 13, code: 6, right: false }] : []),  // fbf0 / fbf6
    ];
    for (const r of runs) {
      st.moveCode = r.code;
      st.arcSeed = r.seed;
      st.arcCost = 0;                               // fb8e etc.
      const land = arcSim(st, ax, bx, r.right);
      evalLanding(st, land.x, land.y);
    }
  }
}

/* ══ Expand one node — CS:0xf64d ═════════════════════════════════════════ */
export function expand(st, x, y) {
  st.expansions++;
  st.stagedCount = 0;                               // f651 -> [0x3ce] = 0
  st.ledge[0] = null; st.ledge[1] = null;           // f656..f674 — six words
  st.entX = x; st.entY = y;

  /* ⚠️ The write cursor is reset here, NOT between the two walk stages —
   * stage 2 deliberately continues stage 1's run (CS:0xf67a push bp /
   * 0xf685 pop bp brackets BOTH calls). */
  st.stagedWrite = 0;
  walkRay(st, x, y, true);                          // f67d call 0xfd54
  walkRay(st, x, y, false);                         // f682 call 0xfe36
  dropStage(st);                                    // f687 call 0xfcbc
  hopStage(st);                                     // f68b call 0xfb4d
}

/* ══ Seeding — CS:0xf6db ═════════════════════════════════════════════════ */

/** CS:0xf7dd — the export-39 painter: marks a cell AND the one a row below. */
function paintExport39(st, x, y) {
  return paintExport39Screen(st, x - st.camX, y - st.camY);
}

/**
 * The same export-39 grid write, taking SCREEN coordinates directly — no
 * camera subtraction. This is what CS:0xf7bb actually calls for a marker
 * (`mov cx,[si] / mov dx,[si+2] / call 0xf7dd`, no camera arithmetic in
 * between): markers are stored screen-relative, FROZEN at the camera
 * position when they were written (see game/markers.js), so re-subtracting
 * the CURRENT camera here would silently erase that staleness rather than
 * reproduce it.
 */
function paintExport39Screen(st, sx, sy) {
  const idx = ((sx - 8) >> 5) + GRID_PITCH * ((sy - 8) >> 4) + GRID_MARGIN;
  if (idx < 0 || idx >= 0x17c) return false;        // f7e3 `js` / f7e5 `cmp 0x17c`
  gw(st, idx, -1);                                  // f7f0
  gw(st, idx + GRID_PITCH, -1);                     // f7f4 `[ss:si+0x14]`
  return true;                                      // f7f9 `[0x3cf] = 1`
}

/** CS:0xf868 — the unbiased painter: marks THREE cells, the hero's height. */
function paintColumn(st, x, y) {
  const idx = gridPtrLocal(st, x, y);
  gw(st, idx, -1);                                  // f892
  gw(st, idx + GRID_PITCH, -1);                     // f896
  gw(st, idx + 2 * GRID_PITCH, -1);                 // f89d
}

/**
 * CS:0xf6db. Returns the strategy index actually used, so the caller can
 * report it — pattern 2 is 201 of the 540 shipped nibbles and is NOT
 * implemented, so silently defaulting would make "enemies hunt" true for a
 * biased subset without anyone noticing.
 */
export function seedGoals(st, heroX, heroY, rnd) {
  st.grid.fill(0);                                  // f6de..f6e8
  const b8 = st.desc.seedPair;
  /* CS:0xf6ed `cmp byte[0x399],0 / jz 0xf6f7 / jmp 0xf794` — the DS:0x399
   * override (game/markers.js — set by a type-45 "attracts monsters" potion)
   * skips the nibble roll ENTIRELY and jumps straight into the marker-seed
   * body. `idx` here is forced to 2 for that reason; `b8`'s own nibbles are
   * still passed to seedApply/seedFallback below exactly as the un-overridden
   * path would, which is this port's documented, deliberate reading of an
   * otherwise-undefined register state (UNKNOWN_seed2_override_fallback). */
  const idx = st.markersOverride ? 2 : seedStrategy(b8, st.desc.seedWeight, rnd);

  if (idx === 0) {                                  // 0xf854 — direct pursuit
    paintColumn(st, heroX, heroY);
    return idx;
  }
  if (idx === 1) {                                  // 0xf729 — a ring around him
    for (const dy of [-64, 64])
      for (let i = 0; i < 8; i++) paintExport39(st, heroX - 64 + i * 16, heroY + dy);
    for (const dx of [-64, 64])
      for (let i = 0; i < 8; i++) paintExport39(st, heroX + dx, heroY - 64 + i * 16);
    return idx;
  }
  if (idx === 2) {                                  // 0xf794 — the marker list
    /* An empty list short-circuits BEFORE anything is painted, and jumps to
     * CS:0xf71a — which is `xchg cx,dx` followed by the dispatch, i.e. it
     * RETRIES WITH THE OTHER NIBBLE. Since markers only exist after an
     * "attracts monsters" potion, that fallback is the common case, and
     * implementing it is what stops a third of shipped groups being inert.
     *
     * ⚠️ MARKERS ARE SCREEN COORDINATES, FROZEN AT WRITE TIME (game/markers.js
     * — CS:0x1632-0x1668 stores `sub ax,[0xa]`/`sub bx,[0xc]` against the
     * camera THEN, and the reader below, CS:0xf7bb, feeds them to export 39
     * with NO further camera arithmetic). So this uses paintExport39Screen,
     * not paintExport39 — re-subtracting the CURRENT camera would erase the
     * staleness the original actually has. Each record is also {x, y, type};
     * only x/y are painted here, matching CS:0xf7bb which never touches the
     * third word either. */
    const markers = st.markers || [];
    if (markers.length === 0) return seedFallback(st, heroX, heroY, b8, idx);  // f799
    const n = Math.min(markers.length, MARKER_MAX);       // f7ab clamp at 20
    let painted = false;                                  // [0x3cf]
    for (let i = 0; i < n; i++) {                         // f7bb..f7c7
      if (paintExport39Screen(st, markers[i].x, markers[i].y)) painted = true;
    }
    /* CS:0xF7C9 — arms System B's own steal-and-carry gate (pathfind.js's
     * `stealGate`, entity.js's `stealAttemptB`). Fires HERE, unconditionally,
     * the instant this branch is reached with a nonempty marker list — before
     * the `painted` check below, so it is NOT gated on anything actually
     * landing on-grid. See stealGate's own header for why this never resets. */
    stealGate.active = true;
    /* Nothing landed on the grid -> the same fallback (CS:0xf7d2/0xf7d9). */
    if (!painted) return seedFallback(st, heroX, heroY, b8, idx);
    return idx;
  }

  if (idx === 3) {                                  // 0xf800 — the waypoints
    const list = WAYPOINTS[st.world] || [];
    for (const [tileX, tileY] of list) {            // f810..f813
      const x = tileX << 5;                         // f81a
      const y = (tileY + 1) << 4;                   // f824 — note the `inc bx`
      const sx = x - st.camX, sy = y - st.camY;
      /* On a cull FAILURE the original loops back and tries the next entry
       * (CS:0xf838 `jng 0xf810`), so this takes the FIRST on-screen waypoint,
       * not the nearest and not all of them. */
      if (sx <= -64 || sx >= 0x160 || sy <= -64 || sy >= 0xe0) continue;
      paintColumn(st, x, y);                        // f850 -> 0xf868
      return idx;
    }
    /* The list ran out with nothing on screen. Unlike strategy 2 this has NO
     * fallback — CS:0xf852 just returns, leaving the grid empty. */
    return idx;
  }
  return idx;
}

/**
 * CS:0xf71a — `xchg cx,dx` then dispatch, i.e. "try the other nibble".
 * Only strategy 2 reaches it, and only once: the other nibble cannot itself
 * be 2 and retry, because a second empty-marker check would return here with
 * the nibbles swapped back. This models one hop, which is what the original's
 * control flow produces.
 *
 * ⚠️ When strategy 2 is entered through the DS:0x399 override the original
 * SKIPS the desc[8] load entirely (CS:0xf6f4 jumps straight to 0xf794), so
 * `xchg cx,dx` there swaps whatever happened to be in those registers. That
 * path is genuinely undefined; this port takes the descriptor's other nibble
 * instead and says so. UNKNOWN_seed2_override_fallback.
 */
function seedFallback(st, heroX, heroY, b8, chosen) {
  const lo = b8 & 0x0f, hi = (b8 & 0xf0) >> 4;
  const other = chosen === lo ? hi : lo;
  if (other === 2) return other;          // no second retry
  return seedApply(st, heroX, heroY, other);
}

/** The three non-recursive painters, shared by the seed and its fallback. */
function seedApply(st, heroX, heroY, idx) {
  if (idx === 0) { paintColumn(st, heroX, heroY); return idx; }
  if (idx === 1) {
    for (const dy of [-64, 64])
      for (let i = 0; i < 8; i++) paintExport39(st, heroX - 64 + i * 16, heroY + dy);
    for (const dx of [-64, 64])
      for (let i = 0; i < 8; i++) paintExport39(st, heroX + dx, heroY - 64 + i * 16);
    return idx;
  }
  if (idx === 3) {
    const list = WAYPOINTS[st.world] || [];
    for (const [tileX, tileY] of list) {
      const x = tileX << 5, y = (tileY + 1) << 4;
      const sx = x - st.camX, sy = y - st.camY;
      if (sx <= -64 || sx >= 0x160 || sy <= -64 || sy >= 0xe0) continue;
      paintColumn(st, x, y);
      return idx;
    }
  }
  return idx;
}

export const SEED_IMPLEMENTED = [0, 1, 2, 3];
export const seedName = (i) => (SEED_STRATEGIES[i] || {}).name || `out of range (${i})`;

/* ══ The whole search, CS:0xf586 with the real producers ═════════════════ */

/**
 * Run the pathfinder for one entity and return its verdict.
 *
 * @param {{x:number,y:number}} entity
 * @param {object} ctx
 *   planeB     Uint8Array(8192), the level's plane B
 *   camX camY  scroll origin (DS:0x0a / DS:0x0c)
 *   heroX heroY  the hero's world position (DS:0x17a / DS:0x17c)
 *   desc       {seedPair, seedWeight, hopUnlock, budget} — descriptor
 *              +0x08, +0x09, +0x0c, +0x0d
 *   rnd        one draw from the replay table. THE ONLY source of randomness
 *              in the whole search, so pinning it makes the run deterministic
 *              without faking anything.
 * @returns {{verdict:number, seed:number, state:object}}
 */
export function runSearch(entity, ctx) {
  const st = makeState(ctx);
  if (!searchable(entity.x, entity.y, ctx.camX, ctx.camY)) {
    return { verdict: VERDICT_NONE, seed: -1, state: st };   // CS:0xf59f — the cull
  }
  /* The strategy draw (CS:0xF710) happens inside CS:0xF6DB, AFTER the cull
   * above, and CS:0xF6ED jumps past it to 0xF794 under the DS:0x399 potion
   * override: an off-screen or overridden entity draws nothing. `ctx.rnd`
   * may be the draw function. */
  const rnd = ctx.markersOverride ? 0
    : (typeof ctx.rnd === 'function' ? ctx.rnd() : ctx.rnd);
  const seed = seedGoals(st, ctx.heroX, ctx.heroY, rnd | 0);   // f5c0
  st.seedGrid = Int8Array.from(st.grid);            // ?debug: SS:0x1c70 as F5C3 sees it
  st.nodeCost = 0;                                  // f5c6 — this is the ROOT
  st.firstMove = 0;

  const verdict = search(entity, ctx.camX, ctx.camY, { state: st, expand });
  return { verdict, seed, state: st };
}
