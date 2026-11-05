// Ditado de itens pela voz, com o reconhecimento do próprio navegador (Web Speech API).
// Não usa IA do Zelo nem serviço próprio. Observações honestas, mostradas em Ajustes:
// - Chrome (Android e computador) e Safari (iPhone, Mac) têm o recurso; Firefox não.
// - No Chrome o áudio é processado pelos servidores do Google, então costuma precisar de internet.
//   Alguns Android reconhecem offline se o pacote de idioma estiver baixado.
// - Página incorporada (iframe) sem permissão de microfone: o navegador recusa sem perguntar.
//
// Interação: segurar o botão para falar, soltar para adicionar. Arrastar o dedo para cima cancela.
const KEY = 'zelo.voice';
const LKEY = 'zelo.voiceLang';
const OKKEY = 'zelo.micOk';
const SIMKEY = 'zelo.demoMic';

const Ctor = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
const ls = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {
    return null;
  }
};

export const supported = () => !!Ctor();
export const enabled = () => ls(KEY) !== '0';
export const setEnabled = (on) => ls(KEY, on ? '1' : '0');
export const lang = () => ls(LKEY) || 'pt-BR';
export const setLang = (l) => ls(LKEY, l);

// Modo demo: simula a permissão concedida e o reconhecimento, para ver a interação.
const isDemo = () => document.documentElement.classList.contains('is-demo');
export const simOn = () => isDemo() && ls(SIMKEY) === '1';
export const setSim = (on) => ls(SIMKEY, on ? '1' : '0');

export const embedded = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};
export function micBlockedByPage() {
  const pol = document.permissionsPolicy || document.featurePolicy;
  try {
    if (pol?.allowsFeature) return !pol.allowsFeature('microphone');
  } catch {
    /* sem API de política */
  }
  return false;
}

// Estado da permissão: 'granted' | 'prompt' | 'denied' | 'blocked' (página incorporada) | 'unsupported'
export async function permState() {
  if (simOn()) return 'granted';
  if (!supported()) return 'unsupported';
  if (micBlockedByPage()) return 'blocked';
  try {
    const s = await navigator.permissions.query({ name: 'microphone' });
    if (s.state === 'granted') ls(OKKEY, '1');
    return s.state;
  } catch {
    // Navegadores sem consulta de permissão: lembra se já deu certo neste aparelho.
    return ls(OKKEY) === '1' ? 'granted' : 'prompt';
  }
}

// Avisa quando a permissão muda (por exemplo, liberada nas configurações do navegador).
export async function watchPerm(cb) {
  try {
    const s = await navigator.permissions.query({ name: 'microphone' });
    s.onchange = () => cb();
    return () => (s.onchange = null);
  } catch {
    return () => {};
  }
}

// Pede a permissão do microfone (toque no botão cinza).
export async function requestMic() {
  if (simOn()) return 'granted';
  if (!supported()) return 'unsupported';
  if (micBlockedByPage()) return 'blocked';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    ls(OKKEY, '1');
    return 'granted';
  } catch (e) {
    if (embedded()) return 'blocked';
    return e?.name === 'NotFoundError' ? 'nodevice' : 'denied';
  }
}

// Ouve enquanto o botão estiver pressionado. Devolve { stop, abort }.
// stop() encerra e entrega o texto final; abort() descarta.
export function listen({ onPartial, onFinal, onEnd, onError }) {
  if (simOn()) return listenSim({ onPartial, onFinal, onEnd });
  const C = Ctor();
  if (!C) {
    onError?.('unsupported');
    setTimeout(() => onEnd?.({ aborted: true }), 0);
    return { stop() {}, abort() {} };
  }
  const r = new C();
  r.lang = lang();
  r.interimResults = true;
  r.continuous = true; // continua enquanto o dedo estiver no botão
  r.maxAlternatives = 1;
  let finalText = '';
  let interim = '';
  let aborted = false;
  r.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript + ' ';
      else interim += res[0].transcript;
    }
    onPartial?.((finalText + interim).trim());
  };
  r.onerror = (e) => {
    const err = e.error || 'error';
    if (err === 'aborted') return;
    if ((err === 'not-allowed' || err === 'service-not-allowed') && embedded()) onError?.('embedded');
    else onError?.(err);
  };
  r.onend = () => {
    // Ao soltar, o Safari às vezes não promove o último trecho a final: usa o parcial.
    const text = (finalText + interim).trim();
    if (!aborted && text) onFinal?.(text);
    onEnd?.({ aborted, empty: !text });
  };
  try {
    r.start();
  } catch {
    onError?.('busy');
    setTimeout(() => onEnd?.({ aborted: true }), 0);
  }
  return {
    stop() {
      try {
        r.stop();
      } catch {
        /* já parou */
      }
    },
    abort() {
      aborted = true;
      try {
        r.abort();
      } catch {
        /* já parou */
      }
    },
  };
}

// Reconhecimento simulado (modo demo): "digita" uma frase de exemplo enquanto o botão está pressionado.
export const SAMPLES = ['dois pacotinhos de queijo ralado e duas latinhas de suco bonbon, 9,90', 'dois leites, café e três detergentes', 'banana 1,2 quilo e meia dúzia de ovos', 'shampoo, cream cheese e bacon', 'papel higiênico 22 reais e 90', 'duas cervejas lata, ketchup e pão de forma'];
let sampleIx = 0;
function listenSim({ onPartial, onFinal, onEnd }) {
  const words = SAMPLES[sampleIx++ % SAMPLES.length].split(' ');
  let n = 0;
  let done = false;
  const t = setInterval(() => {
    if (n < words.length) onPartial?.(words.slice(0, ++n).join(' '));
  }, 280);
  const finish = (aborted) => {
    if (done) return;
    done = true;
    clearInterval(t);
    const text = words.slice(0, n).join(' ');
    setTimeout(() => {
      if (!aborted && text) onFinal?.(text);
      onEnd?.({ aborted, empty: !text });
    }, 180);
  };
  return { stop: () => finish(false), abort: () => finish(true) };
}

export const ERRORS = {
  'not-allowed': 'O microfone foi negado. Libere nas configurações do site, no navegador.',
  'service-not-allowed': 'O navegador bloqueou o reconhecimento de voz.',
  embedded: 'Esta página está dentro de outra (como a demo publicada no Claude), e ela bloqueia o microfone sem perguntar. A voz funciona com o Zelo aberto pelo próprio endereço (localhost, GitHub Pages, Firebase Hosting).',
  network: 'O reconhecimento de voz deste navegador precisa de internet. Use a digitação rápida.',
  'no-speech': 'Não ouvi nada. Segure o botão e fale o item.',
  'audio-capture': 'Nenhum microfone encontrado.',
  unsupported: 'Este navegador não tem reconhecimento de voz. Use a digitação rápida.',
  busy: 'O microfone já está em uso.',
};

// Texto do botão para cada estado.
export const LABELS = {
  granted: 'Segure para falar',
  prompt: 'Toque para permitir o microfone',
  denied: 'Microfone negado · libere nas configurações do site',
  blocked: 'Microfone bloqueado nesta página',
  unsupported: 'Voz indisponível neste navegador',
  nodevice: 'Nenhum microfone encontrado',
  checking: 'Verificando o microfone…',
};
