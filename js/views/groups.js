// Telas dos grupos essenciais: cartões, detalhe do grupo, escolher grupos e repor.
import * as store from '../core/store.js';
import { GROUPS, activeGroups, evaluate, config, setConfig, groupById, shortName } from '../core/groups.js';
import { newList, addToList, inventoryRows } from '../core/domain.js';
import { esc, fmtNum, unitLabel } from '../lib/util.js';
import { icon, sheet, toast } from '../ui/ui.js';
import { askQty } from '../ui/numpad.js';
import { haptic } from '../ui/haptics.js';
import { openStock } from './product.js';
import { app } from '../state.js';

const STATE_LABEL = { out: 'Acabou', low: 'Acabando', ok: 'Em dia', empty: 'Sem itens' };

export function groupCardsHtml(evals) {
  if (!evals.length)
    return `<button type="button" class="grp-empty" data-groups>${icon('star', 'sm2')}Ative grupos como <b>Mistura</b>, <b>Frutas</b> ou <b>Laticínios</b> para o Zelo avisar quando estiverem acabando</button>`;
  return `<div class="grp-cards">${evals
    .map(
      (e) => `<button type="button" class="grp-card ${e.state}" data-group="${e.g.id}">
        <span class="gc-top"><b>${esc(e.g.name)}</b><i class="gc-dot"></i></span>
        <span class="gc-msg">${e.state === 'ok' ? esc(e.detail) : esc(e.message)}</span>
        <span class="gc-sub">${e.state === 'ok' ? `${e.members.filter((m) => m.qty > 0).length} em casa` : esc(e.detail)}</span>
      </button>`,
    )
    .join('')}<button type="button" class="grp-card more" data-groups aria-label="Escolher grupos">${icon('edit')}<span>Grupos</span></button></div>`;
}

export function bindGroupCards(root) {
  root.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => openGroup(b.dataset.group)));
  root.querySelectorAll('[data-groups]').forEach((b) => b.addEventListener('click', openGroupsManage));
}

// Avisos para a tela de listas: grupos que precisam de atenção (o essencial pelo nome primeiro).
export function alerts(S = store.snapshot()) {
  return activeGroups(S).filter((e) => e.state === 'out' || e.state === 'low');
}

// Põe as sugestões na lista aberta (ou numa nova "Reposição").
export async function addSuggestions(items) {
  if (!items.length) return;
  const S = store.snapshot();
  const target = S.list.find((l) => l.status !== 'done' && (l.domain || 'mercado') === 'mercado') || S.list.find((l) => l.status !== 'done');
  const id = target?.id || (await newList(S, { name: 'Reposição' }));
  const done = new Set();
  for (const m of items) {
    if (done.has(m.pid)) continue;
    done.add(m.pid);
    await addToList(store.snapshot(), id, { pid: m.pid, qty: Math.max(1, Math.ceil((m.min || 1) - m.qty) || 1) });
  }
  haptic('add');
  toast(`${done.size} ${done.size === 1 ? 'item' : 'itens'} na lista ${store.get(id)?.name || ''}`, { action: 'Abrir', onAction: () => app.nav(`lista-${id}`) });
}

export function openGroup(id) {
  const g = groupById(id);
  let unsub = null;
  sheet({
    title: g.name,
    wide: true,
    body: `<div class="detail" data-body></div>`,
    onMount(el, close) {
      const draw = () => {
        const S = store.snapshot();
        const e = evaluate(S, g);
        const members = e.members.slice().sort((a, b) => (b.essential ? 1 : 0) - (a.essential ? 1 : 0) || (b.qty > 0 ? 1 : 0) - (a.qty > 0 ? 1 : 0) || b.rate - a.rate);
        el.querySelector('[data-body]').innerHTML = `
          <div class="grp-head-card ${e.state}">
            <span class="pill ${e.state === 'ok' ? 'ok' : 'late'}">${STATE_LABEL[e.state]}</span>
            <b>${esc(e.state === 'ok' ? 'Tudo certo por aqui' : e.message)}</b>
            ${e.sub ? `<span>${esc(e.sub)}</span>` : ''}
            <small>${esc(e.detail || '')} · avisa com menos de ${e.threshold} dia${e.threshold === 1 ? '' : 's'}</small>
          </div>
          ${e.suggest.length ? `<div class="grp-suggest"><span>Repor: ${e.suggest.map((m) => `<b>${esc(shortName(m.name))}</b>`).join(', ')}</span><button type="button" class="btn small primary" data-addsug>${icon('cart')}Pôr na lista</button></div>` : ''}
          <h4 class="sub">Itens do grupo <small class="muted">&nbsp;★ essenciais têm prioridade nos avisos</small></h4>
          ${members.length ? `<ul class="parts grp-members">${members
            .map((m) => `<li><button type="button" class="row-btn" data-stock="${m.pid}"><span>${m.essential ? `<span class="ess-dot">${icon('star')}</span>` : ''}${esc(m.name)}<small>${m.days != null && m.qty > 0 ? `dura ~${Math.max(1, Math.round(m.days))} dia${Math.round(m.days) > 1 ? 's' : ''}` : m.qty <= 0 ? 'acabou' : 'sem histórico de consumo'}</small></span><b class="${m.qty <= 0 ? 'neg' : m.status === 'low' ? 'warn-text' : ''}">${fmtNum(m.qty)} ${esc(unitLabel(m.unit))}</b></button></li>`)
            .join('')}</ul>` : `<p class="empty">Nenhum item deste grupo no estoque ainda. Eles entram quando você compra ou conta (${esc(g.hint)}).</p>`}
          <div class="sheet-actions">
            <button type="button" class="btn ghost" data-days>Avisar com menos de ${e.threshold} dias</button>
            <button type="button" class="btn ghost danger-text" data-off>Desativar grupo</button>
          </div>`;
        const $ = (s) => el.querySelector(s);
        $('[data-addsug]')?.addEventListener('click', () => addSuggestions(e.suggest));
        el.querySelectorAll('[data-stock]').forEach((b) => b.addEventListener('click', () => {
          close();
          setTimeout(() => openStock(b.dataset.stock), 230);
        }));
        $('[data-days]').onclick = async () => {
          const n = await askQty(`Avisar quando ${g.name.toLowerCase()} durar menos de`, e.threshold, 'un', { label: 'Dias', ok: 'Salvar' });
          if (n == null) return;
          await setConfig({ days: { ...config().days, [g.id]: Math.max(1, Math.round(n)) } });
        };
        $('[data-off]').onclick = async () => {
          await setConfig({ active: config().active.filter((x) => x !== g.id) });
          close();
          toast(`Grupo ${g.name} desativado`);
        };
      };
      draw();
      unsub = store.subscribe(() => el.isConnected && draw());
    },
    onClose: () => unsub?.(),
  });
}

export function openGroupsManage() {
  sheet({
    title: 'Grupos essenciais',
    body: `<div class="form">
      <p class="sheet-text">Escolha os grupos que não podem faltar. O Zelo soma o que há em casa de cada grupo e avisa quando estiver acabando ("estamos ficando sem mistura"). Itens marcados como essenciais dentro do grupo são avisados pelo nome.</p>
      <div class="grp-pick" data-list></div>
    </div>`,
    onMount(el) {
      const draw = () => {
        const S = store.snapshot();
        const cfg = config(S);
        const rows = inventoryRows(S);
        el.querySelector('[data-list]').innerHTML = GROUPS.map((g) => {
          const n = rows.filter((r) => g.match(r.p)).length;
          const on = cfg.active.includes(g.id);
          return `<label class="grp-opt${on ? ' on' : ''}"><input type="checkbox" data-g="${g.id}" ${on ? 'checked' : ''}><span><b>${esc(g.name)}</b><small>${esc(g.hint)}${n ? ` · ${n} no estoque` : ''}</small></span></label>`;
        }).join('');
        el.querySelectorAll('[data-g]').forEach((c) =>
          c.addEventListener('change', async () => {
            const act = new Set(config().active);
            c.checked ? act.add(c.dataset.g) : act.delete(c.dataset.g);
            haptic('tick');
            await setConfig({ active: GROUPS.map((g) => g.id).filter((id) => act.has(id)) });
            draw();
          }),
        );
      };
      draw();
    },
  });
}
