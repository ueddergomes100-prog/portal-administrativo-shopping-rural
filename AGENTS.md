# AGENTS.md — guia para agentes (Codex, Claude e outros)

Leia este arquivo inteiro antes de mudar qualquer coisa. Ele é a fonte de verdade sobre como o
projeto está organizado, o que já funciona e o que falta. Detalhes em `docs/`.

## O que é

Portal administrativo do **Shopping Rural** (loja agro/pet/jardinagem). Centraliza:
catálogo e estoque do **UniPlus** → escolha de preço por canal (site próprio, Shopee, Mercado Livre) →
fila de publicação → **catálogo do site próprio** (o site lê do portal e devolve os pedidos) →
campanhas, promoções, pedidos de arte, leads e indicadores de mídia. Interface 100% em pt-BR,
datas no fuso `America/Sao_Paulo`, moeda BRL.

## Onde roda (decisão da loja, out/2026)

Portal na **nuvem** (Vercel + Firestore + Vercel Blob) em `portal.shoppingrural.com`. Na máquina da loja
roda só o **conector** do UniPlus (tarefa do Windows). Site em `shoppingrural.com`. Passo a passo em
`docs/DEPLOY.md`. Cuidado com custo do Firestore: leituras do site passam pelo documento único do
catálogo; o conector grava só diferenças. Não volte a ler coleções inteiras por visita do site.

## Como a loja usa o portal (visão do dono)

- **Dono**: vê todo o estoque com preço (e custo, se o UniPlus mandar). Em cada produto clica
  **Colocar à venda** e um pop-up mostra os canais (Site próprio, Shopee, Mercado Livre…). Para
  cada canal ele digita o preço e o portal já desconta a taxa do canal e mostra o **valor líquido**
  e o **lucro** (ex.: Shopee 20% + R$ 6; Mercado Livre 17%). As taxas ficam em **Canais e taxas**.
- **Gerente** (ou dono): pede **promoção** de um produto — preço normal vem do UniPlus, ele
  informa o promocional, as datas, os canais, e no mesmo formulário **pede a arte** com o briefing.
  O marketing recebe o pedido já ligado à promoção e vê quem pediu.
- **Campanhas** são planejadas com antecedência ("daqui 2 semanas", "daqui 1 mês") e aparecem na
  **Agenda** junto com promoções e prazos de arte. Campanha também pode pedir arte junto.
- **Site**: prepara foto/descrição/SEO dos produtos escolhidos, envia para aprovação e publica em cada
  canal depois de aprovado: **Publicar no site** coloca o produto no catálogo do site próprio;
  na Shopee e no Mercado Livre ele anuncia à mão no painel e **registra o link** no portal.
- **Marketing**: cria as artes, indica o arquivo em `media/`, entrega para aprovação e registra onde
  publicou. Acompanha indicadores (GA4, Google Ads, Meta) e leads.
- Tudo amarrado: produto ↔ fila de venda ↔ promoção ↔ campanha ↔ arte ↔ leads.

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
   explicando o que configurar. (O único dado fictício é `scripts/mock-uniplus.js`, só para dev.)
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
equipe em **Equipe e acessos**.

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
  `{ id, title, icon, group, roles?, load(ctx), render(ctx), open?(ctx, id), enter?(ctx), actions, forms, inputs, changes }`.
  Eventos usam `data-action`, `data-form`, `data-input`, `data-change` — veja `app.js`.
- Todo texto vindo do usuário/API passa por `esc()` antes de virar HTML.
- Regras de fluxo novas: primeiro em `public/shared/domain.js`, depois no serviço, depois na tela.
- Toda escrita nova: valide com `clean.*` (server/http.js), cheque papel, chame `audit()`.
- Comentários e mensagens em português, voltados a quem usa ("Informe o preço…", não "invalid input").
- Visual: use os tokens de `styles.css` (`--pasto-*`, `--brinco`, tons `tone-*`). Status sempre com
  `tag()`/`statusTag()`. Veja `docs/DESIGN.md`.

## Estado atual (o que já funciona)

- Login e-mail/senha (local e Firebase), primeiro dono, equipe com papéis, desativação imediata.
- Catálogo do UniPlus sincronizado (com custo opcional), busca, filtros, paginação; custo e margem só
  para dono/gerente (o servidor remove para os demais).
- **Venda multicanal**: pop-up "Colocar à venda" com preço por canal, taxa, líquido e lucro calculados
  na hora; tabela de taxas editável pelo dono com simulador.
- Fila de publicação: preparação → aprovação → **Publicar no site** (entra no catálogo; preço novo vale na hora;
  "Tirar do site" remove) e Shopee/ML com link registrado; preço alterado marca "atualizar anúncio".
  "Publicado" quando todos os canais concluírem.
- Promoções com canais, líquido por canal e **pedido de arte no mesmo formulário**; campanhas idem.
- Artes (quem pediu, prazo, arquivo, aprovação, canais onde saiu), **Agenda** mensal + próximos 90 dias.
- Leads: cadastro manual, **webhook de entrada** com deduplicação, importação do Meta Lead Ads.
- Indicadores GA4 / Google Ads / Meta Ads: código pronto (testado com respostas simuladas),
  atualização automática no servidor da loja.
- Pedidos do site próprio: chegam no formato `Order` do site; a equipe move o andamento no portal
  (separando, pronto/enviado com rastreio, entregue) e o site lê de volta. Contato/newsletter/reposição viram leads.
- Painel "Sua vez" por papel, trilha, "Vem por aí", integrações com estado real, histórico com diff.

## O que falta — ver `docs/ROADMAP.md` e `docs/INTEGRACOES.md`

Ligar o site próprio (catálogo + pedidos + gateway, ver `docs/SITE.md`); conectar as contas reais
(Google, Meta) e validar; definir a baixa de estoque. **Não** automatizar anúncios na Shopee/ML:
decisão da loja.

## Antes de entregar uma mudança

1. `npm run check` e `npm test` passando.
2. Testar no navegador o fluxo afetado com o papel certo (dono, gerente, marketing, site).
3. Atualizar `docs/` se mudou rota, coleção, variável de ambiente ou fluxo.
4. Commits pequenos e descritivos, em português.
