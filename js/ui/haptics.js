// Retorno tátil.
// - Android (Chrome e outros): navigator.vibrate, com padrões curtos por tipo de evento.
// - iPhone: o Safari não tem navigator.vibrate. A partir do iOS 18, tocar num <input type="checkbox" switch>
//   produz o "clique" tátil do sistema; o Zelo usa um interruptor invisível para isso. Só um toque por
//   vez (sem padrões) e só dentro de um gesto do usuário. Em iOS mais antigos, não há vibração.
// Pode ser desligado em Ajustes (preferência do aparelho).
const KEY = 'zelo.haptics';

const PATTERNS = {
  tick: 5, // tecla, letra do seletor
  tap: 10, // marcar, ação simples
  add: [12, 40, 18], // item adicionado
  start: 22, // começou a ouvir
  stop: [8, 30, 8], // parou de ouvir
  cancel: [30, 40, 30],
  warn: [20, 60, 20], // conflito
};

export const hapticsOn = () => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
};
export const setHaptics = (on) => {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* sem armazenamento */
  }
};

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const hapticsSupported = () => typeof navigator.vibrate === 'function' || isIOS();

let label = null;
function iosTick() {
  if (!label) {
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = 'zelo-haptic';
    input.tabIndex = -1;
    label = document.createElement('label');
    label.htmlFor = input.id;
    wrap.append(input, label);
    // O clique sintético não deve chegar aos outros ouvintes da página.
    wrap.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(wrap);
  }
  label.click();
}

export function haptic(kind = 'tap') {
  if (!hapticsOn()) return;
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(PATTERNS[kind] ?? 10);
    else if (isIOS()) iosTick();
  } catch {
    /* sem suporte */
  }
}
