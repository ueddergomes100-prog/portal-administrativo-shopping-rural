# AGENTS.md — guia para agentes (Codex, Claude e outros)

Leia este arquivo inteiro antes de mudar qualquer coisa. Ele é a fonte de verdade sobre como o
projeto está organizado, o que já funciona e o que falta. Detalhes em `docs/`.

## O que é

Portal administrativo do **Shopping Rural** (loja agro/pet/jardinagem). Centraliza:
catálogo e estoque do **UniPlus** → escolha de preço por canal (site próprio, Shopee, Mercado Livre) →
**Anúncios** (fila de publicação) → **catálogo do site próprio** (o site lê do portal e devolve os
pedidos) → campanhas, promoções, pedidos de arte, clientes interessados (leads) e resultados de mídia.
Interface 100% em pt-BR, datas no fuso `America/Sao_Paulo`, moeda BRL.

## Quem usa (leia antes de mexer na interface)

A equipe é de **pessoas mais velhas, pouco acostumadas com tecnologia**. Em nov/2026 o dono achou o
portal "muito confuso" e ele foi simplificado. **Não desfaça isso:**

- **Palavras do dia a dia, nunca jargão.** Nomes das telas: Início, Produtos, Anúncios, Pedidos,
  Promoções, Agenda, Campanhas, Artes, Clientes interessados, Resultados e, em **Ajustes**: Taxas de
  venda, Conexões, Equipe, Histórico, Minha conta. Na tela: "código" (não SKU), "título para o Google"
  (não SEO), "cliente interessado" (não lead), "Conexões" (não integrações), "Pedir arte", "Apagar",
  "Guardar" (não arquivar), "Pausar" (não bloquear). Etapas e situações ficam em `shared/domain.js`.
  Termos técnicos (variáveis, tokens, rotas) só dentro de `<details>` "para quem instala o portal".
- **Botão diz o que faz** ("Ver e aprovar", "Mandar para aprovação"); aviso confirma com as mesmas
  palavras; erro diz o que fazer.
- **Menu curto por papel** (`MENU` em `public/js/app.js`): cada pessoa vê só o que usa; o resto fica
  em Ajustes (`views/settings-hub.js`). Tela nova entra no `MENU` do papel certo, não em todos.
- **Início = "Para resolver agora"**: cada pendência é uma frase + o nome do botão que resolve
  (`todo[].title/detail/action`, montados em `server/services/dashboard.js`).
- **Letra grande**: texto base 17 px, nada abaixo de 13 px, botões ≥ 48 px, sem rótulos em caixa alta.
  Há o botão **Letra maior** (aumenta 15%, guardado no aparelho).
- Quadros (Anúncios, Artes) mostram as etapas **uma embaixo da outra**, a que "Precisa de você"
  primeiro. Nada de rolar para o lado.
- Detalhes em `docs/DESIGN.md` → "Simples de usar".

## Onde roda (decisão da loja, out/2026)

Portal na **nuvem** (Vercel + Firestore + Vercel Blob) em `portal.shoppingrural.com`. Na máquina da loja
roda só o **conector** do UniPlus (tarefa do Windows). Site em `shoppingrural.com`. Passo a passo em
`docs/DEPLOY.md`.

Hoje (nov/2026) o projeto da Vercel `portal-shopping-rural` está em **modo demonstração**
(`DATA_BACKEND=demo`, dados fictícios de `server/demo.js`) em `https://portal-shopping-rural.vercel.app`,
usado para apresentar ao dono. Para valer, ele passa a `DATA_BACKEND=firestore` (DEPLOY.md seção 2) —
pergunte ao responsável antes, porque a demonstração deixa de existir nesse link. Cuidado com custo do Firestore: leituras do site passam pelo documento único do
catálogo; o conector grava só diferenças; a lista de produtos (tela Produtos e conferência do conector)
vem de 16 "fatias" em `settings/products-shard-*` (`server/services/product-shards.js`), não da coleção
`products`. **Nunca leia uma coleção inteira por requisição** — em 09/11/2026 isso esgotou a cota grátis
do Firestore e derrubou o portal.

## Como a loja usa o portal (visão do dono)

- **Dono**: vê todo o estoque com preço (e custo, se o UniPlus mandar). Em cada produto clica
  **Colocar à venda** e um pop-up mostra os canais (Site próprio, Shopee, Mercado Livre…). Para
  cada canal ele digita o preço e o portal já desconta a taxa do canal e mostra **quanto recebe**
  e o **lucro** (ex.: Shopee 20% + R$ 6; Mercado Livre 17%). As taxas ficam em **Ajustes → Taxas de venda**.
- **Gerente** (ou dono): pede **promoção** de um produto — preço normal vem do UniPlus, ele
  informa o promocional, as datas, os canais, e no mesmo formulário **pede a arte** com o briefing.
  O marketing recebe o pedido já ligado à promoção e vê quem pediu.
- **Campanhas** são planejadas com antecedência ("daqui 2 semanas", "daqui 1 mês") e aparecem na
  **Agenda** junto com promoções e prazos de arte. Campanha também pode pedir arte junto.
- **Vendas na internet** (papel `site`): prepara fotos, texto e título para o Google dos produtos
  escolhidos, manda para aprovação e coloca à venda depois de aprovado: **Colocar à venda no site**
  põe o produto no catálogo do site próprio; na Shopee e no Mercado Livre anuncia à mão no painel e
  marca **Já anunciei** com o link no portal.
  Numa loja pequena o **dono ou o gerente** fazem tudo isso também (`PREPARERS` em `domain.js`); sem
  ninguém na função "Vendas na internet", as tarefas de preparar aparecem no Início do dono. A ficha do
  anúncio mostra sempre um **"Próximo passo"** com o que fazer e onde está o botão.
- **Marketing**: faz as artes, envia o arquivo, manda para aprovação e avisa onde publicou.
  Acompanha resultados (GA4, Google Ads, Meta) e clientes interessados.
- Tudo amarrado: produto ↔ anúncio ↔ promoção ↔ campanha ↔ arte ↔ cliente interessado.

## Projeto do site (separado)

`C:\Projetos\Site Shopping Rural` (Vite + React, Vercel). **Não altere esse projeto a partir daqui.**
O portal segue os tipos dele: `Product` (`src/data/products.ts`) e `Order` (`src/types/commerce.ts`).
Se o site mudar um campo, ajuste `server/services/store.js`, `SITE_*`/`ORDER_*` em `domain.js` e
`docs/SITE.md` juntos.

## Regras que não podem ser quebradas

1. **UniPlus é a fonte** de SKU, estoque e preço-base. O portal nunca edita esses campos;
   só o conector (`server/integrations/uniplus.js`) grava em `products`.
2. **Nada é publicado de mentira.** Um canal só fica "Publicado" com resposta de sucesso da API ou
   com registro manual explícito (link/código + quem registrou). Sem credenciais → erro claro, item
   continua "Aprovado", tentativa registrada. O item só vira "Publicado" quando TODOS os canais estão.
3. **Sem dados fictícios** em telas que se dizem conectadas. Sem integração → estado vazio
   explicando o que configurar. (Dados fictícios só em `scripts/mock-uniplus.js`, para dev, e em
   `server/demo.js`, que só roda com `DATA_BACKEND=demo` e mostra a faixa "Demonstração".)
4. **Toda escrita passa pela API** (`server/router.js` → `server/services/*`). O navegador nunca
   escreve no Firestore (regras em `firebase/firestore.rules` bloqueiam tudo).
5. **Papel vem do banco**, nunca do navegador. Permissões são checadas no servidor.
6. **Toda ação importante gera auditoria** (`server/audit.js`) com quem, quando, o quê e antes/depois.
7. **Sem Firebase Storage.** Fotos e artes são enviadas pelo portal (`server/files.js`): na nuvem vão
   para o **Vercel Blob** (URL pública); no modo local, para `media/uploads/`. Caminhos antigos em
   `media/` continuam aceitos. `media/`, `data/`, `.env` e chaves de serviço **nunca** vão para o Git.
8. **Segredos só no servidor** (`.env` ou variáveis da Vercel). Nunca no `public/`, nunca no Git.
9. Publicações em canais (WhatsApp, Instagram…) são **registro operacional**: o portal
   não envia nada automaticamente.

## Como rodar

```bash
npm install            # só precisa para DATA_BACKEND=firestore (firebase-admin)
cp .env.example .env   # ajuste UNIPLUS_API_URL etc.
npm start              # http://127.0.0.1:4173
npm run dev            # reinicia ao salvar
npm test               # testes (node:test) — domínio + fluxo completo da API
npm run check          # sintaxe de todos os .js + carga do roteador
```

Sem o UniPlus por perto: `node scripts/mock-uniplus.js` (porta 3999, produtos FICTÍCIOS) e
`UNIPLUS_API_URL=http://127.0.0.1:3999 npm start`.

Primeiro acesso no modo local: a tela pede o cadastro do **dono**. Depois, o dono cadastra a
equipe em **Ajustes → Equipe**.

Para ver com dados de exemplo, sem UniPlus e sem senha: `DATA_BACKEND=demo npm start` (entra
escolhendo o papel; os dados ficam numa pasta temporária).

## Mapa do código

```
server.js                     servidor local (estáticos de public/ + /api)
api/index.js                  mesma API como função serverless da Vercel
server/
  config.js                   lê .env e variáveis (documentadas em .env.example)
  http.js                     erros HTTP, leitura de JSON, validação (clean.*)
  auth.js                     login local (scrypt + token HMAC) e Firebase Auth (ID token)
  audit.js                    histórico imutável com diff antes/depois
  router.js                   TODAS as rotas /api (lista em docs/API.md)
  media.js                    pasta media/: listar, validar caminho, servir fotos do catálogo do site
  files.js                    envio de fotos/artes: Vercel Blob (nuvem) ou media/uploads (local)
  store/                      armazenamento plugável: json-store.js (local) | firestore-store.js
  services/                   regras de negócio: queue (venda por canal), marketing (campanhas/promoções/
                              artes/leads), settings (canais e taxas), metrics (indicadores),
                              leads-inbound (entrada automática), products, users, orders, integrations, dashboard
  integrations/               uniplus.js, analytics.js (GA4, Google Ads, Meta), google-auth.js
  services/store.js           API do site próprio no formato do projeto do site: catálogo, estoque, fotos,
                              pedidos com andamento, avisos -> leads (docs/SITE.md)
  migrations.js               ajustes automáticos de dados antigos na inicialização
  services/catalog.js         catálogo do site em documento único (1 leitura por consulta, cache 30 s)
  services/product-shards.js  lista de produtos em 16 fatias (listar/comparar custa 16 leituras)
connector/uniplus-sync.js     conector da máquina da loja: envia ao portal só os produtos que mudaram
scripts/instalar-conector.ps1 instala o conector como tarefa do Windows (liga com o computador)
public/
  index.html                  casca da aplicação
  assets/styles.css           identidade visual completa (tokens no topo)
  shared/domain.js            papéis, etapas, transições, canais padrão e cálculo de taxa/líquido/margem
                              — usado por servidor E navegador (o mesmo cálculo nos dois lados)
  js/app.js                   rotas (#/area/id), navegação, delegação de eventos
  js/api.js, js/auth.js       cliente da API e sessão
  js/ui.js                    componentes (tag "brinco", botões, campos, gaveta, modal, toast)
  js/views/*.js               uma tela por arquivo; pricing.js = calculadora de preço por canal;
                              common.js = seletor de produtos, pedido de arte junto, comentários
firebase/                     regras e índices do Firestore
tests/                        node:test
docs/                         arquitetura, API, dados, design, deploy, roteiro
```

## Padrões do código

- JavaScript puro com ES modules, **sem build** e sem framework. Node ≥ 22.
- Uma tela = um módulo em `public/js/views/` exportando
  `{ id, title, icon, roles?, load(ctx), render(ctx), open?(ctx, id), enter?(ctx), actions, forms, inputs, changes }`.
  O lugar no menu é definido em `MENU` (`app.js`), por papel. Eventos usam `data-action`,
  `data-form`, `data-input`, `data-change` — veja `app.js`.
- Todo texto vindo do usuário/API passa por `esc()` antes de virar HTML.
- Regras de fluxo novas: primeiro em `public/shared/domain.js`, depois no serviço, depois na tela.
- Toda escrita nova: valide com `clean.*` (server/http.js), cheque papel, chame `audit()`.
- Comentários e mensagens em português, voltados a quem usa ("Informe o preço…", não "invalid input"),
  com as palavras de "Quem usa" acima.
- Visual: use os tokens de `styles.css` (`--pasto-*`, `--brinco`, tons `tone-*`). Status sempre com
  `tag()`/`statusTag()`. Veja `docs/DESIGN.md`.

## Estado atual (o que já funciona)

- Login e-mail/senha (local e Firebase), primeiro dono, equipe com papéis, desativação imediata.
- Catálogo do UniPlus sincronizado (com custo opcional), busca, filtros, paginação; custo e margem só
  para dono/gerente (o servidor remove para os demais).
- **Venda multicanal**: pop-up "Colocar à venda" com preço por canal, taxa, líquido e lucro calculados
  na hora; tabela de taxas editável pelo dono com simulador.
- Anúncios (fila de publicação): Escolhido → Preparando → Esperando aprovação → Aprovado → **À venda**.
  "Colocar à venda no site" entra no catálogo (preço novo vale na hora; "Tirar do site" remove);
  Shopee/ML com link marcado à mão; preço alterado marca "atualizar anúncio". "À venda" quando todos
  os canais concluírem.
- **Cadastro em grade** (`views/catalog-grid.js`, `#/cadastro?ids=…`): marcar vários em Produtos, colar as
  fotos e preencher em cartões, enviar tudo por `POST /api/queue/bulk` (catálogo do site refeito uma vez).
  Rascunho guardado no aparelho (`localStorage`, chave `sr-cadastro-grade`).
- **Categorias do site** (`server/services/categories.js`, tela `#/categorias`): `settings/categories`; o
  catálogo leva `categories` (só as visíveis, na ordem) e esconde produtos de categoria escondida. Apagar
  categoria com produtos exige `moves` (para onde vão). `DEFAULT_SITE_CATEGORIES` é só o ponto de partida.
- **Campanha do site** (`server/services/site-campaign.js`, tela `#/campanha-site`): `settings/site-campaign`,
  uma configuração por tema (Black Friday, Natal, Ano Novo) com janela própria, título, frase, até 6
  destaques e o aviso de oferta. O catálogo leva `campaign` só com a que vale agora (ausente = nunca salvo →
  modo automático do site; `{enabled:false}` = desligado). Não mexe em preço: isso é das Promoções.
- **Promoções por lugar** (`server/services/promotion-channels.js`): itens são anúncios (`queueId`) com
  preço por canal. Aprovar aplica no site via `repriceItem` (guarda o que havia em `item.promotion.previous`);
  Shopee/ML viram `channelTasks` (pending → done; cancelada → undo) mostradas em "Para resolver agora".
  Um anúncio só tem um período de promoção: conflitos bloqueiam a aprovação.
- **Frete e entrega** (`server/services/shipping.js`, tela `#/frete`): regras em `settings/shipping` (motoboy
  em tabelas de preço `zones`: cidades do IBGE + faixas pelo valor da compra `tiers`, pedido mínimo, grátis a
  partir de, prazo — o formato antigo `areas` é convertido ao ler; Correios/Jadlog pelo Melhor Envio; retirada).
  Lista de cidades: `GET /api/shipping/cities?uf=` (IBGE, com a região imediata para "cidades perto"). O site
  cota em `POST /api/store/shipping/quote` (preço e peso sempre do catálogo do portal). Medidas da caixa
  (`heightCm`/`widthCm`/`lengthCm`) no anúncio; em branco, caixa padrão pelo peso.
- **Estúdio de foto** (`public/js/photo-studio.js`, roda no navegador): fundo liso (a cor que domina a
  borda) sai por preenchimento a partir das beiradas — nunca corta o que está dentro do contorno; só
  fundo bagunçado vai para a IA (u2netp), com os buracos fechados depois. Toda foto recortada ganha
  "Desfazer recorte" (refaz inteira, no quadrado padrão) enquanto a página não é recarregada.
- Promoções com canais, líquido por canal e **pedido de arte no mesmo formulário**; campanhas idem.
- Artes (quem pediu, prazo, arquivo, aprovação, canais onde saiu), **Agenda** mensal + próximos 90 dias.
- Clientes interessados (leads): cadastro manual, **webhook de entrada** com deduplicação, importação do Meta Lead Ads.
- Indicadores GA4 / Google Ads / Meta Ads: código pronto (testado com respostas simuladas),
  atualização automática no servidor da loja.
- Pedidos do site próprio: chegam no formato `Order` do site; a equipe move o andamento no portal
  (separando, pronto/enviado com rastreio, entregue) e o site lê de volta. Contato/newsletter/reposição viram leads.
- Início com "Para resolver agora" por papel (frase + botão), números da loja em frase, "Próximos
  dias"; trilha, conexões e últimas ações em "Ver mais detalhes". Histórico com diff. Botão Letra maior.
- Modo demonstração (`DATA_BACKEND=demo`) com entrada por papel, sem senha.

## O que falta — ver `docs/ROADMAP.md` e `docs/INTEGRACOES.md`

Ligar o site próprio (catálogo + pedidos + gateway, ver `docs/SITE.md`); conectar as contas reais
(Google, Meta) e validar; definir a baixa de estoque. **Não** automatizar anúncios na Shopee/ML:
decisão da loja.

## Antes de entregar uma mudança

1. `npm run check` e `npm test` passando.
2. Testar no navegador o fluxo afetado com o papel certo (dono, gerente, marketing, site), também
   em 375 px de largura (celular) e com **Letra maior** ligada: sem rolagem para o lado.
3. Atualizar `docs/` se mudou rota, coleção, variável de ambiente ou fluxo.
4. Commits pequenos e descritivos, em português.
