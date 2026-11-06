// Detalhes de um produto: histórico de preço e estoque.
import * as store from '../core/store.js';
import { priceStats, invSeries, invQty, consumption, invStatus, prodOf, addMove, ensureInv, storeName, addToList, newList } from '../core/domain.js';
import { sectionName } from '../core/catalog.js';
import { esc, money, fmtDay, fmtNum, fmtQty, unitLabel, relDay, isoOf } from '../lib/util.js';
import { today, nowMs } from '../lib/clock.js';
import { icon, sheet, toast, confirmDialog } from '../ui/ui.js';
import { priceChart, stockChart, barsSvg } from '../ui/chart.js';
import { askQty } from '../ui/numpad.js';
import { app, who } from '../state.js';
import { unitsOf, byPlace, PLACES, defaultPlace } from '../core/units.js';
import { markersHtml, bindMarkers } from '../ui/markers.js';
import { popover } from '../ui/pickers.js';
import { tapUnit, dropUnits } from './unitactions.js';
import { haptic } from '../ui/haptics.js';

const INT_UNITS = new Set(['un', 'pct', 'cx', 'dz', 'lata', 'fr', 'rolo', 'saco', 'gal', 'par', 'kit']);
export const isInt = (u) => INT_UNITS.has(u);

/* ---------- Bloco de preços (usado em vários lugares) ---------- */
export function priceBlock(S, pid) {
  const st = priceStats(S, pid);
  if (!st) return `<p class="empty">Ainda sem preços registrados. Eles entram aqui quando uma compra é concluída.</p>`;
  const unit = unitLabel(prodOf(pid).unit);
  return `<div class="kpis strip">
      <div><span>Última</span><b>${money(st.last.price)}</b><small>${esc(storeName(S, st.last.store) || '—')}</small></div>
      <div><span>Menor</span><b class="pos">${money(st.min.price)}</b><small>${esc(storeName(S, st.min.store) || '—')}</small></div>
      <div><span>Média</span><b>${money(st.avg)}</b><small>${st.list.length} compra${st.list.length > 1 ? 's' : ''}</small></div>
    </div>
    <div class="chart small" data-pchart></div>
    ${st.byStore.length > 1 || st.byStore[0]?.store ? `<h4 class="sub">Por local <small class="muted">&nbsp;preço por ${esc(unit)}</small></h4>
    <ul class="store-rank">${st.byStore
      .map(
        (s, i) => `<li><span class="store-opt"><i style="--c:${S.byId.get(s.store)?.color || 'var(--muted)'}"></i>${esc(storeName(S, s.store) || 'Sem local')}</span>
        <span class="muted">${s.n}×, menor ${money(s.min)}</span><b class="${i === 0 && st.byStore.length > 1 ? 'pos' : ''}">${money(s.avg)}</b></li>`,
      )
      .join('')}</ul>` : ''}`;
}

export function mountPriceChart(root, S, pid) {
  const host = root.querySelector('[data-pchart]');
  const st = priceStats(S, pid);
  if (!host || !st) return;
  const stores = new Map(S.store.map((s) => [s.id, s]));
  requestAnimationFrame(() => priceChart(host, { points: st.list.map((x) => ({ at: x.at, d: x.d, v: x.price, store: x.store })), stores }));
}

export function openPrices(pid) {
  const S = store.snapshot();
  const p = prodOf(pid);
  const st = priceStats(S, pid);
  sheet({
    title: p.name,
    wide: true,
    body: `<div class="detail">
      <p class="sheet-text">${esc(sectionName(p.section))} · preço por ${esc(unitLabel(p.unit))}</p>
      ${priceBlock(S, pid)}
      ${st ? `<h4 class="sub">Compras</h4><ul class="parts">${st.list
        .slice()
        .reverse()
        .slice(0, 30)
        .map((x) => `<li><span>${fmtDay(x.d)}<small>${esc(storeName(S, x.store) || 'sem local')}</small></span><span>${fmtNum(x.qty)} ${esc(unitLabel(x.unit || p.unit))} · <b>${money(x.price)}</b></span></li>`)
        .join('')}</ul>` : ''}
      <div class="sheet-actions"><button type="button" class="btn ghost" data-stock>${icon('box')}Ver estoque</button><button type="button" class="btn" data-add>${icon('cart')}Pôr na lista</button></div>
    </div>`,
    onMount(el, close) {
      mountPriceChart(el, S, pid);
      el.querySelector('[data-stock]').onclick = () => {
        close();
        setTimeout(() => openStock(pid), 240);
      };
      el.querySelector('[data-add]').onclick = async () => {
        await quickAddToList(pid);
        close();
      };
    },
  });
}

// Põe o produto na lista aberta mais recente (ou cria uma).
export async function quickAddToList(pid, qty = 1) {
  const S = store.snapshot();
  let list = S.list.find((l) => l.status !== 'done' && (l.domain === prodOf(pid).domain || !l.domain)) || S.list.find((l) => l.status !== 'done');
  let id = list?.id;
  if (!id) id = await newList(S, { domain: prodOf(pid).domain });
  await addToList(store.snapshot(), id, { pid, qty });
  haptic('add');
  toast(`${prodOf(pid).name} na lista ${store.get(id)?.name || ''}`, { action: 'Abrir', onAction: () => app.nav(`lista-${id}`) });
}

/* ---------- Estoque de um produto ---------- */
const KIND = { compra: 'Compra', uso: 'Uso', perda: 'Perda', ajuste: 'Contagem' };

export function openStock(pid) {
  let unsub = null;
  sheet({
    title: prodOf(pid, store.get(`i_${pid}`)).name,
    wide: true,
    body: `<div class="detail" data-body></div>`,
    onMount(el, close) {
      const draw = () => {
        const S = store.snapshot();
        const inv = S.invByPid.get(pid) || null;
        const p = prodOf(pid, inv);
        const unit = inv?.unit || p.unit;
        const qty = invQty(S, pid);
        const status = invStatus(inv, qty);
        const c = consumption(S, pid, 60);
        const movs = (S.movsByPid.get(pid) || []).slice().reverse();
        const weeks = weekly(S, pid);
        el.querySelector('[data-body]').innerHTML = `
          <div class="stock-top">
            <div><span class="label">Em casa</span><b class="stock-big">${fmtNum(qty)} <small>${esc(unitLabel(unit))}</small></b>
              <span class="pill ${status === 'ok' ? 'ok' : 'late'}">${status === 'out' ? 'Acabou' : status === 'low' ? 'Acabando' : 'Em dia'}</span>
              ${c.daysLeft != null && qty > 0 ? `<span class="pill">dura ~${Math.max(1, Math.round(c.daysLeft))} dia${Math.round(c.daysLeft) > 1 ? 's' : ''}</span>` : ''}</div>
            <button type="button" class="ess-toggle${inv?.essential ? ' on' : ''}" data-ess aria-pressed="${!!inv?.essential}">${icon('star')}<span>${inv?.essential ? 'Essencial' : 'Marcar essencial'}</span></button>
          </div>
          <div class="stock-acts">
            <button type="button" class="btn big" data-use>${icon('minus')}Usei</button>
            <button type="button" class="btn big" data-count>${icon('edit')}Contei</button>
            <button type="button" class="btn big" data-buyin>${icon('plus')}Entrou</button>
            <button type="button" class="btn big" data-list>${icon('cart')}Na lista</button>
          </div>
          ${whereHtml(S, pid, unit)}
          <div class="chart small" data-schart></div>
          <div class="kpis strip">
            <div><span>Uso por dia</span><b>${c.rate > 0 ? fmtNum(c.rate, 2) : '—'}</b><small>${esc(unitLabel(unit))}${c.useRate === 0 && c.buyRate > 0 ? ', pelo ritmo de compra' : ''}</small></div>
            <div><span>Compra a cada</span><b>${c.every ? `${c.every} dias` : '—'}</b><small>${c.buys} compra${c.buys === 1 ? '' : 's'} em 60 dias</small></div>
            <div><span>Mínimo</span><b>${inv?.min != null ? fmtNum(inv.min) : '—'}</b><small>${inv?.essential ? 'avisa abaixo disso' : 'opcional'}</small></div>
          </div>
          ${weeks.some((w) => w.v > 0) ? `<h4 class="sub">Saídas por semana</h4>${barsSvg(weeks, { h: 54 })}` : ''}
          <div class="grid2 stock-cfg">
            <button type="button" class="tile" data-min><span>Quantidade mínima</span><b>${inv?.min != null ? fmtQty(inv.min, unit) : 'Definir'}</b></button>
            <label class="field"><span>Guardar os novos em</span><select data-place>${PLACES.map((x) => `<option${x === defaultPlace(pid, inv) ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
            <label class="field"><span>Ao abrir, guardar em</span><select data-openplace><option value="">No mesmo lugar</option>${PLACES.map((x) => `<option${x === inv?.openPlace ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
          </div>
          <h4 class="sub">Preços</h4>
          ${priceBlock(S, pid)}
          <h4 class="sub">Movimentos</h4>
          ${movs.length ? `<ul class="parts">${movs
            .slice(0, 40)
            .map((m) => `<li><span>${KIND[m.kind] || m.kind}<small>${fmtDay(m.d)} · ${esc(who(S, m._cb).name)}${m.note ? ` · ${esc(m.note)}` : ''}</small></span><b class="${m.kind === 'compra' ? 'pos' : m.kind === 'ajuste' ? '' : 'neg'}">${m.kind === 'ajuste' ? `= ${fmtNum(m.abs)}` : `${m.delta > 0 ? '+' : '−'}${fmtNum(Math.abs(m.delta))}`}</b></li>`)
            .join('')}</ul>` : `<p class="empty">Sem movimentos ainda.</p>`}
          <div class="sheet-actions"><button type="button" class="btn ghost danger-text" data-archive>${icon('archive')}Tirar do estoque</button><span></span></div>`;

        const series = invSeries(S, pid, 60);
        requestAnimationFrame(() => {
          const h = el.querySelector('[data-schart]');
          if (h) stockChart(h, { points: series, unit: unitLabel(unit), minLine: inv?.min || null });
        });
        mountPriceChart(el, S, pid);

        const $ = (s) => el.querySelector(s);
        $('[data-ess]').onclick = async () => {
          await ensureInv(pid, { essential: !inv?.essential });
          if (!inv?.essential && inv?.min == null) toast('Defina a quantidade mínima para o Zelo avisar quando estiver acabando.');
        };
        $('[data-use]').onclick = async () => {
          const n = await askQty('Quanto você usou?', isInt(unit) ? 1 : 0.5, unit, { ok: 'Registrar uso' });
          if (n) await addMove(pid, 'uso', n);
        };
        $('[data-count]').onclick = async () => {
          const n = await askQty('Quanto tem em casa agora?', qty, unit, { ok: 'Salvar contagem', sub: 'A contagem substitui a quantidade calculada.' });
          if (n != null) await addMove(pid, 'ajuste', n);
        };
        $('[data-buyin]').onclick = async () => {
          const n = await askQty('Quanto entrou?', 1, unit, { ok: 'Adicionar', sub: 'Para compras fora de uma lista do Zelo ou presentes.' });
          if (n) await addMove(pid, 'compra', n, 'fora da lista');
        };
        $('[data-list]').onclick = () => quickAddToList(pid);
        $('[data-min]').onclick = async () => {
          const n = await askQty('Quantidade mínima', inv?.min ?? 1, unit, { ok: 'Salvar', sub: 'Abaixo disso, o item aparece como acabando.' });
          if (n != null) await ensureInv(pid, { min: n });
        };
        $('[data-place]').onchange = (e) => ensureInv(pid, { place: e.target.value });
        $('[data-openplace]').onchange = (e) => ensureInv(pid, { openPlace: e.target.value || null });
        el.querySelectorAll('[data-move]').forEach((btn) =>
          btn.addEventListener('click', () => {
            const from = btn.dataset.move;
            popover(
              btn,
              (body, closePop) => {
                body.innerHTML = `<div class="pick-list">${PLACES.filter((x) => x !== from).map((x) => `<button type="button" class="pick-opt" data-to="${esc(x)}"><span>${esc(x)}</span></button>`).join('')}</div>`;
                body.querySelectorAll('[data-to]').forEach((b) =>
                  b.addEventListener('click', async () => {
                    closePop(false);
                    const units = unitsOf(store.snapshot(), pid).filter((u) => u.place === from);
                    await dropUnits(units, b.dataset.to);
                  }),
                );
              },
              { title: `Mover de ${from} para`, cls: 'pop-list' },
            );
          }),
        );
        $('[data-archive]').onclick = async () => {
          if (!(await confirmDialog('Tirar este item do estoque? O histórico de preços continua.', { ok: 'Tirar' }))) return;
          await ensureInv(pid, { archived: true });
          close();
        };
      };
      draw();
      const unbind = bindMarkers(el.querySelector('[data-body]'), { resolve: (id) => unitsOf(store.snapshot(), id), places: PLACES, onTap: tapUnit, onDrop: dropUnits });
      unsub = store.subscribe(() => el.isConnected && !app.dragging && draw());
      const prev = unsub;
      unsub = () => {
        prev();
        unbind();
      };
    },
    onClose: () => unsub?.(),
  });
}

// "Onde está": as embalagens de cada lugar, com o que está aberto e um atalho para mover.
function whereHtml(S, pid, unit) {
  const units = unitsOf(S, pid);
  if (!units.length) return '';
  const name = prodOf(pid, S.invByPid.get(pid)).name;
  return `<h4 class="sub">Onde está <small class="muted">&nbsp;toque para abrir ou usar · segure para mover</small></h4>
    <div class="where" data-name="${esc(name)}">${[...byPlace(units)]
      .map(([place, us]) => {
        const open = us.filter((u) => u.state === 'open');
        const since = open.length ? Math.max(0, Math.floor((nowMs() - Math.min(...open.map((u) => u.openedAt || nowMs()))) / 86400000)) : null;
        return `<div class="where-grp" data-drop-place="${esc(place)}">
          <div class="where-head"><b>${esc(place)}</b>
            <span class="muted">${open.length ? `${open.length} aberto${open.length > 1 ? 's' : ''}${since != null ? (since ? ` há ${since} dia${since > 1 ? 's' : ''}` : ' hoje') : ''}` : ''}${open.length && us.length - open.length ? ' · ' : ''}${us.length - open.length ? `${us.length - open.length} fechado${us.length - open.length > 1 ? 's' : ''}` : ''}</span>
            <button type="button" class="btn small ghost where-move" data-move="${esc(place)}" aria-label="Mover tudo de ${esc(place)} para outro lugar">Mover</button>
          </div>
          ${markersHtml(us, { unit })}
        </div>`;
      })
      .join('')}</div>`;
}

// Saídas por semana nas últimas 8 semanas.
function weekly(S, pid) {
  const movs = S.movsByPid.get(pid) || [];
  const now = nowMs();
  const out = [];
  for (let w = 7; w >= 0; w--) {
    const end = now - w * 7 * 86400000;
    const start = end - 7 * 86400000;
    let v = 0;
    let q = 0;
    for (const m of movs) {
      const before = q;
      if (m.kind === 'ajuste') q = Number(m.abs) || 0;
      else q = Math.max(0, q + (Number(m.delta) || 0));
      if (m.at < start || m.at >= end) continue;
      if (m.kind === 'uso' || m.kind === 'perda') v += -(Number(m.delta) || 0);
      else if (m.kind === 'ajuste' && q < before) v += before - q;
    }
    out.push({ label: fmtDay(isoOf(new Date(start))).split(' ')[0], v: Math.round(v * 100) / 100 });
  }
  return out;
}
