/* flash.js — DS:0xAC90, the materialise flash: 10 records of 6 bytes
 * {x, y, count}, count < 0 = free.
 *
 * Allocated by CS:0xB0DA (first free record, carry set when full) from two
 * places, each of which plays sfx 0x446 FIRST, whether or not a record is
 * free (and ADL draws a random number for that sound):
 *   CS:0xFF59  System A/B. On success the entity becomes MATERIALISING
 *              (`[di+8]=-3`, `[di+6]=5`). On failure nothing else happens.
 *   CS:0xB095  selector-2 turrets. On success the entity's stagger becomes
 *              -5 (`[di+6]=0xFFFB`), five more idle ticks before it acts.
 * Both copy the entity's x/y, set count = 7 and DS:0x1F6 = 1.
 *
 * CS:0xB0EF walks it once per tick (main loop CS:0x028E, after both entity
 * systems) while DS:0x1F6 is set: each live record draws sprite 0x64 + count
 * and counts down, and is freed when the count goes negative. So a flash
 * lives 8 ticks.
 */
export const SLOTS = 10;           // CS:0xB0D1 / 0xB0DD `mov cx,0xa`
export const COUNT_START = 7;      // CS:0xB0B2 / 0xFF78
export const SPRITE_BASE = 0x64;   // CS:0xB114 `add dx,0x64`

export class FlashPool {
  constructor() { this.reset(); }

  /** CS:0xB0C3 — every record free. */
  reset() {
    this.slots = Array.from({ length: SLOTS }, () => ({ x: 0, y: 0, count: -1 }));
    this.active = false;           // DS:0x1F6
  }

  /** CS:0xB0DA plus the copy. Returns false when the pool is full. */
  alloc(x, y) {
    const s = this.slots.find((r) => r.count < 0);
    if (!s) return false;
    s.x = x; s.y = y; s.count = COUNT_START;
    this.active = true;
    return true;
  }

  /** CS:0xB0EF. Returns the flashes to draw, in screen space. */
  step(cam) {
    const drawn = [];
    if (!this.active) return drawn;
    let live = 0;
    for (const s of this.slots) {
      if (s.count < 0) continue;
      live++;
      drawn.push({ x: s.x - cam.x, y: s.y - cam.y, sprite: SPRITE_BASE + s.count });
      if (--s.count < 0) { s.count = -1; live--; }
    }
    if (live === 0) this.active = false;        // CS:0xB13D
    return drawn;
  }
}
