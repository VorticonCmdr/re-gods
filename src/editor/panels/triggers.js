/* panels/triggers.js — the 100-slot trigger table editor.
 *
 * Labels/arg meanings below are sourced directly from `game/trigger.js`'s
 * own `evalCondition` dispatch (the engine's real behaviour, so this UI
 * can't drift from it) plus docs/triggers-and-difficulty.md's ACTION-verb
 * closure for the 15 action verbs (trigger.js only implements the
 * CONDITION side; ACTION dispatch lives in `game/trigger-actions.js`).
 * `reserved` is not exposed — always 0 in all 800 shipped records and
 * provably dead (map-format-and-filenames.md), this editor always writes 0.
 */
import { isLive, verbOf, consumesInventory } from '../../game/trigger.js';

export const CONDITIONS = [
  { k: 0,  label: '0 — always pass (arg unused)' },
  { k: 1,  label: '1 — inventory item IS held (arg = item id)' },
  { k: 2,  label: '2 — inventory item NOT held (arg = item id)' },
  { k: 3,  label: '3 — weapon IS in one of the 3 slots (arg = weapon id)' },
  { k: 4,  label: '4 — weapon NOT in any of the 3 slots (arg = weapon id)' },
  { k: 5,  label: '5 — event IS consumed (arg = event id, 1-based)' },
  { k: 6,  label: '6 — event NOT consumed (arg = event id, 1-based)' },
  { k: 7,  label: '7 — health > arg' },
  { k: 8,  label: '8 — health < arg' },
  { k: 9,  label: '9 — level timer/17 > arg*5' },
  { k: 10, label: '10 — level timer/17 < arg*5' },
  { k: 11, label: '11 — lever IS on (arg = lever id 0-63)' },
  { k: 12, label: '12 — lever IS off (arg = lever id 0-63)' },
  { k: 13, label: '13 — score > arg*5000' },
  { k: 14, label: '14 — score < arg*5000' },
  { k: 15, label: '15 — lives > arg' },
  { k: 16, label: '16 — lives < arg' },
];

export const ACTIONS = [
  { v: 0,  label: '0 — spawn object (arg = object type)' },
  { v: 1,  label: '1 — spawn weapon pickup (arg = weapon index)' },
  { v: 2,  label: '2 — open door (2x3, at x,y)' },
  { v: 3,  label: '3 — create teleport zone (arg = (col<<8)|row dest)' },
  { v: 4,  label: '4 — create level-exit zone (arg = exit index)' },
  { v: 5,  label: '5 — dispatch event (arg = event id, 1-based)' },
  { v: 6,  label: '6 — kill nearby hazard objects (±12px of x,y)' },
  { v: 7,  label: '7 — open gate (at x,y)' },
  { v: 8,  label: '8 — close gate (at x,y)' },
  { v: 9,  label: '9 — close door (at x,y)' },
  { v: 10, label: '10 — clear a weapon slot (arg = weapon id)' },
  { v: 11, label: '11 — no-op' },
  { v: 12, label: '12 — no-op' },
  { v: 13, label: '13 — message/precondition gate (no world effect)' },
  { v: 14, label: '14 — zero the level timer' },
];

export class TriggersPanel {
  constructor({ listEl, formEl, countEl }, onChange, getMessages) {
    this.listEl = listEl; this.formEl = formEl; this.countEl = countEl;
    this.onChange = onChange;
    this.getMessages = getMessages;
    this.selected = -1;
  }

  render(model) {
    const live = model.triggers.filter(isLive).length;
    this.countEl.textContent = live;

    this.listEl.innerHTML = '';
    model.triggers.forEach((t, i) => {
      const row = document.createElement('div');
      const on = isLive(t);
      row.className = 'listItem' + (i === this.selected ? ' sel' : '') + (on ? '' : ' dead');
      row.textContent = on
        ? `#${i}  x${t.x} y${t.y}  verb ${verbOf(t)}${consumesInventory(t) ? '+inv' : ''}`
        : `#${i}  (empty)`;
      row.addEventListener('click', () => { this.selected = i; this.render(model); });
      this.listEl.appendChild(row);
    });

    this._renderForm(model);
  }

  placeAt(model, x, y) {
    /* Select the nearest live trigger within 10px, if any; else create one
     * in the first dead slot at this exact point. */
    let best = -1, bestD = 100;
    model.triggers.forEach((t, i) => {
      if (!isLive(t)) return;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== -1) { this.selected = best; return true; }
    const slot = model.triggers.findIndex((t) => !isLive(t));
    if (slot === -1) { alert('all 100 trigger slots are full'); return false; }
    model.triggers[slot] = {
      condKind: [0, 0, 0], condArg: [0, 0, 0],
      x, y, action: 0, actionArg: 0, messageId: 0, reserved: 0,
    };
    this.selected = slot;
    return true;
  }

  _renderForm(model) {
    this.formEl.innerHTML = '';
    if (this.selected < 0) return;
    const t = model.triggers[this.selected];
    const change = () => { this.onChange(); this.render(model); };

    for (let s = 0; s < 3; s++) {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = `cond ${s}`;
      const sel = document.createElement('select');
      CONDITIONS.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.k; opt.textContent = c.label;
        if (c.k === t.condKind[s]) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => { t.condKind[s] = +sel.value; change(); });
      const arg = document.createElement('input');
      arg.type = 'number'; arg.value = t.condArg[s]; arg.className = 'grow';
      arg.addEventListener('input', () => { t.condArg[s] = +arg.value || 0; change(); });
      row.appendChild(l); row.appendChild(sel); row.appendChild(arg);
      this.formEl.appendChild(row);
    }

    const xy = document.createElement('div'); xy.className = 'row';
    const mkNum = (label, field, max) => {
      const l = document.createElement('label'); l.textContent = label;
      const i = document.createElement('input');
      i.type = 'number'; i.value = t[field]; i.min = 0; i.max = max; i.className = 'grow';
      i.addEventListener('input', () => { t[field] = Math.max(0, Math.min(max, +i.value || 0)); change(); });
      return [l, i];
    };
    xy.append(...mkNum('x', 'x', 4095), ...mkNum('y', 'y', 1023));
    this.formEl.appendChild(xy);

    const actionRow = document.createElement('div'); actionRow.className = 'row';
    const al = document.createElement('label'); al.textContent = 'action';
    const asel = document.createElement('select');
    ACTIONS.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.v; opt.textContent = a.label;
      if (a.v === (t.action & 0x7FFF)) opt.selected = true;
      asel.appendChild(opt);
    });
    asel.addEventListener('change', () => {
      t.action = (+asel.value & 0x7FFF) | (t.action & 0x8000);
      change();
    });
    actionRow.appendChild(al); actionRow.appendChild(asel);
    this.formEl.appendChild(actionRow);

    const flagRow = document.createElement('div'); flagRow.className = 'row';
    const flagLabel = document.createElement('label');
    const flagBox = document.createElement('input'); flagBox.type = 'checkbox';
    flagBox.checked = (t.action & 0x8000) !== 0;
    flagBox.addEventListener('change', () => {
      t.action = (t.action & 0x7FFF) | (flagBox.checked ? 0x8000 : 0);
      change();
    });
    flagLabel.append(flagBox, document.createTextNode(' bit15: consume inventory (cond-kind-1 slots) on fire'));
    flagRow.appendChild(flagLabel);
    this.formEl.appendChild(flagRow);

    const actionArgRow = document.createElement('div'); actionArgRow.className = 'row';
    const aal = document.createElement('label'); aal.textContent = 'action arg';
    const aai = document.createElement('input');
    aai.type = 'number'; aai.value = t.actionArg; aai.min = 0; aai.max = 0xFFFF; aai.className = 'grow';
    aai.addEventListener('input', () => { t.actionArg = Math.max(0, Math.min(0xFFFF, +aai.value || 0)); change(); });
    actionArgRow.appendChild(aal); actionArgRow.appendChild(aai);
    this.formEl.appendChild(actionArgRow);

    const msgRow = document.createElement('div'); msgRow.className = 'row';
    const ml = document.createElement('label'); ml.textContent = 'message';
    const msel = document.createElement('select');
    const messages = this.getMessages();
    const none = document.createElement('option');
    none.value = 0; none.textContent = '(none)';
    msel.appendChild(none);
    for (let i = 0; i < 40; i++) {
      if (!messages[i]) continue;
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = `${i}: “${messages[i]}”`;
      if (i === t.messageId) opt.selected = true;
      msel.appendChild(opt);
    }
    if (!messages[t.messageId]) none.selected = true;
    msel.addEventListener('change', () => { t.messageId = +msel.value; change(); });
    msgRow.appendChild(ml); msgRow.appendChild(msel);
    this.formEl.appendChild(msgRow);

    const del = document.createElement('button');
    del.textContent = 'clear this trigger';
    del.addEventListener('click', () => {
      model.triggers[this.selected] = {
        condKind: [0, 0, 0], condArg: [0, 0, 0],
        x: 0, y: 0, action: 0, actionArg: 0, messageId: 0, reserved: 0,
      };
      this.selected = -1;
      change();
    });
    this.formEl.appendChild(del);
  }
}
