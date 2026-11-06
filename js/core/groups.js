// Grupos essenciais: "estamos ficando sem mistura", "sem frutas", "leite quase no fim".
//
// Um grupo reúne produtos que se substituem no dia a dia (frango OU carne OU ovos são "mistura").
// O que importa é quanto o grupo inteiro ainda dura, não cada item:
//   dias do grupo = soma, para cada item em casa, de quantidade ÷ consumo por dia.
// Sem histórico de consumo, conta quantos itens do grupo ainda há em casa.
// Prioridade aos essenciais: se um item marcado como essencial dentro do grupo está acabando, o aviso
// fala dele pelo nome ("Leite quase no fim"), e as sugestões de compra começam pelos essenciais,
// depois pelo que a casa mais consome.
import * as store from './store.js';
import { inventoryRows, consumption } from './domain.js';
import { norm } from '../lib/util.js';

const FRUIT = /\b(banana|maca|laranja|limao|mamao|abacaxi|melancia|melao|uva|morango|manga|abacate|pera|kiwi|tangerina|mexerica|goiaba|maracuja|caqui|ameixa|pessego|coco)\b/;
const has = (rx) => (p) => rx.test(norm(p.name));
const sec = (...ids) => (p) => ids.includes(p.section);

export const GROUPS = [
  { id: 'mistura', name: 'Mistura', hint: 'carnes, frango, peixe, ovos', low: 'Estamos ficando sem mistura', out: 'Acabou a mistura', days: 3, match: (p) => sec('acougue')(p) || has(/\b(ovos?|atum|sardinha|hamburguer|nuggets|salsicha)\b/)(p) },
  { id: 'frutas', name: 'Frutas', hint: 'banana, maçã, laranja…', low: 'Estamos ficando sem frutas', out: 'Acabaram as frutas', days: 3, match: (p) => p.section === 'hortifruti' && FRUIT.test(norm(p.name)) },
  { id: 'verduras', name: 'Verduras e legumes', hint: 'alface, tomate, cenoura…', low: 'Estamos ficando sem verduras e legumes', out: 'Acabaram as verduras e legumes', days: 3, match: (p) => p.section === 'hortifruti' && !FRUIT.test(norm(p.name)) && !/\bovos?\b/.test(norm(p.name)) },
  { id: 'laticinios', name: 'Leite e laticínios', hint: 'leite, iogurte, queijo, manteiga', low: 'Estamos ficando sem laticínios', out: 'Acabaram os laticínios', days: 3, match: (p) => has(/\b(leite|iogurte|queijo|requeijao|manteiga|nata|cream cheese|ricota|bebida lactea|creme de leite)\b/)(p) && !has(/\b(condensado|coco|doce de leite|po)\b/)(p) },
  { id: 'cafe', name: 'Café da manhã', hint: 'café, pão, achocolatado, cereal', low: 'Estamos ficando sem coisas para o café da manhã', out: 'Acabou o café da manhã', days: 3, match: has(/\b(cafe|pao|achocolatado|cereal|granola|aveia|geleia|torrada|bisnaguinha)\b/) },
  { id: 'basicos', name: 'Básicos da despensa', hint: 'arroz, feijão, macarrão, óleo', low: 'Os básicos da despensa estão acabando', out: 'Acabaram os básicos da despensa', days: 5, match: has(/\b(arroz|feijao|macarrao|oleo|acucar|farinha)\b/) },
  { id: 'limpeza', name: 'Limpeza', hint: 'detergente, sabão, desinfetante', low: 'Estamos ficando sem produtos de limpeza', out: 'Acabaram os produtos de limpeza', days: 7, match: sec('limpeza', 'lavanderia') },
  { id: 'higiene', name: 'Higiene', hint: 'papel higiênico, sabonete, pasta', low: 'Estamos ficando sem itens de higiene', out: 'Acabaram os itens de higiene', days: 7, match: sec('higiene') },
  { id: 'bebidas', name: 'Bebidas', hint: 'água, suco, refrigerante', low: 'Estamos ficando sem bebidas', out: 'Acabaram as bebidas', days: 3, match: sec('bebidas') },
  { id: 'pet', name: 'Comida do pet', hint: 'ração, sachê, petisco', low: 'A comida do pet está acabando', out: 'Acabou a comida do pet', days: 5, match: sec('pet') },
  { id: 'bebe', name: 'Bebê', hint: 'fralda, lenço, fórmula', low: 'Os itens do bebê estão acabando', out: 'Acabaram os itens do bebê', days: 5, match: sec('bebe') },
];

const PREF = 'pref_groups';
export function config(S = store.snapshot()) {
  const p = S.byId.get(PREF);
  return { active: p?.active || [], days: p?.days || {} };
}
export async function setConfig(patch) {
  const cur = config();
  await store.save('pref', { ...cur, ...patch }, PREF);
}
export const groupById = (id) => GROUPS.find((g) => g.id === id);

// Nome curto para os avisos: "Leite Integral 1L" → "Leite Integral".
export const shortName = (n) => n.replace(/\s+\d+([.,]\d+)?\s*(kg|g|l|ml|un|m|cx)?\b.*$/i, '').trim() || n;

// Avalia um grupo. Devolve estado, mensagem, dias estimados, membros e sugestões de compra.
export function evaluate(S, g, rows = inventoryRows(S), cache = new Map()) {
  const cfg = config(S);
  const threshold = cfg.days[g.id] ?? g.days;
  const members = rows
    .filter((r) => g.match(r.p))
    .map((r) => {
      if (!cache.has(r.pid)) cache.set(r.pid, consumption(S, r.pid, 60));
      const c = cache.get(r.pid);
      return { ...r, rate: c.rate, days: c.rate > 0 ? r.qty / c.rate : null };
    });
  if (!members.length) return { g, state: 'empty', members, threshold, suggest: [] };
  const inStock = members.filter((m) => m.qty > 0);
  const withRate = members.filter((m) => m.rate > 0);
  const supplyDays = withRate.length ? withRate.reduce((a, m) => a + m.qty / m.rate, 0) : null;
  const essLow = members.filter((m) => m.essential && m.status !== 'ok');
  let state = 'ok';
  if (!inStock.length) state = 'out';
  else if (supplyDays != null ? supplyDays < threshold : inStock.length <= 1) state = 'low';
  if (state === 'ok' && essLow.length) state = 'low';

  // Título do aviso: o essencial pelo nome, se houver; senão, a frase do grupo.
  let message = '';
  let sub = '';
  const groupLow = state === 'out' || (supplyDays != null ? supplyDays < threshold : inStock.length <= 1);
  if (essLow.length) {
    const names = essLow.slice(0, 2).map((m) => shortName(m.name));
    const allOut = essLow.slice(0, 2).every((m) => m.qty <= 0);
    message = names.length === 1 ? `${names[0]} ${allOut ? 'acabou' : 'quase no fim'}` : `${names[0]} e ${names[1]} ${allOut ? 'acabaram' : 'quase no fim'}`;
    if (groupLow) sub = state === 'out' ? g.out : g.low;
  } else if (state === 'out') message = g.out;
  else if (state === 'low') message = g.low;

  const detail = supplyDays != null ? (state === 'out' ? 'nada em casa' : `dá para ~${Math.max(0, Math.round(supplyDays))} dia${Math.round(supplyDays) === 1 ? '' : 's'}`) : `${inStock.length} ite${inStock.length === 1 ? 'm' : 'ns'} em casa`;

  // Sugestões: essenciais acabando, depois outros essenciais, depois o que mais se consome e está baixo.
  const order = [
    ...essLow,
    ...members.filter((m) => m.essential && !essLow.includes(m)),
    ...members.filter((m) => !m.essential).sort((a, b) => b.rate - a.rate),
  ];
  const suggest = state === 'ok' ? [] : order.filter((m, i, arr) => arr.indexOf(m) === i && (m.qty <= 0 || m.status !== 'ok' || (m.days != null && m.days < threshold))).slice(0, 3);
  if (state !== 'ok' && !suggest.length) suggest.push(...order.slice(0, 2));
  return { g, state, message, sub, detail, supplyDays, threshold, members, essLow, suggest };
}

// Grupos ativos, os que precisam de atenção primeiro.
export function activeGroups(S = store.snapshot()) {
  const cfg = config(S);
  const rows = inventoryRows(S);
  const cache = new Map();
  const rank = { out: 0, low: 1, ok: 2, empty: 3 };
  return cfg.active
    .map((id) => groupById(id))
    .filter(Boolean)
    .map((g) => evaluate(S, g, rows, cache))
    .sort((a, b) => rank[a.state] - rank[b.state] || (b.essLow?.length || 0) - (a.essLow?.length || 0));
}
