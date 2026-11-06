// Digitação rápida (e voz): transforma frases em itens com quantidade e preço. Sem IA, só regras.
//
//   "2 leite 5,49"                        → 2 × Leite integral, R$ 5,49 cada
//   "banana 1,2kg 6,99"                   → 1,2 kg de Banana, R$ 6,99/kg
//   "3x detergente, pão e café"           → três itens
//   "dois shampoos por 12 reais e 90"     → 2 × Shampoo, R$ 12,90 cada
//   "dois pacotinhos de queijo ralado"    → 2 × Queijo ralado (diminutivos e embalagens)
//   "duas latinhas de suco bonbon, 9,90"  → 2 × Suco bonbon, R$ 9,90 cada (produto novo, se não existir)
import { bestMatch, vocab, heads } from './catalog.js';
import { norm, titleCase } from '../lib/util.js';

const WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, meio: 0.5, meia: 0.5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};

// Unidades de medida (descrevem quanto) e embalagens (descrevem em quê).
const MEASURE = new Map(Object.entries({
  kg: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilos: 'kg', g: 'g', grama: 'g', gramas: 'g',
  l: 'L', litro: 'L', litros: 'L', ml: 'ml', m: 'm', metro: 'm', metros: 'm',
}));
const PACK = new Map(Object.entries({
  un: 'un', unid: 'un', unidade: 'un', pacote: 'pct', pct: 'pct', caixa: 'cx', cx: 'cx', lata: 'lata',
  garrafa: 'fr', frasco: 'fr', vidro: 'fr', pote: 'un', saco: 'saco', rolo: 'rolo', duzia: 'dz', dz: 'dz',
  bandeja: 'un', sache: 'un', tubo: 'un', galao: 'gal', fardo: 'un', maco: 'un', cartela: 'un', barra: 'un',
  par: 'par', kit: 'kit', cacho: 'un', copo: 'un', embalagem: 'un', refil: 'un',
}));
const LEAD = new Set(['tenho', 'temos', 'tem', 'sobrou', 'sobraram', 'restam', 'resta', 'chegou', 'chegaram', 'comprei', 'adicionar', 'adiciona', 'colocar', 'coloca', 'coloque', 'por', 'poe', 'comprar', 'compra', 'mais', 'tambem', 'e', 'add', 'quero', 'preciso', 'de']);
const CONNECT = new Set(['de', 'do', 'da', 'dos', 'das']);
const FILLER = new Set(['de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'por', 'cada', 'reais', 'real', 'centavos', 'r$', 'rs', 'x', 'com', 'em', 'pra', 'para']);

const plural = (w) => {
  if (w.endsWith('oes') || w.endsWith('aes')) return w.slice(0, -3) + 'ao';
  if (w.endsWith('ns')) return w.slice(0, -2) + 'm';
  if (w.endsWith('is') && w.length > 4) return w.slice(0, -2) + 'l';
  if (w.endsWith('es') && /[rsz]es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
};
const known = (k) => vocab().has(k) || PACK.has(k) || MEASURE.has(k);

// Desfaz diminutivo e plural só quando o resultado é uma palavra conhecida.
// "latinhas" → "lata", "pacotinhos" → "pacote", "pãozinho" → "pao", "farinha" continua "farinha".
export function dedim(w) {
  const k = norm(w);
  if (known(k)) return k;
  const s = plural(k);
  if (known(s)) return s;
  const cands = [];
  let m = s.match(/^(.+?)zinh[oa]$/);
  if (m) cands.push(m[1], m[1] + 'o', m[1] + 'a', m[1] + 'e');
  m = s.match(/^(.+?)inh[oa]$/) || s.match(/^(.+?)it[oa]$/);
  if (m) {
    const b = m[1];
    const bases = [b, b.replace(/qu$/, 'c').replace(/gu$/, 'g').replace(/c$/, 'ç')];
    for (const x of bases) cands.push(x + 'o', x + 'a', x + 'e', x);
  }
  for (const c of cands) {
    const n = norm(c);
    if (n.length >= 3 && (heads().has(n) || PACK.has(n))) return n;
  }
  return k;
}
const show = (orig, key) => (key === norm(orig) ? orig : vocab().get(key) || orig);

// Preço falado: "12 reais e 90", "5 reais", "5 e 49" (depois de um nome).
function spokenPrices(t) {
  return t
    .replace(/(\d+)\s*reais?\s*(?:e\s*)?(\d{1,2})\s*(?:centavos?)?/gi, (_, a, b) => `${a},${b.padStart(2, '0')}`)
    .replace(/(\d+)\s*reais?\b/gi, (_, a) => `${a},00`)
    .replace(/([a-zà-ú]\s+)(\d+)\s+e\s+(\d{2})\b/gi, (_, w, a, b) => `${w}${a},${b}`)
    .replace(/r\$\s*(\d)/gi, 'R$$$1');
}

// O trecho anterior termina numa quantidade inteira (com ou sem unidade) e este começa com
// "meio"/"meia" sem outra unidade logo depois: é fração da quantidade anterior.
function isFraction(prev, cur) {
  const c = cur.split(/\s+/);
  if (!/^mei[oa]$/.test(norm(c[0]))) return false;
  const p0 = prev.trim().split(/\s+/);
  // "um e meio quilo": o trecho anterior é só o número
  if (p0.length === 1 && (/^\d+$/.test(p0[0]) || WORDS[norm(p0[0])] >= 1)) return true;
  const next = c[1] && dedim(c[1]);
  if (next && (MEASURE.has(next) || PACK.has(next))) return false;
  const p = prev.split(/\s+/);
  let last = norm(p[p.length - 1]);
  if (MEASURE.has(dedim(last)) || PACK.has(dedim(last))) last = norm(p[p.length - 2] || '');
  return /^\d+$/.test(last) || (WORDS[last] != null && WORDS[last] >= 1);
}

const PRICE_ONLY = /^(?:R\$\s*)?\d+[.,]\d{2}$|^R\$\s*\d+$/i;

export function splitItems(text) {
  const parts = spokenPrices(String(text || ''))
    .split(/\s*(?:(?<!\d),|,(?!\d)|[;\n]|(?<!\d)\s+e\s+|\s+e\s+(?!\d)|\s+mais\s+|\s+and\s+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    // "suco bonbon, 9,90": o preço sozinho depois da vírgula pertence ao item anterior.
    if (PRICE_ONLY.test(p) && out.length) {
      out[out.length - 1] += ' ' + p;
      continue;
    }
    // "um quilo e meio de batata": "meio" completa a quantidade anterior.
    // Mas "1,2 quilo e meia dúzia de ovos" são dois itens: depois de "meia" vem outra unidade.
    if (out.length && isFraction(out[out.length - 1], p)) {
      out[out.length - 1] += ' e ' + p;
      continue;
    }
    out.push(p);
  }
  return out;
}

export function parseOne(text) {
  const raw = text.trim();
  let t = ` ${raw} `;
  let price = 0;

  // Preço: "R$ 5", "R$ 5,49", "5,49", "5.49" (dois decimais)
  t = t.replace(/R\$\s*(\d+(?:[.,]\d{1,2})?)/i, (_, v) => {
    price = Math.round(parseFloat(v.replace(',', '.')) * 100);
    return ' ';
  });
  if (!price)
    t = t.replace(/\s(\d+)[.,](\d{2})(?=\s)/, (_, a, b) => {
      price = Number(a) * 100 + Number(b);
      return ' ';
    });

  // "café acabou", "não tem açúcar", "zero de arroz": quantidade zero (usado na contagem do estoque).
  let zero = false;
  t = t.replace(/\s(acabou|acabaram|acabado|acabada|zerou|zerado|zerada|nenhum|nenhuma|zero|faltando)(?=\s)/gi, () => {
    zero = true;
    return ' ';
  });
  t = t.replace(/\s(n[aã]o\s+tem|n[aã]o\s+temos|n[aã]o\s+h[aá]|sem\s+nada\s+de)(?=\s)/gi, () => {
    zero = true;
    return ' ';
  });

  // Separa número colado em letra: "1,2kg" → "1,2 kg", "2x" → "2 x", "x2" → "x 2"
  t = t.replace(/(\d)([a-zà-ú])/gi, '$1 $2').replace(/\bx(\d)/gi, 'x $1');
  let toks = t.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && LEAD.has(norm(toks[0]))) toks.shift();

  const isNum = (s) => /^\d+([.,]\d+)?$/.test(s);
  let qty = null;
  let unit = null;
  let measure = false;
  let qi = -1;
  if (toks.length > 1 && WORDS[norm(toks[0])] != null) qi = 0;
  else qi = toks.findIndex(isNum);
  if (qi >= 0) {
    qty = isNum(toks[qi]) ? parseFloat(toks[qi].replace(',', '.')) : WORDS[norm(toks[qi])];
    const rm = new Set([qi]);
    let j = qi + 1;
    if (toks[j] && norm(toks[j]) === 'x') rm.add(j++);
    if (qi > 0 && norm(toks[qi - 1]) === 'x') rm.add(qi - 1);
    // "um e meio quilo"
    if (Number.isInteger(qty) && toks[j] && norm(toks[j]) === 'e' && /^mei[oa]$/.test(norm(toks[j + 1] || ''))) {
      qty += 0.5;
      rm.add(j).add(j + 1);
      j += 2;
    }
    const nx = toks[j] && dedim(toks[j]);
    if (nx && (MEASURE.has(nx) || PACK.has(nx))) {
      measure = MEASURE.has(nx);
      unit = MEASURE.get(nx) || PACK.get(nx);
      rm.add(j);
      // "um quilo e meio"
      if (Number.isInteger(qty) && toks[j + 1] && norm(toks[j + 1]) === 'e' && /^mei[oa]$/.test(norm(toks[j + 2] || ''))) {
        qty += 0.5;
        rm.add(j + 1).add(j + 2);
      }
    }
    toks = toks.filter((_, i) => !rm.has(i));
  } else if (toks.length > 1) {
    // "pacote de café", "latinha de coca": embalagem sem número = 1
    const first = dedim(toks[0]);
    if (PACK.has(first)) {
      unit = PACK.get(first);
      qty = 1;
      toks.shift();
    }
  }
  if (unit === 'g') {
    qty = qty / 1000;
    unit = 'kg';
  }
  if (unit === 'ml') {
    qty = qty / 1000;
    unit = 'L';
  }
  while (toks.length && CONNECT.has(norm(toks[0]))) toks.shift();
  while (toks.length && FILLER.has(norm(toks[toks.length - 1]))) toks.pop();

  const words = toks.map((w) => ({ w, k: dedim(w) }));
  const matchName = words.filter((x) => !FILLER.has(x.k)).map((x) => x.k).join(' ');
  let p = matchName ? bestMatch(matchName) : null;
  if (!p) {
    const plain = words.filter((x) => !FILLER.has(norm(x.w))).map((x) => norm(x.w)).join(' ');
    if (plain && plain !== matchName) p = bestMatch(plain);
  }
  const display = words.map((x) => (FILLER.has(norm(x.w)) ? x.w.toLowerCase() : show(x.w, x.k))).join(' ');

  if (p) {
    if (unit === 'dz' && p.unit !== 'dz') {
      qty = qty * 12;
      unit = 'un';
    }
    // "coca 2L", "arroz 5kg": medida diferente da do produto descreve a embalagem, não a quantidade.
    if (measure && unit !== p.unit) qty = 1;
    // embalagens contam unidades do produto ("2 caixinhas de leite" = 2 × Leite 1L)
    unit = p.unit;
  }
  return {
    text: raw,
    pid: p?.id || null,
    name: p ? p.name : titleCase(display),
    qty: zero ? 0 : qty ?? 1,
    qtyGiven: zero || qty != null,
    zero,
    unit: unit || 'un',
    price,
    known: !!p,
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function parseMany(text) {
  return splitItems(text).map(parseOne).filter((x) => x.name);
}
