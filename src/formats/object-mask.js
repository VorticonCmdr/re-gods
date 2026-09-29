/* object-mask.js — the per-world `objects` load mask, and the frames it aliases.
 *
 * PROVENANCE (Gods ranked items 62 and 63)
 *   CS:0x2B6F sets `SS:0x414 = 0` for the `objects` group load only, with the
 *   mask at `SS:0x51B2 + (world - 1) * 40`: 20 big-endian words, one bit per
 *   `objects` frame, MSB first (`ss lodsw / xchg al,ah`, then `rcl`). Bit i is
 *   descriptor 170 + i. A set bit builds the frame's pixels into the sprite
 *   arena. A CLEAR bit writes a descriptor with the frame's own width and
 *   height but the CURRENT arena pointer, and copies nothing. So the frame
 *   draws the bytes of the next frame that is built, read with its own
 *   geometry.  [PROVEN] live, world 1B, 2B and 4A (descriptors 194-197 all
 *   point at 198's pixels in world 2; 225/232/233 at 239's in world 1).
 *
 *   The four masks below are the 160 bytes at GAME.EXE image offset
 *   0x1F3D0 + 0x51B2 (SS = load + 0x1F3D). Their popcounts, 114/145/152/131,
 *   equal the frame counts read live in item 62.
 *
 * THE ARENA FORMAT, 16-pixel-wide frames only. Each built frame is five
 * planes one after another, mask first then colour planes 0-3, each plane
 * `h` big-endian words, bit 15 = pixel x 0. A mask bit of 1 is transparent;
 * colour index 0 is the only transparent colour when a frame is built.
 * [PROVEN]: encoding the port's own frames reproduces live arena dumps
 * byte for byte (198-199 in world 2; 175-176 and 204-206 in world 4).
 *
 * An aliased frame whose height differs from the frame it lands on reads the
 * planes out of step, so it comes out scrambled, and it can have OPAQUE
 * colour-0 pixels. Those are returned in `opaque0` (the renderer draws index 0
 * there), since the port's frames otherwise use index 0 as transparent.
 *
 * 32-pixel frames use a layout this pass did not read. An alias that needs
 * one (as the alias, or anywhere in the bytes it reads) is left with its own
 * pixels and listed in `unresolved`. No shipped placement, trigger spawn or
 * referenced drop lands on one (checks.js).
 */

export const OBJECTS_BASE = 170;
export const MASK_BITS = 320;

/* SS:0x51B2 + (world - 1) * 40, worlds 1-4. */
const MASK_HEX = [
  'ff7fffc03e293e00079f900010000301cae5c0007f87f8007ffe0000007fc000ffe0000000000000',
  'b77fff0e3fe97e0f4f83dff9010df00fda65c039ff87800001fe001ffc7f0000ffe0030000000000',
  'ff7fff003fec1fc0bf839004c00204cfc67e3800007f800001ffffffe3ff33e0fffffc0000000000',
  'b77fff003fed1e30078390022c018031e67e0000007f800001ffffffe0000c1fffffe30000000000',
];
export const OBJECT_LOAD_MASKS = MASK_HEX.map((h) =>
  Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16)));

/** Is `objects` frame `i` (descriptor 170 + i) built in `world`? */
export const isBuilt = (world, i) => {
  const m = OBJECT_LOAD_MASKS[world - 1];
  return !!((m[i >> 3] >> (7 - (i & 7))) & 1);
};

/** A built 16-wide frame's arena bytes. */
export function encodeFrame16(f) {
  const out = new Uint8Array(f.h * 10);
  let o = 0;
  for (let plane = -1; plane < 4; plane++) {
    for (let y = 0; y < f.h; y++) {
      let w = 0;
      for (let x = 0; x < 16; x++) {
        const v = f.pixels[y * 16 + x];
        if (plane < 0 ? v === 0 : (v >> plane) & 1) w |= 1 << (15 - x);
      }
      out[o++] = w >> 8; out[o++] = w & 0xFF;
    }
  }
  return out;
}

/** Read an `h`-row 16-wide frame out of arena bytes at `off`. */
export function decodeFrame16(arena, off, h) {
  const word = (i) => (arena[off + 2 * i] << 8) | arena[off + 2 * i + 1];
  const pixels = new Uint8Array(16 * h);
  let opaque0 = null;
  for (let y = 0; y < h; y++) {
    const m = word(y);
    for (let x = 0; x < 16; x++) {
      const bit = 15 - x;
      if ((m >> bit) & 1) continue;
      let v = 0;
      for (let p = 0; p < 4; p++) v |= ((word(h * (p + 1) + y) >> bit) & 1) << p;
      if (v) pixels[y * 16 + x] = v;
      else (opaque0 ??= new Uint8Array(16 * h))[y * 16 + x] = 1;
    }
  }
  return { pixels, opaque0 };
}

/**
 * Apply `world`'s mask to the `objects` frames, in place.
 * @param {Array<{w:number,h:number,pixels:Uint8Array}>} frames  by descriptor
 * @param {number} base   first `objects` descriptor (170)
 * @param {number} count  frames in the group (280)
 * @returns {{aliased: Array<{id:number, target:number}>, unresolved: number[]}}
 */
export function applyObjectLoadMask(frames, base, count, world) {
  /* The built frames' arena, in load order. `at[i]` is where frame i's
   * descriptor points: its own bytes if built, else the next built frame's. */
  const parts = [], at = [], builtNext = [];
  let off = 0, wide = false;
  const wideFrom = [];            // arena offsets where a non-16 frame starts
  for (let i = 0; i < count; i++) {
    at[i] = off;
    if (!isBuilt(world, i)) continue;
    const f = frames[base + i];
    if (f.w === 16) {
      const b = encodeFrame16(f);
      parts.push(b); off += b.length;
    } else {
      wideFrom.push(off);
      wide = true;
      const n = f.h * 5 * 2 * Math.ceil(f.w / 16);
      parts.push(new Uint8Array(n)); off += n;   // size only; layout unread
    }
  }
  const arena = new Uint8Array(off);
  let o = 0;
  for (const p of parts) { arena.set(p, o); o += p.length; }
  let next = count;
  for (let i = count - 1; i >= 0; i--) { builtNext[i] = next; if (isBuilt(world, i)) next = i; }

  const aliased = [], unresolved = [];
  for (let i = 0; i < count; i++) {
    if (isBuilt(world, i)) continue;
    const f = frames[base + i];
    const end = at[i] + f.h * 10;
    const hitsWide = wide && wideFrom.some((w) => w >= at[i] && w < end);
    if (f.w !== 16 || hitsWide || end > arena.length) { unresolved.push(base + i); continue; }
    const { pixels, opaque0 } = decodeFrame16(arena, at[i], f.h);
    frames[base + i] = { ...f, pixels, ...(opaque0 ? { opaque0 } : {}), aliasOf: base + builtNext[i] };
    aliased.push({ id: base + i, target: base + builtNext[i] });
  }
  return { aliased, unresolved };
}
