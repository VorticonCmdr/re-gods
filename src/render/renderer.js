/* renderer.js — 320x200 indexed-colour software renderer.
 *
 * PROVENANCE
 *   The original targets BIOS mode 0Dh: 320x200, 16 colours, 4 bitplanes —
 *   matching the Atari ST source art 1:1, which is why the assets were never
 *   converted. It scrolls in HARDWARE (CRTC start address for coarse, ATC
 *   index 0x13 pixel panning for fine) over a 352-px virtual scanline with
 *   two pages at A000:0000 and A226:0000.
 *
 *   This renderer reproduces the VISIBLE RESULT (a 320x200 indexed frame with
 *   a free-scrolling camera), not the hardware mechanism. That is a port-level
 *   choice and is called out here rather than passed off as fidelity: nothing
 *   below claims to model CRTC registers or page flipping.
 */

import { SCREEN_W, SCREEN_H, TILE_W, TILE_H } from '../formats/pi1.js';
import { MAP_COLS, MAP_ROWS } from '../formats/map.js';

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.frame = new ImageData(SCREEN_W, SCREEN_H);
    this.buf = new Uint8Array(SCREEN_W * SCREEN_H);   // palette indices
    this.off = document.createElement('canvas');
    this.off.width = SCREEN_W; this.off.height = SCREEN_H;
    this.offCtx = this.off.getContext('2d', { alpha: false });
    this.offCtx.imageSmoothingEnabled = false;
    /* show cells the tile model cannot yet explain (see drawTilemap) */
    this.showUnknownTiles = true;
  }

  clear(index = 0) { this.buf.fill(index); }

  /**
   * Draw the plane-A tilemap for a camera position, in world pixels.
   * Tiles are 32x16 and the map is 128x64 cells (proven; see formats/map.js).
   */
  drawTilemap(map, tiles, camX, camY) {
    const firstCol = Math.max(0, camX >> 5);
    const firstRow = Math.max(0, camY >> 4);
    const lastCol  = Math.min(MAP_COLS - 1, (camX + SCREEN_W) >> 5);
    const lastRow  = Math.min(MAP_ROWS - 1, (camY + SCREEN_H) >> 4);

    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        const B = map.planeA[row * MAP_COLS + col];
        const sx = col * TILE_W - camX;
        const sy = row * TILE_H - camY;

        /* PLANE A IS 1-BASED: source offset = 64 * (B - 1). See formats/map.js.
         * Export 0 applies no mask and no bounds check, so B outside [1,count]
         * simply reads the tile cache outside the region export 17 filled —
         * export 17 has no memset, it writes `count` tiles and stops.
         * On a fresh level load that tail is zeros, so those cells draw as
         * colour 0. We reproduce the fresh-load result (empty) rather than
         * emulating uninitialised VRAM, and mark them when asked so the
         * distinction stays visible. */
        const idx = B - 1;
        const tile = (idx >= 0 && idx < tiles.length) ? tiles[idx] : null;
        if (!tile) {
          if (this.showUnknownTiles && B !== 0) {
            this.strokeRect(sx, sy, TILE_W, TILE_H, 12);
          }
          continue;
        }
        this.blitTile(tile, sx, sy);
      }
    }
  }

  /**
   * Draw extra plane-A-shaped tiles that are not part of the level's own
   * static plane A — the selector 7-10 line-barrier system's own footprint
   * (game/line-barriers.js). Drawn immediately after the tilemap itself, in
   * the same 1-based tile-id convention as drawTilemap (`tile = tileId-1`).
   * @param {Iterable<{col:number,row:number,tileId:number}>} cells
   */
  drawExtraTiles(cells, tiles, camX, camY) {
    for (const { col, row, tileId } of cells) {
      const tile = (tileId >= 1 && tileId <= tiles.length) ? tiles[tileId - 1] : null;
      if (!tile) continue;
      this.blitTile(tile, col * TILE_W - camX, row * TILE_H - camY);
    }
  }

  /** Blit one 32x16 indexed tile, clipped. Index 0 is transparent. */
  blitTile(tile, dx, dy) {
    for (let y = 0; y < TILE_H; y++) {
      const py = dy + y;
      if (py < 0 || py >= SCREEN_H) continue;
      const rowOff = py * SCREEN_W;
      const src = y * TILE_W;
      for (let x = 0; x < TILE_W; x++) {
        const px = dx + x;
        if (px < 0 || px >= SCREEN_W) continue;
        const v = tile[src + x];
        if (v) this.buf[rowOff + px] = v;
      }
    }
  }

  /**
   * Blit an indexed sprite, clipped, colour 0 transparent.
   * The original's masked blitters are exports 1 and 2 of the graphics driver;
   * this reproduces the visible result, not the EGA latch mechanism.
   * @param {{w:number,h:number,pixels:Uint8Array}} f
   */
  blitSprite(f, dx, dy) {
    for (let y = 0; y < f.h; y++) {
      const py = dy + y;
      if (py < 0 || py >= SCREEN_H) continue;
      const rowOff = py * SCREEN_W, src = y * f.w;
      for (let x = 0; x < f.w; x++) {
        const px = dx + x;
        if (px < 0 || px >= SCREEN_W) continue;
        const v = f.pixels[src + x];
        if (v) this.buf[rowOff + px] = v;
      }
    }
  }

  /**
   * Blit the status panel's 320xN index band, opaque, at world screen row
   * `dy` (no clipping needed: it's always the full SCREEN_W wide and never
   * contains index 0 in its real content — see game/status-panel.js).
   * Drawn LAST, after the tilemap/entities, so it also covers whatever the
   * unclipped world renderer draws below row 160 — the original's own
   * viewport never shows that area at all (`UNKNOWN_playfield_height`).
   * @param {{indices:Uint8Array,w:number,h:number}} panel
   */
  blitStatusPanel(panel, dy) {
    this.buf.set(panel.indices.subarray(0, panel.w * panel.h), dy * SCREEN_W);
  }

  /**
   * Blit a full 320x200 decoded image (formats/pi1.js's `decodePI1` shape)
   * as an opaque backdrop, e.g. the title screen's PBACKSCR.PI1. Unlike
   * blitTile/blitSprite, index 0 is NOT transparent here — a full-screen
   * background has nothing beneath it to show through.
   * @param {{indices:Uint8Array}} image
   */
  blitBackground(image) {
    this.buf.set(image.indices.subarray(0, SCREEN_W * SCREEN_H));
  }

  /** Debug rectangle in a palette index (used for the hero box). */
  fillRect(x, y, w, h, index) {
    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= SCREEN_H) continue;
      const o = yy * SCREEN_W;
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || xx >= SCREEN_W) continue;
        this.buf[o + xx] = index;
      }
    }
  }
  strokeRect(x, y, w, h, index) {
    this.fillRect(x, y, w, 1, index);
    this.fillRect(x, y + h - 1, w, 1, index);
    this.fillRect(x, y, 1, h, index);
    this.fillRect(x + w - 1, y, 1, h, index);
  }

  /** Expand indices through the 16-entry palette and present. */
  present(palette) {
    const px = this.frame.data;
    const buf = this.buf;
    for (let i = 0, j = 0; i < buf.length; i++, j += 4) {
      const c = buf[i] * 4;
      px[j]     = palette[c];
      px[j + 1] = palette[c + 1];
      px[j + 2] = palette[c + 2];
      px[j + 3] = 255;
    }
    this.offCtx.putImageData(this.frame, 0, 0);
    const { width: cw, height: ch } = this.canvas;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, cw, ch);
    /* Integer-scale to preserve the pixel grid. */
    const scale = Math.max(1, Math.min((cw / SCREEN_W) | 0, (ch / SCREEN_H) | 0));
    const dw = SCREEN_W * scale, dh = SCREEN_H * scale;
    this.ctx.drawImage(this.off, ((cw - dw) / 2) | 0, ((ch - dh) / 2) | 0, dw, dh);
  }

  /**
   * Solid black, bypassing the palette entirely. The original's "QUIT" is a
   * plain `INT 21h AH=4Ch` DOS terminate (docs/dynamic-trace-and-runtime-
   * data.md's title-screen section) — a browser tab cannot exit, so this is
   * the port's own stand-in: not modelling any original mechanism, same as
   * this file's own header already discloses for the tilemap renderer.
   */
  presentBlack() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
