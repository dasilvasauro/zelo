// Peças compartilhadas pelas telas.
import * as store from '../core/store.js';
import * as cat from '../core/catalog.js';
import { trend, storeName, prodOf } from '../core/domain.js';
import { esc, money, fmtPct, fmtDay, norm, uid, titleCase } from '../lib/util.js';
import { icon, sheet, toast, colorPicker, COLORS, seg } from '../ui/ui.js';
import { app, who } from '../state.js';

/* ---------- Comparação de preço ao lado do nome ---------- */
export function trendChip(S, it, storeId, listId) {
  const t = trend(S, it.pid, it.price, storeId, listId);
  if (t.dir === 'new' || t.dir === 'ref') return '';
  if (t.dir === 'eq') return `<span class="tr eq" title="Mesmo preço da última compra">=</span>`;
  const up = t.dir === 'up';
  return `<span class="tr ${up ? 'up' : 'down'}" title="${up ? 'Mais caro' : 'Mais barato'} que a última compra${t.sameStore ? ' nesta loja' : ''}">${icon(up ? 'up' : 'dn')}${fmtPct(t.pct)}</span>${t.best ? `<span class="tr best" title="Menor preço já pago">${icon('star')}</span>` : ''}`;
}

// Texto curto com a referência de preço (para a segunda linha do item).
export function refLine(S, it, storeId, listId) {
  const t = trend(S, it.pid, it.price, storeId, listId);
  if (t.dir === 'new') return '';
  const r = t.ref;
  const where = storeName(S, r.store);
  return `últ. ${money(r.price)}${where ? ` no ${esc(where)}` : ''}`;
}

// Frase completa para o teclado e o detalhe.
export function trendSentence(S, pid, price, storeId, listId) {
  const t = trend(S, pid, price, storeId, listId);
  if (t.dir === 'new') return `<span class="muted">Primeira vez que você registra o preço deste item.</span>`;
  const r = t.ref;
  const where = storeName(S, r.store);
  const base = `Última compra: <b>${money(r.price)}</b>${where ? ` no ${esc(where)}` : ''}, ${fmtDay(r.d)}.`;
  const min = t.min && t.min !== r ? ` Menor: ${money(t.min.price)}${storeName(S, t.min.store) ? ` no ${esc(storeName(S, t.min.store))}` : ''}.` : '';
  if (t.dir === 'ref') return base + min;
  if (t.dir === 'eq') return `${base} <span class="muted">Mesmo preço.</span>`;
  const up = t.dir === 'up';
  return `<span class="${up ? 'neg' : 'pos'}">${icon(up ? 'up' : 'dn', 'sm2')}${fmtPct(t.pct)} ${up ? 'mais caro' : 'mais barato'}</span>${t.best ? ' <span class="pos">· menor preço já pago</span>' : ''}<br>${base}${min}`;
}

/* ---------- Pessoas ---------- */
export function avatarDot(S, uidv, size = 22) {
  const w = who(S, uidv);
  return `<span class="who" style="--c:${w.color};width:${size}px;height:${size}px" title="${esc(w.name)}">${esc(w.short)}</span>`;
}

/* ---------- Locais de compra ---------- */
export const STORE_KINDS = [
  ['mercado', 'Supermercado'],
  ['atacado', 'Atacado'],
  ['feira', 'Feira / sacolão'],
  ['farmacia', 'Farmácia'],
  ['construcao', 'Material de construção'],
  ['online', 'Online'],
  ['outro', 'Outro'],
];

export function pickStore(current, { allowNone = true } = {}) {
  return new Promise((resolve) => {
    let out;
    const S = store.snapshot();
    const draw = (el, close) => {
      const S2 = store.snapshot();
      el.querySelector('[data-list]').innerHTML =
        (allowNone ? `<button type="button" class="pick-opt${!current ? ' on' : ''}" data-s=""><span>Sem local</span>${!current ? icon('check') : ''}</button>` : '') +
        S2.store
          .map(
            (s) => `<button type="button" class="pick-opt${s.id === current ? ' on' : ''}" data-s="${s.id}"><span class="store-opt"><i style="--c:${s.color}"></i>${esc(s.name)}<small>${esc(STORE_KINDS.find((k) => k[0] === s.kind)?.[1] || '')}</small></span>${s.id === current ? icon('check') : ''}</button>`,
          )
          .join('');
      el.querySelectorAll('[data-s]').forEach((b) =>
        b.addEventListener('click', () => {
          out = b.dataset.s;
          close();
        }),
      );
    };
    sheet({
      title: 'Onde você está comprando?',
      body: `<div class="form">
        <div class="pick-list" data-list></div>
        <div class="sheet-actions">
          ${S.store.some((s) => s.lat) && navigator.geolocation ? `<button type="button" class="btn ghost" data-geo>${icon('pin')}Detectar pelo local</button>` : '<span></span>'}
          <button type="button" class="btn" data-new>${icon('plus')}Novo local</button>
        </div>
        <p class="form-meta">O local fica salvo junto com os preços, para comparar onde cada item sai mais barato.</p>
      </div>`,
      onMount(el, close) {
        draw(el, close);
        el.querySelector('[data-new]').onclick = async () => {
          const id = await editStore();
          if (id) {
            out = id;
            close();
          }
        };
        el.querySelector('[data-geo]')?.addEventListener('click', () => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const near = nearestStore(store.snapshot(), pos.coords);
              if (near) {
                out = near.id;
                toast(`Você está no ${near.name}`);
                close();
              } else toast('Nenhum local salvo a menos de 400 m daqui.');
            },
            () => toast('Não foi possível obter a localização.'),
            { enableHighAccuracy: true, timeout: 8000 },
          );
        });
      },
      onClose: () => resolve(out),
    });
  });
}

function nearestStore(S, c) {
  let best = null;
  let bd = Infinity;
  for (const s of S.store) {
    if (!s.lat) continue;
    const d = dist(c.latitude, c.longitude, s.lat, s.lng);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return bd < 400 ? best : null;
}
function dist(a, b, c, d) {
  const R = 6371000;
  const r = Math.PI / 180;
  const x = (d - b) * r * Math.cos(((a + c) / 2) * r);
  const y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * R;
}

export function editStore(id) {
  return new Promise((resolve) => {
    const S = store.snapshot();
    const s = id ? S.byId.get(id) : { kind: 'mercado', color: COLORS[S.store.length % COLORS.length] };
    let saved = null;
    sheet({
      title: id ? 'Editar local' : 'Novo local de compra',
      body: `<form class="form" data-f>
        <label class="field"><span>Nome</span><input name="name" value="${esc(s.name || '')}" required maxlength="40" placeholder="Ex.: Atacadão da Marginal" autofocus></label>
        <label class="field"><span>Tipo</span><select name="kind">${STORE_KINDS.map(([v, l]) => `<option value="${v}"${v === s.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="field"><span>Cor</span>${colorPicker('color', s.color)}</div>
        ${navigator.geolocation ? `<label class="check pad"><input type="checkbox" name="geo"${s.lat ? ' checked' : ''}><span>${s.lat ? 'Localização salva (desmarque para apagar)' : 'Salvar a localização atual, para detectar o local depois'}</span></label>` : ''}
        <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
      </form>`,
      onMount(el, close) {
        const f = el.querySelector('[data-f]');
        el.querySelector('[data-del]')?.addEventListener('click', async () => {
          await store.remove(id);
          close();
        });
        f.onsubmit = async (e) => {
          e.preventDefault();
          const data = { name: f.name.value.trim(), kind: f.kind.value, color: f.querySelector('input[name=color]:checked')?.value || s.color, lat: s.lat || null, lng: s.lng || null };
          const finish = async () => {
            saved = await store.save('store', data, id);
            close();
          };
          if (f.geo?.checked && !s.lat) {
            navigator.geolocation.getCurrentPosition(
              (p) => {
                data.lat = p.coords.latitude;
                data.lng = p.coords.longitude;
                finish();
              },
              () => {
                toast('Localização indisponível; o local foi salvo sem ela.');
                finish();
              },
              { enableHighAccuracy: true, timeout: 8000 },
            );
          } else {
            if (f.geo && !f.geo.checked) {
              data.lat = null;
              data.lng = null;
            }
            finish();
          }
        };
      },
      onClose: () => resolve(saved),
    });
  });
}

/* ---------- Escolher produto (busca no catálogo) ---------- */
export function pickProduct({ title = 'Escolher produto', domain } = {}) {
  return new Promise((resolve) => {
    let out = null;
    sheet({
      title,
      body: `<div class="form">
        <div class="search-in">${icon('search')}<input type="search" placeholder="Buscar produto" autocomplete="off" data-q autofocus></div>
        <div class="pick-list" data-res></div>
      </div>`,
      onMount(el, close) {
        const q = el.querySelector('[data-q]');
        const res = el.querySelector('[data-res]');
        const draw = () => {
          const v = q.value.trim();
          let list = v ? cat.search(v, 40) : cat.allProducts().filter((p) => !domain || p.domain === domain).slice(0, 40);
          res.innerHTML =
            list.map((p) => `<button type="button" class="pick-opt" data-p="${p.id}"><span>${esc(p.name)}<small class="muted"> ${esc(cat.sectionName(p.section))}</small></span></button>`).join('') +
            (v ? `<button type="button" class="pick-opt" data-new><span>${icon('plus')} Criar “${esc(v)}”</span></button>` : '');
        };
        q.addEventListener('input', draw);
        res.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-p]');
          if (b) {
            out = b.dataset.p;
            return close();
          }
          if (e.target.closest('[data-new]')) {
            out = await createProduct(q.value.trim());
            if (out) close();
          }
        });
        draw();
      },
      onClose: () => resolve(out),
    });
  });
}

// Produto do usuário (registro cifrado do espaço, sincroniza com quem participa).
export function createProduct(name = '', id) {
  return new Promise((resolve) => {
    const cur = id ? store.get(id) : null;
    const secs = cat.sections();
    let saved = null;
    sheet({
      title: id ? 'Editar produto' : 'Novo produto',
      body: `<form class="form" data-f>
        <label class="field"><span>Nome</span><input name="name" value="${esc(cur?.name || name)}" required maxlength="60" autofocus></label>
        <label class="field"><span>Seção</span><select name="section">${cat.DOMAINS.map((d) => `<optgroup label="${d.name}">${secs.filter((s) => s.domain === d.id).map((s) => `<option value="${s.id}"${s.id === (cur?.section || 'outros') ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <label class="field"><span>Unidade</span><select name="unit">${['un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz', 'lata', 'fr', 'rolo', 'saco', 'm', 'm2', 'gal', 'par', 'kit'].map((u) => `<option value="${u}"${u === (cur?.unit || 'un') ? ' selected' : ''}>${u === 'm2' ? 'm²' : u}</option>`).join('')}</select></label>
        <label class="field"><span>Outros nomes (separados por vírgula)</span><input name="aliases" value="${esc((cur?.aliases || []).join(', '))}" placeholder="Ex.: ice tea, chá pronto"></label>
        <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
      </form>`,
      onMount(el, close) {
        const f = el.querySelector('[data-f]');
        el.querySelector('[data-del]')?.addEventListener('click', async () => {
          await store.remove(id);
          close();
        });
        f.onsubmit = async (e) => {
          e.preventDefault();
          const section = f.section.value;
          saved = await store.save(
            'prod',
            { name: titleCase(f.name.value), section, domain: cat.domainOf(section), unit: f.unit.value, aliases: f.aliases.value.split(',').map((a) => a.trim()).filter(Boolean) },
            id || `p_${uid(10)}`,
          );
          close();
        };
      },
      onClose: () => resolve(saved),
    });
  });
}

/* ---------- Conflitos ---------- */
export function conflictText(S, c) {
  const rec = S.byId.get(c.id);
  const thing = !rec ? '' : rec.pid ? rec.name || prodOf(rec.pid, rec).name : rec.name || '';
  const fmt = (v) => (c.field === 'price' || c.field === 'total' ? money(v || 0) : c.field === 'store' ? esc(storeName(S, v) || 'sem local') : c.field === 'payments' ? `${(v || []).length} forma(s)` : esc(String(v ?? '—')));
  return { thing, mine: fmt(c.mine), theirs: fmt(c.theirs), by: who(S, c.by).name };
}

export function conflictCards(S, list, filter = () => true) {
  const cs = list.filter(filter);
  if (!cs.length) return '';
  return `<div class="conflicts" role="status">${cs
    .map((c) => {
      const t = conflictText(S, c);
      return `<div class="conflict">
        <div class="conflict-txt">${icon('bolt')}<span><b>${esc(t.by)}</b> mudou ${esc(c.label)}${t.thing ? ` de <b>${esc(t.thing)}</b>` : ''} para <b>${t.theirs}</b>. Você tinha posto <b>${t.mine}</b>.</span></div>
        <div class="conflict-acts"><button type="button" class="btn small ghost" data-cf-keep="${c.cid}">Manter o meu</button><button type="button" class="btn small" data-cf-ok="${c.cid}">Ficar com ${t.theirs}</button></div>
      </div>`;
    })
    .join('')}</div>`;
}

export function bindConflicts(root) {
  root.querySelectorAll('[data-cf-keep]').forEach((b) => b.addEventListener('click', () => store.resolveConflict(b.dataset.cfKeep, true)));
  root.querySelectorAll('[data-cf-ok]').forEach((b) => b.addEventListener('click', () => store.resolveConflict(b.dataset.cfOk, false)));
}

export const PAY_METHODS = [
  ['pix', 'Pix'],
  ['debito', 'Débito'],
  ['credito', 'Crédito'],
  ['dinheiro', 'Dinheiro'],
  ['va', 'Vale-alimentação'],
  ['vr', 'Vale-refeição'],
  ['outro', 'Outro'],
];
export const payName = (m) => PAY_METHODS.find((x) => x[0] === m)?.[1] || 'Outro';

export { seg, norm };
