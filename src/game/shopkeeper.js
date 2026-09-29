/* shopkeeper.js — the shop potion's shopkeeper: the countdown, the hero's
 * turn, the walker, and its hand-off to the mid-level shop.
 *
 * The shop potion's handler (CS:0x61E9, consumables.js `shop`) writes only
 * DS:0x363 = 0x41. Everything else hangs off that byte:
 *
 *   CS:0x0248  [0x363] >= 0 -> call 0x06B0 INSTEAD of the player (0x4993)
 *   CS:0x0310  [0x363] >= 0 -> 0x05BA, at the end of the tick:
 *     05BA       == 0x19: call 0x9026 (zero the selector-1 PAT slots and the
 *                selector-2 turrets: the screen is cleared for the visit)
 *     05C4       dec [0x363]; still >= 0: back to the loop
 *     05CD       went negative: unless [0x38A] == 1 already (shop sprites
 *                in), 0x081E (a floppy-only disk prompt) and 0x05D7
 *     05D7       [0x25E] = 0x1C2 ; export 22 loads the "shop" atlas group
 *                (PSHOPSPR + PSHOPFNT, VGA.EXE's own group table) from the
 *                cursor DS:0x130 = the start of level<N>, the same place a
 *                guardian's atlas goes ; [0x38A] = 1
 *     060D       the path: DS:0xE91A + 6 * ((world - 1) * 2 + [0x35D]),
 *                {x, y, dx} into DS:0x266/0x268/0x26A ; [0x35D]++ ;
 *                [0x26C] = 0 ; cs:[0x71D] = NOP (the walker is on)
 *
 *   CS:0x06B0  the turn: the path record's dx >= 0 (the shopkeeper comes
 *              from the left) forces input LEFT until the hero stands in
 *              state 0 at phase 2; dx < 0 forces RIGHT until state 1 at
 *              phase 2. The forced input runs the ordinary state handler
 *              (the DS:0xD818 table); once facing, only the epilogue runs.
 *
 *   CS:0x0288 -> 0x071D  the walker, between System B (0x0285) and System A
 *              (0x028B). While it is on, the player dispatch (CS:0x49AA)
 *              runs only the epilogue: the hero is frozen.
 *     071E       on DS:0x36C ticks: x += 6 * dx; near a column boundary
 *                ((x & 0x1F) <= 4 or >= 0x1C) the column ahead reverses dx
 *                when a wall (== 1) is in its first three rows or its
 *                fourth, the floor, is not solid (the move still stands)
 *     0793       draw at sprite 0x1C2 + 4 * dx + 4 + phase (CS:0x3569)
 *     07BE       on the other ticks: phase = (phase + 1) & 7, footstep
 *                0x020E on phases 2 and 6
 *     07D9       contact: CS:0xAC59 with a 0x20 x 0x30 box, strength 5
 *                (5 damage, not scaled), the hurt sound muted by the NOP
 *     0801       a reported hit: +5 back unless invulnerable, the walker
 *                off (cs:[0x71D] = RET), SS:0x40A = 0xC0, and the return
 *                address popped: JMP 0x6BED, the mid-level shop
 *
 * [STATIC] except where a check says otherwise; see docs/shop.md. */

/* DS:0xE91A — {x, y, dx}, two visits per world. dx = 0 (world 4's second)
 * never moves and animates frames 4..11. Records 8 and 9 are what follows
 * the table in DS (a third potion in world 4 would read them). */
export const SHOPKEEPER_PATHS = Object.freeze([
  [0x0680, 0x03b0, -1], [0x0e60, 0x0180, 1],
  [0x02c0, 0x03c0, 1],  [0x01e0, 0x03c0, -1],
  [0x05a0, 0x0310, -1], [0x0300, 0x00a0, 1],
  [0x02c0, 0x00b0, -1], [0x0180, 0x0320, 0],
  [-0x12e9, -0x12e9, -0x12e9], [-0x12e9, -0x12e9, 0],
]);

export const SHOP_COUNTDOWN = 0x41;       // CS:0x61E9
export const CLEAR_SCRIPTS_AT = 0x19;     // CS:0x05BA
export const SPRITE_BASE = 0x1c2;         // CS:0x05D7 [0x25E]
export const FOOTSTEP_SFX = 0x20e;        // CS:0x07F8
export const STEP_PX = 6;                 // CS:0x0730-0x0736: 2 * dx + 4 * dx
export const CONTACT = Object.freeze({ w: 0x20, h: 0x30, strength: 5 });   // CS:0x07E0-0x07E9
export const HEAL_BACK = 5;               // CS:0x0808
/** CS:0x06CD / 0x06E7 — the state the turn waits for, and at which phase. */
export const FACE_PHASE = 2;

/** DS:0xE91A's record for this world and visit count. */
export function pathFor(world, visits) {
  return SHOPKEEPER_PATHS[(world - 1) * 2 + visits] || null;
}

export class Shopkeeper {
  constructor() {
    this.countdown = -1;   // DS:0x363, a signed byte
    this.visits = 0;       // DS:0x35D, zeroed by the level init (CS:0x8CEB) and a password start
    this.active = false;   // cs:[0x71D] == NOP
    this.x = 0; this.y = 0; this.dx = 0;   // DS:0x266/0x268/0x26A
    this.phase = 0;        // DS:0x26C
  }

  /** CS:0x8CEB / 0x8D06 / 0x8D0C — a level entry. */
  reset() {
    this.countdown = -1;
    this.visits = 0;
    this.active = false;
  }

  /** CS:0x61E9, the shop potion. */
  summon() { this.countdown = SHOP_COUNTDOWN; }

  /** CS:0x0248 — is the turn (0x06B0) running instead of the player? */
  get turning() { return this.countdown >= 0; }

  /** CS:0x06B0 — the side to face: `{ dir: 'left'|'right', state }`. */
  faceFor(world) {
    const rec = pathFor(world, this.visits);
    const dx = rec ? rec[2] : 0;
    return dx >= 0 ? { dir: 'left', state: 0 } : { dir: 'right', state: 1 };
  }

  /** CS:0x060D-0x063A — load the path record and (unless `enable` is
   *  false, the password start's CS:0x0659 RET patch) switch the walker on. */
  start(world, enable = true) {
    const rec = pathFor(world, this.visits) || [0, 0, 0];
    [this.x, this.y, this.dx] = rec;
    this.visits++;
    this.phase = 0;
    if (enable) this.active = true;
  }

  /**
   * CS:0x05BA, the end of a tick while the countdown runs.
   * @param {{clearScripts:Function, spritesLoaded:boolean, loadSprites:Function}} hooks
   * @returns {boolean} true on the tick the walker switches on
   */
  stepCountdown(world, hooks) {
    if (this.countdown < 0) return false;
    if (this.countdown === CLEAR_SCRIPTS_AT) hooks.clearScripts();   // CS:0x05C1 -> 0x9026
    this.countdown--;
    if (this.countdown >= 0) return false;
    if (!hooks.spritesLoaded) hooks.loadSprites();                   // CS:0x05CD-0x0608
    this.start(world, true);
    return true;
  }

  /**
   * CS:0x071E, one tick of the walker.
   * @param {number} tock DS:0x36C
   * @param {Uint8Array} planeB the level's plane B (128 columns)
   * @param {{x:number,y:number}} cam
   * @param {Function} contact `(atk) => attackHero result` — CS:0xAC59
   * @param {Function} sfx
   * @returns {{drawn:{x:number,y:number,sprite:number}, shop:boolean}}
   */
  step(tock, planeB, cam, contact, sfx) {
    let x = this.x;
    const y = this.y;
    if (tock) {
      const dx = this.dx;
      x = (x + STEP_PX * dx) | 0;                                     // CS:0x0730-0x0736
      const f = x & 0x1f;
      if (f <= 4 || f >= 0x1c) {                                      // CS:0x073D-0x0745
        const col = ((x & 0xffe0) >> 5) + dx;                         // CS:0x075B-0x076C
        const row = (y & 0xfff0) >> 4;
        /* A wall (== 1) in any of the three rows ahead turns it, and so
         * does a missing floor: the fourth row's `jz` (CS:0x0786) is the
         * only way PAST the NEG, so the walker turns at a ledge too. */
        const at = (k) => planeB[(row + k) * 128 + col];
        if (at(0) === 1 || at(1) === 1 || at(2) === 1 || at(3) !== 1) this.dx = -this.dx;   // CS:0x076E-0x0788
      }
    }
    this.x = x;
    const drawn = { x: x - cam.x, y: y - cam.y,
                    sprite: SPRITE_BASE + this.dx * 4 + 4 + this.phase };   // CS:0x079F-0x07BB
    if (!tock) {
      this.phase = (this.phase + 1) & 7;                              // CS:0x07C5-0x07C9
      if (this.phase === 2 || this.phase === 6) sfx(FOOTSTEP_SFX);    // CS:0x07D1-0x07FB
    }
    const r = contact({ x, y, ...CONTACT });                          // CS:0x07D9-0x07EF
    if (r.strengthOut >= 0) return { drawn, shop: false };
    this.active = false;                                              // CS:0x080D
    return { drawn, shop: true };
  }
}
