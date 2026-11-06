// Catálogo base de produtos.
// Vem embutido no app, para funcionar offline desde o primeiro uso, e pode ser publicado e
// atualizado na nuvem (coleção catalog do Firestore). Produtos criados pelo usuário ficam à parte,
// como registros cifrados do espaço (tipo 'prod').
//
// Formato de cada item: "Nome[@unidade][~apelido1,apelido2]". Os apelidos ajudam a busca, a digitação
// rápida e a voz, inclusive com termos em inglês comuns no mercado.
import { norm } from '../lib/util.js';

export const CATALOG_VERSION = 5;

export const DOMAINS = [
  { id: 'mercado', name: 'Mercado', color: '#5FE3B5' },
  { id: 'casa', name: 'Casa', color: '#7C8CFF' },
  { id: 'construcao', name: 'Construção', color: '#F2C14E' },
];

const BASE = {
  mercado: [
    ['hortifruti', 'Hortifruti', 'kg', 'Banana prata;Banana nanica;Maçã gala;Maçã fuji;Laranja pera;Limão taiti;Mamão formosa;Mamão papaia@un;Abacaxi@un;Melancia@un;Melão@un;Uva@kg;Morango@cx;Manga palmer;Abacate;Pera;Kiwi;Tomate;Tomate cereja@cx~cherry;Cebola;Cebola roxa;Alho@kg;Batata;Batata doce;Mandioca~aipim,macaxeira;Cenoura;Beterraba;Abobrinha;Abóbora cabotiá;Chuchu;Pepino;Pimentão verde;Pimentão vermelho;Berinjela;Brócolis@un;Couve-flor@un;Repolho@un;Alface crespa@un;Alface americana@un~iceberg;Rúcula@un;Couve@un;Espinafre@un;Cheiro-verde@un~salsinha,cebolinha;Coentro@un;Hortelã@un;Gengibre;Ovos brancos@dz;Ovos vermelhos@dz;Cogumelo champignon@cx~mushroom'],
    ['padaria', 'Padaria', 'un', 'Pão francês@kg~pao,pao de sal,cacetinho;Pão de forma@pct;Pão integral@pct;Pão de hambúrguer@pct~burger bun;Pão de hot dog@pct;Pão sírio@pct~pita;Bisnaguinha@pct;Torrada@pct;Bolo@un;Croissant@un;Pão de queijo congelado@pct;Wrap@pct~tortilla'],
    ['acougue', 'Açougue e peixaria', 'kg', 'Carne moída;Patinho;Alcatra;Contrafilé;Picanha;Fraldinha;Acém;Músculo;Costela bovina;Cupim;Peito de frango;Filé de peito de frango;Coxa e sobrecoxa;Asa de frango;Frango inteiro;Linguiça toscana;Linguiça calabresa;Bisteca suína;Lombo suíno;Pernil suíno;Bacon@pct;Filé de tilápia;Salmão;Merluza;Camarão;Sardinha fresca'],
    ['frios', 'Frios e laticínios', 'un', 'Leite integral 1L@cx~leite;Leite desnatado 1L@cx;Leite semidesnatado 1L@cx;Leite sem lactose 1L@cx~lactose free;Leite condensado@lata;Creme de leite@cx~heavy cream;Manteiga@un~butter;Margarina@un;Requeijão@un~cream cheese;Cream cheese@un;Iogurte natural@un~yogurt;Iogurte grego@un~greek yogurt;Bebida láctea@un;Queijo mussarela@kg~mozzarella;Queijo prato@kg;Queijo parmesão@un~parmesan;Queijo ralado@pct~parmesão ralado;Queijo minas frescal@un;Queijo coalho@pct;Ricota@un;Presunto@kg~ham;Peito de peru@kg~turkey;Mortadela@kg;Salame@pct;Salsicha@kg~hot dog;Nata@un;Leite fermentado@pct;Petit suisse@pct'],
    ['mercearia', 'Mercearia', 'un', 'Açúcar refinado@pct~acucar;Açúcar cristal@pct;Açúcar mascavo@pct;Adoçante@fr;Sal refinado@pct;Sal grosso@pct;Farinha de trigo@pct~flour;Farinha de mandioca@pct~farofa;Farinha de milho@pct;Fubá@pct;Amido de milho@cx~maizena;Fermento biológico@pct;Fermento químico@lata;Gelatina@cx;Mistura para bolo@cx~cake mix;Granola@pct;Aveia@pct~oats;Leite em pó@lata;Mel@fr~honey;Geleia@fr~jam;Pasta de amendoim@fr~peanut butter;Achocolatado em pó@lata;Creme de avelã@fr~nutella'],
    ['graos', 'Grãos e cereais', 'kg', 'Arroz branco 5kg@pct~arroz;Arroz integral@pct;Arroz parboilizado@pct;Feijão carioca@pct~feijao;Feijão preto@pct;Lentilha@pct;Grão-de-bico@pct~chickpea;Milho de pipoca@pct~popcorn;Quinoa@pct;Chia@pct;Cereal matinal@cx~sucrilhos,corn flakes'],
    ['massas', 'Massas e molhos', 'un', 'Macarrão espaguete@pct~spaghetti;Macarrão parafuso@pct;Macarrão penne@pct;Lasanha@pct;Macarrão instantâneo@pct~miojo,lamen;Nhoque@pct;Molho de tomate@un~extrato;Extrato de tomate@un;Molho pesto@fr;Molho shoyu@fr~soy sauce;Ketchup@fr;Mostarda@fr~mustard;Maionese@fr~mayo;Molho barbecue@fr~bbq;Molho inglês@fr~worcestershire;Molho de pimenta@fr~hot sauce'],
    ['enlatados', 'Enlatados e conservas', 'lata', 'Milho verde;Ervilha;Seleta de legumes;Atum~tuna;Sardinha em lata;Azeitona@fr~olives;Palmito@fr;Pepino em conserva@fr~pickles;Champignon em conserva@fr;Feijoada pronta;Cogumelo em conserva@fr'],
    ['temperos', 'Temperos e condimentos', 'un', 'Pimenta-do-reino@pct~black pepper;Orégano@pct;Colorau@pct~paprica;Páprica defumada@pct~paprika;Cominho@pct;Canela@pct~cinnamon;Louro@pct;Caldo de galinha@cx~knorr;Caldo de carne@cx;Tempero pronto@pct~sazon;Alho triturado@fr;Vinagre@fr~vinegar;Noz-moscada@pct;Curry@pct;Ervas finas@pct'],
    ['oleos', 'Óleos e azeites', 'fr', 'Óleo de soja~oleo;Óleo de girassol;Azeite de oliva~olive oil;Óleo de coco;Spray de azeite~spray'],
    ['cafe', 'Café, chá e achocolatado', 'pct', 'Café em pó~cafe,café;Café em grãos~coffee beans;Café em cápsula@cx~capsula,nespresso,dolce gusto;Café solúvel@fr~nescafe;Chá mate@cx;Chá de camomila@cx~tea;Chá verde@cx~green tea;Filtro de café@cx~filtro papel;Achocolatado líquido@un~toddynho'],
    ['doces', 'Doces e biscoitos', 'pct', 'Biscoito cream cracker~bolacha;Biscoito maisena;Biscoito recheado~cookies,bolacha recheada;Cookies~cookie;Wafer;Chocolate em barra@un~chocolate;Bombom@cx;Doce de leite@un;Paçoca@un;Bala~candy;Chiclete~chewing gum;Sorvete@un~ice cream;Barra de cereal@cx~cereal bar'],
    ['snacks', 'Snacks', 'pct', 'Batata chips~chips,ruffles;Salgadinho~doritos;Amendoim;Castanha de caju~cashew;Mix de castanhas~mix nuts;Pipoca de micro-ondas~popcorn;Torradinha'],
    ['bebidas', 'Bebidas', 'un', 'Água mineral 1,5L@fr~agua;Água com gás@fr~sparkling water;Galão de água 20L@gal;Refrigerante 2L@fr~coca,guarana,soda;Refrigerante lata@lata;Suco de caixa 1L@cx~juice;Suco em lata@lata;Suco concentrado@fr;Água de coco@cx~coconut water;Chá gelado@fr~ice tea;Energético@lata~energy drink;Isotônico@fr~gatorade'],
    ['alcool', 'Bebidas alcoólicas', 'un', 'Cerveja lata~beer;Cerveja long neck;Vinho tinto@fr~wine;Vinho branco@fr;Espumante@fr~prosecco;Cachaça@fr;Vodka@fr;Gin@fr;Whisky@fr'],
    ['congelados', 'Congelados', 'pct', 'Batata frita congelada~french fries;Pizza congelada@un~pizza;Lasanha congelada@un;Hambúrguer congelado@cx~burger;Nuggets~nugget;Polpa de fruta;Legumes congelados;Açaí@un;Gelo@saco~ice'],
    ['bebe', 'Bebê', 'un', 'Fralda descartável@pct~fralda,diaper;Lenço umedecido@pct~wipes;Pomada para assadura;Fórmula infantil@lata;Papinha;Shampoo infantil@fr~baby shampoo'],
    ['pet', 'Pet', 'un', 'Ração para cães@kg~racao,dog food;Ração para gatos@kg~cat food;Sachê para gatos~sache;Areia para gatos@saco~cat litter;Petisco para cães@pct~snack pet;Tapete higiênico@pct'],
  ],
  casa: [
    ['limpeza', 'Limpeza', 'un', 'Detergente@fr~lava-louças,dish soap;Água sanitária@fr~candida,qboa,cloro;Desinfetante@fr~pinho;Limpador multiuso@fr~veja,multiuso;Limpa-vidros@fr~glass cleaner;Álcool 70%@fr~alcool;Álcool em gel@fr~gel;Sabão em barra@pct;Esponja de cozinha@pct~sponge;Esponja de aço@pct~bombril;Pano de chão@un;Pano multiuso@pct~perfex;Saco de lixo 50L@pct~lixo;Saco de lixo 100L@pct;Luva de borracha@par;Lustra-móveis@fr~pledge;Tira-limo@fr;Limpador de banheiro@fr~harpic;Pedra sanitária@un;Desengordurante@fr~degreaser;Inseticida@fr~raid,spray;Vassoura@un;Rodo@un;Pá de lixo@un'],
    ['lavanderia', 'Lavanderia', 'un', 'Sabão em pó@cx~omo,ariel;Sabão líquido@fr~liquid detergent;Amaciante@fr~downy,comfort;Alvejante sem cloro@fr~vanish;Tira-manchas@fr;Prendedor de roupa@pct;Cabide@pct'],
    ['higiene', 'Higiene pessoal', 'un', 'Papel higiênico@pct~toilet paper;Sabonete em barra@un~soap;Sabonete líquido@fr~body wash;Shampoo@fr;Condicionador@fr~conditioner;Creme para pentear@fr~leave-in;Desodorante@un~antitranspirante;Pasta de dente@un~creme dental,toothpaste;Escova de dente@un~toothbrush;Fio dental@un~floss;Enxaguante bucal@fr~listerine,mouthwash;Aparelho de barbear@pct~gilette,razor;Espuma de barbear@un~shaving foam;Absorvente@pct~pad;Protetor solar@fr~sunscreen;Hidratante@fr~body lotion;Algodão@pct;Hastes flexíveis@pct~cotonete;Lenço de papel@cx~kleenex'],
    ['papel', 'Papel e descartáveis', 'un', 'Papel toalha@pct~paper towel;Guardanapo@pct~napkin;Papel-alumínio@rolo~foil;Filme plástico@rolo~plastic wrap;Papel-manteiga@rolo;Saco zip@cx~ziploc;Copo descartável@pct;Prato descartável@pct;Talher descartável@pct;Palito de dente@cx'],
    ['cozinha', 'Cozinha e utensílios', 'un', 'Pano de prato@un;Pote hermético@un~tupperware;Forma de silicone@un;Filtro de água (refil)@un~refil;Fósforo@cx~matches;Vela@pct;Gás de cozinha (botijão)@un~gas,botijao,glp'],
    ['banheiro', 'Banheiro', 'un', 'Cortina de box@un;Tapete de banheiro@un;Escova sanitária@un;Desentupidor@un'],
    ['eletricos', 'Pilhas e lâmpadas', 'un', 'Pilha AA@pct~battery;Pilha AAA@pct;Bateria 9V@un;Lâmpada LED@un~led bulb;Extensão@un~extension cord;Benjamim@un~adaptador'],
    ['farmacia', 'Farmácia', 'un', 'Analgésico@cx~dipirona,paracetamol;Antitérmico@cx;Antialérgico@cx;Curativo@cx~band-aid;Termômetro@un;Soro fisiológico@fr~saline;Vitamina C@fr~vitamin;Repelente@fr~off,repellent;Máscara descartável@cx~mask'],
  ],
  construcao: [
    ['ferragens', 'Ferragens', 'pct', 'Parafuso 4x40~screw;Parafuso drywall;Bucha 6mm~bucha;Bucha 8mm;Prego 17x21~nail;Arruela~washer;Porca~nut;Dobradiça@par~hinge;Fechadura@un~lock;Cadeado@un~padlock;Puxador@un~handle;Gancho@un~hook;Abraçadeira@pct~cable tie,enforca-gato;Corrente@m~chain;Arame@kg~wire'],
    ['eletrica', 'Elétrica', 'un', 'Fio 2,5mm@m~cabo,wire;Fio 1,5mm@m;Tomada@un~outlet;Interruptor@un~switch;Disjuntor@un~breaker;Fita isolante@rolo~electrical tape;Conector Wago@pct~wago;Eletroduto@m~conduite;Plafon LED@un~luminaria;Caixa 4x2@un'],
    ['hidraulica', 'Hidráulica', 'un', 'Cano PVC 25mm@m~pipe;Cano PVC 50mm@m;Joelho PVC@un~elbow;Luva PVC@un;Tê PVC@un;Registro@un~valve;Torneira@un~faucet;Sifão@un;Engate flexível@un;Veda-rosca@rolo~teflon;Cola PVC@un~tigre;Chuveiro@un~shower;Resistência de chuveiro@un;Boia de caixa d’água@un'],
    ['tintas', 'Tintas e acabamento', 'un', 'Tinta acrílica 18L@gal~paint,suvinil,coral;Tinta acrílica 3,6L@gal;Tinta esmalte@lata~enamel;Massa corrida@gal~spackle;Selador@gal~primer;Rolo de pintura@un~roller;Pincel@un~brush;Fita crepe@rolo~masking tape;Lixa@un~sandpaper;Solvente (thinner)@fr~aguarras,thinner;Lona plástica@m;Silicone@un~silicone;Espuma expansiva@un~foam;Rejunte@kg~grout;Verniz@lata~varnish'],
    ['ferramentas', 'Ferramentas', 'un', 'Broca 6mm~drill bit;Broca 8mm;Disco de corte@un~cutting disc;Trena@un~tape measure;Nível@un~level;Chave de fenda@un~screwdriver;Chave Phillips@un;Alicate@un~pliers;Martelo@un~hammer;Estilete@un~cutter;Lâmina de estilete@pct;Serra@un~saw;Escada@un~ladder;Pá@un~shovel;Carrinho de mão@un'],
    ['obra', 'Cimento e argamassa', 'saco', 'Cimento 50kg~cement;Argamassa AC-I~mortar;Argamassa AC-III;Areia média@m2~sand;Brita@m2~gravel;Cal hidratada;Gesso~plaster;Tijolo@un~brick;Bloco de concreto@un;Piso cerâmico@m2~tile,porcelanato;Rodapé@m'],
    ['jardim', 'Jardinagem', 'un', 'Terra vegetal@saco~soil;Adubo@kg~fertilizer;Vaso@un~pot;Mangueira@m~hose;Esguicho@un;Semente@pct~seeds;Tesoura de poda@un'],
    ['epi', 'Segurança (EPI)', 'un', 'Luva de proteção@par~gloves;Óculos de proteção@un~goggles;Máscara PFF2@un~n95;Protetor auricular@par;Bota de segurança@par'],
  ],
};

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Monta a lista plana de produtos a partir das seções.
export function buildCatalog(domains = BASE) {
  const products = [];
  const sections = [];
  const seen = new Set();
  for (const dom of DOMAINS) {
    for (const [sid, sname, unit, list] of domains[dom.id] || []) {
      sections.push({ id: sid, name: sname, domain: dom.id });
      for (const raw of list.split(';')) {
        const t = raw.trim();
        if (!t) continue;
        const [left, aliasPart] = t.split('~');
        const [name, u] = left.split('@');
        let id = 'c_' + slug(name);
        while (seen.has(id)) id += '-2';
        seen.add(id);
        products.push({
          id,
          name: name.trim(),
          unit: (u || unit).trim(),
          section: sid,
          domain: dom.id,
          aliases: aliasPart ? aliasPart.split(',').map((a) => a.trim()).filter(Boolean) : [],
          base: true,
        });
      }
    }
  }
  return { products, sections };
}

let built = buildCatalog();
let builtVersion = CATALOG_VERSION;
let extra = []; // produtos do usuário (tipo 'prod')
let index = null;
let vocabMap = null;
let headSet = null;

export const catalogVersion = () => builtVersion;
export const rawDomains = () => BASE;

// Substitui o catálogo base por uma versão mais nova vinda da nuvem.
export function useCloudCatalog(domains, v) {
  try {
    built = buildCatalog(domains);
    builtVersion = v;
    index = null;
    vocabMap = null;
    headSet = null;
  } catch {
    /* mantém o embutido */
  }
}

export function setUserProducts(list) {
  extra = list;
  index = null;
  vocabMap = null;
  headSet = null;
}

export const sections = () => [...built.sections, { id: 'outros', name: 'Outros', domain: 'mercado' }];
export const sectionName = (id) => sections().find((s) => s.id === id)?.name || 'Outros';
export const sectionOrder = (id) => {
  const i = sections().findIndex((s) => s.id === id);
  return i < 0 ? 999 : i;
};
export const domainOf = (sectionId) => sections().find((s) => s.id === sectionId)?.domain || 'mercado';
export const domainName = (id) => DOMAINS.find((d) => d.id === id)?.name || '';

export function allProducts() {
  return [...built.products, ...extra.map((p) => ({ ...p, base: false }))];
}

export function product(pid) {
  if (!index) buildIndex();
  return index.byId.get(pid) || null;
}

function buildIndex() {
  const all = allProducts();
  const byId = new Map(all.map((p) => [p.id, p]));
  const terms = all.map((p) => ({ p, keys: [norm(p.name), ...p.aliases.map(norm)] }));
  index = { byId, terms };
}

// Busca tolerante: começo de palavra pesa mais; apelidos (inclusive em inglês) contam.
export function search(q, limit = 30) {
  if (!index) buildIndex();
  const n = norm(q);
  if (!n) return [];
  const words = n.split(' ');
  const out = [];
  for (const { p, keys } of index.terms) {
    let best = 0;
    for (const k of keys) {
      let s = 0;
      if (k === n) s = 100;
      else if (k.startsWith(n)) s = 80;
      else if (words.every((w) => k.split(/[\s-]/).some((kw) => kw.startsWith(w)))) s = 60;
      else if (k.includes(n)) s = 40;
      else if (words.every((w) => k.includes(w))) s = 25;
      if (s && k !== keys[0]) s -= 5; // nome principal antes do apelido
      best = Math.max(best, s);
    }
    if (best) out.push({ p, s: best - p.name.length / 100 });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p);
}

// Melhor correspondência para texto livre (digitação rápida ou voz). Singular/plural simples.
export function bestMatch(text) {
  const n = norm(text);
  if (!n) return null;
  const tries = [n, n.replace(/s\b/g, ''), n.replace(/oes\b/g, 'ao').replace(/aes\b/g, 'ao').replace(/is\b/g, 'l')];
  for (const t of tries) {
    const r = search(t, 1)[0];
    if (r) {
      const k = norm(r.name);
      const ali = r.aliases.map(norm);
      if (k === t || ali.includes(t) || k.startsWith(t) || t.split(' ').every((w) => k.includes(w))) return r;
    }
  }
  return null;
}

// Palavras conhecidas do catálogo (sem acento → como se escreve), para desfazer diminutivos
// ("pãozinho" → "pão", "cervejinha" → "cerveja") sem estragar palavras como "farinha" ou "sardinha".
export function vocab() {
  if (vocabMap) return vocabMap;
  vocabMap = new Map();
  for (const p of allProducts())
    for (const phrase of [p.name, ...p.aliases])
      for (const w of String(phrase).toLowerCase().split(/[\s,()/-]+/)) {
        const k = norm(w);
        if (k.length >= 3 && /^[a-z]+$/.test(k) && !vocabMap.has(k)) vocabMap.set(k, w);
      }
  return vocabMap;
}

// Seção provável para um produto novo, pela primeira palavra conhecida ("suco bonbon" → Bebidas).
export function guessSection(name) {
  for (const w of norm(name).split(' ')) {
    if (w.length < 3) continue;
    const r = search(w, 1)[0];
    if (r && norm(r.name).split(/[\s-]/).some((x) => x.startsWith(w))) return r.section;
  }
  return 'outros';
}

// Primeiras palavras dos nomes ("queijo", "cerveja", "pão"): só elas valem como base de um diminutivo,
// para "galinha" não virar "gala".
export function heads() {
  if (headSet) return headSet;
  headSet = new Set();
  for (const p of allProducts()) for (const phrase of [p.name, ...p.aliases]) headSet.add(norm(String(phrase).split(/[\s,()/-]+/)[0]));
  return headSet;
}
