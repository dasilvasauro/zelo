// Backup completo, importação e exportação de preços e estoque em CSV.
import * as store from './store.js';
import { inventoryRows, prodOf, storeName } from './domain.js';
import { today, nowMs } from '../lib/clock.js';
import { fmtDate } from '../lib/util.js';

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportBackup() {
  const records = store.allRecords().map((r) => (r.del ? { id: r.id, type: r.type, u: r.u, by: r.by, del: true } : { id: r.id, type: r.type, data: r.data, fv: r.fv, fb: r.fb, u: r.u, by: r.by, cb: r.cb, ca: r.ca }));
  download(`zelo-backup-${today()}.json`, JSON.stringify({ app: 'zelo', version: 1, exportedAt: new Date(nowMs()).toISOString(), records }), 'application/json');
}

export async function importBackup(file) {
  const doc = JSON.parse(await file.text());
  if (doc.app !== 'zelo' || !Array.isArray(doc.records)) throw new Error('Arquivo não é um backup do Zelo.');
  return store.importPlain(doc.records);
}

const csv = (rows) => '\ufeff' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
const num = (c) => (c / 100).toFixed(2).replace('.', ',');

export function exportPrices() {
  const S = store.snapshot();
  const rows = [['Data', 'Produto', 'Local', 'Quantidade', 'Unidade', 'Preço unitário', 'Total']];
  for (const p of S.price) {
    const pr = prodOf(p.pid);
    rows.push([fmtDate(p.d), pr.name, storeName(S, p.store), String(p.qty).replace('.', ','), p.unit || pr.unit, num(p.price), num(Math.round(p.price * p.qty))]);
  }
  download(`zelo-precos-${today()}.csv`, csv(rows), 'text/csv;charset=utf-8');
}

export function exportStock() {
  const S = store.snapshot();
  const rows = [['Produto', 'Quantidade', 'Unidade', 'Essencial', 'Mínimo', 'Local']];
  for (const r of inventoryRows(S)) rows.push([r.name, String(r.qty).replace('.', ','), r.unit, r.essential ? 'sim' : '', r.min ?? '', r.place]);
  download(`zelo-estoque-${today()}.csv`, csv(rows), 'text/csv;charset=utf-8');
}

export const storageEstimate = () => navigator.storage?.estimate?.().catch(() => null) ?? Promise.resolve(null);
