# Zelo

Estoque de casa e listas de compras compartilhadas, para mercado, itens de casa e construção. O que você compra entra no estoque, os preços ficam guardados por local, e duas ou mais pessoas podem usar a mesma lista ao mesmo tempo, inclusive sem internet.

Segue a mesma base técnica e visual do Pago: arquivos estáticos (HTML, CSS e módulos JavaScript), sem etapa de build, instalável como PWA, com dados cifrados no aparelho e sincronização opcional pelo Firebase.

---

## Estrutura

```
index.html              casca do app
manifest.webmanifest    instalação como PWA
sw.js                   service worker (funciona offline)
css/app.css             estilos (tokens do Pago + componentes do Zelo)
icons/                  ícones
js/
  main.js               inicialização, navegação, modo demo, ações globais
  state.js              estado de sessão e preferências do aparelho
  firebase-config.js    configuração do Firebase (preencher)
  lib/                  relógio, utilitários, IndexedDB, criptografia, relógio lógico (HLC)
  core/
    store.js            registros cifrados, junção campo a campo, conflitos
    sync.js             Firebase: login, casa compartilhada, sincronização, presença, catálogo
    catalog.js          catálogo base (mercado, casa, construção), busca
    domain.js           estoque, consumo, preços, listas, concluir compra
    parse.js            digitação rápida ("2 leite 5,49")
    voice.js            ditado pelo reconhecimento de voz do navegador
    presence.js         quem está em qual lista e item
    demo.js             dados do modo demo e a pessoa simulada
    data.js             backup e CSV
  ui/                   componentes, teclado numérico, seletor A–Z, gráficos, vibração
  views/                telas
firestore.rules         regras de segurança do Firestore
firestore.indexes.json  índice usado na limpeza de exclusões
firebase.json           configuração para o Firebase CLI (regras e, se quiser, Hosting)
tests/parse.test.mjs    testes da digitação rápida e da voz (node tests/parse.test.mjs)
```

---

## Experimentar antes de configurar o Firebase

Abra o app e toque em **Experimentar o modo demo** (ou, depois, em Ajustes, Modo demo). Ele cria uma casa separada, só neste navegador, com:

- 90 dias de compras fictícias em quatro locais, com preços variando;
- estoque com essenciais, alguns acabando;
- uma lista aberta já começada no mercado e uma lista de construção;
- a **Ana**, uma segunda pessoa simulada. Com **Ana comprando junto** marcado, ela marca itens, põe preços e adiciona coisas na lista em que você estiver. O avatar dela aparece no topo da lista e "Ana editando" aparece no item em que ela está.

**Microfone simulado:** no painel de adicionar itens, a opção "Demo: simular permissão do microfone concedida" libera o botão de voz sem pedir permissão. Segurando o botão, a demo "ouve" frases de exemplo (com a animação, o cancelamento ao arrastar para cima e a vibração), e ao soltar os itens entram na lista.

**Simular conflito**, na barra do demo, mostra os dois casos de edição ao mesmo tempo:

1. Depois de você pôr um preço, a Ana muda o mesmo preço. Aparece o aviso "Ana mudou o preço… Manter o meu / Ficar com…".
2. Sem edição recente, o botão fica de prontidão: abra o preço de um item e comece a digitar. A Ana muda o mesmo preço; o teclado avisa na hora, e ao salvar o Zelo pergunta qual valor fica.

Nada do demo vai para a nuvem e os dados reais não são tocados.

---

## Rodar localmente

O app precisa ser servido por HTTP, porque módulos JS e o service worker não funcionam abrindo o arquivo direto:

```bash
python3 -m http.server 8080
# ou
npx serve .
```

Abra `http://localhost:8080`.

O navegador só libera a criptografia, o service worker e a instalação em conexões seguras (HTTPS ou `localhost`). Para abrir no celular durante o desenvolvimento:

- **Túnel HTTPS:** `cloudflared tunnel --url http://localhost:8080` e abra o endereço `https://…trycloudflare.com`. Para o login com Google, adicione esse domínio aos domínios autorizados do Firebase.
- **Android com cabo USB:** no Chrome do computador, `chrome://inspect`, Port forwarding de `8080` para `localhost:8080`.
- **Publicado:** GitHub Pages ou Firebase Hosting já são HTTPS (veja abaixo).

---

## Configurar o Firebase (sincronização e compra compartilhada)

### 1. Criar o projeto
Em https://console.firebase.google.com, **Adicionar projeto**. O Analytics não é necessário.

### 2. Login com Google
**Authentication**, **Começar**, **Sign-in method**, ative **Google**. Em **Configurações**, **Domínios autorizados**, adicione os domínios onde o app vai rodar (`localhost` já vem; inclua `seu-usuario.github.io` ou `seu-projeto.web.app`).

### 3. Firestore
**Firestore Database**, **Criar banco de dados**, região próxima (por exemplo `southamerica-east1`, São Paulo), **modo de produção**.

### 4. Registrar o app Web e colar a configuração
**Configurações do projeto**, **Seus apps**, app **Web** (`</>`). Copie só os valores do `firebaseConfig` para `js/firebase-config.js`:

```js
export const cloudConfig = {
  apiKey: '...',
  authDomain: 'seu-projeto.firebaseapp.com',
  projectId: 'seu-projeto',
  storageBucket: 'seu-projeto.appspot.com',
  messagingSenderId: '...',
  appId: '...',
};
```

Não copie as linhas `import { initializeApp } …` nem `const app = initializeApp(…)`: o Zelo carrega o Firebase sozinho. Esses valores não são secretos; quem protege os dados são as regras e a criptografia.

### 5. Publicar regras e índice

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # escolha o projeto
firebase deploy --only firestore
```

Sem o CLI: cole `firestore.rules` em **Firestore, Regras** e crie em **Índices** um índice composto na coleção `records` com `del` (crescente) e `ts` (crescente). Sem o índice o app funciona; só a limpeza de exclusões antigas no servidor fica parada.

**Importante:** as regras do Zelo são diferentes das do Pago (compare-and-swap, presença e catálogo). Se usar o mesmo projeto Firebase dos dois apps, junte os dois arquivos de regras com cuidado, ou use um projeto para cada app (recomendado).

### 6. Usar
- **Primeiro aparelho:** **Entrar com Google**, **Criar uma casa**, defina a senha da casa.
- **Outra pessoa:** em Ajustes, **Convidar pessoa** mostra QR Code, código e link. Ela entra com a conta Google dela e a senha da casa, que você passa por outro canal.
- **Começou em "só neste dispositivo"?** Em Ajustes, **Conectar conta Google**; os dados locais sobem para a nuvem.

---

## Publicar

**Firebase Hosting** (mesmo projeto): `firebase deploy` publica o app em `https://seu-projeto.web.app`.

**GitHub Pages:** suba a pasta para um repositório, **Settings, Pages, Deploy from a branch**, `main`, `/ (root)`, e adicione `seu-usuario.github.io` aos domínios autorizados. Os caminhos são relativos, então funciona em subpastas.

Instalar no celular: Android (Chrome), menu ⋮, **Instalar app**; iPhone (Safari), Compartilhar, **Adicionar à Tela de Início**.

**Atualizações:** aumente `VERSION` em `sw.js` e `app.version` em `js/main.js`. O app mostra "Nova versão disponível" e atualiza com um toque. `js/firebase-config.js` é sempre buscado na rede primeiro.

---

## Como funciona

### Lista de compras (uso com uma mão)
- **Embaixo, no alcance do polegar:** Faltam / Carrinho / Todos, a ordem (por seção, A–Z, mais caros, adicionados por último) e o botão de adicionar.
- **Cada item:** círculo grande para pôr no carrinho; o preço é um botão que abre o teclado numérico do app (o teclado do celular nunca aparece). Com "Pedir o preço ao marcar" ligado, marcar um item sem preço já abre o teclado.
- **Navegar:** chips das seções no topo e seletor lateral A–Z (tocar ou arrastar o dedo).
- **Comparação de preço ao lado do nome:** ▲ mais caro ou ▼ mais barato que a última compra (na mesma loja, se houver histórico nela), = mesmo preço, ★ menor preço já pago. O teclado mostra a frase completa: última compra, onde, quando e o menor preço.
- **Itens por peso (açougue, frios, hortifruti):** o teclado tem duas formas de informar o preço. **Preço por kg**, ou **Total da etiqueta** com o peso real da bandeja; nesse caso o Zelo calcula o preço por kg (R$ 20,00 ÷ 0,5 kg = R$ 40,00/kg) e mostra na lista "0,5 kg · R$ 40,00/kg". O total da etiqueta é o valor que entra na compra, sem arredondamentos, e o preço por kg é o que vai para o histórico e para as comparações. No açougue o padrão é o total da etiqueta; no resto, o preço por kg. O app lembra a última escolha em cada seção. Na digitação rápida e na voz vale a mesma regra: "carne moída 0,5 kg 20 reais" entra como R$ 20,00 no total.
- **Local da compra:** escolhido na lista, salvo junto com cada preço. Um local pode guardar a localização para ser detectado depois.
- **Pagamento:** quantas formas quiser (Pix, débito, crédito, dinheiro, VA, VR, outro), cada uma com o seu valor, e o app mostra quanto falta ou passou do total.
- **Concluir compra:** os itens do carrinho entram no estoque e no histórico de preços. O que ficou de fora vai para uma lista nova, fica na mesma ou é descartado.

### Adicionar itens
- **Digitação rápida:** "2 leite 5,49", "banana 1,2kg 6,99", "pão, café e 3 detergentes", "meia dúzia de ovos", "um quilo e meio de batata". Enter adiciona e o campo continua pronto para o próximo.
- **Diminutivos e embalagens:** "dois pacotinhos de queijo ralado", "três cervejinhas", "uma caixinha de leite", "um vidrinho de palmito". O diminutivo só é desfeito quando o resultado é uma palavra conhecida do catálogo, então "farinha", "sardinha" e "galinha" continuam como estão. Embalagens (pacote, lata, caixa, garrafa, vidro, pote, saco…) contam unidades do produto; medidas diferentes da do produto ("coca 2L", "arroz 5kg") descrevem a embalagem.
- **Testes:** `node tests/parse.test.mjs` confere dezenas de frases, inclusive todas as frases de exemplo do modo demo. Rode depois de mexer em `parse.js` ou no catálogo.
- **Preço no fim, depois de vírgula:** "duas latinhas de suco bonbon, 9,90" leva o preço para o item. O valor é entendido como preço de cada unidade.
- **Produto que não existe no catálogo:** vira um produto da casa, com seção sugerida pela primeira palavra conhecida ("Suco bonbon" vai para Bebidas). Ele sincroniza com quem participa e aparece na busca, no estoque e nos preços nas próximas vezes. A prévia marca esses itens como "novo", e dá para renomear ou mudar a seção em Ajustes, Produtos.
- **Voz:** um botão largo, embaixo do campo de digitação. **Segure para falar e solte para adicionar**; arrastar o dedo para cima antes de soltar cancela. Enquanto o microfone não estiver liberado, o botão fica cinza com o motivo escrito ("Toque para permitir o microfone", "Microfone negado…", "Microfone bloqueado nesta página"); tocar nele pede a permissão. Usa o reconhecimento do próprio navegador, sem IA do Zelo: funciona no Chrome e no Safari (no Chrome, o áudio vai para o Google e costuma exigir internet; o Firefox não tem o recurso). Pode ser desligado em Ajustes, e o idioma escolhido (português ou inglês); o português já entende termos como shampoo, bacon e cream cheese. Preços falados como "12 reais e 90" são entendidos. Páginas incorporadas em outras (como a demo publicada no Claude) não recebem o microfone; abra o Zelo pelo próprio endereço.
- **Vibração:** ao marcar itens, adicionar, começar e parar de ouvir, cancelar e em conflitos. No Android usa a vibração do navegador; no iPhone (iOS 18 ou mais novo) usa o toque tátil do sistema por meio de um interruptor invisível, um toque por evento. Pode ser desligada em Ajustes.
- **Sugestões:** essenciais acabando e o que você mais compra. **Seções** e **A–Z**, por mercado, casa ou construção.

### Estoque
- A quantidade não é um número gravado: é a soma de movimentos (compra, uso, perda e contagem). Movimentos só são acrescentados, então duas pessoas mexendo no estoque ao mesmo tempo nunca entram em conflito.
- **Usei** (o botão − em cada item), **Contei** (substitui a quantidade calculada), **Entrou** (compra fora de uma lista) e **Na lista**.
- **Essenciais:** marque o que não pode faltar e defina o mínimo. A tela de essenciais separa Acabou, Acabando e Em dia, e o botão Pôr na lista repõe tudo de uma vez.
- **Gráficos:** pequenos em cada item (últimos 30 dias) e, no detalhe, a quantidade em 60 dias com a linha do mínimo, saídas por semana, uso por dia, de quanto em quanto tempo você compra e a previsão de quando acaba.

### Preços
Histórico por produto (gráfico com uma cor por local), média, menor e última compra, comparação por local e um ranking de onde sai mais barato.

### Catálogo
Cerca de 440 produtos de mercado, casa e construção vêm embutidos no app, com apelidos (inclusive em inglês) para a busca e a voz. Com a nuvem ativa, o catálogo é publicado na coleção `catalog` do Firestore; uma versão mais nova na nuvem substitui a embutida sem precisar publicar o app de novo. Produtos criados por você ficam na sua casa, cifrados, e sincronizam com quem participa.

---

## Sincronização e conflitos

- **Offline primeiro:** tudo é gravado no IndexedDB e numa fila de envio, que sobe ao reconectar. O app funciona inteiro sem internet depois da primeira abertura.
- **Junção por campo:** cada campo de cada registro guarda a própria versão (Hybrid Logical Clock). Quando duas versões do mesmo item se encontram, cada campo fica com a versão mais nova daquele campo. Se uma pessoa marca o item e a outra põe o preço, as duas alterações ficam. A junção não depende da ordem de chegada: todos os aparelhos convergem para o mesmo resultado.
- **Compare-and-swap no servidor:** cada envio leva a versão do servidor em que se baseou. As regras recusam a gravação se alguém tiver gravado antes; o aparelho baixa a versão nova, junta campo a campo e envia de novo. Nenhuma gravação atrasada apaga outra.
- **Mesmo campo, ao mesmo tempo:** cada campo também guarda qual versão ele substituiu. Se a outra pessoa mudou o mesmo campo sem ter visto a sua alteração, vence a mais recente, e quem perdeu recebe um aviso com "Manter o meu" ou "Ficar com…". Uma alteração feita depois de ver a sua não gera aviso: é só uma mudança.
- **Durante a edição:** o teclado mostra na hora se a outra pessoa mudou o item; ao salvar, se as duas mexeram no mesmo campo, o Zelo pergunta qual valor fica.
- **Presença:** com a conexão estável, cada aparelho publica em que lista e item está (só ids aleatórios). A lista mostra quem está nela, e o item mostra "Ana editando", para evitar o conflito antes que ele aconteça.
- **Concluir a compra em dois celulares** não duplica estoque nem preços: os movimentos e preços usam ids derivados do item.
- **Exclusões** viram tombstones e são limpas quando todos já sincronizaram e passaram 30 dias, como no Pago.

## Segurança
Igual ao Pago: os registros são cifrados no aparelho com AES-256-GCM, com uma chave da casa protegida pela senha (PBKDF2-SHA256, 600 mil iterações). O servidor guarda só conteúdo cifrado e metadados. A presença e o catálogo base não são cifrados porque não têm dados pessoais (a presença tem apenas ids aleatórios). A senha não pode ser recuperada: faça backups em Ajustes, Dados.

## Licenças de terceiros
- `js/vendor/qrcode.js`: QR Code Generator for JavaScript, de Kazuhiko Arase, licença MIT.
- `js/vendor/jsqr.js`: jsQR, de Cosmo Wolfe, licença Apache 2.0.
