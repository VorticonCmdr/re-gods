/* panels/messages.js — the 40-slot message pool. A `null` slot is "unused";
 * see map-writer.js's own header for the off=0 encoding it writes for that. */
export class MessagesPanel {
  constructor({ listEl, formEl, countEl }, onChange) {
    this.listEl = listEl; this.formEl = formEl; this.countEl = countEl;
    this.onChange = onChange;
    this.selected = -1;
  }

  render(model) {
    const used = model.messages.filter(Boolean).length;
    this.countEl.textContent = used;

    this.listEl.innerHTML = '';
    model.messages.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'listItem' + (i === this.selected ? ' sel' : '') + (m ? '' : ' dead');
      row.textContent = m ? `${i}: “${m}”` : `${i}: (empty)`;
      row.addEventListener('click', () => { this.selected = i; this.render(model); });
      this.listEl.appendChild(row);
    });

    this._renderForm(model);
  }

  _renderForm(model) {
    this.formEl.innerHTML = '';
    if (this.selected < 0) return;
    const i = this.selected;
    const ta = document.createElement('textarea');
    ta.value = model.messages[i] || '';
    ta.placeholder = '(empty — leave blank to clear this slot)';
    ta.addEventListener('input', () => {
      const v = ta.value.replace(/\0/g, '');
      model.messages[i] = v.length ? v : null;
      this.onChange();
      this.countEl.textContent = model.messages.filter(Boolean).length;
    });
    this.formEl.appendChild(ta);
  }
}
