# API do portal

Base: `/api`. JSON em ambos os sentidos. Autenticação: `Authorization: Bearer <token>`
(token da sessão local ou ID token do Firebase). Erros: `{ "error": "mensagem em pt-BR", "details"?: {...} }`
com status 400 (validação), 401 (sessão), 403 (papel), 404, 409 (conflito), 429 (tentativas), 500.

Fonte: `server/router.js`. Regras: `server/services/*`. Papéis: `owner`, `manager`, `marketing`, `site`.
"Aprovador" = dono ou gerente com `canApprove: true`.

## Público

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | Servidor no ar e modo de dados |
| GET | `/config` | `backend`, `needsSetup`, `mediaAvailable`, configuração pública do Firebase |
| POST | `/auth/setup` | (local) cria o primeiro dono — só funciona sem usuários. `{name,email,password}` → `{token,user}` |
| POST | `/auth/login` | (local) `{email,password}` → `{token,user}`. 6 erros em 10 min bloqueiam |

## Sessão e equipe

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/auth/me` | todos | pessoa logada |
| GET | `/dashboard` | todos | trilha, "Sua vez" por papel, contagens, integrações, últimas ações (dono/gerente) |
| GET | `/users` | todos | dono/gerente: lista completa; demais: diretório mínimo (id, nome, papel) |
| POST | `/users` | dono | `{name,email,role,password,canApprove?}` (no Firebase cria a conta no Auth) |
| PATCH | `/users/:id` | dono; a própria pessoa (nome/senha) | `{name?,role?,active?,canApprove?,password?}` — impede remover o último dono ativo |

## Catálogo (UniPlus)

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/products?search&filter&category&page&pageSize` | todos | `filter`: `not_selected`, `in_queue`, `in_stock`, `stockout`, `missing` |
| GET | `/products/:id` | todos | um produto |
| POST | `/products/sync` | dono, gerente | sincroniza agora (só no servidor da loja) |
| POST | `/connector/uniplus/catalog` | conector (`CONNECTOR_TOKEN`) | `{items:[...]}` no formato do UniPlus ou já mapeado |

## Fila de publicação

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/queue?stage` | todos | itens com `transitions` e `can` calculados para quem pede |
| POST | `/queue` | aprovador | coloca à venda: `{productId, channels:[{id, price, promoPrice?}], promoStart?, promoEnd?, priority, notes, campaignId}` — servidor calcula `fee`, `net`, `margin` por canal |
| GET | `/queue/:id` | todos | item + `mediaCheck` (fotos existem em media/?) |
| PATCH | `/queue/:id/pricing` | aprovador | mesmos campos (canais, preços, prioridade, campanha) |
| PATCH | `/queue/:id/content` | site | `{title, description, seoTitle, seoDescription, category, imageRefs[], siteNotes}` — muda "Selecionado" para "Em preparação" |
| POST | `/queue/:id/transition` | conforme `QUEUE_TRANSITIONS` | `{to, note?}` — "review" exige título, descrição ≥ 30 e foto; ajustes/bloqueio exigem `note` |
| POST | `/queue/:id/site` | site, dono | publica no catálogo do site próprio (gera `slug` e link) |
| POST | `/queue/:id/listings/:channel` | site, dono | registra anúncio feito à mão em marketplace: `{url (https), externalId?, note?}` |
| DELETE | `/queue/:id/listings/:channel` | site, dono | tira do site / desfaz registro do marketplace |

## Site próprio (contrato completo em docs/SITE.md)

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/catalog` e `/store/catalog` | público (CORS por `STORE_ALLOWED_ORIGINS`) | `{ products }` no formato `Product` do site |
| POST | `/catalog/stock-check` e `/store/catalog/stock-check` | público | `[{ productId, requested, available }]` |
| GET | `/store/catalog/:slug` | público | um produto |
| GET | `/store/images/<caminho>` | público | foto de produto publicado |
| POST | `/store/orders` | `STORE_API_TOKEN` | cria/atualiza pedido (`Order` do site) |
| GET | `/store/orders/:id` | `STORE_API_TOKEN` | pedido com andamento atual (para o site) |
| PATCH | `/store/orders/:id` | `STORE_API_TOKEN` | `{ status?, payment? }` vindo do gateway |
| POST | `/store/contact`, `/store/newsletter`, `/store/restock-alerts` | `STORE_API_TOKEN` | viram leads |

Erros dessas rotas trazem `message` (campo que o site lê) além de `error`.

## Canais e taxas

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/settings/channels` | todos | canais com `percent`, `fixed`, `fixedBelow`, `integration`, `active` |
| PUT | `/settings/channels` | dono | `{items:[...]}` substitui a tabela (auditado) |

## Indicadores e entrada de leads

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/metrics` | todos | último resumo guardado de `ga4`, `googleads`, `metaads` |
| POST | `/metrics/:source/sync` | dono, gerente, marketing | busca agora no provedor |
| POST | `/leads/inbound` | ferramentas (`LEADS_WEBHOOK_TOKEN`) | cria lead ou comenta no existente (mesmo telefone/e-mail) |
| POST | `/leads/import-meta` | dono, gerente, marketing | importa leads dos formulários do Meta |

## Campanhas, promoções, artes, leads

`:entity` ∈ `campaigns`, `promotions`, `arts`, `leads`.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/:entity?status&campaignId` | lista com `transitions` e `can` |
| POST | `/:entity` | cria (campos em `server/services/marketing.js`, funções `read*`) |
| GET | `/:entity/:id` | um registro |
| PATCH | `/:entity/:id` | edita (promoção aprovada volta a rascunho) |
| DELETE | `/:entity/:id` | dono/gerente; campanha/promoção com artes ligadas não pode |
| POST | `/:entity/:id/transition` | `{to, note?, channels?, channelNote?}` (`channels` ao registrar publicação de arte) |
| POST | `/:entity/:id/notes` | `{text}` comentário |
| PATCH | `/arts/:id/file` | `{fileRef}` caminho relativo dentro de `media/` |

Campos principais:
- **campaigns**: `name, objective, description, start, end, channels[], budget, ownerId, productIds[]` (+ `products[]` com nome/SKU guardados)
- **promotions**: `name, description, start, end, campaignId, channels[], items[{productId, promoPrice}]` (preço normal vem do UniPlus)
- **campaigns/promotions (criação)**: `art: {requested: true, title?, format, deadline, priority, assigneeId, briefing}` cria o pedido de arte ligado; a resposta traz `createdArtId`
- **arts**: `title, originType ('campaign'|'promotion'|'product'), originId, briefing, format, deadline, priority, assigneeId`
- **leads**: `name, email, phone, source, campaignId, assigneeId, value, interest, status`

## Pedidos, integrações, histórico, arquivos

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/orders` | todos | `{connected, orders}` com `transitions` permitidas para quem pede |
| POST | `/orders/:id/move` | dono, gerente, site | `{to, trackingCode?, note?}` — separando, pronto_retirada, enviado (rastreio), entregue, cancelado (motivo) |
| GET | `/integrations` | todos | estado real + nomes das variáveis que faltam (nunca valores) |
| PATCH | `/integrations/:id` | dono, gerente | preferências não secretas (`storeUrl`, `notes`) |
| GET | `/audit?entity&entityId&limit` | dono/gerente (completo); todos com `entityId` | histórico |
| GET | `/media?search` | todos | arquivos em `media/` (só no servidor da loja) |
