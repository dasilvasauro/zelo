// Atualizar o estoque rápido, digitando ou falando — feito para sentar em frente à despensa e revisar.
//   Contagem ("tenho"): "leite 6", "arroz 2 pacotes", "café acabou" → a quantidade passa a ser essa.
//   Entrada ("chegou"): "3 detergentes" → soma ao que já tinha (compra fora de uma lista).
// Preços são ignorados aqui. Cada linha aplicada fica no histórico da sessão, com Desfazer.
import * as store from '../core/store.js';
import * as cat from '../core/catalog.js';
import * as voice from '../core/voice.js';
import { parseMany } from '../core/parse.js';
import { addMove, invQty, inventoryRows, ensureProduct, prodOf } from '../core/domain.js';
import { PLACES, defaultPlace } from '../core/units.js';
import { esc, fmtNum, unitLabel, norm, uid } from '../lib/util.js';
import { icon, sheet, toast } from '../ui/ui.js';
import { askQty } from '../ui/numpad.js';
import { haptic } from '../ui/haptics.js';
import { railHtml, bindRail, letterOf, scrollToEl } from '../ui/rail.js';
import { voiceRowHtml, bindVoice } from './add.js';
import { prefs, setPref } from '../state.js';

const PLACE_RX = new RegExp(`\\s(?:na|no|em|pra|para a|para o)\\s+(${PLACES.map((p) => norm(p)).join('|')})\\b`, 'i');

export function openStockInput() {
  let mode = prefs().stockMode || 'count';
  const log = [];
  let stopVoice = null;
  let unsub = null;

  sheet({
    title: 'Atualizar estoque',
    wide: true,
    body: `<div class="add stock-in">
      <div class="add-top">
        <div class="seg small add-tabs" role="radiogroup" aria-label="Como registrar">
          <button type="button" role="radio" data-smode="count">Contagem: tenho</button>
          <button type="button" role="radio" data-smode="in">Entrada: chegou</button>
        </div>
        <p class="si-hint" data-hint></p>
      </div>
      <div class="add-body" data-body></div>
      <div class="add-preview" data-preview hidden></div>
      <div class="add-foot">
        <div data-azslot></div>
        <form class="add-input" data-f autocomplete="off">
          <div class="search-in big">${icon('search')}<input name="q" type="text" enterkeyhint="done" placeholder="Ex.: leite 6, café acabou" aria-label="Digite itens e quantidades" data-q></div>
        </form>
        ${voice.enabled() ? voiceRowHtml() : ''}
      </div>
    </div>`,
    onMount(el, close) {
      const body = el.querySelector('[data-body]');
      const q = el.querySelector('[data-q]');
      const prev = el.querySelector('[data-preview]');

      const hint = () =>
        mode === 'count'
          ? 'A quantidade dita <b>substitui</b> a do estoque. “Acabou” ou “não tem” zera.'
          : 'A quantidade dita é <b>somada</b> ao estoque (compras fora de uma lista, presentes).';

      // Itens ditos, já conferidos com o catálogo e sem repetições da fala.
      const parse = (text) => {
        const seen = new Set();
        const out = [];
        for (const x of parseMany(text)) {
          let place = null;
          const m = (' ' + norm(x.text) + ' ').match(PLACE_RX);
          if (m) place = PLACES.find((p) => norm(p) === m[1]) || null;
          if (place && !x.known) x.name = x.name.replace(new RegExp(`\\s*(na|no|em)\\s+${place}\\s*$`, 'i'), '').trim();
          const key = (x.pid || norm(x.name)) + '|' + x.qty;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ ...x, place });
        }
        return out;
      };

      const rowHtml = (r) => `<div class="cat-row" data-row="${r.pid}">
          <button type="button" class="cat-main" data-pick="${r.pid}"><span class="cat-name">${esc(r.name)}</span><small>${r.qty > 0 ? `${fmtNum(r.qty)} ${esc(unitLabel(r.unit))}` : 'acabou'}${r.place ? ` · ${esc(r.place)}` : ''}</small></button>
          ${mode === 'in' ? `<button type="button" class="cat-plus" data-plus="${r.pid}" aria-label="Chegou mais um">${icon('plus')}</button>` : `<button type="button" class="cat-minus" data-zero="${r.pid}" aria-label="Acabou">0</button>`}
        </div>`;

      const draw = () => {
        el.querySelectorAll('[data-smode]').forEach((b) => {
          b.classList.toggle('on', b.dataset.smode === mode);
          b.setAttribute('aria-checked', b.dataset.smode === mode);
        });
        el.querySelector('[data-hint]').innerHTML = hint();
        const text = q.value.trim();
        const slot = el.querySelector('[data-azslot]');
        if (text) {
          slot.innerHTML = '';
          const items = parse(text);
          prev.hidden = !items.length;
          prev.innerHTML = items.length
            ? `<div class="pv-items">${items
                .map((x) => {
                  const cur = x.pid ? invQty(store.snapshot(), x.pid) : 0;
                  const next = mode === 'count' ? x.qty : cur + x.qty;
                  return `<span class="pv${x.known ? '' : ' unknown'}"><b>${esc(x.name)}</b>${x.known ? '' : ' <em>novo</em>'} → ${fmtNum(next)} ${esc(unitLabel(x.unit))}${x.pid ? ` <span class="muted">(era ${fmtNum(cur)})</span>` : ''}${x.place ? ` · ${esc(x.place)}` : ''}${!x.qtyGiven && mode === 'count' ? ' <span class="warn-text">quantidade?</span>' : ''}</span>`;
                })
                .join('')}</div>
               <button type="button" class="btn primary" data-apply>${icon('check')}Aplicar${items.length > 1 ? ` ${items.length}` : ''}</button>`
            : '';
          const last = items[items.length - 1];
          const res = last ? cat.search(last.known ? last.name : last.name, 20) : [];
          const S = store.snapshot();
          const rows = inventoryRows(S);
          body.innerHTML = `<div class="cat-list">${res
            .map((p) => rows.find((r) => r.pid === p.id) || { pid: p.id, name: p.name, unit: p.unit, qty: 0, place: '' })
            .map(rowHtml)
            .join('')}</div>`;
          return;
        }
        prev.hidden = true;
        const S = store.snapshot();
        const rows = inventoryRows(S).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        let html = log.length
          ? `<h4 class="sub">Nesta revisão</h4><div class="si-log">${log
              .slice()
              .reverse()
              .map((l) => `<div class="si-row${l.undone ? ' undone' : ''}"><span><b>${esc(l.name)}</b> ${l.mode === 'count' ? `${fmtNum(l.before)} → ${fmtNum(l.after)}` : `+${fmtNum(l.qty)} (agora ${fmtNum(l.after)})`} ${esc(unitLabel(l.unit))}</span>${l.undone ? '<small>desfeito</small>' : `<button type="button" class="link" data-undo="${l.id}">Desfazer</button>`}</div>`)
              .join('')}</div>`
          : '';
        let cur = '';
        const letters = [];
        html += `<h4 class="sub">No estoque <small class="muted">toque para ${mode === 'count' ? 'contar' : 'somar'}</small></h4><div class="cat-list">`;
        for (const r of rows) {
          const l = letterOf(r.name);
          if (l !== cur) {
            cur = l;
            letters.push(l);
            html += `<h4 class="az-head" data-letter="${l}">${l}</h4>`;
          }
          html += rowHtml(r);
        }
        html += '</div>';
        if (!rows.length) html += `<p class="empty">Nada no estoque ainda. Fale ou digite o que tem em casa: “arroz 2 pacotes, leite 6, café 1”.</p>`;
        body.innerHTML = html;
        if (letters.length > 5) {
          slot.innerHTML = railHtml(letters, 'in-sheet');
          bindRail(slot, (l) => scrollToEl(body.querySelector(`[data-letter="${l}"]`), { scroller: body }));
        } else slot.innerHTML = '';
      };

      // Aplica uma linha: contagem (substitui) ou entrada (soma). Produtos desconhecidos viram produtos da casa.
      const applyOne = async (x) => {
        const pid = x.pid || (await ensureProduct(x.name, x.unit));
        const S = store.snapshot();
        const before = invQty(S, pid);
        const unit = S.invByPid.get(pid)?.unit || prodOf(pid).unit || x.unit;
        const movId = mode === 'count' ? await addMove(pid, 'ajuste', x.qty, 'revisão') : await addMove(pid, 'compra', x.qty, 'entrada na revisão');
        const created = [];
        // Entrada com lugar dito ("3 detergentes na área de serviço"): as novas embalagens vão para lá.
        const place = x.place || (mode === 'in' ? prefs().stockPlace : null);
        if (mode === 'in' && place && place !== defaultPlace(pid, store.snapshot().invByPid.get(pid))) {
          const weight = !['un', 'pct', 'cx', 'dz', 'lata', 'fr', 'rolo', 'saco', 'gal', 'par', 'kit'].includes(unit);
          const n = weight ? 1 : Math.min(50, Math.round(x.qty));
          for (let k = 0; k < n; k++) created.push(await store.save('unit', { pid, place, state: 'closed', amount: weight ? x.qty : 1, openedAt: null }));
        }
        const after = invQty(store.snapshot(), pid);
        log.push({ id: uid(6), pid, name: prodOf(pid).name, unit, mode, qty: x.qty, before, after, movId, created });
      };

      const apply = async (text = q.value, { focus = true } = {}) => {
        const items = parse(text);
        if (!items.length) return;
        for (const x of items) await applyOne(x);
        haptic('add');
        toast(items.length === 1 ? `${items[0].name}: ${mode === 'count' ? 'contado' : 'somado'}` : `${items.length} itens atualizados`);
        q.value = '';
        draw();
        if (focus) q.focus();
      };

      el.addEventListener('click', async (e) => {
        const sm = e.target.closest('[data-smode]');
        if (sm) {
          mode = sm.dataset.smode;
          setPref('stockMode', mode);
          haptic('tick');
          return draw();
        }
        if (e.target.closest('[data-apply]')) return apply();
        const u = e.target.closest('[data-undo]');
        if (u) {
          const l = log.find((x) => x.id === u.dataset.undo);
          if (l && !l.undone) {
            await store.remove(l.movId);
            if (l.created.length) await store.removeMany(l.created);
            l.undone = true;
            haptic('tap');
            draw();
          }
          return;
        }
        const z = e.target.closest('[data-zero]');
        if (z) {
          await applyOne({ pid: z.dataset.zero, qty: 0, name: prodOf(z.dataset.zero).name, unit: prodOf(z.dataset.zero).unit });
          haptic('tap');
          return draw();
        }
        const plus = e.target.closest('[data-plus]');
        if (plus) {
          await applyOne({ pid: plus.dataset.plus, qty: 1, name: prodOf(plus.dataset.plus).name, unit: prodOf(plus.dataset.plus).unit });
          haptic('add');
          return draw();
        }
        const pick = e.target.closest('[data-pick]');
        if (pick) {
          const pid = pick.dataset.pick;
          const S = store.snapshot();
          const p = prodOf(pid, S.invByPid.get(pid));
          const unit = S.invByPid.get(pid)?.unit || p.unit;
          const n = await askQty(mode === 'count' ? `Quanto tem de ${p.name}?` : `Quanto chegou de ${p.name}?`, mode === 'count' ? invQty(S, pid) : 1, unit, { ok: mode === 'count' ? 'Salvar contagem' : 'Somar' });
          if (n == null) return;
          await applyOne({ pid, qty: n, name: p.name, unit });
          haptic('add');
          draw();
        }
      });
      el.querySelector('[data-f]').onsubmit = (e) => {
        e.preventDefault();
        apply();
      };
      q.addEventListener('input', draw);
      const vctl = bindVoice(el, {
        onPartial: (t) => {
          q.value = t;
          draw();
        },
        onFinal: (t) => {
          q.value = t;
          apply(t, { focus: false });
        },
        onCancel: () => {
          q.value = '';
          draw();
        },
      });
      stopVoice = () => vctl?.dispose();
      draw();
      unsub = store.subscribe(() => el.isConnected && !q.value && draw());
    },
    onClose: () => {
      stopVoice?.();
      unsub?.();
    },
  });
}
