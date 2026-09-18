/* canvas-view.js — the editor's world view: reuses `Renderer.drawTilemap`/
 * `present` UNMODIFIED (same fixed 320x200 "camera window" the real game
 * uses, panned in world pixels — no separate zoom concept needed, the
 * canvas element's own size just picks the integer scale `present()`
 * already computes). Adds: keyboard panning, and mouse click -> world-pixel
 * hit-testing for painting tiles / picking objects & triggers — the
 * project's first interactive canvas code (no prior mouse-handling
 * precedent existed in `src/`, per this feature's own research pass).
 */

import { Renderer } from '../render/renderer.js';
import { SCREEN_W, SCREEN_H, TILE_W, TILE_H } from '../formats/pi1.js';
import { MAP_COLS, MAP_ROWS } from '../formats/map.js';

const WORLD_W = MAP_COLS * TILE_W;   // 4096
const WORLD_H = MAP_ROWS * TILE_H;   // 1024
const PAN_SPEED = 16;                // world px per keypress-tick

export class CanvasView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.camX = 0; this.camY = 0;
    this.keys = new Set();
    canvas.addEventListener('mousedown', (e) => { this._dragging = true; this._onClick(e, false); });
    window.addEventListener('mouseup', () => { this._dragging = false; });
    canvas.addEventListener('mousemove', (e) => {
      if (this._dragging && (e.buttons & 1)) this._onClick(e, true);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.tabIndex = 0;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        this.keys.add(e.key); e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    this.onPick = null;   // (worldX, worldY, ev) => void — set by main.js
  }

  tickPan() {
    if (this.keys.has('ArrowLeft'))  this.camX -= PAN_SPEED;
    if (this.keys.has('ArrowRight')) this.camX += PAN_SPEED;
    if (this.keys.has('ArrowUp'))    this.camY -= PAN_SPEED;
    if (this.keys.has('ArrowDown'))  this.camY += PAN_SPEED;
    this.camX = Math.max(0, Math.min(WORLD_W - SCREEN_W, this.camX));
    this.camY = Math.max(0, Math.min(WORLD_H - SCREEN_H, this.camY));
  }

  /** Mirrors `Renderer.present`'s own integer-scale-centered transform —
   *  duplicated here (not exposed by Renderer) so click coordinates can be
   *  mapped back to world pixels; see that method's own header. */
  _scaleAndOffset() {
    const { width: cw, height: ch } = this.canvas;
    const scale = Math.max(1, Math.min((cw / SCREEN_W) | 0, (ch / SCREEN_H) | 0));
    const dw = SCREEN_W * scale, dh = SCREEN_H * scale;
    return { scale, offX: ((cw - dw) / 2) | 0, offY: ((ch - dh) / 2) | 0 };
  }

  canvasToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = (clientX - rect.left) * (this.canvas.width / rect.width);
    const cy = (clientY - rect.top) * (this.canvas.height / rect.height);
    const { scale, offX, offY } = this._scaleAndOffset();
    return {
      x: this.camX + Math.floor((cx - offX) / scale),
      y: this.camY + Math.floor((cy - offY) / scale),
    };
  }

  _onClick(e, isDrag) {
    const { x, y } = this.canvasToWorld(e.clientX, e.clientY);
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return;
    if (this.onPick) this.onPick(x, y, e, isDrag);
  }

  /** Draw the tilemap (reusing Renderer.drawTilemap unmodified) plus simple
   *  colour-block markers for objects/triggers — no sprite atlas is wired
   *  into the editor (out of v1 scope, see editor/main.js's own header);
   *  markers are picked/edited through the side-panel list, not by sprite
   *  recognition, so a flat colour box is enough to place and select them. */
  draw(model, tiles, palette, opts = {}) {
    const r = this.renderer;
    r.clear(0);
    r.drawTilemap({ planeA: model.planeA }, tiles, this.camX, this.camY);

    if (opts.showPlaneB) {
      for (let row = 0; row < MAP_ROWS; row++) {
        for (let col = 0; col < MAP_COLS; col++) {
          const v = model.planeB[row * MAP_COLS + col];
          if (!v) continue;
          const sx = col * TILE_W - this.camX, sy = row * TILE_H - this.camY;
          if (sx < -TILE_W || sy < -TILE_H || sx > SCREEN_W || sy > SCREEN_H) continue;
          const idx = v === 1 ? 4 : v === 2 ? 6 : 12;   // solid/climbable/event tint
          r.strokeRect(sx, sy, TILE_W, TILE_H, idx);
        }
      }
    }

    if (opts.showObjects) {
      model.objects.forEach((o, i) => {
        if (o.type === 0xFFFF) return;
        const sx = o.x - this.camX, sy = o.y - this.camY;
        if (sx < -8 || sy < -8 || sx > SCREEN_W || sy > SCREEN_H) return;
        const sel = i === opts.selectedObject;
        r.fillRect(sx, sy, 8, 8, sel ? 14 : (o.type >= 0xC0 ? 2 : 10));
        r.strokeRect(sx, sy, 8, 8, 15);
      });
    }

    if (opts.showTriggers) {
      model.triggers.forEach((t, i) => {
        if (!opts.isLive(t)) return;
        const sx = t.x - this.camX, sy = t.y - this.camY;
        if (sx < -6 || sy < -6 || sx > SCREEN_W || sy > SCREEN_H) return;
        const sel = i === opts.selectedTrigger;
        r.strokeRect(sx - 3, sy - 3, 7, 7, sel ? 14 : 3);
      });
    }

    r.present(palette);
  }
}

export { WORLD_W, WORLD_H };
