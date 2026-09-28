/* guardian4.js — the world-4 guardian, selector 11's CS:0xC5EA.
 *
 * [STATIC], read from the live code segment dump (DOSBox 877:0000,
 * CS:0xC5EA-0xCD7A, every routine below disassembled in full). No shipped demo
 * reaches it, so nothing here is checked against a capture yet. See
 * Gods/docs/guardians.md's world-4 section.
 *
 *   C5EA  entry: base y [0x250] = 0x180, driver [0x284] = C978, respawn
 *         [0x288] = C624, one-shot load [0x35C] = 1, health [0x28A] = 6000,
 *         hook [0x286] = CBC7 (un-RET'd), the ending gate CC67 RET'd,
 *         [0x3D8] = [0x362] = [0x3D9] = 0; falls into
 *   C624  (respawn too): boulder free, thrower countdown [0x2E0] = 120, worm
 *         health [0x30E] = 750, PBUMLIST cursor rewound, worm records set with
 *         delays 0xAA + 2r.
 *
 * Four actors. The HOOK (CS:0xCBC7, main loop CS:0x01E5, before the object
 * pass and the player) raises the body from y 0x180 to 0xB0, 2 px a tick, and
 * pans the scripted camera to (0xB60, 0x78); on the last rise tick it
 * snapshots the screen (graphics export 18) and from then on the background
 * render (export 0) blits that snapshot back, so the body is never drawn
 * again: it lives in the frozen background. The DRIVER (CS:0xC978, main loop
 * CS:0x02A5) runs the thrower + boulder (CB44 / C9D7), the worm (C655) and
 * the body's contact box (C9A5), in that order.
 *
 * The body takes no weapon damage: C9A5 calls A9E4 with bp = [0x28A] and
 * `pop dx`s the result away. Health drops only at CS:0xC776, 1000 for every
 * worm destroyed, so the 7th destroyed worm kills it (C758 -> CS:0xD923).
 *
 * After the death the CS:0xCC67 gate (main loop CS:0x01E2, every tick the
 * hero is alive) runs the ending: the tally at timer 149, six messages from
 * timer 200 on, then ten extra lives (object id 0x35) and, once the hero has
 * banked all ten, [0x34A] = 1 — the game-completion path CS:0x037A.
 */
import { attackHero, creatureScansGrid, KILL_SFX } from './combat.js';
import { sharedDeath } from './guardian.js';

export const W4_HP = 6000;                     // CS:0xC601
export const W4_WORM_HP = 750;                 // CS:0xC630
export const W4_WORM_KILL_HP = 1000;           // CS:0xC776 / 0xC783
export const W4_BASE_Y0 = 0x180;               // CS:0xC5EA
export const W4_BASE_Y = 0xb0;                 // CS:0xCBF4 / 0xCC01
export const W4_BODY_X = 0xb90;                // CS:0xC9B1 / 0xCD36
export const W4_DEATH_X = 0xba0;               // CS:0xC758 [0x28C]
export const W4_CAM_TARGET = { x: 0xb60, y: 0x78 };   // CS:0xCBCE / 0xCBD4
export const W4_SFX_START = 0x05c5;            // CS:0xC985, the driver's first call
export const W4_WORM_SEGMENT = 0x1f2;          // CS:0xC6C9, export 2
export const W4_HEAD_BASE = 0x1e2;             // CS:0xC8AE
export const W4_HEAD_CLIP = 0x41;              // CS:0xC8BF SS:[0x40A], export 1's bottom line
export const W4_GIFT_ID = 0x35;                // CS:0xCCBD, object type 42: an extra life
export const W4_THROWER_RESET = 0x28;          // CS:0xCB66

/* SS:0x5024: the ten body parts {dx, dy, kind}, sprite 0x1C2 + k (CS:0xCD30).
 * Kind picks export 2 or 1 via SS:0x5020; the port blits both alike.
 * [STATIC] from GAME.EXE's own image (file 0x24584), equal to the live read. */
export const W4_PARTS = Object.freeze([
  [0, 0], [16, 0], [48, 0], [16, 10], [48, 10], [64, 10], [64, 39], [64, 59], [16, 78], [32, 78],
]);
/* SS:0x5382: the worm head's offset from the previous segment, by b & 7
 * (only each entry's first pair is read, CS:0xC8A0/0xC8A3). GAME.EXE 0x248E2. */
export const W4_HEAD_OFF = Object.freeze([
  [11, -3], [3, 7], [-13, 10], [-26, 1], [-27, -13], [-17, -25], [-4, -30], [9, -18],
]);
/* DS:0xEF4C -> the six ending messages (GAME.EXE, pointers equal to the live read). */
export const W4_ENDING = Object.freeze([
  'you have destroyed', 'the last great guardian.', 'reluctantly, the gods bestow',
  'upon you the greatest gift -', 'immortality', 'collect your gift',
]);

const s16 = (v) => ((v & 0xffff) ^ 0x8000) - 0x8000;
const nib = (n) => (n & 8 ? n - 16 : n);

/** CS:0xC94B / 0xC966 over a decompressed PGOD04.PAT: the LAST directory
 *  record (the one before the first negative word; its pointer is the running
 *  sum from 0x190, as CS:0x38A8 rewrites it). Returns the blob's x, y and the
 *  step bytes (blob +10 .. end). */
export function wormPath(pat) {
  const dv = new DataView(pat.buffer, pat.byteOffset, pat.byteLength);
  let run = 0x190, n = 0, last = null;
  while (dv.getInt16(n * 8, true) >= 0) {
    const len = dv.getUint16(n * 8 + 6, false);
    last = { off: run, len };
    run += len; n++;
  }
  if (!last) throw new Error('PGOD04.PAT has no pattern records');
  const b = pat.subarray(last.off, last.off + last.len);
  return { x: (b[2] << 8) | b[3], y: (b[4] << 8) | b[5], steps: b.subarray(10) };   // C918 bswap
}

/** Graphics export 1's returned bp (VGA:0x1D07): 0x5256 untouched when the
 *  sprite is culled, 0 once anything was blitted. The "clipped off the top or
 *  bottom" case (bp = rows) needs the sprite's height and is not modelled. */
const export1Bp = (sx, sy) => (sx <= -0x20 || sx >= 0x140 || sy >= 0xc0 ? 0x5256 : 0);

export class Guardian4 {
  constructor({ pat, bumlist }) {
    this.world = 4;
    this.path = wormPath(pat);
    this.bumlist = bumlist;                       // SS:0x4F20, 256 bytes
    this.baseY = W4_BASE_Y0;                      // DS:0x250
    this.hp = W4_HP;                              // DS:0x28A
    this.hookOn = true;                           // cs:[0xCBC7] = 0x90
    this.started = false;                         // DS:0x3D9
    this.riseGate = 0;                            // DS:0x2F0 — stale on the install tick (<= 0xB0)
    this.destroyed = false;                       // DS:0x3DB — NOT reset by the respawn
    this.anchor = { x: 0, y: 0 };                 // DS:0x2F2 / 0x2F4
    this.freeze = null;                           // render side: 'clean' / 'snap' requests
    this.recs = Array.from({ length: 8 }, () => ({ x: 0, y: 0, wait: 0, p: 0, frame: 0, expl: false, vx: 0, vy: 0 }));
    this.boulder = { x: 0, y: 0, frame: -1, hp: 0 };   // DS:0xD030..0xD037
    this.msgs = 0;                                // DS:0x3D8
    this.allPosted = false;                       // DS:0x362
    this.reset();
  }

  get dead() { return this.hp < 0; }
  get x() { return W4_DEATH_X; }                  // DS:0x28C at the death
  get y() { return this.baseY; }

  /** CS:0xC624 — the respawn re-entry (the entry falls into it). */
  reset() {
    this.boulder.frame = -1;                      // [0xD034] = 0xFFFF
    this.thrower = 0x78;                          // DS:0x2E0
    this.wormHp = W4_WORM_HP;                     // DS:0x30E
    this.#newWorm(0xaa);
  }

  /** CS:0xC918 (from C8F5 or C624): eight records on the one shared path. */
  #newWorm(delay) {
    this.cursor = 0;                              // DS:0x310 = 0x4F20
    for (const r of this.recs) {
      r.x = this.path.x; r.y = this.path.y;
      r.wait = delay; r.p = 0; r.expl = false;
      delay += 2;
    }
  }

  /** CS:0xCBC8, the rise hook: the parts it draws go under everything else
   *  (they are drawn before the object pass). `camScript` is DS:0x32 + target. */
  hook({ cam, camScript, sfx }) {
    if (!this.hookOn) return [];
    this.riseGate = this.baseY;                   // CBCB — also the world-2 jaw's DS:0x2F0 (not mirrored)
    camScript.tx = W4_CAM_TARGET.x; camScript.ty = W4_CAM_TARGET.y;
    if (camScript.mode === 0) camScript.mode = 1; // CBDA
    this.freeze = 'clean';                        // CC1D, export 19: save the clean block
    const bg = [];
    const y = this.baseY;
    bg.push({ x: 0xb86 - cam.x, y: y + 0x67 - cam.y, sprite: 0x1d0 });   // CCEA
    bg.push({ x: 0xb8d - cam.x, y: y + 0x4b - cam.y, sprite: 0x1d0 });
    W4_PARTS.forEach(([dx, dy], k) =>                                   // CD30
      bg.push({ x: W4_BODY_X - cam.x + dx, y: y - cam.y + dy, sprite: 0x1c2 + k }));
    this.baseY -= 2;                              // CBEF
    if (this.baseY < W4_BASE_Y) {
      /* CBFC: sound export 5 (al 0xC5, not modelled), y clamped, [0x32] = 3,
       * export 18 snapshots the screen and sets [0x32] = 4, hook RET'd. */
      this.baseY = W4_BASE_Y;
      camScript.mode = 4;
      this.freeze = 'snap';
      this.hookOn = false;
    }
    return bg;
  }

  /** CS:0xA9E4 at world top-left (x, y), strength bp, box w x h. `gm` is the
   *  DS:0x34 the call sees (the boulder forces 0). One kill sound when the
   *  result is negative (A9EC -> ABC0). */
  #a9e4(x, y, w, h, bp, gm, o) {
    const r = attackHero({ x, y, w, h, strength: bp }, o.hero, o.health,
                         { reportGate: gm, invuln: o.invuln });
    bp = r.strengthOut;
    if (bp < 0) { o.sfx(KILL_SFX); return bp; }
    if (!o.decodeTag) return bp;
    const proxy = { x, y, state: bp };
    creatureScansGrid(proxy, o.grid, o.cam, (tag) => o.decodeTag(tag, gm), o.difficulty || 0,
                      { w, h }, o.targets || null, { rng: o.rng, debris: o.debris, sfx: o.sfx });
    return proxy.state;
  }

  /** CS:0xC978, the driver. Returns the sprites to draw (screen space). */
  drive(o) {
    const drawn = [];
    if (!this.started) { this.started = true; o.sfx(W4_SFX_START); }   // C978-C985
    if (this.hp < 0) { this.#worm(o, drawn); return drawn; }          // C98C (unreachable)
    if (--this.thrower < 0) this.#thrower(o, drawn);                  // C996
    this.#boulder(o, drawn);                                          // C99F
    this.#worm(o, drawn);                                             // C9A2
    /* C9A5: the body box, 0x40 x 0x60, strength [0x28A], result discarded.
     * On the death tick [0x34] is already 0. */
    this.#a9e4(W4_BODY_X, this.baseY, 0x40, 0x60, this.hp, this.hp < 0 ? 0 : 1, o);
    return drawn;
  }

  /** CS:0xCB44 — the thrower's pose, and the boulder launch. */
  #thrower(o, drawn) {
    const ph = (-this.thrower + 4) >> 2;          // CB47-CB4E
    const draw = (p) => {                         // CB6D, screen x fixed
      const id = 0x1cc + (p & 2);
      const sy = this.baseY + 0x3a - o.cam.y;
      drawn.push({ x: 0x40, y: sy, sprite: id }, { x: 0x60, y: sy, sprite: id + 1 });
    };
    if (ph === 3) {
      draw(2);                                    // CB9E
      if (this.boulder.frame < 0) {               // CBA2
        Object.assign(this.boulder, { x: 0xbaa, y: this.baseY + 0x3a, frame: 0, hp: 0x28 });
      }
    } else if (ph < 3) draw(ph);
    else if (ph === 4) draw(1);
    else this.thrower = W4_THROWER_RESET;         // CB66
  }

  /** CS:0xC9D7 — the boulder, one record at DS:0xD030. */
  #boulder(o, drawn) {
    const b = this.boulder, cam = o.cam;
    const cx = b.frame;
    if (cx < 0) return;
    const ax = b.x, bx = b.y;                     // the OLD position draws and hits
    b.x += 6;
    b.frame++;
    if (b.frame === 5) b.frame = 0;
    if (b.frame === 7) { b.frame = -1; return; }  // CA06
    const floor = this.baseY + 0x49;
    b.y++;
    if (b.y > floor) b.y = floor;                 // CA18
    let sx = ax - cam.x, sy = bx - cam.y;
    drawn.push({ x: sx, y: sy, sprite: 0x1db + cx });
    let bp = export1Bp(sx, sy);
    if (s16(ax) <= 0xbbc) {                       // CA42: the launch overlay
      const ox = 0xbb0 - cam.x;
      drawn.push({ x: ox, y: this.baseY + 0x38 - cam.y, sprite: 0x1d1 });
      drawn.push({ x: ox + 0x20, y: this.baseY + 0x38 - cam.y, sprite: 0x1d2 });
      sy = this.baseY + 0x4b - cam.y;
      drawn.push({ x: ox, y: sy, sprite: 0x1d3 });
      bp = export1Bp(ox, sy);                     // CA95 is the last draw
    }
    if (b.hp < 0) return;                         // CA9A: exploding, no hit test
    /* CAB1-CABD: [0x34] forced to 0 around A9E4, and bp is NOT loaded: it is
     * whatever the last export-1 draw returned (UNKNOWN_w4_boulder_bp). */
    const r = this.#a9e4(ax, bx, 0x18, 0x18, bp, 0, o);
    if (ax - cam.x < 0x110) {                     // CAC5
      b.hp = r;
      if (r >= 0) return;
    }
    b.frame = 5; b.hp = -1;                       // CAD2: burst, two zaps
    if (o.zap) {
      const tx = cam.x + 0x148, ty = cam.y + 0x4f;   // DBC6 aims at [0x17A]+8, [0x17C]+6
      o.zap(cam.x + 0x45, cam.y + 0x54, tx, ty);
      o.zap(cam.x + 0x62, cam.y + 0x53, tx, ty);
    }
  }

  /** CS:0xC655 — the worm: eight records, one path, shared health. */
  #worm(o, drawn) {
    const cam = o.cam;
    let acct = 0;                                 // DS:0x3DA (byte)
    for (let i = 0; i < 8; i++) {
      const r = this.recs[i];
      if (!r.expl) {
        if (r.wait >= 0) { r.wait--; continue; }  // C81B
        let explode = this.destroyed || this.wormHp === 0;   // C672 / C67C
        if (!explode) {
          if (!this.#step(r) || !this.#step(r)) { acct++; continue; }   // C82F FINISHED
          if (i === 1) this.#head(o, drawn);      // C689 cx == 7
          if (this.wormHp < 0) explode = true;    // C6A1
          else {
            this.wormHp = this.#a9e4(r.x, r.y, 0x18, 0x18, this.wormHp, 1, o);   // C6A8
            if (this.wormHp < 0) this.destroyed = true;                         // C6B3
            this.anchor.x = r.x; this.anchor.y = r.y;
            const sx = r.x - cam.x, sy = r.y - cam.y;
            if (sx > 0x81 || sy < 0x41) drawn.push({ x: sx, y: sy, sprite: W4_WORM_SEGMENT });
            continue;
          }
        }
        /* C78D EXPLODE: two draws, then the first frame this call. */
        r.vx = (o.rng() & 0xf) - 8;
        r.vy = (o.rng() & 0xf) - 8;
        r.frame = 0; r.expl = true;
      }
      /* C7B8 */
      if (r.frame < 0) { acct--; continue; }
      r.x += r.vx; r.y += r.vy;
      drawn.push({ x: r.x - 8 - cam.x, y: r.y - 8 - cam.y, sprite: 0x5b + r.frame });
      if (++r.frame >= 0x11) r.frame = -1;
    }
    if (acct === -8) {                            // C776
      this.hp -= W4_WORM_KILL_HP;
      if (this.hp < 0) return;                    // -> C758, the death (host: die)
      this.destroyed = false;
      this.wormHp = W4_WORM_KILL_HP;
      this.#newWorm(0x46);                        // C8F5
      return;
    }
    if (acct === 8) { this.#newWorm(0x46); return; }   // C700: escaped, same health
    if (this.riseGate > 0xb0) return;             // C70B
    drawn.push({ x: 0xba0 - cam.x, y: this.baseY + 3 - cam.y, sprite: 0x1d4 });
    drawn.push({ x: 0xbc0 - cam.x, y: this.baseY + 8 - cam.y, sprite: 0x1d5 });
  }

  /** CS:0xC838 — one path step; false when the record is at the end. */
  #step(r) {
    if (r.p >= this.path.steps.length) return false;
    const b = this.path.steps[r.p++];
    r.x += nib(b >> 4); r.y += nib(b & 0xf);
    return true;
  }

  /** CS:0xC870 — the head, drawn from the LAST segment processed before
   *  record 1 (DS:0x2F2/0x2F4), one PBUMLIST byte a call. */
  #head(o, drawn) {
    const b = this.bumlist[this.cursor++] ?? 0;   // C8E4 (past 256 it would read SS:0x5020)
    const d = b & 7;
    let id = W4_HEAD_BASE + d;
    if (b & 0xf8) { id += 0x11; if (b & 0x10) id++; }
    const [dx, dy] = W4_HEAD_OFF[d];
    const sx = this.anchor.x + dx - o.cam.x, sy = this.anchor.y + dy - o.cam.y;
    const d0 = { x: sx, y: sy, sprite: id };
    if (sx < 0x81) d0.clipBottom = W4_HEAD_CLIP;  // C8BA
    drawn.push(d0);
  }

  /** Worlds 1-3's spit gates (CS:0xD211 / 0xDA62 / 0xD557) stay RET here. */
  moveSpits() { return []; }

  /** CS:0xC758, the death: D923 at (0xBA0, [0x250]), then the ending gate
   *  on. The host zeroes DS:0x11E (CS:0xC64C). World 4 has no popup and no
   *  difficulty bump; [0x3BE] = 80. */
  die({ rng, starburst, burst, sfx }) {
    sharedDeath(W4_DEATH_X, this.baseY, { rng, starburst, burst, sfx });
    this.ending = true;
    return { scoreTicks: (4 * 20) & 0xff, difficulty: 0, corpse: false };
  }

  /** CS:0xCC68, the ending gate, one call a tick while the hero is alive.
   *  `n` is DS:0x11E. o: { messages, lives, tally(), gift(x, y, id), complete() }.
   *  Returns true while the saved clean block is pasted back (export 20). */
  stepEnding(n, o) {
    n = s16(n);
    if (n < 150) { if (n >= 149) o.tally(); return true; }   // CC88-CC90: [0x36A] = 1
    if (!this.allPosted) {
      const i = this.msgs;                          // CC2E
      if (i < 6 && 200 + 64 * i <= n) {
        o.messages.barrier = 0;                     // [0x394] = 0
        o.messages.post(W4_ENDING[i], 0x7fff);
        this.msgs++;
      }
      if (this.msgs === 6) this.allPosted = true;
    }
    if (this.msgs > 6) {
      if (o.lives >= this.giftTarget) o.complete(); // CCCD: [0x34A] = 1
    } else if (this.msgs === 6 && !o.messages.active) {   // [0x393] == 0
      this.msgs = 7;
      this.giftTarget = o.lives + 10;               // written into [0x250]
      for (let k = 0; k < 10; k++) o.gift(0xb8a + 0x17 * k, 0x70, W4_GIFT_ID);   // 0x1764 -> C041
    }
    return true;
  }
}
