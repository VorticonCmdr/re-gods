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
import { W1_SCRIPT } from './guardian-data.js';

export const POOL_SLOTS = 15;                 // CS:0xC508 `mov cx,0xf`
export const BODY_SPRITE = 0x1c2;             // CS:0xD8D7 `add cx,0x1c2` (+2*frame, and +1 for the right half)
export const SPIT_SPRITE = 0x15b;             // CS:0xDB07 `add cx,0x15b` (+frame 0..3)
export const BODY_BOX = { w: 0x30, h: 0x60 }; // CS:0xD907 / 0xD90D
export const SFX_STOMP = 0x1e39;              // CS:0xD8C5, frames 3, 9 and 10
export const SFX_SPIT = 0x4b41;               // CS:0xD9F9
export const SPIT_FRAME = 16;                 // CS:0xD8A6 / 0xD8AD `cmp cx,0x10`

const W1 = { hp: 1500, x: 0xf20, y: 0x230, script: W1_SCRIPT };   // CS:0xC4DD / 0xC4E9 / 0xC4EF

export class Guardian {
  constructor(world) {
    if (world !== 1) throw new Error(`guardian for world ${world} is not ported`);
    this.world = world;
    this.hp = W1.hp;                 // DS:0x28A
    this.script = W1.script;
    this.pool = Array.from({ length: POOL_SLOTS },
      () => ({ x: 0, y: 0, vy: 0, frame: -1, vx: 0 }));   // DS:0xD030: +0 +2 +4 +6 +8
    this.reset();
  }

  /** CS:0xC4E9 (entry tail, and the respawn re-entry [0x288]). */
  reset() {
    this.x = W1.x;                   // DS:0x28C
    this.y = W1.y;                   // DS:0x28E
    this.frame = 0;                  // DS:0x290
    this.step = 0;                   // DS:0x292, as an index into `script`
    for (const s of this.pool) s.frame = -1;               // CS:0xC505
  }

  get dead() { return this.hp < 0; }

  /** CS:0xD866, the world-1 driver. `tock` is DS:0x36C. Returns the sprites
   *  to draw (screen space). */
  drive({ tock, cam, hero, health, grid, decodeTag, difficulty = 0, rng, debris, sfx, invuln, targets }) {
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
