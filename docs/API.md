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
| POST | `/queue` | aprovador | seleciona produto: `{productId, priceMode:'erp'|'custom', sitePrice?, promoPrice?, promoStart?, promoEnd?, priority, notes, campaignId}` |
| GET | `/queue/:id` | todos | item + `mediaCheck` (fotos existem em media/?) |
| PATCH | `/queue/:id/pricing` | aprovador | mesmos campos de preço/prioridade/campanha |
| PATCH | `/queue/:id/content` | site | `{title, description, seoTitle, seoDescription, category, imageRefs[], siteNotes}` — muda "Selecionado" para "Em preparação" |
| POST | `/queue/:id/transition` | conforme `QUEUE_TRANSITIONS` | `{to, note?}` — "review" exige título, descrição ≥ 30 e foto; ajustes/bloqueio exigem `note` |
| POST | `/queue/:id/publish` | site, dono | publica na Nuvemshop. Sem credenciais: 400 com `details.code = NOT_CONFIGURED` |

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
- **promotions**: `name, description, start, end, campaignId, items[{productId, promoPrice}]` (preço normal vem do UniPlus)
- **arts**: `title, originType ('campaign'|'promotion'|'product'), originId, briefing, format, deadline, priority, assigneeId`
- **leads**: `name, email, phone, source, campaignId, assigneeId, value, interest, status`

## Pedidos, integrações, histórico, arquivos

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/orders` | todos | `{connected, orders}` |
| POST | `/orders/sync` | dono, gerente, site | importa pedidos recentes da Nuvemshop |
| GET | `/integrations` | todos | estado real + nomes das variáveis que faltam (nunca valores) |
| PATCH | `/integrations/:id` | dono, gerente | preferências não secretas (`storeUrl`, `notes`) |
| GET | `/audit?entity&entityId&limit` | dono/gerente (completo); todos com `entityId` | histórico |
| GET | `/media?search` | todos | arquivos em `media/` (só no servidor da loja) |
