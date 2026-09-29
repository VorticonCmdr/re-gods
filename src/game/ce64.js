/* ce64.js — the DS:0xce64 world-3 creature, and its own "spit" sub-projectile.
 *
 * ⚠️ UPDATE (2026-09-29): the provenance note below is superseded. The
 * update loop (CS:0x7F5D-0x8039) and the spit (allocator CS:0x80BB-0x80F6,
 * mover CS:0x810D-0x81E8, pool DS:0xCEC8, 10 x 12 bytes) were read from the
 * bytes, and this file's wander timer, attack window, spit legs ((rand&7)+2
 * toward the hero from x+4/y+12, (rand&7)+3 steps, rand&15 pauses) and spit
 * sprites (0x1ED + 4/8, frame & 3) all match them. See docs/
 * destructible-and-hazards.md, UNKNOWN_ce64_identity.
 *
 * ── PROVENANCE, AND WHY THIS FILE IS TWO TIERS OF CONFIDENCE ─────────────
 *
 * The PARENT CREATURE is cross-confirmed by two independent passes: an
 * earlier, incomplete static read (CLAUDE.md's own `UNKNOWN_ce64_pool` /
 * `UNKNOWN_ce64_death_branch` closures) and this session's fresh, complete
 * disassembly. Where the two agree — the allocator's seed values, the
 * 0x20x0x28 hitbox, the DS:0x34 bracket, the death-draw offsets — the CS:
 * addresses below are cited from the EARLIER pass, because it is the one
 * that actually gives hex. Everything the earlier pass left as "not chased
 * further" (the wander/attack timing, the on-screen attack gate, the score
 * values) comes from this session's fresh work, with no further CS:
 * sub-addresses given for it — cited as "this session" rather than invented.
 *
 * The SPIT is not documented anywhere in the earlier pass at all — CLAUDE.md
 * explicitly says the creature's "own attack/wander AI ... remains untraced
 * beyond this draw pair". Its whole section below (windup, steering, death
 * sequence) is single-source, this session only, with no CS: breakdown.
 * Treat it as a good-faith model of what was specified, not yet
 * independently re-verified — the same posture this project takes toward
 * any `[WF]` finding before a second read confirms it.
 *
 * ── THE POOL, CS:0x7F0D `[cross-confirmed]` ──────────────────────────────
 *
 *   7f0f  mov si,0xce64 / mov cx,0xa        ; walk 10 slots
 *   7f15  cmp word [si],0 / js 0x7f23       ; free when x is negative
 *   7f1a  add si,0xa / loop 0x7f15
 *   7f21  stc / ret                          ; all ten busy -> fail
 *   7f23  add ax,[0xa]                       ; screen -> world X
 *   7f27  mov [si],ax / mov [si+2],bx        ; seed x, y
 *   7f2c  mov word [si+4],0xc8               ; hp/"strength" := 200
 *   7f31  mov word [si+6],0                  ; wander-state := 0
 *   7f36  mov word [si+8],0xa                ; timer := 10
 *   7f3b  mov byte cs:[0x7f5c],0x90          ; ARM the per-tick update (NOP=on)
 *   7f43  clc / ret
 *
 * This is a straight match for this session's own allocator spec (hp=200,
 * wanderState=0, timer=10) and independently confirms the record's field
 * order: +0 x, +2 y, +4 hp, +6 wanderState, +8 timer.
 *
 * ⚠️ UNLIKE THE WORLD-2 NEST (game/nest.js), THIS ALLOCATOR IS CALLED WITH
 * THE RIGHT FLAG TEST. Its sole caller, CS:0x1C7D (gating on sprite 0x10a =
 * 170+96, object type 96), does `jc 0x1ce0` on failure — carry, correctly —
 * where the nest's own sibling call at CS:0x1C91 tests `jz` and is wrong.
 * So a full pool genuinely blocks this spawn rather than silently consuming
 * the placed object. That caller-side dispatch (which map object triggers a
 * spawn) is out of THIS file's scope, exactly as nest.js keeps the object-
 * array walk external to `Nests` — only `spawn()` itself lives here.
 *
 * ── ARMED GATE, CS:0x7F5C `[cross-confirmed]` ────────────────────────────
 * The per-tick update's own entry is a self-modifying RET/NOP trampoline at
 * CS:0x7f5c (the SAME trick nest.js's CS:0x8687 uses, and CS:0xAD88's
 * selector-2 driver) — armed (0x90) by the allocator above, and disarmed
 * (0xc3) by this pool's own clear routine, CS:0x7F45 (confirmed only
 * indirectly: nest.js's own header documents CS:0x8661 jumping INTO THE
 * MIDDLE of this same clear loop at CS:0x7F48, disarming CS:0x7F5C as a side
 * effect of clearing the unrelated DS:0xcfcc pool). Modelled here as a plain
 * `armed` flag, set on a successful spawn and cleared on `clear()`.
 * ⚠️ Unlike nest.js's own pool, there is no evidence here of a
 * self-disarm-when-empty check for THIS walker (nest's CS:0x8796 has no
 * cited sibling for CS:0x7f5c) — so `armed` is NOT auto-cleared when the
 * last creature dies. Flagged rather than guessed.
 *
 * ── THE CONTACT TAIL, CS:0x7FB5-0x7FDD `[cross-confirmed]` ───────────────
 *
 *   7fcf  mov dl,byte [0x34]        ; save the incoming value
 *   7fd3  push dx
 *   7fd4  mov byte [0x34],0x1       ; FORCE DS:0x34 = 1
 *   7fd9  call 0x1000:a9e4          ; the shared hero-contact test + damage-
 *                                   ;   grid self-scan (combat.js attackHero
 *                                   ;   + creatureScansGrid, chained)
 *   7fdc  pop dx
 *   7fdd  mov byte [0x34],dl        ; restore it
 *
 * This bracket loads {x, y, hp} and sets the 0x20x0x28 (32x40) box IMMEDIATELY
 * before it, so BOTH halves of the shared a9e4 call — the contact test
 * (CS:0xac59, combat.js's attackHero) AND, if that misses, the damage-grid
 * scan (CS:0xa9ef, combat.js's creatureScansGrid) — inherit the SAME box and
 * the SAME forced DS:0x34=1. combat.js's `reportGate` option and
 * collision.js's `damageForTag` `mode` parameter are both faces of this one
 * DS:0x34 global, so this creature is the ONE place in the port that must
 * pass `reportGate:1` into attackHero AND `mode:1` into the tag decode
 * inside the SAME contact-then-scan call.
 *
 * ⚠️ THE PRACTICAL CONSEQUENCE, WORTH STATING PLAINLY: because DS:0x34=1
 * forces `reportGate`, CS:0xa9e4's own `cmp bp,0 / jns` is ALWAYS taken —
 * contact never short-circuits the scan for this creature the way it does
 * for every ordinary System-A/System-B entity (frame.js's stepCreatureDamage
 * documents the short-circuit as the general rule). So THIS creature hurts
 * the hero on contact AND stays weapon-scannable on the very same tick — the
 * only entity in the game with that property, and via `mode:1` in the tag
 * decode, the only entity whose starburst/invulnerability-aura damage is
 * capped at 50/0 instead of 10000/10000 (collision.js SPECIAL_TAG_DAMAGE).
 *
 * ── THE DEATH DRAW, CS:0x8076-0x8096 `[cross-confirmed]` ─────────────────
 *
 *   8076  ax = [si] ; bx = [si+2]        ; world X/Y from the record
 *   807b  ax -= 4 ; bx -= 8               ; the SAME (-4,-8) offset the
 *                                         ;   world-2 nest's own death draw
 *                                         ;   uses (game/nest.js DEATH_DRAW_
 *                                         ;   OFFSET) — a shared convention,
 *                                         ;   not a coincidence
 *   8081  bp = [si+6]                     ; the WANDER-STATE FIELD, reused
 *   8084  bp += 0x6c                      ;   post-death as the death-frame
 *                                         ;   counter — same reuse pattern
 *                                         ;   this project documents for
 *                                         ;   every other entity type
 *   8087  ax -= [0xa] ; bx -= [0xc]       ; world -> screen
 *   808f  [0x4]=ax ; [0x6]=bx ; [0x8]=bp  ; the shared entity blitter's args
 *
 * ⚠️ A DISCREPANCY, FLAGGED RATHER THAN SILENTLY PICKED: the earlier pass
 * also names a SIBLING arm, CS:0x8068-0x8073 (`bx -= 0xa`, calling CS:0x80BB
 * instead of drawing directly), calling it "plausibly the alive draw" — its
 * own hedge word, not a confirmed reading. This session's fresh spec gives
 * the ALIVE draw with NO extra offset at all: `(x - camera.x, y - camera.y)`.
 * That is what is implemented below. If a live trace later confirms the
 * -0xa arm is genuinely the alive draw, this file's DRAW_ALIVE offset is
 * wrong and needs a `dy: -0xa` term added — but two sources disagreeing,
 * one of them hedged, is not grounds to guess which is right.
 *
 * ── WHAT HAS NO CITED ADDRESS AT ALL ──────────────────────────────────────
 * The wander/attack cycle's exact timing (the 40+rand&31 reload, the
 * wanderState 0->1->2->3->4->0 walk, the on-screen attack gate), the score
 * values (1000/500), and the ENTIRE spit sub-projectile (windup, steering,
 * death sequence) come from this session's own fresh disassembly with no
 * further CS: sub-addresses supplied. They are implemented exactly as
 * specified, not invented, but this file cannot cite hex for them the way
 * the sections above can.
 *
 * ⚠️ ONE NUMERIC DISCREPANCY BETWEEN THE TWO PASSES, ALSO FLAGGED: the
 * earlier pass describes "a timer at [si+8] reloaded with 10 + rand()&0x1f
 * on expiry". The mask agrees with this session's 40 + (rand()&31) (0x1f ==
 * 31); the BASE does not (10 vs 40). The allocator above seeds +8 to 0xa
 * (10) as the INITIAL timer at spawn, not the reload value used at every
 * later expiry — the earlier pass's "10 + rand&0x1f" reads very much like
 * that spawn-seed constant conflated with the reload, an easy mistake since
 * both are "small number + optional mask" inside the same function. This
 * file follows this session's fresh figure (40 + rand()&31) as the reload,
 * and 10 as the one-time spawn seed — matching both passes rather than
 * picking one and hiding the conflict.
 *
 * ── FREEZE, DS:0x2fa ──────────────────────────────────────────────────────
 * The earlier pass confirms this creature "honours the 'freezes aliens'
 * potion" via `cmp word [0x2fa],0`. Same DS: address, same universal rule
 * this project states everywhere else: freeze stops MOVEMENT, never stops
 * the contact test or the draw. Reused here as `FREEZE_DS`, matching
 * nest.js's own constant of the same name/value.
 */

import { attackHero, creatureScansGrid } from './combat.js';

/* ═════════════════════════════════════════════════════════════════════════
 * THE CREATURE
 * ═════════════════════════════════════════════════════════════════════════ */

export const OBJECT_TYPE = 96;             // POBJECTS category 4, empty name/desc
export const OBJECT_SPRITE = 0x10a;        // 266 = 170 + 96 — CS:0x1C7D's own dispatch test
export const WORLD = 3;                    // a LEVEL-PLACEMENT fact (6 placements,
                                            // PLEV3A/PLEV3B only) — NOT a runtime
                                            // gate inside this allocator; unlike
                                            // nest.js's CS:0x8611, no world check
                                            // is given for CS:0x7F0D in this
                                            // session's spec, so none is modelled.
export const POOL_DS = 0xce64;
export const SLOTS = 10;                   // CS:0x7F0F `mov cx,0xa`
export const STRIDE = 10;                  // CS:0x7F1A `add si,0xa`
export const FREEZE_DS = 0x2fa;            // same address, same meaning as nest.js

/* ── The seeds, CS:0x7F23-0x7F3B `[cross-confirmed]` ──────────────────────
 *   +0x00  i16  world X   — NEGATIVE means the slot is free (CS:0x7F15 `js`)
 *   +0x02  i16  world Y
 *   +0x04  i16  HP        — doubles as the entity's "strength" for combat.js
 *   +0x06  i16  wanderState — ALSO reused, post-death, as the death-frame
 *                             counter (CS:0x8081/0x8084)
 *   +0x08  i16  timer       — the one-time spawn seed is 10; the RELOAD used
 *                             at every later expiry is 40 + (rand()&31), see
 *                             the discrepancy note above.
 */
export const SEED_HP = 0xc8;               // 200 — CS:0x7F2C
export const SEED_WANDER = 0;              // CS:0x7F31
export const SEED_TIMER = 0xa;             // 10  — CS:0x7F36, the SPAWN seed only

/* ── The wander/reload timer, this session, no further address given ─────
 * TIMER_RELOAD_MASK matches the earlier pass's own `& 0x1f` exactly (0x1f ==
 * 31); TIMER_RELOAD_BASE (40) is this session's figure, not the earlier
 * pass's "10" — see the discrepancy note above. */
export const TIMER_RELOAD_BASE = 40;
export const TIMER_RELOAD_MASK = 31;       // 40..71

/* ── The wander/attack cycle `[this session]` ──────────────────────────────
 * wanderState 0: the countdown state — `timer--` every tick while it stays
 *   >= 0; once it goes negative, RELOAD the timer and advance to 1.
 * wanderState 1/2/3/4: a plain per-tick `wanderState++` walk — 1->2 and 2->3
 *   are silent, 3 is the ATTACK tick (gated on-screen), and reaching 4 resets
 *   straight to 0 in the SAME tick (so a live DRAW_ALIVE call never actually
 *   sees wanderState==4 — see WANDER_SPRITE below).
 * This is a materially different shape from the world-2 nest's own fire
 * cycle (game/nest.js aimAt/FIRE_PERIOD): the nest re-aims every tick it
 * isn't reloading; this creature aims exactly once, on a single tick, no
 * matter how far past the reload the timer has already counted. */
export const ATTACK_AT_WANDER = 3;         // the tick that spawns a spit
export const WANDER_CYCLE_LENGTH = 4;      // ticks 1,2,3,4 before reset to 0

/* ── The attack's on-screen gate `[this session]` ─────────────────────────
 * ⚠️ AN EIGHTH DISTINCT CULL RECTANGLE, per this project's own running
 * tally (CLAUDE.md's collision.js header already lists seven that disagree
 * with each other). Inclusive at every edge, per the literal spec — unlike
 * the spit's own cull below, which is exclusive at its upper edges. Two
 * different shapes on two halves of the SAME creature; do not unify them. */
export const ATTACK_WINDOW = Object.freeze({ xMin: -32, xMax: 320, yMin: -8, yMax: 200 });

/* Where the attack spawns a spit: the creature's OWN x, and y-10. The -10 is
 * applied INSIDE Ce64Spits.spawn (see SPIT_ORIGIN_Y_BIAS below), so the
 * creature step passes its raw x/y through unmodified. */

/* ── The hitbox, shared by BOTH halves of the bracketed a9e4 call ─────────
 * CS:0x7FB5-0x7FDD sets ONE box (DS:0x1e2/0x1e4 = 0x20/0x28) before the
 * single call that does contact-then-scan, so both combat.js.attackHero and
 * combat.js.creatureScansGrid use this SAME box — not the 32x32 default
 * every other System-B-shaped creature uses (combat.js CREATURE_CONTACT_BOX). */
export const BOX_CREATURE = Object.freeze({ w: 0x20, h: 0x28 });   // 32x40

/* ── The BCD score award, this session, dl values per the shared CS:0x0C8B
 * entry point (treasure.js Score.add takes a plain binary point value and
 * converts to packed BCD internally — that conversion IS the dl encoding). */
export const SCORE_CREATURE_KILL = 1000;   // dl = 0x10
export const SCORE_SPIT_KILL = 500;        // dl = 5 — see the spit section

/* ── The death draw `[cross-confirmed]`, CS:0x8076-0x808F ─────────────────
 * See the header for the -4/-8 offset and the wanderState/death-counter
 * reuse. DEATH_FREE_AT matches nest.js's OWN constant of the same value —
 * both creatures free their corpse after exactly 7 drawn death frames,
 * which reads as a shared engine convention rather than a coincidence. */
export const DEATH_SPRITE_BASE = 0x6c;                       // 108
export const DEATH_DRAW_OFFSET = Object.freeze({ dx: -4, dy: -8 });
export const DEATH_FREE_AT = 7;

/* The alive sprite, CS:0x8003-0x800D: SS:[0x3602 + wanderState*2]. Read
 * live (SS:0x3602 in a running DOSBox) and from the GAME.EXE image, the same
 * eight words: 266 445 446 447, then the brood's 535 536 537 536 (SS:0x360A).
 * So state 0 draws the object's own sprite (266 = 170 + 96) and states 1-3
 * are the attack wind-up. The table is 4 entries, indexed 0..3: wanderState
 * reaches 4 inside #wander but resets to 0 the same tick (CS:0x7FB0), before
 * the draw. Closes UNKNOWN_ce64_sprite_table. */
export const SPRITE_TABLE_SS = 0x3602;
export const SPRITE_TABLE_READ_ADDR = [0x8003, 0x800d];
export const WANDER_SPRITE = Object.freeze([266, 445, 446, 447]);

export class Ce64Creatures {
  /** @param {{next:()=>number}} rng  the replayed 256-word table (random.js) */
  constructor(rng) {
    this.rng = rng;
    this.slots = Array.from({ length: SLOTS }, () => ({
      x: -1, y: 0, hp: 0, wanderState: 0, timer: 0,
    }));
    this.armed = false;      // CS:0x7f5c — see the header's ARMED GATE note
  }

  /**
   * CS:0x7F0D. Reachable only from the map-object dispatch (out of scope
   * here, matching nest.js's own boundary) — the sole caller CS:0x1C7D
   * correctly retries a full pool rather than consuming the object.
   *
   * @param {number} screenX  the object's screen X at the moment it's touched
   * @param {number} worldY   the object's world Y
   * @param {number} camX     DS:0x0a
   * @returns {boolean}
   */
  spawn(screenX, worldY, camX) {
    const free = this.slots.find((s) => s.x < 0);      // CS:0x7F15 `js`
    if (!free) return false;                            // CS:0x7F21 `stc`
    free.x = screenX + camX;                             // CS:0x7F23/0x7F27
    free.y = worldY;
    free.hp = SEED_HP;                                   // CS:0x7F2C
    free.wanderState = SEED_WANDER;                      // CS:0x7F31
    free.timer = SEED_TIMER;                             // CS:0x7F36
    this.armed = true;                                   // CS:0x7F3B
    return true;
  }

  /** CS:0x7F45 (the shared clear tail nest.js's own header documents). */
  clear() {
    for (const s of this.slots) s.x = -1;
    this.armed = false;
    return this;
  }

  get live() { return this.slots.reduce((n, s) => n + (s.x >= 0 ? 1 : 0), 0); }

  /**
   * CS:0x7F5D onward, gated by the CS:0x7f5c armed byte.
   *
   * @param {{x:number,y:number}} cam
   * @param {{x:number,y:number,state:number}} hero
   * @param {number} freezeTimer   DS:0x2fa; nonzero freezes wander/attack only
   * @param {object} health        combat.js's Health (duck-typed: .bar, .damage)
   * @param {import('./collision.js').DamageGrid} grid
   * @param {(tag:number, mode:number)=>object} decodeTag  collision.js's
   *   damageForTag, pre-bound over the slot weapons/state, with `mode` left
   *   as a live parameter so this creature can force mode:1 (see the header's
   *   THE CONTACT TAIL note) while everything else in the game passes 0.
   * @param {?Ce64Spits} spits     the sibling pool the attack step spawns into
   * @param {{invuln?:number, difficulty?:number, debris?:object,
   *          score?:{add:(n:number)=>void}, targets?:Array}} [opts]
   * @returns {{drawn:Array}}
   */
  step(cam, hero, freezeTimer, health, grid, decodeTag, spits = null, opts = {}) {
    const drawn = [];
    if (!this.armed) return { drawn };                  // CS:0x7f5c == 0xc3
    for (const s of this.slots) {
      if (s.x < 0) continue;
      if (s.hp < 0) { this.#deathDraw(s, cam, drawn); continue; }   // top-of-loop,
                                                                     // BEFORE freeze —
                                                                     // matches nest.js's
                                                                     // own dispatch order
      if (freezeTimer === 0) this.#wander(s, cam, spits);           // CS:0x2fa gate
      this.#contactAndDraw(s, cam, hero, health, grid, decodeTag, drawn, opts);
    }
    return { drawn };
  }

  /** wanderState 0: countdown-and-reload. Nonzero: the 1->2->3->4->0 walk. */
  #wander(s, cam, spits) {
    if (s.wanderState === 0) {
      s.timer -= 1;
      if (s.timer >= 0) return;                          // still counting down
      s.timer = TIMER_RELOAD_BASE + (this.rng.next() & TIMER_RELOAD_MASK);
      s.wanderState = 1;
      return;
    }
    s.wanderState += 1;
    if (s.wanderState < ATTACK_AT_WANDER) return;         // 1->2, silent
    if (s.wanderState === ATTACK_AT_WANDER) {             // ==3: the attack tick
      this.#maybeAttack(s, cam, spits);
      return;
    }
    s.wanderState = 0;                                    // ==4: reset, SAME tick
  }

  #maybeAttack(s, cam, spits) {
    const sx = s.x - cam.x, sy = s.y - cam.y;
    const onScreen = sx <= ATTACK_WINDOW.xMax && sx >= ATTACK_WINDOW.xMin
                   && sy >= ATTACK_WINDOW.yMin && sy <= ATTACK_WINDOW.yMax;
    if (onScreen && spits) spits.spawn(s.x, s.y);          // internally applies -10 on Y
  }

  #contactAndDraw(s, cam, hero, health, grid, decodeTag, drawn, opts) {
    const box = BOX_CREATURE;
    const r = attackHero({ x: s.x, y: s.y, w: box.w, h: box.h, strength: s.hp },
                          hero, health, { reportGate: 1, invuln: opts.invuln, sfx: opts.sfx });
    s.hp = r.strengthOut;
    /* ⚠️ STRUCTURALLY DEAD VIA THIS CALL ALONE, and deliberately kept anyway.
     * With reportGate:1, attackHero's strengthOut === the strength it was
     * given, hit or miss (combat.js: `const reported = !opts.reportGate`).
     * It can only read negative here if s.hp was ALREADY negative entering
     * this method — which cannot happen, since step()'s own top-of-loop
     * dispatch already diverted any negative-hp slot to #deathDraw before
     * #contactAndDraw is ever reached. This is the literal shape of the
     * original's bracketed call (contact, THEN scan-if-miss) — "it can't
     * fire from here" is a fact about the surrounding control flow, not a
     * license to drop the branch the bytes actually have. Left untested for
     * the same reason. */
    if (s.hp < 0) {
      if (opts.score) opts.score.add(SCORE_CREATURE_KILL);
      s.wanderState = 0;
    } else if (decodeTag) {
      const proxy = { x: s.x, y: s.y, state: s.hp };
      creatureScansGrid(proxy, grid, cam, (tag) => decodeTag(tag, 1),
                         opts.difficulty || 0, box, opts.targets || null,
                         { rng: () => this.rng.next(), debris: opts.debris, sfx: opts.sfx });
      s.hp = proxy.state;
      if (s.hp < 0) {
        if (opts.score) opts.score.add(SCORE_CREATURE_KILL);
        s.wanderState = 0;
      }
    }
    /* DRAW_ALIVE runs on BOTH branches above — a creature killed this very
     * tick still draws its ordinary sprite once more; the death cloud only
     * starts on the NEXT tick's top-of-loop dispatch. */
    drawn.push({ x: s.x - cam.x, y: s.y - cam.y, sprite: WANDER_SPRITE[s.wanderState] });
  }

  /** CS:0x8076-0x808F. */
  #deathDraw(s, cam, drawn) {
    const sprite = DEATH_SPRITE_BASE + s.wanderState;      // CS:0x8081/0x8084
    drawn.push({ x: s.x - cam.x + DEATH_DRAW_OFFSET.dx,
                 y: s.y - cam.y + DEATH_DRAW_OFFSET.dy, sprite });
    s.wanderState += 1;
    if (s.wanderState >= DEATH_FREE_AT) s.x = -1;
  }
}

/* ═════════════════════════════════════════════════════════════════════════
 * THE SPIT — single-source, this session only. No CS: sub-addresses were
 * given for anything below; every constant here is transcribed from the
 * task's pseudocode, not independently re-derived.
 * ═════════════════════════════════════════════════════════════════════════ */

/** The shared global cap — ACROSS every Ce64Creatures instance, not per one. */
export const SPIT_CAP = 10;

/** Windup: exactly 10 ticks, state -10..-1, arming the instant state hits 0. */
export const SPIT_WINDUP_TICKS = 10;
export const SPIT_ORIGIN_Y_BIAS = -10;     // spawn Y = creatureY - 10 (ORIGINAL_Y)
export const SPIT_ARM_HP = 20;             // `state` doubles as HP once armed
export const SPIT_ARM_STEPS = 15;
export const SPIT_WINDUP_SPRITE = 492;     // fixed pose, no facing, no animation

/** Alive: a 4-frame cycle, animating every tick regardless of movement. */
export const SPIT_SPRITE_BASE = 0x1ed;     // 493; +4 moving left, +8 moving right
export const SPIT_FACING_LEFT_OFFSET = 4;
export const SPIT_FACING_RIGHT_OFFSET = 8;

/** SPIT_CONTACT's box — an ORDINARY unbracketed contact call (no reportGate,
 *  no forced DS:0x34), so a touch kills the spit outright on the first hit,
 *  same as any other one-touch creature (combat.js creatureTouchesHero). */
export const SPIT_BOX = Object.freeze({ w: 0x18, h: 0x18 });   // 24x24

/** ⚠️ A NINTH cull rectangle, and a DIFFERENT SHAPE from the parent's own
 *  ATTACK_WINDOW above: exclusive at the upper edge on both axes, inclusive
 *  at the lower. Two cull rectangles on the same creature family, neither
 *  matching the other — reproduce both verbatim, don't unify them. */
export const SPIT_CULL = Object.freeze({ xMin: -32, xMax: 320, yMin: -32, yMax: 224 });

/** Death sequence: sprite = 91 + deathFrame, deathFrame 0..17 (18 sprites,
 *  91..108 inclusive), freed on the SAME tick that draws 108. The tick the
 *  death TRANSITION itself is detected (state -> 1, frame -> -1) draws
 *  NOTHING — neither the just-computed alive sprite nor a death frame — so
 *  the total lifetime from "just died" to freed is 19 ticks (1 silent +
 *  18 drawing), even though only 18 sprites are ever shown. */
export const SPIT_DEATH_SPRITE_BASE = 91;
export const SPIT_DEATH_FRAMES = 18;       // sprites 91..108 inclusive

export class Ce64Spits {
  /** @param {{next:()=>number}} rng */
  constructor(rng) {
    this.rng = rng;
    /* A plain, growable list — NOT a fixed slot pool with a sentinel. The
     * spec is explicit that state=0 is unreachable as a resting value and
     * that "does not exist" should be modelled as literal absence from the
     * array, not a sentinel field, unlike every fixed-slot pool elsewhere
     * in this codebase (nest.js, debris.js, ...). */
    this.spits = [];
  }

  get count() { return this.spits.length; }

  /**
   * Called by the parent creature's own attack step, given the creature's
   * RAW x/y — the -10 origin bias is applied here, internally.
   *
   * @param {number} creatureX
   * @param {number} creatureY
   * @returns {boolean} false when the global cap is already full — the
   *   attack simply fizzles, silently, exactly as specified.
   */
  spawn(creatureX, creatureY) {
    if (this.spits.length >= SPIT_CAP) return false;
    const originY = creatureY + SPIT_ORIGIN_Y_BIAS;
    this.spits.push({
      x: creatureX, originY, y: originY,
      vx: 0, vy: -10, state: -SPIT_WINDUP_TICKS, frame: 0, steps: 0,
    });
    return true;
  }

  clear() { this.spits.length = 0; return this; }

  /**
   * @param {{x:number,y:number}} cam
   * @param {{x:number,y:number,state:number}} hero
   * @param {number} freezeTimer   DS:0x2fa — skips MOVEMENT only, same
   *   universal rule as the parent creature
   * @param {object} health
   * @param {import('./collision.js').DamageGrid} grid
   * @param {(tag:number, mode:number)=>object} decodeTag  the SAME shape
   *   as the parent's, but always called with mode:0 — an ordinary,
   *   un-bracketed contact/scan, unlike the parent's forced DS:0x34=1
   * @param {{invuln?:number, difficulty?:number, debris?:object,
   *          score?:{add:(n:number)=>void}, targets?:Array}} [opts]
   * @returns {{drawn:Array}}
   */
  step(cam, hero, freezeTimer, health, grid, decodeTag, opts = {}) {
    const drawn = [];
    const keep = [];
    for (const p of this.spits) {
      if (this.#stepOne(p, cam, hero, freezeTimer, health, grid, decodeTag, drawn, opts)) {
        keep.push(p);
      }
    }
    this.spits = keep;
    return { drawn };
  }

  /** @returns {boolean} true to keep the record alive, false to free it. */
  #stepOne(p, cam, hero, freezeTimer, health, grid, decodeTag, drawn, opts) {
    if (p.state < 0) return this.#windup(p, cam, drawn);
    if (p.frame < 0) return this.#deathSequence(p, cam, drawn);
    return this.#alive(p, cam, hero, freezeTimer, health, grid, decodeTag, drawn, opts);
  }

  /**
   * ⚠️ NOT CUMULATIVE. `y` is recomputed EVERY tick from the spit's own
   * fixed origin plus the CURRENT vy, which itself ramps -10..-1 toward 0 —
   * it is not `y += vy`. A port that accumulates instead of recomputing from
   * origin drifts to originY-55 after 10 ticks instead of the correct
   * originY-1, because -10-9-8-...-1 sums to -55 while the spec's own walk
   * (recompute from origin each tick) never goes below originY-10.
   */
  #windup(p, cam, drawn) {
    p.y = p.originY + p.vy;             // NOT `p.y += p.vy` — see above
    p.vy += 1;
    p.state += 1;
    if (p.state === 0) {                // the windup just finished — ARM
      p.state = SPIT_ARM_HP;            // doubles as HP from here on
      p.vx = 0; p.vy = 0;
      p.steps = SPIT_ARM_STEPS;
    }
    drawn.push({ x: p.x - cam.x, y: p.y - cam.y, sprite: SPIT_WINDUP_SPRITE });
    return true;                        // no cull, no contact test while rising
  }

  #deathSequence(p, cam, drawn) {
    const deathFrame = -p.frame - 1;    // frame -1 -> 0, -2 -> 1, ...
    drawn.push({ x: p.x - cam.x, y: p.y - cam.y,
                 sprite: SPIT_DEATH_SPRITE_BASE + deathFrame });
    p.frame -= 1;
    return deathFrame < SPIT_DEATH_FRAMES - 1;   // free on drawing sprite 108
  }

  #alive(p, cam, hero, freezeTimer, health, grid, decodeTag, drawn, opts) {
    p.frame = (p.frame + 1) & 3;                 // animates every tick, always
    if (freezeTimer === 0) this.#steer(p, hero);  // freeze skips MOVEMENT only

    const base = p.vx === 0 ? 0 : (p.vx < 0 ? SPIT_FACING_LEFT_OFFSET : SPIT_FACING_RIGHT_OFFSET);
    const sprite = SPIT_SPRITE_BASE + base + p.frame;

    /* SPIT_CONTACT — an ordinary, un-bracketed call: contact first, and only
     * scan the weapon grid if contact did not report a hit (the same chain
     * frame.js's stepCreatureDamage uses for every other entity). */
    const box = SPIT_BOX;
    const r = attackHero({ x: p.x, y: p.y, w: box.w, h: box.h, strength: p.state },
                          hero, health, { invuln: opts.invuln, sfx: opts.sfx });
    p.state = r.strengthOut;
    if (p.state >= 0 && decodeTag) {
      const proxy = { x: p.x, y: p.y, state: p.state };
      creatureScansGrid(proxy, grid, cam, (tag) => decodeTag(tag, 0),
                         opts.difficulty || 0, box, opts.targets || null,
                         { rng: () => this.rng.next(), debris: opts.debris, sfx: opts.sfx });
      p.state = proxy.state;
    }

    if (p.state < 0) {
      /* The death TRANSITION tick: award, nudge, and arm the death sequence
       * for the NEXT tick. Nothing is drawn on this tick — neither the
       * alive sprite computed above nor a death frame. */
      if (opts.score) opts.score.add(SCORE_SPIT_KILL);
      p.x -= 4; p.y -= 4;
      p.state = 1;      // not freed yet — reused purely as a "just died" flag
      p.frame = -1;     // the NEXT tick's dispatch reads this sign
      return true;
    }

    const sx = p.x - cam.x, sy = p.y - cam.y;
    const offscreen = sx < SPIT_CULL.xMin || sx >= SPIT_CULL.xMax
                    || sy < SPIT_CULL.yMin || sy >= SPIT_CULL.yMax;
    if (!offscreen) drawn.push({ x: sx, y: sy, sprite });
    return true;        // culled or not, the record stays alive and resumes
  }

  /** The steering burst: re-seed when spent, otherwise move and count down. */
  #steer(p, hero) {
    if (p.steps === 0) {
      let vx = (this.rng.next() & 7) + 2;
      if (p.x + 4 >= hero.x) vx = -vx;                 // steer toward the hero, X
      let vy = (this.rng.next() & 7) + 2;
      if (p.y + 12 >= hero.y) vy = -vy;                // steer toward the hero, Y
      p.vx = vx; p.vy = vy;
      p.steps = (this.rng.next() & 7) + 3;             // 3..10
      return;
    }
    p.x += p.vx; p.y += p.vy; p.steps -= 1;
    if (p.steps === 0 && !(p.vx === 0 && p.vy === 0)) {
      /* A real movement burst just ended -> PAUSE with zero velocity before
       * the next re-seed. If it was already (0,0) — i.e. this WAS the pause
       * — do nothing extra; the `steps===0` branch above fires next tick and
       * re-seeds normally. */
      p.vx = 0; p.vy = 0;
      p.steps = this.rng.next() & 15;                  // 0..15
    }
  }
}
