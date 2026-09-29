/* state.js — the level editor's in-memory model: load/new/dirty-tracking/save.
 *
 * The model shape matches what `parseMap`/`parseAllTriggers` already produce
 * (see `formats/map.js`, `game/trigger.js`) so it can be handed straight to
 * `map-writer.js`'s `serializeMap` with no translation layer, and so the
 * editor's canvas can reuse `Renderer.drawTilemap` unmodified.
 */

import { dclDecompress } from '../formats/dcl.js';
import { dclCompressStore } from '../formats/dcl-encode.js';
import { decodePI1, sliceTiles } from '../formats/pi1.js';
import { parseMap, TILE_COUNTS, MAP_COLS, MAP_ROWS, MSG_OFF, TRIG_OFF } from '../formats/map.js';
import { serializeMap, blankMap } from '../formats/map-writer.js';
import { parseAllTriggers, isLive as isTriggerLive } from '../game/trigger.js';
import { fetchRaw } from '../io/game-files.js';

/** Tile sheet + palette for a level key, e.g. "1A" — reuses main.js's own
 *  asset resolution (PBITS/PXTRA/PLEVEL, TILE_COUNTS) without the rest of
 *  the game's runtime state (PAT/PALFILS/enemy classes etc.), which the
 *  editor doesn't render. */
export async function loadTileAssets(key) {
  const bitsRaw = await fetchRaw(`game/PBITS${key}.PI1`);
  const sheet = decodePI1(dclDecompress(bitsRaw).data);
  const palRaw = await fetchRaw(`game/PLEVEL${key}.PI1`);
  const palette = decodePI1(dclDecompress(palRaw).data).palette;

  const count = TILE_COUNTS[key];
  let tiles = sliceTiles(sheet).slice(0, Math.min(count, 120));
  if (count > 120) {
    const xRaw = await fetchRaw(`game/PXTRA${key}.PI1`);
    const extra = sliceTiles(decodePI1(dclDecompress(xRaw).data));
    tiles = tiles.concat(extra.slice(0, count - 120));
  }
  return { tiles, tileCount: count, palette };
}

/** Load an existing shipped level, keeping the raw compressed bytes so an
 *  UNMODIFIED save can pass them through byte-identical. */
export async function loadLevel(key) {
  const rawCompressed = await fetchRaw(`game/PLEV${key}.MAP`);
  const { data: decompressed } = dclDecompress(rawCompressed);
  const map = parseMap(decompressed);
  const triggers = parseAllTriggers(map.bulk);
  const model = {
    count: map.count, headerWord: map.headerWord, headerTable: map.headerTable,
    planeA: Uint8Array.from(map.planeA), planeB: Uint8Array.from(map.planeB),
    objects: map.objects.map((o) => ({ ...o })),
    messages: map.messages.slice(),
    triggers: triggers.map((t) => ({ ...t, condKind: [...t.condKind], condArg: [...t.condArg] })),
  };
  const assets = await loadTileAssets(key);
  return {
    levelKey: key, dirty: false,
    originalCompressed: rawCompressed, originalDecompressed: decompressed,
    model, ...assets,
  };
}

/** A brand-new, empty level. Since a level needs a real tile sheet to be
 *  paintable at all and none is "the" default, this loads world 1's own
 *  tile assets (the same ones "load 1A" would) as a starting palette —
 *  the level itself is fully blank (`blankMap()`), not a copy of 1A. */
export async function newLevel() {
  const assets = await loadTileAssets('1A');
  return {
    levelKey: null, dirty: true,
    originalCompressed: null, originalDecompressed: null,
    model: blankMap(), ...assets,
  };
}

/** True if the current model would serialize to exactly the bytes the level
 *  was loaded with (outside the message pool's own many-to-one encoding —
 *  see map-writer.js's header). Cheap because the planes/objects/triggers
 *  sections are plain arrays we can byte-compare directly against the
 *  original decompressed buffer without a full re-serialize. */
export function isUnmodified(state) {
  if (!state.originalDecompressed) return false;
  const reser = serializeMap(state.model);
  /* Only compare outside the message-pool span — see map-writer.js. */
  const bulkStart = 4 + state.model.count * 2;
  const msgStart = bulkStart + MSG_OFF, msgEnd = bulkStart + TRIG_OFF;
  if (reser.length !== state.originalDecompressed.length) return false;
  for (let i = 0; i < reser.length; i++) {
    if (i >= msgStart && i < msgEnd) continue;
    if (reser[i] !== state.originalDecompressed[i]) return false;
  }
  /* Messages compared by decoded VALUE, not bytes (many-to-one encoding). */
  const reparsed = parseMap(reser);
  const orig = parseMap(state.originalDecompressed);
  for (let i = 0; i < reparsed.messages.length; i++) {
    if (reparsed.messages[i] !== orig.messages[i]) return false;
  }
  return true;
}

/**
 * Produce the bytes to write out as `PLEV<key>.MAP` (or a chosen filename
 * for a new level): the ORIGINAL compressed bytes, byte-identical, when the
 * model hasn't changed from what was loaded; otherwise a freshly serialized
 * + `dclCompressStore`-compressed file.
 */
export function exportMapFile(state) {
  if (isUnmodified(state)) return state.originalCompressed;
  const decompressed = serializeMap(state.model);
  return dclCompressStore(decompressed);
}

export function markDirty(state) { state.dirty = true; }

export function liveObjectCount(model) {
  return model.objects.filter((o) => o.type !== 0xFFFF).length;
}
export function liveTriggerCount(model) {
  return model.triggers.filter(isTriggerLive).length;
}

export { MAP_COLS, MAP_ROWS };
