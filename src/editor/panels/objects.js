/* panels/objects.js — the 200-slot static object table.
 *
 * `type < 0xC0` (192) is an ordinary POBJECTS object (sprite = 170+type);
 * `type >= 0xC0` is a weapon pickup (sprite = 302 + (type-0xC0)) — both per
 * docs/map-format-and-filenames.md's own `UNKNOWN_object_sprite` closure.
 * A dead slot is `x=y=type=0xFFFF` (tested by SIGN in the original, per the
 * same doc — this editor writes the literal 0xFFFF sentinel for all three
 * fields, which is sign-negative either way).
 *
 * No sprite atlas is wired in here (see editor/main.js's own scope note) —
 * the list/form is purely numeric, with the derived sprite id shown as a
 * hint so an author can cross-reference POBJ1/POBJ2's own frame numbering.
 */
const DEAD = 0xFFFF;

export function spriteForType(type) {
  return type >= 0xC0 ? 302 + (type - 0xC0) : 170 + type;
}

export class ObjectsPanel {
  constructor({ listEl, formEl, countEl, addBtnEl }, onChange) {
    this.listEl = listEl; this.formEl = formEl; this.countEl = countEl;
    this.addBtnEl = addBtnEl;
    this.onChange = onChange;
    this.selected = -1;
    this.placing = false;
    addBtnEl.addEventListener('click', () => {
      this.placing = true;
      addBtnEl.textContent = 'click the canvas to place…';
    });
  }

  render(model) {
    const live = model.objects
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.type !== DEAD);
    this.countEl.textContent = live.length;

    this.listEl.innerHTML = '';
    live.forEach(({ o, i }) => {
      const row = document.createElement('div');
      row.className = 'listItem' + (i === this.selected ? ' sel' : '');
      row.textContent = `#${i}  x${o.x} y${o.y}  type ${o.type} → sprite ${spriteForType(o.type)}`;
      row.addEventListener('click', () => { this.selected = i; this.render(model); });
      this.listEl.appendChild(row);
    });

    this._renderForm(model);
  }

  /** Called by main.js when the canvas is clicked in "objects" mode. */
  placeAt(model, x, y) {
    if (this.placing) {
      const slot = model.objects.findIndex((o) => o.type === DEAD);
      this.placing = false;
      this.addBtnEl.textContent = '+ add object (then click canvas)';
      if (slot === -1) { alert('all 200 object slots are full'); return false; }
      model.objects[slot] = { x, y, type: 0 };
      this.selected = slot;
      return true;
    }
    /* else: try to select the nearest live object within 10px */
    let best = -1, bestD = 100;
    model.objects.forEach((o, i) => {
      if (o.type === DEAD) return;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== -1) { this.selected = best; return true; }
    return false;
  }

  _renderForm(model) {
    this.formEl.innerHTML = '';
    if (this.selected < 0 || model.objects[this.selected].type === DEAD) return;
    const o = model.objects[this.selected];
    const mk = (label, field, max) => {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = label;
      const input = document.createElement('input');
      input.type = 'number'; input.value = o[field]; input.min = 0; input.max = max;
      input.className = 'grow';
      input.addEventListener('input', () => {
        o[field] = Math.max(0, Math.min(max, +input.value || 0));
        this.onChange();
        this.render(model);
      });
      row.appendChild(l); row.appendChild(input);
      return row;
    };
    this.formEl.appendChild(mk('x', 'x', 4095));
    this.formEl.appendChild(mk('y', 'y', 1023));
    this.formEl.appendChild(mk('type', 'type', 0xFFFE));
    const hint = document.createElement('div');
    hint.className = 'row';
    hint.textContent = `sprite = ${spriteForType(o.type)}${o.type >= 0xC0 ? ' (weapon pickup)' : ''}`;
    this.formEl.appendChild(hint);

    const del = document.createElement('button');
    del.textContent = 'delete';
    del.addEventListener('click', () => {
      model.objects[this.selected] = { x: DEAD, y: DEAD, type: DEAD };
      this.selected = -1;
      this.onChange();
      this.render(model);
    });
    this.formEl.appendChild(del);
  }
}
