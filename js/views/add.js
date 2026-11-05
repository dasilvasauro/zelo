// Adicionar itens a uma lista. Várias formas, todas a um toque do polegar:
//   - digitação rápida ("2 leite 5,49", "pão, café e 3 detergentes") com Enter;
//   - voz (se o navegador tiver e estiver ligada em Ajustes);
//   - Sugestões: essenciais acabando, o que você mais compra;
//   - Seções do mercado, da casa e da construção;
//   - A–Z com seletor lateral de letras.
import * as store from '../core/store.js';
import * as cat from '../core/catalog.js';
import * as voice from '../core/voice.js';
import { parseMany } from '../core/parse.js';
import { addToList, essentialsLow, frequent, listItems, prodOf, nameOf, isWeight, priceModeFor, perUnit } from '../core/domain.js';
import { prefs } from '../state.js';
import { esc, money, fmtNum, unitLabel, norm } from '../lib/util.js';
import { icon, sheet, toast } from '../ui/ui.js';
import { railHtml, bindRail, letterOf } from '../ui/rail.js';
import { createProduct } from './common.js';
import { haptic } from '../ui/haptics.js';

let lastTab = 'sug';

export function openAdd(listId) {
  const S0 = store.snapshot();
  const list = S0.byId.get(listId);
  let domain = list?.domain || 'mercado';
  let tab = lastTab;
  let section = null;
  let stopVoice = null;
  let unsub = null;

  sheet({
    title: 'Adicionar à lista',
    wide: true,
    body: `<div class="add">
      <div class="add-top">
        <div class="seg small add-tabs" role="tablist">${[['sug', 'Sugestões', 'star'], ['sec', 'Seções', 'sections'], ['az', 'A–Z', 'az']].map(([v, l]) => `<button type="button" role="tab" data-tab="${v}">${l}</button>`).join('')}</div>
        <div class="chips add-dom">${cat.DOMAINS.map((d) => `<button type="button" class="chip small" data-dom="${d.id}">${d.name}</button>`).join('')}</div>
      </div>
      <div class="add-body" data-body></div>
      <div class="add-preview" data-preview hidden></div>
      <div class="add-foot">
        <form class="add-input" data-f autocomplete="off">
          <div class="search-in big">${icon('search')}<input name="q" type="text" enterkeyhint="done" placeholder="Digite: 2 leite 5,49" aria-label="Buscar ou digitar itens" data-q></div>
        </form>
        ${voice.enabled() ? voiceRowHtml() : ''}
      </div>
    </div>`,
    onMount(el, close) {
      const body = el.querySelector('[data-body]');
      const q = el.querySelector('[data-q]');
      const prev = el.querySelector('[data-preview]');
      const inList = () => {
        const m = new Map();
        for (const it of listItems(store.snapshot(), listId)) if (!it.checked) m.set(it.pid, (m.get(it.pid) || 0) + (Number(it.qty) || 0));
        return m;
      };

      const row = (p, counts, extra = '') => {
        const n = counts.get(p.id);
        return `<div class="cat-row${n ? ' has' : ''}" data-row="${p.id}">
          <button type="button" class="cat-main" data-add="${p.id}"><span class="cat-name">${esc(p.name)}</span><small>${extra || esc(cat.sectionName(p.section))}</small></button>
          ${n ? `<button type="button" class="cat-minus" data-minus="${p.id}" aria-label="Tirar um">${icon('minus')}</button><span class="cat-n">${fmtNum(n)}</span>` : ''}
          <button type="button" class="cat-plus" data-add="${p.id}" aria-label="Adicionar ${esc(p.name)}">${icon('plus')}</button>
        </div>`;
      };

      const draw = () => {
        const S = store.snapshot();
        const counts = inList();
        el.querySelectorAll('[data-tab]').forEach((b) => {
          b.classList.toggle('on', b.dataset.tab === tab && !q.value.trim());
          b.setAttribute('aria-selected', b.dataset.tab === tab);
        });
        el.querySelectorAll('[data-dom]').forEach((b) => b.classList.toggle('on', b.dataset.dom === domain));
        el.querySelector('.add-dom').hidden = !!q.value.trim() || tab === 'sug';
        const text = q.value.trim();

        if (text) {
          const parsed = parseMany(text);
          // A busca acompanha o item que está sendo digitado agora (o último da frase).
          const last = parsed[parsed.length - 1];
          const lastRaw = last ? last.text : text;
          const term = last?.known ? last.name : (last?.name || lastRaw.replace(/r\$\s*/gi, '').replace(/\d+([.,]\d+)?\s*(kg|g|l|ml|x|un)?\b/gi, '')).replace(/\s+/g, ' ').trim();
          const res = term ? cat.search(term, 40) : [];
          body.innerHTML = `<div class="cat-list">${res.map((p) => row(p, counts)).join('')}
            ${term && !res.some((p) => norm(p.name) === norm(term)) ? `<button type="button" class="cat-row create" data-create="${esc(term)}">${icon('plus')}<span>Criar produto “${esc(term)}”</span></button>` : ''}</div>`;
          prev.hidden = !parsed.length;
          prev.innerHTML = parsed.length
            ? `<div class="pv-items">${parsed.map((x) => `<span class="pv${x.known ? '' : ' unknown'}">${fmtNum(x.qty)} ${x.unit !== 'un' ? esc(unitLabel(x.unit)) + ' ' : '× '}<b>${esc(x.name)}</b>${x.known ? '' : ' <em>novo</em>'}${pricePreview(x)}</span>`).join('')}</div>
               <button type="button" class="btn primary" data-addparsed>${icon('plus')}Adicionar${parsed.length > 1 ? ` ${parsed.length}` : ''}</button>`
            : '';
          return;
        }
        prev.hidden = true;

        if (tab === 'sug') {
          const low = essentialsLow(S).filter((r) => !counts.has(r.pid));
          const freq = frequent(S, 30).filter((pid) => !low.some((r) => r.pid === pid)).map((pid) => prodOf(pid));
          body.innerHTML = `
            ${low.length ? `<h4 class="sub">${icon('star', 'sm2')}Essenciais acabando <button type="button" class="link" data-alllow>Adicionar todos</button></h4><div class="cat-list">${low.map((r) => row(r.p, counts, r.qty > 0 ? `tem ${fmtNum(r.qty)} ${esc(unitLabel(r.unit))}` : 'acabou')).join('')}</div>` : ''}
            ${freq.length ? `<h4 class="sub">Você costuma comprar</h4><div class="cat-list">${freq.map((p) => row(p, counts)).join('')}</div>` : ''}
            ${!low.length && !freq.length ? `<p class="empty">As sugestões aparecem depois das primeiras compras. Use Seções ou A–Z, ou digite abaixo.</p>` : ''}`;
        } else if (tab === 'sec') {
          if (!section) {
            const secs = cat.sections().filter((s) => s.domain === domain && s.id !== 'outros');
            const prods = cat.allProducts();
            body.innerHTML = `<div class="sec-grid">${secs
              .map((s) => {
                const n = prods.filter((p) => p.section === s.id && counts.has(p.id)).length;
                return `<button type="button" class="sec-tile" data-sec="${s.id}"><b>${esc(s.name)}</b>${n ? `<span class="pill ok">${n} na lista</span>` : ''}</button>`;
              })
              .join('')}</div>`;
          } else {
            const prods = cat.allProducts().filter((p) => p.section === section).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
            body.innerHTML = `<button type="button" class="back-link" data-back>${icon('left')}${esc(cat.sectionName(section))}</button><div class="cat-list">${prods.map((p) => row(p, counts, ' ')).join('')}</div>`;
          }
        } else {
          const prods = cat.allProducts().filter((p) => p.domain === domain).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
          let cur = '';
          let html = '';
          const letters = [];
          for (const p of prods) {
            const l = letterOf(p.name);
            if (l !== cur) {
              cur = l;
              letters.push(l);
              html += `<h4 class="az-head" data-letter="${l}">${l}</h4>`;
            }
            html += row(p, counts);
          }
          body.innerHTML = `<div class="az-wrap"><div class="cat-list">${html}</div>${railHtml(letters)}</div>`;
          bindRail(body, (l) => {
            const h = body.querySelector(`[data-letter="${l}"]`);
            if (h) body.scrollTo({ top: h.offsetTop - 4 });
          });
        }
      };

      const flash = (pid) => {
        const r = body.querySelector(`[data-row="${CSS.escape(pid)}"]`);
        r?.classList.add('flash');
        setTimeout(() => r?.classList.remove('flash'), 400);
      };
      const add = async (pid, qty = 1) => {
        haptic('add');
        await addToList(store.snapshot(), listId, { pid, qty });
        draw();
        flash(pid);
      };

      el.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) {
          tab = lastTab = t.dataset.tab;
          section = null;
          q.value = '';
          return draw();
        }
        const d = e.target.closest('[data-dom]');
        if (d) {
          domain = d.dataset.dom;
          section = null;
          return draw();
        }
        const s = e.target.closest('[data-sec]');
        if (s) {
          section = s.dataset.sec;
          body.scrollTo(0, 0);
          return draw();
        }
        if (e.target.closest('[data-back]')) {
          section = null;
          return draw();
        }
        const a = e.target.closest('[data-add]');
        if (a) return add(a.dataset.add);
        const m = e.target.closest('[data-minus]');
        if (m) {
          const S = store.snapshot();
          const it = listItems(S, listId).find((x) => x.pid === m.dataset.minus && !x.checked);
          if (it) {
            haptic('tap');
            if ((Number(it.qty) || 0) > 1) await store.patch(it.id, { qty: Number(it.qty) - 1 });
            else await store.remove(it.id);
          }
          return draw();
        }
        if (e.target.closest('[data-alllow]')) {
          const S = store.snapshot();
          const counts = inList();
          const low = essentialsLow(S).filter((r) => !counts.has(r.pid));
          for (const r of low) await addToList(store.snapshot(), listId, { pid: r.pid, qty: Math.max(1, Math.ceil((r.min || 1) - r.qty) || 1) });
          haptic('add');
          toast(`${low.length} essenciais adicionados`);
          return draw();
        }
        if (e.target.closest('[data-create]')) {
          const id = await createProduct(e.target.closest('[data-create]').dataset.create || q.value.trim());
          if (id) {
            await add(id);
            q.value = '';
            draw();
          }
          return;
        }
        if (e.target.closest('[data-addparsed]')) return addParsed();
      });

      const addParsed = async (text = q.value, { focus = true } = {}) => {
        const items = parseMany(text);
        if (!items.length) return;
        const ids = [];
        for (const x of items)
          ids.push(await addToList(store.snapshot(), listId, { pid: x.pid, name: x.name, qty: x.qty, unit: x.unit, ...(byTotal(x) ? { total: x.price } : { price: x.price }) }));
        haptic('add');
        const fresh = items.filter((x) => !x.known).length;
        const extra = fresh ? ` · ${fresh === 1 ? 'produto novo criado' : `${fresh} produtos novos criados`}` : '';
        toast((items.length === 1 ? `${items[0].name} adicionado` : `${items.length} itens adicionados`) + extra, {
          action: 'Desfazer',
          onAction: () => store.removeMany(ids),
        });
        q.value = '';
        draw();
        if (focus) q.focus();
      };
      el.querySelector('[data-f]').onsubmit = (e) => {
        e.preventDefault();
        addParsed();
      };
      q.addEventListener('input', draw);

      const vctl = bindVoice(el, {
        onPartial: (t) => {
          q.value = t;
          draw();
        },
        onFinal: (t) => {
          q.value = t;
          addParsed(t, { focus: false });
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

/* ---------- Botão de voz: segurar para falar ---------- */
function voiceRowHtml() {
  const demo = document.documentElement.classList.contains('is-demo');
  return `<div class="voice-row">
    <button type="button" class="voice-btn" data-vbtn data-state="checking">
      <span class="vb-ic">${icon('mic')}</span>
      <span class="vb-label" data-vlabel>${voice.LABELS.checking}</span>
      <span class="vb-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
    </button>
    ${demo ? `<label class="vb-sim"><input type="checkbox" data-vsim ${voice.simOn() ? 'checked' : ''}><span>Demo: simular permissão do microfone concedida</span></label>` : ''}
  </div>`;
}

// Liga o botão: estados de permissão, segurar para falar, arrastar para cima para cancelar.
function bindVoice(root, { onPartial, onFinal, onCancel }) {
  const btn = root.querySelector('[data-vbtn]');
  if (!btn) return null;
  const label = root.querySelector('[data-vlabel]');
  let state = 'checking';
  let ctl = null; // reconhecimento em andamento
  let startY = 0;
  let startT = 0;
  let cancel = false;
  let heard = '';
  let unwatch = () => {};

  const set = (st, text) => {
    state = st;
    btn.dataset.state = st;
    label.textContent = text || voice.LABELS[st] || voice.LABELS.granted;
    const ready = ['granted', 'listening', 'cancel'].includes(st);
    btn.setAttribute('aria-disabled', String(!ready && st !== 'prompt'));
    btn.setAttribute('aria-label', st === 'granted' ? 'Segure para falar os itens; solte para adicionar' : label.textContent);
  };
  const refresh = async () => set(await voice.permState());
  refresh();
  voice.watchPerm(refresh).then((f) => (unwatch = f));

  const begin = (y) => {
    if (ctl) return;
    cancel = false;
    heard = '';
    startY = y;
    startT = Date.now();
    haptic('start');
    set('listening', 'Ouvindo… solte para adicionar');
    ctl = voice.listen({
      onPartial: (t) => {
        heard = t;
        onPartial(t);
      },
      onFinal: (t) => onFinal(t),
      onError: (err) => {
        if (err === 'not-allowed') set('denied');
        else if (err === 'embedded') set('blocked');
        toast(voice.ERRORS[err] || 'O reconhecimento de voz falhou. Use a digitação rápida.', { ms: err === 'embedded' ? 7000 : 3200 });
      },
      onEnd: (r = {}) => {
        ctl = null;
        if (['listening', 'cancel', 'granted'].includes(state)) set('granted');
        if (r.aborted) return;
        if (r.empty) toast(Date.now() - startT < 700 ? 'Segure o botão enquanto fala e solte no fim.' : voice.ERRORS['no-speech']);
      },
    });
  };
  const end = () => {
    if (!ctl) return;
    if (cancel) {
      haptic('cancel');
      ctl.abort();
      onCancel();
      toast('Cancelado');
    } else {
      haptic('stop');
      ctl.stop();
    }
    set('granted', 'Reconhecendo…');
  };

  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('pointerdown', async (e) => {
    if (e.button > 0) return;
    if (state === 'granted') {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      begin(e.clientY);
    }
  });
  btn.addEventListener('pointermove', (e) => {
    if (!ctl) return;
    const up = startY - e.clientY;
    const nowCancel = up > 70;
    if (nowCancel !== cancel) {
      cancel = nowCancel;
      haptic('tick');
      set(cancel ? 'cancel' : 'listening', cancel ? 'Solte para cancelar' : 'Ouvindo… solte para adicionar');
    }
  });
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', () => {
    cancel = true;
    end();
  });
  btn.addEventListener('click', async () => {
    if (state === 'prompt') {
      set('checking', 'Aguardando a permissão…');
      const r = await voice.requestMic();
      set(r);
      if (r === 'granted') {
        haptic('add');
        toast('Microfone liberado. Agora segure o botão enquanto fala.');
      } else toast(r === 'blocked' ? voice.ERRORS.embedded : r === 'nodevice' ? voice.ERRORS['audio-capture'] : voice.ERRORS['not-allowed'], { ms: 6000 });
    } else if (['denied', 'blocked', 'unsupported', 'nodevice'].includes(state)) {
      haptic('tap');
      toast(
        {
          denied: voice.ERRORS['not-allowed'],
          blocked: voice.ERRORS.embedded,
          unsupported: voice.ERRORS.unsupported,
          nodevice: voice.ERRORS['audio-capture'],
        }[state],
        { ms: 6000 },
      );
    }
  });
  // Teclado: segurar Espaço ou Enter.
  btn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && state === 'granted' && !e.repeat) {
      e.preventDefault();
      begin(0);
    }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      end();
    }
  });

  root.querySelector('[data-vsim]')?.addEventListener('change', (e) => {
    voice.setSim(e.target.checked);
    haptic('tap');
    refresh();
    toast(e.target.checked ? 'Permissão simulada. Segure o botão: a demo “ouve” uma frase de exemplo.' : 'Simulação desligada: vale a permissão real do navegador.');
  });

  return {
    dispose() {
      ctl?.abort();
      unwatch();
    },
  };
}

/* ---------- Preço falado/digitado de itens por peso ---------- */
// No açougue (ou onde você escolheu "Total da etiqueta"), "carne moída 0,5 kg 20 reais" é o total pago,
// e o preço por kg é calculado. Nos outros, o valor é o preço por kg.
function byTotal(x) {
  if (!x.price || !isWeight(x.unit)) return false;
  const section = x.pid ? prodOf(x.pid).section : 'outros';
  return priceModeFor(section, prefs()) === 'total';
}
function pricePreview(x) {
  if (!x.price) return '';
  const ul = unitLabel(x.unit);
  if (!isWeight(x.unit)) return ` · ${money(x.price)}`;
  if (byTotal(x)) return ` · ${money(x.price)} <span class="pv-per">(${money(perUnit(x.price, x.qty))}/${esc(ul)})</span>`;
  return ` · ${money(x.price)}/${esc(ul)}`;
}
