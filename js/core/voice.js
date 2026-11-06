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
  let text = '';
  let aborted = false;
  r.onresult = (e) => {
    text = joinResults(e.results);
    onPartial?.(text);
  };
  r.onerror = (e) => {
    const err = e.error || 'error';
    if (err === 'aborted') return;
    if ((err === 'not-allowed' || err === 'service-not-allowed') && embedded()) onError?.('embedded');
    else onError?.(err);
  };
  r.onend = () => {
    // Ao soltar, o Safari às vezes não promove o último trecho a final: usa o parcial.
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

// Junta os trechos reconhecidos sem repetir.
// No Chrome para Android, em modo contínuo, cada resultado novo costuma trazer a frase inteira de novo
// ("meio quilo", "meio quilo de", "meio quilo de patinho"…), e somar tudo gerava
// "meio quilo meio quilo de meio quilo de patinho". Aqui, um trecho que começa com o anterior o substitui,
// e um trecho já contido no anterior é ignorado.
const nrm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export function joinResults(results) {
  const parts = [];
  for (let i = 0; i < results.length; i++) {
    const t = String(results[i][0]?.transcript || '').trim();
    if (!t) continue;
    const last = parts[parts.length - 1];
    if (last != null) {
      const a = nrm(last);
      const b = nrm(t);
      if (b.startsWith(a)) {
        parts[parts.length - 1] = t;
        continue;
      }
      if (a.startsWith(b) || a.endsWith(b)) continue;
      // Sobreposição: "meio quilo de" + "de patinho" → "meio quilo de patinho"
      const at = last.split(/\s+/);
      const bt = t.split(/\s+/);
      let k = Math.min(at.length, bt.length);
      for (; k > 0; k--) if (nrm(at.slice(-k).join(' ')) === nrm(bt.slice(0, k).join(' '))) break;
      if (k > 0 && (k > 1 || nrm(bt[0]).length > 2)) {
        parts[parts.length - 1] = [...at, ...bt.slice(k)].join(' ');
        continue;
      }
    }
    parts.push(t);
  }
  return cleanTranscript(parts.join(' '));
}

// Remove repetições seguidas de palavras ou trechos ("leite leite integral", "biscoito oreo biscoito oreo"),
// que o reconhecimento às vezes produz ao corrigir o que ouviu. Mais lento que somar, mas evita registros errados.
export function cleanTranscript(text) {
  let toks = String(text || '').split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let n = Math.min(8, Math.floor(toks.length / 2)); n >= 1; n--) {
      for (let i = 0; i + 2 * n <= toks.length; i++) {
        let same = true;
        for (let k = 0; k < n; k++)
          if (nrm(toks[i + k]) !== nrm(toks[i + n + k])) {
            same = false;
            break;
          }
        if (same) {
          toks.splice(i + n, n);
          changed = true;
          break outer;
        }
      }
    }
  }
  return toks.join(' ').trim();
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
