// Estoque: o que tem em casa, o que é essencial e o que está acabando.
import * as store from '../core/store.js';
import * as cat from '../core/catalog.js';
import { inventoryRows, invSeries, consumption, addMove, ensureInv, newList, addToList } from '../core/domain.js';
import { esc, fmtNum, unitLabel, norm } from '../lib/util.js';
import { icon, toast } from '../ui/ui.js';
import { sparkline } from '../ui/chart.js';
import { askQty } from '../ui/numpad.js';
import { openStock, isInt } from './product.js';
import { pickProduct } from './common.js';
import { app, prefs, setPref } from '../state.js';
import { haptic } from '../ui/haptics.js';

export const title = 'Estoque';
let q = '';

export function render(el) {
  const S = store.snapshot();
  const P = prefs();
  const mode = P.invMode || 'essenciais';
  const dom = P.invDomain || 'todos';
  let rows = inventoryRows(S);
  const ess = rows.filter((r) => r.essential);
  if (mode === 'essenciais') rows = ess;
  if (dom !== 'todos') rows = rows.filter((r) => r.domain === dom);
  if (q) rows = rows.filter((r) => norm(r.name).includes(norm(q)));
  const low = ess.filter((r) => r.status !== 'ok');

  const groups =
    mode === 'essenciais'
      ? [
          ['out', 'Acabou', rows.filter((r) => r.status === 'out')],
          ['low', 'Acabando', rows.filter((r) => r.status === 'low')],
          ['ok', 'Em dia', rows.filter((r) => r.status === 'ok')],
        ]
      : cat.sections().map((s) => [s.id, s.name, rows.filter((r) => (r.section || 'outros') === s.id)]);

  const row = (r) => {
    const series = P.showSpark ? invSeries(S, r.pid, 30).map((x) => x.v) : [];
    const c = consumption(S, r.pid, 60);
    const days = c.daysLeft != null && r.qty > 0 ? Math.round(c.daysLeft) : null;
    return `<div class="inv-row ${r.status}" data-pid="${r.pid}">
      <button type="button" class="inv-main" data-open="${r.pid}">
        <span class="inv-name">${r.essential ? `<span class="ess-dot" title="Essencial">${icon('star')}</span>` : ''}${esc(r.name)}</span>
        <span class="inv-meta">${r.status === 'out' ? '<span class="neg">acabou</span>' : r.status === 'low' ? `<span class="warn-text">abaixo do mínimo (${fmtNum(r.min)})</span>` : days != null ? `dura ~${Math.max(1, days)} dia${days > 1 ? 's' : ''}` : r.place ? esc(r.place) : ''}</span>
      </button>
      ${series.length ? sparkline(series, { cls: r.status }) : ''}
      <span class="inv-qty"><b>${fmtNum(r.qty)}</b><small>${esc(unitLabel(r.unit))}</small></span>
      <button type="button" class="inv-use" data-use="${r.pid}" aria-label="Usei um pouco de ${esc(r.name)}"${r.qty <= 0 ? ' disabled' : ''}>${icon('minus')}</button>
    </div>`;
  };

  el.innerHTML = `
    <div class="inv-top">
      <div class="seg small" role="radiogroup" aria-label="Mostrar">
        <button type="button" data-mode="essenciais" class="${mode === 'essenciais' ? 'on' : ''}" aria-checked="${mode === 'essenciais'}" role="radio">${icon('star', 'sm2')}Essenciais <em>${ess.length}</em></button>
        <button type="button" data-mode="tudo" class="${mode === 'tudo' ? 'on' : ''}" aria-checked="${mode === 'tudo'}" role="radio">Tudo <em>${inventoryRows(S).length}</em></button>
      </div>
      <div class="search-in">${icon('search')}<input type="search" placeholder="Buscar no estoque" value="${esc(q)}" data-q aria-label="Buscar no estoque"></div>
    </div>
    <div class="chips">${[['todos', 'Todos'], ...cat.DOMAINS.map((d) => [d.id, d.name])].map(([v, l]) => `<button type="button" class="chip small${dom === v ? ' on' : ''}" data-dom="${v}">${l}</button>`).join('')}</div>

    ${mode === 'essenciais' && low.length ? `<div class="inv-alert"><span><b>${low.length}</b> ${low.length === 1 ? 'essencial precisa' : 'essenciais precisam'} de reposição</span><button type="button" class="btn small primary" data-tolist>${icon('cart')}Pôr na lista</button></div>` : ''}

    ${
      rows.length
        ? groups
            .filter((g) => g[2].length)
            .map(([k, label, arr]) => `<section class="block inv-grp"><h3 class="grp-head ${k}">${esc(label)}<small>${arr.length}</small></h3>${arr.map(row).join('')}</section>`)
            .join('')
        : mode === 'essenciais'
          ? `<div class="empty-block">${icon('star')}<p>Marque como essencial o que não pode faltar em casa (café, papel higiênico, gás…). O Zelo avisa quando estiver acabando.</p><button type="button" class="btn primary" data-addess>${icon('plus')}Escolher essenciais</button></div>`
          : `<div class="empty-block">${icon('box')}<p>O estoque se monta sozinho quando você conclui uma compra. Também dá para adicionar à mão.</p><button type="button" class="btn primary" data-addinv>${icon('plus')}Adicionar ao estoque</button></div>`
    }
    <p class="foot-note">Toque em ${icon('minus', 'sm2')} para registrar que usou; isso melhora a previsão de quando cada item acaba.</p>`;

  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => (setPref('invMode', b.dataset.mode), app.refresh())));
  el.querySelectorAll('[data-dom]').forEach((b) => b.addEventListener('click', () => (setPref('invDomain', b.dataset.dom), app.refresh())));
  const qi = $('[data-q]');
  qi.addEventListener('input', () => {
    q = qi.value;
    app.refresh();
    requestAnimationFrame(() => {
      const n = document.querySelector('#view [data-q]');
      n?.focus();
      n?.setSelectionRange(n.value.length, n.value.length);
    });
  });
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openStock(b.dataset.open)));
  el.querySelectorAll('[data-use]').forEach((b) =>
    b.addEventListener('click', async () => {
      const pid = b.dataset.use;
      const r = inventoryRows(store.snapshot()).find((x) => x.pid === pid);
      const step = isInt(r.unit) ? 1 : await askQty(`Quanto usou de ${r.name}?`, 0.5, r.unit, { ok: 'Registrar uso' });
      if (!step) return;
      haptic('tap');
      const id = await addMove(pid, 'uso', step);
      toast(`${r.name}: −${fmtNum(step)} ${unitLabel(r.unit)}`, { action: 'Desfazer', onAction: () => store.remove(id) });
    }),
  );
  $('[data-tolist]')?.addEventListener('click', async () => {
    const S2 = store.snapshot();
    const target = S2.list.find((l) => l.status !== 'done');
    const id = target?.id || (await newList(S2, { name: 'Reposição' }));
    for (const r of low) await addToList(store.snapshot(), id, { pid: r.pid, qty: Math.max(1, Math.ceil((r.min || 1) - r.qty) || 1) });
    haptic('add');
    toast(`${low.length} itens na lista ${store.get(id)?.name}`, { action: 'Abrir', onAction: () => app.nav(`lista-${id}`) });
  });
  $('[data-addess]')?.addEventListener('click', addEssential);
  $('[data-addinv]')?.addEventListener('click', addManual);
}

export async function addEssential() {
  const pid = await pickProduct({ title: 'Qual item é essencial?' });
  if (!pid) return;
  await ensureInv(pid, { essential: true });
  const unit = cat.product(pid)?.unit || 'un';
  const min = await askQty('Avisar quando tiver menos que', 1, unit, { ok: 'Salvar mínimo', sub: 'Quantidade mínima em casa.' });
  if (min != null) await ensureInv(pid, { min });
  toast('Essencial adicionado');
}

export async function addManual() {
  const pid = await pickProduct({ title: 'Adicionar ao estoque' });
  if (!pid) return;
  const unit = cat.product(pid)?.unit || store.get(pid)?.unit || 'un';
  const n = await askQty('Quanto tem em casa?', 1, unit, { ok: 'Salvar' });
  if (n == null) return;
  await addMove(pid, 'ajuste', n, 'contagem inicial');
  toast('Item no estoque');
}

// Ação do botão + nesta tela.
export const fab = () => ((prefs().invMode || 'essenciais') === 'essenciais' ? addEssential() : addManual());
