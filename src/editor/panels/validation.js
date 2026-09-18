/* panels/validation.js — live, non-blocking sanity checks, following the
 * same check(name, pass, detail) convention `src/verify/checks.js` uses
 * (see that file's `makeChecker()`) so this panel reads like the rest of
 * the project's own "grounded in facts, not assumed" checks, just scoped
 * to whatever level is currently loaded in the editor.
 */
import { isLive as isTriggerLive, verbOf } from '../../game/trigger.js';
import { MAP_COLS, MAP_ROWS } from '../../formats/map.js';

export function runValidation(model, tileCount) {
  const results = [];
  const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

  /* Plane A tile ids must be 0 (empty) or in 1..tileCount (map.js's own
   * PLANE_A_BASE=1 closure). */
  let badTiles = 0;
  for (let i = 0; i < model.planeA.length; i++) {
    const v = model.planeA[i];
    if (v !== 0 && (v < 1 || v > tileCount)) badTiles++;
  }
  check(`plane A: every nonzero cell is a legal tile id (1..${tileCount})`,
    badTiles === 0, badTiles ? `${badTiles} cell(s) out of range` : '');

  /* Objects: world bounds (docs' own observed max x<4096, y<1024). */
  const oob = model.objects.filter((o) => o.type !== 0xFFFF &&
    (o.x >= MAP_COLS * 32 || o.y >= MAP_ROWS * 16)).length;
  check('objects: every live object is inside the 4096x1024 world', oob === 0,
    oob ? `${oob} object(s) out of bounds` : '');

  /* Triggers: field ranges the dispatch tables actually support (docs'
   * own observed maxima: cond_kind <=16, action verb <=14, messageId <=39). */
  let badCond = 0, badVerb = 0, badMsg = 0;
  model.triggers.forEach((t) => {
    if (!isTriggerLive(t)) return;
    if (t.condKind.some((k) => k < 0 || k > 16)) badCond++;
    if (verbOf(t) > 14) badVerb++;
    if (t.messageId > 39) badMsg++;
  });
  check('triggers: every condKind is 0-16', badCond === 0, badCond ? `${badCond} record(s)` : '');
  check('triggers: every action verb is 0-14', badVerb === 0, badVerb ? `${badVerb} record(s)` : '');
  check('triggers: every messageId is 0-39', badMsg === 0, badMsg ? `${badMsg} record(s)` : '');

  /* Best-effort plane-B event / trigger action-5 cross-check — see this
   * file's own header. Not a proven index-base match (planeB's own event
   * index is v-3, trigger action 5's arg is a SEPARATE 1-based index into
   * the same table with its own -1 offset — the exact arg<->v relationship
   * isn't nailed down here), so this only warns when a level has EITHER
   * plane-B event cells OR action-5 triggers but not both, a much weaker
   * but safe signal that something is probably disconnected. */
  const hasEventCells = model.planeB.some((v) => v >= 3);
  const hasAct5 = model.triggers.some((t) => isTriggerLive(t) && verbOf(t) === 5);
  check('plane-B event cells and action-5 (dispatch event) triggers are both present or both absent',
    hasEventCells === hasAct5 || (!hasEventCells && !hasAct5),
    !hasEventCells && hasAct5 ? 'action-5 triggers exist but no plane-B event cell reaches them'
      : hasEventCells && !hasAct5 ? 'plane-B event cells exist but no action-5 trigger dispatches them' : '');

  return results;
}

export function renderValidation(container, results) {
  container.innerHTML = '';
  results.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'chk' + (r.pass ? '' : ' bad');
    const m = document.createElement('span'); m.className = 'm'; m.textContent = r.pass ? '✓' : '✗';
    const t = document.createElement('span'); t.textContent = r.name + (r.detail ? ` — ${r.detail}` : '');
    row.append(m, t);
    container.appendChild(row);
  });
}
