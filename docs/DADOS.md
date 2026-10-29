# Coleções de dados

Os mesmos nomes valem no arquivo local (`data/portal-db.json`, chave `collections`) e no Firestore.
Constantes em `server/store/index.js` (objeto `C`). Datas de calendário em `AAAA-MM-DD`;
instantes em ISO 8601 UTC (a interface converte para São Paulo).

| Coleção | Quem escreve | Conteúdo |
|---|---|---|
| `users` | servidor (dono) | `name, email, role, active, canApprove, createdAt, updatedAt, lastLoginAt` (+ `passwordHash`, `sessionVersion` no modo local). No Firebase, o ID do documento é o `uid` do Auth. |
| `products` | **somente conector UniPlus** | `sku, name, category, basePrice, stock, unit, syncedAt, source, missingFromUniplus`. ID = `id_produto` do UniPlus. |
| `publicationQueue` | servidor | `productId, productSnapshot{sku,name,category,basePrice,stock}, stage, priceMode, sitePrice, promoPrice, promoStart, promoEnd, priority, notes, campaignId, content{title,description,seoTitle,seoDescription,category,imageRefs[],siteNotes}, publish{status,attempts,lastError,lastAttemptAt,externalId,url,publishedAt,imagesSent,imageWarnings}, stageHistory[], requestedBy, approvedBy, createdAt, updatedAt, updatedBy` |
| `campaigns` | servidor | `name, objective, description, start, end, channels[], budget, ownerId, productIds[], products[], status, notes[], approvedBy, createdBy, …` |
| `promotions` | servidor | `name, description, start, end, campaignId, items[{productId,sku,name,regularPrice,promoPrice}], status, notes[], approvedBy, …` |
| `artRequests` | servidor | `title, originType, originId, originName, briefing, format, deadline, priority, assigneeId, status, fileRef, deliveredAt, publications[{channel,at,by,note}], notes[], approvedBy, …` |
| `leads` | servidor | `name, email, phone, source, campaignId, assigneeId, value, interest, status, notes[], …` |
| `orders` | servidor (importação Nuvemshop) | `externalId, number, customer, email, total, paymentStatus, shippingStatus, status, createdAt, items[], source, syncedAt` |
| `integrations` | servidor | por ID (`uniplus`, `nuvemshop`, `ga4`, `googleads`, `metaads`): `status, lastSyncAt, lastError, lastErrorAt, itemCount, settings{storeUrl,notes}` |
| `audit` | servidor | `at, actorId, actorName, actorRole, action, entity, entityId, summary, changes{campo:{before,after}}` — nunca editado |

## Estados

Definidos em `public/shared/domain.js`:

- Fila: `selected → preparing → review → approved → published`, mais `blocked` e `archived`.
- Arte: `requested → in_progress → awaiting_approval → approved → published`, mais `changes`.
- Campanha: `draft → awaiting_approval → approved → running → done`, mais `cancelled`.
- Promoção: `draft → awaiting_approval → approved` (+ fase calculada: programada/no ar/encerrada), `cancelled`.
- Lead: `new, contacted, qualified, won, lost` (livre).
- Integração: `not_connected, awaiting_auth, connected, error`.

## Migrar do modo local para o Firestore

Ainda não há script. Caminho sugerido (ver ROADMAP): ler `data/portal-db.json` e gravar cada
coleção com o `firestore-store.bulkSet`. Usuários precisam ser recriados no Firebase Auth
(senhas scrypt locais não são compatíveis).
