// Embalagens em casa: cada unidade fechada ou aberta, e onde está guardada.
//
// A quantidade em estoque continua sendo a soma dos movimentos (compra, uso, contagem), que é o que
// alimenta gráficos e previsões. As unidades (tipo 'unit') detalham essa quantidade:
//   { pid, place, state: 'closed'|'open', amount, openedAt }
// - Itens contados (un, pct, lata…): uma unidade por embalagem, amount = 1.
// - Itens por peso (kg, L…): uma unidade por pacote comprado, amount = peso do pacote.
// Só existe registro para unidades que alguém mexeu (abriu, moveu) ou pacotes por peso comprados numa
// lista. O resto aparece como unidades fechadas "virtuais" no lugar padrão do produto. Assim, o que
// entrou por "Contei" ou "Entrou" já aparece, sem gravar dezenas de registros.
// Se os registros somarem mais que o estoque (alguém registrou uso pelo botão −), as abertas saem primeiro.
//
// Conflitos: abrir e mover são campos de um registro (junção por campo). Usar uma unidade gera um
// movimento com id derivado da unidade (mv_u_<id>): se duas pessoas tocarem na mesma unidade ao mesmo
// tempo, o consumo conta uma vez só.
import * as store from './store.js';
import { invQty, prodOf, isWeight } from './domain.js';
import { nowMs, today } from '../lib/clock.js';
import { uid } from '../lib/util.js';

export const PLACES = ['Geladeira', 'Freezer', 'Despensa', 'Fruteira', 'Armário da cozinha', 'Área de serviço', 'Banheiro', 'Garagem', 'Depósito', 'Outro'];
const EPS = 1e-6;

// Onde guardar por padrão, pela seção do produto.
const BY_SECTION = {
  hortifruti: 'Geladeira', frios: 'Geladeira', acougue: 'Geladeira', congelados: 'Freezer', bebidas: 'Despensa', alcool: 'Despensa',
  limpeza: 'Área de serviço', lavanderia: 'Área de serviço', higiene: 'Banheiro', banheiro: 'Banheiro', farmacia: 'Banheiro', papel: 'Despensa',
  cozinha: 'Armário da cozinha', eletricos: 'Depósito', pet: 'Área de serviço', bebe: 'Banheiro',
  ferragens: 'Depósito', eletrica: 'Depósito', hidraulica: 'Depósito', tintas: 'Depósito', ferramentas: 'Garagem', obra: 'Garagem', jardim: 'Garagem', epi: 'Garagem',
};
export function defaultPlace(pid, inv) {
  if (inv?.place) return inv.place;
  return BY_SECTION[prodOf(pid, inv).section] || 'Despensa';
}

const r3 = (n) => Math.round(n * 1000) / 1000;

// Unidades do produto, conciliadas com a quantidade em estoque.
export function unitsOf(S, pid) {
  const inv = S.invByPid.get(pid) || null;
  const unit = inv?.unit || prodOf(pid, inv).unit;
  const weight = isWeight(unit);
  const qty = invQty(S, pid);
  const recs = (S.unitsByPid.get(pid) || []).map((u) => ({ ...u, amount: weight ? Number(u.amount) || 0 : 1, virtual: false }));
  // Abertas primeiro (mais antigas antes), depois fechadas.
  recs.sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) || (a.openedAt || a._ca || 0) - (b.openedAt || b._ca || 0));
  let sum = recs.reduce((a, u) => a + u.amount, 0);
  let list = recs;
  if (sum > qty + EPS) {
    // Sobra registro: tira das abertas mais antigas, depois das fechadas mais novas.
    let excess = sum - qty;
    const order = [...recs.filter((u) => u.state === 'open'), ...recs.filter((u) => u.state !== 'open').reverse()];
    const drop = new Set();
    for (const u of order) {
      if (excess <= EPS) break;
      if (u.amount <= excess + EPS) {
        drop.add(u.id);
        excess -= u.amount;
      } else {
        u.amount = r3(u.amount - excess);
        excess = 0;
      }
    }
    list = recs.filter((u) => !drop.has(u.id));
    sum = qty;
  }
  if (qty - sum > EPS) {
    const place = defaultPlace(pid, inv);
    const rest = r3(qty - sum);
    if (weight) list.push({ id: `v_${pid}_0`, pid, place, state: 'closed', amount: rest, virtual: true });
    else {
      const n = Math.max(1, Math.round(rest));
      for (let k = 0; k < Math.min(n, 99); k++) list.push({ id: `v_${pid}_${k}`, pid, place, state: 'closed', amount: 1, virtual: true });
    }
  }
  return list;
}

// Agrupa por lugar: Map(place → unidades), na ordem de PLACES.
export function byPlace(units) {
  const m = new Map();
  for (const u of units) {
    const p = u.place || 'Despensa';
    if (!m.has(p)) m.set(p, []);
    m.get(p).push(u);
  }
  return new Map([...m.entries()].sort((a, b) => placeOrder(a[0]) - placeOrder(b[0])));
}
export const placeOrder = (p) => {
  const i = PLACES.indexOf(p);
  return i < 0 ? 50 : i;
};

const recData = (u, extra = {}) => ({ pid: u.pid, place: u.place, state: u.state, amount: u.amount, openedAt: u.openedAt || null, ...extra });

// Fechado → aberto. Se o produto tiver "ao abrir, guardar em", muda de lugar.
export async function openUnit(S, u) {
  const inv = S.invByPid.get(u.pid);
  const place = inv?.openPlace || u.place;
  const data = { state: 'open', openedAt: nowMs(), place };
  if (u.virtual) return store.save('unit', recData(u, data));
  return store.patch(u.id, data);
}

export async function closeUnit(u) {
  if (u.virtual) return null;
  return store.patch(u.id, { state: 'closed', openedAt: null, place: u.place });
}

// Aberto → usado: sai do estoque. Devolve o que é preciso para desfazer.
export async function consumeUnit(S, u) {
  const id = u.virtual ? uid() : u.id;
  const movId = `mv_u_${id}`;
  await store.save('mov', { pid: u.pid, kind: 'uso', delta: -u.amount, at: nowMs(), d: today(), note: u.state === 'open' ? 'embalagem aberta' : 'embalagem' }, movId);
  const before = u.virtual ? null : store.get(u.id);
  if (!u.virtual) await store.remove(u.id);
  return { movId, before };
}
export async function undoConsume({ movId, before }) {
  await store.remove(movId);
  if (before) {
    const { id, ...rest } = before;
    await store.save('unit', Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith('_'))), id);
  }
}

// Move unidades para outro lugar e aprende o lugar preferido do produto:
// mover aberta define "ao abrir, guardar em"; mover fechada define o lugar padrão das novas.
export async function moveUnits(S, units, place) {
  const writes = [];
  for (const u of units) {
    if (u.place === place) continue;
    if (u.virtual) writes.push({ type: 'unit', id: uid(), data: recData(u, { place }) });
    else writes.push({ type: 'unit', id: u.id, data: recData({ ...store.get(u.id), ...u }, { place }) });
  }
  if (!writes.length) return 0;
  await store.saveMany(writes);
  const pid = units[0].pid;
  const inv = S.invByPid.get(pid);
  const allOpen = units.every((u) => u.state === 'open');
  const allClosed = units.every((u) => u.state !== 'open');
  const learn = allOpen ? { openPlace: place } : allClosed ? { place } : null;
  if (learn) {
    const id = `i_${pid}`;
    if (inv) await store.patch(id, learn);
    else {
      const p = prodOf(pid);
      await store.save('inv', { pid, name: p.name, unit: p.unit, essential: false, min: null, place: '', ...learn }, id);
    }
  }
  return writes.length;
}

// Ajusta os registros depois de um uso pelo botão − ou de uma contagem: tira abertas primeiro.
export async function trimTo(S, pid, newQty) {
  const recs = S.unitsByPid.get(pid) || [];
  if (!recs.length) return;
  const inv = S.invByPid.get(pid);
  const weight = isWeight(inv?.unit || prodOf(pid, inv).unit);
  let sum = recs.reduce((a, u) => a + (weight ? Number(u.amount) || 0 : 1), 0);
  if (sum <= newQty + EPS) return;
  let excess = sum - newQty;
  const order = [...recs.filter((u) => u.state === 'open').sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0)), ...recs.filter((u) => u.state !== 'open').sort((a, b) => (b._ca || 0) - (a._ca || 0))];
  const drop = [];
  for (const u of order) {
    if (excess <= EPS) break;
    const amt = weight ? Number(u.amount) || 0 : 1;
    if (amt <= excess + EPS) {
      drop.push(u.id);
      excess -= amt;
    } else {
      await store.patch(u.id, { amount: r3(amt - excess) });
      excess = 0;
    }
  }
  if (drop.length) await store.removeMany(drop);
}

// Pacotes por peso comprados numa lista viram unidades fechadas (uma por pacote) no lugar padrão.
export function purchaseUnits(S, it, pid) {
  const inv = S.invByPid.get(pid);
  const unit = it.unit || prodOf(pid, it).unit;
  if (!isWeight(unit)) return [];
  return [{ type: 'unit', id: `un_${it.id}`, data: { pid, place: defaultPlace(pid, inv), state: 'closed', amount: Number(it.qty) || 0, openedAt: null } }];
}
