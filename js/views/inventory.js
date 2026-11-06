// Estoque: o que tem em casa, o que é essencial e o que está acabando.
import * as store from '../core/store.js';
import * as cat from '../core/catalog.js';
import { inventoryRows, invSeries, consumption, addMove, ensureInv, newList, addToList, prodOf } from '../core/domain.js';
import { unitsOf, byPlace, placeOrder, PLACES } from '../core/units.js';
import { tapUnit, dropUnits } from './unitactions.js';
import { openStockInput } from './stockinput.js';
import { markersHtml, bindMarkers, markerIcon } from '../ui/markers.js';
import { railHtml, bindRail, letterOf } from '../ui/rail.js';
import { popover } from '../ui/pickers.js';
import { esc, fmtNum, unitLabel, norm } from '../lib/util.js';
import { icon, toast } from '../ui/ui.js';
import { sparkline } from '../ui/chart.js';
import { askQty } from '../ui/numpad.js';
import { openStock, isInt } from './product.js';
import { pickProduct } from './common.js';
import { app, prefs, setPref } from '../state.js';
import { haptic } from '../ui/haptics.js';
import { groupCardsHtml, bindGroupCards } from './groups.js';
import { activeGroups } from '../core/groups.js';

export const title = 'Estoque';
let q = '';

let unbind = null;

const MODES = [
  ['essenciais', 'Essenciais', 'star'],
  ['tudo', 'Tudo', 'list'],
  ['local', 'Por local', 'box'],
];

export function render(el) {
  const S = store.snapshot();
  const P = prefs();
  const mode = MODES.some((m) => m[0] === P.invMode) ? P.invMode : 'essenciais';
  const dom = P.invDomain || 'todos';
  const all = inventoryRows(S);
  const inStock = all.filter((r) => r.qty > 0);
  const ess = all.filter((r) => r.essential);
  let rows = mode === 'essenciais' ? ess : mode === 'tudo' ? all : inStock;
  if (dom !== 'todos') rows = rows.filter((r) => r.domain === dom);
  if (q) rows = rows.filter((r) => norm(r.name).includes(norm(q)));
  const low = ess.filter((r) => r.status !== 'ok');
  const unitsCache = new Map();
  const unitsFor = (pid) => {
    if (!unitsCache.has(pid)) unitsCache.set(pid, unitsOf(store.snapshot(), pid));
    return unitsCache.get(pid);
  };
  const counts = (units) => {
    const open = units.filter((u) => u.state === 'open').length;
    const parts = [];
    if (open) parts.push(`${open} aberto${open > 1 ? 's' : ''}`);
    if (units.length - open) parts.push(`${units.length - open} fechado${units.length - open > 1 ? 's' : ''}`);
    return parts.join(' · ');
  };

  // Uma linha compacta: nome e detalhe à esquerda, embalagens e quantidade à direita.
  const row = (r, units, { place = null, meta = '' } = {}) => {
    const amt = place ? units.reduce((a, u) => a + u.amount, 0) : r.qty;
    const spark = mode === 'essenciais' && P.showSpark ? sparkline(invSeries(S, r.pid, 30).map((x) => x.v), { w: 40, h: 14, cls: r.status }) : '';
    return `<div class="inv-row ${r.status}" data-pid="${r.pid}" data-name="${esc(r.name)}">
      <button type="button" class="inv-main" data-open="${r.pid}"${place ? ` data-drag-group="${esc(r.pid)}|${esc(place)}"` : ''} data-name="${esc(r.name)}">
        <span class="inv-name">${r.essential ? `<span class="ess-dot" title="Essencial">${icon('star')}</span>` : ''}${esc(r.name)}</span>
        <span class="inv-meta">${meta}${spark}</span>
      </button>
      ${markersHtml(units, { unit: r.unit, max: 4 })}
      <span class="inv-qty"><b>${fmtNum(amt)}</b><small>${esc(unitLabel(r.unit))}</small></span>
    </div>`;
  };
  const statusMeta = (r) => {
    if (r.status === 'out') return '<span class="neg">acabou</span>';
    if (r.status === 'low') return `<span class="warn-text">abaixo do mínimo (${fmtNum(r.min)})</span>`;
    const c = consumption(S, r.pid, 60);
    const days = c.daysLeft != null && r.qty > 0 ? Math.round(c.daysLeft) : null;
    return days != null ? `dura ~${Math.max(1, days)} dia${days > 1 ? 's' : ''}` : '';
  };
  const placesMeta = (units) => {
    const m = byPlace(units);
    return [...m].map(([p, us]) => (m.size > 1 ? `${p} ${us.length}` : p)).join(' · ');
  };
  const join = (...xs) => xs.filter(Boolean).join(' · ');

  let body = '';
  let letters = [];
  let placeChips = '';
  if (mode === 'essenciais') {
    const groups = [
      ['out', 'Acabou', rows.filter((r) => r.status === 'out')],
      ['low', 'Acabando', rows.filter((r) => r.status === 'low')],
      ['ok', 'Em dia', rows.filter((r) => r.status === 'ok')],
    ];
    letters = rows.map((r) => letterOf(r.name));
    body = rows.length
      ? groups
          .filter((g) => g[2].length)
          .map(([k, label, arr]) => `<section class="inv-grp"><h3 class="grp-head ${k}">${esc(label)}<small>${arr.length}</small></h3>${arr.map((r) => row(r, unitsFor(r.pid), { meta: join(statusMeta(r), esc(placesMeta(unitsFor(r.pid)))) })).join('')}</section>`)
          .join('')
      : `<div class="empty-block">${icon('star')}<p>Marque como essencial o que não pode faltar em casa (café, papel higiênico, gás…). O Zelo avisa quando estiver acabando.</p><button type="button" class="btn primary" data-addess>${icon('plus')}Escolher essenciais</button></div>`;
  } else if (mode === 'tudo') {
    // Consolidado: um item por linha, em ordem alfabética, com as embalagens de todos os lugares.
    const m = new Map();
    for (const r of rows) {
      const l = letterOf(r.name);
      if (!m.has(l)) m.set(l, []);
      m.get(l).push(r);
    }
    letters = [...m.keys()];
    body = rows.length
      ? [...m]
          .map(([l, arr]) => `<section class="inv-grp"><h3 class="grp-head letter" data-letter="${l}">${l}</h3>${arr.map((r) => {
            const us = unitsFor(r.pid);
            return row(r, us, { meta: join(r.qty <= 0 ? '<span class="neg">acabou</span>' : r.status === 'low' ? '<span class="warn-text">acabando</span>' : '', esc(placesMeta(us)), counts(us).includes('aberto') ? counts(us).split(' · ')[0] : '') });
          }).join('')}</section>`)
          .join('')
      : `<div class="empty-block">${icon('box')}<p>${q ? 'Nada com esse nome no estoque.' : 'O estoque se monta sozinho quando você conclui uma compra. Também dá para adicionar à mão.'}</p>${q ? '' : `<button type="button" class="btn primary" data-addinv>${icon('plus')}Adicionar ao estoque</button>`}</div>`;
  } else {
    const byLoc = new Map();
    for (const r of rows)
      for (const [place, units] of byPlace(unitsFor(r.pid))) {
        if (!byLoc.has(place)) byLoc.set(place, []);
        byLoc.get(place).push({ r, units });
      }
    const order = [...byLoc.keys()].sort((a, b) => placeOrder(a) - placeOrder(b));
    const sel = P.invPlace && byLoc.has(P.invPlace) ? P.invPlace : '';
    placeChips = `<div class="chips place-chips" data-placechips>
      <button type="button" class="chip small${!sel ? ' on' : ''}" data-place="">Todos</button>
      ${order.map((p) => `<button type="button" class="chip small${sel === p ? ' on' : ''}" data-place="${esc(p)}">${esc(p)} <em>${byLoc.get(p).length}</em></button>`).join('')}
    </div>`;
    const shown = sel ? [sel] : order;
    letters = shown.flatMap((p) => byLoc.get(p).map((x) => letterOf(x.r.name)));
    body = order.length
      ? shown
          .map((place) => {
            const items = byLoc.get(place);
            const open = items.reduce((a, x) => a + x.units.filter((u) => u.state === 'open').length, 0);
            return `<section class="inv-grp loc-grp"><h3 class="grp-head loc-head" data-drop-place="${esc(place)}">${icon('box', 'sm2')}${esc(place)}<small>${items.length} ite${items.length > 1 ? 'ns' : 'm'}${open ? ` · ${open} aberto${open > 1 ? 's' : ''}` : ''}</small></h3>${items.map((x) => row(x.r, x.units, { place, meta: counts(x.units) })).join('')}</section>`;
          })
          .join('')
      : `<div class="empty-block">${icon('box')}<p>${q ? 'Nada com esse nome no estoque.' : 'Nada guardado ainda. O estoque se monta quando você conclui uma compra.'}</p></div>`;
  }

  const domLabel = dom === 'todos' ? 'Tipos' : cat.domainName(dom);
  el.innerHTML = `<div class="inv-wrap${letters.length > 5 ? ' has-rail' : ''}">
    <div class="inv-top">
      <div class="seg small inv-modes" role="radiogroup" aria-label="Mostrar">
        ${MODES.map(([v, l, ic]) => `<button type="button" data-mode="${v}" class="${mode === v ? 'on' : ''}" aria-checked="${mode === v}" role="radio">${icon(ic, 'sm2')}${l} <em>${v === 'essenciais' ? ess.length : v === 'tudo' ? all.length : inStock.length}</em></button>`).join('')}
      </div>
      <div class="inv-search">
        <div class="search-in">${icon('search')}<input type="search" placeholder="Buscar" value="${esc(q)}" data-q aria-label="Buscar no estoque"></div>
        <button type="button" class="btn small ghost dom-btn${dom !== 'todos' ? ' on' : ''}" data-dombtn aria-label="Filtrar por tipo: ${esc(domLabel)}">${esc(domLabel)}${icon('down', 'sm2')}</button>
        <button type="button" class="btn small primary si-btn" data-stockin aria-label="Atualizar estoque digitando ou falando">${icon('mic', 'sm2')}Atualizar</button>
      </div>
    </div>
    ${placeChips}
    ${mode === 'essenciais' ? groupCardsHtml(activeGroups(S)) : ''}
    ${mode === 'essenciais' && rows.length ? `<div class="ess-tools"><button type="button" class="btn small ghost" data-essplus>${icon('star', 'sm2')}Marcar essencial</button></div>` : ''}
    ${mode === 'essenciais' && low.length ? `<div class="inv-alert"><span><b>${low.length}</b> ${low.length === 1 ? 'essencial precisa' : 'essenciais precisam'} de reposição</span><button type="button" class="btn small primary" data-tolist>${icon('cart')}Pôr na lista</button></div>` : ''}
    <div class="stock-list">${body}</div>
    <div class="mk-legend"><span class="mk closed sm">${markerIcon('closed')}</span>fechado <span class="mk open sm">${markerIcon('open')}</span>aberto · toque para abrir e, aberto, quando acabar · segure e arraste para mudar de lugar</div>
    ${letters.length > 5 ? railHtml([...new Set(letters)], 'dock') : ''}
  </div>`;

  const wrap = el.querySelector('.inv-wrap');
  const $ = (s) => wrap.querySelector(s);
  wrap.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => (setPref('invMode', b.dataset.mode), app.refresh())));
  wrap.querySelectorAll('[data-place]').forEach((b) =>
    b.addEventListener('click', () => {
      setPref('invPlace', b.dataset.place);
      haptic('tick');
      app.refresh();
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }),
  );
  $('[data-dombtn]').addEventListener('click', (e) =>
    popover(
      e.currentTarget,
      (pb, close) => {
        pb.innerHTML = `<div class="pick-list">${[['todos', 'Todos os tipos'], ...cat.DOMAINS.map((d) => [d.id, d.name])].map(([v, l]) => `<button type="button" class="pick-opt${v === dom ? ' on' : ''}" data-v="${v}"><span>${esc(l)}</span>${v === dom ? icon('check') : ''}</button>`).join('')}</div>`;
        pb.querySelectorAll('[data-v]').forEach((b) =>
          b.addEventListener('click', () => {
            setPref('invDomain', b.dataset.v);
            close(false);
            app.refresh();
          }),
        );
      },
      { title: 'Mostrar', cls: 'pop-list' },
    ),
  );
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
  wrap.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => {
      if (Date.now() - (app.justDragged || 0) < 500) return;
      openStock(b.dataset.open);
    }),
  );
  wrap.querySelectorAll('.mk-more').forEach((m) => m.addEventListener('click', () => openStock(m.closest('[data-pid]').dataset.pid)));
  bindRail(wrap, (l) => {
    const target = wrap.querySelector(`[data-letter="${l}"]`) || [...wrap.querySelectorAll('.inv-row[data-name]')].find((r) => letterOf(r.dataset.name) === l);
    if (!target) return;
    const head = document.querySelector('.head')?.offsetHeight || 0;
    const chips = wrap.querySelector('[data-placechips]')?.offsetHeight || 0;
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - head - chips - 6 });
  });
  unbind?.();
  unbind = bindMarkers(wrap, {
    resolve: (pid) => unitsOf(store.snapshot(), pid),
    places: PLACES,
    onTap: tapUnit,
    onDrop: dropUnits,
  });
  $('[data-tolist]')?.addEventListener('click', async () => {
    const S2 = store.snapshot();
    const target = S2.list.find((l) => l.status !== 'done');
    const id = target?.id || (await newList(S2, { name: 'Reposição' }));
    for (const r of low) await addToList(store.snapshot(), id, { pid: r.pid, qty: Math.max(1, Math.ceil((r.min || 1) - r.qty) || 1) });
    haptic('add');
    toast(`${low.length} itens na lista ${store.get(id)?.name}`, { action: 'Abrir', onAction: () => app.nav(`lista-${id}`) });
  });
  $('[data-addess]')?.addEventListener('click', addEssential);
  $('[data-addinv]')?.addEventListener('click', openStockInput);
  $('[data-stockin]').addEventListener('click', openStockInput);
  bindGroupCards(wrap);
  $('[data-essplus]')?.addEventListener('click', addEssential);
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
// O + do estoque abre a atualização rápida (contagem ou entrada, por texto ou voz).
export const fab = () => openStockInput();
