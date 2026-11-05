// Preços: quanto cada produto custou, onde sai mais barato e como os locais se comparam.
import * as store from '../core/store.js';
import { priceStats, prodOf, storeName } from '../core/domain.js';
import { esc, money, fmtDay, fmtPct, norm, pctDiff } from '../lib/util.js';
import { icon } from '../ui/ui.js';
import { sparkline } from '../ui/chart.js';
import { openPrices } from './product.js';
import { app } from '../state.js';

export const title = 'Preços';
let q = '';
let sort = 'recentes';

export function render(el) {
  const S = store.snapshot();
  const pids = [...S.pricesByPid.keys()];
  let rows = pids
    .map((pid) => {
      const st = priceStats(S, pid);
      if (!st) return null;
      const p = prodOf(pid);
      const ch = st.list.length > 1 ? pctDiff(st.list[st.list.length - 2].price, st.last.price) : 0;
      return { pid, p, st, ch };
    })
    .filter(Boolean);
  if (q) rows = rows.filter((r) => norm(r.p.name).includes(norm(q)) || r.p.aliases.some((a) => norm(a).includes(norm(q))));
  const by = {
    recentes: (a, b) => b.st.last.at - a.st.last.at,
    subiu: (a, b) => b.ch - a.ch,
    caiu: (a, b) => a.ch - b.ch,
    az: (a, b) => a.p.name.localeCompare(b.p.name, 'pt-BR'),
  }[sort];
  rows.sort(by);

  // Ranking de locais: em quantos produtos (comprados em mais de um local) cada um foi o mais barato.
  const wins = new Map();
  let compared = 0;
  for (const pid of pids) {
    const st = priceStats(S, pid);
    if (!st || st.byStore.filter((s) => s.store).length < 2) continue;
    compared++;
    const best = st.byStore.filter((s) => s.store)[0];
    wins.set(best.store, (wins.get(best.store) || 0) + 1);
  }
  const ranking = [...wins.entries()].sort((a, b) => b[1] - a[1]);

  el.innerHTML = `
    ${ranking.length ? `<section class="panel store-wins">
      <div class="panel-head"><h3>Onde sai mais barato</h3></div>
      <ul class="store-rank">${ranking
        .map(([sid, n]) => `<li><span class="store-opt"><i style="--c:${S.byId.get(sid)?.color || 'var(--muted)'}"></i>${esc(storeName(S, sid) || 'Sem local')}</span><span class="muted">mais barato em</span><b>${n} de ${compared}</b></li>`)
        .join('')}</ul>
      <p class="form-meta">Conta só produtos comprados em mais de um local, pela média de preço em cada um.</p>
    </section>` : ''}

    <div class="inv-top">
      <div class="search-in">${icon('search')}<input type="search" placeholder="Buscar produto" value="${esc(q)}" data-q aria-label="Buscar produto"></div>
    </div>
    <div class="chips">${[['recentes', 'Recentes'], ['subiu', 'Subiram'], ['caiu', 'Caíram'], ['az', 'A–Z']].map(([v, l]) => `<button type="button" class="chip small${sort === v ? ' on' : ''}" data-sort="${v}">${l}</button>`).join('')}</div>

    ${rows.length ? `<ul class="rows price-rows">${rows
      .map(
        (r) => `<li><button type="button" class="row-btn" data-p="${r.pid}">
        <span class="row-main"><b>${esc(r.p.name)}</b><span>${money(r.st.last.price)} no ${esc(storeName(S, r.st.last.store) || 'sem local')}, ${fmtDay(r.st.last.d)} · menor ${money(r.st.min.price)}</span></span>
        ${r.st.list.length > 1 ? sparkline(r.st.list.slice(-10).map((x) => x.price), { w: 54, h: 20, cls: 'price', min: Math.min(...r.st.list.slice(-10).map((x) => x.price)) * 0.95 }) : ''}
        ${r.st.list.length > 1 && Math.abs(r.ch) >= 0.5 ? `<span class="tr ${r.ch > 0 ? 'up' : 'down'}">${icon(r.ch > 0 ? 'up' : 'dn')}${fmtPct(r.ch)}</span>` : '<span class="tr eq">=</span>'}
      </button></li>`,
      )
      .join('')}</ul>` : `<div class="empty-block">${icon('tag')}<p>${q ? 'Nenhum produto com esse nome no histórico.' : 'Os preços entram aqui quando você conclui uma compra com os preços preenchidos.'}</p></div>`}`;

  const qi = el.querySelector('[data-q]');
  qi.addEventListener('input', () => {
    q = qi.value;
    app.refresh();
    requestAnimationFrame(() => {
      const n = document.querySelector('#view [data-q]');
      n?.focus();
      n?.setSelectionRange(n.value.length, n.value.length);
    });
  });
  el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => ((sort = b.dataset.sort), app.refresh())));
  el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => openPrices(b.dataset.p)));
}
