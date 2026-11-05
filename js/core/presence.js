// Presença: em que lista e em que item cada pessoa está agora.
// Na nuvem vem do Firestore (sync.js); no modo demo, da pessoa simulada (demo.js); sozinho, nada.
import { app } from '../state.js';

let impl = null;
const subs = new Set();
let last = new Map();

export function usePresence(i) {
  impl = i;
  impl.on((m) => {
    last = m;
    subs.forEach((f) => f(m));
  });
}

export function setFocus(p) {
  Object.assign(app.focus, p);
  impl?.set({ ...app.focus });
}

export const onPresence = (f) => (subs.add(f), f(last), () => subs.delete(f));
export const current = () => last;

// Quem (além de mim) está nesta lista / editando este item.
export const inList = (listId) => [...last.entries()].filter(([, p]) => p.list === listId).map(([uid]) => uid);
export const onItem = (itemId) => [...last.entries()].filter(([, p]) => p.item === itemId).map(([uid]) => uid);
