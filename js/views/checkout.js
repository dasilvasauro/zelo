// Concluir a compra: local, formas de pagamento (quantas quiser, com o valor de cada uma) e o que
// fazer com o que ficou de fora. Os itens no carrinho entram no estoque e no histórico de preços.
import * as store from '../core/store.js';
import { listTotals, checkout, storeName, listItems, nameOf, sortItems } from '../core/domain.js';
import { esc, money, uid } from '../lib/util.js';
import { icon, sheet, toast, seg } from '../ui/ui.js';
import { askMoney } from '../ui/numpad.js';
import { pickStore, PAY_METHODS, payName } from './common.js';
import { app } from '../state.js';
import { haptic } from '../ui/haptics.js';

// Editor de pagamentos (também usado durante a compra, pelo menu da lista).
export function paymentsHtml(pays, total) {
  const paid = pays.reduce((a, p) => a + (p.amount || 0), 0);
  const diff = total - paid;
  return `<div class="pays">
    ${pays
      .map(
        (p, i) => `<div class="pay-row" data-i="${i}">
        <select data-method="${i}" aria-label="Forma de pagamento">${PAY_METHODS.map(([v, l]) => `<option value="${v}"${v === p.method ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="tile amt-tile" data-amt="${i}"><b>${money(p.amount || 0)}</b></button>
        <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remover forma">${icon('x')}</button>
      </div>`,
      )
      .join('')}
    <div class="pay-foot">
      <button type="button" class="btn ghost" data-addpay>${icon('plus')}${pays.length ? 'Outra forma' : 'Adicionar forma de pagamento'}</button>
      ${pays.length ? `<span class="pay-left ${diff === 0 ? 'pos' : diff > 0 ? 'warn-text' : 'neg'}">${diff === 0 ? `${icon('check', 'sm2')}Fecha com o total` : diff > 0 ? `Faltam ${money(diff)}` : `Passou ${money(-diff)}`}</span>` : ''}
    </div>
  </div>`;
}

export function bindPayments(el, getPays, setPays, getTotal) {
  el.addEventListener('change', (e) => {
    const s = e.target.closest('[data-method]');
    if (!s) return;
    const pays = getPays().slice();
    pays[Number(s.dataset.method)] = { ...pays[Number(s.dataset.method)], method: s.value };
    setPays(pays);
  });
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-amt]');
    if (a) {
      const i = Number(a.dataset.amt);
      const pays = getPays().slice();
      const others = pays.reduce((s, p, j) => s + (j === i ? 0 : p.amount || 0), 0);
      const v = await askMoney(`Valor em ${payName(pays[i].method)}`, pays[i].amount || Math.max(0, getTotal() - others), { sub: `Total da compra: ${money(getTotal())}` });
      if (v == null) return;
      pays[i] = { ...pays[i], amount: v };
      setPays(pays);
      return;
    }
    const r = e.target.closest('[data-rm]');
    if (r) {
      const pays = getPays().slice();
      pays.splice(Number(r.dataset.rm), 1);
      return setPays(pays);
    }
    if (e.target.closest('[data-addpay]')) {
      const pays = getPays().slice();
      const left = getTotal() - pays.reduce((s, p) => s + (p.amount || 0), 0);
      const used = new Set(pays.map((p) => p.method));
      const method = PAY_METHODS.find(([m]) => !used.has(m))?.[0] || 'outro';
      pays.push({ id: uid(6), method, amount: Math.max(0, left) });
      setPays(pays);
    }
  });
}

export function openCheckout(listId) {
  const S = store.snapshot();
  const list = S.byId.get(listId);
  if (!list) return;
  const t = listTotals(S, list);
  if (!t.checked) return toast('Marque os itens que estão no carrinho antes de concluir.');
  let storeId = list.store || '';
  let pays = (list.payments || []).length ? list.payments.slice() : [{ id: uid(6), method: 'credito', amount: t.cart }];
  let leftover = 'move';
  const rest = t.n - t.checked;

  sheet({
    title: 'Concluir compra',
    body: `<div class="form checkout" data-body></div>`,
    onMount(el, close) {
      const body = el.querySelector('[data-body]');
      const draw = () => {
        const S2 = store.snapshot();
        const t2 = listTotals(S2, S2.byId.get(listId) || list);
        body.innerHTML = `
          <div class="co-total"><span>${t2.checked} ${t2.checked === 1 ? 'item' : 'itens'} no carrinho</span><b>${money(t2.cart)}</b>
            ${t2.noPrice ? `<small class="warn-text">${t2.noPrice} sem preço: entram no estoque, mas não no histórico de preços.</small>` : ''}</div>
          <button type="button" class="tile store-tile" data-store>${icon('pin')}<span><small>Local da compra</small><b>${esc(storeName(S2, storeId) || 'Escolher local')}</b></span>${icon('right')}</button>
          <h4 class="sub">Pagamento</h4>
          ${paymentsHtml(pays, t2.cart)}
          ${rest ? `<h4 class="sub">${rest} ${rest === 1 ? 'item ficou' : 'itens ficaram'} de fora</h4>
            ${seg('left', [['move', 'Nova lista'], ['keep', 'Manter nesta'], ['drop', 'Descartar']], leftover)}` : ''}
          <p class="form-meta">Os itens do carrinho entram no estoque${storeId ? ` e os preços ficam registrados no ${esc(storeName(S2, storeId))}` : ' e os preços ficam registrados (sem local)'}.</p>
          <button type="button" class="btn primary big wide" data-go>${icon('check')}Concluir e atualizar estoque</button>`;
      };
      draw();
      bindPayments(
        body,
        () => pays,
        (p) => {
          pays = p;
          store.patch(listId, { payments: pays });
          draw();
        },
        () => listTotals(store.snapshot(), store.snapshot().byId.get(listId) || list).cart,
      );
      body.addEventListener('change', (e) => {
        if (e.target.name === 'left') leftover = e.target.value;
      });
      body.addEventListener('click', async (e) => {
        if (e.target.closest('[data-store]')) {
          const s = await pickStore(storeId);
          if (s !== undefined) {
            storeId = s;
            await store.patch(listId, { store: s });
            draw();
          }
          return;
        }
        if (e.target.closest('[data-go]')) {
          const S3 = store.snapshot();
          const l3 = S3.byId.get(listId);
          if (!l3) return close();
          const tot = listTotals(S3, l3);
          const paid = pays.reduce((a, p) => a + (p.amount || 0), 0);
          if (pays.length && paid !== tot.cart && !body.dataset.warned) {
            body.dataset.warned = '1';
            return toast(`Os pagamentos somam ${money(paid)} e a compra deu ${money(tot.cart)}. Toque de novo para concluir assim.`, { ms: 5000 });
          }
          const r = await checkout(S3, l3, { leftover, storeId, payments: pays.filter((p) => p.amount > 0) });
          close();
          haptic('add');
          toast(`Compra concluída: ${r.count} ${r.count === 1 ? 'item entrou' : 'itens entraram'} no estoque`, r.nextId && leftover === 'move' ? { action: 'Abrir restante', onAction: () => app.nav(`lista-${r.nextId}`) } : {});
          app.nav(leftover === 'keep' ? `lista-${listId}` : 'listas');
        }
      });
    },
  });
}

export function openPayments(listId) {
  const S = store.snapshot();
  const list = S.byId.get(listId);
  let pays = (list.payments || []).slice();
  sheet({
    title: 'Formas de pagamento',
    body: `<div class="form" data-body></div>`,
    onMount(el) {
      const body = el.querySelector('[data-body]');
      const total = () => listTotals(store.snapshot(), store.snapshot().byId.get(listId)).cart;
      const draw = () => {
        body.innerHTML = `<p class="sheet-text">No carrinho: <b>${money(total())}</b>. Divida entre quantas formas precisar; vale para quem estiver comprando junto.</p>${paymentsHtml(pays, total())}`;
      };
      draw();
      bindPayments(body, () => pays, (p) => {
        pays = p;
        store.patch(listId, { payments: pays });
        draw();
      }, total);
    },
  });
}

export function shareText(listId) {
  const S = store.snapshot();
  const list = S.byId.get(listId);
  const items = sortItems(listItems(S, listId).filter((x) => !x.checked), 'secao');
  return `${list.name}\n` + items.map((x) => `• ${Number(x.qty) !== 1 ? `${x.qty} ` : ''}${nameOf(x)}`).join('\n');
}
