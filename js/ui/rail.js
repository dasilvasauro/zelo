// Seletor de letras horizontal (A–Z), fora do caminho da barra de rolagem vertical.
// Tocar numa letra ou deslizar o dedo pela faixa mostra a letra grande e pula para ela.
import { norm } from '../lib/util.js';
import { haptic } from './haptics.js';

export const letterOf = (s) => {
  const c = norm(s)[0] || '#';
  return /[a-z]/.test(c) ? c.toUpperCase() : '#';
};

export function railHtml(letters, cls = '') {
  const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const has = new Set(letters);
  return `<nav class="az-strip ${cls}" aria-label="Pular para a letra">${all
    .map((l) => `<button type="button" data-l="${l}"${has.has(l) ? '' : ' class="off" tabindex="-1" aria-hidden="true"'}>${l}</button>`)
    .join('')}<div class="az-bubble" hidden></div></nav>`;
}

export function bindRail(root, onLetter) {
  const strip = root.querySelector('.az-strip');
  if (!strip) return;
  const bubble = strip.querySelector('.az-bubble');
  let last = '';
  let active = false;
  const pick = (x) => {
    const r = strip.getBoundingClientRect();
    const btns = [...strip.querySelectorAll('[data-l]')];
    let b = document.elementFromPoint(Math.min(Math.max(x, r.left + 1), r.right - 1), r.top + r.height / 2)?.closest?.('[data-l]');
    if (!b) return;
    if (b.classList.contains('off')) {
      const i = btns.indexOf(b);
      b = btns.slice(i).find((x) => !x.classList.contains('off')) || btns.slice(0, i).reverse().find((x) => !x.classList.contains('off'));
      if (!b) return;
    }
    const l = b.dataset.l;
    const br = b.getBoundingClientRect();
    bubble.hidden = false;
    bubble.textContent = l;
    bubble.style.left = `${br.left + br.width / 2 - r.left}px`;
    btns.forEach((x) => x.classList.toggle('cur', x === b));
    if (l !== last) {
      last = l;
      haptic('tick');
      onLetter(l);
    }
  };
  strip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    strip.setPointerCapture?.(e.pointerId);
    active = true;
    last = '';
    strip.classList.add('active');
    pick(e.clientX);
  });
  strip.addEventListener('pointermove', (e) => active && pick(e.clientX));
  const end = () => {
    active = false;
    strip.classList.remove('active');
    setTimeout(() => {
      bubble.hidden = true;
      strip.querySelectorAll('.cur').forEach((x) => x.classList.remove('cur'));
    }, 450);
  };
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', end);
  strip.addEventListener('keydown', (e) => {
    const b = e.target.closest('[data-l]');
    if (b && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onLetter(b.dataset.l);
    }
  });
}

// Rola um contêiner (ou a página) até o elemento, descontando o que fica grudado no topo.
export function scrollToEl(target, { scroller = null, offset = 0 } = {}) {
  if (!target) return;
  if (scroller) {
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset;
    scroller.scrollTo({ top });
  } else window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset });
}
