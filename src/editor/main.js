/* editor/main.js — bootstraps the level editor page (editor.html): wires the
 * toolbar (load/new/save), the canvas view, and the 4 side panels together.
 *
 * SCOPE (v1, see the plan this was built from): edits `.MAP`-resident data
 * only — planes, the 200 static objects, the 100 triggers, the 40 messages.
 * Selectors 7-10's own obstacle table and teleport/exit zones live outside
 * the `.MAP` file entirely (`PALFILS`, or derived at runtime from trigger
 * actions) and are NOT edited here — see the plan's own "things placed
 * outside the .MAP file" note. Objects/triggers are drawn as flat colour
 * markers, not real sprites — no atlas is wired in, picking/editing goes
 * through the side-panel list, not sprite recognition.
 */
import { MAP_COLS, MAP_ROWS } from '../formats/map.js';
import { loadLevel, newLevel, exportMapFile, isUnmodified, liveObjectCount, liveTriggerCount } from './state.js';
import { CanvasView } from './canvas-view.js';
import { TilePalette } from './panels/tiles.js';
import { ObjectsPanel } from './panels/objects.js';
import { TriggersPanel } from './panels/triggers.js';
import { MessagesPanel } from './panels/messages.js';
import { runValidation, renderValidation } from './panels/validation.js';
import { isLive as isTriggerLive } from '../game/trigger.js';
import { ensureGameData } from '../io/game-files.js';

const $ = (id) => document.getElementById(id);

let state = null;
let mode = 'planeA';   // 'planeA' | 'planeB' | 'objects' | 'triggers'

const view = new CanvasView($('view'));
const tilePalette = new TilePalette($('tilePalette'), () => { $('tileSel').textContent = tilePalette.selected; });
const objectsPanel = new ObjectsPanel(
  { listEl: $('objectList'), formEl: $('objectForm'), countEl: $('objectCount'), addBtnEl: $('objectAddBtn') },
  onModelChanged);
const triggersPanel = new TriggersPanel(
  { listEl: $('triggerList'), formEl: $('triggerForm'), countEl: $('triggerCount') },
  onModelChanged, () => state.model.messages);
const messagesPanel = new MessagesPanel(
  { listEl: $('messageList'), formEl: $('messageForm'), countEl: $('messageCount') },
  onModelChanged);

function onModelChanged() {
  if (!state) return;
  state.dirty = true;
  $('dirty').classList.add('on');
  renderAll();
}

function setMode(next) {
  mode = next;
  ['modePlaneA', 'modePlaneB', 'modeObjects', 'modeTriggers'].forEach((id) => $(id).classList.remove('active'));
  $({ planeA: 'modePlaneA', planeB: 'modePlaneB', objects: 'modeObjects', triggers: 'modeTriggers' }[mode]).classList.add('active');
  $('tilesPanel').style.display = mode === 'planeA' ? '' : 'none';
  $('planeBPanel').style.display = mode === 'planeB' ? '' : 'none';
  const hints = {
    planeA: 'click/drag to paint the selected tile — arrow keys pan',
    planeB: 'click/drag to paint the selected attribute — arrow keys pan',
    objects: '"+ add object" then click, or click a marker to select — arrow keys pan',
    triggers: 'click empty ground to add a trigger, or click a marker to select — arrow keys pan',
  };
  $('hint').textContent = state ? hints[mode] : 'no level loaded';
}
$('modePlaneA').addEventListener('click', () => setMode('planeA'));
$('modePlaneB').addEventListener('click', () => setMode('planeB'));
$('modeObjects').addEventListener('click', () => setMode('objects'));
$('modeTriggers').addEventListener('click', () => setMode('triggers'));

$('planeBValue').addEventListener('change', () => {
  $('planeBCustomRow').style.display = $('planeBValue').value === 'custom' ? '' : 'none';
});

function tileIndex(x, y) {
  const col = Math.floor(x / 32), row = Math.floor(y / 16);
  if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return -1;
  return row * MAP_COLS + col;
}

view.onPick = (x, y, ev, isDrag) => {
  if (!state) return;
  if (mode === 'planeA') {
    const i = tileIndex(x, y);
    if (i >= 0) { state.model.planeA[i] = tilePalette.selected; onModelChanged(); }
  } else if (mode === 'planeB') {
    const i = tileIndex(x, y);
    if (i < 0) return;
    const sel = $('planeBValue').value;
    const v = sel === 'custom' ? Math.max(3, Math.min(255, +$('planeBCustom').value || 3)) : +sel;
    state.model.planeB[i] = v;
    onModelChanged();
  } else if (mode === 'objects' && !isDrag) {
    if (objectsPanel.placeAt(state.model, x, y)) onModelChanged();
  } else if (mode === 'triggers' && !isDrag) {
    if (triggersPanel.placeAt(state.model, x, y)) onModelChanged();
  }
};

function renderAll() {
  if (!state) return;
  view.draw(state.model, state.tiles, state.palette, {
    showPlaneB: mode === 'planeB',
    showObjects: mode === 'objects',
    showTriggers: mode === 'triggers',
    selectedObject: objectsPanel.selected,
    selectedTrigger: triggersPanel.selected,
    isLive: isTriggerLive,
  });
  objectsPanel.render(state.model);
  triggersPanel.render(state.model);
  messagesPanel.render(state.model);
  renderValidation($('validation'), runValidation(state.model, state.tileCount || 120));
  $('dirty').classList.toggle('on', state.dirty && !isUnmodified(state));
}

/* One rAF loop drives both keyboard panning and the redraw — cheap enough
 * (a 320x200 indexed blit) that a v1 editor doesn't need a dirty-rect
 * system; panels only re-render from `onModelChanged`, not every frame. */
function raf() {
  if (state) {
    view.tickPan();
    view.draw(state.model, state.tiles, state.palette, {
      showPlaneB: mode === 'planeB', showObjects: mode === 'objects', showTriggers: mode === 'triggers',
      selectedObject: objectsPanel.selected, selectedTrigger: triggersPanel.selected, isLive: isTriggerLive,
    });
  }
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

$('loadBtn').addEventListener('click', async () => {
  const key = $('levelSelect').value;
  if (!key) { alert('pick a level, or use "New" for a blank one'); return; }
  $('loadBtn').disabled = true;
  try {
    state = await loadLevel(key);
    objectsPanel.selected = -1; triggersPanel.selected = -1; messagesPanel.selected = -1;
    tilePalette.render(state.tiles, state.palette);
    view.camX = 0; view.camY = 0;
    setMode(mode);
    renderAll();
  } catch (e) {
    alert(`load failed: ${e.message}`);
    console.error(e);
  } finally {
    $('loadBtn').disabled = false;
  }
});

$('newBtn').addEventListener('click', async () => {
  state = await newLevel();
  objectsPanel.selected = -1; triggersPanel.selected = -1; messagesPanel.selected = -1;
  tilePalette.render(state.tiles, state.palette);
  view.camX = 0; view.camY = 0;
  setMode(mode);
  renderAll();
});

$('saveBtn').addEventListener('click', () => {
  if (!state) { alert('no level loaded'); return; }
  let bytes;
  try {
    bytes = exportMapFile(state);
  } catch (e) {
    alert(`save failed: ${e.message}`);
    console.error(e);
    return;
  }
  const name = state.levelKey ? `PLEV${state.levelKey}.MAP` : 'PLEVNEW.MAP';
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

setMode('planeA');

/* Load/New need the shipped files: served from game/ in dev, or picked with
 * the header's "Load folder…" in a build. */
ensureGameData({ button: $('btnFolder'), input: $('inpFolder'), status: $('status') }).then(() => {
  $('loadBtn').disabled = false;
  $('newBtn').disabled = false;
});
