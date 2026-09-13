/* combat.js — the hero's health, and the one routine that hurts him.
 *
 * Two variables, not one, and conflating them is the whole trap:
 *   DS:0x192  the health TARGET, capped at 24
 *   DS:0x19a  the DISPLAYED BAR, which chases the target ONE UNIT PER FRAME
 * Everything that matters — the death test, the damage guard, whether a potion
 * works — reads the BAR, not the target. Because the bar lags by up to 24
 * frames (1.6 s at 15 Hz), a hit that takes the target to zero does not kill
 * immediately: the player has the bar's descent to drink a potion. Draining
 * the target instantly would change the game.
 */

export const HEALTH_MAX = 0x18;          // 24 — CS:0x0e30 `cmp ax,0x18`

/* CS:0x084B / 0x0851 — level start fills the bar VISIBLY: target full, bar 1,
 * so it animates up over 23 frames rather than appearing full. */
export const START_TARGET = 0x18;
export const START_BAR = 1;

/* The five potion values, from their five call sites. Each is followed by a
 * cap at 24 and each is gated on the BAR being non-zero. */
export const POTIONS = [
  { value: 0x02, addr: 0x6310 },
  { value: 0x03, addr: 0x63be },
  { value: 0x04, addr: 0x639d },
  { value: 0x0c, addr: 0x6339 },
  { value: 0x18, addr: 0x6362 },
];

/**
 * The health pair and its chase, CS:0x0dff — called once per frame from the
 * main loop at CS:0x02c6.
 *
 *     0dff  mov ax,[0x19a] / cmp ax,[0x192]
 *     0e06  jg 0xe10        ; bar too high -> tick DOWN
 *     0e08  jl 0xe2a        ; bar too low  -> tick UP
 *     0e0a  mov byte [0x3ad],0 / ret        ; equal: clear the latch
 *     0e10  dec word [0x19a]                ; DOWN one unit
 *     0e15  cmp byte [0x3ad],0 / jnz        ; latch: the hurt sound plays ONCE
 *     0e1d  mov ax,0xe42 / call 0x22ca      ;   per descent, not per tick
 *     0e24  inc byte [0x3ad]
 *     0e2a  mov byte [0x3ad],0              ; UP one unit, capped at 24
 *     0e2f  inc ax / cmp ax,0x18 / jng / mov ax,0x18 / mov [0x19a],ax
 */
export class Health {
  constructor(target = START_TARGET, bar = START_BAR) {
    this.target = target;                  // DS:0x192
    this.bar = bar;                        // DS:0x19a
    this.latch = 0;                        // DS:0x3ad — the hurt-sound one-shot
    this.hurtSounds = 0;                   // how many times the sound would fire
  }

  /** CS:0x0dff. Call once per logic tick. */
  chase() {
    if (this.bar === this.target) { this.latch = 0; return; }
    if (this.bar > this.target) {
      this.bar--;                          // 0e10 — decrements memory directly
      if (this.latch === 0) { this.hurtSounds++; this.latch = 1; }   // 0e15..0e24
      return;
    }
    this.latch = 0;                        // 0e2a
    this.bar = Math.min(this.bar + 1, HEALTH_MAX);   // 0e2f..0e38
  }

  /**
   * ⚠️ DEATH READS THE BAR, AND FIRES AT ZERO — not below.
   *     01bd  cmp word [0x19a],0
   *     01c2  jns 0x1c7  /  01c4 jmp 0x9bb      ; bar <  0 -> death
   *     01c7  jnz 0x1cc  /  01c9 jmp 0x9bb      ; bar == 0 -> death
   * Both branches reach the same reset sequence, so the condition is `bar <= 0`.
   */
  get dead() { return this.bar <= 0; }

  /** A hit reduces the TARGET. The bar follows at one unit per frame. */
  damage(n) { this.target -= n; }

  /**
   * CS:0x084B/0x0851, inside FUN_1000_0845 — an ordinary respawn restores
   * health EXACTLY like a fresh level load: target := 24, bar := 1, so it
   * animates up over 23 frames rather than popping full. See game/death.js.
   *
   * ⚠️ CORRECTION to this project's own earlier prose, which cited
   * `CS:0x7D26 mov bp,[0x250] / mov [0x192],bp` as "the respawn-restore
   * slot" this routine reads. Disassembling FUN_1000_0845 in full
   * (CS:0x0845-0x0926) shows it never touches DS:0x250 anywhere — that
   * address belongs to some other, still-unidentified restore path (see
   * the `0x7d6e` reference elsewhere in this project's notes), not ordinary
   * gameplay respawn.
   */
  respawn() {
    this.target = START_TARGET;    // CS:0x084B
    this.bar = START_BAR;          // CS:0x0851
    this.latch = 0;
  }

  /**
   * One of the five health potions, CS:0x6306 / 0x6327 / 0x6350 / 0x6393 /
   * 0x63B4 — all five are the same nine instructions with a different addend.
   *
   * ⚠️ TWO CORRECTIONS TO WHAT THIS FILE USED TO SAY.
   *
   * 1. THE GATE IS `bar < 0`, NOT `bar === 0`. Every site opens
   *    `cmp word [0x19a],0 / jns <effect>` — **jns**, so it proceeds while the
   *    bar is non-negative and refuses only when it has gone negative. This
   *    file claimed "a potion does nothing once the bar reads zero", which is
   *    the opposite at exactly the boundary that matters. It is the same
   *    `js`/`jns` family as the damage guard and the pickup gate, and the
   *    fourth time this project has had to pin one of them down.
   *
   * 2. THE CAP IS A CONVERSION, NOT A CLAMP. `cmp [0x192],0x18 / jng` takes
   *    the done path, but overflow falls through to CS:0x6377:
   *        6377  sub ax,0x18            ; ax was the PRE-clamp target
   *        637A  shl ax,1  (x5)         ; excess * 32
   *        6384  cmp word [0x168],0 / js 0x638f
   *        638B  add [0x168],ax         ; banked, unless [0x168] is negative
   *    So over-healing is not discarded — it is banked at 32 per point.
   *    UNKNOWN_DS_0168: the destination is set to 1000 at CS:0xC347 and to -1
   *    at CS:0xC470, decremented by a hit at CS:0xAB4D, and read as the first
   *    half of the hunter target-list gate at CS:0x9129. Four behaviours, no
   *    established meaning — and it is NOT the shop total, which is DS:0x194.
   *
   * ⚠️ The refuse path returns the same `dx = 1` as success (CS:0x6209 against
   * CS:0x638F), and the object was marked dead at CS:0x17F6 BEFORE the handler
   * ran — so a refused potion is still consumed and still shows its message.
   *
   * @returns {{taken:boolean, banked:number}} `banked` is the DS:0x168 credit.
   */
  /* DS:0x168, the familiar's energy. -1 at both full restarts (CS:0xC470),
   * and nothing in shipped data can raise it — see the banking note below. */
  familiarEnergy = -1;

  potion(n) {
    if (this.bar < 0) return { taken: false, banked: 0 };   // CS:0x6306 `jns`
    this.target += n;                                       // CS:0x6310
    if (this.target <= HEALTH_MAX) return { taken: true, banked: 0 };
    const excess = this.target - HEALTH_MAX;                // CS:0x6377
    this.target = HEALTH_MAX;                               // CS:0x631F
    /* ⚠️ CORRECTION. This port shipped the overflow as "banked at 32 a point"
     * without its gate. CS:0x6384 is `cmp word [0x168],0 / JNS` — the excess
     * is credited only while DS:0x168 is NON-NEGATIVE, and DS:0x168 is the
     * FAMILIAR'S ENERGY (see consumables.js, which closes UNKNOWN_DS_0168).
     * CS:0xC470 sets it to -1 and is called from both full restarts, and the
     * only thing that lifts it is a "familiar" potion — type 39, placed ZERO
     * times in all eight shipped maps. So the banking is real code and
     * UNREACHABLE IN SHIPPED PLAY: over-healing is simply discarded. */
    const banked = this.familiarEnergy >= 0 ? excess * POTION_OVERFLOW_SCALE : 0;
    return { taken: true, banked, discarded: banked ? 0 : excess };
  }
}

/** CS:0x637A — five `shl ax,1`, so each wasted health point banks 32. */
export const POTION_OVERFLOW_SCALE = 32;

/* ── The damage routine, CS:0xac59 ────────────────────────────────────────
 *
 * Called from 18+ sites through the CS:0xa9e4 thunk, plus four direct callers.
 * Every caller sets the attacker's box in DS:0x1e2 / DS:0x1e4 immediately
 * before calling — they are GLOBALS in the original, which is a stale-value
 * hazard the moment two attackers are tested in one frame. They are explicit
 * parameters here, and that divergence is deliberate.
 *
 * THE CALLING CONVENTION HAS A TRAP. The routine opens
 *     ac60  push ax / push cx / push dx / push bx
 * and then at
 *     ac84  pop ax / ac85 push ax
 * which pops the *fourth* thing pushed — BX. So the Y test runs on the
 * caller's BX, not on AX. Read literally as "pop ax restores ax" it looks like
 * the routine tests X against the hero's Y box, which is nonsense; the entry
 * convention is really ax = attacker X, bx = attacker Y, bp = strength.
 *
 * THE BOX TEST, both axes the same shape:
 *     ac64  bx = heroX ; cx = bx
 *     ac6a  bx += 0x0a ; cx += 0x16          ; the hero's core, [X+10, X+22]
 *     ac70  dx = [0x1e2] >> 1                 ; half the attacker's width
 *     ac76  ax += dx ; bx -= dx ; cx += dx
 *     ac7c  cmp ax,bx / jl reject / cmp ax,cx / jg reject
 *   which reduces to `heroX + 10 - w <= atkX <= heroX + 22`.
 *   Y is identical over [heroY + 8, heroY + 38] with the attacker's height.
 */
export const HERO_CORE_X = [0x0a, 0x16];   // CS:0xac6a / 0xac6d
export const HERO_CORE_Y = [0x08, 0x26];   // CS:0xac8f / 0xac8c
export const CROUCH_TOP_RAISE = 0x14;      // CS:0xaca0
export const CROUCH_STATES = [0x12, 0x13]; // CS:0xac92 / 0xac99 — states 18, 19

/** The damage curve. ⚠️ FIVE arithmetic shifts, not four — see the note below. */
export const damageFor = (strength) => (((strength + 1) >> 5) + 5);

/**
 * CS:0xac59 — does this attacker overlap the hero, and if so, hurt him.
 *
 * @param {{x:number,y:number,w:number,h:number,strength:number}} atk
 *   x/y are WORLD coordinates; w/h are DS:0x1e2 / DS:0x1e4.
 * @param {{x:number,y:number,state:number}} hero
 * @param {Health} health
 * @param {{invuln?:number, reportGate?:number}} opts
 *   invuln     DS:0x172 — non-zero suppresses the damage but not the hit.
 *   reportGate DS:0x34  — the hit is reported back to the caller ONLY when
 *              this is zero. UNKNOWN_DS_0034: it is written 0/1/2 from eight
 *              sites and initialised to 0 at CS:0x009e; what it means is not
 *              established, so it is an input here rather than a constant.
 * @returns {{hit:boolean, damage:number, strengthOut:number}}
 *   `strengthOut` is the original's IN-AND-OUT `bp`. Callers test its SIGN,
 *   not a boolean: CS:0xace2 stores 0xFFFF into it on a reported hit and the
 *   reject path leaves it untouched. A port that returns a plain boolean
 *   loses the reportGate, because a hit with reportGate != 0 damages the hero
 *   and still reads as "no hit" to the caller.
 */
export function attackHero(atk, hero, health, opts = {}) {
  const miss = { hit: false, damage: 0, strengthOut: atk.strength };

  /* ⚠️ `js`, so this skips only when the bar is NEGATIVE. At a bar of exactly
   * zero the hit still lands and drives the target further down. */
  if (health.bar < 0) return miss;                       // ac59

  const hw = atk.w >> 1, hh = atk.h >> 1;                // ac70 / aca3 — SAR
  const xLo = hero.x + HERO_CORE_X[0] - hw, xHi = hero.x + HERO_CORE_X[1] + hw;
  if (atk.x + hw < xLo || atk.x + hw > xHi) return miss;  // ac7c / ac80

  /* Crouching (states 18 and 19) raises the box's TOP edge by 20 px, so the
   * hero really does duck under things. Omitting it makes crouching cosmetic
   * and the dodge stops working. */
  const crouching = hero.state >= CROUCH_STATES[0] && hero.state <= CROUCH_STATES[1];
  const yLo = hero.y + HERO_CORE_Y[0] + (crouching ? CROUCH_TOP_RAISE : 0) - hh;
  const yHi = hero.y + HERO_CORE_Y[1] + hh;
  if (atk.y + hh < yLo || atk.y + hh > yHi) return miss;  // acaf / acb3

  const dmg = damageFor(atk.strength);                   // acbc..acc9
  if (!opts.invuln) health.damage(dmg);                  // accc `cmp [0x172],0`

  /* The hit is only REPORTED when DS:0x34 is zero (CS:0xacdb / 0xace2). */
  const reported = !opts.reportGate;
  return { hit: true, damage: dmg, strengthOut: reported ? -1 : atk.strength };
}

/* ⚠️ CORRECTION TO THIS PROJECT'S OWN NOTES. CLAUDE.md recorded the damage as
 * `(raw >> 4) + 5`. The bytes are FIVE `D1FA` (arithmetic shift right by one)
 * at CS:0xACBF, 0xACC1, 0xACC3, 0xACC5 and 0xACC7 — ten bytes, closing exactly
 * at 0xACC9 `add dx,5`. So it is `>> 5`.
 *
 * This is not pedantry. For System-B contact the strength is the ENEMY'S OWN
 * HP (CS:0xffa2 `mov bp,[di+0x8]`), and shipped HP runs to 255:
 *
 *      HP     2   15   45  100  255
 *      >> 5   5    5    6    8   13     <- the bytes
 *      >> 4   5    6    7   11   21     <- the old note
 *
 * The two disagree on 27 of the 31 distinct HP values that ship. Against a
 * maximum health of 24, the wrong reading makes a single touch from a
 * late-game creature cost 21 of 24 instead of 13 — very nearly instant death.
 */

/* ── System-B contact, CS:0xff93 ─────────────────────────────────────────
 *
 *     ff93  mov word [0x1e2],0x20 / mov word [0x1e4],0x20   ; a 32x32 creature
 *     ffa2  mov bp,[di+0x8]                 ; STRENGTH = the entity's own state
 *     ffa5  add ax,[0xa] / add bx,[0xc]     ; caller passes SCREEN coords
 *     ffaf  call 0xa9e4                     ; -> 0xac59
 *     ffb4  mov [di+0x8],bp                 ; AND WRITES IT BACK
 *     ffb7  or bp,bp / js 0xffbf / ret
 *     ffbf  mov word [di+0x4],0xffff        ; frame := -1
 *     ffc4  mov word [di+0x6],0             ; delay := 0
 *
 * So touching the hero costs him health AND KILLS THE CREATURE: the routine
 * stores 0xFFFF into the strength, the caller writes it straight back into
 * the entity's `+0x08` state word, and a negative state is `dying`. That is
 * why the entity state and the damage strength are the same field — they are
 * literally the same word passing through one routine in both directions.
 */
export const CREATURE_CONTACT_BOX = { w: 0x20, h: 0x20 };   // CS:0xff93/0xff99

/**
 * CS:0xff93. Mutates the entity on a reported hit, exactly as the original
 * does. Returns the attack result.
 */
export function creatureTouchesHero(entity, hero, health, opts = {}) {
  const r = attackHero(
    { x: entity.x, y: entity.y, ...CREATURE_CONTACT_BOX, strength: entity.state },
    hero, health, opts);
  entity.state = r.strengthOut;              // ffb4 — unconditional write-back
  if (r.strengthOut < 0) {                   // ffbc `js`
    entity.frame = -1;                       // ffbf
    entity.delay = 0;                        // ffc4
  }
  return r;
}

/* ── The progression difficulty scalar, DS:0x365 ─────────────────────────
 *
 * GODS is widely described as having "adaptive difficulty". There is no
 * global evaluator anywhere in GAME.EXE; two systems produce the effect, and
 * this is one of them — a single scalar driven by LEVEL PROGRESSION ONLY
 * (never by health, lives, deaths, time or score), consumed at exactly one
 * place: the damage the hero deals.
 *
 *     ab56  cmp byte [0x365],0 / jz 0xab92    ; 0 -> full damage, skip it all
 *     ab60  mov cx,3
 *     ab63  sub cl,[0x365]                    ; cl = 3 - scalar   (a BYTE sub)
 *     ab67  jns 0xab6b / ab69 sub cx,cx       ; clamp at 0
 *     ab6c  shr bx,cl                         ; damage >>= cl     (LOGICAL)
 *     ab71  cmp bx,[ss:si+0x2] / ab76 jnz     ; did the shift change anything?
 *     ab78  mov cx,bx / shr bx,1 / sub cx,bx / sar cx,1 / add bx,cx
 *
 * ⚠️⚠️ A CORRECTION TO A CORRECTION: THE SHIFTED VALUE IS NOT THE DAMAGE.
 *
 * This file and CLAUDE.md both carried a reading built on `shr bx,cl` alone —
 * first `1.00, 0.75, 0.50, 0.25, 0.25`, then a "correction" to `1.00, 0.25,
 * 0.50, 0.75, 0.75` arguing that a larger scalar shifts less and so deals
 * more. Reading the whole bracket instead of the shift shows the shifted value
 * is ADDED BACK, so it is the amount FORGIVEN, not the amount dealt:
 *
 *     ab5d  push bp                  ; save the target's HP
 *     ab5e  sub bp,bx                ; bp = HP - RAW       <-- subtract FIRST
 *     ab60..ab69                     ; cl = clamp(3 - scalar, 0, ..)
 *     ab6b  push bx                  ; save RAW
 *     ab6c  shr bx,cl
 *     ab6f  mov si,sp / cmp bx,[ss:si+0x2]    ; compare against the saved RAW
 *     ab76  jnz ab82                 ; the shift changed it -> keep bx
 *     ab78  ... bx = 3/4 * raw       ; cl was 0 -> a fixed 3/4 instead
 *     ab82  add sp,2 / pop cx        ; cx = the saved HP
 *     ab86  add bp,bx                ; bp = (HP - RAW) + bx  <-- ADDED BACK
 *     ab88  js/jz ab98               ; <= 0 -> the death path
 *     ab8c  sub cx,bp / mov bx,cx    ; and the damage REPORTED is HP - newHP
 *
 * So the damage applied is `raw - (raw >> cl)`:
 *
 *      scalar     0     1     2     3     4
 *      cl         -     2     1     0     0
 *      forgiven   -   raw/4 raw/2 3/4raw 3/4raw
 *      multiplier 1.00  0.75  0.50  0.25  0.25
 *
 * — the ORIGINAL table, with the intuitive direction: as the scalar rises the
 * hero deals LESS damage. CS:0x0445 increments it on level completion, clamped
 * low to 2 (CS:0x0449) and high to 4 (CS:0x0455), so the sequence a player
 * meets is 0, 2, 3, 4, 4 — a monotone 1.00 -> 0.50 -> 0.25 -> 0.25. Enemies
 * are toughest at the END, not on the second world.
 *
 * The transferable lesson: an instruction that looks like it computes the
 * answer may be computing a correction to it. The bracket is the evidence.
 */
export const DIFFICULTY_SHIFT_BASE = 3;      // CS:0xab60 `mov cx,3`
/** CS:0x0445-0x045F — the scalar after completing n levels. */
export const DIFFICULTY_PROGRESSION = [0, 2, 3, 4, 4];

/**
 * CS:0xab5d-0xab86 — how much of `damage` the scalar FORGIVES. Exported on its
 * own because it is the quantity the bytes literally compute.
 */
export function difficultyForgiven(damage, scalar) {
  if (scalar === 0) return 0;                            // ab56 -> ab92
  let cl = DIFFICULTY_SHIFT_BASE - scalar;               // ab63, a byte subtract
  if (cl < 0) cl = 0;                                    // ab67 / ab69
  let bx = damage >>> cl;                                // ab6c — LOGICAL shift
  if (bx === damage) {                                   // ab71 / ab76 `jnz`
    /* The shift was a no-op, so a fixed 3/4 reduction is applied instead. */
    let cx = bx;
    bx = bx >>> 1;                                       // ab7a
    cx = cx - bx;                                        // ab7c — ceil(d/2)
    cx = cx >> 1;                                        // ab7e — SAR
    bx = bx + cx;                                        // ab80
  }
  return bx;
}

/** What a hit actually costs the target: CS:0xab5e + CS:0xab86 together. */
export const difficultyScale = (damage, scalar) =>
  damage - difficultyForgiven(damage, scalar);

/** The multiplier each scalar value produces, for reporting. */
export const DIFFICULTY_MULTIPLIERS =
  [0, 1, 2, 3, 4].map((s) => difficultyScale(1000, s) / 1000);

/* ── The projectile half of CS:0xa9e4 ────────────────────────────────────
 *
 * ⚠️ CONTACT AND PROJECTILE DAMAGE ARE ONE CALL, AND CONTACT WINS.
 *
 *     a9e4  call 0xac59              ; the hero-contact box test, above
 *     a9e7  cmp bp,0x0 / jns 0xa9ef
 *     a9ec  jmp 0xabc0               ; bp NEGATIVE -> sfx and RETURN
 *     a9ef  ... save the box, world -> screen, ROUND half-up, scan the grid
 *     ab40  ... on a hit: decode the tag, scale, subtract from bp
 *
 * So a creature that touched the hero this tick is not also damage-scanned:
 * the `jmp` short-circuits the grid entirely. A port that runs the two tests
 * independently lets one creature both hurt the hero and die to a projectile
 * on the same frame, which the original cannot do.
 */
export const CONTACT_SHORT_CIRCUITS_SCAN = true;

/**
 * CS:0xa9ef-0xab96 — the creature's half of the frame: scan the damage grid
 * over its own box and take whatever tag it finds.
 *
 * `entity.state` is the +0x08 word the original passes in and out through BP
 * (CS:0xFFA2 loads it, CS:0xFFB4 writes it back), which is why one word is
 * both "HP" and "am I dying" — a negative value IS the death signal, and the
 * caller starts the death frames on it.
 *
 * @param {{x,y,state}} entity   WORLD coordinates
 * @param {DamageGrid} grid
 * @param {{x,y}} cam            the scroll origin DS:0x0a / DS:0x0c
 * @param {Function} decode      collision.js damageForTag, pre-bound to the
 *                               slot weapons and their runtime state
 * @param {number} scalar        DS:0x365
 * @returns {{hit:boolean, tag:number, damage:number, killed:boolean}}
 */
/**
 * CS:0xABEE-0xAC3D — one axis of the "hit landed, target survived" debris
 * spark's jittered position. Called once per axis (X against the box WIDTH,
 * Y against the HEIGHT), each with its OWN draw from the shared random
 * table, so the two axes jitter independently.
 *
 *   ABEE  cx = width  ; sar cx,1            ; half the box
 *   ABF4  ax = center + cx                  ; the box's own centre
 *   ABF6  cx &= 0xfff0 / jnz / mov cx,0x10   ; round DOWN to 16 (16 if that's 0)
 *   ABFE  dec cx                            ; cx = the jitter MASK
 *   AC00  call 0x3836                       ; one random draw, dx = ax = it
 *   AC08  js  (SIGN of the FULL draw picks +/-)
 *   AC0A  dx &= cx / ax +=/-= dx            ; magnitude = draw & mask
 *   AC3A  ax -= 8                           ; the same -8 on both axes
 *
 * @param {number} center  entity.x or entity.y (WORLD)
 * @param {number} size    the box's w or h
 * @param {number} draw    one raw 0..0xFFFF word from CS:0x3836 (GodsRandom#next)
 */
export function hitSparkAxis(center, size, draw) {
  let mask = size & ~0xf;                 // ABF6/AC1C
  if (mask === 0) mask = 0x10;            // ABFB/AC21
  mask -= 1;                              // ABFE/AC24 — dec cx
  const negative = (draw & 0x8000) !== 0; // AC08/AC2E `or ax,ax / js` — SIGN of the draw
  const mag = draw & mask;                // AC0A/AC30 — `and dx,cx`
  return center + (size >> 1) + (negative ? -mag : mag) - 8;   // AC3A/AC3D
}

/**
 * CS:0xa9ef-0xab96 — the creature's half of the frame: scan the damage grid
 * over its own box and take whatever tag it finds.
 *
 * `entity.state` is the +0x08 word the original passes in and out through BP
 * (CS:0xFFA2 loads it, CS:0xFFB4 writes it back), which is why one word is
 * both "HP" and "am I dying" — a negative value IS the death signal, and the
 * caller starts the death frames on it.
 *
 * @param {{x,y,state}} entity   WORLD coordinates
 * @param {DamageGrid} grid
 * @param {{x,y}} cam            the scroll origin DS:0x0a / DS:0x0c
 * @param {Function} decode      collision.js damageForTag, pre-bound to the
 *                               slot weapons and their runtime state
 * @param {number} scalar        DS:0x365
 * @param {object} opts          { rng: ()=>number (CS:0x3836), debris }.
 *   `rng`/`debris` are only touched on a hit that deals damage and the
 *   target SURVIVES — CS:0xABDA-0xAC4C, the "hit spark" this document's
 *   own debris pass (CS:0xAC4C) left blocked pending this exact model.
 * @returns {{hit:boolean, tag:number, damage:number, killed:boolean}}
 */
export function creatureScansGrid(entity, grid, cam, decode, scalar = 0,
                                  box = CREATURE_CONTACT_BOX, targets = null,
                                  opts = {}) {
  const sx = entity.x - cam.x, sy = entity.y - cam.y;   // CS:0xAA01
  /* CS:0xAA86-0xAAA9 — the hunter's TARGET LIST is appended here, inside the
   * damage scan, and it is GATED. `cmp byte [0x343],0 / js` skips the append
   * when DS:0x343 is negative, and CS:0x9124-0x9146 sets it to 0xFF unless
   * DS:0x168 is non-negative OR one of the three slots holds weapon 8 — the
   * hunter itself. So the list the hunter homes on is only built while the
   * hero is actually carrying one; every other frame it stays empty.
   * A port that always appends gives the hunter targets it could not have had.
   * (UNKNOWN_DS_0168: a counter set to 1000 at CS:0xC347 and to -1 at
   * CS:0xC470, decremented by a hit at CS:0xAB4D. Its meaning is not
   * established, so it is an input here rather than a constant.) */
  if (targets) targets.push({ x: sx, y: sy, entity });
  const tag = grid.scan(sx, sy, box.w, box.h);
  if (!tag) return { hit: false, tag: 0, damage: 0, killed: false };

  const d = decode(tag);                                // CS:0xAB41 -> 0x9320
  if (!d || !d.damage) return { hit: true, tag, damage: 0, killed: false };

  const applied = difficultyScale(d.damage, scalar);    // CS:0xAB5E + 0xAB86
  entity.state -= applied;
  /* CS:0xAB88 `js` / `jz` — BOTH reach the death path, so the test is <= 0. */
  const killed = entity.state <= 0;
  if (killed) entity.state = -1;                        // the caller reads its SIGN
  else if (opts.rng && opts.debris) {                    // CS:0xABDE `or bx,bx / jz` — bx=applied, skip if 0
    /* CS:0xABE5/0xABE9 read the entity's WORLD x/y straight off the stack
     * (pushed before the screen conversion at CS:0xA9FD), so this works
     * directly in world space — no screen round-trip needed. */
    const jx = hitSparkAxis(entity.x, box.w, opts.rng());
    const jy = hitSparkAxis(entity.y, box.h, opts.rng());
    opts.debris.spawn(jx, jy, 0, 0);                     // CS:0xAC40/0xAC4C — stationary
  }
  return { hit: true, tag, damage: applied, killed, weapon: d.weapon };
}
