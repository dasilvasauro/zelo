// Regras do Zelo: estoque, consumo, preços e listas.
//
// Estoque sem conflito por construção: a quantidade não é um campo gravado, é o resultado de uma
// sequência de movimentos (tipo 'mov') que só são acrescentados, nunca editados por duas pessoas:
//   compra  +q   (vem da conclusão de uma lista; id determinístico mv_<item>, não duplica)
//   uso     −q   (botão "Usei" no estoque)
//   perda   −q   (estragou, venceu)
//   ajuste  =q   (contagem: "tenho 3"); a contagem mais recente zera o que veio antes dela
import * as store from './store.js';
import { product, sectionName, sectionOrder, domainOf, guessSection } from './catalog.js';
import { nowMs, today } from '../lib/clock.js';
import { addDays, isoOf, uid, norm, WEIGHT_UNITS } from '../lib/util.js';

const DAY = 86400000;

/* ---------- Produtos ---------- */
export function prodOf(pid, item) {
  const p = product(pid);
  if (p) return p;
  // Itens antigos sem produto cadastrado: usa o nome guardado no estoque.
  const inv = item || store.get(`i_${pid}`);
  return { id: pid, name: inv?.name || 'Item', unit: inv?.unit || 'un', section: inv?.section || 'outros', domain: domainOf(inv?.section), aliases: [] };
}

// Produto que não existe no catálogo (dito pela voz ou digitado): vira um produto da casa, cifrado e
// sincronizado, para aparecer na busca, no estoque e no histórico de preços das próximas vezes.
// Id derivado do nome: se duas pessoas criarem "Suco bonbon" ao mesmo tempo, é o mesmo produto.
export async function ensureProduct(name, unit = 'un') {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  const id = `u_${norm(clean).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  if (product(id) || store.get(id)) return id;
  const section = guessSection(clean);
  await store.save('prod', { name: clean[0].toUpperCase() + clean.slice(1), section, domain: domainOf(section), unit, aliases: [], auto: true }, id);
  return id;
}
export const nameOf = (x) => x.name || prodOf(x.pid, x).name;
export const isWeight = (u) => WEIGHT_UNITS.has(u);

/* ---------- Estoque ---------- */
export function qtyAt(movs, until = Infinity) {
  let q = 0;
  for (const m of movs) {
    if ((m.at || 0) > until) break;
    if (m.kind === 'ajuste') q = Number(m.abs) || 0;
    else q += Number(m.delta) || 0;
  }
  return Math.max(0, Math.round(q * 1000) / 1000);
}

export const invQty = (S, pid) => qtyAt(S.movsByPid.get(pid) || []);

// Série diária da quantidade (para os gráficos pequenos e o do detalhe).
export function invSeries(S, pid, days = 30) {
  const movs = S.movsByPid.get(pid) || [];
  const td = today();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(td, -i);
    const end = new Date(`${d}T23:59:59`).getTime();
    out.push({ d, v: qtyAt(movs, end) });
  }
  return out;
}

// Consumo: soma do que saiu (uso, perda e quedas nas contagens) numa janela de dias.
export function consumption(S, pid, windowDays = 60) {
  const movs = S.movsByPid.get(pid) || [];
  const from = nowMs() - windowDays * DAY;
  let used = 0;
  let bought = 0;
  let q = 0;
  let firstBuy = null;
  const buys = [];
  for (const m of movs) {
    const before = q;
    if (m.kind === 'ajuste') q = Number(m.abs) || 0;
    else q += Number(m.delta) || 0;
    q = Math.max(0, q);
    if ((m.at || 0) < from) continue;
    if (m.kind === 'compra') {
      bought += Number(m.delta) || 0;
      buys.push(m.at);
      firstBuy ??= m.at;
    } else if (m.kind === 'uso' || m.kind === 'perda') used += -(Number(m.delta) || 0);
    else if (m.kind === 'ajuste' && q < before) used += before - q;
  }
  const span = Math.max(7, Math.min(windowDays, (nowMs() - (movs[0]?.at || nowMs())) / DAY));
  const useRate = used / span;
  const buyRate = buys.length >= 2 ? bought / Math.max(7, (nowMs() - firstBuy) / DAY) : 0;
  const rate = Math.max(useRate, buyRate);
  const qty = q;
  const gaps = buys.slice(1).map((t, i) => (t - buys[i]) / DAY);
  const every = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  return { used, bought, useRate, buyRate, rate, daysLeft: rate > 0 ? qty / rate : null, every, buys: buys.length };
}

export function invStatus(inv, qty) {
  if (qty <= 0) return 'out';
  if (inv?.min != null && qty <= Number(inv.min)) return 'low';
  return 'ok';
}

// Todos os produtos com algum estoque, histórico ou marcação.
export function inventoryRows(S) {
  const pids = new Set([...S.invByPid.keys(), ...S.movsByPid.keys()]);
  const rows = [];
  for (const pid of pids) {
    const inv = S.invByPid.get(pid) || null;
    if (inv?.archived) continue;
    const p = prodOf(pid, inv);
    const qty = invQty(S, pid);
    rows.push({ pid, inv, p, name: inv?.name || p.name, unit: inv?.unit || p.unit, qty, essential: !!inv?.essential, min: inv?.min ?? null, place: inv?.place || '', status: invStatus(inv, qty), section: p.section, domain: p.domain });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export const essentialsLow = (S) => inventoryRows(S).filter((r) => r.essential && r.status !== 'ok');

export async function ensureInv(pid, extra = {}) {
  const id = `i_${pid}`;
  const cur = store.get(id);
  if (cur) {
    if (Object.keys(extra).length) await store.patch(id, extra);
    return id;
  }
  const p = prodOf(pid, extra);
  await store.save('inv', { pid, name: extra.name || p.name, unit: extra.unit || p.unit, essential: false, min: null, place: '', ...extra }, id);
  return id;
}

export async function addMove(pid, kind, n, note = '') {
  await ensureInv(pid);
  const data = { pid, kind, at: nowMs(), d: today(), note };
  if (kind === 'ajuste') data.abs = n;
  else data.delta = kind === 'compra' ? Math.abs(n) : -Math.abs(n);
  return store.save('mov', data);
}

/* ---------- Preços ---------- */
// Preço por unidade do produto (centavos por un, kg, L...).
export function priceStats(S, pid) {
  const list = (S.pricesByPid.get(pid) || []).filter((x) => x.price > 0);
  if (!list.length) return null;
  const vals = list.map((x) => x.price);
  const byStore = new Map();
  for (const x of list) {
    const k = x.store || '';
    const s = byStore.get(k) || { store: k, n: 0, sum: 0, min: Infinity, last: null };
    s.n++;
    s.sum += x.price;
    s.min = Math.min(s.min, x.price);
    s.last = x;
    byStore.set(k, s);
  }
  for (const s of byStore.values()) s.avg = Math.round(s.sum / s.n);
  const minRec = list.reduce((a, b) => (b.price < a.price ? b : a));
  const recent = list.slice(-3);
  return {
    list,
    last: list[list.length - 1],
    min: minRec,
    max: Math.max(...vals),
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    recentAvg: Math.round(recent.reduce((a, b) => a + b.price, 0) / recent.length),
    byStore: [...byStore.values()].sort((a, b) => a.avg - b.avg),
  };
}

// Compara um preço com o histórico. Referência: a última compra (na mesma loja, se houver).
export function trend(S, pid, price, storeId, excludeList) {
  const st = priceStats(S, pid);
  if (!st) return { dir: 'new' };
  const hist = st.list.filter((x) => x.listId !== excludeList);
  if (!hist.length) return { dir: 'new' };
  const sameStore = storeId ? hist.filter((x) => x.store === storeId) : [];
  const ref = (sameStore.length ? sameStore : hist)[(sameStore.length ? sameStore : hist).length - 1];
  const min = hist.reduce((a, b) => (b.price < a.price ? b : a));
  if (!price) return { dir: 'ref', ref, min };
  const pct = ((price - ref.price) / ref.price) * 100;
  const dir = Math.abs(pct) < 0.5 ? 'eq' : pct > 0 ? 'up' : 'down';
  return { dir, pct, ref, min, best: price <= min.price, sameStore: !!sameStore.length };
}

/* ---------- Listas ---------- */
// Total do item. Itens por peso podem ter o total da etiqueta (priceMode 'total'): ele é o valor pago,
// e o preço por kg é derivado dele (a balança raramente bate com o peso pedido).
export const itemTotal = (it) =>
  it.priceMode === 'total' && it.total != null ? Number(it.total) || 0 : Math.round((Number(it.price) || 0) * (Number(it.qty) || 0));
export const perUnit = (total, qty) => (qty > 0 ? Math.round(total / qty) : 0);

// Como informar o preço de itens por peso: por kg ou pelo total da etiqueta.
// Padrão: total no açougue (bandejas etiquetadas), por kg no resto; o app lembra a última escolha por seção.
export function priceModeFor(section, prefsObj) {
  const saved = prefsObj?.priceMode?.[section];
  if (saved) return saved;
  return section === 'acougue' ? 'total' : 'unit';
}

export function listItems(S, listId) {
  return (S.itemsByList.get(listId) || []).slice();
}

export function listTotals(S, list) {
  const items = listItems(S, list.id);
  let cart = 0;
  let est = 0;
  let checked = 0;
  let noPrice = 0;
  for (const it of items) {
    const t = itemTotal(it);
    if (it.checked) {
      checked++;
      cart += t;
      if (!it.price) noPrice++;
    }
    let p = it.price;
    if (!p) p = priceStats(S, it.pid)?.last?.price || 0;
    est += Math.round(p * (Number(it.qty) || 0));
  }
  const paid = (list.payments || []).reduce((a, x) => a + (x.amount || 0), 0);
  return { n: items.length, checked, cart, est, noPrice, paid, left: cart - paid };
}

export function sortItems(items, mode) {
  const by = {
    secao: (a, b) => sectionOrder(a.section) - sectionOrder(b.section) || nameOf(a).localeCompare(nameOf(b), 'pt-BR'),
    az: (a, b) => nameOf(a).localeCompare(nameOf(b), 'pt-BR'),
    caros: (a, b) => itemTotal(b) - itemTotal(a) || (b.price || 0) - (a.price || 0) || nameOf(a).localeCompare(nameOf(b), 'pt-BR'),
    recentes: (a, b) => (b._ca || 0) - (a._ca || 0),
  }[mode] || ((a, b) => 0);
  return items.sort(by);
}

// Adiciona um produto à lista. Se já estiver lá (e ainda não comprado), soma a quantidade.
export async function addToList(S, listId, { pid, name, qty = 1, price = 0, unit, section, total = null }) {
  // Preço pelo total da etiqueta: guarda o total e deriva o preço por unidade de medida.
  const byTotal = total != null && total > 0;
  if (byTotal) price = perUnit(total, qty);
  const p = pid ? prodOf(pid) : null;
  const items = listItems(S, listId);
  const existing = pid ? items.find((x) => x.pid === pid && !x.checked) : items.find((x) => !x.pid && norm(x.name) === norm(name) && !x.checked);
  if (existing) {
    const nq = Math.round(((Number(existing.qty) || 0) + qty) * 1000) / 1000;
    if (byTotal) {
      const nt = (existing.price ? itemTotal(existing) : 0) + total;
      await store.patch(existing.id, { qty: nq, total: nt, price: perUnit(nt, nq), priceMode: 'total' });
    } else await store.patch(existing.id, { qty: nq, ...(price ? { price } : {}) });
    return existing.id;
  }
  let finalPid = pid;
  let np = p;
  if (!finalPid) {
    finalPid = await ensureProduct(name, unit || 'un');
    np = store.get(finalPid) || prodOf(finalPid);
    const same = listItems(store.snapshot(), listId).find((x) => x.pid === finalPid && !x.checked);
    if (same) {
      await store.patch(same.id, { qty: Math.round(((Number(same.qty) || 0) + qty) * 1000) / 1000, ...(price ? { price } : {}) });
      return same.id;
    }
  }
  return store.save('item', {
    listId,
    pid: finalPid,
    name: '',
    section: np?.section || section || 'outros',
    unit: unit || np?.unit || 'un',
    qty,
    price,
    ...(byTotal ? { total, priceMode: 'total' } : {}),
    checked: false,
  });
}

export async function newList(S, { name, domain = 'mercado', store: storeId = '' } = {}) {
  const n = S.list.filter((l) => l.status !== 'done').length;
  return store.save('list', { name: name || (n ? `Lista ${n + 1}` : 'Compras'), domain, store: storeId, status: 'open', createdAt: nowMs(), payments: [] });
}

// Concluir a compra: itens marcados entram no estoque e no histórico de preços.
// Ids determinísticos (mv_<item>, pr_<item>): se duas pessoas concluírem ao mesmo tempo, não duplica.
// leftover: 'keep' (fica na lista, que continua aberta), 'move' (vai para uma lista nova), 'drop'.
export async function checkout(S, list, { leftover = 'move', storeId, payments }) {
  const items = listItems(S, list.id);
  const bought = items.filter((x) => x.checked);
  const rest = items.filter((x) => !x.checked);
  const at = nowMs();
  const d = today();
  const writes = [];
  for (const it of bought) {
    const pid = it.pid;
    if (!store.get(`i_${pid}`)) {
      const p = prodOf(pid, it);
      writes.push({ type: 'inv', id: `i_${pid}`, data: { pid, name: it.name || p.name, unit: it.unit || p.unit, essential: false, min: null, place: '' } });
    }
    writes.push({ type: 'mov', id: `mv_${it.id}`, data: { pid, kind: 'compra', delta: Number(it.qty) || 1, at, d, listId: list.id, store: storeId || '' } });
    if (it.price > 0) writes.push({ type: 'price', id: `pr_${it.id}`, data: { pid, price: it.price, qty: Number(it.qty) || 1, unit: it.unit, total: itemTotal(it), store: storeId || '', listId: list.id, at, d } });
  }
  let nextId = null;
  if (rest.length && leftover === 'move') {
    nextId = `${list.id}r`; // determinístico: duas conclusões simultâneas geram a mesma lista
    writes.push({ type: 'list', id: nextId, data: { name: `${list.name} (restante)`, domain: list.domain || 'mercado', store: '', status: 'open', createdAt: at + 1, payments: [] } });
    for (const it of rest) writes.push({ type: 'item', id: it.id, data: { ...strip(it), listId: nextId } });
  }
  const total = bought.reduce((a, x) => a + itemTotal(x), 0);
  if (leftover === 'keep' && rest.length) {
    // Os comprados saem desta lista para um registro de compra concluída.
    nextId = uid();
    writes.push({ type: 'list', id: nextId, data: { ...strip(list), name: list.name, store: storeId || '', status: 'done', doneAt: at, createdAt: list.createdAt, total, count: bought.length, payments: payments || [] } });
    for (const it of bought) writes.push({ type: 'item', id: it.id, data: { ...strip(it), listId: nextId } });
    writes.push({ type: 'list', id: list.id, data: { ...strip(list), payments: [] } });
  } else {
    writes.push({ type: 'list', id: list.id, data: { ...strip(list), store: storeId || '', status: 'done', doneAt: at, total, count: bought.length, payments: payments || [] } });
  }
  await store.saveMany(writes);
  if (leftover === 'drop') await store.removeMany(rest.map((x) => x.id));
  return { nextId, count: bought.length, total };
}

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'id' && !k.startsWith('_')));

export const storeName = (S, id) => S.byId.get(id)?.name || '';

// Itens mais comprados (para sugestões ao adicionar).
export function frequent(S, limit = 24) {
  const count = new Map();
  for (const m of S.mov) if (m.kind === 'compra') count.set(m.pid, (count.get(m.pid) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([pid]) => pid);
}

export { sectionName, isoOf };
