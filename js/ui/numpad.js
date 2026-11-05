// Teclado numérico do Zelo (painel inferior, pensado para uma mão).
// Nunca abre o teclado do celular: os campos são botões, e o teclado é desenhado pelo app.
// Dinheiro é digitado como no caixa eletrônico (5 4 9 → R$ 5,49). Quantidade aceita vírgula.
//
// openNumpad({ title, sub, fields:[{key,label,kind:'money'|'qty',value,unit,int,mode}], active,
//              info(values, mode) → html, actions:[{id,label,primary,danger}], top: html,
//              modes: { value, options:[[id,label]], onChange(from, to, values) } })
//   → Promise<{ action, values, mode } | null>
// Com modes, cada campo pode pertencer a um modo (field.mode); só os campos do modo atual aparecem.
import { esc, money, fmtNum, unitLabel } from '../lib/util.js';
import { icon, sheet } from './ui.js';
import { haptic } from './haptics.js';

export function openNumpad({ title, sub = '', fields, active, info, actions, top = '', onMount, modes }) {
  return new Promise((resolve) => {
    const vals = {};
    const buf = {};
    for (const f of fields) {
      vals[f.key] = f.value ?? 0;
      buf[f.key] = f.kind === 'qty' ? fmtNum(f.value ?? 0).replace(/\./g, '') : '';
    }
    let mode = modes?.value || null;
    const visible = () => fields.filter((f) => !f.mode || f.mode === mode);
    let cur = active && visible().some((f) => f.key === active) ? active : visible()[0].key;
    let fresh = true;
    let result = null;
    const F = (k) => fields.find((f) => f.key === k);
    const modesHtml = () =>
      modes
        ? `<div class="seg small np-modes" role="radiogroup" aria-label="Como informar o preço">${modes.options
            .map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === mode}" class="${v === mode ? 'on' : ''}" data-mode="${v}">${esc(l)}</button>`)
            .join('')}</div>`
        : '';

    const showVal = (f) => {
      if (f.kind === 'money') return money(vals[f.key]);
      return `${buf[f.key] || '0'}${f.unit ? ` <small>${esc(unitLabel(f.unit))}</small>` : ''}`;
    };
    const fieldsHtml = () =>
      visible()
        .map(
          (f) => `<div class="np-field${f.key === cur ? ' on' : ''}" data-field="${f.key}" role="button" tabindex="0" aria-pressed="${f.key === cur}">
        <span>${esc(f.label)}</span>
        <div class="np-val-row">
          ${f.kind === 'qty' ? `<button type="button" class="np-step" data-step="-1" data-for="${f.key}" aria-label="Diminuir">${icon('minus')}</button>` : ''}
          <b class="np-val" data-val="${f.key}">${showVal(f)}</b>
          ${f.kind === 'qty' ? `<button type="button" class="np-step" data-step="1" data-for="${f.key}" aria-label="Aumentar">${icon('plus')}</button>` : ''}
        </div>
      </div>`,
        )
        .join('');

    const keys = () => {
      const f = F(cur);
      const left = f.kind === 'money' ? '00' : f.int ? '' : ',';
      return `${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="key" data-k="${n}">${n}</button>`).join('')}
        <button type="button" class="key fn" data-k="${left}"${left ? '' : ' disabled aria-hidden="true"'}>${left}</button>
        <button type="button" class="key" data-k="0">0</button>
        <button type="button" class="key fn" data-k="back" aria-label="Apagar">⌫</button>`;
    };

    sheet({
      title,
      body: `<div class="numpad">
        ${sub ? `<p class="np-sub">${sub}</p>` : ''}
        ${top}
        <div data-modes>${modesHtml()}</div>
        <div class="np-fields" data-fields>${fieldsHtml()}</div>
        <div class="np-info" data-info aria-live="polite"></div>
        <div class="np-keys" data-keys>${keys()}</div>
        <div class="np-actions">${actions
          .map((a) => `<button type="button" class="btn ${a.primary ? 'primary' : a.danger ? 'ghost danger-text' : 'ghost'} big" data-act="${a.id}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`)
          .join('')}</div>
      </div>`,
      onMount(el, close) {
        const refresh = (all = false) => {
          if (all) el.querySelector('[data-fields]').innerHTML = fieldsHtml();
          else
            for (const f of visible()) {
              el.querySelector(`[data-val="${f.key}"]`).innerHTML = showVal(f);
              el.querySelector(`[data-field="${f.key}"]`).classList.toggle('on', f.key === cur);
            }
          el.querySelector('[data-keys]').innerHTML = keys();
          if (info) el.querySelector('[data-info]').innerHTML = info({ ...vals }, mode) || '';
        };
        const press = (k) => {
          const f = F(cur);
          haptic('tick');
          if (f.kind === 'money') {
            let c = fresh ? 0 : vals[cur];
            if (k === 'back') c = Math.floor(c / 10);
            else if (k === '00') c = c * 100;
            else c = c * 10 + Number(k);
            vals[cur] = Math.min(c, 99999999);
          } else {
            let b = fresh ? '' : buf[cur];
            if (k === 'back') b = b.slice(0, -1);
            else if (k === ',') {
              if (!b.includes(',')) b = (b || '0') + ',';
            } else if (b.replace(',', '').length < 7) {
              const dec = b.split(',')[1];
              if (!(dec && dec.length >= 3)) b = b === '0' ? k : b + k;
            }
            buf[cur] = b;
            vals[cur] = parseFloat((b || '0').replace(',', '.')) || 0;
          }
          fresh = false;
          refresh();
        };
        const step = (key, d) => {
          const f = F(key);
          const s = f.int || vals[key] >= 1 || d > 0 ? 1 : 0.1;
          let v = Math.round((vals[key] + d * s) * 1000) / 1000;
          v = Math.max(f.min ?? 0, v);
          vals[key] = v;
          buf[key] = fmtNum(v).replace(/\./g, '');
          cur = key;
          fresh = true;
          haptic('tick');
          refresh();
        };
        el.addEventListener('click', (e) => {
          const md = e.target.closest('[data-mode]');
          if (md && md.dataset.mode !== mode) {
            const from = mode;
            mode = md.dataset.mode;
            modes.onChange?.(from, mode, vals);
            for (const f of fields) if (f.kind === 'qty') buf[f.key] = fmtNum(vals[f.key]).replace(/\./g, '');
            if (!visible().some((f) => f.key === cur)) cur = visible()[0].key;
            fresh = true;
            haptic('tick');
            el.querySelector('[data-modes]').innerHTML = modesHtml();
            return refresh(true);
          }
          const st = e.target.closest('[data-step]');
          if (st) return step(st.dataset.for, Number(st.dataset.step));
          const fd = e.target.closest('[data-field]');
          if (fd) {
            cur = fd.dataset.field;
            fresh = true;
            return refresh();
          }
          const k = e.target.closest('[data-k]');
          if (k && k.dataset.k) return press(k.dataset.k);
          const a = e.target.closest('[data-act]');
          if (a) {
            haptic(a.classList.contains('primary') ? 'add' : 'tap');
            result = { action: a.dataset.act, values: { ...vals }, mode };
            close();
          }
        });
        el.addEventListener('keydown', (e) => {
          if (/^\d$/.test(e.key)) press(e.key);
          else if (e.key === 'Backspace') press('back');
          else if (e.key === ',' || e.key === '.') press(F(cur).kind === 'money' ? '00' : ',');
          else if (e.key === 'Enter') el.querySelector('[data-act].primary, .np-actions .btn.primary')?.click();
          else if (e.key === 'Tab' && visible().length > 1) {
            e.preventDefault();
            const vis = visible();
            const i = vis.findIndex((f) => f.key === cur);
            cur = vis[(i + 1) % vis.length].key;
            fresh = true;
            refresh();
          } else return;
          e.preventDefault();
        });
        refresh();
        setTimeout(() => el.querySelector('.np-field.on')?.focus({ preventScroll: true }), 60);
        onMount?.(el, close, { vals, refresh });
      },
      onClose: () => resolve(result),
    });
  });
}

// Atalhos.
export async function askMoney(title, cents = 0, { sub = '', ok = 'Salvar' } = {}) {
  const r = await openNumpad({ title, sub, fields: [{ key: 'v', label: 'Valor', kind: 'money', value: cents }], actions: [{ id: 'ok', label: ok, primary: true }] });
  return r ? r.values.v : null;
}
export async function askQty(title, qty = 1, unit = 'un', { sub = '', ok = 'Salvar', label = 'Quantidade' } = {}) {
  const r = await openNumpad({ title, sub, fields: [{ key: 'q', label, kind: 'qty', value: qty, unit }], actions: [{ id: 'ok', label: ok, primary: true }] });
  return r ? r.values.q : null;
}
