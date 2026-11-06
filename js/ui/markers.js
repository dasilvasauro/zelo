// Marcadores de embalagem (fechada / aberta) e arrastar para outro lugar.
//
// Toque: fechada → aberta; aberta → usada (sai do estoque, com Desfazer).
// Segurar (0,35 s) e arrastar: leva a unidade, ou o grupo inteiro se começar pelo nome do item,
// para outro lugar. Um painel com todos os lugares aparece embaixo, no alcance do polegar;
// os cabeçalhos dos lugares na tela também aceitam a soltura.
import { esc, fmtNum, unitLabel } from '../lib/util.js';
import { haptic } from './haptics.js';
import { app } from '../state.js';

const BOX_CLOSED = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="8" width="15" height="12" rx="2.2"/><path d="M4 8h16M12 8v5"/></svg>';
const BOX_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 10.5h15V18a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z"/><path d="M4.5 10.5 7 5.5h7.5" /><path d="m14.5 5.5 5 5"/></svg>';

export const markerIcon = (state) => (state === 'open' ? BOX_OPEN : BOX_CLOSED);

export function markerLabel(u, unit) {
  const amt = unitLabel(unit) === 'un' ? '' : ` (${fmtNum(u.amount)} ${unitLabel(unit)})`;
  return u.state === 'open' ? `Aberto${amt}. Toque quando acabar; segure para mover` : `Fechado${amt}. Toque para abrir; segure para mover`;
}

export function markersHtml(units, { unit = 'un', max = 12 } = {}) {
  if (!units.length) return '';
  const show = units.slice(0, max);
  const weight = unitLabel(unit) !== 'un' && !['pct', 'cx', 'lata', 'fr', 'rolo', 'saco', 'gal', 'par', 'kit', 'dz'].includes(unit);
  return `<div class="mks" role="group" aria-label="Embalagens">${show
    .map(
      (u) => `<button type="button" class="mk ${u.state === 'open' ? 'open' : 'closed'}${weight ? ' w' : ''}" data-mk="${esc(u.id)}" data-pid="${esc(u.pid)}" aria-label="${esc(markerLabel(u, unit))}" title="${esc(markerLabel(u, unit))}">${u.state === 'open' ? BOX_OPEN : BOX_CLOSED}${weight ? `<em>${fmtNum(u.amount, 2)}</em>` : ''}</button>`,
    )
    .join('')}${units.length > max ? `<span class="mk-more">+${units.length - max}</span>` : ''}</div>`;
}

// root: contêiner com marcadores. resolve(pid) → unidades atuais. places: lista de lugares.
// onTap(unit), onDrop(units, place)
export function bindMarkers(root, { resolve, places, onTap, onDrop }) {
  let drag = null;
  const find = (pid, id) => resolve(pid).find((u) => u.id === id);

  const blockScroll = (e) => {
    if (drag?.active) e.preventDefault();
  };
  document.addEventListener('touchmove', blockScroll, { passive: false });

  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('[data-mk],[data-drag-group]')) e.preventDefault();
  });

  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-mk],[data-drag-group]');
    if (!el || e.button > 0) return;
    const st = { el, x: e.clientX, y: e.clientY, id: e.pointerId, active: false, cancelled: false };
    drag = st;
    st.timer = setTimeout(() => begin(st, e.clientX, e.clientY), 350);
    const move = (ev) => {
      if (ev.pointerId !== st.id) return;
      if (!st.active) {
        if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 10) {
          st.cancelled = true;
          clearTimeout(st.timer);
        }
        return;
      }
      ev.preventDefault();
      follow(st, ev.clientX, ev.clientY);
    };
    const up = (ev) => {
      if (ev.pointerId !== st.id) return;
      clearTimeout(st.timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (st.active) finish(st, ev.type === 'pointerup');
      else if (!st.cancelled && ev.type === 'pointerup' && el.dataset.mk) {
        const u = find(el.dataset.pid, el.dataset.mk);
        if (u) onTap(u);
      }
      drag = null;
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  // Teclado: Enter/Espaço no marcador = toque.
  root.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const el = e.target.closest('[data-mk]');
    if (!el) return;
    const u = find(el.dataset.pid, el.dataset.mk);
    if (u) onTap(u);
  });

  function begin(st, x, y) {
    if (st.cancelled) return;
    const el = st.el;
    let units;
    if (el.dataset.mk) units = [find(el.dataset.pid, el.dataset.mk)].filter(Boolean);
    else {
      const [pid, place] = el.dataset.dragGroup.split('|');
      units = resolve(pid).filter((u) => u.place === place);
    }
    if (!units.length) return;
    st.active = true;
    st.units = units;
    app.dragging = true;
    haptic('start');
    el.classList.add('dragging-src');
    const name = el.dataset.name || el.closest('[data-name]')?.dataset.name || '';
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = `<span class="mk ${units[0].state === 'open' ? 'open' : 'closed'}">${units[0].state === 'open' ? BOX_OPEN : BOX_CLOSED}</span><span>${units.length > 1 ? `${units.length} × ` : ''}${esc(name)}</span>`;
    document.body.appendChild(ghost);
    st.ghost = ghost;
    const from = units[0].place;
    const panel = document.createElement('div');
    panel.className = 'drop-panel';
    panel.innerHTML = `<p>Solte no lugar onde vai guardar</p><div class="drop-grid">${places
      .map((p) => `<div class="drop-tile${p === from ? ' here' : ''}" data-drop-place="${esc(p)}">${esc(p)}</div>`)
      .join('')}</div>`;
    document.body.appendChild(panel);
    st.panel = panel;
    document.body.classList.add('is-dragging');
    follow(st, x, y);
  }

  function follow(st, x, y) {
    st.ghost.style.transform = `translate(${x + 14}px, ${y - 44}px)`;
    st.ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(x, y)?.closest('[data-drop-place]');
    st.ghost.style.visibility = '';
    if (under !== st.over) {
      st.over?.classList.remove('over');
      under?.classList.add('over');
      if (under) haptic('tick');
      st.over = under;
    }
  }

  async function finish(st, dropped) {
    const place = dropped ? st.over?.dataset.dropPlace : null;
    st.ghost.remove();
    st.panel.remove();
    st.el.classList.remove('dragging-src');
    document.body.classList.remove('is-dragging');
    app.dragging = false;
    app.justDragged = Date.now();
    if (place && place !== st.units[0].place) {
      haptic('add');
      await onDrop(st.units, place);
    } else haptic('cancel');
    app.refresh();
  }

  return () => document.removeEventListener('touchmove', blockScroll);
}
