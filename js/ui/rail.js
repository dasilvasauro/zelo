// Seletor lateral de letras (A–Z), como na agenda do celular.
// Tocar ou arrastar o dedo pela barra mostra a letra grande e pula para ela.
import { norm } from '../lib/util.js';
import { haptic } from './haptics.js';

export const letterOf = (s) => {
  const c = norm(s)[0] || '#';
  return /[a-z]/.test(c) ? c.toUpperCase() : '#';
};

export function railHtml(letters) {
  const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const has = new Set(letters);
  return `<nav class="az-rail" aria-label="Pular para a letra">${all
    .map((l) => `<button type="button" data-l="${l}"${has.has(l) ? '' : ' class="off" tabindex="-1" aria-hidden="true"'}>${l}</button>`)
    .join('')}</nav><div class="az-bubble" hidden></div>`;
}

export function bindRail(root, onLetter) {
  const rail = root.querySelector('.az-rail');
  const bubble = root.querySelector('.az-bubble');
  if (!rail) return;
  let last = '';
  const pick = (x, y) => {
    const el = document.elementFromPoint(x, y);
    let b = el?.closest?.('[data-l]');
    if (!b || !rail.contains(b)) return;
    if (b.classList.contains('off')) {
      // pula para a próxima letra existente
      const all = [...rail.querySelectorAll('[data-l]')];
      const i = all.indexOf(b);
      b = all.slice(i).find((x) => !x.classList.contains('off')) || all.slice(0, i).reverse().find((x) => !x.classList.contains('off'));
      if (!b) return;
    }
    const l = b.dataset.l;
    bubble.hidden = false;
    bubble.textContent = l;
    if (l !== last) {
      last = l;
      haptic('tick');
      onLetter(l);
    }
  };
  rail.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    rail.setPointerCapture?.(e.pointerId);
    rail.classList.add('active');
    last = '';
    pick(e.clientX, e.clientY);
  });
  rail.addEventListener('pointermove', (e) => {
    if (rail.classList.contains('active')) pick(rail.getBoundingClientRect().left + rail.offsetWidth / 2, e.clientY);
  });
  const end = () => {
    rail.classList.remove('active');
    setTimeout(() => (bubble.hidden = true), 350);
  };
  rail.addEventListener('pointerup', end);
  rail.addEventListener('pointercancel', end);
  rail.addEventListener('keydown', (e) => {
    const b = e.target.closest('[data-l]');
    if (b && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onLetter(b.dataset.l);
    }
  });
}
