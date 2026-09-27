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
import { attackHero, creatureScansGrid, db4eHit } from './combat.js';
import { W1_SCRIPT, W3_SCRIPT } from './guardian-data.js';

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

export class Guardian {
  constructor(world) {
    if (world !== 1 && world !== 3) throw new Error(`guardian for world ${world} is not ported`);
    this.world = world;
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
    this.x = this.cfg.x;             // DS:0x28C
    this.y = this.cfg.y;             // DS:0x28E
    this.frame = 0;                  // DS:0x290
    this.step = 0;                   // DS:0x292, as an index (world 1) or a byte offset (world 3)
    if (this.world === 1) for (const s of this.pool) s.frame = -1;   // CS:0xC505
  }

  get dead() { return this.hp < 0; }

  drive(opts) { return this.world === 1 ? this.drive1(opts) : this.drive3(opts); }

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
