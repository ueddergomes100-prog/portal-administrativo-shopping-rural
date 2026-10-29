# Integrações — o que está pronto e como ligar

Regra geral: credenciais **só** no servidor (`.env` na máquina da loja ou variáveis da Vercel).
Depois de preencher, reinicie o portal e confira em **Integrações** (status e variáveis que faltam).

| Integração | Código | Situação | Como testar |
|---|---|---|---|
| UniPlus | `server/integrations/uniplus.js` | Pronto (lê `/api/erp/products`) | Sincronizar agora em Produtos |
| Nuvemshop — produtos | `server/integrations/nuvemshop.js` | Pronto, **não testado na loja real** | Publicar um item aprovado (canal Site) |
| Nuvemshop — pedidos | idem + `services/orders.js` | Importação manual + webhook assinado | Pedidos → Importar; webhook `order/created` |
| Shopee | `server/integrations/marketplaces.js` | Assinatura pronta; criação de anúncio **a ligar** | Hoje: registrar anúncio feito à mão |
| Mercado Livre | idem | Chamada autenticada pronta; criação **a ligar** | Hoje: registrar anúncio feito à mão |
| Google Analytics 4 | `server/integrations/analytics.js` | Pronto, testado com respostas simuladas | Indicadores → Buscar dados agora |
| Google Ads | idem | Pronto, testado com respostas simuladas | idem |
| Meta Ads | idem | Pronto, testado com respostas simuladas | idem |
| Meta Lead Ads | idem + `services/leads-inbound.js` | Pronto | Indicadores → Importar leads do Meta |
| Entrada de leads (webhook) | `services/leads-inbound.js` | Pronto e testado | `POST /api/leads/inbound` |

Os testes em `tests/integrations.test.js` simulam as respostas de cada API. Ao ligar uma conta real,
se o provedor responder diferente, o erro aparece em Integrações com a mensagem original — ajuste
o mapeamento na função correspondente e acrescente o caso ao teste.

---

## UniPlus
- `UNIPLUS_API_URL=http://127.0.0.1:3001` (API local que já existe na máquina da loja).
- Se a API usar outros nomes de campo, ajuste só `mapProduct()` em `uniplus.js`.
- **Custo**: o portal lê `preco_custo`, `custo` ou `custo_medio`. Se o UniPlus enviar, a margem aparece
  para dono e gerente. Se não enviar, o portal funciona igual, só sem margem.

## Nuvemshop
1. Em parceiros.nuvemshop.com.br crie um app, com escopos de produtos (leitura/escrita) e pedidos (leitura).
2. Instale o app na loja e troque o `code` pelo token (`POST https://www.tiendanube.com/apps/authorize/token`).
3. Variáveis: `NUVEMSHOP_STORE_ID` (user_id da resposta), `NUVEMSHOP_ACCESS_TOKEN`,
   `NUVEMSHOP_USER_AGENT="Portal Shopping Rural (seu-email@…)"`, `NUVEMSHOP_APP_SECRET` (client secret).
4. Webhooks de pedido: cadastrar `order/created`, `order/paid`, `order/fulfilled`, `order/cancelled` apontando
   para `https://SEU-PORTAL/api/webhooks/nuvemshop` (`POST /v1/{store_id}/webhooks`). A assinatura
   `x-linkedstore-hmac-sha256` é verificada com o client secret.
5. **Primeiro teste**: publique um produto barato e confira na loja. Fotos só sobem se a publicação for
   feita pelo servidor da loja (onde está `media/`).
6. Falta ligar: categoria da Nuvemshop (`categories` no payload), atualizar preço/estoque de produto já publicado.

## Shopee (Open Platform v2)
1. Cadastro em open.shopee.com → app → `partner_id` e `partner_key`.
2. Autorizar a loja (fluxo `/api/v2/shop/auth_partner`) → `code` → `access_token`, `refresh_token`, `shop_id`.
   O access token dura 4 h: implemente a renovação (`/api/v2/auth/access_token/get`) e guarde em `integrations/shopee`.
3. Variáveis: `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID`, `SHOPEE_ACCESS_TOKEN`.
4. Para ligar a criação: em `publishToMarketplace()` trocar o erro `NOT_IMPLEMENTED` por:
   upload das fotos (`/api/v2/media_space/upload_image`), `add_item` com categoria, atributos, peso,
   dimensões e logística (`/api/v2/logistics/get_channel_list`). Use `shopeeRequest()` (assinatura pronta).
5. Devolva `{ externalId: item_id, url }`; a fila já grava e conclui o canal.

## Mercado Livre
1. developers.mercadolivre.com.br → app → autorizar a conta da loja (OAuth) → `access_token` (6 h) e `refresh_token`.
2. Variáveis: `MELI_ACCESS_TOKEN`, `MELI_USER_ID`. Implemente a renovação com o refresh token.
3. Para ligar a criação: `buildMeliItem()` já monta título, preço, estoque, SKU. Falta:
   categoria (`/sites/MLB/domain_discovery/search?q=`), atributos obrigatórios da categoria e fotos
   (`/pictures/items/upload`). Depois `meliRequest('POST', '/items', payload)` e devolver `{ externalId: id, url: permalink }`.
4. Tarifas: o ML cobra comissão por categoria/tipo de anúncio e tarifa fixa abaixo de certo preço —
   ajuste em **Canais e taxas** (campos "Tarifa fixa" e "Tarifa só abaixo de").

## Google Analytics 4
1. Google Cloud → criar conta de serviço → gerar chave JSON. Ativar a "Google Analytics Data API".
2. GA4 → Administrador → Gerenciamento de acesso à propriedade → adicionar o e-mail da conta de serviço como **Leitor**.
3. Variáveis: `GA4_PROPERTY_ID` (número da propriedade), `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON em uma linha).
4. Métricas usadas: `sessions`, `totalUsers`, `keyEvents`, `totalRevenue`, por `sessionDefaultChannelGroup`.

## Google Ads
1. Developer token (Central de API da conta MCC), app OAuth (client id/secret) e refresh token da conta.
2. Variáveis: `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (se acessar via MCC),
   `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`,
   `GOOGLE_ADS_API_VERSION` (padrão `v20`; atualize se o Google descontinuar).
3. Consulta GAQL em `fetchGoogleAds()`: custo, impressões, cliques e conversões por campanha, últimos 30 dias.

## Meta Ads e Lead Ads
1. Gerenciador de Negócios → Usuários do sistema → gerar token com `ads_read` para a conta de anúncios.
2. Variáveis: `META_AD_ACCOUNT_ID` (com ou sem `act_`), `META_ACCESS_TOKEN`, `META_API_VERSION` (padrão `v21.0`).
3. Leads: token da **página** com `leads_retrieval` em `META_PAGE_ACCESS_TOKEN` e os IDs dos formulários em
   `META_LEAD_FORM_IDS` (separados por vírgula). Importação incremental desde a última sincronização;
   leads repetidos (mesmo telefone/e-mail) viram comentário. Para tempo real, assine o webhook `leadgen` da página.

## Entrada de leads (formulário do site, WhatsApp, Zapier/Make)
- `LEADS_WEBHOOK_TOKEN` = um segredo longo. Ferramenta envia:
  `POST /api/leads/inbound` com `Authorization: Bearer <token>` e JSON
  `{ "name", "phone", "email", "source", "message", "campaign", "utm_source", "utm_medium", "utm_campaign" }`.
- `source` aceita os valores de `LEAD_SOURCES` (domain.js); `campaign` aceita nome ou ID da campanha.
- **Não** coloque o token em página pública (JavaScript do site). Use um intermediário no servidor.

## Atualização automática dos indicadores
- No servidor da loja: a cada `METRICS_SYNC_HOURS` (padrão 6). `0` desliga.
- Na Vercel: criar um Cron Job que chame uma rota protegida por `CRON_SECRET` — ainda não existe;
  sugestão: `GET /api/cron/metrics` validando `Authorization: Bearer ${CRON_SECRET}` e chamando `syncMetrics()`.
