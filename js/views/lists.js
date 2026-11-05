// Listas: o que está aberto, o que está acabando e as compras já feitas.
import * as store from '../core/store.js';
import * as cat from '../core/catalog.js';
import { listTotals, storeName, essentialsLow, newList, addToList, listItems, nameOf, itemTotal } from '../core/domain.js';
import { inList, onPresence } from '../core/presence.js';
import { esc, money, fmtDay, fmtNum, unitLabel, isoOf } from '../lib/util.js';
import { icon, sheet, toast, seg } from '../ui/ui.js';
import { avatarDot, payName } from './common.js';
import { app } from '../state.js';
import { haptic } from '../ui/haptics.js';

export const title = 'Listas';
let unsubP = null;

export function render(el) {
  const S = store.snapshot();
  unsubP ||= onPresence(() => location.hash.startsWith('#listas') && app.refresh());
  const open = S.list.filter((l) => l.status !== 'done');
  const done = S.list.filter((l) => l.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const low = essentialsLow(S);
  const month = isoOf(new Date()).slice(0, 7);
  const monthTotal = done.filter((l) => isoOf(new Date(l.doneAt || 0)).slice(0, 7) === month).reduce((a, l) => a + (l.total || 0), 0);

  el.innerHTML = `
    ${low.length ? `<section class="alert soft">
      <div class="alert-txt"><b>${icon('star')}${low.length} ${low.length === 1 ? 'essencial acabando' : 'essenciais acabando'}</b>
        <span>${esc(low.slice(0, 5).map((r) => r.name).join(', '))}${low.length > 5 ? '…' : ''}</span></div>
      <div class="alert-acts"><button type="button" class="btn small primary" data-low>Pôr na lista</button><a class="btn small ghost" href="#estoque">Ver estoque</a></div>
    </section>` : ''}

    <section class="block first">
      <header class="block-head"><h3>Abertas</h3><button type="button" class="btn small" data-new>${icon('plus')}Nova lista</button></header>
      ${open.length ? `<div class="list-cards">${open.map((l) => card(S, l)).join('')}</div>` : `<div class="empty-block">${icon('cart')}<p>Nenhuma lista aberta.</p><button type="button" class="btn primary" data-new>${icon('plus')}Criar lista</button></div>`}
    </section>

    <section class="block">
      <header class="block-head"><h3>Compras concluídas</h3>${monthTotal ? `<span class="link nolink">${money(monthTotal)} este mês</span>` : ''}</header>
      ${done.length ? `<ul class="rows">${done
        .slice(0, 30)
        .map(
          (l) => `<li><button type="button" class="row-btn" data-done="${l.id}">
          <span class="row-ic" style="color:${S.byId.get(l.store)?.color || 'var(--muted)'}">${icon('pin')}</span>
          <span class="row-main"><b>${esc(storeName(S, l.store) || l.name)}</b><span>${fmtDay(isoOf(new Date(l.doneAt || l.createdAt)))} · ${l.count || listItems(S, l.id).length} itens${(l.payments || []).length ? ` · ${esc(l.payments.map((p) => payName(p.method)).join(' + '))}` : ''}</span></span>
          <span class="amt">${money(l.total || 0)}</span></button></li>`,
        )
        .join('')}</ul>` : `<p class="empty">As compras concluídas aparecem aqui, com local, total e formas de pagamento.</p>`}
    </section>`;

  el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', createList));
  el.querySelector('[data-low]')?.addEventListener('click', async () => {
    const S2 = store.snapshot();
    let target = S2.list.find((l) => l.status !== 'done' && (l.domain || 'mercado') === 'mercado') || S2.list.find((l) => l.status !== 'done');
    const id = target?.id || (await newList(S2, { name: 'Reposição' }));
    for (const r of low) await addToList(store.snapshot(), id, { pid: r.pid, qty: Math.max(1, Math.ceil((r.min || 1) - r.qty) || 1) });
    haptic('add');
    toast(`${low.length} essenciais na lista ${store.get(id)?.name}`);
    app.nav(`lista-${id}`);
  });
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => app.nav(`lista-${b.dataset.open}`)));
  el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => doneSheet(b.dataset.done)));
}

function card(S, l) {
  const t = listTotals(S, l);
  const pct = t.n ? Math.round((t.checked / t.n) * 100) : 0;
  const here = inList(l.id);
  return `<button type="button" class="list-card" data-open="${l.id}">
    <div class="lc-top"><b>${esc(l.name)}</b>${here.length ? `<span class="lc-who">${here.map((u) => avatarDot(S, u, 22)).join('')}</span>` : ''}</div>
    <span class="lc-meta">${esc(cat.domainName(l.domain || 'mercado'))}${l.store ? ` · ${esc(storeName(S, l.store))}` : ''}</span>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="lc-foot"><span>${t.checked}/${t.n} itens</span><span>${t.checked ? `<b>${money(t.cart)}</b> no carrinho` : t.est ? `previsto ${money(t.est)}` : ''}</span></div>
  </button>`;
}

export function createList() {
  sheet({
    title: 'Nova lista',
    body: `<form class="form" data-f>
      <label class="field"><span>Nome</span><input name="name" placeholder="Ex.: Compras da semana" maxlength="40" autofocus></label>
      <div class="field"><span>Tipo</span>${seg('domain', cat.DOMAINS.map((d) => [d.id, d.name]), 'mercado')}</div>
      <div class="sheet-actions"><span></span><button class="btn primary">${icon('plus')}Criar e abrir</button></div>
    </form>`,
    onMount(el, close) {
      el.querySelector('[data-f]').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const domain = f.querySelector('input[name=domain]:checked').value;
        const id = await newList(store.snapshot(), { name: f.name.value.trim() || { mercado: 'Compras', casa: 'Casa', construcao: 'Obra' }[domain], domain });
        close();
        app.nav(`lista-${id}`);
      };
    },
  });
}

function doneSheet(id) {
  const S = store.snapshot();
  const l = S.byId.get(id);
  const items = listItems(S, id).filter((x) => x.checked);
  sheet({
    title: storeName(S, l.store) || l.name,
    body: `<div class="form">
      <p class="sheet-text">${esc(l.name)} · ${fmtDay(isoOf(new Date(l.doneAt || l.createdAt)))}</p>
      <ul class="parts">${items.map((x) => `<li><span>${esc(nameOf(x))}<small>${fmtNum(x.qty)} ${esc(unitLabel(x.unit))}${x.price ? ` × ${money(x.price)}` : ''}</small></span><b>${x.price ? money(itemTotal(x)) : '—'}</b></li>`).join('')}
      <li class="total"><span>Total</span><span>${money(l.total || 0)}</span></li></ul>
      ${(l.payments || []).length ? `<h4 class="sub">Pagamento</h4><ul class="parts">${l.payments.map((p) => `<li><span>${esc(payName(p.method))}</span><b>${money(p.amount)}</b></li>`).join('')}</ul>` : ''}
      <div class="sheet-actions"><span></span><button type="button" class="btn" data-open>${icon('list')}Abrir lista</button></div>
    </div>`,
    onMount(el, close) {
      el.querySelector('[data-open]').onclick = () => {
        close();
        app.nav(`lista-${id}`);
      };
    },
  });
}
