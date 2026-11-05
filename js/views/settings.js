import * as store from '../core/store.js';
import * as sync from '../core/sync.js';
import * as cat from '../core/catalog.js';
import * as voice from '../core/voice.js';
import { exportBackup, importBackup, exportPrices, exportStock, storageEstimate } from '../core/data.js';
import { esc } from '../lib/util.js';
import { icon, tip, sheet, toast, confirmDialog, colorPicker, COLORS } from '../ui/ui.js';
import { app, memberMap, prefs, setPref } from '../state.js';
import { qrSvg, inviteLink } from '../ui/qr.js';
import { editStore, STORE_KINDS, createProduct } from './common.js';
import { haptic, hapticsOn, setHaptics, hapticsSupported } from '../ui/haptics.js';

export const title = 'Ajustes';

export function render(el) {
  const S = store.snapshot();
  const st = store.stats();
  const P = prefs();
  const members = S.member.filter((m) => m.uid !== 'local' || app.demo);
  const requirePass = localStorage.getItem('zelo.requirePass') === '1';
  const vSup = voice.supported();

  el.innerHTML = `
  <section class="block first">
    <header class="block-head"><h3>Casa</h3>${tip('A casa reúne listas, estoque e preços. Duas ou mais pessoas podem usar a mesma casa ao mesmo tempo; cada alteração mostra quem fez.')}</header>
    <div class="set-card">
      ${
        app.demo
          ? `<p class="set-line">Modo demo ativo. Dados fictícios, só neste navegador, com a Ana simulada comprando junto.</p>
             <ul class="members">${members.map((m) => `<li><span class="who" style="--c:${m.color}">${esc((m.name || '?')[0].toUpperCase())}</span><span>${esc(m.name)}${m.uid === app.me ? ' (você)' : ' (simulada)'}</span></li>`).join('')}</ul>`
          : app.mode === 'cloud'
            ? `<div class="set-user">${app.user?.photoURL ? `<img src="${esc(app.user.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${icon('user')}</span>`}<div><b>${esc(app.user?.displayName || 'Conta Google')}</b><span>${esc(app.user?.email || '')}</span></div><span class="sync-tag" data-sync></span></div>
              <h4 class="sub">Quem participa</h4>
              <ul class="members">${members
                .map((m) => `<li><span class="who" style="--c:${m.color}">${esc((m.name || '?')[0].toUpperCase())}</span><span>${esc(m.name)}${m.uid === app.me ? ' (você)' : ''}${m.uid === app.owner ? ', dono' : ''}</span>${app.owner === app.me && m.uid !== app.me ? `<button type="button" class="btn small ghost danger-text" data-kick="${esc(m.uid)}">Remover</button>` : ''}</li>`)
                .join('')}</ul>
              <div class="set-actions">
                ${app.owner === app.me ? `<button type="button" class="btn" data-invite>${icon('users')}Convidar pessoa</button>` : ''}
                <button type="button" class="btn ghost" data-profile>${icon('edit')}Meu nome e cor</button>
                <button type="button" class="btn ghost" data-signout>Sair da conta</button>
              </div>`
            : `<p class="set-line">Dados guardados apenas neste dispositivo.</p>
              <div class="set-actions">${sync.cloudConfigured() ? `<button type="button" class="btn primary" data-connect>${icon('cloud')}Conectar conta Google</button>` : `<span class="set-line ${sync.getConfigError() ? 'neg' : 'muted'}">${esc(sync.getConfigError() || 'Para sincronizar e comprar junto com outra pessoa, configure o Firebase (veja o README).')}</span>`}</div>`
      }
    </div>
  </section>

  <div class="two-col">
    <section class="block">
      <header class="block-head"><h3>Locais de compra</h3>${tip('Mercados, feiras e lojas onde você compra. Os preços ficam guardados por local para comparar.')}<button type="button" class="btn small" data-newstore>${icon('plus')}Novo</button></header>
      ${S.store.length ? `<div class="cat-chips">${S.store.map((s) => `<button type="button" class="cat-chip" data-store="${s.id}"><i style="background:${s.color}"></i>${esc(s.name)}${s.lat ? icon('pin', 'sm') : ''}</button>`).join('')}</div>` : '<p class="empty">Nenhum local ainda. Dá para criar na hora, pela lista.</p>'}
    </section>

    <section class="block">
      <header class="block-head"><h3>Durante a compra</h3></header>
      <div class="set-card">
        <label class="switch"><input type="checkbox" data-askprice ${P.askPriceOnCheck ? 'checked' : ''}><span>Pedir o preço ao marcar um item</span></label>
        <label class="switch"><input type="checkbox" data-spark ${P.showSpark ? 'checked' : ''}><span>Gráficos pequenos no estoque</span></label>
        <label class="switch"><input type="checkbox" data-haptic ${hapticsOn() ? 'checked' : ''}><span>Vibrar ao marcar e adicionar itens</span></label>
        ${hapticsSupported() ? '' : '<p class="form-meta">Este aparelho não oferece vibração para sites.</p>'}
      </div>
    </section>
  </div>

  <section class="block">
    <header class="block-head"><h3>Adicionar pela voz</h3>${tip('Usa o reconhecimento de voz do próprio navegador, não uma IA do Zelo. A digitação rápida funciona sempre, inclusive offline.')}</header>
    <div class="set-card">
      ${
        vSup
          ? `<label class="switch"><input type="checkbox" data-voice ${voice.enabled() ? 'checked' : ''}><span>Mostrar o microfone ao adicionar itens</span></label>
             <label class="field inline"><span>Idioma do reconhecimento</span><select data-vlang><option value="pt-BR"${voice.lang() === 'pt-BR' ? ' selected' : ''}>Português (Brasil)</option><option value="en-US"${voice.lang() === 'en-US' ? ' selected' : ''}>English (US)</option></select></label>
             <p class="form-meta">O português entende bem termos em inglês comuns no mercado (shampoo, bacon, cream cheese). No Chrome, o áudio é processado pelo Google e costuma precisar de internet; no iPhone, pelo Safari/Apple. Fale como digitaria: “dois leites, café e detergente”.</p>`
          : `<p class="set-line muted">Este navegador não tem reconhecimento de voz (o Firefox, por exemplo). A digitação rápida continua disponível: “2 leite 5,49”.</p>`
      }
    </div>
  </section>

  <section class="block">
    <header class="block-head"><h3>Produtos</h3>${tip('O catálogo base vem com o app (mercado, casa e construção). Os produtos que você cria ficam na sua casa e sincronizam com quem participa.')}<button type="button" class="btn small" data-newprod>${icon('plus')}Novo produto</button></header>
    <div class="set-card">
      <p class="set-line">Catálogo base: ${cat.allProducts().filter((p) => p.base).length} produtos, versão ${cat.catalogVersion()}${app.mode === 'cloud' ? ' (sincronizado com a nuvem)' : ''}.</p>
      ${S.prod.length ? `<div class="cat-chips">${S.prod.map((p) => `<button type="button" class="cat-chip" data-prod="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : '<p class="set-line muted">Nenhum produto próprio ainda.</p>'}
      ${app.mode === 'cloud' ? `<div class="set-actions"><button type="button" class="btn ghost" data-pubcat>${icon('upload')}Publicar catálogo base na nuvem</button></div>` : ''}
    </div>
  </section>

  <section class="block">
    <header class="block-head"><h3>Dados</h3>${tip('O backup completo pode ser importado de volta em qualquer casa do Zelo.')}</header>
    <div class="set-card">
      <div class="set-actions">
        <button type="button" class="btn ghost" data-backup>${icon('download')}Backup completo</button>
        <label class="btn ghost file">${icon('upload')}Importar backup<input type="file" accept="application/json,.json" data-import hidden></label>
        <button type="button" class="btn ghost" data-csvp>${icon('download')}Preços (CSV)</button>
        <button type="button" class="btn ghost" data-csvs>${icon('download')}Estoque (CSV)</button>
      </div>
      <p class="set-line muted" data-usage>${st.live} registros${st.tomb ? `, ${st.tomb} exclusões aguardando limpeza` : ''}.</p>
    </div>
  </section>

  <section class="block">
    <header class="block-head"><h3>Segurança</h3>${tip('Os dados ficam cifrados no aparelho e na nuvem com uma chave protegida pela senha da casa.')}</header>
    <div class="set-card">
      ${app.demo ? '<p class="set-line muted">Indisponível no modo demo.</p>' : `
      <label class="switch"><input type="checkbox" data-reqpass ${requirePass ? 'checked' : ''}><span>Pedir a senha sempre que abrir</span></label>
      <div class="set-actions">
        <button type="button" class="btn ghost" data-lock>${icon('lock')}Bloquear agora</button>
        ${app.mode === 'local' || app.owner === app.me ? `<button type="button" class="btn ghost" data-pass>Alterar senha da casa</button>` : ''}
      </div>`}
    </div>
  </section>

  <section class="block">
    <header class="block-head"><h3>Modo demo</h3>${tip('Uma casa separada, com 90 dias de compras fictícias e uma segunda pessoa simulada. Nada vai para a nuvem e os dados reais não são tocados.')}</header>
    <div class="set-card">
      <div class="set-actions">
        <button type="button" class="btn ${app.demo ? 'primary' : 'ghost'}" data-demo>${icon('flask')}${app.demo ? 'Sair do modo demo' : 'Entrar no modo demo'}</button>
        ${app.demo ? `<button type="button" class="btn ghost danger-text" data-demoreset>Recomeçar dados de demonstração</button>` : ''}
      </div>
    </div>
  </section>
  <p class="foot-note">Zelo ${esc(app.version || '')}</p>`;

  const $ = (s) => el.querySelector(s);
  const on = (s, f) => $(s)?.addEventListener('click', f);

  const syncTag = $('[data-sync]');
  if (syncTag) {
    const L = { synced: 'Sincronizado', syncing: 'Sincronizando', offline: 'Offline', error: 'Erro ao sincronizar', denied: 'Sem acesso à casa', local: '' };
    const off = sync.onStatus((s) => {
      if (!syncTag.isConnected) return off();
      syncTag.textContent = L[s] || '';
      syncTag.dataset.s = s;
    });
  }
  on('[data-connect]', () => app.actions.connectGoogle());
  on('[data-signout]', async () => {
    if (await confirmDialog('Sair da conta neste dispositivo? Os dados locais deste aparelho serão apagados; na nuvem continuam salvos.', { ok: 'Sair', danger: true })) app.actions.signOut();
  });
  on('[data-invite]', invite);
  on('[data-profile]', profile);
  el.querySelectorAll('[data-kick]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmDialog('Remover esta pessoa da casa? Ela perde o acesso à nuvem. Se ela souber a senha, altere-a depois.', { ok: 'Remover', danger: true }))) return;
      await sync.removeMember(b.dataset.kick);
      const m = memberMap(store.snapshot()).get(b.dataset.kick);
      if (m) await store.remove(m.id);
      toast('Pessoa removida');
    }),
  );
  on('[data-newstore]', () => editStore());
  el.querySelectorAll('[data-store]').forEach((b) => b.addEventListener('click', () => editStore(b.dataset.store)));
  $('[data-askprice]').onchange = (e) => setPref('askPriceOnCheck', e.target.checked);
  $('[data-spark]').onchange = (e) => setPref('showSpark', e.target.checked);
  $('[data-haptic]').onchange = (e) => {
    setHaptics(e.target.checked);
    if (e.target.checked) haptic('add');
  };
  $('[data-voice]')?.addEventListener('change', (e) => voice.setEnabled(e.target.checked));
  $('[data-vlang]')?.addEventListener('change', (e) => voice.setLang(e.target.value));
  on('[data-newprod]', () => createProduct());
  el.querySelectorAll('[data-prod]').forEach((b) => b.addEventListener('click', () => createProduct('', b.dataset.prod)));
  on('[data-pubcat]', async () => {
    try {
      await sync.publishCatalog(cat.rawDomains(), cat.catalogVersion());
      toast('Catálogo publicado na nuvem');
    } catch (e) {
      toast(e.code === 'permission-denied' ? 'Outra conta publicou o catálogo; só ela pode alterá-lo.' : 'Não foi possível publicar. Verifique a conexão.');
    }
  });
  on('[data-backup]', exportBackup);
  on('[data-csvp]', exportPrices);
  on('[data-csvs]', exportStock);
  $('[data-import]').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = await importBackup(f);
      toast(n ? `${n} registros importados` : 'Nada novo para importar');
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  });
  storageEstimate().then((e) => {
    const u = $('[data-usage]');
    if (e && u) u.textContent += ` Espaço usado neste aparelho: ${(e.usage / 1048576).toFixed(1)} MB.`;
  });
  $('[data-reqpass]')?.addEventListener('change', (e) => app.actions.setRequirePass(e.target.checked));
  on('[data-lock]', () => app.actions.lock());
  on('[data-pass]', () => app.actions.changePass());
  on('[data-demo]', () => app.actions.toggleDemo());
  on('[data-demoreset]', async () => {
    if (await confirmDialog('Apagar os dados de demonstração e gerar novos?', { ok: 'Recomeçar', danger: true })) app.actions.resetDemo();
  });
}

async function invite() {
  let h;
  try {
    h = await sync.getHousehold(app.hid);
  } catch {
    return toast('Sem conexão. Tente de novo online.');
  }
  const code = () => `${app.hid}.${h.joinCode}`;
  const drawQR = async (el) => {
    el.querySelector('[data-qr]').innerHTML = await qrSvg(inviteLink(code()));
  };
  sheet({
    title: 'Convidar pessoa',
    body: `<div class="form">
      <p class="sheet-text">A pessoa aponta a câmera do celular para o QR Code, ou usa Ler QR Code dentro do Zelo, e entra com a conta Google dela. A senha da casa não vai no QR: combine pessoalmente ou por outro canal.</p>
      <div class="qr-card" data-qr aria-label="QR Code do convite" role="img"></div>
      <div class="code-box"><code data-code>${esc(code())}</code><button type="button" class="icon-btn" data-copy aria-label="Copiar código">${icon('copy')}</button></div>
      <div class="sheet-actions">
        <button type="button" class="btn ghost" data-rotate>${icon('refresh')}Gerar novo código</button>
        <button type="button" class="btn" data-share>${icon('share')}${navigator.share ? 'Compartilhar link' : 'Copiar link'}</button>
      </div>
      <p class="form-meta">Gerar um novo código invalida o anterior, inclusive o QR. Quem já entrou continua na casa.</p>
    </div>`,
    onMount(el) {
      drawQR(el);
      el.querySelector('[data-copy]').onclick = async () => {
        await navigator.clipboard.writeText(code());
        toast('Código copiado');
      };
      el.querySelector('[data-share]').onclick = async () => {
        const url = inviteLink(code());
        if (navigator.share) {
          try {
            await navigator.share({ title: 'Convite para o Zelo', text: 'Entre na nossa casa no Zelo para fazermos as compras juntos. A senha eu passo por outro canal.', url });
          } catch {
            /* cancelado */
          }
        } else {
          await navigator.clipboard.writeText(url);
          toast('Link copiado');
        }
      };
      el.querySelector('[data-rotate]').onclick = async () => {
        h.joinCode = await sync.rotateInvite(app.hid);
        el.querySelector('[data-code]').textContent = code();
        await drawQR(el);
        toast('Novo código gerado');
      };
    },
  });
}

function profile() {
  const S = store.snapshot();
  const m = memberMap(S).get(app.me) || { name: app.user?.displayName || '', color: COLORS[0] };
  sheet({
    title: 'Meu nome e cor',
    body: `<form class="form" data-f>
      <label class="field"><span>Nome exibido</span><input name="name" value="${esc(m.name)}" required maxlength="24" autofocus></label>
      <div class="field"><span>Cor</span>${colorPicker('color', m.color)}</div>
      <div class="sheet-actions"><span></span><button class="btn primary">Salvar</button></div></form>`,
    onMount(el, close) {
      el.querySelector('[data-f]').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        await store.save('member', { uid: app.me, name: f.name.value.trim(), color: f.querySelector('input[name=color]:checked')?.value || m.color }, `m_${app.me}`);
        close();
      };
    },
  });
}
