/* atlas.js — `P*.DAT` sprite atlas index into the same-named `.PI1`.
 *
 * PROVENANCE
 *   25 of the 31 shipped `P*.DAT` files match this schema exactly, and every
 *   atlas file is exactly `2 + 10*count` bytes. Big-endian throughout:
 *
 *     u16 count
 *     count x {
 *       u16 width  - 1
 *       u16 height - 1
 *       u16 word2      // PROVEN NEVER READ - dead padding
 *       u16 x          // pixel offset into the paired .PI1
 *       u16 y
 *     }
 *
 *   Two independent confirmations: in PGODFONT.DAT the `x` field steps by
 *   exactly the frame width and wraps to x=0, y+=16 after 320 (the DEGAS
 *   canvas width); and across ALL 1451 records in all 25 files,
 *   max(x+width) == 320 and max(y+height) == 200 — exactly the canvas.
 *
 *   `word2` is dead: the driver's parse loop dereferences only +0, +2, +6
 *   and +8, stepping over +4 with an `add si,4` whose result is never used.
 *   Two independent investigations reached that conclusion separately, and a
 *   byte scan of all three graphics drivers found no register-load encoding
 *   of `[si+4]` anywhere in the loop. It is safe to drop in a port; we parse
 *   it only to keep the record stride honest.
 *
 *   The parser lives in the GRAPHICS DRIVER (export 22), not in GAME.EXE —
 *   which is why earlier searches for an atlas consumer inside GAME.EXE came
 *   up empty. GAME.EXE owns the filenames and the file I/O; the driver owns
 *   parsing and the runtime descriptor layout.
 */

import { SCREEN_W } from './pi1.js';

/**
 * Parse a decompressed `P*.DAT`.
 * @param {Uint8Array} buf
 * @returns {{count:number, frames:{x,y,w,h,word2}[]}}
 */
export function parseAtlas(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint16(0, false);
  const expected = 2 + 10 * count;
  if (buf.length !== expected) {
    throw new Error(`atlas: ${buf.length} bytes, expected 2 + 10*${count} = ${expected}`);
  }
  const frames = [];
  for (let i = 0; i < count; i++) {
    const o = 2 + i * 10;
    frames.push({
      w:     dv.getUint16(o + 0, false) + 1,   // stored as width - 1
      h:     dv.getUint16(o + 2, false) + 1,   // stored as height - 1
      word2: dv.getUint16(o + 4, false),       // dead padding, always 0
      x:     dv.getUint16(o + 6, false),
      y:     dv.getUint16(o + 8, false),
    });
  }
  return { count, frames };
}

/** Cut one frame out of the paired decoded .PI1 as indexed pixels. */
export function cutFrame(img, frame) {
  const { x, y, w, h } = frame;
  const out = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const s = (y + row) * SCREEN_W + x;
    out.set(img.indices.subarray(s, s + w), row * w);
  }
  return out;
}

/** Cut every frame. */
export function cutAll(img, atlas) {
  return atlas.frames.map((f) => ({ ...f, pixels: cutFrame(img, f) }));
}

/**
 * Structural self-check used by the verification panel: every frame must lie
 * inside the 320x200 canvas, and across a whole atlas the extents should
 * reach the canvas edges.
 */
export function atlasStats(atlas) {
  let maxRight = 0, maxBottom = 0, outOfBounds = 0, word2NonZero = 0;
  for (const f of atlas.frames) {
    if (f.x + f.w > SCREEN_W || f.y + f.h > 200) outOfBounds++;
    if (f.word2 !== 0) word2NonZero++;
    maxRight = Math.max(maxRight, f.x + f.w);
    maxBottom = Math.max(maxBottom, f.y + f.h);
  }
  return { maxRight, maxBottom, outOfBounds, word2NonZero, count: atlas.count };
}
