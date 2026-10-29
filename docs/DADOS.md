# Coleções de dados

Os mesmos nomes valem no arquivo local (`data/portal-db.json`, chave `collections`) e no Firestore.
Constantes em `server/store/index.js` (objeto `C`). Datas de calendário em `AAAA-MM-DD`;
instantes em ISO 8601 UTC (a interface converte para São Paulo).

| Coleção | Quem escreve | Conteúdo |
|---|---|---|
| `users` | servidor (dono) | `name, email, role, active, canApprove, createdAt, updatedAt, lastLoginAt` (+ `passwordHash`, `sessionVersion` no modo local). No Firebase, o ID do documento é o `uid` do Auth. |
| `products` | **somente conector UniPlus** | `sku, name, category, basePrice, cost (opcional), stock, unit, syncedAt, source, missingFromUniplus`. ID = `id_produto` do UniPlus. |
| `publicationQueue` | servidor | `productId, productSnapshot{sku,name,category,basePrice,stock,cost}, stage, slug (endereço no site), channels[{id,name,integration,price,promoPrice,feeRule,fee,net,promoFee,promoNet,margin,promoMargin}], promoStart, promoEnd, listings{<canal>:{status,externalId,url,publishedAt,manual,by,needsUpdate,removedAt,removedBy}}, priority, notes, campaignId, content{title,description,seoTitle,seoDescription,category,imageRefs[],siteNotes,brand,pet,siteCategory,measureValue,measureUnit,weightKg,tag,short,specs[{label,value}]}, stageHistory[], requestedBy, approvedBy, createdAt, updatedAt, updatedBy` |
| `campaigns` | servidor | `name, objective, description, start, end, channels[], budget, ownerId, productIds[], products[], status, notes[], approvedBy, createdBy, …` |
| `promotions` | servidor | `name, description, start, end, campaignId, channels[], items[{productId,sku,name,regularPrice,promoPrice}], status, notes[], approvedBy, createdBy, …` |
| `artRequests` | servidor | `title, originType, originId, originName, briefing, format, deadline, priority, assigneeId, status, fileRef, deliveredAt, publications[{channel,at,by,note}], notes[], approvedBy, …` |
| `leads` | servidor | `name, email, phone, source, campaignId, assigneeId, value, interest, status, notes[], …` |
| `orders` | servidor (pedidos do site próprio) | ID `site-<id do site>`: `externalId, number, customer{name,email,phone,cpf}, items[{productId,sku,slug,name,brand,image,measure,unitPrice,qty}], delivery{method,label,price,days,address}, payment{method,status,brand,last4,installments,gateway,gatewayId}, totals{subtotal,couponDiscount,pixDiscount,shipping,total,coupon}, status, timeline[{status,at,by?,note?}], trackingCode, channel, createdAt, syncedAt` (mesmo formato do `Order` do site) |
| `integrations` | servidor | por ID (`uniplus`, `site`, `ga4`, `googleads`, `metaads`, `leads`, `metaleads`): `status, lastSyncAt, lastError, lastErrorAt, itemCount, settings{storeUrl,notes}` |
| `settings` | servidor | `channels` (dono) = `{ items: [{id,name,percent,fixed,fixedBelow,integration,active,note}] }` — sem documento, vale `DEFAULT_CHANNELS`. `catalog` (automático) = `{ generatedAt, items[...] }`: catálogo do site pronto, refeito quando algo do site muda (`services/catalog.js`) |
| `metrics` | servidor | por fonte (`ga4`, `googleads`, `metaads`): `{ period, syncedAt, summary[{key,label,value,format}], table{title,columns,rows} }` |
| `audit` | servidor | `at, actorId, actorName, actorRole, action, entity, entityId, summary, changes{campo:{before,after}}` — nunca editado |

## Estados

Definidos em `public/shared/domain.js`:

- Fila: `selected → preparing → review → approved → published`, mais `blocked` e `archived`.
  `published` é automático quando todos os `listings` estão `done`.
- Anúncio por canal (`listings`): `idle` (falta publicar) ou `done` (publicado). Marketplaces: `manual: true` e
  `needsUpdate: true` quando o dono muda o preço depois de anunciado.
- Arte: `requested → in_progress → awaiting_approval → approved → published`, mais `changes`.
- Campanha: `draft → awaiting_approval → approved → running → done`, mais `cancelled`.
- Promoção: `draft → awaiting_approval → approved` (+ fase calculada: programada/no ar/encerrada), `cancelled`.
- Pedido (igual ao site): `aguardando_pagamento → pago → separando → pronto_retirada | enviado → entregue`, ou `cancelado`.
- Lead: `new, contacted, qualified, won, lost` (livre).
- Integração: `not_connected, awaiting_auth, connected, error`.

## Migrar do modo local para o Firestore

Ainda não há script. Caminho sugerido (ver ROADMAP): ler `data/portal-db.json` e gravar cada
coleção com o `firestore-store.bulkSet`. Usuários precisam ser recriados no Firebase Auth
(senhas scrypt locais não são compatíveis).
