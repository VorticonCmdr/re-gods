/* nest.js — the DS:0xcfcc co-tenant: a placed WORLD-2 enemy the port did not have.
 *
 * ── WHAT THIS IS, AND WHY IT WAS MISSED ──────────────────────────────────
 *
 * Last session's pass over DS:0xcfcc found TWO tenants sharing one ten-slot
 * pool. One is the falling hazard — decoded, and proven CUT: no shipped
 * descriptor selects it. The other was left as UNKNOWN_cfcc_cotenant, and the
 * natural assumption after finding a cut feature is that its neighbour is one
 * too. It is not. This one is placed 32 times.
 *
 * It was missed because it is reached by a mechanism nothing else in this
 * project uses: not the plane-B selector table, not the entity group
 * descriptors, but the OBJECT ARRAY. A map object whose POBJECTS category is 4
 * is routed by SPRITE ID through a chain of `cmp cx,imm / jz` arms, and one of
 * those arms calls an allocator. The object does not get picked up, does not
 * get drawn by the ordinary object draw, and never appears in any of the
 * entity censuses this project ran.
 *
 * ── REACHABILITY `[PROVEN]` ──────────────────────────────────────────────
 *   Object type 115  (sprite 170 + 115 = 285 = 0x11d), POBJECTS category 4,
 *   name and description BOTH EMPTY in all four POBJECTS files.
 *   Placed 16x in PLEV2A and 16x in PLEV2B, and ZERO times in the other six
 *   maps — which matches the allocator's own `cmp byte [0x42],2` world gate
 *   exactly. Two independent facts agreeing is what makes this reachability
 *   claim solid rather than a plausible reading.
 *
 * ── THE ROUTE FROM A MAP OBJECT TO A LIVE CREATURE `[PROVEN]` ────────────
 *   CS:0x1511  the per-object body: ax = [si] (world X), bx = [si+2] (world Y),
 *              cx = [si+4] (type). CS:0x1526 saves the world Y to SS:0x432.
 *   CS:0x15F1  `sub ax,[0xa]`  <- X becomes SCREEN. Y is NOT touched.
 *   CS:0x160D  category < 3 leaves here.
 *   CS:0x1613  bx is RESTORED to the world Y from SS:0x432.
 *   CS:0x161D  `cmp byte [di+4],4 / jnz` -> CATEGORY 4 jumps to 0x1b5b.
 *   CS:0x1CC6  `cmp cx,0x11d / jz 0x1c91`      <- sprite 285, this creature
 *   CS:0x1C91  `call 0x8611`                   <- the allocator
 *
 * ⚠️ SO ax IS SCREEN X AND bx IS WORLD Y AT THE CALL. That is not sloppiness
 * on the caller's part and not symmetry to be tidied up: CS:0x1613 puts the
 * world Y back DELIBERATELY, from a value saved before any adjustment. It is
 * why the allocator does `add ax,[0xa]` with no matching `add bx,[0xc]` — the
 * one that looks missing was never needed.
 */

export const OBJECT_TYPE = 115;
export const OBJECT_SPRITE = 285;          // 170 + 115; also POBJ1 frame 115
export const WORLD = 2;                    // CS:0x8611 `cmp byte [0x42],2`
export const POOL_DS = 0xcfcc;
export const SLOTS = 10;                   // CS:0x861C `mov cx,0xa`
export const STRIDE = 10;                  // CS:0x8624 `add si,0xa`

/* ── The record, 10 bytes ─────────────────────────────────────────────────
 *   +0x00  i16  world X   — NEGATIVE means the slot is free (CS:0x861F `js`)
 *   +0x02  i16  world Y
 *   +0x04  i16  STATE, signed: -4..-1 hatching, 0..4 alive, 0..6 dying
 *   +0x06  i16  HP        — negative means dying (CS:0x869F `jns`)
 *   +0x08  i16  TIMER     — hatch delay, then the fire period
 *
 * ⚠️ The other tenant of this pool (the falling hazard) reads +4/+6/+8 with
 * completely different meanings. Nothing interlocks them. See POOL_NOTE.
 */

/* ── The seeds, CS:0x862B-0x8657 ──────────────────────────────────────── */
export const SEED_X_BIAS = 3;              // CS:0x8632 `add ax,0x3`
export const SEED_Y_BIAS = -0x18;          // CS:0x862F `sub bx,0x18`
export const SEED_STATE = -4;              // CS:0x863F `mov word [si],0xfffc`
export const SEED_HP = 0x3c;               // CS:0x8646 — 60
export const SEED_TIMER_BASE = 0x28;       // CS:0x864D, then + (rand & 0xf)
export const SEED_TIMER_MASK = 0x0f;       // CS:0x8654 `and ax,0xf`

/* ── Sprites `[PROVEN]`, and the range closes exactly ─────────────────────
 * sprite = SPRITE_BASE + state, and state runs -4..+4, so the creature owns
 * the NINE CONSECUTIVE frames 512..520. Rendered from the shipped atlases
 * under world 2's load order those are PLEVEL2B frames 8..16, and they read
 * as: four frames of something growing upward out of nothing (512-515), then
 * aim-left, fired-left, a symmetric upright pose, aim-right, fired-right
 * (516-520). Frame 521 is visibly a different creature.
 *
 * That is a genuine cross-check, not a restatement: the state semantics were
 * derived from the SIGNS OF TWO `cmp bx,ax / jl` BRANCHES in the fire logic,
 * with no reference to the art. The art then puts the symmetric pose on
 * exactly the state the dead band writes, and the mirrored pair on exactly
 * the two states that fire in opposite directions. A wrong reading of either
 * branch would have put the upright frame off-centre. */
export const SPRITE_BASE = 0x204;          // 516 — CS:0x8765 / 0x88B4 `add dx,0x204`
export const SPRITE_FIRST = SPRITE_BASE + SEED_STATE;   // 512, the first hatch frame
export const SPRITE_LAST = SPRITE_BASE + 4;             // 520, fired-right

/** Death draws `state + 0x6c` — a cloud that swells and then splits. Sprites
 *  108..114 are PALWAYS2#69..71 then PALWAYS3#0..3, so the sequence CROSSES AN
 *  ATLAS BOUNDARY; the cumulative descriptor numbering is what makes that
 *  work, and a port that resolves sprites per-atlas will break here. */
export const DEATH_SPRITE_BASE = 0x6c;     // 108 — CS:0x87B2 `add dx,0x6c`

/* ── Boxes. The hitbox CHANGES with state, and by a lot ───────────────────
 *   hatching: 8x8 at (x+8, y+15)     CS:0x8878-0x888F
 *   alive:   24x24 at (x,   y)       CS:0x873B-0x874C
 * A hatching creature is nine times smaller in area and offset into the
 * middle of its own sprite, so it is very hard to shoot before it stands up.
 * A port using one box makes the whole emergence phase a free kill. */
export const BOX_HATCH = Object.freeze({ w: 8, h: 8, dx: 8, dy: 15 });
export const BOX_ALIVE = Object.freeze({ w: 0x18, h: 0x18, dx: 0, dy: 0 });

/* ── The on-screen test for hatching, CS:0x8850-0x8869 ────────────────────
 * All four compares are SIGNED (jng / jnl / jl / jg) and all four are
 * exclusive-on-fail, i.e. the interval below is inclusive at both ends.
 *
 * ⚠️ A SEVENTH DISTINCT CULL RECTANGLE. This project already records six that
 * disagree with each other; adding a shared helper would be wrong six times.
 *   System-B entity   x [-63, 351]  y [-63, 223]
 *   starburst         x  [-8, 351]  y  [-8, 191]
 *   this one          x [-24, 320]  y   [8, 176]
 * Note the Y floor of +8 — this is the only one that culls at the TOP of the
 * screen rather than above it. */
export const HATCH_WINDOW = Object.freeze({ xMin: -0x18, xMax: 0x140, yMin: 8, yMax: 0xb0 });

/* ── Timers ───────────────────────────────────────────────────────────────
 * One counter, DS record +8, doing two jobs in sequence.
 *
 * HATCH: while state is -4 the timer only ticks WHEN THE CREATURE IS ON
 * SCREEN (CS:0x886B sits inside the window test; CS:0x88DE resets it to 0x27
 * when off screen). So a nest the player never approaches never opens, and
 * one they walk away from re-arms. That is the spawn gate, and it is why
 * there is no separate "activated" flag.
 *
 * FIRE: CS:0x86BB `cmp word [si+8],0x28 / jg` runs the aim logic only once
 * the timer is at or below 40. The seed is 40..55, so a fresh creature waits
 * a randomised 0..15 ticks before it can first aim. The reload is 42, which
 * is GREATER than the 40 gate — so for two ticks after every shot the aim
 * logic is skipped entirely and the creature holds its fired pose. */
/* ⚠️ THE RANDOM PART OF THE SEED IS PROBABLY NEVER OBSERVED. All four cull
 * branches of state -4 target CS:0x88DE, which forces the timer to 39 on
 * EVERY off-screen frame — and the activation box (CS:0x11A0, +-64/+-48
 * around the screen) is LARGER than the emerge window below, so an
 * approaching nest is normally allocated while still culled and the
 * `0x28 + (rand & 0xf)` is overwritten before it is ever decremented.
 * Reproduce the draw anyway (it advances the shared table cursor), but do not
 * claim it staggers anything. UNKNOWN_cfcc_dormant_seed_observable. */
export const AIM_GATE = 0x28;              // 40
export const FIRE_RELOAD = 0x2a;           // 42 — CS:0x86DF / 0x870D
export const HATCH_RELOAD = 0x27;          // 39 — CS:0x8870 / 0x88DE
/** Ticks between shots: the dec that fires happens at 0, and the reload is 42. */
export const FIRE_PERIOD = FIRE_RELOAD + 1;             // 43 ticks ~= 2.87 s at 15 Hz

/* ── Hatch advance rate, CS:0x8834 ────────────────────────────────────────
 * States -3..-1 advance one step per tick ONLY when DS:0x36c reads zero, and
 * DS:0x36c is the every-other-frame toggle (CS:0x0172 flips it with NOT — the
 * same one the destructible-block animation uses). So the hatch runs at half
 * rate: three steps over six ticks. State -4 is not on this path.
 *
 * ⚠️ When the increment carries state to 0 the handler does NOT stop — it
 * `jmp 0x86b1`, straight into the live AI, in the SAME TICK. So the first
 * live frame is not a fresh tick; a port that returns after the increment
 * loses one tick of aiming on every creature. */
export const HATCH_EVERY_OTHER_FRAME = true;

/* ── THE FIRE LOGIC, CS:0x86C1-0x8736 `[PROVEN]` ──────────────────────────
 *
 *   86C1  ax = [si]            ; entity X
 *   86C3  bx = [0x17a]         ; hero X
 *   86C7  add bx,0x20
 *   86CA  cmp bx,ax / jl 0x8703      ; heroX + 32 < entityX  -> hero is LEFT
 *   86CE  sub bx,0x38                ; bx is now heroX - 24  (CUMULATIVE!)
 *   86D1  cmp bx,ax / jl 0x8736      ; heroX - 24 < entityX  -> the DEAD BAND
 *   86D5  mov word [si+4],3          ; else                  -> hero is RIGHT
 *
 * ⚠️ THE SECOND OFFSET IS APPLIED TO THE ALREADY-BIASED bx. Reading `sub
 * bx,0x38` as a fresh offset from heroX gives -56 instead of -24 and widens
 * the dead band to 88 px.
 *
 * ⚠️ AND THE BAND IS NOT CENTRED: 32 px to the left, 24 px to the right, and
 * the right edge is EXCLUSIVE while the left is inclusive. Mirroring one side
 * to build the other is wrong by 8 px. */
export const BAND_LEFT = 0x20;             // 32
export const BAND_RIGHT = 0x18;            // 24

/* ── ⚠️ A SHIPPED BUG: the caller tests the WRONG FLAG ────────────────────
 * CS:0x8611 signals failure with STC and success with CLC, exactly like its
 * sibling allocator CS:0x7F0D — and the sibling's caller tests it correctly:
 *   CS:0x1C7D  call 0x7f0d / CS:0x1C80  jc 0x1ce0     <- carry, right
 *   CS:0x1C91  call 0x8611 / CS:0x1C94  jz 0x1ce0     <- ZERO, wrong
 * Two adjacent arms, same shape, different flag. Trace what ZF actually holds
 * at each return:
 *   success      last flag-setter is CS:0x8657 `add [si],ax` on the timer,
 *                which lands in 0x28..0x37 -> never zero -> ZF=0
 *   pool full    last flag-setter is the final `cmp word [si],0`; an occupied
 *                slot has x != 0 -> ZF=0.  `loop` and `stc` leave ZF alone.
 *   wrong world  `cmp byte [0x42],2` failed, so ZF=0 by construction.
 * ZF=0 in all three, so `jz` is never taken and the fall-through ALWAYS runs:
 *   CS:0x1C98  mov word [si+4],0xffff   <- the object is marked DEAD
 *
 * Two consequences a port must reproduce:
 *   1. A NEST FIRES EXACTLY ONCE. It is consumed the first frame it is
 *      active, so a level's 16 nests give at most 16 creatures, not a stream.
 *   2. If the ten-slot pool is full at that moment, or the world is not 2,
 *      the nest is consumed anyway and NOTHING SPAWNS. The intended `jc`
 *      would have left it to retry on a later frame.
 * Calling spawn() every frame while an object is on screen — the obvious
 * reading of an allocator that can fail — gives a continuous stream of
 * creatures and is a different game. */

/** CS:0x86CA / 0x86D1. -1 = hero left (fire left), 0 = dead band, +1 = hero right. */
export function aimAt(entityX, heroX) {
  if (heroX + BAND_LEFT < entityX) return -1;          // CS:0x86CA `jl`
  if (heroX - BAND_RIGHT < entityX) return 0;          // CS:0x86D1 `jl`
  return +1;
}

/* ── The muzzle, and it is asymmetric too ─────────────────────────────────
 *   right: (x + 0x18, y + 6), DS:0x206 = +5, call CS:0x2039
 *   left:  (x - 0x06, y + 6), DS:0x206 = -5, call CS:0x1FE7
 * +24 against -6. The right muzzle sits at the far edge of the 24-wide body
 * and the left one just outside its near edge. */
export const MUZZLE = Object.freeze({
  right: { dx: 0x18, dy: 6, dir: +5 },
  left:  { dx: -6,   dy: 6, dir: -5 },
});

/* ── The states `[PROVEN]` ────────────────────────────────────────────────
 *   -4  seeded; waits for the creature to be ON SCREEN, then starts
 *   -3  hatching, half rate
 *   -2  hatching
 *   -1  hatching (and the LAST frame drawn through export 1, see below)
 *    0  hero is left  — aiming
 *    1  fired left    — written on the firing tick only, so ONE tick
 *    2  the dead band — idle
 *    3  hero is right — aiming
 *    4  fired right   — one tick
 *
 * ⚠️ States 1 and 4 render for exactly one tick each: the aim logic rewrites
 * the state to 0/2/3 on the very next tick. */
export const ST = Object.freeze({
  SEED: -4, AIM_LEFT: 0, FIRED_LEFT: 1, BAND: 2, AIM_RIGHT: 3, FIRED_RIGHT: 4,
});

/* ⚠️ The blitter changes mid-hatch. CS:0x88AF `cmp dx,0xffff / jnl` sends
 * state >= -1 to CS:0x3569 (graphics export 1) and everything below it to
 * CS:0x356E (export 2). So states -4, -3, -2 draw through export 2 and state
 * -1 onward through export 1 — different clip bounds on the last hatch frame
 * than on the three before it. */
export const HATCH_EXPORT2_BELOW = -1;

/* ── Freeze `[PROVEN]` ────────────────────────────────────────────────────
 * CS:0x86B1 `cmp word [0x2fa],0 / jnz 0x873b`. DS:0x2fa is the "magic potion
 * / freezes aliens" timer (170 ticks, already proven from the consumable
 * side). The jump lands PAST the aim and fire logic but BEFORE the contact
 * test and the draw — so a frozen creature still hurts the hero on contact,
 * still takes damage, still draws, and only stops aiming and shooting. And
 * its timer stops too, because both decrements live in the skipped region. */
export const FREEZE_DS = 0x2fa;

/* ── Death, CS:0x87A4-0x87ED ──────────────────────────────────────────────
 * Entered when HP goes negative. Each tick: draw `state + 0x6c` TWICE, at
 * (x-4, y-8) and 0x18 lower, then `inc state`.
 *   state becomes exactly 4  -> spawn the brood (CS:0x87E0 `jmp 0x88e5`)
 *   state reaches 7          -> free the slot
 *
 * ⚠️ DEATH INHERITS THE LIVE STATE — it does not reset to 0. So how long a
 * creature spends dying, and whether it broods at all, depends on which pose
 * it was in when it died:
 *   killed in state 0 -> 1,2,3,4(brood),5,6 then freed: 7 ticks, broods
 *   killed in state 3 -> 4(brood),5,6:                  3 ticks, broods
 *   killed in state 4 -> 5,6:                           2 ticks, NO BROOD
 * The `cmp ...,4 / jnz` is an equality test, so a creature killed on the one
 * tick it holds the fired-right pose skips the brood entirely. Narrow, but it
 * is in the bytes and a port written with `>= 4` loses it. */
export const BROOD_AT_STATE = 4;
export const DEATH_FREE_AT_STATE = 7;
export const DEATH_DRAW_OFFSET = Object.freeze({ dx: -4, dy: -8, secondDy: 0x18 });

/* ── The brood, CS:0x88E5-0x894A ──────────────────────────────────────────
 * Target array DS:0x8014, 16 records of 16 bytes, free when +4 is negative.
 *
 * ⚠️ THE COUNT IS 3 OR 4, NOT 2 OR 3. `mov dx,2 / add dx,(rand & 1)` then at
 * the bottom `dec dx / jns 0x88f2`. Walk it: dx=2 spawns, dec->1 spawns,
 * dec->0 spawns, dec->-1 exits. Three. This project has now been caught by
 * the dec/jns off-by-one four times (starburst particles, hits-to-break, the
 * block's first shot, and this), so the rule is: WALK THE LOOP.
 *
 * ⚠️ A full brood array ABANDONS THE WHOLE BURST, not just one child:
 * CS:0x8904 `jmp 0x878c` leaves the per-record walk entirely rather than
 * continuing the dx loop.
 *
 * Child seeds:
 *   +0, +2 = the parent's x, y (CS:0x8907 `movsw / movsw`, si is the PARENT),
 *            then +2 += 0x18 — the brood appears one tile BELOW the parent
 *   +4  = 0
 *   +6  = 0x2b (43)
 *   +8  = magnitude (rand & 3), sign taken from the SIGN OF THE WHOLE random
 *         word, not from the masked value: `mov bx,ax / and ax,3 / or bx,bx /
 *         jns / neg ax`. So the distribution is symmetric about zero with a
 *         doubled zero, which a naive `(rand & 3) - 2` does not reproduce.
 *   +0xa = -((rand & 3) + 2), i.e. -2..-5 — always negative
 *   +0xc = 1
 *
 * ⚠️ +8 and +0xa were carried as field8/fieldA with no label, because their
 * only consumer — the walker at CS:0x894E — was out of scope. It no longer
 * is: see `Brood`, below. They ARE {vx, vy}, and `#brood`'s own call
 * `brood.spawn(s.x, s.y + BROOD_Y_OFFSET, field8, fieldA, BROOD_HP)` was
 * already exactly the argument order `Brood.spawn(x, y, vx, vy, hp)` below
 * expects — nothing in THIS class changed to make that true. */
export const BROOD_ARRAY_DS = 0x8014;
export const BROOD_SLOTS = 16;             // CS:0x88F5 `mov bp,0xf` + dec/jns
export const BROOD_STRIDE = 0x10;          // CS:0x88FE `add di,0x10`
export const BROOD_Y_OFFSET = 0x18;        // CS:0x890F
export const BROOD_HP = 0x2b;              // CS:0x8932
/** CS:0x88E7 + CS:0x8947 — walked, not read off the seed. */
export const broodCount = (rand) => 3 + (rand & 1);

/* ── THE BROOD WALKER, CS:0x894E — CLOSED, no longer out of scope `[STATIC]`
 *
 * This project's CLAUDE.md independently disassembled this exact address
 * range and closed it under `UNKNOWN_8014_brood — CLOSED` after the comment
 * above (and a task-level pseudocode summary this pass started from) were
 * written. Cross-checking against it before writing `Brood` caught real
 * divergences from that summary — recorded below, in this file's own
 * "⚠️ CORRECTION" convention, because CLAUDE.md's byte-level decode is the
 * more authoritative of the two and this project does not ship a class that
 * contradicts its own primary source when a closer read is available.
 *
 *   894E  si = 0x8014 ; cx = 0x10                     ; 16 slots
 *   895A  cmp word[si+4],0 / jns 0x8963 / jmp 0x8a07  ; +4 < 0 -> FREE, skip
 *   8963  inc byte[0x3af]                              ; live-count (not modelled — see below)
 *   8967  cmp word[si+6],0 / jns 0x8970 / jmp 0x8a33   ; +6 < 0 -> DEATH BRANCH
 *   8970  cmp word[si+0xc],0 / jz 0x8979 / jmp 0x8ab1  ; +0xc != 0 -> BALLISTIC FALL, unconditionally
 *   8979  cmp word[0x2fa],0 / jnz 0x8983 / call 0x8a6c ; +0xc == 0 -> GROUND BOUNCE, but ONLY when not frozen
 *   8983  ax=[si] bx=[si+2] bp=[si+6]                  ; the shared CONTACT+DRAW tail
 *   8997  call 0x1000:a9e4                              ; the SAME hero-contact-and-damage-grid-scan thunk every creature in this game uses
 *   899A  [si+6] = bp                                   ; strength written back — the familiar BP-round-trip convention
 *   899D  dx = [si+4] ; shl dx,1                        ; frame DOUBLED -> a word index
 *   89A2  di = 0x360a + dx ; dx = word[ss:di]            ; SS:0x360A, the sprite table (contents never read out)
 *   89AA  cmp word[si+8],0 / js .. / add dx,3            ; vx negative -> no +3; else (incl. vx==0) +3
 *
 * ⚠️ THE DEATH GATE IS +0x6 (strength), NOT +0x4 (frame). The pseudocode this
 * pass started from described ONE field doing all three jobs (sprite index,
 * dying counter, free sentinel) and had the contact call set that field to -1
 * to enter death. The bytes disagree: +0x4 is ONLY EVER the free-test and the
 * alive sprite index; it is +0x6 going negative (CS:0x8967) that routes into
 * the death branch, and the contact call's own strength write-back
 * (CS:0x899A) is what arms it — nothing ever writes -1 into +0x4.
 *
 *   8A33  ax=[si] bx=[si+2] dx=[si+4]                  ; world X/Y, frame
 *   8A3B  ax -= [0xa] ; bx -= [0xc]                     ; -> screen
 *   8A43  ax -= 4 ; bx -= 0x11 ; dx += 0x6c              ; draw offset AND sprite base
 *   8A4D  [0x4]=ax [0x6]=bx [0x8]=dx ; call 0x3569        ; ONE draw, not the parent's two
 *   8A5C  inc word[si+4] / cmp 7 / jl 0x8a07              ; frame COUNTS UP, capped at 7
 *   8A65  [si+4] = 0xffff                                 ; free
 *
 * ⚠️ THE DEATH SPRITE COUNTS UP, NOT DOWN, and the Y OFFSET IS -0x11 (-17),
 * NOT -8. The pseudocode this pass started from had frame counting DOWN from
 * -1 to -8 with a (-4,-8) draw offset explicitly borrowed from the PARENT's
 * own DEATH_DRAW_OFFSET, and asserted that reuse as fact. The bytes show
 * frame INCREMENTING from whatever value it held while alive — so, exactly
 * like the parent, death duration depends on the pose held at the moment of
 * death, capped rather than fixed at 7 — and a Y offset of -0x11, not -8.
 * DEATH_FREE_AT_STATE (7) is still the right constant to reuse, because the
 * shipped cap really is 7 in both places; it is reused below as a CAP an
 * up-counter is compared against, not as a guaranteed duration. The parent's
 * DEATH_DRAW_OFFSET is NOT reused — see BROOD_DEATH_DRAW_OFFSET below, whose
 * X matches the parent's (-4) and whose Y does not.
 *
 * ⚠️ BALLISTIC FALL DOES NOT HONOUR FREEZE; GROUND BOUNCE DOES. CS:0x8970
 * jumps straight into the fall routine (0x8AB1) BEFORE the freeze test at
 * CS:0x8979 is ever reached; only a BOUNCING child (fallSubstate 0) passes
 * through that test. So a falling brood child keeps falling under "freezes
 * aliens" while a bouncing one is held still. Implemented as traced, not
 * smoothed into one rule — matching this file's own convention of keeping
 * the parent's asymmetric cull rectangles and muzzles asymmetric.
 *
 * ⚠️ NO SCORE AWARD IS VISIBLE ON THIS PATH. CS:0x8A33-0x8A65 is draw / inc /
 * free with no `call 0xc8b` (the shared BCD score entry this project
 * documents elsewhere for other kills). So either a brood kill genuinely
 * awards nothing, or an award happens somewhere off this decoded path —
 * UNKNOWN_brood_score, below, is that second half; the first half (no award
 * ON this specific path) is not itself in doubt.
 *
 * Not modelled: the gate byte at CS:0x894D and the live-counter DS:0x3af
 * (self-disarm bookkeeping — see LIVE_COUNTER_DS above for the PARENT's own
 * version of the same idiom). A 16-element JS array costs nothing to walk
 * every tick regardless of occupancy, so there is no observable behaviour to
 * reproduce by adding an equivalent flag here.
 */

export const BROOD_SEED_FRAME = 0;                  // "+4 = 0", already in the seed block above
export const BROOD_SEED_FALL_SUBSTATE = 1;          // "+0xc = 1" — children start FALLING, not bouncing
/** CS:0x898B `[0x1e2]=0x18(24) ; [0x1e4]=0x10(16)` — a THIRD box size in this
 *  file, distinct from both BOX_HATCH (8x8) and BOX_ALIVE (24x24). */
export const BROOD_BOX = Object.freeze({ w: 0x18, h: 0x10 });
/** CS:0x8A6C. The ground-bounce wall probe adds this to the STEPPED x only
 *  when moving right (vx >= 0) — the same muzzle-style facing offset this
 *  project documents everywhere else; the left probe adds nothing. */
export const BROOD_BOUNCE_PROBE_X = 0x18;
/** CS:0x8AB1, "(+0xc, +0xf) past the new position" — pinned to the byte. */
export const BROOD_FALL_PROBE = Object.freeze({ dx: 0x0c, dy: 0x0f });
/** CS:0x8AB1 `inc / cmp 8 / jle`. An EIGHTH independently-coded gravity rule
 *  in this project's running collection (hero 4+v/cap10, System-B v-then-
 *  ++/cap16, time bomb stepped ++/cap4, magic axe +=2/cap8, starburst every-
 *  8th-frame ++, chest loot ++/cap4) — the cap matching the magic axe's is a
 *  coincidence of two separate authorings, not a shared routine. */
export const BROOD_FALL_GRAVITY_CAP = 8;
/** CS:0x8A43. ⚠️ NOT the parent's DEATH_DRAW_OFFSET — the X (-4) matches, the
 *  Y does not (-0x11, not -8). See the correction above. */
export const BROOD_DEATH_DRAW_OFFSET = Object.freeze({ dx: -4, dy: -0x11 });
export const BROOD_FACING_OFFSET = 3;               // CS:0x89AA `add dx,3`

/**
 * SS:0x360A. CLAUDE.md's own CS:0x894E decode proves the LOOKUP exists (a
 * frame-doubled word index into a small table) and proves the +-3 facing
 * variant, but records no concrete byte ever read from the table itself —
 * the residual it closed was the MECHANISM, not the CONTENTS, and no pass
 * over this project (including this one) has read SS:0x360A live. Per this
 * task's own instruction not to fabricate specific numbers, this is an
 * IDENTITY placeholder — frame passed straight through, not an invented
 * sprite sequence dressed up as a finding. See UNKNOWN_brood_sprite_table,
 * below.
 */
export const BROOD_SPRITE_TABLE = Object.freeze([0, 1, 2, 3]);

/** CS:0x89AA. `js` skips the `add dx,3` only when vx is NEGATIVE, so the
 *  offset applies when vx is non-negative — right-facing, or stalled at
 *  exactly 0 — the same "non-negative, not strictly positive" convention
 *  this file already uses for the parent (HATCH_EXPORT2_BELOW, aimAt). */
export function broodFacingOffset(vx) {
  return vx >= 0 ? BROOD_FACING_OFFSET : 0;
}

/** CS:0x8A6C / CS:0x8AB1's own tile probes. This project's standard floored-
 *  tile addressing: col = x>>5, row = y>>4, cell = row*128+col — the same
 *  plane-B stride the hero's and every entity's own probes use elsewhere in
 *  this game. Not exported: purely a shared implementation detail of the two
 *  movement modes below. */
function broodTileCell(x, y) {
  return (y >> 4) * 128 + (x >> 5);
}

/**
 * DS:0x8014, 16 records of 16 bytes — the array a dying Nests creature
 * bursts into. `Nests#brood` (above) already calls `.spawn(...)` with
 * exactly the argument order this class expects; nothing there changed.
 */
export class Brood {
  constructor() {
    this.slots = Array.from({ length: BROOD_SLOTS }, () => ({
      x: 0, y: 0, frame: -1, strength: 0, vx: 0, vy: 0, fallSubstate: 0,
    }));
    this.killed = 0;
    /** CS:0x8A33-0x8A65 is draw / inc / free with no score-award call on
     *  this path. Kept at 0 rather than guessed at. UNKNOWN_brood_score. */
    this.score = 0;
  }

  /** CS:0x895A's own free-slot search over BROOD_SLOTS, reached from
   *  Nests#brood with (x, y, field8, fieldA, BROOD_HP). */
  spawn(x, y, vx, vy, hp) {
    const free = this.slots.find((s) => s.frame < 0);     // CS:0x895A `jns`
    if (!free) return false;
    free.x = x; free.y = y;
    free.frame = BROOD_SEED_FRAME;                          // +4 = 0
    free.strength = hp;                                     // +6 = 0x2b
    free.vx = vx; free.vy = vy;                             // +8, +0xa
    free.fallSubstate = BROOD_SEED_FALL_SUBSTATE;            // +0xc = 1 -- BALLISTIC, not bounce
    return true;
  }

  /** Level init — no CS: address of its own; this port's equivalent of
   *  clearing all 16 records to the free sentinel. */
  clear() {
    for (const s of this.slots) s.frame = -1;
    return this;
  }

  get live() { return this.slots.reduce((n, s) => n + (s.frame >= 0 ? 1 : 0), 0); }

  /**
   * CS:0x894E. One tick over all 16 slots.
   * @param {{x:number,y:number}} cam
   * @param {number} freezeTimer   DS:0x2fa — honoured by GROUND BOUNCE only, see above
   * @param {(e:object)=>number} contact  the CS:0xa9e4 thunk, BP-in-BP-out, same shape Nests uses
   * @param {?Uint8Array} planeB
   * @returns {{drawn:Array}}
   */
  step(cam, freezeTimer, contact, planeB) {
    const drawn = [];
    for (const s of this.slots) {
      if (s.frame < 0) continue;                          // CS:0x895A -- free, skip

      if (s.strength < 0) { this.#death(s, cam, drawn); continue; }   // CS:0x8967

      if (s.fallSubstate !== 0) {
        this.#fall(s, planeB);                              // CS:0x8970 -- unconditional, ignores freeze
      } else if (freezeTimer === 0) {
        this.#bounce(s, planeB);                            // CS:0x8979 -- gated on freeze
      }

      s.strength = contact({ x: s.x, y: s.y, w: BROOD_BOX.w, h: BROOD_BOX.h, hp: s.strength });   // CS:0x8997/0x899A
      const sprite = (BROOD_SPRITE_TABLE[s.frame] ?? s.frame) + broodFacingOffset(s.vx);          // CS:0x899D-0x89AA
      drawn.push({ x: s.x - cam.x, y: s.y - cam.y, sprite, gfxExport: 1 });
      if (s.strength < 0) this.killed++;
    }
    return { drawn };
  }

  /** CS:0x8A6C. Plain linear X, no accel/cap. */
  #bounce(s, planeB) {
    s.x += s.vx;
    const probeX = s.x + (s.vx >= 0 ? BROOD_BOUNCE_PROBE_X : 0);   // the muzzle-style facing offset
    /* CS:0x8A76 probes at y+4. CS:0x8A83-0x8A8F: a wall at the probe
     * reverses; otherwise ground one row below keeps going (`jz 0x8a92`
     * ret), and NO ground below — a ledge — reverses too. [PROVEN] live
     * against PJOYL2 1902-1904 (DS:0x8014): the landed brood walks on at +-2.
     * An earlier revision probed at y and reversed ON ground, so a landed
     * child jittered in place. */
    const cellHere = broodTileCell(probeX, s.y + 4);
    const cellBelow = cellHere + 128;                                // [di+0x80], one tile row down
    const wall = planeB && planeB[cellHere] === 1;
    const ground = planeB && planeB[cellBelow] === 1;
    if (planeB && (wall || !ground)) s.vx = -s.vx;                               // NEG word[si+8] -- the step above is NEVER undone
  }

  /** CS:0x8AB1. Gravity-fed, capped, with a lookahead landing probe. */
  #fall(s, planeB) {
    s.x += s.vx; s.y += s.vy;
    s.vy = Math.min(s.vy + 1, BROOD_FALL_GRAVITY_CAP);
    const probeX = s.x + BROOD_FALL_PROBE.dx, probeY = s.y + BROOD_FALL_PROBE.dy;
    const cellHere = broodTileCell(probeX, probeY);
    const cellAbove = cellHere - 128;
    const solidHere = planeB && planeB[cellHere] === 1;
    const solidAbove = planeB && planeB[cellAbove] === 1;
    if (solidAbove || !solidHere) return;                            // keep falling
    /* LAND — CS:0x8AE7-0x8B06: `and [si+2],0xfff0 / inc [si+2]`, i.e. floor
     * to the tile row and add ONE PIXEL (not a whole row, as an earlier
     * revision read it); fall and vy cleared; vx forced to +-2 by its sign
     * (0 counts as +). [PROVEN] live against PJOYL2 cursor 1901 (DS:0x8014):
     * y 396+5 -> 401, vx 0 -> 2 and -1 -> -2. */
    s.y = (s.y & ~0xf) + 1;
    s.fallSubstate = 0;
    s.vy = 0;
    s.vx = s.vx < 0 ? -2 : 2;
  }

  /** CS:0x8A33. Draws using the CURRENT (pre-increment) frame, ONE draw. */
  #death(s, cam, drawn) {
    const sprite = DEATH_SPRITE_BASE + s.frame;                       // 0x6c + frame, COUNTING UP
    drawn.push({ x: s.x - cam.x + BROOD_DEATH_DRAW_OFFSET.dx,
                 y: s.y - cam.y + BROOD_DEATH_DRAW_OFFSET.dy,
                 sprite, gfxExport: 1 });
    s.frame += 1;                                                      // CS:0x8A5C
    if (s.frame >= DEATH_FREE_AT_STATE) s.frame = -1;                  // CS:0x8A65 -- DEATH_FREE_AT_STATE(7) reused as a CAP, not a fixed duration
  }
}

/* ⚠️ DS:0x8014 IS ITSELF SHARED, and by world rather than by accident.
 * CS:0x7CBD and CS:0x7EB6 both gate on `cmp byte [0x42],1` — a WORLD-1
 * subsystem owns the same 256 bytes, and CS:0x7E62 uses them to write PLANE A
 * (`mov si,0x3004 / mov [si],bl`). The two tenants are mutually exclusive by
 * world, which is why nothing interlocks them and why the level-init clear at
 * CS:0x8676 zeroes this array ONLY in world 2. UNKNOWN_8014_world1. */

/* ── The pool's lifecycle `[PROVEN]` ──────────────────────────────────────
 * CS:0x8661, called from CS:0x69C0 and CS:0x8E4F (level init), does four
 * things in order:
 *   1. disarm this creature's walker    (`mov byte [cs:0x8687],0xc3`)
 *   2. disarm the brood walker          (`mov byte [cs:0x894d],0xc3`)
 *   3. IN WORLD 2 ONLY, fill DS:0x8014 with 0xFFFF (0x80 words = 256 bytes)
 *   4. `mov si,0xcfcc / jmp 0x7f48` — clear the pool
 *
 * ⚠️ Step 4 jumps INTO THE MIDDLE of a third subsystem's clear routine.
 * CS:0x7F45 is `mov si,0xce64` falling into the same loop at CS:0x7F48, and
 * that loop ends with `mov byte [cs:0x7f5c],0xc3` — which disarms the
 * DS:0xce64 walker. So clearing THIS pool also disarms a different one.
 * Shared-tail code reuse, not a bug, but a port that writes three independent
 * clear functions loses the coupling. UNKNOWN_ce64_pool. */
export const CLEAR_FILL = 0xffff;

/* ── The walker's self-disarm, CS:0x8796 ──────────────────────────────────
 * DS:0x3b2 is set to 0 at the top of the pass and incremented once per live
 * record; if it is still 0 at the end, the walker writes 0xC3 over its own
 * gate byte and stops being called.
 *
 * ⚠️ CORRECTION TO CLAUDE.md. That document says the two DS:0xcfcc tenants
 * share "one shared counter DS:0x3b2". They do share the ADDRESS, but each
 * walker resets it at the top of its own pass and reads it only at the bottom
 * of that same pass (all six references: CS:0x868E/0x869B/0x8796 here,
 * CS:0x8B5D/0x8B69/0x8C26 in the hazard). It is per-pass scratch, not state
 * carried between them. The real sharing hazard is the RECORDS. */
export const LIVE_COUNTER_DS = 0x3b2;

/* ═════════════════════════════════════════════════════════════════════════
 * The model. One class per pool, so the record-sharing stays visible.
 * ═════════════════════════════════════════════════════════════════════════ */

export class Nests {
  /**
   * @param {number} world   DS:0x42. The allocator refuses outside world 2.
   * @param {{next:()=>number}} rng  the replayed 256-word table
   */
  constructor(world, rng) {
    this.world = world;
    this.rng = rng;
    this.slots = Array.from({ length: SLOTS }, () => ({
      x: -1, y: 0, state: 0, hp: 0, timer: 0,
    }));
    this.armed = false;             // the [cs:0x8687] gate byte
    this.refused = 0;               // allocations lost to a full pool
    this.wrongWorld = 0;            // allocations refused by the world gate
    this.hatched = 0;
    this.killed = 0;
    this.shots = [];                // what CS:0x2039 / 0x1FE7 were handed
    this.broods = 0;
    this.broodlings = 0;
    this.broodsAbandoned = 0;
  }

  /**
   * CS:0x8611. Called from the object walk the first time a category-4 object
   * with sprite 0x11d is active — ONCE PER OBJECT, see the note below.
   *
   * @param {number} screenX  ax at the call — SCREEN x (CS:0x15F1)
   * @param {number} worldY   bx at the call — WORLD y  (CS:0x1613)
   * @param {number} camX     DS:0x0a
   * @returns {boolean} true on success — the original returns CLC/STC.
   */
  spawn(screenX, worldY, camX) {
    if (this.world !== WORLD) { this.wrongWorld++; return false; }   // CS:0x8611
    const free = this.slots.find((s) => s.x < 0);                    // CS:0x861F `js`
    if (!free) { this.refused++; return false; }                     // CS:0x8629 `stc`
    free.x = screenX + camX + SEED_X_BIAS;                           // CS:0x862B/0x8632
    free.y = worldY + SEED_Y_BIAS;                                   // CS:0x862F
    free.state = SEED_STATE;                                         // CS:0x863F
    free.hp = SEED_HP;                                               // CS:0x8646
    free.timer = SEED_TIMER_BASE + (this.rng.next() & SEED_TIMER_MASK);
    this.armed = true;                                               // CS:0x8659
    return true;
  }

  /** CS:0x8661 — level init. Disarms first, then clears. */
  clear() {
    for (const s of this.slots) s.x = -1;
    this.armed = false;
    return this;
  }

  get live() { return this.slots.reduce((n, s) => n + (s.x >= 0 ? 1 : 0), 0); }

  /**
   * CS:0x8688, reached only through the armed gate byte at CS:0x8687, which
   * the main loop calls at CS:0x0282 — immediately before the System-B entity
   * step at CS:0x0285 and after the brood gate at CS:0x027F.
   *
   * @param {{x:number,y:number}} cam
   * @param {{x:number}} hero          hero world X (DS:0x17a)
   * @param {number} freezeTimer       DS:0x2fa
   * @param {(e:object)=>number} contact  the CS:0xa9e4 thunk: takes the box,
   *        returns the new HP. Must be BP-in-BP-out like System-B contact.
   * @param {?object} brood            the DS:0x8014 owner, or null
   * @param {number} tock              DS:0x36c, the every-other-frame toggle
   * @returns {{drawn:Array, shots:Array}}
   */
  step(cam, hero, freezeTimer, contact, brood = null, tock = 0) {
    const drawn = [];
    const shots = [];
    if (!this.armed) return { drawn, shots };            // CS:0x8687 == 0xC3
    let liveCount = 0;                                   // DS:0x3b2

    for (const s of this.slots) {
      if (s.x < 0) continue;                             // CS:0x8693
      liveCount++;                                       // CS:0x869B

      if (s.hp < 0) { this.#death(s, cam, drawn, brood); continue; }   // CS:0x869F
      if (s.state < 0 && !this.#hatch(s, cam, drawn, contact, tock)) continue; // CS:0x86A8

      /* Frozen, or still counting down out of the post-shot window: both skip
       * straight to the contact-and-draw block at CS:0x873B. */
      if (freezeTimer !== 0) {                           // CS:0x86B1
        this.#contactAndDraw(s, cam, drawn, contact);
        continue;
      }
      if (s.timer > AIM_GATE) {                          // CS:0x86BB `jg 0x8731`
        s.timer -= 1;                                    // CS:0x8731
        this.#contactAndDraw(s, cam, drawn, contact);
        continue;
      }

      const aim = aimAt(s.x, hero.x);
      if (aim === 0) { s.state = ST.BAND; }              // CS:0x8736
      else {
        const right = aim > 0;
        s.state = right ? ST.AIM_RIGHT : ST.AIM_LEFT;    // CS:0x86D5 / 0x8703
        s.timer -= 1;                                    // CS:0x86DA / 0x8708
        if (s.timer < 0) {                               // fires when it goes NEGATIVE
          s.timer = FIRE_RELOAD;
          const m = right ? MUZZLE.right : MUZZLE.left;
          shots.push({ x: s.x + m.dx, y: s.y + m.dy, dir: m.dir, right });
          s.state = right ? ST.FIRED_RIGHT : ST.FIRED_LEFT;
        }
      }
      this.#contactAndDraw(s, cam, drawn, contact);
    }

    /* CS:0x8796 — nothing live, so unhook. */
    if (liveCount === 0) this.armed = false;
    this.shots.push(...shots);
    return { drawn, shots };
  }

  /** CS:0x882E. Returns true when the creature reached state 0 and should run
   *  the live AI IN THIS SAME TICK (CS:0x8840 `jmp 0x86b1`). */
  #hatch(s, cam, drawn, contact, tock) {
    if (s.state === SEED_STATE) {                        // CS:0x882E
      const sx = s.x - cam.x, sy = s.y - cam.y;
      const on = sx <= HATCH_WINDOW.xMax && sx >= HATCH_WINDOW.xMin
              && sy >= HATCH_WINDOW.yMin && sy <= HATCH_WINDOW.yMax;
      if (!on) s.timer = HATCH_RELOAD;                   // CS:0x88DE
      else {
        s.timer -= 1;                                    // CS:0x886B
        if (s.timer < 0) { s.timer = HATCH_RELOAD; s.state += 1; this.hatched++; }
      }
    } else if (tock === 0) {                             // CS:0x8834, DS:0x36c
      s.state += 1;                                      // CS:0x883B
      if (s.state === 0) return true;                    // CS:0x8840 -> the live AI
    }
    this.#hatchDraw(s, cam, drawn, contact);
    return false;
  }

  #hatchDraw(s, cam, drawn, contact) {
    s.hp = contact({ x: s.x + BOX_HATCH.dx, y: s.y + BOX_HATCH.dy,
                     w: BOX_HATCH.w, h: BOX_HATCH.h, hp: s.hp });   // CS:0x8892
    drawn.push({ x: s.x - cam.x, y: s.y - cam.y,
                 sprite: SPRITE_BASE + s.state,
                 /* CS:0x88AF `cmp dx,0xffff / jnl` — state >= -1 uses export 1. */
                 gfxExport: s.state >= HATCH_EXPORT2_BELOW ? 1 : 2 });
    drawn.push(this.#companion(s, cam));                            // CS:0x88C3
    /* ⚠️ CS:0x88C6 / CS:0x88DB `jmp 0x877e` — the EMERGE draw shares the live
     * path's tail, so a creature killed mid-rise runs CS:0x8784
     * `mov word [si+4],0` too. Without it the death handler would start at a
     * negative state and draw sprite 0x6c-4 = 104, four frames before the
     * death cloud. I had this on the live path only until a cross-read found
     * the shared tail. */
    if (s.hp < 0) { s.state = 0; this.killed++; }                   // CS:0x8784
  }

  #contactAndDraw(s, cam, drawn, contact) {
    s.hp = contact({ x: s.x, y: s.y, w: BOX_ALIVE.w, h: BOX_ALIVE.h, hp: s.hp });
    drawn.push({ x: s.x - cam.x, y: s.y - cam.y,
                 sprite: SPRITE_BASE + s.state, gfxExport: 1 });     // CS:0x8776
    drawn.push(this.#companion(s, cam));                             // CS:0x877B
    if (s.hp < 0) { s.state = 0; this.killed++; }                    // CS:0x8784
  }

  /* CS:0x8806 — the creature keeps drawing THE OBJECT'S OWN SPRITE beneath
   * itself, at (x-3, y+0x18). That is why the map object does not need to be
   * drawn by the ordinary object walk: the creature carries it. */
  /* ⚠️ The offsets here CANCEL the allocator's exactly: seed is (x+3, y-24),
   * this is (x-3, y+24). So the plinth lands precisely on the placed object
   * and the creature's record sits 3 px right and 24 px above it. Two
   * independent readings confirming each other — and it matters, because the
   * aim compare uses the CREATURE's X, so the dead band is centred 3 px right
   * of where the art sits. */
  #companion(s, cam) {
    return { x: s.x - cam.x - 3, y: s.y - cam.y + 0x18,
             sprite: OBJECT_SPRITE, gfxExport: 1 };
  }

  /** CS:0x87A4. */
  #death(s, cam, drawn, brood) {
    const sx = s.x - cam.x - 4, sy = s.y - cam.y - 8;                // CS:0x87AC
    const sprite = DEATH_SPRITE_BASE + s.state;
    drawn.push({ x: sx, y: sy, sprite, gfxExport: 1 });
    drawn.push({ x: sx, y: sy + DEATH_DRAW_OFFSET.secondDy, sprite, gfxExport: 1 });
    s.state += 1;                                                    // CS:0x87D7
    if (s.state === BROOD_AT_STATE) { this.#brood(s, brood); return; }
    if (s.state >= DEATH_FREE_AT_STATE) s.x = -1;                    // CS:0x87E9
  }

  /**
   * CS:0x88E5. The draw ORDER matters, because the random source is a
   * replayed table with a shared cursor: count first, then per child fieldA
   * before field8.
   *
   * ⚠️ CS:0x8913 and CS:0x8921 are NOT the same random shape.
   *   +0xa  `and ax,3 / neg ax / sub ax,2`            -> always -2..-5
   *   +0x8  `mov bx,ax / and ax,3 / or bx,bx / jns / neg ax`
   *         -> MAGNITUDE from the masked value, SIGN from the untouched word
   * A single `(rand & 3) - 2` reproduces neither: it is asymmetric where the
   * second is symmetric, and never reaches -3 where the first always can.
   */
  #brood(s, brood) {
    this.broods++;
    const n = broodCount(this.rng.next());                            // CS:0x88EA
    for (let i = 0; i < n; i++) {
      const fieldA = -((this.rng.next() & 3) + 2);                    // CS:0x8913
      const word = this.rng.next();                                   // CS:0x8921
      const field8 = (word & 3) * (signed16(word) < 0 ? -1 : 1);
      if (!brood || !brood.spawn(s.x, s.y + BROOD_Y_OFFSET, field8, fieldA, BROOD_HP)) {
        /* CS:0x8904 leaves the per-record walk entirely, so a full brood
         * array abandons the WHOLE burst rather than skipping one child. */
        this.broodsAbandoned++;
        return;
      }
      this.broodlings++;
    }
  }
}

/** The random table holds words; the sign test at CS:0x8929 is on the signed
 *  16-bit value, not on the masked magnitude. */
export const signed16 = (v) => ((v & 0xffff) ^ 0x8000) - 0x8000;

/* ── UNKNOWN_nest_identity ────────────────────────────────────────────────
 * "Nest" is this port's label, not a finding. POBJECTS gives type 115 an
 * EMPTY name and an EMPTY description in all four worlds, so the game itself
 * never names it. What the bytes and the art prove is: a world-2 map object
 * drawn as a small framed plaque on a stand, out of which a 24x24 creature
 * grows over four frames, which then tracks the hero horizontally, fires
 * every 43 ticks at +-5 px/tick, and on death bursts into 3 or 4 broodlings.
 *
 * ── UNKNOWN_nest_shot — CLOSED ───────────────────────────────────────────
 * CS:0x2039 (right) and CS:0x1FE7 (left) write DS:0x8954, the shared
 * enemy-shot array — see `enemy-shots.js`'s own header, which models the
 * whole subsystem (six emitter pairs, one being this nest) and its
 * hero-damage path.
 *
 * ── UNKNOWN_8014_brood — the walker is CLOSED, ported as `Brood` above ───
 * CS:0x894E's field map, movement, death and facing are all decoded and
 * implemented (see the walker section above, which also corrects several
 * specific claims a task-level summary made about this exact address range).
 * Two residuals remain, both narrower than "the walker is out of scope":
 *   UNKNOWN_brood_score — CS:0x8A33-0x8A65 shows no score-award call on the
 *     decoded death path; whether one exists off that path is open.
 *   UNKNOWN_brood_sprite_table — SS:0x360A's own contents were never read by
 *     any pass over this project; `BROOD_SPRITE_TABLE` is an identity
 *     placeholder, not an invented sprite sequence.
 *
 * ── UNKNOWN_8014_world1 / UNKNOWN_ce64_pool ──────────────────────────────
 * Two neighbouring subsystems, unrelated to the brood walker, deliberately
 * left out of scope of this pass.
 */
export const UNKNOWN_nest_identity =
  'the game never names type 115 — POBJECTS gives it an empty name and description';
