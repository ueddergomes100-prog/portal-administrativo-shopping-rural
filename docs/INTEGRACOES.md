# Integrações — o que está pronto e como ligar

Regra geral: credenciais **só** no servidor (`.env` na máquina da loja ou variáveis da Vercel).
Depois de preencher, reinicie o portal e confira em **Integrações** (status e variáveis que faltam).

| Integração | Código | Situação | Como testar |
|---|---|---|---|
| UniPlus | `server/integrations/uniplus.js` | Pronto (lê `/api/erp/products`) | Sincronizar agora em Produtos |
| Site próprio | `server/services/store.js` | Pronto e testado (catálogo, fotos, pedidos) | `docs/SITE.md` |
| Shopee / Mercado Livre | — | **Manual por decisão da loja**: anuncia no painel e registra o link | Ficha da fila → Registrar anúncio |
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

## Site próprio
- Variáveis: `STORE_API_TOKEN`, `STORE_PUBLIC_URL`, `STORE_PRODUCT_PATH`, `STORE_ALLOWED_ORIGINS`, `PORTAL_PUBLIC_URL`.
- Contrato completo (catálogo, fotos, pedidos, fluxo do gateway): `docs/SITE.md`.

## Shopee e Mercado Livre
- Sem integração por decisão da loja. O dono define preço por canal (com taxa e líquido) e o
  responsável anuncia no painel de cada marketplace e registra o link na ficha do produto.
- Taxas: ajuste em **Canais e taxas** (comissão, tarifa fixa e "tarifa só abaixo de").

## Google Analytics 4
1. Google Cloud → criar conta de serviço → gerar chave JSON. Ativar a "Google Analytics Data API".
2. GA4 → Administrador → Gerenciamento de acesso à propriedade → adicionar o e-mail da conta de serviço como **Leitor**.
3. Variáveis: `GA4_PROPERTY_ID` (número da propriedade), `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON em uma linha).
4. Métricas usadas: `sessions`, `totalUsers`, `keyEvents`, `totalRevenue`, por `sessionDefaultChannelGroup`.
5. No site próprio, instale a tag do GA4 e marque a compra (`purchase`) como evento-chave.

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
- **Não** coloque o token em página pública (JavaScript do site). Use o servidor do site como intermediário.

## Atualização automática dos indicadores
- No servidor da loja: a cada `METRICS_SYNC_HOURS` (padrão 6). `0` desliga.
- Na Vercel: criar um Cron Job que chame uma rota protegida por `CRON_SECRET` — ainda não existe;
  sugestão: `GET /api/cron/metrics` validando `Authorization: Bearer ${CRON_SECRET}` e chamando `syncMetrics()`.
