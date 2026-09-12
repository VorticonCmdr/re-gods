/* spawn.js — turning a plane-B event into actual enemies.
 *
 * This is what the port was missing: it could draw the hero and every map
 * object, but nothing placed a single enemy. The chain is
 *
 *   hero steps on plane-B cell v >= 3
 *     -> event record (v-3) at PALFILS +0x0324, {u16 selector, u16 param} BE
 *     -> selector 4 (1-BASED dispatch, CS:0x603A `dec ax`) -> CS:0xde08
 *     -> System-B group descriptor  PALFILS +0x11A4 + param*0x16
 *     -> next frame, CS:0xec60 materialises `count` entities
 *
 * SELECTOR 4 IS SYSTEM B (CS:0xde08 / CS:0xec60, this file's original
 * scope); SELECTOR 5 IS SYSTEM A (CS:0xde42 / CS:0xde7d) — parsed here by
 * parseGroupsA and materialised by entity-a.js's EntityA/CLASS_TABLES_A,
 * ported in a later session. See entity-a.js's header for what is and is
 * not simulated for System A.
 *
 * THE ACTIVATION HANDLER — CS:0xde08, and the ORDER matters:
 *     de08  mov word [si],0xffff        ; THE EVENT IS CONSUMED FIRST
 *           mov ax,[si+0x2]             ; param
 *           mov si,0xa1ac / mov bx,0x16 / mul bx / add si,ax
 *           mov bp,0x36b4 / mov cx,0xa
 *     de1f  cmp word [bp+0x0],0 / jz / add bp,0x12 / loop
 *     de2a  ret                         ; ALL SLOTS BUSY -> ACTIVATION LOST
 *     de2b  mov word [bp+0x0],2 / mov [bp+0x2],si
 *   Because the consume happens before the slot search, a group that arrives
 *   with all ten runtime slots busy is silently dropped AND can never fire
 *   again. That is reproduced here rather than "fixed".
 *
 * THE SPAWN LOOP — CS:0xec60, verified instruction by instruction:
 *     ec63  mov cl,[si] / or cx,cx / jnz / jmp 0xed38   ; count 0 -> slot NOT freed
 *     ec70  mov ax,[si+0x12] / xchg al,ah / mov bx,ax
 *           mov al,ah / sub ah,ah / sub bh,bh
 *           shl ax,1 (x5)  -> X = desc[0x12] * 32
 *           shl bx,1 (x4)  -> Y = desc[0x13] * 16
 *     ec9a  mov word [di+0x4],0        ; frame
 *     ec9f  mov word [di+0x8],0xfffe   ; state = waiting
 *     eca4  mov [di+0x6],dx            ; stagger, += desc[0x14] per entity
 *
 * THE INITIAL MODE — CS:0xecc5. Note the push/pop around a DI clobber; read
 * `[di+0x100]` as an ENTITY field and a port writes garbage:
 *     ecc6  push di
 *     ecc9  call 0xf0d9                ; DI := plane-B pointer for the spawn cell
 *     eccc  cmp byte [di+0x100],0x1    ; ground two rows below? EXACTLY == 1
 *     ecd3  mov cx,2                   ; not ground -> +2 (a fall mode)
 *     ecd6  mov ax,[si+0x4] / xchg al,ah / shr ax,9 / and ax,1 / add ax,bx
 *     ece7  pop di / mov [di+0xa],ax
 *
 * ALL ENTITIES OF A GROUP SPAWN AT THE SAME POINT — only the appearance TIME
 * differs. It is not the plane-B cell that triggered them; those are unrelated
 * (0 of 201 shipped selector-4 trigger cells coincide with their descriptor's
 * own spawn tile).
 *
 * MEASURED ACROSS THE 8 SHIPPED LEVELS: 270 live System-B descriptors
 * (14/14/30/28/50/50/42/42), entity counts {1,2,3,4,5,10}, speeds
 * {1,7,8,9,10}, spawn tiles X 1..126 and Y 1..60 — inside the 128x64 map on
 * every one.
 */

export const DESC_B_OFF = 0x11A4;   // -> DS:0xa1ac
export const DESC_A_OFF = 0x0D58;   // -> DS:0x9d60
export const DESC_STRIDE = 0x16;
export const DESC_COUNT  = 50;
export const RUNTIME_SLOTS = 10;    // SS:0x36b4, stride 0x12
export const MAX_ENTITIES  = 10;    // per group; the original never checks this
export const SELECTOR_SPAWN_B = 4;
export const SELECTOR_SPAWN_A = 5;

/** Parse the 50 System-A group descriptors out of a decompressed PALFILS.
 *  Field positions per entity-a.js's header table and CLAUDE.md's System-A
 *  pipeline closure this session. +0x01 (hp) is read by structural analogy
 *  with System B, not from a System-A-specific instruction — see
 *  UNKNOWN_sysA_descriptor_hp in entity-a.js. */
export function parseGroupsA(buf) {
  const out = [];
  for (let i = 0; i < DESC_COUNT; i++) {
    const o = DESC_A_OFF + i * DESC_STRIDE;
    const b = buf.subarray(o, o + DESC_STRIDE);
    out.push({
      index: i,
      count:   b[0x00],                       // materialise loop, CS:0xde80
      hp:      b[0x01],                        // UNKNOWN_sysA_descriptor_hp
      flags:  (b[0x04] << 8) | b[0x05],       // big-endian; bit 0x100 = random-member select
      fireByte: b[0x06],                       // stage 6 (CS:0xe659): lo nibble reload rate, hi nibble direction/config
      cls:     b[0x07],                        // sprite-class index, CS:0xe199
      seedPair:   b[0x08],                     // stage 1 strategy nibble pair, CS:0xe748
      seedWeight: b[0x09],                     // stage 1 weight, 7-bit
      speedCap:   signByte(b[0x0b]),           // stage 4 (CS:0xe44d) clamp
      stepCap:    signByte(b[0x0c]),           // stage 2 (CS:0xe336) steering-step cap partner, also stage 3's (unported) range gate
      extra:      b[0x0e],                     // copied to group-runtime +0x6 at materialise; consumer not traced
      attackGate: b[0x0f],                     // stage 3 (CS:0xe487) gate — stage 3 is NOT ported
      tileX:   b[0x12],
      tileY:   b[0x13],
      live:    b[0x00] !== 0,
    });
  }
  return out;
}

const signByte = (b) => (b & 0x80 ? b - 0x100 : b);

/** Parse the 50 System-B group descriptors out of a decompressed PALFILS. */
export function parseGroupsB(buf) {
  const out = [];
  for (let i = 0; i < DESC_COUNT; i++) {
    const o = DESC_B_OFF + i * DESC_STRIDE;
    const b = buf.subarray(o, o + DESC_STRIDE);
    out.push({
      index: i,
      count:   b[0x00],                       // 1..10; 0 = dead record
      hp:      b[0x01],
      flags:  (b[0x04] << 8) | b[0x05],       // big-endian; bit 9 = initial facing
      fire:    b[0x06],                       // stage 6 (CS:0xe659, via entity.js's fireB):
                                                // lo nibble reload rate, hi nibble direction/config
      cls:     b[0x07],                       // sprite-class index
      /* The four fields the PATHFINDER reads — see pathfind.js / -producers.js.
       * +0x08 is two goal-strategy nibbles, +0x09 the 7-bit weight favouring
       * the low one, +0x0c the (signed) `> 4` gate on long hops, and +0x0d the
       * cost budget. All four were found by reading CS:0xf6f7, 0xfb9e and
       * 0xfd58; none of them is guesswork. */
      seedPair:   b[0x08],
      seedWeight: b[0x09],
      speed:   b[0x0b],                       // step delay = 10 - speed
      hopUnlock:  b[0x0c],
      budget:     b[0x0d],
      tileX:   b[0x12],
      tileY:   b[0x13],
      stagger: b[0x14],
      live:    b[0x00] !== 0,
    });
  }
  return out;
}

/* THE SPRITE CLASS TABLES live in GAME.EXE, not in any shipped asset, so they
 * are transcribed here the same way the player state table and the jump arc
 * are. DS:0xdf80 holds four worlds x two pointers; the SECOND of each pair is
 * System B's (CS:0xad62 takes the second word).
 *
 *   sprite = class_base + MODE_ANIM[mode] + frame          (CS:0xf0ae)
 *   with MODE_ANIM = [0, 9, 8, 17, 8, 17, 8, 17] from DS:0xdbe0.
 *
 * Records are 12 bytes {u16 sprite_base, u16 1, u16, u16 w, u16 h, u16},
 * terminated by 0xFFFF. Only base and size are transcribed.
 *
 * WHY THE BASES BEING 18 APART MATTERS: max anim_base is 17 and the walk
 * frame wraps at 7, but fall and hop pin the frame to 0, so the highest
 * reachable offset is 17 — exactly 18 descriptors per class. Within a System-B
 * table the 32x32 classes step by exactly 18. (An earlier pass in this project
 * saw "6 apart" and flagged a contradiction; that came from pooling the
 * System-A and System-B tables. System A's bases really are 6-8 apart, which
 * is consistent with it having a different animation model entirely.) */
export const CLASS_TABLES_B = {
  1: [{ base: 462, w: 32, h: 32 }, { base: 480, w: 32, h: 32 }, { base: 498, w: 32, h: 32 },
      { base: 498, w: 32, h: 32 }, { base: 498, w: 32, h: 32 }, { base: 532, w: 24, h: 24 },
      { base: 532, w: 24, h: 24 }, { base: 532, w: 24, h: 24 }],
  2: [{ base: 450, w: 32, h: 32 }, { base: 468, w: 32, h: 32 }, { base: 521, w: 32, h: 32 },
      { base: 525, w: 24, h: 24 }, { base: 486, w: 32, h: 32 }, { base: 521, w: 24, h: 24 },
      { base: 521, w: 24, h: 24 }, { base: 521, w: 24, h: 24 }],
  3: [{ base: 450, w: 32, h: 32 }, { base: 450, w: 32, h: 32 }, { base: 468, w: 32, h: 32 },
      { base: 516, w: 24, h: 24 }, { base: 450, w: 32, h: 32 }, { base: 450, w: 32, h: 32 },
      { base: 450, w: 32, h: 32 }],
  4: [{ base: 450, w: 32, h: 32 }, { base: 486, w: 32, h: 32 }, { base: 468, w: 32, h: 32 },
      { base: 547, w: 24, h: 24 }, { base: 486, w: 32, h: 32 }, { base: 486, w: 32, h: 32 },
      { base: 486, w: 32, h: 32 }],
};

/* The per-world creature atlases start at descriptor #450 — `always` (170) +
 * `objects` (280). Independently: this project separately established that
 * PLEVEL<N><X>.PI1 is "not a terrain tileset despite the name — a 60-frame
 * 32x32 creature animation strip", which is exactly what a monster group at
 * #450 has to be.
 *
 * VALIDATION. Group extents from the shipped atlas counts:
 *     world 1  #450..#538 (89)    world 2  #450..#540 (91)
 *     world 3  #450..#539 (90)    world 4  #450..#555 (106)
 * Taken across ALL table entries, the single highest base in each world would
 * overflow by 1-11 (532, 525, 523, 547 — three of them 24x24). But restricted
 * to the 9 classes the shipped descriptors actually REFERENCE, every one fits:
 * `base + 17 <= last` on all four worlds. So the overflowing entries are dead
 * table rows, and the formula is consistent everywhere it is exercised.
 * The port still range-checks each computed sprite and refuses to draw one
 * that escapes the group, rather than silently indexing a font glyph. */
export const CREATURE_DESCRIPTOR_BASE = 450;

/** CS:0xf0ae — the sprite composition, verbatim. */
export function spriteForEntity(world, cls, mode, frame, MODE_ANIM) {
  const table = CLASS_TABLES_B[world];
  const rec = table && table[cls];
  if (!rec) return null;                     // class index past the terminator
  return rec.base + MODE_ANIM[mode] + frame;
}

/** Runtime group slot — SS:0x36b4, 10 slots of 0x12 bytes. */
export class GroupSlots {
  constructor() {
    this.slots = Array.from({ length: RUNTIME_SLOTS }, () => ({ state: 0, desc: null }));
    this.lostActivations = 0;   // slots-busy drops, surfaced not swallowed
  }
  /** CS:0xde08. Returns false when every slot is busy — the original's
   *  activation is already consumed by then, so it is lost for good. */
  activate(desc) {
    const free = this.slots.find((s) => s.state === 0);
    if (!free) { this.lostActivations++; return false; }
    free.state = 2;
    free.desc = desc;
    return true;
  }
}
