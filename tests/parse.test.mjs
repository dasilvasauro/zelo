// Testes da digitação rápida e da voz. Rode com:  node tests/parse.test.mjs
// Cada caso: frase → itens esperados [quantidade, unidade, nome, preço em centavos, existe no catálogo].
import { parseMany } from '../js/core/parse.js';
import { SAMPLES } from '../js/core/voice.js';

const CASES = [
  ['2 leite 5,49', [[2, 'cx', 'Leite Integral 1L', 549, true]]],
  ['banana 1,2kg 6,99', [[1.2, 'kg', 'Banana Prata', 699, true]]],
  ['3x detergente, pão e café', [[3, 'fr', 'Detergente', 0, true], [1, 'kg', 'Pão Francês', 0, true], [1, 'pct', 'Café em Pó', 0, true]]],
  ['dois shampoos por 12 reais e 90', [[2, 'fr', 'Shampoo', 1290, true]]],
  ['arroz 27,90', [[1, 'pct', 'Arroz Branco 5kg', 2790, true]]],
  ['meia dúzia de ovos', [[0.5, 'dz', 'Ovos Brancos', 0, true]]],
  ['500g queijo mussarela', [[0.5, 'kg', 'Queijo Mussarela', 0, true]]],
  ['papel higiênico R$ 22,90', [[1, 'pct', 'Papel Higiênico', 2290, true]]],
  ['coca 2L', [[1, 'fr', 'Refrigerante 2L', 0, true]]],
  ['leite 5 e 49', [[1, 'cx', 'Leite Integral 1L', 549, true]]],
  ['dois pacotinhos de queijo ralado', [[2, 'pct', 'Queijo Ralado', 0, true]]],
  ['duas latinhas de suco bonbon, 9,90', [[2, 'lata', 'Suco Bonbon', 990, false]]],
  ['três cervejinhas 3,49', [[3, 'un', 'Cerveja Lata', 349, true]]],
  ['uma caixinha de leite', [[1, 'cx', 'Leite Integral 1L', 0, true]]],
  ['um quilo e meio de batata', [[1.5, 'kg', 'Batata', 0, true]]],
  ['um e meio quilo de batata', [[1.5, 'kg', 'Batata', 0, true]]],
  ['2 quilos e meio de tomate', [[2.5, 'kg', 'Tomate', 0, true]]],
  ['banana 1,2 quilo e meia dúzia de ovos', [[1.2, 'kg', 'Banana Prata', 0, true], [0.5, 'dz', 'Ovos Brancos', 0, true]]],
  ['arroz e meia dúzia de ovos', [[1, 'pct', 'Arroz Branco 5kg', 0, true], [0.5, 'dz', 'Ovos Brancos', 0, true]]],
  ['um quilo de carne moída e meio quilo de bacon', [[1, 'kg', 'Carne Moída', 0, true], [1, 'pct', 'Bacon', 0, true]]],
  ['galinha caipira', [[1, 'un', 'Galinha Caipira', 0, false]]],
  ['farinha', [[1, 'pct', 'Farinha de Trigo', 0, true]]],
  ['vinho tinto', [[1, 'fr', 'Vinho Tinto', 0, true]]],
  ['biscoito oreo 3', [[3, 'un', 'Biscoito Oreo', 0, false]]],
  ['tenho 6 leites', [[6, 'cx', 'Leite Integral 1L', 0, true]]],
  ['café acabou', [[0, 'pct', 'Café em Pó', 0, true]]],
  ['carne moída 0,5 kg 20 reais', [[0.5, 'kg', 'Carne Moída', 2000, true]]],
  ['meio quilo de carne moída, 20 reais', [[0.5, 'kg', 'Carne Moída', 2000, true]]],
];

let fail = 0;
const fmt = (r) => JSON.stringify(r.map((x) => [x.qty, x.unit, x.name, x.price, x.known]));
for (const [text, want] of CASES) {
  const got = fmt(parseMany(text));
  if (got !== JSON.stringify(want)) {
    fail++;
    console.log(`FALHOU  ${text}\n  esperado ${JSON.stringify(want)}\n  obtido   ${got}`);
  }
}
// A limpeza de repetições da fala.
import { cleanTranscript, joinResults } from '../js/core/voice.js';
const R = (...a) => a.map((t) => [{ transcript: t }]);
for (const [got, want] of [
  [joinResults(R('meio quilo', 'meio quilo de', 'meio quilo de patinho')), 'meio quilo de patinho'],
  [joinResults(R('meio quilo de', 'de patinho')), 'meio quilo de patinho'],
  [cleanTranscript('biscoito oreo biscoito oreo e leite leite'), 'biscoito oreo e leite'],
]) if (got !== want) { fail++; console.log(`FALHOU  voz: "${got}" ≠ "${want}"`); }

// As frases de exemplo do modo demo não podem gerar produto "novo" nem item vazio.
for (const s of SAMPLES) {
  const r = parseMany(s);
  const bad = r.filter((x) => !x.known && !/bonbon/i.test(x.name));
  if (!r.length || bad.length) {
    fail++;
    console.log(`FALHOU  amostra da demo: ${s}\n  obtido   ${fmt(r)}`);
  }
}
console.log(fail ? `\n${fail} caso(s) falharam` : `OK: ${CASES.length} casos e ${SAMPLES.length} amostras da demo`);
process.exit(fail ? 1 : 0);
