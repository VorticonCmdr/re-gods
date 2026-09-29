/* progress.js — selector 6 (CS:0x38F5), the per-world progress-record chain
 * it drives, and the tally bit dispatch both it and the level-exit zone feed.
 *
 * See Gods/docs/camera-and-world-nav.md's "Selector 6" section for the full
 * trace. In short:
 *
 * THE CHECKPOINT — CS:0x38F5, read in full.
 *     38F9  [0x16E],[0x170] := hero X,Y          ; the respawn point, ALWAYS
 *     3907  for each of the 6 ring words at DS:0x8B34 (entry 0 tested twice):
 *             call 0x3988 ; jnc 0x3983           ; near an old one -> done
 *     3962  inc byte [0x368] ; inc byte [0x369]
 *     396A  std / rep movsw (10 words)           ; ring[0..4] -> ring[1..5]
 *     3979  ring[0] := hero X,Y
 *     3980  call 0x64E3                          ; the chain test
 * CS:0x3988 is "near" when ringX-0x40 <= X <= ringX+0x40 and the same for Y,
 * both signed. The event record is never consumed (every shipped level puts
 * selector 6 in event 252), so this runs on every tick the hero stands on a
 * marker cell; the ring is what keeps it from counting the same spot twice.
 *
 * THE CHAIN TEST — CS:0x64E3.
 *     64E4  SI := [0x178] ; cmp al(=low byte of [SI]), [0x369]
 *     64EE  jnz ; else [0x36A] := 1              ; tally pending
 *     64F7  world 3, sublevel A, X >= 0x450, 0x300 <= Y <= 0x310 (signed):
 *     651D  [0x369] := 0 ; jmp 64F0              ; a forced tally
 *
 * LEVEL ENTRY — CS:0x8C34 (never on the sublevel-B switch, see below):
 *     [0x178] := word[0xE674 + (world-1)*2] ; [0x368],[0x369],[0x36A] := 0
 *     ring    := 6 x (spawnX & 0xFF80, spawnY & 0xFF80)
 *     respawn := spawn
 *
 * THE TALLY — CS:0x6553, called from the main loop when [0x36A] != 0.
 *     6553  SI := [0x178] ; [0x178] += 0x22
 *     6562  DX := [SI+0x1E]
 *     6565  cmp word [SI+4],0 / jnz -> the tally screen, else jmp 0x694D
 * so a record whose +4 word is 0 dispatches its bits with no screen at all.
 *
 * THE BIT DISPATCH — CS:0x694D, read in full.
 *     694D  AX := 0x1F ; SI := 0x35EA ; DX <<= 4
 *     6958  SI -= 2 ; DI := SS:[SI] ; DX <<= 1 ; jnc skip ; call DI
 *     696A  dec AX / jns 0x6958 ; [0x36A] := 0
 * i.e. bits 11 down to 0, in that order, each calling SS:[0x35D2 + bit*2].
 * The sublevel-B handler (CS:0x4828) leaves by `JMP 0x2A4A` (the loader),
 * whose tail at CS:0x2C3E sees [0x38B] set and jumps to CS:0x484E, which
 * ends in a plain RET (CS:0x489C) -- back into this loop. So the bits BELOW
 * a sublevel switch still run, on the freshly loaded sublevel. World 3's
 * first record sets both bit 11 and bit 0: sublevel B is loaded twice.
 */

/* DS:0xE684-0xE8C9, read straight out of GAME.EXE (1ffd:e684). One stream,
 * not a table of fixed records: the LEVEL ONE and LEVEL TWO records carry an
 * extra 0xFFFF trailer, so the stream is walked by address, exactly as the
 * original's own `add [0x178],0x22` walks it. */
const STREAM_BASE = 0xe684;
const STREAM = Uint8Array.from(
  ('03000000f4012020202020574f524c4420204f4e45202020202000000000400100000600' +
   '0000f4012020202020574f524c44202054574f2020202020000000006103040008000000' +
   '0000202020202020202020202020202020202020202000000000000006000c000000c409' +
   '20202020204c4556454c20204f4e4520202020200000000002050000ffff06000000f401' +
   '2020202020574f524c4420204f4e45202020202000000000800100000a000000f4012020' +
   '202020574f524c44202054574f202020202000000000c10308000b000000000020202020' +
   '2020202020202020202020202020202000000000800100000f0000000000202020202020' +
   '2020202020202020202020202020000000008002000010000000c40920202020204c4556' +
   '454c202054574f20202020200000000002050000ffff64000000f4012020202020574f52' +
   '4c4420204f4e45202020202000000000810b000006000000f4012020202020574f524c44' +
   '202054574f202020202000000000a003000064000000c409202020204c4556454c202054' +
   '4852454520202020000000000207000005000000f4012020202020574f524c4420204f4e' +
   '452020202020000000000103000006000000000020202020202020202020202020202020' +
   '202020200000000000020000090000000000202020202020202020202020202020202020' +
   '202000000000000200000c000000f4012020202020574f524c44202054574f2020202020' +
   '000000008002000014000000a861202020202020202047414d4520202020202020200000' +
   '000000000000').match(/../g).map((h) => parseInt(h, 16)));

export const RECORD_STRIDE = 0x22;          // CS:0x6557 `add word [0x178],0x22`
export const STREAM_END = STREAM_BASE + STREAM.length;

/* DS:0xE674 — each world's first record (CS:0x8C34). */
export const WORLD_CHAIN_START = [0xe684, 0xe70e, 0xe7ba, 0xe820];
/* DS:0xE67C — ACT4's level-exit records, indexed by `arg - 2` (CS:0x0FB8). */
export const EXIT_RECORD_ADDR = [0xe6ea, 0xe796, 0xe7fe, 0xe8a8];
/* DS:0xE62E — each world's teleport-destination list (bit 6, CS:0x6973). */
export const TELEPORT_LIST_BASE = [0xe636, 0xe646, 0xe650, 0xe660];

/* DS:0xE636-0xE66F as little-endian words, read out of GAME.EXE (Ghidra,
 * 1ffd:e636). Each is a packed teleport destination `(col << 8) | row`,
 * consumed by the teleport stone's no-key fallback (CS:0x627B-0x6286).
 * World 3's list is zeros, and world 4's "list" at 0xE660 is really the
 * words that follow it (0x000E ... then WORLD_CHAIN_START) — the original
 * reads them all the same. The cursor only ever takes world 1 base +0/+4
 * and world 2 base +8 (the three bit-6 records' +0x20), plus 2 per stone,
 * so this window covers everything shipped play can reach. */
const TELEPORT_LIST_WORDS = [
  0x182c, 0x2027, 0x3129, 0x4804, 0x5009, 0x3129, 0x3129, 0x3129,   // 0xE636 world 1
  0x282c, 0x282c, 0x282c, 0x282c, 0x350c,                           // 0xE646 world 2
  0, 0, 0, 0, 0, 0, 0, 0,                                            // 0xE650 world 3
  0x000e, 0x0016, 0x0022, 0xe684, 0xe70e, 0xe7ba, 0xe820, 0xe6ea,   // 0xE660 world 4
];
const TELEPORT_LIST_START = 0xe636;

/** The word at a DS address in the transcribed window, or null outside it. */
export function teleportListWord(addr) {
  const i = (addr - TELEPORT_LIST_START) >> 1;
  if ((addr & 1) || i < 0 || i >= TELEPORT_LIST_WORDS.length) return null;
  return TELEPORT_LIST_WORDS[i];
}

export const RING_SLOTS = 6;                // DS:0x8B34..0x8B4A
export const RING_NEAR = 0x40;              // CS:0x398A / 0x399B

/**
 * The 0x22-byte record at `addr`, or null outside the stream (the words past
 * GAME at 0xE8CA are other data; nothing shipped walks that far).
 * @returns {?{addr:number, target:number, word2:number, bonus:number,
 *   text:string, bits:number, w20:number}}
 */
export function recordAt(addr) {
  const o = addr - STREAM_BASE;
  if (o < 0 || o + RECORD_STRIDE > STREAM.length) return null;
  const w = (k) => STREAM[o + k] | (STREAM[o + k + 1] << 8);
  return {
    addr,
    target: STREAM[o],                                  // CS:0x64EA compares AL only
    word2: w(2),                                        // FUN_1000_67f5's fanfare test
    bonus: w(4),                                        // CS:0x6565's screen gate
    text: String.fromCharCode(...STREAM.subarray(o + 6, o + 0x1a)),
    bits: w(0x1e),                                      // CS:0x6562
    w20: w(0x20),                                       // CS:0x697A (bit 6)
  };
}

/* SS:0x35AA's own handler per bit (read live — see the doc). */
export const PROGRESS_BIT = {
  SUBLEVEL_B_0: 0,     // CS:0x4828
  WORLD_ADVANCE: 1,    // CS:0x6B00
  NOTHING: 2,          // CS:0x69D6, a lone RET
  SUBLEVEL_B_3: 3,     // CS:0x4828
  SHOP: 4,             // CS:0x6BED — set by no shipped record
  TIMER_RESET: 5,      // CS:0x6B21
  TELEPORT_CURSOR: 6,  // CS:0x6973
  RESHUT_DOORS: 7,     // CS:0x6AD0 -> 0x41BC
  KEY_CLEAR: 8,        // CS:0x6AD4
  POOL_RESET: 9,       // CS:0x6992
  PASSWORD_GEN: 10,    // CS:0x69D7
  SUBLEVEL_B_11: 11,   // CS:0x4828
};

const BIT_ACTION = {
  0: 'sublevelB', 1: 'advance', 2: null, 3: 'sublevelB', 4: 'shop',
  5: 'timerReset', 6: 'teleportCursor', 7: 'reshutDoors', 8: 'clearKeys',
  9: 'poolReset', 10: 'genPassword', 11: 'sublevelB',
};

/**
 * CS:0x694D's walk: the actions `bits` selects, in the order the original
 * calls them (bit 11 first). Bits 12-15 are shifted out unread (`shl dx,4`).
 * @param {number} bits
 * @returns {string[]}
 */
export function progressActions(bits) {
  const out = [];
  for (let b = 11; b >= 0; b--) {
    if ((bits >> b) & 1 && BIT_ACTION[b]) out.push(BIT_ACTION[b]);
  }
  return out;
}

/** CS:0x3988 — true when (x, y) is inside ring entry (cx, cy)'s ±0x40 box. */
const near = (cx, cy, x, y) =>
  cx - RING_NEAR <= x && x <= cx + RING_NEAR && cy - RING_NEAR <= y && y <= cy + RING_NEAR;

export class Progress {
  constructor() {
    this.addr = WORLD_CHAIN_START[0];    // DS:0x178
    this.count368 = 0;                   // DS:0x368 — no reader located
    this.count369 = 0;                   // DS:0x369 — compared to record.target
    this.pending = false;                // DS:0x36A
    this.ring = Array.from({ length: RING_SLOTS }, () => ({ x: 0, y: 0 }));
    this.respawn = { x: 0, y: 0 };       // DS:0x16E / 0x170
    this.teleportCursor = TELEPORT_LIST_BASE[0];   // DS:0x19E — the teleport stone's fallback list
  }

  /** CS:0x8C34's share. */
  reset(world, spawnX, spawnY) {
    this.addr = WORLD_CHAIN_START[world - 1];
    this.count368 = 0; this.count369 = 0; this.pending = false;
    for (const r of this.ring) { r.x = spawnX & 0xff80; r.y = spawnY & 0xff80; }
    this.respawn = { x: spawnX, y: spawnY };
    this.teleportCursor = TELEPORT_LIST_BASE[world - 1];   // CS:0x8E79-0x8E88
  }

  /**
   * CS:0x38F5 + CS:0x64E3, for one dispatch of a selector-6 event.
   * @returns {boolean} whether this call added a new ring entry
   */
  checkpoint(x, y, world, sublevel) {
    this.respawn = { x, y };
    /* Entry 0 is tested twice (CS:0x3907 and CS:0x3914 load the same words);
     * a second test of the same box cannot change the answer. */
    for (const r of this.ring) if (near(r.x, r.y, x, y)) return false;
    this.count368 = (this.count368 + 1) & 0xff;
    this.count369 = (this.count369 + 1) & 0xff;
    for (let i = RING_SLOTS - 1; i > 0; i--) this.ring[i] = this.ring[i - 1];
    this.ring[0] = { x, y };
    const rec = recordAt(this.addr);
    if (rec && rec.target === this.count369) {
      this.pending = true;
    } else if (world === 3 && sublevel === 0 && x >= 0x450 && y <= 0x310 && y >= 0x300) {
      this.count369 = 0;                  // CS:0x651D
      this.pending = true;
    }
    return true;
  }

  /** ACT4 (CS:0x0FAC-0x0FDC): point the chain at an exit record, flag it. */
  setExit(arg) {
    const idx = arg - 2;
    if (idx < 0 || idx >= EXIT_RECORD_ADDR.length) return false;
    this.addr = EXIT_RECORD_ADDR[idx];
    this.pending = true;
    return true;
  }

  /** CS:0x6553-0x6557: the record to tally, then step the cursor past it. */
  take() {
    const rec = recordAt(this.addr);
    this.addr += RECORD_STRIDE;
    return rec;
  }

  /** CS:0x627B-0x6286 — the stone's no-key fallback: read the word at the
   *  cursor, then step the cursor one word. */
  takeTeleportWord() {
    const w = teleportListWord(this.teleportCursor);
    this.teleportCursor += 2;
    return w;
  }

  /** CS:0x6973: DS:0x19E := word[0xE62E+(world-1)*2] + ([0x178]-0x22)[+0x20]. */
  setTeleportCursor(world) {
    const prev = recordAt(this.addr - RECORD_STRIDE);
    this.teleportCursor = TELEPORT_LIST_BASE[world - 1] + (prev ? prev.w20 : 0);
  }
}

/**
 * CS:0x41BC (bit 7, also run by CS:0x8C34 at level entry): free zone slots
 * 0-9, then shut every door whose top-left tile is the world's open or shut
 * tile. Plane A is scanned in place, so a write ahead of the cursor is seen
 * by later iterations, as in the original.
 *     41C7  zone[i].x,y,kind := 0xFFFF (arg untouched), i < 10
 *     41E8  lodsb ; cmp al,[0x14E] / jz ; cmp al,[0x150] / jnz next
 *     41F1  B[c], B[c+0x80], B[c+0x100] := 1
 *     41FE  A[c] := close9 ; A[c+0x80] := close9+10 ; A[c+0x100] := close9+20
 *     4211  A[c+1], A[c+0x81], A[c+0x101] := [0x156]
 */
export function reshutDoors(planeA, planeB, tiles, zones) {
  for (let i = 0; i < 10 && i < zones.length; i++) {
    zones[i].x = -1; zones[i].y = -1; zones[i].kind = -1;
  }
  const open2 = tiles.open2 & 0xff, close9 = tiles.close9 & 0xff, right = tiles.close9Right & 0xff;
  const n = planeA.length;
  const putA = (i, v) => { if (i < n) planeA[i] = v; };
  const putB = (i) => { if (i < planeB.length) planeB[i] = 1; };
  let shut = 0;
  for (let c = 0; c < 0x2000 && c < n; c++) {
    const t = planeA[c];
    if (t !== open2 && t !== close9) continue;
    putB(c); putB(c + 0x80); putB(c + 0x100);
    putA(c, close9); putA(c + 0x80, (close9 + 10) & 0xff); putA(c + 0x100, (close9 + 20) & 0xff);
    putA(c + 1, right); putA(c + 0x81, right); putA(c + 0x101, right);
    shut++;
  }
  return shut;
}
