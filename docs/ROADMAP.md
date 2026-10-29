# Roteiro — próximas etapas

Ordem sugerida. Cada item diz onde mexer e o que significa "pronto".
Passo a passo de cada conta em `docs/INTEGRACOES.md`.

## 0. Conectar as contas e validar ao vivo
- Preencher o `.env` da máquina da loja com UniPlus, Nuvemshop, GA4, Google Ads, Meta e `LEADS_WEBHOOK_TOKEN`.
- Em Integrações, cada uma deve ficar "Conectado". Em Indicadores, "Buscar dados agora".
- Se algum provedor responder diferente do simulado em `tests/integrations.test.js`, ajustar o mapeamento.

## 0.1 Criação automática de anúncios na Shopee e no Mercado Livre
- Onde: `server/integrations/marketplaces.js` → `publishToMarketplace()`.
- Hoje a equipe anuncia no painel e registra o link na fila. Ligar exige coletar no portal:
  categoria do marketplace, atributos obrigatórios, peso/dimensões e fotos (ver INTEGRACOES.md).
- Pronto quando: "Publicar" na ficha cria o anúncio e grava `externalId` e `url`.

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
- Pronto: rota `/api/webhooks/nuvemshop` com HMAC. Falta cadastrar os webhooks na loja.
- Próximo: pedidos de Shopee e Mercado Livre na mesma tela (coluna "canal").

## 4. Indicadores de mídia — evolução
- Pronto: resumo dos últimos 30 dias por fonte (`server/integrations/analytics.js`).
- Próximo: série diária para gráfico, comparação com o período anterior, filtro de período,
  ligação campanha do portal ↔ campanha do Google/Meta (pelo nome ou UTM) para ver custo por campanha.
- Cron na Vercel (`/api/cron/metrics` com `CRON_SECRET`).

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
