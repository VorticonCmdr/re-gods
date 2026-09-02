/* descriptors.js — the runtime sprite descriptor numbering.
 *
 * PROVENANCE
 *   Sprites are addressed by a DESCRIPTOR INDEX, not by (atlas, frame).
 *   The descriptor table is 8 bytes per entry { -(w-1), h-1, arena_offset,
 *   arena_segment }, based at DS:0x0e = 0x1e00 (set by GAME.EXE at CS:0x294b).
 *   Export 22 builds descriptors as atlas groups load, advancing the cursor
 *   with `add word [bp+0x8],0x8`.
 *
 *   NUMBERING IS CUMULATIVE. GAME.EXE recovers an index by inverting the
 *   cursor arithmetic at CS:0x2C4B:
 *       mov ax,[0x68] / sub ax,0x1e00 / sar ax,1 (x3) / mov [0x27e],ax
 *
 *   CRITICAL for a port: the cursor advance appears on BOTH the load path and
 *   the skip path (VGA 0x0BD4 and 0x0CAA). So **every atlas record consumes a
 *   descriptor slot whether or not its pixels are loaded** — only the arena
 *   advances conditionally. Indices are therefore computable from frame
 *   counts alone and are stable across worlds, which is what makes this table
 *   usable at all.
 *
 *   Export 22 takes ONE group name per call (an earlier note describing a
 *   "NUL-separated worklist" was wrong — the NUL-separated list is the
 *   driver-side expansion of one group into stems).
 *
 *   TWO INDEPENDENT ANCHORS confirm the numbering, both verified here against
 *   the shipped atlases:
 *     - Export 21 is hard-wired to descriptor #127 (`add si,0x3fc` = 127*8+4).
 *       Under this map that is PALWAYS3 frame 16, measured 80x7 — exactly ten
 *       8x7 digit cells, which is what a per-frame glyph blit needs.
 *     - CS:0x28D7 (`sub word [0x134],8`) releases descriptor #169, which is
 *       PGODFONT frame 41, measured 208x46 — the GODS title logo.
 *   Neither dimension was fitted; both were predicted then measured.
 */

/* Group -> ordered atlas stems, from the driver's CS-resident name table and
 * its expansion pointer table (identical content in VGA.EXE and EGA.EXE). */
export const GROUP_STEMS = {
  always:   ['PALWAYS1', 'PALWAYS2', 'PALWAYS3', 'PGODFONT'],
  objects:  ['POBJ1', 'POBJ2'],
  smallfnt: ['PSMLFNT'],
  shop:     ['PSHOPSPR', 'PSHOPFNT'],
  level1:   ['PLEVEL1A', 'PLEVEL1B'],
  level2:   ['PLEVEL2A', 'PLEVEL2B'],
  level3:   ['PLEVEL3A', 'PLEVEL3B'],
  level4:   ['PLEVEL4A', 'PLEVEL4B'],
  guard1:   ['PGUARD11', 'PGUARD12'],
  guard2:   ['PAMDRAGN'],
  guard3:   ['PGUARD31', 'PGUARD32'],
  guard4:   ['PGUARD41', 'PGUARD42'],
  introft:  ['PINTROFT'],
};

/* Load order for a playing level:
 *   Epoch A (boot)      : `always`, cursor starts at 0x1e00 -> descriptor 0
 *   Epoch B (level load): `objects`, then `level<N>`, then `smallfnt`
 * The A-level load establishes the base; a B sub-level reuses it unchanged
 * (CS:0x2B4D early-exits when DS:0x43 != 0). */
export const LEVEL_LOAD_ORDER = (world) =>
  ['always', 'objects', `level${world}`, 'smallfnt'];

/**
 * Build descriptor index -> {stem, frame} for a given load order.
 * @param {string[]} groups      group names in load order
 * @param {(stem:string)=>number} frameCount  frames in a stem's atlas
 */
export function buildDescriptorMap(groups, frameCount) {
  const map = [];
  const ranges = [];
  for (const g of groups) {
    const stems = GROUP_STEMS[g];
    if (!stems) throw new Error(`unknown group ${g}`);
    for (const stem of stems) {
      const n = frameCount(stem);
      const base = map.length;
      for (let f = 0; f < n; f++) map.push({ stem, frame: f });
      ranges.push({ group: g, stem, base, count: n, last: base + n - 1 });
    }
  }
  return { map, ranges };
}

/* The hero's sprites, established by three converging facts:
 *   - the 29-state player table's anim_base values top out at 55;
 *   - PALWAYS1 is 36/39 frames at 32x48 (the rest 32x43/42, crouch variants);
 *   - PALWAYS2 frames 0..18 are also 32x48.
 * That is 55 hero-sized frames occupying descriptors #0..#57.
 * Sprite id = anim_base + sign_extend(cl), with three hard remaps applied at
 * CS:0x5f8b: 0x34->0x19, 0x36->0x23, 0x37->0x26. */
export const HERO_DESCRIPTOR_MAX = 57;
/* Sprite selection itself — the table, the labels and the remaps — lives in
 * game/states.js, which owns the whole state machine. Re-exported here so the
 * descriptor side has one import, not two sources of truth. */
export { SPRITE_REMAP, spriteFor } from '../game/states.js';
import { STATE_TABLE } from '../game/states.js';

/* anim_base for each of the 29 player states, read from DS:0xd818
 * (file 0x1d978) as the first word of each {anim_base, handler} pair.
 * Derived from the one table in game/states.js rather than restated, so the
 * two can never drift apart. */
export const PLAYER_ANIM_BASE = STATE_TABLE.map((s) => s.base);
