// Edição de um item da lista: preço e quantidade pelo teclado numérico, e o detalhe do item.
//
// Conflitos durante a edição:
// - Ao abrir, o Zelo avisa se outra pessoa está neste item agora (presença).
// - Enquanto o teclado está aberto, se a outra pessoa gravar algo neste item, aparece na hora.
// - Ao salvar, cada campo é comparado com o valor de quando o teclado abriu: se a outra pessoa
//   mudou o MESMO campo que você, o Zelo pergunta qual valor fica. Campos diferentes se juntam sozinhos.
import * as store from '../core/store.js';
import * as cat from '../core/catalog.js';
import { prodOf, nameOf, itemTotal, priceStats, perUnit, priceModeFor } from '../core/domain.js';
import { setFocus, onPresence, onItem } from '../core/presence.js';
import { esc, money, fmtNum, unitLabel } from '../lib/util.js';
import { icon, sheet, toast, confirmDialog } from '../ui/ui.js';
import { openNumpad } from '../ui/numpad.js';
import { trendSentence, avatarDot } from './common.js';
import { priceBlock, mountPriceChart, isInt, openStock } from './product.js';
import { app, who, prefs, setPref } from '../state.js';

const FIELD_LABEL = { price: 'o preço', qty: 'a quantidade', total: 'o total' };

export async function editPrice(itemId, { fromCheck = false, focus = 'price' } = {}) {
  const base = store.get(itemId);
  if (!base) return;
  const S0 = store.snapshot();
  const list = S0.byId.get(base.listId);
  const unit = base.unit || prodOf(base.pid, base).unit;
  const weight = !isInt(unit);
  const name = nameOf(base);
  setFocus({ item: itemId });
  let unsubs = [];
  const othersHere = () => onItem(itemId);

  const remoteNote = () => {
    const cur = store.get(itemId);
    const S = store.snapshot();
    const parts = [];
    if (!cur) return `<div class="live-note neg">${icon('bolt')}Este item foi excluído por outra pessoa.</div>`;
    for (const f of ['price', 'qty', 'checked']) {
      if (cur[f] !== base[f] && cur._fb?.[f] && cur._fb[f] !== app.me) {
        const v = f === 'price' ? money(cur.price) : f === 'qty' ? fmtNum(cur.qty) : cur.checked ? 'no carrinho' : 'fora do carrinho';
        parts.push(`${esc(who(S, cur._fb[f]).name)} ${f === 'checked' ? 'deixou' : `mudou ${FIELD_LABEL[f]} para`} <b>${v}</b>`);
      }
    }
    const here = othersHere();
    const pres = here.length ? `<div class="live-note">${here.map((u) => avatarDot(S, u, 18)).join('')}<span>${esc(here.map((u) => who(S, u).name).join(', '))} também está neste item agora.</span></div>` : '';
    return pres + (parts.length ? `<div class="live-note warn">${icon('bolt')}<span>${parts.join('; ')} enquanto você editava.</span></div>` : '');
  };

  const ul = unitLabel(unit);
  const startMode = weight ? base.priceMode || priceModeFor(base.section, prefs()) : null;
  const r = await openNumpad({
    title: name,
    sub: `${esc(cat.sectionName(base.section))}${list?.store ? ` · ${esc(S0.byId.get(list.store)?.name || '')}` : ''}`,
    // Itens por peso: preço por kg ou total da etiqueta (a balança raramente bate com o pedido).
    modes: weight
      ? {
          value: startMode,
          options: [
            ['unit', `Preço por ${ul}`],
            ['total', 'Total da etiqueta'],
          ],
          onChange: (from, to, v) => {
            if (to === 'total') v.total = Math.round((v.price || 0) * (v.qty || 0));
            else if (v.qty > 0 && v.total) v.price = perUnit(v.total, v.qty);
          },
        }
      : null,
    fields: [
      { key: 'price', label: weight ? `Preço por ${ul}` : 'Preço unitário', kind: 'money', value: base.price || 0, mode: weight ? 'unit' : undefined },
      ...(weight ? [{ key: 'total', label: 'Total da etiqueta', kind: 'money', value: itemTotal(base), mode: 'total' }] : []),
      { key: 'qty', label: weight ? 'Peso' : 'Quantidade', kind: 'qty', value: Number(base.qty) || 1, unit, int: !weight, min: weight ? 0.1 : 1 },
    ],
    active: focus === 'qty' ? 'qty' : startMode === 'total' ? 'total' : 'price',
    info: (v, mode) => {
      const S = store.snapshot();
      if (mode === 'total') {
        const pu = perUnit(v.total || 0, v.qty || 0);
        return `<div data-remote>${remoteNote()}</div>
          <div class="np-total per"><span>Preço por ${esc(ul)}</span><b>${v.qty > 0 && v.total ? money(pu) : '—'}</b></div>
          ${v.qty > 0 && v.total ? `<p class="np-calc">${money(v.total)} ÷ ${fmtNum(v.qty)} ${esc(ul)} = ${money(pu)}/${esc(ul)}</p>` : `<p class="np-calc">Digite o total da etiqueta e o peso.</p>`}
          <p class="np-trend">${trendSentence(S, base.pid, pu, list?.store, base.listId)}</p>`;
      }
      const total = Math.round((v.price || 0) * (v.qty || 0));
      return `<div data-remote>${remoteNote()}</div>
        <div class="np-total"><span>Total</span><b>${money(total)}</b></div>
        <p class="np-trend">${trendSentence(S, base.pid, v.price, list?.store, base.listId)}</p>`;
    },
    actions: base.checked
      ? [
          { id: 'uncheck', label: 'Tirar do carrinho' },
          { id: 'save', label: 'Salvar', primary: true, icon: 'check' },
        ]
      : [
          { id: 'save', label: fromCheck ? 'Sem preço' : 'Salvar' },
          { id: 'cart', label: 'No carrinho', primary: true, icon: 'cart' },
        ],
    onMount(el) {
      const upd = () => {
        const n = el.querySelector('[data-remote]');
        if (n) n.innerHTML = remoteNote();
      };
      unsubs.push(store.subscribe(upd));
      unsubs.push(onPresence(upd));
    },
  });
  unsubs.forEach((f) => f());
  setFocus({ item: null });
  if (!r) return;

  const cur = store.get(itemId);
  if (!cur) return toast('O item foi excluído por outra pessoa enquanto você editava.');
  // O que esta edição quer gravar.
  const byTotal = r.mode === 'total';
  const want = byTotal
    ? { qty: r.values.qty, total: r.values.total, price: perUnit(r.values.total, r.values.qty), priceMode: 'total' }
    : { qty: r.values.qty, price: r.values.price, ...(weight ? { priceMode: 'unit', total: null } : {}) };
  if (weight && r.mode && r.mode !== (prefs().priceMode?.[base.section] || '')) setPref('priceMode', { ...prefs().priceMode, [base.section]: r.mode });
  const patch = {};
  const baseTotal = itemTotal(base);
  for (const f of byTotal ? ['total', 'qty'] : ['price', 'qty']) {
    const mine = f === 'total' ? want.total : want[f];
    const was = f === 'total' ? baseTotal : base[f];
    if (mine === was || (f !== 'qty' && !mine && !was)) continue;
    const curV = f === 'total' ? itemTotal(cur) : cur[f];
    const curBy = cur._fb?.[f === 'total' ? (cur.priceMode === 'total' ? 'total' : 'price') : f];
    if (curV !== was && curV !== mine && curBy && curBy !== app.me) {
      // As duas pessoas mudaram o mesmo campo: a pessoa decide.
      const S = store.snapshot();
      const other = who(S, curBy).name;
      const fmt = (x) => (f === 'qty' ? fmtNum(x) : money(x));
      const keep = await choose(`${other} mudou ${FIELD_LABEL[f]} de ${name} para ${fmt(curV)} enquanto você digitava ${fmt(mine)}. Qual fica?`, `Fica ${fmt(mine)} (o meu)`, `Fica ${fmt(curV)}`);
      if (!keep) continue;
    }
    patch[f] = mine;
  }
  // Campos derivados acompanham o que foi gravado.
  if (byTotal && ('total' in patch || 'qty' in patch)) {
    const t = patch.total ?? itemTotal(cur);
    const q = patch.qty ?? cur.qty;
    Object.assign(patch, { total: t, price: perUnit(t, q), priceMode: 'total' });
  } else if (!byTotal && weight && ('price' in patch || cur.priceMode === 'total')) {
    Object.assign(patch, { priceMode: 'unit', total: null });
  }
  if (r.action === 'cart') patch.checked = true;
  if (r.action === 'uncheck') patch.checked = false;
  if (patch.checked !== undefined && patch.checked !== cur.checked) {
    patch.checkedBy = app.me;
    patch.checkedAt = Date.now();
  }
  if (Object.keys(patch).length) await store.patch(itemId, patch);
  if ('price' in patch || 'total' in patch) {
    app.lastEdited = itemId;
    app.lastEditedAt = Date.now();
  }
}

function choose(message, mine, theirs) {
  return new Promise((resolve) => {
    let res = false;
    sheet({
      title: 'Alteração ao mesmo tempo',
      body: `<p class="sheet-text">${esc(message)}</p>
        <div class="sheet-actions stack"><button type="button" class="btn big" data-t>${esc(theirs)}</button><button type="button" class="btn primary big" data-m>${esc(mine)}</button></div>`,
      onMount(el, close) {
        el.querySelector('[data-m]').onclick = () => {
          res = true;
          close();
        };
        el.querySelector('[data-t]').onclick = close;
      },
      onClose: () => resolve(res),
    });
  });
}

/* ---------- Detalhe do item ---------- */
export function openItem(itemId) {
  const S = store.snapshot();
  const it = S.byId.get(itemId);
  if (!it) return;
  const p = prodOf(it.pid, it);
  const unit = it.unit || p.unit;
  const lists = S.list.filter((l) => l.status !== 'done' && l.id !== it.listId);
  const custom = !cat.product(it.pid);
  setFocus({ item: itemId });
  sheet({
    title: nameOf(it),
    wide: true,
    body: `<form class="form" data-f>
      ${custom ? `<label class="field"><span>Nome</span><input name="name" value="${esc(it.name || '')}" maxlength="60"></label>` : ''}
      <div class="grid2">
        <button type="button" class="tile" data-qty><span>Quantidade</span><b>${fmtNum(it.qty)} ${esc(unitLabel(unit))}</b></button>
        <button type="button" class="tile" data-price><span>Preço${isInt(unit) ? '' : ` por ${esc(unitLabel(unit))}`}</span><b>${it.price ? money(it.price) : 'Informar'}</b><small>${it.price ? `total ${money(itemTotal(it))}` : ''}</small></button>
      </div>
      <label class="field"><span>Observação</span><input name="note" value="${esc(it.note || '')}" maxlength="120" placeholder="Ex.: marca X, sem lactose, o maior"></label>
      ${custom ? `<label class="field"><span>Seção</span><select name="section">${cat.sections().map((s) => `<option value="${s.id}"${s.id === it.section ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
      ${lists.length ? `<label class="field"><span>Mover para</span><select name="move"><option value="">Manter nesta lista</option>${lists.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>` : ''}
      <h4 class="sub">Preços deste produto</h4>
      ${priceBlock(S, it.pid)}
      ${it.checkedBy ? `<p class="form-meta">Posto no carrinho por ${esc(who(S, it.checkedBy).name)}.</p>` : ''}
      <div class="sheet-actions">
        <button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>
        <div class="row-gap"><button type="button" class="btn ghost" data-stock>${icon('box')}Estoque</button><button class="btn primary">Salvar</button></div>
      </div>
    </form>`,
    onMount(el, close) {
      mountPriceChart(el, S, it.pid);
      const f = el.querySelector('[data-f]');
      el.querySelector('[data-qty]').onclick = () => {
        close();
        setTimeout(() => editPrice(itemId, { focus: 'qty' }), 230);
      };
      el.querySelector('[data-price]').onclick = () => {
        close();
        setTimeout(() => editPrice(itemId), 230);
      };
      el.querySelector('[data-stock]').onclick = () => {
        close();
        setTimeout(() => openStock(it.pid), 230);
      };
      el.querySelector('[data-del]').onclick = async () => {
        close();
        const snapshot = store.get(itemId);
        await store.remove(itemId);
        toast(`${nameOf(snapshot)} excluído`, {
          action: 'Desfazer',
          onAction: () => {
            const { id, ...rest } = snapshot;
            store.save('item', Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith('_'))), id);
          },
        });
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const patch = { note: f.note.value.trim() };
        if (f.name) patch.name = f.name.value.trim() || it.name;
        if (f.section) patch.section = f.section.value;
        if (f.move?.value) patch.listId = f.move.value;
        await store.patch(itemId, patch);
        if (patch.listId) toast('Item movido');
        close();
      };
    },
    onClose: () => setFocus({ item: null }),
  });
}
