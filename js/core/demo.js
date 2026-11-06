// Modo demo: dados fictícios realistas (90 dias de compras, preços em vários locais, uso do estoque)
// e uma segunda pessoa simulada, a Ana, que compra junto na mesma lista. Ela marca itens, põe preços,
// adiciona coisas e pode provocar um conflito de edição de propósito, para você ver como o Zelo resolve.
// Tudo fica num banco separado neste navegador; nada vai para a nuvem.
import * as store from './store.js';
import * as cat from './catalog.js';
import { prodOf, listItems, frequent } from './domain.js';
import { usePresence } from './presence.js';
import { nowMs, today } from '../lib/clock.js';
import { uid, addDays, isoOf } from '../lib/util.js';
import { app } from '../state.js';

const DAY = 86400000;
const ANA = 'ana';

// nome, preço base (centavos por unidade do produto), qtd por compra, intervalo em dias, seção da loja
const BASKET = [
  ['Leite integral 1L', 549, 6, 7],
  ['Arroz branco 5kg', 2790, 1, 30],
  ['Feijão carioca', 899, 2, 14],
  ['Café em pó', 1890, 1, 12],
  ['Açúcar refinado', 489, 1, 21],
  ['Óleo de soja', 799, 1, 25],
  ['Ovos brancos', 1290, 1, 10],
  ['Banana prata', 699, 1.2, 7, 'feira'],
  ['Tomate', 899, 1, 7, 'feira'],
  ['Cebola', 549, 1, 14, 'feira'],
  ['Batata', 599, 1.5, 10, 'feira'],
  ['Alface crespa', 350, 1, 7, 'feira'],
  ['Pão francês', 1590, 0.5, 4],
  ['Peito de frango', 1990, 1, 7],
  ['Carne moída', 3690, 0.8, 10],
  ['Queijo mussarela', 4990, 0.4, 14],
  ['Manteiga', 1290, 1, 20],
  ['Iogurte natural', 399, 4, 7],
  ['Macarrão espaguete', 549, 2, 14],
  ['Molho de tomate', 299, 3, 10],
  ['Refrigerante 2L', 999, 2, 7],
  ['Cerveja lata', 399, 12, 14],
  ['Biscoito recheado', 349, 3, 10],
  ['Papel higiênico', 2290, 1, 20],
  ['Detergente', 289, 2, 14],
  ['Sabão em pó', 2490, 1, 30],
  ['Amaciante', 1590, 1, 30],
  ['Água sanitária', 699, 1, 30],
  ['Esponja de cozinha', 549, 1, 21],
  ['Saco de lixo 50L', 990, 1, 21],
  ['Pasta de dente', 599, 2, 25],
  ['Sabonete em barra', 299, 4, 20],
  ['Shampoo', 1890, 1, 40],
];
const ESSENTIALS = {
  'Leite integral 1L': [2, 5],
  'Café em pó': [1, 0],
  'Arroz branco 5kg': [1, 1],
  'Feijão carioca': [1, 2],
  'Papel higiênico': [1, 2],
  'Detergente': [1, 0.0],
  'Ovos brancos': [1, 1],
  'Pasta de dente': [1, 2],
  'Sabão em pó': [1, 1],
  'Óleo de soja': [1, 2],
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pidOf = (name) => cat.bestMatch(name)?.id || cat.search(name, 1)[0]?.id;

export async function seedDemo() {
  const now = nowMs();
  const writes = [];
  const W = (type, data, id = uid()) => (writes.push({ type, data, id }), id);

  W('member', { uid: 'local', name: 'Você', color: '#7C8CFF' }, 'm_local');
  W('member', { uid: ANA, name: 'Ana', color: '#F59AC0' }, `m_${ANA}`);
  const st = {
    atac: W('store', { name: 'Atacadão', kind: 'atacado', color: '#F2C14E' }),
    pao: W('store', { name: 'Pão de Açúcar', kind: 'mercado', color: '#5FE3B5' }),
    feira: W('store', { name: 'Feira da Rua 7', kind: 'feira', color: '#9BD16A' }),
    leroy: W('store', { name: 'Leroy Merlin', kind: 'construcao', color: '#F0995A' }),
  };
  const storeFactor = { [st.atac]: 0.93, [st.pao]: 1.07, [st.feira]: 0.9, [st.leroy]: 1 };

  const basket = BASKET.map(([name, base, qty, every, kind]) => ({ name, pid: pidOf(name), base, qty, every, kind, next: -90 + Math.floor(rnd(0, every)), stock: 0 })).filter((b) => b.pid);

  // Idas ao mercado: semanal (alternando atacado e supermercado) e feira às quartas.
  const trips = [];
  for (let d = -88; d <= -2; d += 7) trips.push({ day: d, store: trips.length % 2 ? st.pao : st.atac, kind: 'market' });
  for (let d = -85; d <= -2; d += 7) trips.push({ day: d, store: st.feira, kind: 'feira' });
  trips.sort((a, b) => a.day - b.day);

  const usage = []; // movimentos de uso gerados entre compras
  for (const tr of trips) {
    const at = now + tr.day * DAY + 10 * 3600000 + Math.floor(rnd(0, 4)) * 3600000;
    const due = basket.filter((b) => (tr.kind === 'feira' ? b.kind === 'feira' : b.kind !== 'feira') && b.next <= tr.day + 3);
    if (!due.length) continue;
    const listId = uid();
    let total = 0;
    for (const b of due) {
      const drift = 1 + (tr.day + 90) * 0.0006;
      const price = Math.round((b.base * drift * (storeFactor[tr.store] || 1) * rnd(0.95, 1.05)) / 10) * 10 - 1;
      const itemId = uid();
      const p = prodOf(b.pid);
      W('item', { listId, pid: b.pid, name: '', section: p.section, unit: p.unit, qty: b.qty, price, checked: true, checkedBy: Math.random() < 0.4 ? ANA : 'local', checkedAt: at }, itemId);
      W('mov', { pid: b.pid, kind: 'compra', delta: b.qty, at, d: isoOf(new Date(at)), listId, store: tr.store }, `mv_${itemId}`);
      W('price', { pid: b.pid, price, qty: b.qty, unit: p.unit, store: tr.store, listId, at, d: isoOf(new Date(at)) }, `pr_${itemId}`);
      total += Math.round(price * b.qty);
      b.next = tr.day + b.every + Math.round(rnd(-2, 2));
      b.stock += b.qty;
      // consumo até a próxima compra, registrado em alguns dias
      const per = b.qty / b.every;
      const whole = !['kg', 'L', 'g', 'ml', 'm', 'm2'].includes(p.unit);
      if (whole) {
        // unidades inteiras: uma saída a cada tanto
        const n = Math.round(b.qty);
        for (let k = 1; k <= n; k++) {
          const day = tr.day + Math.round((b.every / (n + 0.4)) * k * rnd(0.85, 1.1));
          if (day >= 0) break;
          usage.push({ pid: b.pid, at: now + day * DAY + 20 * 3600000, amt: 1 });
        }
      } else
        for (let k = 2; k < b.every; k += Math.max(2, Math.round(b.every / 4))) {
          const day = tr.day + k;
          if (day >= 0) break;
          const amt = Math.round(per * Math.max(2, Math.round(b.every / 4)) * rnd(0.7, 1.2) * 100) / 100;
          if (amt > 0) usage.push({ pid: b.pid, at: now + day * DAY + 20 * 3600000, amt });
        }
    }
    const split = Math.random() < 0.5 && tr.kind === 'market';
    const va = split ? Math.min(total, Math.round(total * rnd(0.4, 0.7))) : 0;
    const payments = tr.kind === 'feira' ? [{ id: uid(6), method: 'pix', amount: total }] : split ? [{ id: uid(6), method: 'va', amount: va }, { id: uid(6), method: 'credito', amount: total - va }] : [{ id: uid(6), method: pick(['credito', 'debito']), amount: total }];
    W('list', { name: tr.kind === 'feira' ? 'Feira' : 'Compras da semana', domain: 'mercado', store: tr.store, status: 'done', createdAt: at - 2 * DAY, doneAt: at, total, count: due.length, payments }, listId);
  }
  for (const u of usage) W('mov', { pid: u.pid, kind: 'uso', delta: -u.amt, at: u.at, d: isoOf(new Date(u.at)) });

  // Estoque atual e essenciais (contagem de 2 dias atrás deixa o cenário variado).
  for (const b of basket) {
    const e = ESSENTIALS[b.name];
    const p = prodOf(b.pid);
    W('inv', { pid: b.pid, name: p.name, unit: p.unit, essential: !!e, min: e ? e[0] : null, place: /Banana|Batata|Cebola|Tomate/.test(p.name) ? 'Fruteira' : '' }, `i_${b.pid}`);
    if (e) W('mov', { pid: b.pid, kind: 'ajuste', abs: e[1], at: now - 2 * DAY, d: addDays(today(), -2), note: 'contagem' });
  }

  // Embalagens abertas e lugares (o leite fica fechado na despensa e, aberto, vai para a geladeira).
  const OPEN = { 'Leite integral 1L': ['Despensa', 'Geladeira'], 'Papel higiênico': ['Despensa', 'Banheiro'], 'Feijão carioca': ['Armário da cozinha', null], 'Óleo de soja': ['Armário da cozinha', null], 'Pasta de dente': ['Banheiro', null], 'Ovos brancos': ['Geladeira', null] };
  for (const [name, [place, openPlace]] of Object.entries(OPEN)) {
    const b = basket.find((x) => x.name === name);
    if (!b) continue;
    const inv = writes.find((w) => w.id === `i_${b.pid}`);
    if (inv) Object.assign(inv.data, { place, openPlace });
    W('unit', { pid: b.pid, place: openPlace || place, state: 'open', amount: 1, openedAt: now - Math.round(rnd(1, 4)) * DAY });
  }

  // Grupos essenciais ativos na demo.
  W('pref', { active: ['mistura', 'laticinios', 'frutas', 'cafe', 'limpeza'], days: {} }, 'pref_groups');

  // Lista aberta, já começada no mercado.
  const open = W('list', { name: 'Compras da semana', domain: 'mercado', store: st.atac, status: 'open', createdAt: now - 3600000, payments: [] });
  const want = ['Leite integral 1L', 'Café em pó', 'Pão de forma', 'Banana prata', 'Ovos brancos', 'Peito de frango', 'Iogurte natural', 'Macarrão espaguete', 'Molho de tomate', 'Detergente', 'Papel higiênico', 'Queijo mussarela', 'Cream cheese', 'Bacon', 'Refrigerante 2L', 'Biscoito recheado', 'Shampoo', 'Ketchup', 'Batata chips', 'Água com gás'];
  want.forEach((name, i) => {
    const pid = pidOf(name);
    if (!pid) return;
    const p = prodOf(pid);
    const b = basket.find((x) => x.pid === pid);
    const qty = b ? b.qty : p.unit === 'kg' ? 1 : 1;
    const checked = i % 3 === 0;
    const ref = b ? Math.round(b.base * 1.05 * 0.93) : Math.round(rnd(400, 1500));
    const price = checked || i === 4 ? Math.round((ref * (i % 2 ? 0.96 : 1.06)) / 10) * 10 - 1 : 0;
    W('item', { listId: open, pid, name: '', section: p.section, unit: p.unit, qty, price, checked, checkedBy: checked ? (i % 2 ? ANA : 'local') : null, checkedAt: checked ? now - (20 - i) * 60000 : null });
  });

  // Uma lista de construção.
  const obra = W('list', { name: 'Reforma do banheiro', domain: 'construcao', store: st.leroy, status: 'open', createdAt: now - 3 * DAY, payments: [] });
  for (const [name, qty] of [['Rejunte', 2], ['Silicone', 1], ['Torneira', 1], ['Veda-rosca', 2], ['Fita crepe', 1], ['Argamassa AC-III', 2], ['Piso cerâmico', 6]]) {
    const pid = pidOf(name);
    if (!pid) continue;
    const p = prodOf(pid);
    W('item', { listId: obra, pid, name: '', section: p.section, unit: p.unit, qty, price: 0, checked: false });
  }

  await store.saveMany(writes);
}

/* ---------- A Ana, comprando junto ---------- */
const presence = new Map();
let psub = () => {};
let timer = 0;
let busy = false;
const KEY = 'zelo.demoPartner';
export const partnerOn = () => localStorage.getItem(KEY) !== '0';
export function setPartner(on) {
  localStorage.setItem(KEY, on ? '1' : '0');
  if (!on) {
    presence.delete(ANA);
    psub(new Map(presence));
  }
}

export function startPartner() {
  usePresence({
    set: () => {},
    on: (f) => {
      psub = f;
      f(new Map(presence));
    },
  });
  const loop = () => {
    timer = setTimeout(async () => {
      try {
        if (partnerOn() && document.visibilityState === 'visible') await act();
      } catch (e) {
        console.warn(e);
      }
      loop();
    }, rnd(7000, 13000));
  };
  loop();
}

const setAna = (p) => {
  if (!partnerOn()) return;
  presence.set(ANA, { at: Date.now(), list: null, item: null, ...p });
  psub(new Map(presence));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function act() {
  if (busy) return;
  const listId = app.focus.list;
  const S = store.snapshot();
  const open = S.list.filter((l) => l.status !== 'done');
  if (!listId) {
    // Fora de uma lista, a Ana fica "na" lista de compras aberta.
    if (open[0]) setAna({ list: open[0].id });
    return;
  }
  busy = true;
  setAna({ list: listId });
  const items = listItems(S, listId);
  const todo = items.filter((x) => !x.checked && x.id !== app.focus.item);
  const r = Math.random();
  if (r < 0.5 && todo.length) {
    const it = pick(todo);
    setAna({ list: listId, item: it.id });
    await sleep(2600);
    const st = S.pricesByPid.get(it.pid) || [];
    const ref = st.length ? st[st.length - 1].price : Math.round(rnd(300, 1800));
    const price = it.price || Math.round((ref * rnd(0.94, 1.08)) / 10) * 10 - 1;
    const v = store.foreignVersion(it.id, { checked: true, price, checkedBy: ANA, checkedAt: Date.now() }, ANA);
    if (v) await store.applyPlainMany([v]);
  } else if (r < 0.7) {
    const inList = new Set(items.map((x) => x.pid));
    const pool = frequent(S, 40).filter((pid) => !inList.has(pid));
    if (pool.length) {
      const pid = pick(pool);
      const p = prodOf(pid);
      await store.applyPlainMany([store.foreignNew('item', { listId, pid, name: '', section: p.section, unit: p.unit, qty: 1, price: 0, checked: false }, ANA)]);
    }
  } else if (r < 0.85 && todo.length) {
    const it = pick(todo);
    setAna({ list: listId, item: it.id });
    await sleep(1800);
    const v = store.foreignVersion(it.id, { qty: (Number(it.qty) || 1) + 1 }, ANA);
    if (v) await store.applyPlainMany([v]);
  }
  setAna({ list: listId, item: null });
  busy = false;
}

// Provoca um conflito de propósito, de um destes dois jeitos:
// 1. Se você mudou um preço há pouco: a Ana muda o MESMO preço. O aviso "Ana mudou… Manter o meu / Ficar com…" aparece.
// 2. Senão: fica de prontidão. Ao abrir o preço de um item, a Ana muda esse preço enquanto você digita;
//    o teclado avisa na hora e, ao salvar, o Zelo pergunta qual valor fica.
let armed = 0;
async function anaChangesPrice(it) {
  setAna({ list: it.listId, item: it.id });
  const base = it.price || 999;
  const price = base + Math.round(rnd(3, 9)) * 10;
  const v = store.foreignVersion(it.id, { price }, ANA, { concurrent: true });
  if (v) await store.applyPlainMany([v]);
  setTimeout(() => setAna({ list: it.listId, item: null }), 5000);
}
export async function simulateConflict() {
  const it = app.lastEdited && store.get(app.lastEdited);
  if (it && Date.now() - (app.lastEditedAt || 0) < 14 * 60000) {
    await anaChangesPrice(it);
    return 'A Ana mudou o mesmo preço que você acabou de pôr. Escolha qual fica no aviso.';
  }
  armed = Date.now();
  const poll = setInterval(async () => {
    if (Date.now() - armed > 30000) return clearInterval(poll);
    const id = app.focus.item;
    if (!id) return;
    clearInterval(poll);
    armed = 0;
    await sleep(2500);
    const cur = store.get(id);
    if (cur && app.focus.item === id) await anaChangesPrice(cur);
  }, 400);
  return 'Agora toque no preço de um item e comece a digitar: a Ana vai mudar o mesmo preço ao mesmo tempo.';
}

export function stopPartner() {
  clearTimeout(timer);
}
