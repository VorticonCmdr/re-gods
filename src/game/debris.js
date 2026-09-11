/* debris.js — DS:0x8b4c, and it does NOTHING but draw.
 *
 * ── ⚠️ THIS MODULE EXISTS BECAUSE OF A CONFLATION I MADE ─────────────────
 *
 * Chasing "what else breaks blocks", I saw that CS:0x8B90's walker reached
 * CS:0x8BCA, and that `mov si,0x8b4c` appeared nearby, and concluded the
 * BLOCK-BREAKING HAZARD was this debris array. It is not. The two addresses
 * differ by two bytes IN DIFFERENT SEGMENTS:
 *
 *     CS:0x8b4a  2E C6 06 56 8B C3   mov byte [cs:0x8b56],0xc3
 *                         ^^^^^ the "8b56" here is an IMMEDIATE inside that
 *                               instruction; CS:0x8b4c is its modrm byte,
 *                               mid-instruction, not an array at all
 *     CS:0x8b57  BE CC CF            mov si,0xcfcc   <- the walker's real base
 *
 * So the block-breaker is the ten-slot DS:0xcfcc system (see the CLAUDE.md
 * section), and DS:0x8b4c is this: a purely visual effect.
 *
 * This project's own rule — "resolve the segment FIRST; a DS offset read as
 * CS returns unrelated bytes" — is written into the document precisely for
 * this failure, and I made it anyway, in the same session.
 *
 * ── THE NEGATIVE PROOF ───────────────────────────────────────────────────
 * The whole per-record body CS:0x1F8C-0x1FD6 contains EXACTLY ONE call:
 * CS:0x1FC0 `call 0x356e`, the masked sprite blit. No CS:0xac59 (hero
 * damage), no CS:0xa860/0xa8b8 (damage-grid stamp), no 0x3004/0x5004 (plane
 * pointer). Debris cannot hurt anything and cannot touch the map.
 */

export const SLOTS = 20;              // CS:0x1F7E `mov cx,0x14`
export const STRIDE = 12;             // CS:0x1F86 `add si,0xc`
export const ARRAY_DS = 0x8b4c;
export const COUNT_DS = 0x33b;        // the live counter, the updater's fast-out

/* ── The record, 12 bytes ─────────────────────────────────────────────────
 *   +0x00  u16  alive flag — 0 alive, 0xFFFF free. Only ever those two.
 *   +0x02  i16  world X    — integrated and written back (CS:0x1FA3)
 *   +0x04  i16  world Y    — CS:0x1FA6
 *   +0x06  i16  X velocity — READ ONLY after spawn (CS:0x1F99 `add ax,[di]`)
 *   +0x08  i16  Y velocity — READ ONLY after spawn (CS:0x1F9E `add bx,[di]`)
 *   +0x0A  u16  sprite id AND lifetime, one word: seeded 0x3A, drawn raw,
 *               then incremented; freed at 0x45 (CS:0x1FC8, a SIGNED `jl`)
 *
 * ⚠️ NO GRAVITY, NO DRAG. The updater reads +0x06/+0x08 and never writes
 * them, so debris flies in a straight line at constant velocity for its whole
 * life. Every other particle system in this game accelerates; this one does
 * not, and adding the gravity "it obviously should have" is wrong.
 *
 * ⚠️ THE SPRITE IS THE LIFETIME. One word does both jobs, so the animation
 * cannot be changed without changing how long a chunk lives.
 */
export const SPRITE_FIRST = 0x3a;     // 58 — CS:0xA04B / 0xA66A / 0xA852
export const SPRITE_LAST = 0x44;      // 68 — the last drawn
export const EXPIRE_AT = 0x45;        // 69 — CS:0x1FC8 `cmp ...,0x45 / jl`

/** Frames drawn per chunk. The draw at CS:0x1FC0 PRECEDES the `inc` at
 *  CS:0x1FC5, so ids 0x3A..0x44 inclusive are all drawn — eleven passes. */
export const LIFETIME_TICKS = SPRITE_LAST - SPRITE_FIRST + 1;   // 11

/* ── Three producers, and they disagree about their INPUT, not their output ──
 *
 *   CS:0xA00D  the hunter mover's no-target arm (CS:0x9F0F). Reads a
 *              PROJECTILE record at DI whose x/y are already WORLD, and
 *              splits its `dir` word HIGH byte -> vx, LOW byte -> vy
 *              (CS:0xA039 / CS:0xA042) — a second routine independently
 *              agreeing with the hunter's reversed packing at CS:0x9F41.
 *   CS:0xA633  the general one. Takes SCREEN x/y in ax/bx and velocity in
 *              cx/dx, and adds the scroll itself (CS:0xA658).
 *   CS:0xA81A  the projectile terrain-stop path, reached only by falling out
 *              of CS:0xA810 — no `call` targets it. Takes SCREEN coords and
 *              sets BOTH velocities to ZERO (CS:0xA846 `xor cx,cx`): a
 *              stationary impact puff, not a spray.
 *
 * ⚠️ CORRECTION — "ELEVEN callers" for CS:0xA633 was WRONG, and it stood
 * uncorrected across two sessions. Traced fresh with Ghidra (`get_xrefs_to`
 * AND `search_instructions` on the exact operand, agreeing): there are
 * exactly FIVE direct near-CALLs to 0x1000:a633 in GAME.EXE —
 *
 *   CS:0x4561  FUN_1000_4501, the enemy-shot hero-hit puff (documented above
 *              at "The hero hit, CS:0x4501" in game/enemy-shots.js)
 *   CS:0xA7A1  the magic axe's own mover (CS:0xa678/0x9f38), on the tick its
 *              LIFETIME expires (`dec word [si+4] / js`) — it drops a MOVING
 *              spark carrying its own current velocity, not a stationary
 *              puff, and despawns. Unreached in this port: the magic axe is
 *              not one of the five spawnable weapons.
 *   CS:0xAC4C  inside the SHARED contact/damage routine CS:0xac59, on the
 *              branch where a hit lands and the target SURVIVES (reached via
 *              CS:0xab90/0xab96, the difficulty-scalar bracket CLAUDE.md
 *              documents at CS:0xab56-0xab98) — a "hit spark" at a jittered
 *              point in the target's own hitbox, using DS:0x1e6/0x1e8 (width/
 *              height) for the jitter range. Unreached in this port: `Health`
 *              /`attackHero()` treat every contact hit as an instant kill and
 *              don't yet model the scalar-adjusted survive-a-hit case.
 *   CS:0xDBBB  CS:0xDC2F  both inside a PREVIOUSLY UNDOCUMENTED 20-slot,
 *              22-byte pool at DS:0xd2be (free when `!=0xFFFF`; a per-record
 *              hero-hit-box test — CROUCH_STATES-gated, DAMAGE=2, same shape
 *              as CS:0x4501 — then its own debris puff, then a draw at sprite
 *              `0x4b + (DS:0x36c & 1)`, i.e. 75/76, keyed off the SAME
 *              every-other-frame toggle the world-2 nest's hatch animation
 *              reads). Reached from FUN_1000_b1c2 (CS:0xb236) and
 *              FUN_1000_dc37 (CS:0xdc2f direct, CS:0xdcc8 via a shared call).
 *              `UNKNOWN_d2be_pool` — an entire unported subsystem (a second
 *              shot-like hazard?), not a wiring gap. Not investigated past
 *              confirming its shape and both callers.
 *
 * ⚠️ ALL THREE (of the ORIGINAL three producer KINDS — A00D/A633/A81A) STORE
 * WORLD COORDINATES; only the caller's convention differs. Pinned by the
 * consumer, which subtracts the scroll before drawing (CS:0x1FA9 / CS:0x1FAD).
 * A port that stores screen coords has debris that slides with the camera.
 */
export const PRODUCERS = Object.freeze([
  { at: 0xa00d, input: 'world', vel: 'projectile dir word, hi->vx lo->vy', callers: 1 },
  { at: 0xa633, input: 'screen', vel: 'cx/dx', callers: 11 },
  { at: 0xa81a, input: 'screen', vel: 'ZERO', callers: 0, note: 'fall-through from CS:0xA810' },
]);

/* ── The updater, CS:0x1F73 ───────────────────────────────────────────────
 *     1F73  cmp byte [0x33b],0 / jnz / ret        ; fast-out when none live
 *     1F7B  si = 0x8b4c ; cx = 0x14
 *     1F81  cmp word [si],0 / jns body            ; alive = NON-NEGATIVE
 *     1F86  add si,0xc / loop
 *     1F8C  x += vx ; y += vy ; store back
 *     1FA9  screen = world - [0xa]/[0xc]
 *     1FC0  call 0x356e                           ; graphics export 2
 *     1FC5  inc word [si+0xa]
 *     1FC8  cmp word [si+0xa],0x45 / jl next
 *     1FCE  mov word [si],0xffff / dec byte [0x33b]
 *
 * ⚠️ BOTH the continue and the expiry path rejoin CS:0x1F86, so this is ONE
 * FULL 20-RECORD PASS, not a first-hit scan.
 *
 * ⚠️ EXPORT 2, NOT EXPORT 1. CS:0x356E is `mov bp,0x525a`, and
 * (0x525a - 0x5252) / 4 = 2. The alive-entity draw CS:0x3569 uses 0x5256 =
 * export 1 — five bytes away, different clip bounds. Debris draws through the
 * other blitter.
 *
 * ⚠️ THERE IS NO CULL. No off-screen test, no terrain test, no contact test.
 * A chunk lives exactly 11 ticks wherever it goes.
 */
export const DRAW_EXPORT = 2;         // CS:0x356E -> SS:0x525a

export class Debris {
  constructor() {
    this.slots = Array.from({ length: SLOTS },
                            () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, sprite: 0 }));
    this.count = 0;                    // DS:0x33b
    this.dropped = 0;                  // spawns refused by a full array
  }

  /** The three producers, unified: they differ only in what the CALLER passes,
   *  and every one of them stores world coordinates. */
  spawn(worldX, worldY, vx, vy) {
    const free = this.slots.find((s) => !s.alive);
    if (!free) { this.dropped++; return null; }
    free.alive = true;
    free.x = worldX; free.y = worldY;
    free.vx = vx; free.vy = vy;
    free.sprite = SPRITE_FIRST;        // CS:0xA04B — sprite AND lifetime
    this.count++;
    return free;
  }

  /** CS:0x1F73. One tick. Returns the chunks to draw, in screen space. */
  step(cam) {
    const drawn = [];
    if (this.count === 0) return drawn;              // CS:0x1F73 fast-out
    for (const s of this.slots) {
      if (!s.alive) continue;                        // CS:0x1F81 `jns`
      s.x += s.vx; s.y += s.vy;                      // CS:0x1F99 / 0x1F9E
      /* ⚠️ no `s.vy += 1` here, deliberately — see the note above. */
      drawn.push({ x: s.x - cam.x, y: s.y - cam.y, sprite: s.sprite });  // 0x1FA9
      s.sprite += 1;                                 // CS:0x1FC5
      if (s.sprite >= EXPIRE_AT) {                   // CS:0x1FC8
        s.alive = false;                             // CS:0x1FCE
        this.count--;                                // CS:0x1FD2
      }
    }
    return drawn;
  }

  /** CS:0x8E8E — level init. Note it does NOT touch DS:0x33b. */
  clear() {
    for (const s of this.slots) s.alive = false;
    return this;
  }

  get live() { return this.slots.reduce((n, s) => n + (s.alive ? 1 : 0), 0); }
}

/* ── UNKNOWN_debris_identity ──────────────────────────────────────────────
 * "Debris" is this port's label, not a finding. What the bytes prove is an
 * 11-frame, straight-line, non-interacting visual effect at sprite ids 58-68,
 * spawned by twelve call sites of which one is the projectile terrain-stop
 * path. Nothing names it.
 *
 * ── UNKNOWN_8b4c_indirect_write ──────────────────────────────────────────
 * "Velocity is read-only", "no dead fields" and the five-site census all rest
 * on scans for the immediate 0x8b4c. A register-indirect write — a pointer
 * parked and reused — is invisible to that, the same blind spot recorded for
 * the sparkle array's fields.
 */
export const UNKNOWN_debris_identity =
  'the name is a label; the bytes prove only an 11-frame inert visual effect';
