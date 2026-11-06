// A lista durante a compra. Pensada para uma mão: tudo que se usa toda hora fica embaixo, no alcance
// do polegar (filtro, ordem, concluir, adicionar). Marcar o item é um círculo grande à esquerda;
// o preço é um botão à direita que abre o teclado numérico.
import * as store from '../core/store.js';
import * as cat from '../core/catalog.js';
import { listItems, listTotals, sortItems, nameOf, itemTotal, storeName, prodOf, essentialsLow, addToList, isWeight } from '../core/domain.js';
import { setFocus, onPresence, inList, onItem } from '../core/presence.js';
import { esc, money, fmtNum, unitLabel } from '../lib/util.js';
import { icon, toast, confirmDialog, promptDialog } from '../ui/ui.js';
import { popover } from '../ui/pickers.js';
import { railHtml, bindRail, letterOf } from '../ui/rail.js';
import { trendChip, refLine, avatarDot, pickStore, conflictCards, bindConflicts } from './common.js';
import { editPrice, openItem } from './itemedit.js';
import { openAdd } from './add.js';
import { openCheckout, openPayments, shareText } from './checkout.js';
import { app, prefs, setPref, who } from '../state.js';
import { haptic } from '../ui/haptics.js';

export const title = 'Lista';
export const immersive = true;

let unsubP = null;
let unsubC = null;
let lastList = null;

const SORTS = [
  ['secao', 'Por seção', 'sections'],
  ['az', 'A–Z', 'az'],
  ['caros', 'Mais caros primeiro', 'tag'],
  ['recentes', 'Adicionados por último', 'refresh'],
];

export function render(el, listId) {
  const S = store.snapshot();
  const list = S.byId.get(listId);
  if (!list || list.type === 'item') {
    el.innerHTML = `<div class="empty-block">${icon('list')}<p>Esta lista não existe mais.</p><a class="btn" href="#listas">Ver listas</a></div>`;
    return;
  }
  if (lastList !== listId) {
    lastList = listId;
    setFocus({ list: listId, item: null });
    unsubP?.();
    unsubP = onPresence(() => app.refresh());
    unsubC?.();
    unsubC = store.onConflicts(() => app.refresh());
  }
  const P = prefs();
  const done = list.status === 'done';
  const t = listTotals(S, list);
  let items = listItems(S, listId);
  const counts = { faltam: items.filter((x) => !x.checked).length, carrinho: items.filter((x) => x.checked).length, todos: items.length };
  const filter = done ? 'todos' : P.filter;
  if (filter === 'faltam') items = items.filter((x) => !x.checked);
  if (filter === 'carrinho') items = items.filter((x) => x.checked);
  sortItems(items, P.sort);
  const here = inList(listId);
  const pct = t.n ? Math.round((t.checked / t.n) * 100) : 0;

  // Agrupamento
  let groups = [];
  if (P.sort === 'secao') {
    const m = new Map();
    for (const it of items) {
      const k = it.section || 'outros';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    groups = [...m.entries()].map(([k, arr]) => ({ key: k, label: cat.sectionName(k), items: arr }));
  } else if (P.sort === 'az') {
    const m = new Map();
    for (const it of items) {
      const k = letterOf(nameOf(it));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    groups = [...m.entries()].map(([k, arr]) => ({ key: k, label: k, items: arr, letter: true }));
  } else groups = [{ key: 'all', label: '', items }];

  const row = (it) => {
    const editing = onItem(it.id);
    const unit = it.unit || prodOf(it.pid, it).unit;
    const qtyTxt = `${fmtNum(it.qty)} ${unitLabel(unit)}`;
    const ref = !it.price ? refLine(S, it, list.store, listId) : '';
    return `<div class="it${it.checked ? ' on' : ''}${editing.length ? ' busy' : ''}" data-it="${it.id}">
      <button type="button" class="it-check" data-check="${it.id}" aria-pressed="${!!it.checked}" aria-label="${it.checked ? 'Tirar do carrinho' : 'Pôr no carrinho'}: ${esc(nameOf(it))}"${done ? ' disabled' : ''}>${icon('check')}</button>
      <button type="button" class="it-main" data-open="${it.id}">
        <span class="it-name">${esc(nameOf(it))}${it.price ? trendChip(S, it, list.store, listId) : ''}</span>
        <span class="it-meta">${esc(qtyTxt)}${it.note ? ` · ${esc(it.note)}` : ''}${ref ? ` · ${ref}` : ''}${editing.length ? ` · <span class="busy-tag">${editing.map((u) => esc(who(S, u).name)).join(', ')} editando</span>` : ''}</span>
      </button>
      <button type="button" class="it-price${it.price ? '' : ' empty'}" data-price="${it.id}" aria-label="Preço de ${esc(nameOf(it))}"${done ? ' disabled' : ''}>
        ${it.price ? `<b>${money(itemTotal(it))}</b>${priceDetail(it, unit)}` : `${icon('tag')}<span>Preço</span>`}
      </button>
    </div>`;
  };

  const letters = P.sort === 'az' ? groups.map((g) => g.key) : [...new Set(items.map((i) => letterOf(nameOf(i))))];
  const confs = store.conflicts().filter((c) => c.type === 'list' ? c.id === listId : S.byId.get(c.id)?.listId === listId);

  el.innerHTML = `
  <div class="shop${done ? ' done' : ''}">
    <header class="shop-head">
      <a class="icon-btn" href="#listas" aria-label="Voltar às listas">${icon('back')}</a>
      <div class="shop-title">
        <h1>${esc(list.name)}</h1>
        <button type="button" class="store-chip${list.store ? '' : ' empty'}" data-store${done ? ' disabled' : ''}>${icon('pin')}<span>${esc(storeName(S, list.store) || 'Onde você está?')}</span></button>
      </div>
      <div class="shop-who">${here.map((u) => avatarDot(S, u, 26)).join('')}</div>
      <button type="button" class="icon-btn" data-more aria-label="Mais opções">${icon('more')}</button>
    </header>

    <div class="shop-sum">
      <div><span>No carrinho</span><b>${money(t.cart)}</b></div>
      <div><span>Itens</span><b>${t.checked}<small>/${t.n}</small></b></div>
      ${done ? `<div><span>Pago</span><b class="muted-b">${money(t.paid || t.cart)}</b></div>` : `<button type="button" class="btn sum-go" data-finish${t.checked ? '' : ' disabled'}>${icon('check')}Concluir</button>`}
      <div class="bar thin"><i style="width:${pct}%"></i></div>
      ${!done && t.est ? `<p class="sum-est">Previsto para a lista toda: ${money(t.est)}${t.noPrice ? ` · ${t.noPrice} no carrinho sem preço` : ''}</p>` : ''}
    </div>

    ${P.sort === 'secao' && groups.length > 1 ? `<div class="chips sec-chips" data-secchips>${groups.map((g) => `<button type="button" class="chip small" data-jump="${g.key}">${esc(g.label)} <em>${g.items.length}</em></button>`).join('')}</div>` : ''}

    <div class="shop-list" data-list>
      ${
        !t.n
          ? emptyList(S, list)
          : !items.length
            ? `<div class="empty-block">${icon(filter === 'faltam' ? 'check' : 'cart')}<p>${filter === 'faltam' ? 'Tudo no carrinho.' : 'Nada no carrinho ainda.'}</p>${filter === 'faltam' && !done ? `<button type="button" class="btn primary" data-finish>${icon('check')}Concluir compra</button>` : ''}</div>`
            : groups.map((g) => `<section class="grp" data-grp="${esc(g.key)}">${g.label ? `<h3 class="grp-head">${esc(g.label)}<small>${g.items.length}</small></h3>` : ''}${g.items.map(row).join('')}</section>`).join('')
      }
    </div>
    ${items.length >= 5 ? railHtml(letters) : ''}

    ${confs.length ? `<div class="shop-conf">${conflictCards(S, confs)}</div>` : ''}

    ${done ? `<div class="shop-bar"><span class="done-tag">${icon('check')}Compra concluída</span><button type="button" class="btn primary big" data-repeat>${icon('refresh')}Repetir compra</button></div>` : `
    <div class="shop-bar">
      <div class="seg small shop-filter" role="radiogroup" aria-label="Mostrar">
        ${[['faltam', 'Faltam'], ['carrinho', 'Carrinho'], ['todos', 'Todos']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${filter === v}" class="${filter === v ? 'on' : ''}" data-filter="${v}">${l}<em>${counts[v]}</em></button>`).join('')}
      </div>
      <button type="button" class="icon-btn bar-btn" data-sort aria-label="Ordenar: ${esc(SORTS.find((s) => s[0] === P.sort)?.[1] || '')}">${icon(SORTS.find((s) => s[0] === P.sort)?.[2] || 'sort')}</button>
      <button type="button" class="bar-add" data-add aria-label="Adicionar itens">${icon('plus')}</button>
    </div>`}
  </div>`;

  bind(el, listId, list);
}

// Segunda linha do botão de preço: "0,5 kg · R$ 40,00/kg" (por peso) ou "2 × R$ 5,49".
function priceDetail(it, unit) {
  const q = Number(it.qty) || 0;
  if (isWeight(unit)) return `<small${it.priceMode === 'total' ? ' class="by-total" title="Pelo total da etiqueta"' : ''}>${fmtNum(q)} ${esc(unitLabel(unit))} · ${money(it.price)}/${esc(unitLabel(unit))}</small>`;
  return q !== 1 ? `<small>${fmtNum(q)} × ${money(it.price)}</small>` : '';
}

function emptyList(S, list) {
  const low = essentialsLow(S);
  const prevDone = S.list.find((l) => l.status === 'done' && (l.domain || 'mercado') === (list.domain || 'mercado'));
  return `<div class="empty-block">
    ${icon('cart')}<p>Lista vazia. Comece pelo que está acabando ou repita uma compra.</p>
    <div class="stack-btns">
      <button type="button" class="btn primary big" data-add>${icon('plus')}Adicionar itens</button>
      ${low.length ? `<button type="button" class="btn big" data-addlow>${icon('star')}Essenciais acabando (${low.length})</button>` : ''}
      ${prevDone ? `<button type="button" class="btn big" data-copy="${prevDone.id}">${icon('refresh')}Repetir “${esc(prevDone.name)}”</button>` : ''}
    </div>
  </div>`;
}

function bind(el, listId, list) {
  const $ = (s) => el.querySelector(s);
  const S = store.snapshot();

  el.querySelector('[data-list]').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-check]');
    if (c) {
      const it = store.get(c.dataset.check);
      if (!it) return;
      const on = !it.checked;
      haptic(on ? 'add' : 'tap');
      await store.patch(it.id, { checked: on, checkedBy: app.me, checkedAt: Date.now() });
      if (on && !it.price && prefs().askPriceOnCheck) editPrice(it.id, { fromCheck: true });
      return;
    }
    const p = e.target.closest('[data-price]');
    if (p) return editPrice(p.dataset.price);
    const o = e.target.closest('[data-open]');
    if (o) return openItem(o.dataset.open);
  });

  el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openAdd(listId)));
  el.querySelectorAll('[data-finish]').forEach((b) => b.addEventListener('click', () => openCheckout(listId)));
  $('[data-addlow]')?.addEventListener('click', async () => {
    const low = essentialsLow(store.snapshot());
    for (const r of low) await addToList(store.snapshot(), listId, { pid: r.pid, qty: Math.max(1, Math.ceil((r.min || 1) - r.qty) || 1) });
    haptic('add');
    toast(`${low.length} essenciais adicionados`);
  });
  $('[data-copy]')?.addEventListener('click', (e) => copyFrom(e.currentTarget.dataset.copy, listId));
  $('[data-repeat]')?.addEventListener('click', async () => {
    const { newList } = await import('../core/domain.js');
    const id = await newList(store.snapshot(), { name: list.name, domain: list.domain, store: list.store });
    await copyFrom(listId, id);
    app.nav(`lista-${id}`);
  });

  el.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      setPref('filter', b.dataset.filter);
      app.refresh();
    }),
  );
  $('[data-sort]')?.addEventListener('click', (e) => {
    popover(
      e.currentTarget,
      (body, close) => {
        const cur = prefs().sort;
        body.innerHTML = `<div class="pick-list">${SORTS.map(([v, l, ic]) => `<button type="button" class="pick-opt${v === cur ? ' on' : ''}" data-v="${v}"><span class="opt-ic">${icon(ic)}${l}</span>${v === cur ? icon('check') : ''}</button>`).join('')}</div>`;
        body.querySelectorAll('[data-v]').forEach((b) =>
          b.addEventListener('click', () => {
            setPref('sort', b.dataset.v);
            close(false);
            app.refresh();
          }),
        );
      },
      { title: 'Ordenar itens', cls: 'pop-list' },
    );
  });
  $('[data-store]')?.addEventListener('click', async () => {
    const s = await pickStore(list.store);
    if (s !== undefined) await store.patch(listId, { store: s });
  });
  $('[data-more]').addEventListener('click', (e) => moreMenu(e.currentTarget, listId));

  el.querySelectorAll('[data-jump]').forEach((b) =>
    b.addEventListener('click', () => {
      const g = el.querySelector(`[data-grp="${CSS.escape(b.dataset.jump)}"]`);
      if (g) window.scrollTo({ top: g.getBoundingClientRect().top + window.scrollY - stickyOffset(el), behavior: 'smooth' });
    }),
  );
  bindRail(el, (l) => {
    if (prefs().sort !== 'az') {
      setPref('sort', 'az');
      app.refresh();
      requestAnimationFrame(() => jumpLetter(document.getElementById('view'), l));
      return;
    }
    jumpLetter(el, l);
  });
  bindConflicts(el);
}

function stickyOffset(el) {
  const h = el.querySelector('.shop-head');
  const c = el.querySelector('.sec-chips');
  return (h?.offsetHeight || 0) + (c?.offsetHeight || 0) + 8;
}

function jumpLetter(el, l) {
  const g = el.querySelector(`[data-grp="${l}"]`) || [...el.querySelectorAll('[data-it]')].find((r) => letterOf(r.querySelector('.it-name')?.textContent || '') === l);
  if (g) window.scrollTo({ top: g.getBoundingClientRect().top + window.scrollY - stickyOffset(el) });
}

async function copyFrom(srcId, dstId) {
  const S = store.snapshot();
  const src = listItems(S, srcId);
  for (const it of src) await addToList(store.snapshot(), dstId, { pid: it.pid, name: it.name, qty: Number(it.qty) || 1, unit: it.unit, section: it.section });
  toast(`${src.length} itens copiados`);
}

function moreMenu(anchor, listId) {
  const S = store.snapshot();
  const list = S.byId.get(listId);
  const done = list.status === 'done';
  popover(
    anchor,
    (body, close) => {
      const opts = [
        !done && ['rename', 'Renomear lista', 'edit'],
        !done && ['pay', 'Formas de pagamento', 'card'],
        ['share', 'Compartilhar como texto', 'share'],
        !done && ['clear', 'Tirar tudo do carrinho', 'refresh'],
        ['delete', 'Excluir lista', 'trash'],
      ].filter(Boolean);
      body.innerHTML = `<div class="pick-list">${opts.map(([v, l, ic]) => `<button type="button" class="pick-opt${v === 'delete' ? ' danger-text' : ''}" data-v="${v}"><span class="opt-ic">${icon(ic)}${l}</span></button>`).join('')}</div>`;
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        close(false);
        const v = b.dataset.v;
        if (v === 'rename') {
          const n = await promptDialog('Renomear lista', { label: 'Nome', value: list.name });
          if (n) await store.patch(listId, { name: n });
        } else if (v === 'pay') openPayments(listId);
        else if (v === 'share') {
          const text = shareText(listId);
          if (navigator.share) navigator.share({ title: list.name, text }).catch(() => {});
          else {
            await navigator.clipboard?.writeText(text);
            toast('Lista copiada');
          }
        } else if (v === 'clear') {
          const its = listItems(store.snapshot(), listId).filter((x) => x.checked);
          for (const it of its) await store.patch(it.id, { checked: false });
        } else if (v === 'delete') {
          if (!(await confirmDialog(`Excluir “${list.name}” e seus itens?${done ? ' O estoque e os preços já registrados continuam.' : ''}`, { ok: 'Excluir', danger: true }))) return;
          await store.removeMany([listId, ...listItems(store.snapshot(), listId).map((x) => x.id)]);
          app.nav('listas');
        }
      });
    },
    { title: list.name, cls: 'pop-list', minWidth: 240 },
  );
}

export function leave() {
  lastList = null;
  unsubP?.();
  unsubC?.();
  unsubP = unsubC = null;
  setFocus({ list: null, item: null });
}
