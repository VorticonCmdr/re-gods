/* starburst.js — CS:0xA461 / CS:0xA4C1, and UNKNOWN_starburst is closed.
 *
 * The "starburst" potion (category-0 type 36, placed 5 times across the eight
 * maps) throws eight particles out in a compass rose. They fly, fall, stamp
 * the damage grid — and each one can set off a WHOLE NEW BURST from where it
 * is, so the thing is a chain reaction, not a one-shot effect.
 *
 * ── THE ARRAY, DS:0x8cfa ──────────────────────────────────────────────────
 * 80 records of SIX bytes: { i16 x, i16 y, i8 vx, i8 vy }. A slot is free
 * when its X is NEGATIVE — every test is `cmp word [..],0 / js`, never a
 * compare against 0xFFFF, the same sign idiom the object array uses.
 *
 * Cleared at CS:0x8E9F: `mov cx,0x50 / mov di,0x8cfa / stosw x3 / loop`.
 * ⚠️ The `ax` it stores is set at CS:0x8E96 (`mov ax,0xffff`) and nothing
 * between there and CS:0x8EA5 touches it — only `stosw`, `add di,0xa` and
 * `loop` for the 20-record debris clear. That is what makes all 80 slots
 * start FREE; if the clear wrote 0 the array would read as permanently full.
 *
 * ── THE TEMPLATE, DS:0xdd00 — EIGHT pairs, and the count is self-checking ─
 * The spawner loads `dl = 7` and exits on `dec dl / js`, so it places EIGHT
 * particles, consuming one `{i8 vx, i8 vy}` pair each. 8 x 2 = 16 bytes, and
 * 0xdd00 + 16 = 0xdd10 — which is the hero's weapon slot A, a variable this
 * project established independently. The accounting closes exactly on a known
 * boundary, which is the check on "eight, not seven".
 */

/** DS:0xdd00..0xdd0f, read out of GAME.EXE at file + 0x10160. A compass rose:
 *  E, SE, S, SW, W, NW, N, NE — with a constant upward bias, since the
 *  "level" pairs carry vy = -1 rather than 0. */
export const BURST_TEMPLATE = Object.freeze([
  [+8, -1], [+8, +5], [0, +5], [-8, +5],
  [-8, -1], [-8, -6], [0, -6], [+8, -6],
]);

export const SLOTS = 80;              // CS:0xA479 `mov cx,0x50`
export const RECORD_BYTES = 6;        // CS:0xA47E `mov bp,0x6`
export const PARTICLES_PER_BURST = 8; // CS:0xA47C `mov dl,0x7`, exits on `js`
export const ARRAY_DS = 0x8cfa;
export const TEMPLATE_DS = 0xdd00;
export const TAG = 0xfc;              // the byte at DS:0xdcfe, passed as `di`
export const SPAWN_SFX = 0x1427;      // CS:0xA4B1

/* ── The age ceiling, DS:0x1d6 ────────────────────────────────────────────
 *     A463  cmp byte [0x34d],0 / jz spawn      ; INACTIVE -> always spawn
 *     A46A  cmp word [0x1d6],0xbe / jl spawn   ; active and age < 190 -> spawn
 *     A472  ret                                ; active and age >= 190 -> refuse
 * Age advances +2 per frame (CS:0xA4C9), so a burst has 95 frames in which it
 * can still chain. */
export const AGE_MAX = 0xbe;          // 190
export const AGE_STEP = 2;            // CS:0xA4C9

/* ── The chain window, DS:0x374 ───────────────────────────────────────────
 * Set to -10 when a FRESH burst starts (CS:0xA4A5) and again on every
 * re-burst (CS:0xA581); incremented once per frame (CS:0xA4CE). The chain
 * test is `cmp byte [0x374],0 / js 0xa58f` — `js` SKIPS the draw, so the
 * particles draw (and may re-burst) only once the byte has climbed back to
 * >= 0: a ten-frame COOLDOWN after every burst, not a window. It is a byte,
 * so `inc` wraps 127 -> -128 and shuts the chain again for 128 frames.
 * [PROVEN] live against PJOYL3: the potion bursts at 1031 and the first
 * CS:0xA572 draws come at 1040. An earlier revision had the test inverted.
 *
 * ⚠️ BUT A CHAIN RE-BURST DOES NOT RESET THE AGE. CS:0xA493's `js` skips the
 * whole init block — age, active flag and chain window — when DS:0x34d is
 * ALREADY negative, and then CS:0xA581 sets the chain window back to -10 on
 * its own. So the window keeps reopening while the age keeps climbing, and it
 * is the age, not the window, that ends the cascade. Resetting the age on a
 * chain makes the effect run forever. */
export const CHAIN_WINDOW = -10;      // 0xf6

/** CS:0xA574 — `dx = 190 - age`, `shl dx,1`, compared `ja` against the FULL
 *  16-bit random word. So the re-burst chance falls linearly from 380/65536
 *  at age 0 to zero at the ceiling. */
export const chainThreshold = (age) => (AGE_MAX - age) * 2;

/* ── Animation and physics ────────────────────────────────────────────────
 * sprite = 77 + DS:0x349, a three-frame cycle stepped once per frame
 * (CS:0xA4D2, wrapping at 3). The whole array shares one phase.
 *
 * ⚠️ A SIXTH DISTINCT GRAVITY RULE. CS:0xA50D tests DS:0x1d4 — a 0..7 counter
 * incremented once per frame — and applies `inc byte [si-1]` (vy += 1) ONLY
 * when it reads zero. So the starburst falls one step every EIGHTH frame,
 * against the hero's every-frame `4 + v` capped at 10, the System-B enemy's
 * `v`-then-increment capped at 16, the time bomb's stepped +1 capped at 4, the
 * magic axe's +2 capped at 8, and the chest loot's +1 capped at 4. No two of
 * the six share an implementation, and there is no cap here at all. */
export const SPRITE_BASE = 0x4d;      // 77
export const SPRITE_FRAMES = 3;       // CS:0xA4D6
export const GRAVITY_PERIOD = 8;      // CS:0xA4E6 `and word [0x1d4],0x7`

/* ⚠️ A SIXTH CULL RECTANGLE, and it matches none of the others.
 *     A527  cmp bx,0x15f / jg  cull      ; screen x > 351
 *     A52D  cmp bx,-8    / jl  cull
 *     A532  cmp dx,-8    / jl  cull
 *     A537  cmp dx,0xbf  / jng draw      ; screen y <= 191 -> draw
 * i.e. x in [-8, 351] and y in [-8, 191], inclusive. Against the projectile
 * mover's exclusive (-32, 320) x (-32, 192), the pathfinder's [-63, 351] x
 * [-63, 223], and the damage scanner's own clip. Reusing one constant
 * diverges. A culled particle frees its slot (CS:0xA53D). */
export const CULL = Object.freeze({ xMin: -8, xMax: 0x15f, yMin: -8, yMax: 0xbf });

/* ── The five callers of the spawner ──────────────────────────────────────
 *   CS:0x6205  the type-36 potion, at (heroX + 8, heroY + 0x20)
 *   CS:0x9417  a tile-derived position (`ax<<2`, `bx<<3`, plus the scroll)
 *   CS:0xA58C  the chain reaction, from a live particle's own position
 *   CS:0xC464  the FAMILIAR'S DEATH — a burst at its last remembered spot,
 *              gated on DS:0x391
 *   CS:0xD945  a scripted seven-burst explosion around DS:0x28c/0x28e at
 *              random offsets. ⚠️ It clears DS:0x34d on EVERY iteration
 *              (CS:0xD926), which forces seven FRESH bursts rather than one
 *              continuation — the only site that does that, and why it pokes
 *              DS:0x374 to -4 afterwards instead of the usual -10.
 */
export const SPAWNER_CALLERS = Object.freeze(
  [0x6205, 0x9417, 0xa58c, 0xc464, 0xd945]);

/**
 * The subsystem. `rnd` must be a GodsRandom-shaped `{ next() }`.
 *
 * The port keeps the original's shape deliberately: one fixed array, first-fit
 * allocation, and a re-burst that calls the spawner from inside the updater's
 * own walk. What bounds the cascade is the spawner's entry gate plus the 80
 * slots — NOT a recursion guard, which the original does not have.
 */
/* DS:0x1d4 — the gravity phase. CS:0xA4E2/0xA4E6 are its only writers
 * (the other `0x1d4` hits in the image are SS-relative tables or data), and
 * nothing resets it: it counts starburst ticks since boot, mod 8. [PROVEN]
 * live: in PJOYL3 the potion's burst at 1031 first feels gravity at 1033,
 * i.e. the counter stood at 5 — in two different attract cycles. */
let gravityPhase = 0;
export const setStarburstGravityPhase = (v) => { gravityPhase = v & 7; };

export class Starburst {
  constructor(rnd) {
    this.rnd = rnd;
    /* x < 0 means free — CS:0x8E96 fills the array with 0xFFFF. */
    this.slots = Array.from({ length: SLOTS },
                            () => ({ x: -1, y: 0, vx: 0, vy: 0 }));
    this.active = false;       // DS:0x34d, 0 or 0xff
    this.age = 0;              // DS:0x1d6
    this.chain = 0;            // DS:0x374
    this.phase = 0;            // DS:0x349, the 3-frame sprite cycle
    this.bursts = 0;           // how many times the spawner actually ran
    this.chained = 0;          // ...of which were re-bursts
    this.refused = 0;          // spawner calls the age gate turned away
  }

  /** CS:0xA461. Returns the number of particles actually placed. */
  spawn(x, y) {
    /* The entry gate. Note the first test is `jz` — an exact zero. */
    if (this.active && this.age >= AGE_MAX) { this.refused++; return 0; }

    let placed = 0, slot = 0;
    /* `dl = 7`, exiting on `dec dl / js`, is EIGHT placements. */
    for (let n = 0; n < PARTICLES_PER_BURST; n++) {
      while (slot < SLOTS && this.slots[slot].x >= 0) slot++;   // CS:0xA481
      if (slot >= SLOTS) break;                                 // array full
      const s = this.slots[slot];
      s.x = x; s.y = y;
      s.vx = BURST_TEMPLATE[n][0];                              // CS:0xA492
      s.vy = BURST_TEMPLATE[n][1];
      /* ⚠️ CS:0xA493 — the init runs only if the burst was NOT already
       * active, so a chain re-burst inherits the running age. */
      if (!this.active) {
        this.age = 0;                                           // CS:0xA49A
        this.active = true;                                     // CS:0xA4A0
        this.chain = CHAIN_WINDOW;                              // CS:0xA4A5
      }
      placed++; slot++;
    }
    this.bursts++;
    return placed;
  }

  /**
   * CS:0xA4C1. One tick.
   * @param {{x:number,y:number}} cam the scroll origin
   * @param {object} grid the damage grid; `stamp2x2(x, y, tag)`
   * @returns {{drawn:Array, live:number, culled:number, stamped:number}}
   */
  step(cam, grid) {
    const out = { drawn: [], live: 0, culled: 0, stamped: 0 };
    if (!this.active) return out;                          // CS:0xA4C1 `js`

    this.age += AGE_STEP;                                  // CS:0xA4C9
    this.chain = ((this.chain + 1 + 0x80) & 0xff) - 0x80;  // CS:0xA4CE `inc byte`
    this.phase = (this.phase + 1) % SPRITE_FRAMES;         // CS:0xA4D2
    gravityPhase = (gravityPhase + 1) & (GRAVITY_PERIOD - 1);          // CS:0xA4E2
    const sprite = SPRITE_BASE + this.phase;               // CS:0xA517

    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i];
      if (s.x < 0) continue;                               // CS:0xA4F3 `js`
      out.live++;                                          // CS:0xA4F8 `inc bp`

      s.x += s.vx; s.y += s.vy;                            // CS:0xA4FF/0xA503
      /* ⚠️ Gravity AFTER the step, and only on the eighth frame. */
      if (gravityPhase === 0) s.vy += 1;                   // CS:0xA50D/0xA514

      const sx = s.x - cam.x, sy = s.y - cam.y;            // CS:0xA51F
      if (sx > CULL.xMax || sx < CULL.xMin
          || sy < CULL.yMin || sy > CULL.yMax) {
        s.x = -1;                                          // CS:0xA53D
        out.culled++;
        continue;
      }
      /* CS:0xA560 tail-jumps into the 2x2 stamp with a hand-built return
       * address, then CS:0xA563 draws. So a starburst particle is a DAMAGE
       * SOURCE, carrying tag 0xFC from the byte at DS:0xdcfe. */
      if (grid && grid.stamp2x2(sx, sy, TAG)) out.stamped++;
      out.drawn.push({ x: sx, y: sy, sprite });

      /* THE CHAIN. CS:0xA568 — only once the cooldown byte is >= 0, and
       * only against a threshold that decays with the burst's age. */
      if (this.chain >= 0) {
        const r = this.rnd.next();                         // CS:0xA56F
        if (r <= chainThreshold(this.age)) {               // CS:0xA57D `ja`
          this.chain = CHAIN_WINDOW;                       // CS:0xA581
          this.spawn(s.x, s.y);                            // CS:0xA58C
          this.chained++;
        }
      }
    }

    /* CS:0xA599 — `bp` is the live count; zero deactivates the whole thing. */
    if (out.live === 0) this.active = false;               // CS:0xA59F
    return out;
  }

  get liveCount() { return this.slots.reduce((n, s) => n + (s.x >= 0 ? 1 : 0), 0); }
}

/* ── ⚠️ WHAT A STARBURST PARTICLE ACTUALLY DOES TO A CREATURE ─────────────
 *
 * The negative-tag ladder at CS:0x938B peels one `inc ax` at a time, so the
 * four special tags decode to genuinely different damages — and this port
 * previously returned 0 for all of them:
 *
 *   0xFF  ax = -1  -> [0x1ea] = DS:0x210, the FAMILIAR'S POWER
 *   0xFE  ax = -2  -> 10000, unless DS:0x34 != 0, then 0
 *   0xFD  ax = -3  -> 0                       (UNKNOWN_tag_fd's PRODUCER is
 *                                              still unfound; its payload is
 *                                              now known to be nothing)
 *   0xFC  ax = -4  -> 50 when DS:0x34 != 0, otherwise 10000
 *
 * ⚠️ AND DS:0x34 IS ZERO IN NORMAL PLAY, so a starburst particle deals 10000
 * against creature HP that tops out at 255 — an instant kill that no
 * difficulty scalar can forgive (the scalar forgives at most three quarters).
 *
 * That is not read off the init value. DS:0x34 has NINE writers and four
 * readers IN THE MAIN LOOP (CS:0x01E5, 0x01FC, 0x0226, 0x0272), and every one
 * of those four takes the full-frame path only at zero — mode 1 additionally
 * skips the object pass, and both 1 and 2 skip two further blocks of per-frame
 * calls. Mode 1 is set once, at CS:0xC4A5, beside a self-modifying `mov byte
 * [cs:0xad88],0xc3` that patches a routine to RET; mode 2 once, at CS:0xC9D1,
 * immediately after the scripted seven-burst explosion. Both are restored to 0
 * (CS:0xC767, CS:0xC808, CS:0xD950, and a push/pop bracket at CS:0xCAB1).
 * So: mode 0 is normal gameplay, and the other two are not.
 *
 * `UNKNOWN_DS_0034` narrows rather than closes — WHAT modes 1 and 2 are is
 * still unestablished; that they are not normal play now is.
 */
export const SPECIAL_TAG_DAMAGE = Object.freeze({
  0xff: { at: 0x938e, damage: 'DS:0x210 (the familiar\'s power)', varies: true },
  0xfe: { at: 0x93a8, damage: 10000, whenMode0: 10000, otherwise: 0 },
  0xfd: { at: 0x93c2, damage: 0, whenMode0: 0, otherwise: 0 },
  0xfc: { at: 0x93cc, damage: 10000, whenMode0: 10000, otherwise: 50 },
});

/** CS:0x93CC / CS:0x93B0 — the mode byte both area effects branch on. */
export const modeDamage = (tag, mode) => {
  const e = SPECIAL_TAG_DAMAGE[tag];
  if (!e || e.varies) return null;
  return mode === 0 ? e.whenMode0 : e.otherwise;
};
