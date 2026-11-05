// Gráficos do Zelo, no mesmo desenho do Pago: linha com o gradiente índigo → menta, grade discreta,
// leitura ao tocar e arrastar.
import { esc, fmtDay, money, moneyShort, fmtNum } from '../lib/util.js';

// Gráfico pequeno para listas (string SVG). values: números; o último é o "agora".
export function sparkline(values, { w = 64, h = 22, cls = '', min: forceMin } = {}) {
  if (!values.length) return '';
  const max = Math.max(...values, 0.0001);
  const min = forceMin ?? Math.min(0, ...values);
  const X = (i) => (values.length === 1 ? w : (i / (values.length - 1)) * (w - 2) + 1);
  const Y = (v) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
  let d = '';
  values.forEach((v, i) => {
    // degraus: a quantidade em estoque muda aos saltos
    if (i === 0) d = `M${X(0).toFixed(1)},${Y(v).toFixed(1)}`;
    else d += ` H${X(i).toFixed(1)} V${Y(v).toFixed(1)}`;
  });
  const last = values[values.length - 1];
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/><circle cx="${X(values.length - 1).toFixed(1)}" cy="${Y(last).toFixed(1)}" r="2.2"/></svg>`;
}

// Linha em degraus da quantidade ao longo dos dias. points: [{d, v}]; minLine: linha do mínimo.
export function stockChart(host, { points, unit = '', minLine = null }) {
  host.innerHTML = '';
  if (points.length < 2) return;
  const W = Math.max(280, host.clientWidth || 600);
  const H = host.clientHeight || 170;
  const pad = { l: 6, r: 6, t: 14, b: 22 };
  let max = Math.max(...points.map((p) => p.v), minLine || 0, 1);
  max *= 1.15;
  const X = (i) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  let d = `M${X(0).toFixed(1)},${Y(points[0].v).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += ` H${X(i).toFixed(1)} V${Y(points[i].v).toFixed(1)}`;
  const area = `${d} V${H - pad.b} H${X(0)} Z`;
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const mid = Math.floor(points.length / 2);
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Quantidade em estoque por dia">
    <defs>
      <linearGradient id="${gid}l" x1="0" x2="1"><stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient>
      <linearGradient id="${gid}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--g2)" stop-opacity=".18"/><stop offset="1" stop-color="var(--g2)" stop-opacity="0"/></linearGradient>
    </defs>
    <line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}"/>
    ${minLine ? `<line class="minline" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(minLine).toFixed(1)}" y2="${Y(minLine).toFixed(1)}"/><text class="ylab warnlab" x="${W - pad.r}" y="${(Y(minLine) - 5).toFixed(1)}" text-anchor="end">mínimo ${fmtNum(minLine)}</text>` : ''}
    <path d="${area}" fill="url(#${gid}a)"/>
    <path d="${d}" class="line main" stroke="url(#${gid}l)"/>
    <text class="xlab" x="${pad.l}" y="${H - 6}">${fmtDay(points[0].d)}</text>
    <text class="xlab" x="${X(mid)}" y="${H - 6}" text-anchor="middle">${fmtDay(points[mid].d)}</text>
    <text class="xlab" x="${W - pad.r}" y="${H - 6}" text-anchor="end">hoje</text>
    <g class="cross" opacity="0"><line y1="${pad.t}" y2="${H - pad.b}"/><circle r="4" class="dot l-debt"/></g>
  </svg><div class="chart-read" hidden></div>`;
  readout(host, points.length, X, (i) => Y(points[i].v), (i) => `<b>${fmtDay(points[i].d)}</b><span>${fmtNum(points[i].v)} ${esc(unit)}</span>`, W);
}

// Histórico de preço: um ponto por compra, cor por loja, linha ligando a sequência.
// points: [{at, d, v, store}], stores: Map(id → {name, color})
export function priceChart(host, { points, stores }) {
  host.innerHTML = '';
  if (!points.length) return;
  const W = Math.max(280, host.clientWidth || 600);
  const H = host.clientHeight || 170;
  const pad = { l: 6, r: 10, t: 16, b: 22 };
  const vals = points.map((p) => p.v);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max === min) {
    max += Math.max(50, max * 0.1);
    min = Math.max(0, min - Math.max(50, min * 0.1));
  }
  const span = max - min;
  max += span * 0.15;
  min = Math.max(0, min - span * 0.15);
  const t0 = points[0].at;
  const t1 = points[points.length - 1].at;
  const X = (p) => (points.length === 1 ? W / 2 : pad.l + ((p.at - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r));
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  let d = '';
  points.forEach((p, i) => (d += `${i ? ' L' : 'M'}${X(p).toFixed(1)},${Y(p.v).toFixed(1)}`));
  const grid = [min, (min + max) / 2, max];
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Preço pago em cada compra">
    <defs><linearGradient id="${gid}l" x1="0" x2="1"><stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient></defs>
    ${grid.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ylab" x="${pad.l + 2}" y="${(Y(v) - 5).toFixed(1)}">${v < 10000 ? money(Math.round(v)) : moneyShort(Math.round(v))}</text>`).join('')}
    <path d="${d}" class="line thin" stroke="url(#${gid}l)"/>
    ${points.map((p) => `<circle class="pdot" cx="${X(p).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="4.5" style="--c:${stores.get(p.store)?.color || 'var(--muted)'}"/>`).join('')}
    <text class="xlab" x="${pad.l}" y="${H - 6}">${fmtDay(points[0].d)}</text>
    <text class="xlab" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${fmtDay(points[points.length - 1].d)}</text>
    <g class="cross" opacity="0"><line y1="${pad.t}" y2="${H - pad.b}"/><circle r="6" class="dot l-debt"/></g>
  </svg><div class="chart-read" hidden></div>`;
  readout(host, points.length, (i) => X(points[i]), (i) => Y(points[i].v), (i) => `<b>${fmtDay(points[i].d)}</b><span>${money(points[i].v)}</span><span class="muted">${esc(stores.get(points[i].store)?.name || 'Sem local')}</span>`, W);
}

function readout(host, n, X, Yi, html, W) {
  const svg = host.querySelector('svg');
  const cross = svg.querySelector('.cross');
  const read = host.querySelector('.chart-read');
  const xs = Array.from({ length: n }, (_, i) => X(i));
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    xs.forEach((px, i) => {
      const dx = Math.abs(px - x);
      if (dx < bd) {
        bd = dx;
        best = i;
      }
    });
    const px = xs[best];
    cross.setAttribute('opacity', '1');
    const ln = cross.querySelector('line');
    ln.setAttribute('x1', px);
    ln.setAttribute('x2', px);
    const c = cross.querySelector('circle');
    c.setAttribute('cx', px);
    c.setAttribute('cy', Yi(best));
    read.hidden = false;
    read.innerHTML = html(best);
    const left = (px / W) * r.width;
    read.style.left = Math.min(Math.max(0, left - read.offsetWidth / 2), r.width - read.offsetWidth) + 'px';
  };
  const leave = () => {
    cross.setAttribute('opacity', '0');
    read.hidden = true;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

// Barras simples (consumo por semana). bars: [{label, v}]
export function barsSvg(bars, { h = 60, fmt = fmtNum } = {}) {
  const max = Math.max(...bars.map((b) => b.v), 0.0001);
  const n = bars.length;
  return `<div class="bars" style="--n:${n}">${bars
    .map((b) => `<div class="bars-col" title="${esc(b.label)}: ${esc(fmt(b.v))}"><i style="height:${Math.max(b.v > 0 ? 6 : 2, (b.v / max) * h)}px"></i><span>${esc(b.label)}</span></div>`)
    .join('')}</div>`;
}
