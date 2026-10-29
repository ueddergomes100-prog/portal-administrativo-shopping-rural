# AGENTS.md — guia para agentes (Codex, Claude e outros)

Leia este arquivo inteiro antes de mudar qualquer coisa. Ele é a fonte de verdade sobre como o
projeto está organizado, o que já funciona e o que falta. Detalhes em `docs/`.

## O que é

Portal administrativo do **Shopping Rural** (loja agro/pet/jardinagem). Centraliza:
catálogo e estoque do **UniPlus** → fila de publicação de produtos na **Nuvemshop** →
campanhas, promoções, pedidos de arte, leads e indicadores de mídia. Interface 100% em pt-BR,
datas no fuso `America/Sao_Paulo`, moeda BRL.

## Regras que não podem ser quebradas

1. **UniPlus é a fonte** de SKU, estoque e preço-base. O portal nunca edita esses campos;
   só o conector (`server/integrations/uniplus.js`) grava em `products`.
2. **Nada é publicado de mentira.** "Publicado na Nuvemshop" só depois da resposta de sucesso da
   API. Sem credenciais → erro claro, item continua "Aprovado", tentativa registrada.
3. **Sem dados fictícios** em telas que se dizem conectadas. Sem integração → estado vazio
   explicando o que configurar. (O único dado fictício é `scripts/mock-uniplus.js`, só para dev.)
4. **Toda escrita passa pela API** (`server/router.js` → `server/services/*`). O navegador nunca
   escreve no Firestore (regras em `firebase/firestore.rules` bloqueiam tudo).
5. **Papel vem do banco**, nunca do navegador. Permissões são checadas no servidor.
6. **Toda ação importante gera auditoria** (`server/audit.js`) com quem, quando, o quê e antes/depois.
7. **Sem Firebase Storage.** Fotos e artes ficam em `media/` na máquina da loja; o portal guarda só
   o caminho relativo. `media/`, `data/`, `.env` e chaves de serviço **nunca** vão para o Git.
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
  media.js                    pasta media/: listar, validar caminho, ler imagem p/ Nuvemshop
  store/                      armazenamento plugável: json-store.js (local) | firestore-store.js
  services/                   regras de negócio: queue, marketing (campanhas/promoções/artes/leads),
                              products, users, orders, integrations, dashboard
  integrations/               uniplus.js (sincronização), nuvemshop.js (publicação e pedidos)
connector/uniplus-sync.js     conector para a máquina da loja quando o portal está na Vercel
public/
  index.html                  casca da aplicação
  assets/styles.css           identidade visual completa (tokens no topo)
  shared/domain.js            papéis, etapas, transições — usado por servidor E navegador
  js/app.js                   rotas (#/area/id), navegação, delegação de eventos
  js/api.js, js/auth.js       cliente da API e sessão
  js/ui.js                    componentes (tag "brinco", botões, campos, gaveta, modal, toast)
  js/views/*.js               uma tela por arquivo
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
- Catálogo do UniPlus sincronizado (intervalo configurável), busca, filtros, paginação.
- Fila de publicação completa: seleção pelo dono (preço UniPlus ou do site, promoção com período,
  prioridade, campanha, observação) → preparação pelo site (título, descrição, SEO, categoria,
  fotos de `media/`) → aprovação (dono/gerente autorizado) → publicação na Nuvemshop com
  registro de erro e nova tentativa. Bloquear, arquivar, pedir ajustes com motivo.
- Campanhas (com produtos), promoções (preço por produto, aprovação, fase pelas datas),
  pedidos de arte (origem campanha/promoção/produto, entrega com arquivo, aprovação, registro de
  canais), leads (etapas, valor, comentários), pedidos importados da Nuvemshop.
- Painel "Sua vez" por papel, trilha de publicação, integrações com estado real, histórico com diff.

## O que falta — ver `docs/ROADMAP.md` (ordem sugerida)

Testar Nuvemshop com a loja real; atualizar produto já publicado (preço/estoque); webhooks de
pedidos; GA4/Google Ads/Meta Ads (só estrutura hoje); anexar promoção à Nuvemshop; deploy Vercel.

## Antes de entregar uma mudança

1. `npm run check` e `npm test` passando.
2. Testar no navegador o fluxo afetado com o papel certo (dono, gerente, marketing, site).
3. Atualizar `docs/` se mudou rota, coleção, variável de ambiente ou fluxo.
4. Commits pequenos e descritivos, em português.
