// Repositório de registros do Zelo.
//
// A base é a mesma do Pago: cada entidade (item de lista, movimento de estoque, preço, loja...) é um
// registro independente, cifrado no aparelho, versionado por HLC e guardado no IndexedDB com uma fila
// de envio (outbox). A diferença está em como os conflitos são resolvidos:
//
// 1. Por CAMPO, não por registro. Cada campo guarda a própria versão (fv) e quem o gravou (fb).
//    Ao juntar duas versões do mesmo registro, cada campo fica com a versão mais nova daquele campo.
//    Se uma pessoa marca o item e a outra digita o preço ao mesmo tempo, as duas alterações ficam.
//    A junção é comutativa, associativa e idempotente: todos os aparelhos convergem para o mesmo estado,
//    em qualquer ordem de chegada, inclusive depois de horas offline.
// 2. Quando o MESMO campo foi alterado pelas duas pessoas, vence a versão mais nova, e quem perdeu recebe
//    um aviso com as duas opções para decidir (ver conflicts()). Nada é descartado em silêncio.
// 3. su = a última versão deste registro que o aparelho sabe estar no servidor. Ela vai no envio como
//    base, e o servidor só aceita a gravação se essa base for a versão atual dele (compare-and-swap).
//    Se alguém gravou antes, o envio é recusado, o aparelho baixa a versão nova, junta campo a campo e
//    envia de novo. Assim nenhuma gravação atrasada apaga outra.
//
// Exclusões viram tombstones até todas as réplicas as verem (igual ao Pago).
import { seal, unseal } from '../lib/crypto.js';
import { tick, observe, hlcMs } from '../lib/hlc.js';
import { uid } from '../lib/util.js';
import { nowMs } from '../lib/clock.js';

let db = null;
let key = null;
let me = 'local';
const recs = new Map();
let version = 0;
const subs = new Set();
let queued = false;
let kick = () => {};
let snap = null;
let snapV = -1;

// Campos em que vale avisar quando a alteração de uma pessoa foi sobreposta pela de outra.
const WATCH = {
  item: { price: 'preço', total: 'total da etiqueta', qty: 'quantidade', name: 'nome', note: 'observação', unit: 'unidade' },
  list: { name: 'nome da lista', store: 'local da compra', payments: 'formas de pagamento' },
  inv: { min: 'quantidade mínima', essential: 'essencial', place: 'local' },
  unit: { place: 'onde está guardado' },
};
const CONFLICT_WINDOW = 60 * 60000;
let pending = []; // conflitos aguardando decisão
const csubs = new Set();

const aad = (r) => `${r.id}|${r.u}|${r.del ? 1 : 0}`;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function notify() {
  version++;
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    subs.forEach((f) => f());
  });
}

export const subscribe = (f) => (subs.add(f), () => subs.delete(f));
export const setKick = (f) => (kick = f);
export const setMe = (u) => (me = u);
export const getMe = () => me;
export const getVersion = () => version;
export const getDB = () => db;

export async function initStore(_db, _key) {
  db = _db;
  key = _key;
  recs.clear();
  const rows = await db.all('records');
  const bad = [];
  await Promise.all(
    rows.map(async (row) => {
      try {
        const p = await unseal(key, row.iv, row.ct, aad(row));
        recs.set(row.id, { id: row.id, u: row.u, by: row.by, su: row.su || null, del: !!row.del, ...p });
        observe(row.u);
      } catch {
        bad.push(row.id);
      }
    }),
  );
  if (bad.length) {
    await db.removeRecords(bad);
    await db.put('meta', 0, 'cursor');
  }
  notify();
  return { count: rows.length, rejected: bad.length };
}

async function sealRow(rec) {
  const payload = rec.del ? { type: rec.type } : { type: rec.type, data: rec.data, fv: rec.fv, fb: rec.fb, fp: rec.fp, cb: rec.cb, ca: rec.ca };
  const { iv, ct } = await seal(key, payload, aad(rec));
  return { id: rec.id, u: rec.u, by: rec.by, su: rec.su || null, del: rec.del ? 1 : 0, iv, ct };
}

async function persist(rec, outbox = true) {
  const row = await sealRow(rec);
  await db.write([row], outbox ? [rec.id] : []);
  return row;
}

// Monta a nova versão de um registro, versionando só os campos que mudaram.
function build(type, data, id, prev) {
  const u = tick();
  const live = prev && !prev.del ? prev : null;
  const clean = {};
  for (const [k, v] of Object.entries(data)) if (k !== 'id' && !k.startsWith('_') && v !== undefined) clean[k] = v;
  const fv = { ...(live?.fv || {}) };
  const fb = { ...(live?.fb || {}) };
  const fp = { ...(live?.fp || {}) };
  const old = live?.data || {};
  for (const k of new Set([...Object.keys(old), ...Object.keys(clean)])) {
    if (!same(old[k], clean[k]) || !fv[k]) {
      fp[k] = fv[k] || ''; // versão que esta gravação substituiu (quem eu vi antes de mudar)
      fv[k] = u;
      fb[k] = me;
    }
  }
  return {
    id,
    type,
    data: clean,
    fv,
    fb,
    fp,
    u,
    by: me,
    su: prev?.su || null,
    cb: live ? live.cb : me,
    ca: live ? live.ca : nowMs(),
    del: false,
  };
}

// Grava o registro inteiro (os campos ausentes deixam de existir).
export async function save(type, data, id) {
  id = id || uid();
  const rec = build(type, data, id, recs.get(id));
  await persist(rec);
  recs.set(id, rec);
  notify();
  kick();
  return id;
}

// Altera só alguns campos de um registro existente.
export async function patch(id, fields) {
  const prev = recs.get(id);
  if (!prev || prev.del) return null;
  return save(prev.type, { ...prev.data, ...fields }, id);
}

// Grava vários registros de uma vez (uma transação no IndexedDB). items: [{type, data, id}]
export async function saveMany(items) {
  const out = [];
  const rows = [];
  for (const it of items) {
    const id = it.id || uid();
    const rec = build(it.type, it.data, id, recs.get(id));
    if (it.ca) rec.ca = it.ca;
    recs.set(id, rec);
    out.push(id);
    rows.push(sealRow(rec));
  }
  const sealed = await Promise.all(rows);
  for (let i = 0; i < sealed.length; i += 500) await db.write(sealed.slice(i, i + 500), sealed.slice(i, i + 500).map((r) => r.id));
  notify();
  kick();
  return out;
}

export async function remove(id) {
  const prev = recs.get(id);
  if (!prev || prev.del) return;
  const rec = { id, type: prev.type, u: tick(), by: me, su: prev.su || null, del: true };
  await persist(rec);
  recs.set(id, rec);
  notify();
  kick();
}

export async function removeMany(ids) {
  const rows = [];
  for (const id of ids) {
    const prev = recs.get(id);
    if (!prev || prev.del) continue;
    const rec = { id, type: prev.type, u: tick(), by: me, su: prev.su || null, del: true };
    recs.set(id, rec);
    rows.push(await sealRow(rec));
  }
  if (!rows.length) return;
  await db.write(rows, rows.map((r) => r.id));
  notify();
  kick();
}

/* ---------- Junção campo a campo ---------- */
// a = versão local, b = versão que chegou. Devolve o resultado e de onde veio cada parte.
function mergeLive(a, b) {
  const data = {};
  const fv = {};
  const fb = {};
  const fp = {};
  let fromA = false;
  let fromB = false;
  const lost = [];
  const keys = new Set([...Object.keys(a.fv || {}), ...Object.keys(b.fv || {}), ...Object.keys(a.data || {}), ...Object.keys(b.data || {})]);
  for (const k of keys) {
    const va = a.fv?.[k] || '';
    const vb = b.fv?.[k] || '';
    const useB = vb > va;
    const src = useB ? b : a;
    if (src.data && k in src.data) data[k] = src.data[k];
    if (src.fv?.[k]) fv[k] = src.fv[k];
    if (src.fb?.[k]) fb[k] = src.fb[k];
    if (src.fp?.[k] != null) fp[k] = src.fp[k];
    if (same(a.data?.[k], b.data?.[k])) continue;
    if (useB) {
      fromB = true;
      lost.push(k);
    } else if (va > vb) fromA = true;
  }
  return { data, fv, fb, fp, fromA, fromB, lost };
}

function noteConflicts(local, remote, lost) {
  const watch = WATCH[local.type];
  if (!watch) return;
  const now = nowMs();
  for (const k of lost) {
    if (!watch[k]) continue;
    if (local.fb?.[k] !== me || remote.fb?.[k] === me) continue;
    // Só é conflito se a outra pessoa NÃO viu o meu valor antes de mudar (gravações concorrentes).
    // Se ela partiu do meu valor (fp = minha versão), foi uma alteração consciente, não um conflito.
    if ((remote.fp?.[k] ?? '') === (local.fv?.[k] ?? '')) continue;
    if (now - hlcMs(local.fv?.[k]) > CONFLICT_WINDOW) continue;
    pending = pending.filter((c) => !(c.id === local.id && c.field === k));
    pending.push({ cid: uid(8), id: local.id, type: local.type, field: k, label: watch[k], mine: local.data?.[k], theirs: remote.data?.[k], by: remote.fb?.[k], at: now });
  }
  if (pending.length) csubs.forEach((f) => f(pending));
}

// Aplica uma versão que chegou de outro aparelho (já decifrada).
// serverU: versão que está no servidor (para a base do próximo envio), ou null se não veio do servidor.
async function mergeIn(r, serverU) {
  const cur = recs.get(r.id);
  observe(r.u);
  const incoming = r.del
    ? { id: r.id, type: r.type, u: r.u, by: r.by, su: serverU ?? cur?.su ?? null, del: true }
    : { id: r.id, type: r.type, data: r.data || {}, fv: r.fv || {}, fb: r.fb || {}, fp: r.fp || {}, u: r.u, by: r.by, cb: r.cb, ca: r.ca, su: serverU ?? cur?.su ?? null, del: false };

  if (!cur) return { rec: incoming, outbox: false };
  if (cur.u === r.u) return serverU && cur.su !== serverU ? { rec: { ...cur, su: serverU }, outbox: false, quiet: true } : null;

  // Exclusões: vence a mais nova entre a exclusão e a última edição.
  if (cur.del || incoming.del) {
    if (incoming.u > cur.u) return { rec: incoming, outbox: false };
    return { rec: { ...cur, su: incoming.su }, outbox: true, quiet: true };
  }

  const m = mergeLive(cur, incoming);
  // Conteúdo igual: adota a versão do servidor.
  if (!m.fromA && !m.fromB) return { rec: incoming, outbox: false, quiet: true };
  // Só o local tem novidades: mantém e reenvia (com versão maior que a do servidor).
  if (!m.fromB) return { rec: { ...cur, u: cur.u > incoming.u ? cur.u : tick(), su: incoming.su }, outbox: true, quiet: true };
  noteConflicts(cur, incoming, m.lost);
  if (!m.fromA) return { rec: incoming, outbox: false };
  return {
    rec: { ...cur, data: m.data, fv: m.fv, fb: m.fb, fp: m.fp, u: tick(), by: me, su: incoming.su, cb: cur.cb || incoming.cb, ca: Math.min(cur.ca || Infinity, incoming.ca || Infinity) },
    outbox: true,
  };
}

async function commitMerged(results) {
  const rows = [];
  const outIds = [];
  const dropIds = [];
  let changed = false;
  for (const res of results) {
    if (!res) continue;
    recs.set(res.rec.id, res.rec);
    rows.push(await sealRow(res.rec));
    if (res.outbox) {
      if (!res.keep) outIds.push(res.rec.id);
    } else dropIds.push(res.rec.id);
    if (!res.quiet) changed = true;
  }
  if (!rows.length) return 0;
  await db.write(rows, outIds, dropIds);
  if (changed) notify();
  if (outIds.length) kick();
  return rows.length;
}

// Linhas cifradas vindas do servidor: { id, u, by, del, iv, ct }.
export async function applyRemoteMany(rows) {
  const results = [];
  for (const row of rows) {
    try {
      const p = await unseal(key, row.iv, row.ct, `${row.id}|${row.u}|${row.del ? 1 : 0}`);
      results.push(await mergeIn({ id: row.id, u: row.u, by: row.by, del: !!row.del, ...p }, row.u));
    } catch {
      /* cifrado com outra chave ou adulterado: ignora */
    }
  }
  return commitMerged(results);
}

// Versões já decifradas (modo demo simulando outra pessoa, ou backup).
export async function applyPlainMany(list) {
  const results = [];
  for (const r of list) results.push(await mergeIn(r, null));
  return commitMerged(results);
}

// O servidor confirmou a versão u deste registro.
export async function markServer(id, u) {
  const cur = recs.get(id);
  if (!cur || cur.u !== u) return false;
  if (cur.su === u) return true;
  cur.su = u;
  const row = await db.get('records', id);
  if (row && row.u === u) {
    row.su = u;
    await db.write([row], [], [id]);
  }
  return true;
}

// Cria uma versão "do outro aparelho" (usado pelo modo demo para simular a outra pessoa).
// concurrent: a outra pessoa NÃO tinha visto o valor atual (simula gravações ao mesmo tempo).
export function foreignVersion(id, fields, by, { concurrent = false } = {}) {
  const cur = recs.get(id);
  if (!cur || cur.del) return null;
  const u = tick();
  const fv = { ...cur.fv };
  const fb = { ...cur.fb };
  const fp = { ...(cur.fp || {}) };
  for (const k of Object.keys(fields)) {
    fp[k] = concurrent ? (cur.fp?.[k] ?? '') : fv[k] || '';
    fv[k] = u;
    fb[k] = by;
  }
  return { id, type: cur.type, data: { ...cur.data, ...fields }, fv, fb, fp, u, by, cb: cur.cb, ca: cur.ca, del: false };
}
export function foreignNew(type, data, by, id = uid()) {
  const u = tick();
  const fv = {};
  const fb = {};
  for (const k of Object.keys(data)) {
    fv[k] = u;
    fb[k] = by;
  }
  return { id, type, data, fv, fb, u, by, cb: by, ca: nowMs(), del: false };
}

/* ---------- Conflitos do mesmo campo ---------- */
export const conflicts = () => pending;
export const onConflicts = (f) => (csubs.add(f), () => csubs.delete(f));
export async function resolveConflict(cid, keepMine) {
  const c = pending.find((x) => x.cid === cid);
  pending = pending.filter((x) => x.cid !== cid);
  csubs.forEach((f) => f(pending));
  if (c && keepMine) await patch(c.id, { [c.field]: c.mine });
}
export function dismissConflictsFor(id) {
  const before = pending.length;
  pending = pending.filter((x) => x.id !== id);
  if (pending.length !== before) csubs.forEach((f) => f(pending));
}

/* ---------- Manutenção (igual ao Pago) ---------- */
export async function importPlain(list) {
  const fixed = list.map((r) => (r.del ? r : { ...r, fv: r.fv || Object.fromEntries(Object.keys(r.data || {}).map((k) => [k, r.u])), fb: r.fb || {} }));
  return applyPlainMany(fixed);
}

export async function claimLocal(newMe) {
  me = newMe;
  for (const rec of [...recs.values()]) {
    if (rec.type === 'member' && rec.id === 'm_local') continue;
    const next = { ...rec, u: tick(), by: newMe, su: null };
    if (!rec.del) {
      if (rec.cb === 'local') next.cb = newMe;
      next.fb = Object.fromEntries(Object.entries(rec.fb || {}).map(([k, v]) => [k, v === 'local' ? newMe : v]));
    }
    await persist(next);
    recs.set(rec.id, next);
  }
  notify();
  kick();
}

export async function gcLocal(horizonMs) {
  const out = new Set(await db.keys('outbox'));
  const drop = [];
  for (const r of recs.values()) if (r.del && hlcMs(r.u) < horizonMs && !out.has(r.id)) drop.push(r.id);
  if (!drop.length) return 0;
  await db.removeRecords(drop);
  drop.forEach((id) => recs.delete(id));
  return drop.length;
}

export async function dropMissing(serverIds) {
  const out = new Set(await db.keys('outbox'));
  const drop = [...recs.keys()].filter((id) => !serverIds.has(id) && !out.has(id));
  if (!drop.length) return 0;
  await db.removeRecords(drop);
  drop.forEach((id) => recs.delete(id));
  notify();
  return drop.length;
}

export const raw = (id) => recs.get(id) || null;
export const get = (id) => {
  const r = recs.get(id);
  return r && !r.del ? view(r) : null;
};
export const allRecords = () => [...recs.values()];
export const stats = () => {
  let live = 0;
  let tomb = 0;
  for (const r of recs.values()) r.del ? tomb++ : live++;
  return { live, tomb };
};

const view = (r) => ({ id: r.id, ...r.data, _by: r.by, _cb: r.cb, _ca: r.ca, _u: r.u, _fb: r.fb || {}, _fv: r.fv || {} });

const TYPES = ['member', 'store', 'prod', 'inv', 'mov', 'list', 'item', 'price', 'pref', 'unit'];

// Fotografia imutável do estado, com índices prontos, reconstruída só quando algo muda.
export function snapshot() {
  if (snapV === version && snap) return snap;
  const S = Object.fromEntries(TYPES.map((t) => [t, []]));
  const byId = new Map();
  for (const r of recs.values()) {
    if (r.del || !S[r.type]) continue;
    const v = view(r);
    S[r.type].push(v);
    byId.set(v.id, v);
  }
  const group = (arr, k) => {
    const m = new Map();
    for (const x of arr) {
      const g = x[k];
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(x);
    }
    return m;
  };
  S.mov.sort((a, b) => (a.at || 0) - (b.at || 0));
  S.price.sort((a, b) => (a.at || 0) - (b.at || 0));
  S.list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  S.store.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  S.byId = byId;
  S.itemsByList = group(S.item, 'listId');
  S.movsByPid = group(S.mov, 'pid');
  S.pricesByPid = group(S.price, 'pid');
  S.unitsByPid = group(S.unit, 'pid');
  S.invByPid = new Map(S.inv.map((x) => [x.pid, x]));
  S.prodById = new Map(S.prod.map((x) => [x.id, x]));
  snap = Object.freeze(S);
  snapV = version;
  return snap;
}
