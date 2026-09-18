/* panels/tiles.js — the tile palette: one small canvas per sliced tile
 * (`sliceTiles()`, `formats/pi1.js`), click to select for plane-A painting.
 */
import { TILE_W, TILE_H } from '../../formats/pi1.js';

export class TilePalette {
  constructor(container, onSelect) {
    this.container = container;
    this.onSelect = onSelect;
    this.selected = 1;   // plane A is 1-based — tile id, not array index
  }

  /** @param {Uint8Array[]} tiles indexed tiles (0-based array; tile id = index+1)
   *  @param {number[]} palette flat RGBA palette from decodePI1 */
  render(tiles, palette) {
    this.container.innerHTML = '';
    tiles.forEach((tile, idx) => {
      const id = idx + 1;
      const c = document.createElement('canvas');
      c.width = TILE_W; c.height = TILE_H;
      c.title = `tile ${id}`;
      if (id === this.selected) c.classList.add('sel');
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(TILE_W, TILE_H);
      for (let i = 0, j = 0; i < tile.length; i++, j += 4) {
        const p = tile[i] * 4;
        img.data[j] = palette[p]; img.data[j+1] = palette[p+1];
        img.data[j+2] = palette[p+2]; img.data[j+3] = tile[i] ? 255 : 0;
      }
      ctx.putImageData(img, 0, 0);
      c.addEventListener('click', () => {
        this.selected = id;
        this.container.querySelectorAll('canvas.sel').forEach((el) => el.classList.remove('sel'));
        c.classList.add('sel');
        this.onSelect(id);
      });
      this.container.appendChild(c);
    });
  }
}
