/* guardian.js — the per-world guardians, installed by trigger selector 11.
 *
 * CS:0xC49C (selector 11) consumes its event, then:
 *     C4A0  [0x375] = 0xFF
 *     C4A5  [0x34]  = 1            ; the guardian mode the main loop gates on
 *     C4AA  cs:[0xAD88] = 0xC3     ; the selector-2 walker becomes a bare RET
 *     C4B0  call 0xC505            ; free the 15 x 10-byte pool DS:0xD030
 *     C4B3  jmp [SS:0x537A + (world-1)*2]
 * World 1's entry, CS:0xC4C6:
 *     [0x284] = 0xD866   the per-tick driver (main loop CS:0x02A5)
 *     [0x288] = 0xC4E9   the respawn re-entry (re-runs the tail below)
 *     cs:[0xDA62] = 0x90 enables the spit mover CS:0xDA63 (main loop CS:0x02AE)
 *     [0x28A] = 1500     health
 *     [0x286] = 0xC4C5   a bare RET (the CS:0x01EC hook)
 *     C4E9: [0x28C]=0xF20 x, [0x28E]=0x230 y, [0x290]=0 frame,
 *           [0x292]=SS:0x53C2 the script (guardian-data.js), pool freed again.
 *
 * With [0x34] set, FUN_1000_006F skips the object pass (CS:0x01FC, worlds
 * other than 2), the rock pools and kill smoke (CS:0x0226) and the whole
 * enemy suite (CS:0x0272), and runs [0x284], then the world gates
 * CS:0xD211 / 0xDA62 / 0xD557 instead. main.js owns those gates.
 *
 * Only world 1 is ported. [PROVEN] structure from the live code segment
 * (DOSBox 877:0000), checked against the PJOYG1 capture: d34=1 at cursor 44,
 * the first spit-split random draw at cursor 122 returning into CS:0xDAE5.
 */
import { attackHero, creatureScansGrid, db4eHit, KILL_SFX } from './combat.js';
import { W1_SCRIPT, W3_SCRIPT, W2_SCRIPT, W2_JAW, W2_CLAW_POS, W2_CLAW_NEG,
         W2_CLAW_OFF } from './guardian-data.js';

export const POOL_SLOTS = 15;                 // CS:0xC508 `mov cx,0xf`
export const BODY_SPRITE = 0x1c2;             // CS:0xD8D7 `add cx,0x1c2` (+2*frame, and +1 for the right half)
export const SPIT_SPRITE = 0x15b;             // CS:0xDB07 `add cx,0x15b` (+frame 0..3)
export const BODY_BOX = { w: 0x30, h: 0x60 }; // CS:0xD907 / 0xD90D
export const SFX_STOMP = 0x1e39;              // CS:0xD8C5, frames 3, 9 and 10
export const SFX_SPIT = 0x4b41;               // CS:0xD9F9
export const SPIT_FRAME = 16;                 // CS:0xD8A6 / 0xD8AD `cmp cx,0x10`

const W1 = { hp: 1500, x: 0xf20, y: 0x230, script: W1_SCRIPT };   // CS:0xC4DD / 0xC4E9 / 0xC4EF
const W3 = { hp: 0x8ca, x: 0x2c0, y: 0x70, script: W3_SCRIPT };   // CS:0xC527 / 0xC533 / 0xC539

/* ── World 3 (entry CS:0xC516, driver CS:0xD53B) [PROVEN] structure, read
 * from the live code segment; see Gods/docs/guardians.md. The script is
 * 3-byte records (frame, signed dx, signed dy) interpreted by CS:0xD778: one
 * frame record per tick; 0xFD lifts the hero 16 px and nudges the camera;
 * any other command byte (0xFE) rewinds 0x5D bytes unless the guardian is
 * right of the hero. Its projectiles live in the same DS:0xD030 pool but are
 * moved by the driver itself (CS:0xD609), not by a gate. */
export const W3_SHOT_SPRITE = 0x1d7;          // CS:0xD653 `add bp,0x1d7`
export const W3_BODY_BOX = { w: 0x28, h: 0x58 };   // CS:0xD5CA / 0xD5D0
export const W3_SFX_FRAME = 0x2839;           // CS:0xD7D0, entering frame 0 / 8 / 0x19
export const W3_SFX_LIFT = 0x4b39;            // CS:0xD7F2
export const W3_SFX_SHOT = 0x0b26;            // CS:0xD725 (DS:0x85 != 2; it reads 1 live)
const s8 = (b) => (b & 0x80 ? b - 0x100 : b);
const s16 = (v) => ((v & 0xffff) ^ 0x8000) - 0x8000;

/* ── World 2 (entry CS:0xC54C, respawn CS:0xC57B, driver CS:0xCD7B, gate
 * CS:0xD212) [STATIC], read from the live code segment; see
 * Gods/docs/guardians.md. A head on a three-ball neck that follows a script,
 * a jaw, and an arm swung along a cubic Bezier (BEZIER.DAT, 10 samples) whose
 * claw fires zaps into the shared line-hazard pool (DS:0xD2BE). The body
 * moves toward a random point near the hero once the scripted camera
 * (DS:0x32) has arrived. Two healths: arm DS:0x2D4 and body DS:0x2D6. */
export const W2_ARM_HP = 2000;                // CS:0xC55D
export const W2_BODY_HP = 2400;               // CS:0xC563
export const W2_CAM_TARGET = { x: 0xa0, y: 0x354 };   // CS:0xCD7B / 0xCD81
export const W2_SFX_JAW = 0x0b26;             // CS:0xD0F5 region, every 4th jaw step
export const W2_SFX_FIRE = 0x3c29;            // CS:0xD1C9, the second fireball of a burst
export const W2_FIREBALL_SLOTS = 8;           // CS:0xD1D3 / 0xD215
/* SS:0x4870/0x4872, REC6's x,y (the claw's arm-health box). No writer was
 * found (spec §3.8); the static image is 0, so the box is the screen's
 * top-left corner. UNKNOWN_w2_rec6_xy until read live. */
export const W2_REC6_XY = [0, 0];

/* DS:0x2F0 — the world-2 jaw counter. Its only writers are the jaw step
 * (CS:0xD0F5/0xD0F9) and world 4's CBCB; no entry, respawn or level init
 * touches it, so it lives for the whole process and each fight starts where
 * the last one left it (static image: 0). [PROVEN] live: three PJOYG2 attract
 * cycles started from different jaw phases (Gods/docs/guardians.md). */
let processJaw = 0;
export const resetProcessJaw = () => { processJaw = 0; };

/** BEZIER.DAT as CS:0xD489 leaves it: each word byte-swapped and `shr 1`. */
export function convertBezier(raw) {
  const out = new Int32Array(raw.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = ((raw[2 * i] << 8) | raw[2 * i + 1]) >>> 1;
  return out;
}

export class Guardian {
  constructor(world, tables = null) {
    if (world < 1 || world > 3) throw new Error(`guardian for world ${world} is not ported`);
    this.world = world;
    if (world === 2) {
      if (!tables || !tables.sincos || !tables.bezier) throw new Error('world 2 needs SINCOS/BEZIER');
      this.sincos = tables.sincos;                 // SS:0x40B0, big-endian
      this.bezier = tables.bezier;                 // SS:0x48E0 after CS:0xD489
      this.armHp = W2_ARM_HP;                      // DS:0x2D4
      this.bodyHp = W2_BODY_HP;                    // DS:0x2D6
      this.hp = W2_ARM_HP + W2_BODY_HP;            // DS:0x28A
      this.jaw = processJaw;                       // DS:0x2F0 — never initialised: carried over
      this.pool = Array.from({ length: POOL_SLOTS }, () => ({ x: 0, y: 0, t: 0, live: -1 }));
      this.armPts = Array.from({ length: 10 }, () => ({ x: 0, y: 0 }));   // SS:0x4890
      this.tip = { x: 0, y: 0 };                   // DS:0x116/0x118
      this.reset();
      return;
    }
    const cfg = world === 1 ? W1 : W3;
    this.cfg = cfg;
    this.hp = cfg.hp;                // DS:0x28A
    this.script = cfg.script;
    this.pool = Array.from({ length: POOL_SLOTS },
      () => ({ x: 0, y: 0, vy: 0, frame: -1, vx: 0 }));   // DS:0xD030: +0 +2 +4 +6 +8
    this.reset();
  }

  /** World 1: CS:0xC4E9 (entry tail and respawn re-entry [0x288]), which also
   *  frees the pool. World 3: CS:0xC533, which does NOT: a respawn restarts
   *  the script but keeps the health and the shots in flight. */
  reset() {
    if (this.world === 2) { this.#reset2(); return; }
    this.x = this.cfg.x;             // DS:0x28C
    this.y = this.cfg.y;             // DS:0x28E
    this.frame = 0;                  // DS:0x290
    this.step = 0;                   // DS:0x292, as an index (world 1) or a byte offset (world 3)
    if (this.world === 1) for (const s of this.pool) s.frame = -1;   // CS:0xC505
  }

  get dead() { return this.hp < 0; }

  drive(opts) {
    if (this.world === 2) return this.drive2(opts);
    return this.world === 1 ? this.drive1(opts) : this.drive3(opts);
  }

  /** CS:0xC57B, the world-2 entry tail and respawn re-entry. Healths, the
   *  jaw counter and the camera mode survive it. */
  #reset2() {
    this.x = 0x280; this.y = 0x370;                // DS:0x28C / 0x28E
    this.hx = -28; this.hy = -30;                  // DS:0x2D8 / 0x2DA, the head offset
    this.cursor = 0;                               // DS:0x2DC, as a record index
    this.burst = -1;                               // DS:0x2DE
    this.ang = [0x100, 0x130, 0x150];              // DS:0x2E0 / 0x2E2 / 0x2E4
    this.spd = [0x18, 0x18, 0x18];                 // DS:0x2E6 / 0x2E8 / 0x2EA
    this.tx = 0x280; this.ty = 0x370;              // DS:0x2CE / 0x2D0
    for (const f of this.pool) f.live = -1;        // CS:0xC505
    this.phase = 0;                                // DS:0xD092
  }

  /** SINCOS.DAT word at byte offset o (CS:0xD3AA `xchg al,ah`). */
  #S(o) { return s16((this.sincos[o] << 8) | this.sincos[o + 1]); }

  /** Graphics export 37 (VGA.EXE:0x00B6): the Bezier sample `i` of P0..P3. */
  #bezier(P, i) {
    const B = this.bezier;
    let x = 0, y = 0;
    for (let k = 0; k < 4; k++) {
      const c = B[k * 200 + i];
      x += (c * P[k][0]) >> 15;                    // `imul`, bits 15..30
      y += (c * P[k][1]) >> 15;
    }
    return { x: s16(x), y: s16(y) };
  }

  /** CS:0xA9E4 as the world-2 hit test uses it (world top-left, strength bp).
   *  A part already dead still contact-damages; ABC0 then sounds and returns. */
  #a9e4(x, y, w, h, bp, o) {
    attackHero({ x, y, w, h, strength: bp }, o.hero, o.health,
               { reportGate: 1, invuln: o.invuln, sfx: o.sfx });
    if (bp < 0) { o.sfx(KILL_SFX); return bp; }    // A9EA `jns` / A9EC -> ABC0
    if (!o.decodeTag) return bp;
    const proxy = { x, y, state: bp };
    creatureScansGrid(proxy, o.grid, o.cam, (tag) => o.decodeTag(tag, 1), o.difficulty || 0,
                      { w, h }, o.targets || null, { rng: o.rng, debris: o.debris, sfx: o.sfx });
    return proxy.state;
  }

  /** CS:0xCD7B, the world-2 driver: CE87 move, CF52 draw/arm/claw, CD9D hits.
   *  `camScript` is DS:0x32 with its target, shared with the camera step;
   *  `tock` is DS:0x36C, `tock36d` DS:0x36D; `zap(x, y, tx, ty)` is CS:0xDBC6;
   *  `markers` is DS:0xB5DC with its count. */
  drive2(o) {
    const { cam, hero, rng, sfx, camScript } = o;
    const drawn = [];
    camScript.tx = W2_CAM_TARGET.x; camScript.ty = W2_CAM_TARGET.y;   // CD7B / CD81
    if (camScript.mode === 0) camScript.mode = 1;  // CD87
    /* ── CE87: move toward the target. */
    const retarget = () => {
      if (camScript.mode <= 2) return false;       // CE91 `jg`
      let cx = hero.x, dx = hero.y;
      const mk = o.markers;
      if (mk && mk.count) {                        // CEA3, DS:0x398
        const n = Math.min(mk.count, 0x14);
        let found = false;
        for (let k = 0; k < n && k < mk.entries.length; k++) {
          const m = mk.entries[k];
          cx = m.x + cam.x; dx = m.y + cam.y - 0x30;
          if (m.type === 0x6d) { found = true; break; }
        }
        if (!found) { cx = hero.x; dx = hero.y; }
      }
      let bx = cx;
      cx += 0x70; dx -= 0x3c; bx -= 0x80;
      if (bx >= 0) { bx >>= 2; dx += bx; bx >>= 1; cx -= bx; }   // CEEA `js`
      cx += (rng() & 0x1f) - 0x10;                 // CEF6
      dx += (rng() & 0x1f) - 0x10;                 // CF01
      this.tx = s16(cx); this.ty = s16(dx);
      return true;
    };
    let move = this.burst < 0;
    if (!move) retarget();                         // CE87 `jns 0xce91`, CF14 returns
    while (move) {
      if (this.tx === this.x && this.ty === this.y) {   // CF32
        if (!retarget()) break;
        continue;                                  // CF14: [0x2DE] < 0, so move
      }
      let ax = (this.x - this.tx) >> 2;
      const by = (this.y - this.ty) >> 2;
      if (ax > 12) ax = 12;                        // CF41
      this.x -= ax; this.y -= by;
      break;
    }
    /* ── CF52: the script step, read every tick at the cursor. */
    let hx = this.x - cam.x + this.hx, hy = this.y - cam.y + this.hy;
    if (o.tock36d === 0) {
      let r = this.cursor + 1;
      if (r >= W2_SCRIPT.length) r = 0;            // the 0xFF frame byte
      this.cursor = r;
      const [ddx, ddy] = W2_SCRIPT[r];
      hx += ddx; this.hx += ddx; hy += ddy; this.hy += ddy;
    }
    const frame = W2_SCRIPT[this.cursor][2];
    if (frame === 2) this.#spawnFireball(sfx);     // CFB3 -> D1BA
    else this.burst = -1;                          // CFBA
    const recs = [];                               // SS:0x4840, screen {x,y,w,h}
    recs.push([hx, hy, 0x20, 0x20]);               // REC0 head
    const bsx = this.x - cam.x, bsy = this.y - cam.y;
    const A = [bsx + 0x1e + this.hx, bsy + 5 + this.hy];
    const B = [bsx + 0x10, bsy - 0x0b];
    const M = [B[0] - ((B[0] - A[0]) >> 1) + 1, B[1] - ((B[1] - A[1]) >> 1)];
    for (const p of [B, M, A]) {                   // REC1..3, the neck
      recs.push([p[0], p[1], 0x10, 0x10]);
      drawn.push({ x: p[0], y: p[1], sprite: 0x1c4 });
    }
    drawn.push({ x: hx, y: hy, sprite: 0x1c9 + frame });
    /* ── D0D9: the jaw. */
    const jx = bsx + 0x24;
    let jy = bsy - 0x1a;
    if (o.tock36d === 0) {
      this.jaw = (this.jaw + 1) & 3;
      processJaw = this.jaw;
      if (this.jaw === 0) sfx(W2_SFX_JAW);         // DS:0x85 != 2 (it reads 1 live)
    }
    const [jadd, jdy] = W2_JAW[this.jaw];
    jy += jdy;
    recs.push([jx, jy, 0x10, 0x10]);               // REC4
    drawn.push({ x: jx, y: jy, sprite: 0x1c2 + jadd });
    /* ── D152: P0 and the control points from the angles, then advance them. */
    const P0 = [this.x + 0x3c, this.y + 0x1f];     // DS:0x106 / 0x108
    const S = (o2) => this.#S(o2);
    let ax = S(this.ang[0]) >> 10, dy = s16(-S(this.ang[0] + 0x100)) >> 10;
    const P3 = [ax + (ax >> 1) + P0[0], dy + (dy >> 1) + P0[1]];
    const P1 = [(S(this.ang[1]) >> 11) + P0[0], (s16(-S(this.ang[1] + 0x100)) >> 11) + P0[1]];
    const P2 = [(S(this.ang[2]) >> 10) + P0[0], (s16(-S(this.ang[2] + 0x100)) >> 10) + P0[1]];
    for (let k = 0; k < 3; k++) {                  // D434-D485
      const n = this.ang[k] + this.spd[k];
      if (n <= 0x100) this.spd[k] = -this.spd[k];
      if (n >= 0x258) this.spd[k] = -this.spd[k];
      this.ang[k] = n;
    }
    /* ── D49C: the arm, 10 Bezier samples (t = 0 .. 0.9). */
    if (this.armHp >= -1) {
      const P = [P0, P1, P2, P3];
      for (let i = 0; i < 10; i++) {
        this.tip = this.#bezier(P, i * 20);
        const sx = this.tip.x - cam.x, sy = this.tip.y - cam.y;
        if (this.armHp >= 0) {
          this.armPts[i] = { x: sx, y: sy };
          drawn.push({ x: sx, y: sy, sprite: 0x1c5 });
        } else {                                   // D509: the arm's death tick
          const vx = sx - this.armPts[i].x, vy = sy - this.armPts[i].y;
          if (o.debris) o.debris.spawn(sx - 4 + cam.x, sy + cam.y, vx, vy);
          drawn.push({ x: sx - 4, y: sy, sprite: 0x1c5 });
        }
      }
      if (this.armHp < 0) this.armHp = -2;         // D4FB
    }
    /* ── D2DE: the claw, and its zap. */
    if (this.armHp > -2) {
      let a = this.ang[0] - 0x100;
      if (a < 0) a = 0;
      const idx = (a / 0x18) | 0;                  // D2F3 `div`
      const table = this.spd[0] < 0 ? W2_CLAW_NEG : W2_CLAW_POS;
      const cf = s8(table[idx]);
      if (cf === 1 && o.tock) {                    // D307 / D30C
        const jyv = (rng() & 7) - 3;               // D31F
        const jxv = (rng() & 0xf) - 8;             // D32C
        /* D340: DS:word[si] — the table BASE (0 for DC8C), not [si+idx]. */
        if (o.zap) o.zap(this.tip.x, this.tip.y, hero.x + jxv + 8, hero.y - jyv + 6);
      }
      const [ox, oy] = W2_CLAW_OFF[cf];
      const cx = this.tip.x + ox - cam.x, cy = this.tip.y + oy - cam.y;
      drawn.push({ x: cx, y: cy, sprite: 0x1e4 + cf });
    }
    /* ── D171: the body. */
    recs.push([bsx, bsy, 0x40, 0x40]);             // REC5
    drawn.push({ x: bsx, y: bsy, sprite: 0x1c2 });
    drawn.push({ x: bsx + 0x20, y: bsy, sprite: 0x1c3 });
    this.lastRecs = recs;
    /* ── CD9D: hit tests (the pre-player camera) and the health rule. */
    for (const [x, y, w, h] of recs) this.bodyHp = this.#a9e4(x + cam.x, y + cam.y, w, h, this.bodyHp, o);
    if (this.armHp >= 0) {                         // CDDC
      this.armHp = this.#a9e4(W2_REC6_XY[0] + cam.x, W2_REC6_XY[1] + cam.y, 0x10, 0x10, this.armHp, o);
      for (const p of this.armPts) this.armHp = this.#a9e4(p.x + cam.x, p.y + cam.y, 8, 8, this.armHp, o);
    }
    const arm = this.armHp;                        // CE4D
    this.hp = Math.max(0, arm) + this.bodyHp;
    /* CE78 — the death (CS:0xD923) is not ported yet. */
    if (this.hp >= 0 && arm >= 0 && arm >= this.bodyHp) {
      const half = arm >> 1;
      this.armHp -= half; this.bodyHp += half;
    }
    return drawn;
  }

  /** CS:0xD1BA — one fireball, on every tick whose script frame is 2. */
  #spawnFireball(sfx) {
    if (this.burst === 7) return;
    if (this.burst === 0) sfx(W2_SFX_FIRE);
    const f = this.pool.slice(0, W2_FIREBALL_SLOTS).find((q) => q.live < 0);
    if (!f) return;                                // D1E1, no increment
    f.x = this.x + this.hx + 6;
    f.y = this.y + this.hy + 0x10;
    f.t = 7; f.live = 0;
    this.burst++;
  }

  /** CS:0xD212, the world-2 gate: move, draw and hero-test the fireballs. */
  moveFireballs({ cam, hero, health, rng, debris, invuln, tock36d }) {
    const drawn = [];
    const p0 = this.phase;
    let ph = p0;
    for (let i = 0; i < W2_FIREBALL_SLOTS; i++) {
      const f = this.pool[i];
      if (f.live >= 0) {
        f.x -= 7; f.y += 5;                        // D225 / D228
        const sx = f.x - cam.x, sy = f.y - cam.y;
        if (sy >= 0xb0) {                          // D23C `jl`
          const vx = -6 - (rng() & 3);             // D247
          const vy = rng() & 3;                    // D24F
          if (debris) debris.spawn(f.x, f.y, vx, vy);   // CS:0xA633
          f.live = -1;
        } else {
          drawn.push({ x: sx, y: sy, sprite: 0x1cc + 3 * f.t + ph });
          if (db4eHit(f.x + 10, f.y + 8, hero, health, { invuln }).hit) {   // CS:0xDB4E
            f.live = -1;
            if (debris) debris.spawn(f.x + 2, f.y + 2, 0, 0);
          }
          if (tock36d === 0) { f.t--; if (f.t < 0) f.t = 0; }   // D29D
        }
      }
      ph = ph + 1 >= 3 ? 0 : ph + 1;               // D2B1, for every record
    }
    this.phase = p0 + 1 >= 3 ? 0 : p0 + 1;         // D2C8-D2D7
    return drawn;
  }

  /** CS:0xD53B, the world-3 driver: D778 script, D609 shots, D6DE fire,
   *  D83F draw, D5C0 hit box — in that order, which is the random-draw order.
   *  `opts.lift()` applies the 0xFD command's hero and camera effects. */
  drive3({ tock, cam, hero, health, grid, decodeTag, difficulty = 0, rng, debris, sfx, invuln, targets, lift }) {
    const drawn = [];
    if (this.hp < 0) return drawn;                          // D778 `jns` (unreachable, see the spec)
    /* ── D778: the script step. */
    const x0 = this.x;                                      // D782 ax
    const prev = this.frame;                                // D789 cx
    const fireArmed = !(prev === 0x1d || prev === 0x27);    // D78D-D79D -> [0x2CE]
    const S = this.script;
    let p = this.step, cx;
    for (;;) {
      const cl = S[p], dl = s8(S[p + 1]), dh = s8(S[p + 2]);
      p += 3;                                               // D7B0
      cx = s8(cl);
      if (this.frame !== cx && (cx === 0 || cx === 0x19 || cx === 8)) sfx(W3_SFX_FRAME);   // D7BA-D7D3
      if (cx >= 0) {                                        // D7D7 `jg` -> FRAME
        this.y += dh;                                       // D809-D80E, not clamped
        let x = x0 + dl;                                    // D812
        if (x <= 0x60) x = 0x60;                            // D81A
        if (x > 0x2c0) x = 0x2c0;                           // D822
        this.x = x;
        if (S[p] === 0xff) p = 0;                           // D82D, wrap to SS:0x5468
        this.frame = cx;                                    // D836
        this.step = p;                                      // D83A
        break;
      }
      if (cl === 0xfd) {                                    // D7DC: lift / thump
        if (lift) lift();                                   // [0x2D2]=8, [0x270]-=8, [0x17C]-=16
        sfx(W3_SFX_LIFT);                                   // D7F2
        continue;
      }
      if (x0 > hero.x) continue;                            // D7FB `jg`, signed, tick-start x
      p -= 0x5d;                                            // D801
    }
    /* ── D609: move, draw and hero-test the shots (before this tick's fire). */
    for (const s of this.pool) {
      if (s.frame < 0) continue;                            // D60F
      const x = s.x + s.vx, y = s.y + s.vy;                 // D618-D620
      const f0 = s.frame;                                   // D623, the drawn frame
      s.x = x; s.y = y;
      s.vy++;                                               // D62B
      if (tock === 0) s.frame = (s.frame + 1) & 3;          // D62E-D638
      const sx = x - cam.x, sy = y - cam.y;
      if (sy >= 0xc0) { s.frame = -1; continue; }           // D644, the only cull
      drawn.push({ x: sx, y: sy, sprite: W3_SHOT_SPRITE + f0 });   // D653-D662
      /* D667-D679: CS:0xDB4E at screen (sx+0xC, sy+0xC) -> world (x+0x12, y+0x10). */
      if (db4eHit(x + 0x12, y + 0x10, hero, health, { invuln }).hit) {
        s.frame = -1;                                       // [bp] = &+6
        if (debris) debris.spawn(x + 0x10, y + 0x10, 0, 0); // DB4E's own spark (cosmetic)
        health.damage(2);                                   // D684, on top of DB4E's 2
        for (let k = 0; k < 2; k++) {                       // D68B / D695 -> D6AC
          const jy = sy + (rng() & 0xf) - 8;                // D6AD
          const vx = (rng() & 7) - 4;                       // D6B8
          const vy = (rng() & 7) - 4;                       // D6C3
          const jx = (rng() & 0xf) - 8 + sx;                // D6CE
          if (debris) debris.spawn(jx + cam.x, jy + cam.y, vx, vy);   // CS:0xA633 (screen in, +camera)
        }
      }
    }
    /* ── D6DE: fire on the tick the frame BECOMES 0x1D (left) or 0x27 (right). */
    if (fireArmed && (cx === 0x1d || cx === 0x27)) {
      const s = this.pool.find((q) => q.frame < 0);         // D765 (it scans 16; see the spec)
      if (s) {
        const left = cx === 0x1d;
        s.x = this.x + (left ? 3 : 0x1d);                   // D6FE / D744
        s.y = this.y + 0x13;
        s.vx = left ? -8 : 8;
        s.frame = 2;                                        // D70E
        s.vy = (rng() & 2) - 1;                             // D713 / D759
        sfx(W3_SFX_SHOT);                                   // D725
      }
    }
    /* ── D83F: draw, the frame NOT doubled (world 1 doubles it). */
    const bx = this.x - cam.x, by = this.y - cam.y;
    drawn.push({ x: bx, y: by, sprite: BODY_SPRITE + cx });
    drawn.push({ x: bx + 0x20, y: by, sprite: BODY_SPRITE + cx + 1 });
    /* ── D5C0: CS:0xA9E4 at (x+0xC, y), 0x28 x 0x58, strength = health. */
    const ax = this.x + 0xc;
    const r = attackHero({ x: ax, y: this.y, ...W3_BODY_BOX, strength: this.hp },
                          hero, health, { reportGate: 1, invuln, sfx });
    this.hp = r.strengthOut;
    if (this.hp >= 0 && decodeTag) {
      const proxy = { x: ax, y: this.y, state: this.hp };
      creatureScansGrid(proxy, grid, cam, (tag) => decodeTag(tag, 1), difficulty, W3_BODY_BOX,
                        targets || null, { rng, debris, sfx });
      this.hp = proxy.state;
    }
    /* D5E3 `jns` — the death (CS:0xD923, the corpse gate D557) is not ported yet. */
    return drawn;
  }

  /** CS:0xD866, the world-1 driver. `tock` is DS:0x36C. Returns the sprites
   *  to draw (screen space). */
  drive1({ tock, cam, hero, health, grid, decodeTag, difficulty = 0, rng, debris, sfx, invuln, targets }) {
    const drawn = [];
    if (this.hp < 0) return drawn;                          // D866 `jns` / D86D -> ret
    let cx = this.frame;                                    // D87A
    if (tock === 0) {                                       // D87E
      const [f, dx] = this.script[this.step];               // D889 / D88D
      cx = f;
      this.x += dx;                                         // D891-D896
      this.step++;                                          // two `inc si`
      if (this.step >= this.script.length) this.step = 0;   // D899 `js` -> D89F reload 0x53C2
      /* D8A6: a script tick that lands on frame 16 skips the spit call. */
    } else if (cx === SPIT_FRAME) {
      this.#spawnSpit(sfx);                                 // D8B2 -> D9F8, the tick AFTER frame 16
    }
    if (cx === 3 || cx === 10 || cx === 9) sfx(SFX_STOMP);  // D8B5-D8C8
    this.frame = cx;                                        // D8D1
    const sx = this.x - cam.x, sy = this.y - cam.y;         // D8DF-D8EA
    drawn.push({ x: sx, y: sy, sprite: BODY_SPRITE + 2 * cx });            // D8EE
    drawn.push({ x: sx + 0x20, y: sy, sprite: BODY_SPRITE + 2 * cx + 1 }); // D8F1-D8FA
    /* D8FD-D91A — CS:0xA9E4 with ax = x+16, bx = y, a 0x30 x 0x60 box and
     * bp = health. With [0x34] set the contact is never reported
     * (reportGate), so the grid scan always follows it. */
    const ax = this.x + 0x10;
    const r = attackHero({ x: ax, y: this.y, ...BODY_BOX, strength: this.hp },
                          hero, health, { reportGate: 1, invuln, sfx });
    this.hp = r.strengthOut;
    if (this.hp >= 0 && decodeTag) {
      const proxy = { x: ax, y: this.y, state: this.hp };
      creatureScansGrid(proxy, grid, cam, (tag) => decodeTag(tag, 1), difficulty, BODY_BOX,
                        targets || null, { rng, debris, sfx });
      this.hp = proxy.state;                                // D91A
    }
    /* D91E `js 0xD923` — the death sequence is not ported yet. */
    return drawn;
  }

  /** CS:0xD9F8 — one spit into the first free pool record. */
  #spawnSpit(sfx) {
    sfx(SFX_SPIT);                                          // D9F9, before the search
    const s = this.pool.find((p) => p.frame < 0);           // DA07 `js`
    if (!s) return;
    s.x = this.x;                                           // DA14
    s.y = this.y + 0x16;                                    // DA1A-DA21
    s.vy = 8;                                               // DA24
    s.frame = 0;                                            // DA29
    s.vx = -6;                                              // DA2E
  }

  /** CS:0xDA63 — the spit mover (behind the CS:0xDA62 gate). */
  moveSpits({ tock, cam, planeB, hero, health, rng, debris, invuln }) {
    const drawn = [];
    if (this.world === 2) return this.moveFireballs(arguments[0]);   // CS:0xD211, world 2's gate
    if (this.world !== 1) return drawn;                     // the DA62 gate is world 1's alone
    for (const s of this.pool) {
      if (s.frame < 0) continue;                            // DA6A `jns`
      let nx = s.x + s.vx, ny = s.y + s.vy;                 // DA73-DA7B
      s.vy++;                                               // DA7E
      if (s.vy >= 0) {                                      // DA81 `js 0xDAF1` — only while falling
        const cell = (nx >> 5) + (ny & 0xfff0) * 8;         // DA87-DAA3, plane B at DS:0x5004
        if (planeB[cell] === 1) {                           // DAA5 — inside solid: burst
          if (debris) debris.spawn(nx, ny, s.vy, s.vx);     // DAB0-DABE -> CS:0xA633 (cx=+4, dx=+8)
          s.frame = -1;                                     // DAC5 -> DB47
          continue;
        }
        if (planeB[cell + 0x80] === 1) {                    // DAC8 — solid below: bounce and split
          s.vy = -11;                                       // DAD0
          const c = this.pool.find((p) => p.frame < 0);     // DAD5 -> CS:0xDA35
          if (c) {
            c.x = nx; c.y = ny; c.vy = s.vy;                // DA4A-DA52
            c.frame = 0;                                    // DA5A
            const r = rng();                                // DAE2
            c.vx = s.vx - 1 + (r & 1);                      // DADD-DAEE
          }
        }
      }
      s.x = nx; s.y = ny;                                   // DAF1
      if (tock === 0) s.frame = (s.frame + 1) & 3;          // DAF6-DB00
      const sx = nx - cam.x;                                // DB0B
      if (sx <= -0x10 || sx > 0x168) { s.frame = -1; continue; }   // DB0F / DB14 -> DB47
      const sy = ny - cam.y;
      const sprite = SPIT_SPRITE + s.frame;                 // DB04-DB07, before the hit test
      /* DB2A-DB33 — CS:0xDB4E at screen (sx+4, sy+4): hot point (x+10, y+8).
       * A hit costs the hero a flat 2, frees the record ([bp] = &+6) and
       * drops a stationary spark (cosmetic; its offset is approximate). */
      if (db4eHit(nx + 10, ny + 8, hero, health, { invuln }).hit) {
        s.frame = -1;
        if (debris) debris.spawn(nx + 8, ny + 6, 0, 0);
      }
      drawn.push({ x: sx, y: sy, sprite });                 // DB36 — drawn on the hit tick too
    }
    return drawn;
  }
}
