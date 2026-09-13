/* entity.js — System-B enemy locomotion, ported from the movement-mode table.
 *
 * SCOPE
 *   GODS runs TWO parallel entity systems, discriminated by DS:0x3c2 (0x00 =
 *   System A, 0xff = System B). This file is System B only: entity stride
 *   0x18, group descriptors at DS:0xa1ac, movement modes at DS:0xdbe0.
 *   System A (stride 0x28) has NO located movement table and is not modelled.
 *
 *   Here: the spawn state machine, walk, fall, and the mode transitions.
 *   Placement itself lives in game/spawn.js. What is NOT here, and is not
 *   faked:
 *   Hop (modes 4/5) IS ported — see _hop, CS:0xf316/0xf3ee.
 *   Hunting lives in pathfind.js / pathfind-producers.js and contact damage
 *   in combat.js; both are wired. Firing IS ported — see fireB below.
 *
 *   ⚠️⚠️ CORRECTION, a later session — THE DEATH SEQUENCE IS NOW PORTED, and
 *   it disproves CLAUDE.md's own prior "CLOSED" note that a dying entity
 *   draws through the SAME class_base+MODE_ANIM+frame formula the alive path
 *   uses. A fresh `disassemble_bytes` of CS:0xF030-0xF0AB (not a re-read of
 *   the earlier summary) shows two DIFFERENT things share only the draw CALL
 *   (`CALL 0x1000:3569`), not the sprite formula:
 *     - CS:0xF02A (`call efe7 ; jmp ee00`) — reached from CS:0xEDF7, inside
 *       FUN_1000_edb8's own tail, on the EXACT tick contact just killed the
 *       entity (state/frame both just set to -1 by CS:0xFFBF, and this same
 *       per-entity pass hasn't reached the death state machine yet this
 *       tick) — draws via the ORDINARY alive-path formula (class_base +
 *       MODE_ANIM[mode] + frame), with frame still at -1, one below the
 *       entity's current animBase. This port's own contact code
 *       (combat.js/frame.js) already sets `entity.frame = -1` on kill,
 *       matching CS:0xFFBF exactly, and since contact runs AFTER this port's
 *       own `tick()` loop for the same game-loop tick, the render pass for
 *       THAT frame naturally sees frame=-1 before `tick()` ever processes
 *       the DYING state — reproducing this branch's timing without any
 *       special-casing needed in `tick()` itself.
 *     - CS:0xF030 (reached from CS:0xFF20's `jmp f030` on every SUBSEQUENT
 *       tick, once CS:0xED64's per-loop-entry check finds state already
 *       negative) is the actual fade: `INC word[0x1f4]` (a per-group tally,
 *       not ported — this project has no per-group dying counter consumer
 *       yet), a ONE-SHOT `CMP [di+4],0/JNS` gate (fires only while frame is
 *       still negative, i.e. exactly once, on the FIRST f030 pass) that
 *       caches world position into DS:0x202/0x204 and — if a carried-item
 *       field at `[di+0x10]` is non-negative — drops a per-kill popup via
 *       CS:0xBF5F (NOT ported: this port has no popup-rendering module, nor
 *       a carried-item field on EntityB, matching selector2.js's own
 *       identical, already-disclosed gap for its group-elimination reward),
 *       then UNCONDITIONALLY `INC [di+4]` and — while `< 7` — draws
 *       `sprite = 0x6c + [di+4]` (CS:0xF091-F094, a flat constant, NOT a
 *       class-table lookup) through the SAME `CALL 0x1000:3569`. At `>= 7`
 *       it finalises without drawing: `[di+8]:=0, [di+6]:=0`.
 *   So the fade proper (frames 0..6, 7 ticks) uses the UNIVERSAL `0x6c`-base
 *   death-cloud sprite range this project already documents for the world-2
 *   nest, the ce64 creature, the world-1 statue and the hero's own death
 *   burst — not the entity's own sprite class at all. `isDying`/`DEATH_*`
 *   below implement exactly this: `tick()` runs the CS:0xF030 state machine
 *   whenever `state === DYING`, and the one-tick `frame === -1` case (the
 *   CS:0xF02A draw) is left to the render pass, which already has `mode`
 *   and `cls` in scope for the ordinary sprite formula — see main.js.
 *   Group-clear/per-kill reward popups remain unported (mechanism only,
 *   same disclosed gap as selector2.js).
 *
 * THE MODE TABLE — DS:0xdbe0, 8 x {u16 handler, u16 anim_base}
 *   Note the field order is the REVERSE of the player's table at DS:0xd818,
 *   which is exactly the kind of thing a port mirrors wrongly.
 *   Both read sites are `mov si,0xdbe0 / mov ax,[di+0xa] / shl ax,1 x2 /
 *   add si,ax` (CS:0xedc3 and CS:0xf0ae) — the selector is entity +0x0a and
 *   there is NO bounds check. The immediate E0 DB occurs exactly twice in the
 *   whole file, which is what pins this table to System B alone.
 */

import { verdictAction, applyVerdict, VERDICT_NONE } from './pathfind.js';

export const MODE = {
  WALK_L: 0, WALK_R: 1, FALL_L: 2, FALL_R: 3, HOP_L: 4, HOP_R: 5,
};

/* handler address is carried for provenance; anim_base is what a port uses. */
export const MODE_TABLE = [
  { handler: 0xf11f, animBase:  0, label: 'walk left' },
  { handler: 0xf1e5, animBase:  9, label: 'walk right' },
  { handler: 0xf487, animBase:  8, label: 'fall left' },
  { handler: 0xf4e5, animBase: 17, label: 'fall right' },
  { handler: 0xf316, animBase:  8, label: 'hop left' },
  { handler: 0xf3ee, animBase: 17, label: 'hop right' },
  /* 6 and 7 are the fall-through targets of modes 0/1's alignment gate
   * (0xf11f does `and ax,0x1c / jz 0xf129`), not separate behaviours. No
   * store to [di+0x0a] anywhere writes 6 or 7. */
  { handler: 0xf129, animBase:  8, label: 'unreachable (gate target of 0)' },
  { handler: 0xf1ef, animBase: 17, label: 'unreachable (gate target of 1)' },
];

/* Mode bit 0 is facing in every live mode. */
export const facingOf = (mode) => (mode & 1) ? +1 : -1;

/* DS:0xdcde, and it extends into NEGATIVE indices — the table is centred on
 * its own base, signed both ways like the hero's jump table:
 *     idx  -6  -5  -4  -3  -2  -1 |  0  +1  +2  +3  +4  +5 .. +15
 *     val   8   8   4   2   1   1 |  0  -1  -1  -2  -4  -8 ..  -8
 * A port that treats 0xdcde as the start of the array and clamps at 0 loses
 * the whole descent. Indices >= 16 are garbage (-772, -248, 1288, 1280), so
 * the cursor cap is load-bearing.
 *
 * ⚠️ THE SIGN CONVENTION, because an earlier revision of this file had it
 * backwards. The value is added to Y and screen Y grows DOWNWARD, so:
 *     index  7..5   4    3    2,1   0    -1,-2  -3   -4   -5,-6
 *     value  -8    -4   -2    -1    0     +1    +2   +4    +8
 *     motion LAUNCH  decelerate    APEX      fall        fall fast
 * The -8 run is the LAUNCH, not a terminal tail. That is exactly why seed 13
 * is a longer hop than seed 7: it spends nine ticks climbing at 8 px instead
 * of three. */
export const HOP_ARC_MIN = -6;
export const HOP_ARC = [
  /* -6 */ 8, 8, 4, 2, 1, 1,
  /*  0 */ 0, -1, -1, -2, -4, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8,
];
export const hopDelta = (cursor) => {
  const i = cursor - HOP_ARC_MIN;
  return (i >= 0 && i < HOP_ARC.length) ? HOP_ARC[i] : null;   // null = past the table
};

/* THE CURSOR TRAVERSAL — formerly UNKNOWN_sysB_hop_cursor, now closed. The arc
 * simulator holds a BYTE offset in BX and word-indexes the table with it:
 *     f8f3  mov bx,[0x2bc] / f8f7 add bx,bx      ; cursor = seed * 2
 *     f975  mov si,0xdcde / f978 mov ax,[bx+si]  ; index = bx / 2
 *     f97a  add [0x2ba],ax                       ; simY += value
 *     f9c3  sub bx,0x2                           ; INDEX DECREMENTS BY 1
 *     f9c6  cmp bx,-12 / jl / f9ce mov bx,-10    ; floor
 * The floor is an OSCILLATION, not a clamp: byte -12 (index -6) decrements to
 * -14, which is < -12, so it is reset to -10 (index -5). The cursor then
 * ping-pongs between -6 and -5 forever — both hold 8, giving a terminal fall
 * at a constant 8 px per tick. */
export const HOP_CURSOR_FLOOR = -6;
export const hopCursorNext = (cursor) =>
  (cursor - 1 < HOP_CURSOR_FLOOR ? HOP_CURSOR_FLOOR + 1 : cursor - 1);

export const WALK_STEP     = 4;    // CS:0xf1de `sub word [di],0x4`
export const FALL_VMAX     = 16;   // CS:0xf492 `cmp ax,0x10`
export const WALK_ANIM_MASK = 7;   // CS:0xf1da `and word [di+0x4],0x7`
export const CULL = { xMin: -63, xMax: 351, yMin: -63, yMax: 223 };

/** The map cursor System B uses — identical index math to the hero's. */
const cellIndex = (x, y) => ((x & 0xFFE0) >> 5) + ((y & 0xFFF0) >> 4) * 128;

/* CS:0xf4A1 / 0xf198 family: `cmp byte [ds:bp+0x100],0x1`, plus the
 * `(X & 0x1f) >= 8` straddle against +0x101. +0x100 is two rows down
 * (stride 128), i.e. the cell under a 32-px-tall entity.
 * THE TEST IS `== 1` EXACTLY. Plane-B 2 (ladder) and every event cell >= 3
 * are NOT ground, so a System-B entity falls straight through a ladder
 * column. Writing this as `>= 1` is the single easiest way to get enemy
 * movement subtly wrong everywhere. */
export function groundBelow(planeB, x, y) {
  return groundUnderCell(planeB, cellIndex(x, y), x);
}

/* CS:0xf3ae, split out because the hop handler calls it with a cell pointer
 * computed BEFORE its own horizontal step while passing the POST-step X for
 * the straddle. On the tick a hop crosses a tile boundary those disagree, and
 * reproducing that needs the two inputs kept separate. */
export function groundUnderCell(planeB, di, x) {
  const si = di + 0x100;
  if (planeB[si] === 1) return true;                 // f3b0
  if ((x & 0x1f) >= 8 && planeB[si + 1] === 1) return true;   // f3b8..f3c2
  return false;
}

/** CS:0xf3cd — the same shape one row up: the hop's ceiling test. */
export function ceilingAtCell(planeB, di, x) {
  if (planeB[di] === 1) return true;                 // f3cf
  if ((x & 0x1f) >= 8 && planeB[di + 1] === 1) return true;   // f3d6..f3e0
  return false;
}

/** CS:0xf586's window. Off-screen entities skip the search entirely. */
export function onScreen(x, y, camX, camY) {
  const sx = x - camX, sy = y - camY;
  return sx > CULL.xMin && sx < CULL.xMax && sy > CULL.yMin && sy < CULL.yMax;
}

/**
 * CS:0xE659 — the shared facing-and-fire step, System-B's own reading.
 *
 * Shared code, called from BOTH entity systems' per-frame drivers — see
 * entity-a.js's `stageFacingAndFire` for System A's own reading (velocity-
 * sign facing, called LAST as stage 6). For System B, CS:0xEDB8 calls this
 * FIRST, before the DS:0xdbe0 movement-mode dispatch, so it is invoked here
 * at the top of `tick()`, before the mode switch — not after, unlike A.
 *
 * The two systems' fire logic is otherwise identical (reload gate, the
 * attackBits divert to the DS:0xd2be line-hazard pool) EXCEPT for how
 * facing is read:
 *   CS:0xe6d4  cx = [di+0xa]                 ; System B's OWN movement-mode field
 *   CS:0xe6d7  ax = [0xd95a] ; ax >>= cl ; test ax,1
 *   CS:0xe6df  jnz e6ad (LEFT) / jmp e6c3 (RIGHT)
 * `DS:0xd95a` reads 0x0015 = 0b00010101: bits 0/2/4 (WALK_L/FALL_L/HOP_L) are
 * set -> LEFT; bits 1/3/5 (the right-facing mirrors) are clear -> RIGHT. That
 * is EXACTLY this module's own `facingOf` (mode bit 0), so no new bit-test
 * table is needed — `(mode & 1) === 0` is LEFT.
 *
 * ⚠️ Unlike System A, there is NO "zero own velocity means don't fire" gate
 * here (CS:0xe6a5 is System-A-exclusive, inside the same attackBits==0
 * branch): System B has no signed X-velocity register at this point in its
 * record (`+0x12` is the fall/hop cursor, not a velocity split by sign), so
 * a live System-B entity fires whenever its reload timer allows, in whatever
 * direction its current mode faces — even mid-hop or mid-fall.
 */
export function fireB(e, desc) {
  if (!desc) return null;
  const fireByte = desc.fire;
  const loNibble = fireByte & 0xf;
  if (fireByte === 0 || loNibble === 0) return null;   // CS:0xe659/0xe666

  e.reloadTimer--;
  if (e.reloadTimer > 0) return null;                  // CS:0xe66b
  e.reloadTimer = (0x10 - loNibble) << 2;               // CS:0xe670-e67a

  const hiNibble = (fireByte >> 4) & 0xf;
  const attackBits = (desc.flags >> 4) & 3;             // CS:0xe67d
  if (attackBits !== 0) {
    return { hazard: true, attackBits, n: hiNibble, x: e.x, y: e.y };   // CS:0xe5e4
  }

  const right = (e.mode & 1) === 1;                     // CS:0xd95a bit test == facingOf
  const dir = right ? hiNibble : -hiNibble;             // CS:0xe6ad `neg bx`
  const muzzleX = right ? e.x + 0x20 : e.x - 8;          // CS:0xe6c7/0xe6b3
  return { x: muzzleX, y: e.y, dir };
}

/**
 * One System-B entity. Field names carry their DS offsets so the mapping back
 * to the disassembly stays visible.
 */
/* Entity states, from DS:0x536 + 0x08 (CS:0xff20).
 *   -2 waiting for its stagger delay, -3 materialising, >0 alive with HP,
 *   <0 (other) dying, 0 free. */
export const EST = { FREE: 0, DYING: -1, WAITING: -2, MATERIALISING: -3 };

/* DYING is written by the contact routine, not by this module: CS:0xac59
 * stores 0xFFFF into the strength word and CS:0xffb4 writes it straight back
 * into +0x08 (this port's own combat.js/frame.js already do this, plus the
 * matching `entity.frame = -1`, CS:0xFFBF). `tick()`'s own DYING branch below
 * runs CS:0xF030's fade for every tick AFTER the kill tick; the kill tick
 * itself (frame still -1) is drawn by the render pass using the ordinary
 * sprite formula — see the file header's correction for the full trace. */
export const isDying = (e) => e.state === EST.DYING;
export const MATERIALISE_TICKS = 5;    // CS:0xff7f `mov word [di+0x6],5`
export const DEATH_SPRITE_BASE = 0x6c;   // CS:0xF094 `add cx,0x6c` — a flat constant, not a class lookup
export const DEATH_FRAMES = 7;           // CS:0xF071 `cmp word[di+4],0x7`

export class EntityB {
  constructor({ x, y, mode = MODE.WALK_L, speed = 9, hp = 1, cls = 0, delay = 0 }) {
    this.x = x;             // +0x00
    this.y = y;             // +0x02
    this.frame = 0;         // +0x04  animation index, cycles 0..7
    this.delay = 0;         // +0x06  step delay counter
    this.mode = mode;       // +0x0a
    this.vel = 2;           // +0x12  fall velocity / hop cursor (init 2 at spawn)
    this.speed = speed;     // descriptor +0x0b — HIGHER IS FASTER
    this.cls = cls;         // descriptor +0x07, the sprite class
    this.state = EST.WAITING;   // +0x08
    this.hp = hp;               // descriptor +0x01
    this.timer = delay;         // +0x06, the per-entity stagger
    this.reloadTimer = 0;       // +0xe — CS:0xe659's per-entity fire/reload timer
  }

  get alive() { return this.state > 0; }

  get animBase() { return MODE_TABLE[this.mode].animBase; }

  /**
   * One 15 Hz tick.
   * @param {Uint8Array} planeB
   * @param {number} verdict  DS:0x2ac, the pathfinder result — see pathfind.js.
   *   -1 means "no path", which is also what an off-screen entity always gets,
   *   because CS:0xf586 pre-sets 0xFFFF and its cull returns before searching.
   *   0..7 is a first move: 0/1 walk left/right, 2..7 hop left/right at one of
   *   three reaches. UNKNOWN_f586_verdict_semantics is CLOSED — the domain and
   *   the applier (CS:0xf2ac) are decoded. What is still open is the search
   *   that PRODUCES it: UNKNOWN_pathfinder_producers. With no producers the
   *   search reports -1 and the entity patrols, which is the original's own
   *   no-path behaviour rather than an invention.
   * @param {?{fire:number, flags:number}} desc  the group descriptor, for
   *   `fireB` — omit (or pass null) to leave this entity silent, e.g. for
   *   groups whose descriptor isn't tracked yet or in isolated unit tests.
   * @returns {?({x:number,y:number,dir:number}|{hazard:true,attackBits:number,n:number,x:number,y:number})}
   *   a muzzle to fire from, a line-hazard spawn request, or null — see
   *   fireB's own header for the shape.
   */
  tick(planeB, verdict = VERDICT_NONE, desc = null) {
    /* CS:0xff20 — the pre-life states run before any locomotion or fire.
     *   waiting (-2): count the stagger down, then materialise
     *   materialising (-3): 5 ticks, then become alive with the descriptor HP
     * The materialise effect itself (CS:0xff59) is not ported. */
    if (this.state === EST.WAITING) {
      if (--this.timer <= 0) { this.state = EST.MATERIALISING; this.timer = MATERIALISE_TICKS; }
      return null;
    }
    if (this.state === EST.MATERIALISING) {
      if (--this.timer <= 0) { this.state = this.hp; this.timer = 0; }
      return null;
    }
    /* CS:0xFF20's `jmp f030` arm — every tick AFTER the kill tick (the kill
     * tick itself leaves state/frame at -1/-1 and is drawn by the render
     * pass via the ordinary formula; see the file header). The one-shot gate
     * at CS:0xF034 (position-cache + per-kill popup, only while frame is
     * still negative) is not ported — no popup-rendering module exists yet. */
    if (this.state === EST.DYING) {
      this.frame++;                                       // CS:0xF06E
      if (this.frame >= DEATH_FRAMES) {                    // CS:0xF071/F075
        this.state = EST.FREE; this.delay = 0;             // CS:0xF077/F07C
      }
      return null;
    }
    if (this.state <= 0) return null;          // free

    /* CS:0xE659 runs BEFORE the mode dispatch for System B (unlike System A's
     * stage 6, which runs last) — see fireB's own header. */
    const muzzle = fireB(this, desc);

    switch (this.mode) {
      case MODE.WALK_L: case MODE.WALK_R: this._walk(planeB, verdict); break;
      case MODE.FALL_L: case MODE.FALL_R: this._fall(planeB); break;
      case MODE.HOP_L:  case MODE.HOP_R:  this._hop(planeB); break;
      default: break;
    }
    return muzzle;
  }

  /**
   * CS:0xf316 (hop left) / CS:0xf3ee (hop right) — the LOCOMOTION hop.
   *
   * ⚠️ THIS IS NOT THE PATHFINDER'S ARC SIMULATOR. That one (CS:0xf8dc) only
   * predicts where a hop would land; this one actually moves the entity, and
   * the two differ in a way that matters: the simulator holds a BYTE cursor
   * and ping-pongs -6/-5 forever, while this holds a WORD cursor
   * (`f368 mov ax,[di+0x12] / shl ax,1`) and, once it drops below -5, HANDS
   * OFF TO THE FALL HANDLER at velocity 8. A hop here always terminates.
   */
  _hop(planeB) {
    if (--this.delay >= 0) return;                   // f316 `dec / jns` — just redraw
    this.delay = 2 - (this.speed >> 2);              // f31b..f329 — SAR, not divide

    const right = (this.mode & 1) === 1;
    /* The cell pointer is taken BEFORE the horizontal step (f32c) and the
     * ground test below still uses it — see groundUnderCell. */
    const diBefore = cellIndex(this.x, this.y);

    /* Horizontal step, wall-gated only exactly on a tile boundary. */
    const onBoundary = (this.x & 0x1f) === 0;        // f330
    const blocked = onBoundary && (right
      ? (planeB[diBefore + 1] === 1 || planeB[diBefore + 0x81] === 1)    // f40f/f416
      : (planeB[diBefore - 1] === 1 || planeB[diBefore + 0x7f] === 1));  // f337/f33e
    if (!blocked) this.x += right ? 4 : -4;          // f41e / f345

    /* Past the apex, a floor under us ends the hop. */
    if (this.vel <= 0) {                             // f348 / f421 `cmp 0 / jg`
      if (groundUnderCell(planeB, diBefore, this.x)) {          // f34e / f427
        this.y &= 0xfff0;                            // f35b / f42f
        this.mode = right ? MODE.WALK_R : MODE.WALK_L;          // f356 / f433
        return;
      }
    }

    /* The arc step. The cursor indexes the table directly as a WORD. */
    this.y += hopDelta(this.vel) || 0;               // f365..f373

    const diAfter = cellIndex(this.x, this.y);       // f376 / f44f — RECOMPUTED
    if (ceilingAtCell(planeB, diAfter, this.x)) {    // f379 / f452
      this.y = (this.y & 0xfff0) + 0x10;             // f381 / f45a
      this.mode = right ? MODE.FALL_R : MODE.FALL_L; // f389
      this.vel = 2;                                  // f38e — a bonk drops at 2
      return;
    }

    this.vel--;                                      // f397
    if (this.vel < -5) {                             // f39a `cmp -5 / jnl`
      this.mode = right ? MODE.FALL_R : MODE.FALL_L;
      this.vel = 8;                                  // f3a5 — running out drops at 8
    }
  }

  _walk(planeB, verdict) {
    /* CS:0xf11f: `mov ax,[di] / and ax,0x1c / jz` — the map is probed ONLY on
     * a tile crossing. X moves in steps of 4, so `& 0x1c` is zero only at
     * multiples of 32: once per tile. That is observable behaviour, not an
     * optimisation — it decides when a turn-around can happen at all. */
    if ((this.x & 0x1c) !== 0) { this._step(); return; }   // f126 jmp 0xf1be

    if (!groundBelow(planeB, this.x, this.y)) {
      /* Walked off an edge — CS:0xf157 (left) / 0xf21e (right), and note the
       * transition is NOT inert: it seeds the velocity to 1 and advances Y by
       * one pixel in the same tick.
       *     f157  mov ax,0x1
       *     f15a  mov word [di+0xa],0x2     ; fall left  (0xf21e stores 3)
       *     f15f  mov [di+0x12],ax          ; velocity := 1, NOT 0
       *     f162  add [di+0x2],ax           ; y += 1 immediately
       *     f165  mov word [di+0x4],0
       * An earlier revision of this port set the velocity to 0 and left Y
       * alone, which delayed every fall by a tick and started the curve one
       * step low. Facing is preserved because mode bit 0 is facing. */
      this.mode = (this.mode & 1) ? MODE.FALL_R : MODE.FALL_L;
      this.vel = 1;
      this.y += 1;
      this.frame = 0;
      return;
    }

    /* On a tile boundary, on ground: RUN THE PATHFINDER (CS:0xf141/0xf203) and
     * branch on its verdict. `verdictAction` carries the asymmetry between the
     * two walk handlers — each compares against its OWN mode number. */
    switch (verdictAction(verdict, this.mode)) {
      case 'apply':                              // CS:0xf150 `call 0xf2ac`
        applyVerdict(this, verdict);
        return;
      case 'keep':                               // CS:0xf14e `jz 0xf1be`
      case 'patrol':                             // CS:0xf14c `js` -> wall probes
      default:
        this._step();
    }
  }

  /** CS:0xf1be — the ordinary step, gated on the delay going NEGATIVE. */
  _step() {
    if (--this.delay < 0) {
      this.delay = 10 - this.speed;              // `mov ax,0xa / sub al,[si+0xb]`
      this.frame = (this.frame + 1) & WALK_ANIM_MASK;
      this.x += facingOf(this.mode) * WALK_STEP;
    }
    this.vel = 0;                                // `mov word [di+0x12],0`
  }

  _fall(planeB) {
    this.frame = 0;                              // CS:0xf487 `mov word [di+0x4],0`
    /* The velocity is applied BEFORE the increment, and clamps at 16. The hero
     * uses 4 + v capped at 10 — a different curve entirely. */
    const v = this.vel;
    if (v !== FALL_VMAX) this.vel = v + 1;
    this.y += v;
    if (groundBelow(planeB, this.x, this.y)) {
      this.y &= 0xfff0;                          // `and word [di+0x2],0xfff0`
      this.mode = (this.mode & 1) ? MODE.WALK_R : MODE.WALK_L;
      this.vel = 0;
    }
  }
}
