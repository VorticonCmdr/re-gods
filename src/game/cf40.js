/* cf40.js — the DS:0xCF40 creature: a dormant thing that wakes at random,
 * rises, then flies at the hero. [STATIC] structure read from the live code
 * segment (DOSBox 877:0000), [PROVEN] reachable and drawing randoms live:
 * PJOYL3 cursors 899-901, three CS:0x3836 draws returning into CS:0x8527.
 *
 * ── WHERE IT COMES FROM ──────────────────────────────────────────────────
 * The object walk's category-4 arm (CS:0x1B5B) keys on the runtime
 * descriptor's sprite: 0x11F / 0x12C / 0xDC are handled there, and
 * everything else falls to CS:0x1C77: sprite 0x10A spawns the ce64 creature
 * (CS:0x7F0D), 0x11D a nest (CS:0x8611), and ANY OTHER category-4 sprite
 * this one (CS:0x1CCC `call 0x8306`, the object freed only on success). In
 * the shipped maps that is object type 97 (world 3: 26 in 3A, 9 in 3B) and
 * type 130 (world 4: 9 in 4A, 8 in 4B).
 *
 * ── THE POOL, CS:0x8306 / 0x835C ─────────────────────────────────────────
 * 10 records of 14 bytes at DS:0xCF40:
 *   +0 x  +2 y (world)  +4 hp (negative = free; 0x19 at spawn)
 *   +6 state: <0 dormant, 0x2345 rising, 0..3 flying (flap), 0x1234 dying
 *   +8 facing sprite offset (0 / 4), or the death frame
 *   +A vx  +C vy
 * CS:0x835C is patched to RET when the pool is empty and to NOP by the spawn.
 * It is the FIRST call of the enemy suite (CS:0x0279).
 */
import { attackHero, creatureScansGrid } from './combat.js';

export const SLOTS = 10;
export const SPAWN_HP = 0x19;              // CS:0x831D
export const SPRITE_BASE = 0x1f9;          // CS:0x83D3 / 0x847A / 0x84CF
export const DEATH_SPRITE_BASE = 0x5b;     // CS:0x85E9
export const DEATH_FRAMES = 0x11;          // CS:0x8605
export const BOX = Object.freeze({ w: 0x18, h: 0x18 });   // CS:0x8591
export const WAKE_CHANCE = 0x9c4;          // CS:0x8527 `cmp ax,0x9c4 / ja`
export const RESPAWN_TYPE = 0x6c - 0xb;    // CS:0x8557 / 0x857A: type 97
export const SCORE_DORMANT = 500;          // CS:0x85BA dl = 5
export const SCORE_AWAKE = 2500;           // CS:0x85C2 dl = 0x25
const DYING = 0x1234;

export class Cf40 {
  constructor() {
    this.slots = Array.from({ length: SLOTS },
      () => ({ x: 0, y: 0, hp: -1, state: 0, face: 0, vx: 0, vy: 0 }));
  }

  get live() { return this.slots.filter((s) => s.hp >= 0).length; }

  /** CS:0x8306 — screen x (camera added here), world y. False when full. */
  spawn(screenX, worldY, camX) {
    const s = this.slots.find((q) => q.hp < 0);
    if (!s) return false;                       // CS:0x831B `stc`
    s.hp = SPAWN_HP;
    s.x = screenX + camX; s.y = worldY;
    s.face = 0; s.vx = 0; s.vy = 0;
    s.state = -1;                               // CS:0x833A — dormant
    return true;
  }

  /**
   * CS:0x835D, one tick. Returns the sprites to draw (screen space).
   * @param {object} o  { cam, hero, health, grid, decodeTag, difficulty, rng,
   *   debris, sfx, invuln, freeze (DS:0x2FA), tock (DS:0x36C), score,
   *   respawnObject(x, y, type) — CS:0x8565 }
   */
  step(o) {
    const drawn = [];
    for (const s of this.slots) {
      if (s.hp < 0) continue;                   // CS:0x8368 `js`
      this.#one(s, o, drawn);
    }
    return drawn;
  }

  #one(s, o, drawn) {
    const { cam, hero, freeze } = o;
    if (s.state === DYING) { this.#dying(s, cam, drawn); return; }
    this.#hit(s, o);                            // CS:0x8394 `call 0x8591`
    if (s.state === DYING) { this.#dying(s, cam, drawn); return; }
    /* CS:0x83A1 `jng` takes its flags from CS:0x8397 `cmp [si+6],0x1234`,
     * so only the wake value 0x2345 rises; 0..3 is the flight's flap
     * counter. [PROVEN] live: PJOYL3 925-942, DS:0xCF40 cycles 0..3 while
     * moving (-3,-2) every tick. */
    if (s.state > DYING) {                      // -> CS:0x8460: rising
      if (!freeze) s.y += s.vy;
      const sx = s.x - cam.x, sy = s.y - cam.y;
      let sprite = SPRITE_BASE;
      s.face = 0;
      if (sx <= hero.x - cam.x) { sprite += 4; s.face = 4; }   // CS:0x848A `jg`
      drawn.push({ x: sx, y: sy, sprite });
      if (o.tock && !freeze) {                  // CS:0x84A5 / 0x84AC
        s.vy++;
        if (s.vy > 8) s.state = 0;              // CS:0x84B6 -> flying
      }
      return;
    }
    if (s.state < 0) { this.#dormant(s, o, drawn); return; }
    /* CS:0x83AF — flying. */
    if (!freeze) { s.y += s.vy; s.x += s.vx; }
    const sx = s.x - cam.x, sy = s.y - cam.y;
    if (sy < 0) return;                         // CS:0x83CE `jns` else ret (not drawn)
    drawn.push({ x: sx, y: sy, sprite: SPRITE_BASE + s.face + s.state });
    if (!freeze) this.#steer(s, hero);          // CS:0x83F3
    s.state = (s.state + 1) & 3;                // CS:0x83F6 — the flap frame
  }

  /** CS:0x83FE — one step toward the hero per tick, clamped (x +-3, y +-2);
   *  the facing follows vx past +-2. */
  #steer(s, hero) {
    let cx = s.vx, dx = s.vy;
    if (s.x < hero.x) cx++; else if (s.x > hero.x) cx--;
    if (s.y < hero.y) dx++; else if (s.y > hero.y) dx--;
    if (cx >= 2) s.face = 4;
    if (cx <= -2) s.face = 0;
    s.vx = Math.max(-3, Math.min(3, cx));
    s.vy = Math.max(-2, Math.min(2, dx));
  }

  /** CS:0x84C2 — dormant: face the hero; inside the wake box draw one random
   *  number a tick and wake on <= 0x9C4; outside a wider box, despawn back
   *  into a type-97 map object (CS:0x854F -> 0x8565). */
  #dormant(s, o, drawn) {
    const { cam, hero, freeze, rng } = o;
    const sx = s.x - cam.x, sy = s.y - cam.y;
    const hx = hero.x - cam.x;
    let sprite = SPRITE_BASE;
    if (sx < hx - 0x10) sprite += 0xa;          // CS:0x84E2 `jl`
    else if (sx > hx + 0x40) sprite += 8;       // CS:0x84E8 `jg`
    else sprite += 9;
    drawn.push({ x: sx, y: sy, sprite });
    if (sy >= 0 && sx >= 0 && sx <= 0x120 && sy < 0x78) {   // CS:0x8514-0x8522
      const r = rng();                          // CS:0x8524
      if ((r & 0xffff) <= WAKE_CHANCE && !freeze) s.state = 0x2345;   // CS:0x8533
      return;
    }
    /* CS:0x8539-0x854E — still near the screen: keep waiting. */
    if (sx < 0x158 && sx > -0x30 && sy > -0x30 && sy < 0xd8) return;
    if (o.respawnObject) o.respawnObject(s.x, s.y, RESPAWN_TYPE);   // CS:0x855B
    s.hp = -1;                                  // CS:0x855F
  }

  /** CS:0x8591 — CS:0xA9E4 over a 0x18 box at (x, y), strength = hp. A kill
   *  (hp < 0) scores 500 dormant / 2500 otherwise and starts the death. */
  #hit(s, o) {
    const r = attackHero({ x: s.x, y: s.y, ...BOX, strength: s.hp }, o.hero, o.health,
                         { invuln: o.invuln, sfx: o.sfx });
    let hp = r.strengthOut;
    if (hp >= 0 && o.decodeTag) {
      const proxy = { x: s.x, y: s.y, state: hp };
      creatureScansGrid(proxy, o.grid, o.cam, o.decodeTag, o.difficulty || 0, BOX,
                        o.targets || null, { rng: o.rng, debris: o.debris, sfx: o.sfx });
      hp = proxy.state;
    }
    if (hp >= 0) { s.hp = hp; return; }         // CS:0x85AC
    s.hp = 0; s.face = 0;                       // CS:0x85B0 / 0x85B5
    if (o.score) o.score.add(s.state < 0 ? SCORE_DORMANT : SCORE_AWAKE);   // CS:0x85C5 -> 0x0C8B
    s.state = DYING;                            // CS:0x85C8
  }

  /** CS:0x85CE — drift, draw death frame 0x5B + n at (-8, -8), 17 frames. */
  #dying(s, cam, drawn) {
    s.x += s.vx; s.y += s.vy;
    drawn.push({ x: s.x - cam.x - 8, y: s.y - cam.y - 8, sprite: DEATH_SPRITE_BASE + s.face });
    s.face++;
    if (s.face >= DEATH_FRAMES) s.hp = -1;
  }
}

