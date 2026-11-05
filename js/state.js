// Estado de sessão compartilhado entre telas.
export const app = {
  demo: false, // modo demo (banco separado, sem nuvem, outra pessoa simulada)
  mode: 'local', // 'local' | 'cloud'
  me: 'local',
  user: null, // usuário Google (nome, foto)
  hid: null,
  owner: null,
  idb: null,
  wrap: null,
  nav: () => {},
  refresh: () => {},
  focus: { list: null, item: null }, // onde a pessoa está agora (presença)
};

export function memberMap(S) {
  const m = new Map();
  for (const x of S.member) m.set(x.uid, x);
  return m;
}

export function who(S, uid) {
  const m = memberMap(S).get(uid);
  if (uid === app.me) return { name: 'Você', short: 'V', color: m?.color || '#7C8CFF' };
  if (!m) return { name: 'Outra pessoa', short: '?', color: '#8FA3B8' };
  return { name: m.name, short: (m.name || '?').trim()[0].toUpperCase(), color: m.color };
}

export const multiUser = (S) => S.member.filter((m) => m.uid !== 'local').length > 1 || app.demo;

// Preferências do aparelho (não sincronizadas).
const PK = 'zelo.prefs';
const DEF = { askPriceOnCheck: true, sort: 'secao', filter: 'todos', domain: 'todos', showSpark: true, hideDone: false, priceMode: {} };
export function prefs() {
  try {
    return { ...DEF, ...JSON.parse(localStorage.getItem(PK) || '{}') };
  } catch {
    return { ...DEF };
  }
}
export function setPref(k, v) {
  const p = prefs();
  p[k] = v;
  localStorage.setItem(PK, JSON.stringify(p));
}
