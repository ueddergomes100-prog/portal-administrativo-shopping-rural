# Roteiro — próximas etapas

Ordem sugerida. Cada item diz onde mexer e o que significa "pronto".

## 1. Validar a Nuvemshop com a loja real (prioridade alta)
- Onde: `server/integrations/nuvemshop.js`.
- Criar app de parceiro, obter `NUVEMSHOP_STORE_ID` e `NUVEMSHOP_ACCESS_TOKEN`.
- Testar `publishProduct` com produto oculto (`published: false` num primeiro teste), conferir
  campos (`name`, `description`, `variants[].price/promotional_price/stock/sku`, SEO) e imagens.
- Mapear categoria do portal → ID de categoria da Nuvemshop (hoje não é enviada).
- Pronto quando: um item aprovado vira produto na loja com fotos, e o ID/URL aparecem na ficha.

## 2. Manter o produto publicado em dia
- Hoje, depois de "Publicado", mudanças de preço/estoque não vão para a Nuvemshop
  (`updatePricing` recusa itens publicados).
- Criar ação "Atualizar na Nuvemshop" (PUT em `/products/{id}/variants/{variant_id}`) e, no conector,
  sincronizar estoque do UniPlus para produtos publicados.
- Promoções aprovadas (`promotions`) → aplicar `promotional_price` nas datas (tarefa agendada).

## 3. Pedidos em tempo real
- Webhook `order/created` e `order/updated` da Nuvemshop → nova rota pública assinada
  (validar HMAC) que grava em `orders`.

## 4. Indicadores de mídia (GA4, Google Ads, Meta Ads)
- Hoje: só estado e variáveis faltando (`server/services/integrations.js`, tela `media-metrics.js`).
- GA4: Data API (`runReport`) com conta de serviço. Ads: Google Ads API (GAQL). Meta: Marketing API
  (`/act_{id}/insights`). Criar `server/integrations/{ga4,googleads,metaads}.js`, gravar resumo
  diário em uma coleção `metrics` e mostrar na tela. Marcar `IMPLEMENTED` em integrations.js.
- Leads do Meta (Lead Ads) → `leads` com `source: 'Meta Ads'`.

## 5. Imagens com o portal na Vercel
- O conector local (`connector/uniplus-sync.js`) pode também processar uma fila de "publicar imagens"
  lendo `media/` e enviando à Nuvemshop. Assim a publicação feita da nuvem fica completa.

## 6. Qualidade e operação
- Script de migração `data/portal-db.json` → Firestore (ver docs/DADOS.md).
- Notificações (e-mail) quando algo entra em "Sua vez".
- Tema escuro (tokens já centralizados em `:root`).
- Paginação/consulta no servidor para `audit` e `leads` quando o volume crescer.
- Catálogo grande no Firestore: hoje a lista de produtos lê a coleção inteira com cache de 60 s
  (`services/products.js`). Acima de ~5 mil produtos, mover busca para índice dedicado.
- Testes de interface (Playwright) para os fluxos por papel.
