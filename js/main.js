import { openDB, deleteDB } from './lib/idb.js';
import { initClock } from './lib/clock.js';
import { initHLC } from './lib/hlc.js';
import { createKey, changePass } from './lib/crypto.js';
import { uid, esc, $ } from './lib/util.js';
import * as store from './core/store.js';
import * as sync from './core/sync.js';
import * as cat from './core/catalog.js';
import * as demo from './core/demo.js';
import { usePresence } from './core/presence.js';
import { icon, initTips, toast, sheet, confirmDialog, COLORS } from './ui/ui.js';
import { initPickers, popover } from './ui/pickers.js';
import { who, app } from './state.js';
import * as gate from './views/gate.js';
import * as lists from './views/lists.js';
import * as shop from './views/shop.js';
import * as inventory from './views/inventory.js';
import * as prices from './views/prices.js';
import * as settings from './views/settings.js';
import { openAdd } from './views/add.js';
import { conflictCards, bindConflicts } from './views/common.js';
import { haptic } from './ui/haptics.js';

app.version = '1.3.0';
const DEMO_ONLY = !!window.ZELO_DEMO_ONLY; // versão publicada só para experimentar
const VIEWS = { listas: lists, estoque: inventory, precos: prices, ajustes: settings };
const NAV = [
  ['listas', 'Listas', 'cart'],
  ['estoque', 'Estoque', 'box'],
  ['precos', 'Preços', 'tag'],
  ['ajustes', 'Ajustes', 'settings'],
];
const LOGO_URL = window.ZELO_LOGO || 'icons/icon.svg';

let current = null;
let param = null;
let lastParam = null;

const ls = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* sem armazenamento */
    }
  },
};

async function boot() {
  initTips();
  const inv = location.hash.match(/^#convite=([^&]+)/);
  if (inv) {
    sessionStorage.setItem('zelo.invite', decodeURIComponent(inv[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }
  applyTheme(ls.get('zelo.theme') || 'system');
  if (!window.isSecureContext || !crypto.subtle) throw new Error('o Zelo precisa ser aberto por HTTPS ou por localhost. Endereços como http://192.168… não liberam a criptografia do navegador. Veja as opções no README, em "Rodar localmente".');
  registerSW();
  app.demo = DEMO_ONLY || ls.get('zelo.demo') === '1';
  initClock(false);
  document.documentElement.classList.toggle('is-demo', app.demo);
  if (!DEMO_ONLY) await sync.loadConfig();
  const idb = await openDB(app.demo ? 'zelo-demo' : 'zelo');
  app.idb = idb;
  let device = await idb.get('meta', 'device');
  if (!device) await idb.put('meta', (device = uid(6)), 'device');
  initHLC(device);
  const cached = await idb.get('meta', 'catalog');
  if (cached?.v > cat.catalogVersion()) cat.useCloudCatalog(cached.domains, cached.v);

  if (app.demo) return bootDemo(idb);

  let hid = await idb.get('meta', 'hid');
  let key = null;
  if (hid && sessionStorage.getItem('zelo.invite')) {
    sessionStorage.removeItem('zelo.invite');
    setTimeout(() => toast('Este aparelho já está em uma casa. Para entrar em outra, saia da conta em Ajustes e abra o convite de novo.', { ms: 6000 }), 1500);
  }
  if (!hid) {
    let res = null;
    if (sync.cloudConfigured()) {
      try {
        const u = await sync.currentUser();
        if (u) res = await gate.afterGoogle(u);
      } catch {
        /* sem rede */
      }
    }
    res ||= await gate.welcome();
    ({ hid, key } = res);
    Object.assign(app, { hid, wrap: res.wrap, mode: res.mode, me: res.uid, owner: res.owner, user: res.user || null });
    for (const [k, v] of Object.entries({ hid, wrap: res.wrap, mode: res.mode, uid: res.uid, owner: res.owner })) await idb.put('meta', v, k);
    if (ls.get('zelo.requirePass') !== '1') await idb.put('meta', key, 'key');
  } else {
    Object.assign(app, { hid, wrap: await idb.get('meta', 'wrap'), mode: await idb.get('meta', 'mode'), me: await idb.get('meta', 'uid'), owner: await idb.get('meta', 'owner') });
    if (ls.get('zelo.requirePass') !== '1') key = await idb.get('meta', 'key');
    if (!key) key = await gate.unlock(app.wrap);
  }
  app.key = key;
  store.setMe(app.me);
  const res = await store.initStore(idb, key);
  if (app.mode === 'cloud') await startCloud(idb);
  else await ensureMember();
  gate.closeGate();
  start();
  if (res.rejected) toast(`${res.rejected} registros com falha de integridade foram descartados${app.mode === 'cloud' ? ' e serão baixados de novo' : ''}.`);
}

async function startCloud(idb) {
  try {
    let user = await sync.currentUser();
    if (!user) {
      gate.closeGate();
      user = await gate.signInAgain();
    }
    if (user.uid !== app.me) {
      toast('Conta Google diferente da usada neste aparelho.');
      return;
    }
    app.user = user;
    await ensureMember();
    await sync.startSync({ hid: app.hid, uid: app.me, idb });
    usePresence({ set: (p) => sync.setPresence(p), on: (f) => sync.onPresence(f) });
    refreshCatalog(idb);
  } catch {
    // Sem rede ou SDK indisponível: segue offline com os dados locais.
  }
}

// Catálogo da nuvem: usa se for mais novo; se ainda não existir, publica o embutido.
async function refreshCatalog(idb) {
  try {
    const docs = await sync.fetchCatalog();
    if (!docs.length) return sync.publishCatalog(cat.rawDomains(), cat.catalogVersion()).catch(() => {});
    const v = Math.min(...docs.map((d) => d.v || 0));
    if (v > cat.catalogVersion()) {
      const domains = Object.fromEntries(docs.map((d) => [d.id, JSON.parse(d.sections)]));
      cat.useCloudCatalog(domains, v);
      await idb.put('meta', { v, domains }, 'catalog');
      app.refresh();
    }
  } catch {
    /* offline: fica o embutido */
  }
}

async function ensureMember() {
  const S = store.snapshot();
  const id = `m_${app.me}`;
  if (S.byId.get(id)) return;
  const name = app.me === 'local' ? 'Você' : (app.user?.displayName || 'Membro').split(' ')[0];
  await store.save('member', { uid: app.me, name, color: COLORS[S.member.length % COLORS.length] }, id);
}

async function bootDemo(idb) {
  let key = await idb.get('meta', 'key');
  if (!key) {
    ({ key } = await createKey(uid(24)));
    await idb.put('meta', key, 'key');
    await idb.put('meta', 'demo', 'hid');
  }
  Object.assign(app, { hid: 'demo', mode: 'local', me: 'local', owner: 'local', key });
  store.setMe('local');
  await store.initStore(idb, key);
  if (!store.snapshot().member.length) {
    const g = document.getElementById('gate');
    g.hidden = false;
    g.innerHTML = `<div class="gate-card"><h1>Zelo</h1><p class="gate-lead">Preparando a casa de demonstração: 90 dias de compras, estoque e preços…</p></div>`;
    await demo.seedDemo();
    gate.closeGate();
  }
  demo.startPartner();
  start();
}

/* ---------- Casca ---------- */
function shell() {
  document.getElementById('app').innerHTML = `
    <nav class="nav" aria-label="Seções">
      <a class="brand" href="#listas"><img src="${LOGO_URL}" alt="" width="28" height="28"><span>Zelo</span></a>
      ${NAV.map(([id, label, ic]) => `<a href="#${id}" data-nav="${id}">${icon(ic)}<span>${label}</span></a>`).join('')}
      <button type="button" class="nav-new" data-new>${icon('plus')}<span data-newlabel>Nova lista</span></button>
    </nav>
    <div class="main-col">
      <div class="head">
        ${app.demo ? `<div class="testbar" data-demobar></div>` : ''}
        <header class="topbar"><h1 data-title></h1><span class="sync-dot" data-dot title=""></span><button type="button" class="me-btn" data-me aria-label="Conta e tema" aria-haspopup="dialog"></button></header>
      </div>
      <main id="view" tabindex="-1"></main>
    </div>
    <div class="conf-tray" data-tray></div>
    <button type="button" class="fab" data-new aria-label="Nova lista">${icon('plus')}</button>`;
  document.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', onNew));
  const dot = $('[data-dot]');
  const L = { synced: 'Sincronizado', syncing: 'Sincronizando', offline: 'Offline: as alterações ficam salvas e sobem ao reconectar', error: 'Erro ao sincronizar', denied: 'Sem acesso à casa na nuvem', local: 'Somente neste dispositivo' };
  sync.onStatus((s) => {
    const st = app.mode === 'cloud' ? s : 'local';
    dot.dataset.s = st;
    dot.title = L[st] || '';
    dot.setAttribute('aria-label', L[st] || '');
  });
  if (app.demo) demobar();
}

function onNew() {
  if (current === 'estoque') return inventory.fab();
  return lists.createList();
}

function route() {
  const h = location.hash.slice(1);
  const m = h.match(/^lista-([a-z0-9_-]+)$/i);
  const prev = current;
  let next;
  if (m) {
    next = 'lista';
    param = decodeURIComponent(m[1]);
  } else {
    next = VIEWS[h] ? h : 'listas';
    param = null;
  }
  if (prev === 'lista' && (next !== 'lista' || param !== lastParam)) shop.leave();
  const changed = next !== prev || param !== lastParam;
  lastParam = param;
  current = next;
  const immersive = next === 'lista';
  document.body.classList.toggle('immersive', immersive);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (immersive ? 'listas' : current)));
  const view = immersive ? shop : VIEWS[current];
  $('[data-title]').textContent = view.title;
  const me = $('[data-me]');
  me.hidden = current !== 'listas';
  if (!me.hidden) me.innerHTML = avatar(28);
  const fab = document.querySelector('.fab[data-new]');
  fab.hidden = immersive || !['listas', 'estoque'].includes(current);
  fab.setAttribute('aria-label', current === 'estoque' ? 'Adicionar ao estoque' : 'Nova lista');
  const nl = $('[data-newlabel]');
  if (nl) nl.textContent = current === 'estoque' ? 'Adicionar ao estoque' : 'Nova lista';
  document.title = current === 'listas' ? 'Zelo' : `${immersive ? store.get(param)?.name || 'Lista' : view.title}, Zelo`;
  render(changed);
  if (changed) window.scrollTo(0, 0);
}

function render(animate = false) {
  const el = document.getElementById('view');
  const y = window.scrollY;
  if (current === 'lista') shop.render(el, param);
  else VIEWS[current].render(el);
  tray();
  if (animate) {
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
  } else window.scrollTo(0, y);
}

// Conflitos fora da tela da lista (a lista mostra os dela).
function tray() {
  const t = $('[data-tray]');
  if (!t) return;
  const cs = current === 'lista' ? [] : store.conflicts();
  t.innerHTML = cs.length ? conflictCards(store.snapshot(), cs) : '';
  bindConflicts(t);
}

const rerender = (() => {
  let raf = 0;
  return () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render(false));
  };
})();

function start() {
  shell();
  initPickers();
  $('[data-me]').addEventListener('click', (e) => meMenu(e.currentTarget));
  app.nav = (r) => (location.hash = r);
  app.refresh = rerender;
  const syncProducts = () => cat.setUserProducts(store.snapshot().prod);
  syncProducts();
  store.subscribe(syncProducts);
  window.addEventListener('hashchange', route);
  store.subscribe(rerender);
  store.onConflicts((list) => {
    rerender();
    if (list.length) haptic('warn');
  });
  route();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !document.body.classList.contains('has-sheet') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      if (current === 'lista') openAdd(param);
      else onNew();
    }
  });
}

/* ---------- Avatar, tema e saída ---------- */
function avatar(size) {
  const S = store.snapshot();
  const w = who(S, app.me);
  const photo = app.user?.photoURL;
  const initial = `<span class="av-initial" style="--c:${w.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${esc(((app.user?.displayName || (app.me === 'local' ? '' : w.name)) || 'V').trim()[0].toUpperCase())}</span>`;
  if (!photo) return initial;
  return `<img class="av-img" src="${esc(photo)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer" onerror="this.outerHTML=this.dataset.fb" data-fb="${esc(initial)}">`;
}

function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
  ls.set('zelo.theme', t);
  const dark = t === 'dark' || (t !== 'light' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0F1217' : '#F5F6F8');
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => applyTheme(ls.get('zelo.theme') || 'system'));

function meMenu(anchor) {
  const theme = ls.get('zelo.theme') || 'system';
  const name = app.user?.displayName || (app.demo ? 'Modo demo' : who(store.snapshot(), app.me).name);
  const sub = app.demo ? 'Dados fictícios, só neste navegador' : app.mode === 'cloud' ? app.user?.email || 'Conta Google' : 'Somente neste dispositivo';
  const exit = app.demo ? (DEMO_ONLY ? null : ['Sair do modo demo', 'flask']) : app.mode === 'cloud' ? ['Sair da conta', 'logout'] : ['Bloquear', 'lock'];
  popover(
    anchor,
    (body, close) => {
      body.innerHTML = `<div class="me-menu">
        <div class="me-head">${avatar(44)}<div><b>${esc(name)}</b><span>${esc(sub)}</span></div></div>
        <div class="me-sec"><span>Tema</span>
          <div class="seg small" role="radiogroup" aria-label="Tema">${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === theme}" class="${v === theme ? 'on' : ''}" data-theme-opt="${v}">${l}</button>`).join('')}</div></div>
        ${exit ? `<button type="button" class="me-item${app.mode === 'cloud' && !app.demo ? ' danger-text' : ''}" data-exit>${icon(exit[1])}<span>${exit[0]}</span></button>` : ''}
      </div>`;
      body.querySelectorAll('[data-theme-opt]').forEach((b) =>
        b.addEventListener('click', () => {
          applyTheme(b.dataset.themeOpt);
          body.querySelectorAll('[data-theme-opt]').forEach((x) => {
            x.classList.toggle('on', x === b);
            x.setAttribute('aria-checked', x === b);
          });
          render(false);
        }),
      );
      body.querySelector('[data-exit]')?.addEventListener('click', async () => {
        close(false);
        if (app.demo) return app.actions.toggleDemo();
        if (app.mode !== 'cloud') return app.actions.lock();
        if (await confirmDialog('Sair da conta neste dispositivo? Os dados locais deste aparelho serão apagados; na nuvem continuam salvos.', { ok: 'Sair', danger: true })) app.actions.signOut();
      });
    },
    { title: 'Conta', minWidth: 280, cls: 'pop-me' },
  );
}

/* ---------- Barra do modo demo ---------- */
function demobar() {
  const bar = $('[data-demobar]');
  bar.innerHTML = `<span class="tb-label">${icon('flask')}Demo<b>casa de exemplo</b></span>
    <div class="tb-actions">
      <label class="tb-sim"><input type="checkbox" data-partner ${demo.partnerOn() ? 'checked' : ''}>Ana comprando junto</label>
      <button type="button" data-conflict>${icon('bolt', 'sm2')}Simular conflito</button>
      <button type="button" data-reset>Recomeçar</button>
    </div>`;
  const setH = () => document.documentElement.style.setProperty('--demo-h', `${bar.offsetHeight}px`);
  setH();
  window.addEventListener('resize', setH);
  bar.querySelector('[data-partner]').onchange = (e) => {
    demo.setPartner(e.target.checked);
    toast(e.target.checked ? 'A Ana vai marcar itens, pôr preços e adicionar coisas na lista aberta.' : 'A Ana parou de comprar.');
  };
  bar.querySelector('[data-conflict]').onclick = async () => toast(await demo.simulateConflict(), { ms: 5000 });
  bar.querySelector('[data-reset]').onclick = async () => {
    if (await confirmDialog('Apagar os dados de demonstração e gerar novos?', { ok: 'Recomeçar', danger: true })) app.actions.resetDemo();
  };
}

/* ---------- Ações globais ---------- */
app.actions = {
  async connectGoogle() {
    try {
      const user = await sync.signIn();
      if (!user) return;
      const home = await sync.userHome(user.uid);
      if (home && home !== app.hid) {
        const ok = await confirmDialog('Esta conta Google já participa de outra casa. Entrar nela substitui os dados deste aparelho. Exporte um backup antes, se quiser mantê-los.', { ok: 'Entrar na casa existente', danger: true });
        if (!ok) return sync.signOut();
        app.idb.close?.();
        await deleteDB('zelo');
        location.reload();
        return;
      }
      if (!home) await sync.createHousehold(app.hid, app.wrap, user.uid);
      if (store.get('m_local')) await store.remove('m_local');
      Object.assign(app, { mode: 'cloud', me: user.uid, owner: user.uid, user });
      await store.claimLocal(user.uid);
      for (const [k, v] of Object.entries({ mode: 'cloud', uid: user.uid, owner: user.uid })) await app.idb.put('meta', v, k);
      await ensureMember();
      await sync.startSync({ hid: app.hid, uid: app.me, idb: app.idb });
      usePresence({ set: (p) => sync.setPresence(p), on: (f) => sync.onPresence(f) });
      toast('Conta conectada. Os dados estão sendo enviados para a nuvem.');
      rerender();
    } catch (e) {
      toast('Não foi possível conectar: ' + (e.message || e.code));
    }
  },
  async signOut() {
    await sync.signOut();
    app.idb.close();
    await deleteDB('zelo');
    location.hash = '';
    location.reload();
  },
  async lock() {
    await app.idb.del('meta', 'key');
    location.reload();
  },
  async setRequirePass(on) {
    ls.set('zelo.requirePass', on ? '1' : '0');
    if (on) await app.idb.del('meta', 'key');
    else await app.idb.put('meta', app.key, 'key');
    toast(on ? 'A senha será pedida a cada abertura' : 'Este aparelho abre sem pedir a senha');
  },
  changePass() {
    sheet({
      title: 'Alterar senha da casa',
      body: `<form class="form" data-f>
        <label class="field"><span>Senha atual</span><input name="a" type="password" required autocomplete="current-password"></label>
        <label class="field"><span>Nova senha</span><input name="b" type="password" minlength="8" required autocomplete="new-password"></label>
        <label class="field"><span>Repita a nova senha</span><input name="c" type="password" required autocomplete="new-password"></label>
        <p class="form-meta">${app.mode === 'cloud' ? 'Quem participa vai usar a nova senha ao entrar em um aparelho novo. Os aparelhos já desbloqueados continuam funcionando.' : 'A senha protege os dados deste aparelho.'}</p>
        <div class="sheet-actions"><span></span><button class="btn primary">Alterar senha</button></div></form>`,
      onMount(el, close) {
        el.querySelector('[data-f]').onsubmit = async (e) => {
          e.preventDefault();
          const f = e.target;
          if (f.b.value !== f.c.value) return toast('As senhas novas não conferem.');
          try {
            const wrap = await changePass(f.a.value, f.b.value, app.wrap);
            if (app.mode === 'cloud') await sync.updateWrap(app.hid, wrap);
            app.wrap = wrap;
            await app.idb.put('meta', wrap, 'wrap');
            close();
            toast('Senha alterada');
          } catch (ex) {
            toast(ex.code === 'bad-pass' ? 'Senha atual incorreta.' : 'Não foi possível alterar. Verifique a conexão.');
          }
        };
      },
    });
  },
  toggleDemo() {
    if (DEMO_ONLY) return toast('Esta versão publicada é só para experimentar. Instale o projeto para usar com seus dados.');
    ls.set('zelo.demo', app.demo ? '0' : '1');
    location.hash = '';
    location.reload();
  },
  async resetDemo() {
    demo.stopPartner();
    app.idb.close();
    await deleteDB('zelo-demo');
    location.hash = '';
    location.reload();
  },
};

/* ---------- Service worker ---------- */
function registerSW() {
  if (DEMO_ONLY || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Nova versão disponível', { action: 'Atualizar', onAction: () => w.postMessage('skip'), ms: 8000 });
        });
      });
    })
    .catch(() => {});
  let reloaded = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

boot().catch((e) => {
  console.error(e);
  const g = document.getElementById('gate');
  g.hidden = false;
  g.innerHTML = `<div class="gate-card"><h1>Zelo</h1><p class="gate-lead">Não foi possível abrir o app: ${esc(e.message || e)}</p><button class="btn primary wide" onclick="location.reload()">Tentar de novo</button></div>`;
});
