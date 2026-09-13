/* pathfind.js — the System-B enemy pathfinder: CS:0xf586 and its verdict.
 *
 * This is what turns an enemy from a patroller into a hunter. The walk handlers
 * call CS:0xf586 once per tile crossing; it searches outward from the entity
 * and leaves a single word in DS:0x2ac — the FIRST MOVE of the best path found.
 *
 * ⚠️ "Once per tile crossing" also means THE VERDICT IS STICKY for a whole
 * tile: between crossings the entity just re-runs its current mode.
 *
 * WHAT IS PROVEN HERE vs WHAT IS NOT
 *   Proven and implemented below: the verdict domain and its applier, the
 *   consumer branch logic, the open list, the visited grid geometry, the two
 *   cell-address rules, and the termination test.
 *   NOT implemented: the four move generators (the producers) that actually
 *   populate the open list.  UNKNOWN_pathfinder_producers.
 *   Without them `search()` finds nothing and returns VERDICT_NONE, which is
 *   exactly the "no path" case the original also produces — so an enemy falls
 *   back to its wall-probe patrol. The port degrades to the behaviour it
 *   already had rather than inventing a hunt.
 *
 * THE SEARCH — CS:0xf586, read verbatim:
 *     f586  mov word [0x2ac],0xffff     ; verdict  := none
 *     f58c  mov word [0x2ae],0xffff     ; best cost := infinity
 *     f592  mov ax,[di] / mov bx,[di+2] / sub ax,[0xa] / sub bx,[0xc]
 *     f59f  cmp ax,0xffc0 / jng ret     ; the CULL — screen x in (-64, 352)
 *     f5a4  cmp ax,0x160  / jnl ret     ;             screen y in (-64, 224)
 *     f5a9  cmp bx,-64    / jng ret
 *     f5ae  cmp bx,0xe0   / jnl ret
 *     f5b7  call 0xf68f                 ; clear the open list, count := 0
 *     f5c0  call 0xf6db                 ; clear the visited grid, seed
 *     f5c6  mov word [0x2b0],0          ; depth := 0  (this is the ROOT)
 *     f5cc  mov ax,[di] / mov bx,[di+2] / mov [0x2c8],si
 *     f5d5  call 0xf64d                 ; expand the root
 *     f5d8  cmp word [0x2ae],0x10 / jna done   ; GOOD ENOUGH -> stop
 *     ...   pop a node, expand it, repeat
 *
 * THE CULL IS PART OF THE ALGORITHM, not an optimisation: an entity outside
 * that window returns with the verdict still 0xFFFF, so OFF-SCREEN ENEMIES
 * NEVER HUNT. They fall through to patrol every tick. That is observable
 * behaviour and this port reproduces it.
 */

/* ── The verdict ──────────────────────────────────────────────────────────
 * CS:0xf2ac decodes the whole domain, and it is only 8 values wide:
 *     f2ac  mov ax,[0x2ac]
 *     f2af  cmp ax,1 / jg 0xf2b8
 *     f2b4  mov [di+0xa],ax        ; 0 or 1 -> mode = verdict, i.e. walk L/R
 *     f2b8  sub ax,2
 *     f2bb  mov bx,ax / and bx,1 / add bx,4
 *     f2c3  mov [di+0xa],bx        ; mode = 4 + ((v-2)&1)  -> hop left/right
 *     f2c6  and ax,0xfffe
 *     f2c9  mov bx,7  / or ax,ax    / jz  store
 *     f2d0  mov bx,9  / sub ax,2    / jz  store
 *     f2d8  mov bx,0xd
 *     f2db  mov [di+0x12],bx        ; THE HOP CURSOR
 *     f2de  mov word [di+0x4],0     ; frame := 0
 */
export const VERDICT_NONE = -1;          // 0xFFFF as a signed word

/** The 8 legal verdicts, with what each one does to the entity. */
/* ⚠️ VERDICTS 4 AND 5 ARE UNREACHABLE. DS:0x2ac has exactly six writers (the
 * init plus the five tails) and the only values they can mint are 0, 1 and
 * DS:0x2c4, which the hop producer sets to 3, 7, 2 or 6 — never 4 or 5. So
 * the decoder's middle branch (CS:0xf2d0 `mov bx,0x9`) is DEAD CODE. It is
 * kept here because the decoder really does contain it; nothing reaches it. */
export const VERDICT = [
  { v: 0, mode: 0, label: 'walk left' },
  { v: 1, mode: 1, label: 'walk right' },
  { v: 2, mode: 4, cursor: 7,  label: 'hop left, short' },
  { v: 3, mode: 5, cursor: 7,  label: 'hop right, short' },
  { v: 4, mode: 4, cursor: 9,  label: 'hop left, medium — UNREACHABLE', dead: true },
  { v: 5, mode: 5, cursor: 9,  label: 'hop right, medium — UNREACHABLE', dead: true },
  { v: 6, mode: 4, cursor: 13, label: 'hop left, long' },
  { v: 7, mode: 5, cursor: 13, label: 'hop right, long' },
];

/** The values the five tails can actually mint. CS:0xfe23, 0xff05, DS:0x2c4. */
export const REACHABLE_VERDICTS = [0, 1, 2, 3, 6, 7];

/**
 * CS:0xf2ac — apply a verdict to an entity. Mutates mode, and for a hop also
 * the cursor `+0x12` and the frame `+0x04`.
 *
 * THE HOP CURSOR SEED IS A DISTANCE, not a phase. The sibling seeders at
 * CS:0xf2e4 / 0xf2fc compute it as `5 + 2*(d-1)` from an explicit distance d,
 * so cursor 7/9/13 are hop lengths 2/3/5. That is why the verdict needs six
 * hop values rather than two: direction AND reach.
 */
export function applyVerdict(entity, verdict) {
  if (verdict < 0 || verdict > 7) return false;
  const r = VERDICT[verdict];
  entity.mode = r.mode;
  if (r.cursor !== undefined) {
    entity.vel = r.cursor;      // +0x12, shared with fall velocity
    entity.frame = 0;           // +0x04
  }
  return true;
}

/**
 * The consumer branch, from the two walk handlers. It is NOT symmetric between
 * them, and the asymmetry is the whole point:
 *
 *   walk LEFT  (CS:0xf147)   cmp [0x2ac],0 / js patrol / jz keepGoing / apply
 *   walk RIGHT (CS:0xf209)   cmp [0x2ac],0 / js patrol
 *                            cmp [0x2ac],1 / jz keepGoing / apply
 *
 * Each handler tests the verdict against ITS OWN mode number — 0 for the
 * left-walker, 1 for the right-walker — and treats "the search agrees with
 * what I am already doing" as a no-op so the ordinary step runs. A port that
 * tests both handlers against 0 makes right-walkers re-apply their mode every
 * tile and reset their animation frame.
 *
 * @returns {'patrol'|'keep'|'apply'}
 */
export function verdictAction(verdict, mode) {
  if (verdict < 0) return 'patrol';      // js  — no path found
  if (verdict === mode) return 'keep';   // jz  — already heading that way
  return 'apply';
}

/* ── The visited grid ─────────────────────────────────────────────────────
 * SS:0x1c70, cleared by CS:0xf6db with `mov cx,0xc8 / rep stosw` = 400 bytes.
 * ONE BYTE PER CELL, pitch 20 — proven at the use site rather than inferred:
 *     f7dd  call word far [ss:0x52ee]   ; graphics EXPORT 39 -> cx = cell index
 *     f7e3  js 0xf7fe                   ; negative -> off grid
 *     f7e5  cmp cx,0x17c / jnl 0xf7fe   ; >= 380 -> off grid
 *     f7eb  mov si,0x1c70 / add si,cx
 *     f7f0  mov byte [ss:si],0xff
 *     f7f4  mov byte [ss:si+0x14],0xff  ; +20 = EXACTLY ONE ROW DOWN
 * The bound 0x17c is 400-20: the last row is excluded precisely because the
 * writer also touches +20. Pitch 20 and 400 bytes together force 20 x 20.
 *
 * EXPORT 39 (VGA:0x203) is the pixel -> cell converter:
 *     sub cx,8 / sar cx,1 (x5)      -> col = (x-8) >> 5
 *     sub dx,8 / sar dx,1 (x4)      -> row = (y-8) >> 4
 *     add cx,5 ... row*20 ... +0x50 -> index = col + 20*row + 0x55
 * The +0x55 (= 20*4 + 5) is a MARGIN: 5 columns and 4 rows of slack around the
 * 11 x 10 visible tile field, so a search may step off-screen a little way
 * without falling out of the grid. */
export const GRID_BASE_SS = 0x1c70;
export const GRID_PITCH   = 20;
export const GRID_CELLS   = 400;         // 20 x 20
export const GRID_LIMIT   = 0x17c;       // 380 = 400 - 20, CS:0xf7e5
export const GRID_MARGIN  = 0x55;        // 20*4 + 5, the export-39 bias

/** Graphics export 39, VGA:0x203 — pixel to pathfinder-grid index. */
export const gridIndex = (x, y) =>
  ((x - 8) >> 5) + GRID_PITCH * ((y - 8) >> 4) + GRID_MARGIN;

/* ── The two cell-address rules, and they are DIFFERENT ───────────────────
 * A port will naturally write one helper for "pixel -> plane-B cell" and use
 * it everywhere. The original has two, and they round differently:
 *
 *   ENTITY  CS:0xf56a   and cx,0xffe0             -> col = x >> 5   FLOORED
 *   HERO    export 40   add ax,0x10 / and ax,0xffe0 -> col = (x+16) >> 5 ROUNDED
 *
 * Export 40 (VGA:0x22e) is the driver-hosted version of the hero's own event
 * probe at CS:0x5fab, and CS:0xf544 calls it with the hero's [0x17a]/[0x17c]
 * and bp = 0x5004. Both floor the ROW; only the hero rounds the COLUMN,
 * because the hero is 32 px wide and his centre should pick the column.
 *
 * This also closes UNKNOWN_EXPORT40_TARGET, which stood because "the pitch
 * disagrees with export 39". It does — deliberately. Export 39 addresses the
 * 20-wide pathfinder grid; export 40 addresses the 128-wide map. Two grids,
 * two pitches, no contradiction. */
export const PLANE_B_BASE = 0x5004;
export const MAP_PITCH    = 128;

/** CS:0xf56a — the entity rule. Column FLOORED. */
export const entityCell = (x, y) => ((x & 0xFFE0) >> 5) + ((y & 0xFFF0) >> 4) * MAP_PITCH;

/** Export 40 / CS:0x5fab — the hero rule. Column ROUNDED to nearest. */
export const heroCell = (x, y) => (((x + 16) & 0xFFE0) >> 5) + ((y & 0xFFF0) >> 4) * MAP_PITCH;

/* ── The open list ────────────────────────────────────────────────────────
 * DS:0xd476, 32 slots of 8 bytes {u16, u16, u16, u16}, count in DS:0x2b6.
 * Cleared by CS:0xf68f (`mov cx,0x80 / rep stosw` = 256 bytes = 32 x 8).
 *
 * ⚠️ IT IS NOT A BREADTH-FIRST QUEUE, and an earlier revision of this file
 * called it one. Push is first-fit from slot 0; pop is a cyclic cursor that
 * does NOT advance past the slot it just emptied. Cost never orders anything
 * — it is used only for the budget reject, the grid dedup, and the tails.
 * `queue.shift()` changes the expansion order and can change the verdict.
 *
 * THE PUSH — CS:0xf6a8:
 *     f6a8  push bp / mov si,0xd476 / mov bp,0x1f
 *     f6af  cmp bp,[0x2b6] / jnl scan        ; 31 < count -> FULL, drop
 *     f6b7  cmp [si],0 / jnz next
 *           cmp [si+2],0 / jz found          ; a slot is free when BOTH are 0
 *     f6c2  add si,8 / dec bp / jns 0xf6b7
 *     f6ca  pop bp                           ; <- the CALLER's bp is restored
 *     f6cb  mov [si],ax / [si+2],bx / [si+4],bp / [si+6],cx
 *   The `pop bp` PRECEDES the stores, which is what makes slot+4 the CALLER's
 *   value rather than the loop counter 0x1f. Both pushers (CS:0xfd2f in the
 *   drop producer, CS:0xfc93 in the hop landing) leave the node's COST in BP,
 *   so slot+4 is the cost and slot+6 the first move. That resolves what this
 *   file previously called UNKNOWN_openlist_field4.
 *
 * THE POP LOOP — CS:0xf5df, verbatim:
 *     f5df  mov si,0xd476 / sub cx,cx
 *     f5e4  cmp word [0x2b6],0 / jz done
 *     f5eb  mov ax,[si] / or ax,[si+2] / jnz 0xf5ff
 *     f5f2  add si,8 / add cx,1 / cmp cx,0x20 / jl 0xf5e4
 *     f5fd  jmp 0xf5df                       ; wrap: si AND cx both reset
 *     f5ff  inc cx                           ; <- NO `add si,8` here
 *     ...   read the slot, zero it, dec the count, expand ...
 *     f63c  cmp cx,0x20 / jl 0xf5e4          ; back to the scan, SI UNCHANGED
 *     f641  mov si,0xd476 / sub cx,cx
 *   Because SI is not advanced, the emptied slot is rescanned on the next
 *   iteration and `cx` is charged TWICE for every expansion — once by the
 *   `inc cx` at 0xf5ff and once by the `add cx,1` of the rescan. So the
 *   cursor resets to slot 0 after roughly 16 expansions, not 32.
 *   UNKNOWN_f5ff_cx_desync — reproduce it, do not rationalise it.
 *
 * ⚠️ A node at (0, 0) is INDISTINGUISHABLE from an empty slot — every
 * emptiness test is `x | y` (CS:0xf5eb, 0xf6b7/0xf6bc). Do not add a `used`
 * flag to "fix" it; that changes which nodes survive.
 *
 * ⚠️ DO NOT REPRODUCE THE SPIN. If [0x2b6] ever disagrees with actual slot
 * occupancy the scan never terminates. The port asserts instead. */
export const OPEN_SLOTS = 32;
export const OPEN_LIMIT = 0x1f;          // CS:0xf6ac — 31, so a full list drops

/* ⚠️ GOOD_ENOUGH IS COMPARED AGAINST A VALUE THAT IS NOT ALWAYS A COST.
 * Four of the five tails write a real cost to DS:0x2ae. The fifth — the hop's
 * MID-FLIGHT goal probe, tail CS:0xFB1A — writes `cx`, which at that point is
 * a SUB-TILE X OFFSET in {0, 4, 8, ..., 28}:
 *     fadf  mov si,cx        ; cx parked across the 0xf8a6 call
 *     fb0a  mov cx,si        ; and restored
 *     fb1a  cmp cx,[0x2ae] / ja skip
 *     fb41  mov [0x2ae],cx   ; <- the sub-tile offset, not the cost in AX
 * AX holds the computed cost there and is used only for the budget test.
 * Because 28 < 0x10 is false but 16 <= 0x10 is true, a mid-flight goal hit
 * with cx <= 16 trips this cutoff and ENDS THE SEARCH ON THE SPOT.
 * UNKNOWN_fb1a_cx_intent — the behaviour is proven, the intent is not.
 * Implement it verbatim; "fixing" it to a cost changes when the search stops. */
export const GOOD_ENOUGH = 0x10;         // CS:0xf5d8 `cmp word [0x2ae],0x10 / jna`

export class OpenList {
  constructor() {
    this.slots = Array.from({ length: OPEN_SLOTS }, () => null);
    this.count = 0;                       // DS:0x2b6
    this.si = 0;                          // the scan cursor, in slots
    this.cx = 0;                          // the scan counter — see the header
    this.dropped = 0;                     // pushes refused because the list was full
  }

  /** CS:0xf6a8 — first-fit from slot 0. Returns false when it cannot store. */
  push(node) {
    if (OPEN_LIMIT < this.count) { this.dropped++; return false; }
    const i = this.slots.indexOf(null);
    if (i < 0) { this.dropped++; return false; }
    this.slots[i] = node;
    this.count++;                         // CS:0xf6d6 `inc word [0x2b6]`
    return true;
  }

  /**
   * CS:0xf5e4 — one turn of the cyclic scan. Returns the node, or null when
   * the list is empty. Leaves `si` ON the emptied slot, exactly as the
   * original does, so the caller's `cx >= 0x20` wrap test sees the same
   * double-count the original sees.
   */
  pop() {
    let guard = 0;
    for (;;) {
      if (this.count === 0) return null;             // f5e4
      if (this.slots[this.si] !== null) {            // f5eb — occupied
        this.cx++;                                   // f5ff `inc cx`, no si advance
        const node = this.slots[this.si];
        this.slots[this.si] = null;                  // f60c..f61a
        this.count--;                                // f61f
        return node;
      }
      this.si++; this.cx++;                          // f5f2 `add si,8 / add cx,1`
      if (this.cx >= OPEN_SLOTS) { this.si = 0; this.cx = 0; }   // f5fb/f5fd
      if (++guard > OPEN_SLOTS * 4) {
        throw new Error(`open list count ${this.count} disagrees with occupancy`);
      }
    }
  }

  /** CS:0xf63c — the post-expansion wrap test, kept separate because it runs
   *  after the expand call rather than inside the scan. */
  wrapAfterExpand() {
    if (this.cx >= OPEN_SLOTS) { this.si = 0; this.cx = 0; }
  }
}

/* ── The seed: FOUR goal-region strategies, chosen at random ──────────────
 *
 * This is the part that makes the search a HUNT rather than a wander, and it
 * is where the enemy's "personality" lives. CS:0xf6db clears the grid and then
 * picks a seeding strategy:
 *
 *     f6ed  cmp byte [0x399],0 / jz 0xf6f7 / jmp 0xf794   ; global override
 *     f6f7  mov cl,[si+0x8] / mov dl,cl
 *           and cx,0xf                     ; cl = LO nibble  -> strategy A
 *           and dx,0xf0 / shr dx,1 (x4)    ; dl = HI nibble  -> strategy B
 *     f70b  mov bl,[si+0x9] / sub bh,bh
 *     f710  call 0x3836 / and ax,0x7f      ; random, 0..127
 *     f716  cmp bx,ax / jnl 0xf71c
 *     f71a  xchg cx,dx                     ; SWAP when [si+9] < rand
 *     f71c  mov si,0xd966 / shl cl,1 / add si,cx / mov si,[si] / jmp si
 *
 * So descriptor +0x08 carries TWO strategy ids, one per nibble, and +0x09 is a
 * 7-bit weight favouring the LO one: `+9 = 127` can never swap (rand <= 127),
 * `+9 = 0` swaps 127 times in 128.
 *
 * THE JUMP TABLE AT DS:0xd966 IS ONLY FOUR ENTRIES — indices 4+ are zeros and
 * then unrelated data. There is NO bounds check on the nibble, so a descriptor
 * with a nibble > 3 would jump into garbage. The shipped data never does:
 * across all 270 live System-B descriptors both nibbles are in {0,1,2,3} and
 * +9 is in 0..127, matching the table size and the 0x7f mask exactly. That
 * census is what proves the table is four wide, the same way the max selector
 * of 11 proved the SS:0x3570 table's size.
 *
 * ⚠️ These paint the GOAL region, not the obstacles. CS:0xf7dd marks a grid
 * cell and the one 20 below it with 0xFF; strategy 1 walks a box around the
 * HERO's position, so what is being painted is "where the enemy wants to get
 * to". Reading SS:0x1c70 as a closed-set would inverts the whole search. */
export const SEED_TABLE_DS = 0xd966;
export const SEED_STRATEGIES = [
  { n: 0, addr: 0xf854, name: "the hero's own 3-cell column — direct pursuit" },
  { n: 1, addr: 0xf729, name: 'box around the hero, +/-64 px, 8 cells a side' },
  { n: 2, addr: 0xf794, name: 'the marker list — the "attracts monsters" potion' },
  { n: 3, addr: 0xf800, name: 'the first on-screen per-world waypoint' },
];

/* ── Strategy 2 is a POTION EFFECT ───────────────────────────────────────
 * DS:0x399 forces every System-B enemy onto strategy 2 regardless of its own
 * descriptor nibbles (CS:0xf6ed). It has exactly two writers: cleared at
 * CS:0x1437, and set at CS:0x164d — inside the object-pickup dispatcher,
 * guarded by `cmp dx,0x2d / jnz` on the object TYPE:
 *
 *     162e  sub bx,[0xc]
 *     1632  inc byte [0x398]                ; append a marker
 *     1636  cmp byte [0x398],0x14 / jg      ; clamp at 20
 *     163d  cmp dx,0x2d / jnz 0x1652        ; TYPE 45 only
 *     1642  mov word [0x208],0xb5dc         ; reset the marker cursor
 *     1648  mov byte [0x398],0x14           ; count := 20
 *     164d  mov byte [0x399],0x1            ; force strategy 2
 *
 * Object type 45 in POBJECTS reads `"potion..........attracts monsters"`.
 * So strategy 2 is not an AI variant at all — it is that potion's mechanism:
 * enemies stop heading for the hero and head for the marker list instead.
 * (Type 46, `"distracts monsters"`, takes the same marker-append path without
 * setting the gate.) This closes what was UNKNOWN_399_source.
 *
 * The marker array itself is DS:0xb5dc, 6-byte records, count in DS:0x398,
 * written at runtime by the pickup path. UNKNOWN_marker_record — what the six
 * bytes hold beyond the leading {x, y} that CS:0xf7bb reads is not
 * established, so this port takes markers as an input and defaults to none. */
export const MARKER_MAX = 0x14;          // CS:0xf7ab / 0x1636 — 20
export const ATTRACT_POTION_TYPE = 0x2d; // CS:0x163d — 45

/* DS:0x3cd — CS:0xF7C9, found by `search_instructions` on the literal
 * operand `3cd` across the whole program: exactly TWO hits in the entire
 * image, this write and CS:0xEF01's own reader (`cmp byte[0x3cd],0x2`,
 * entity.js's own `stealAttemptB` — System B's steal-and-carry gate). No
 * other writer exists anywhere, confirmed exhaustively rather than assumed.
 *
 * CS:0xF7C9 sits at the TAIL of this exact function's own idx===2 branch
 * (`seedGoals` below, CS:0xF794-0xF7DC — the pathfinder's own "attracts
 * monsters" marker-seek strategy), immediately after the marker-paint loop
 * and BEFORE the `painted`/fallback check. So it fires the FIRST time ANY
 * System-B entity's pathfinder search rolls strategy 2 with a NONEMPTY
 * marker list (`markers.length > 0`, matching CS:0xF794's own `[0x398]!=0`
 * test) — regardless of whether any marker actually lands on-grid (that is
 * the SEPARATE `painted` flag / DS:0x3cf, already modelled in `seedGoals`).
 *
 * ⚠️ NEVER RESET. Not by level load, not by a full restart (CS:0x473/
 * 0x8dd9, the world:=1/money:=0 and score:=0 sites) — the exhaustive search
 * above found no second writer of any kind. So this is a ONE-WAY, GLOBAL
 * latch: it starts false (the program's own BSS zero-init), and the FIRST
 * time any System-B entity anywhere rolls strategy 2 with a live marker
 * list, `stealAttemptB`'s own gate opens PERMANENTLY for every System-B
 * entity, in every level, for the rest of the process's life. This is
 * architecturally different from System A's own steal gate (entity-a.js's
 * `strategy2`), which is per-entity and re-evaluated every tick from that
 * entity's own sticky strategy state — System B's gate, once open, does not
 * care which strategy any given entity is currently running. */
export const stealGate = { active: false };

/* ── Strategy 3's waypoints, DS:0xdb28 ──────────────────────────────────
 * Four per-world pointers {0xdb30, 0xdb58, 0xdba8, 0xdba8} — WORLDS 3 AND 4
 * SHARE A LIST. Each is `{u16 tileX, i16 tileY}` pairs terminated by a
 * negative tileY (CS:0xf816 `or bx,bx / js`).
 *
 *     f81a  ax <<= 5              ; X = tileX * 32
 *     f824  inc bx / bx <<= 4     ; Y = (tileY + 1) * 16   <- note the +1
 *     f82d  ax -= [0xa] ; bx -= [0xc]
 *     f835  4-way cull; on FAILURE loop back and try the next waypoint
 *
 * So it walks the list and paints the FIRST entry that is on screen; if none
 * is, nothing is painted. Every shipped coordinate lies inside the 128x64 map
 * (tileX 4..125, tileY 4..60), which is what makes the decode self-checking. */
export const WAYPOINTS = {
  1: [[8,25],[6,31],[36,51],[43,58],[72,38],[83,19],[91,25],[99,11],[99,5]],
  2: [[121,6],[125,17],[125,55],[86,58],[100,56],[36,43],[35,52],[45,59],[50,59],
      [52,59],[55,59],[55,25],[73,36],[72,49],[75,49],[73,59],[68,59],[85,12],[40,4]],
  3: [[4,23],[12,23],[15,23],[6,42],[10,60],[17,60],[22,60],[24,49],[32,49],
      [30,16],[38,16],[36,10],[39,27]],
};
WAYPOINTS[4] = WAYPOINTS[3];             // DS:0xdb28 gives both the same pointer

/* CS:0xf854 — strategy 0, the commonest by far (298 of the 540 shipped
 * nibbles). It marks the hero's cell and the TWO BELOW IT, which is exactly
 * his 3-row height: a 32x48 hero spans three 16-px tile rows.
 *
 *     f854  ax = heroX - camX ; bx = heroY - camY
 *     f868  sar ax,1 (x5)                  ; col = sx >> 5
 *     f872  sar bx,1 (x4)                  ; row = sy >> 4
 *     f87a  add ax,5 ; ... row*4 + row*16 = row*20 ... ; add ax,0x50
 *     f892  mov byte [ss:si],0xff
 *     f896  add si,0x14 / mov byte [ss:si],0xff
 *     f89d  add si,0x14 / mov byte [ss:si],0xff
 *
 * ⚠️ ITS CELL MATH IS NOT EXPORT 39's. The total bias is the same 0x55, but
 * export 39 first does `sub cx,8 / sub dx,8` and this routine does not — so
 * the two disagree by 8 px on both axes and land in different cells near a
 * boundary. Two inlined copies of "the same" formula that are not the same;
 * a port that factors them into one helper changes where the goal is. */
export const seedColumnCells = (heroSX, heroSY) => {
  const base = (heroSX >> 5) + GRID_PITCH * (heroSY >> 4) + GRID_MARGIN;
  return [base, base + GRID_PITCH, base + 2 * GRID_PITCH];
};
export const SEED_WEIGHT_MASK = 0x7f;        // CS:0xf713 `and ax,0x7f`

/**
 * CS:0xf6f7-0xf71a — pick the strategy id for one group descriptor.
 * @param {number} b8 descriptor +0x08   @param {number} b9 descriptor +0x09
 * @param {number} rnd the value from the replay table (masked here)
 */
export function seedStrategy(b8, b9, rnd) {
  const lo = b8 & 0x0f, hi = (b8 & 0xf0) >> 4;
  return b9 < (rnd & SEED_WEIGHT_MASK) ? hi : lo;   // `jnl` keeps LO
}

/* CS:0xf729 — strategy 1, the only one decoded end to end. Two horizontal runs
 * at heroY -/+ 64 and two vertical at heroX -/+ 64, each 8 cells stepping 16 px
 * (`mov bp,7` then `dec bp / jns`, so 8 iterations). */
export const SEED_BOX_RADIUS = 64;
export const SEED_BOX_STEP   = 16;
export const SEED_BOX_COUNT  = 8;
export function seedBoxCells(heroX, heroY) {
  const out = [];
  for (const dy of [-SEED_BOX_RADIUS, SEED_BOX_RADIUS])
    for (let i = 0; i < SEED_BOX_COUNT; i++)
      out.push([heroX - SEED_BOX_RADIUS + i * SEED_BOX_STEP, heroY + dy]);
  for (const dx of [-SEED_BOX_RADIUS, SEED_BOX_RADIUS])
    for (let i = 0; i < SEED_BOX_COUNT; i++)
      out.push([heroX + dx, heroY - SEED_BOX_RADIUS + i * SEED_BOX_STEP]);
  return out;
}

/* ── The cull ─────────────────────────────────────────────────────────────
 * CS:0xf59f-0xf5b2. Note it is the SAME window the entity module already uses
 * for its draw/update cull — the search reuses it rather than having its own. */
export const SEARCH_CULL = { xMin: -64, xMax: 352, yMin: -64, yMax: 224 };
export const searchable = (x, y, camX, camY) => {
  const sx = x - camX, sy = y - camY;
  return sx > SEARCH_CULL.xMin && sx < SEARCH_CULL.xMax
      && sy > SEARCH_CULL.yMin && sy < SEARCH_CULL.yMax;
};

/**
 * CS:0xf586. Returns a verdict in 0..7, or VERDICT_NONE.
 *
 * Two call shapes:
 *   - `search(entity, camX, camY, { expand })` with a caller-supplied expand,
 *     used by the verification suite to drive the loop in isolation;
 *   - `runSearch(...)` in pathfind-producers.js, which supplies the real four
 *     stages. That is what the game uses.
 */
export function search(entity, camX, camY, { expand = null, state = null } = {}) {
  if (!searchable(entity.x, entity.y, camX, camY)) return VERDICT_NONE;

  const st = state || {
    verdict: VERDICT_NONE,                // DS:0x2ac
    best: 0xFFFF,                         // DS:0x2ae
    depth: 0,                             // DS:0x2b0
    firstMove: 0,                         // DS:0x2b2
    grid: new Int8Array(GRID_CELLS),      // SS:0x1c70 — SIGNED, -1 = goal
    open: new OpenList(),
  };

  if (!expand) return VERDICT_NONE;

  expand(st, entity.x, entity.y);
  while (st.best > GOOD_ENOUGH) {                 // CS:0xf5d8 / 0xf635, UNSIGNED
    const node = st.open.pop();
    if (!node) break;
    st.depth = node.cost;                         // CS:0xf623 -> DS:0x2b0
    st.nodeCost = node.cost;                      //   (the producers' field name)
    st.firstMove = node.firstMove;                // CS:0xf627 -> DS:0x2b2
    expand(st, node.x, node.y);
    st.open.wrapAfterExpand();                    // CS:0xf63c
  }
  return st.verdict;
}
