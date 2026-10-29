# Roteiro — próximas etapas

Ordem sugerida. Cada item diz onde mexer e o que significa "pronto".
Contrato com o site em `docs/SITE.md`; contas externas em `docs/INTEGRACOES.md`.

## 0. Conectar as contas e validar ao vivo
- Preencher o `.env` da máquina da loja com UniPlus, `STORE_*`, GA4, Google Ads, Meta e `LEADS_WEBHOOK_TOKEN`.
- Em Integrações, cada uma deve ficar "Conectado". Em Indicadores, "Buscar dados agora".
- Se algum provedor responder diferente do simulado em `tests/integrations.test.js`, ajustar o mapeamento.

## 1. Ligar o site próprio
- No portal está pronto (catálogo no formato do site, estoque, pedidos, andamento, avisos).
- Falta o **servidor do site** (lista em `docs/SITE.md`, "O que falta construir"): checkout com gateway
  (Mercado Pago, Pagar.me ou Asaas), webhook, frete, cupons, conta do cliente, e repassar ao portal.
- Colocar a taxa do gateway em **Canais e taxas → Site próprio**.
- Fotos: o portal precisa estar acessível na internet para o site exibir `/api/store/images/...`
  (ou colocar um CDN/cache na frente, ou copiar as fotos publicadas para o armazenamento do site).
- Pronto quando: produto publicado no portal aparece no site, uma compra de teste paga aparece em
  Pedidos como "Pago".

## 2. Estoque reservado e baixa
- Hoje o portal mostra o estoque do UniPlus e não baixa nada. Definir com a loja: o site reserva
  estoque? A baixa é feita no UniPlus pelo caixa? Se for automática, criar no conector UniPlus a
  chamada de baixa a partir dos pedidos pagos (`orders`).

## 3. Marketplaces (manual, por decisão da loja)
- Shopee e Mercado Livre são anunciados à mão pela equipe; o portal guarda preço, taxa, link e marca
  "preço mudou — atualizar anúncio" quando o dono altera o preço. **Não automatizar** a criação de
  anúncios sem novo pedido da loja.

## 4. Indicadores de mídia — evolução
- Pronto: resumo dos últimos 30 dias por fonte (`server/integrations/analytics.js`).
- Próximo: série diária para gráfico, comparação com o período anterior, filtro de período,
  ligação campanha do portal ↔ campanha do Google/Meta (pelo nome ou UTM) para ver custo por campanha.
- Cron na Vercel (`/api/cron/metrics` com `CRON_SECRET`) se o portal for para a nuvem.

## 5. Qualidade e operação
- Script de migração `data/portal-db.json` → Firestore (ver docs/DADOS.md).
- Notificações (e-mail/WhatsApp) quando algo entra em "Sua vez".
- Tema escuro (tokens já centralizados em `:root`).
- Paginação/consulta no servidor para `audit`, `leads` e `orders` quando o volume crescer.
- Catálogo grande no Firestore: a lista de produtos lê a coleção inteira com cache de 60 s
  (`services/products.js`). Acima de ~5 mil produtos, mover busca para índice dedicado.
- Testes de interface (Playwright) para os fluxos por papel.
