# Site próprio ↔ portal

A loja saiu da Nuvemshop. O site é o projeto **Site Shopping Rural** (`C:\Projetos\Site Shopping Rural`,
Vite + React, hospedado na Vercel como `shopping-rural`). Ele já tem vitrine, carrinho, checkout e
página do pedido prontos, rodando em **modo demonstração**; tudo que é externo passa por
`src/services/*` e o contrato está no `INTEGRACAO.md` de lá.

O portal fala **nos mesmos formatos do site** (`Product` em `src/data/products.ts`, `Order` em
`src/types/commerce.ts`):

```
UniPlus ──(estoque, preço-base, custo)──▶ PORTAL ──(catálogo /api/catalog)──────────▶ SITE (navegador)
                                            ▲  ▲                                         │
                    andamento do pedido ────┘  └── pedidos, contato, aviso de reposição ─┤
                    (separando, enviado…)          (servidor do site, com token)         ▼
                                                                    SERVIDOR DO SITE (a construir)
                                                                    checkout, gateway, frete, cupom,
                                                                    conta do cliente
Shopee / Mercado Livre: anunciados à mão; o portal guarda preço, taxa e link.
```

## Quem faz o quê

| Assunto | Onde fica |
|---|---|
| Quais produtos vão ao site, preço, promoção, texto, fotos, categoria, marca, medida | **Portal** (fila → Publicar no site) |
| Estoque e preço-base | UniPlus → portal |
| Vitrine, carrinho, página do produto e do pedido | Site (pronto) |
| Checkout, cobrança no **gateway**, webhook do gateway, frete, cupom, conta do cliente | **Servidor do site** (a construir — Vercel Functions em `/api` do projeto do site, como o `INTEGRACAO.md` sugere) |
| Andamento do pedido (separando, pronto, enviado com rastreio, entregue) | **Portal** (tela Pedidos) — o site lê |
| Contato, newsletter, aviso de reposição | Site recebe → servidor do site envia ao portal → viram **leads** |

## Variáveis

**No portal** (`.env`):

| Variável | Para quê |
|---|---|
| `STORE_API_TOKEN` | Segredo que o **servidor** do site usa nas chamadas de pedido e avisos. Nunca no navegador. |
| `STORE_PUBLIC_URL` | Endereço do site (link "ver no site"), ex.: `https://shopping-rural.vercel.app` |
| `STORE_PRODUCT_PATH` | Caminho da página do produto. Padrão `/produto/{slug}` (é o do site) |
| `STORE_ALLOWED_ORIGINS` | Origens do site que podem ler o catálogo direto do navegador (CORS), ex.: `https://shopping-rural.vercel.app` |
| `PORTAL_PUBLIC_URL` | Endereço público do portal (URLs das fotos) |

**No servidor do site**: `PORTAL_URL` e `STORE_API_TOKEN` (mesmo valor), mais as chaves do gateway.
No front do site: `VITE_USE_MOCKS=false`.

## Catálogo — público

### `GET /api/catalog` (também `/api/store/catalog`) → `{ products: Product[] }`
É a rota que `src/services/catalog.ts` do site já chama. Cada produto:
```json
{
  "id": "…", "sku": "8596", "slug": "racao-quatree-gourmet-caes-adultos-15kg",
  "name": "Ração Quatree Gourmet Cães Adultos", "brand": "Quatree",
  "category": "racao-caes", "pet": "cao",
  "price": 129.9, "compareAt": 140,
  "measure": { "value": 15, "unit": "kg" },
  "image": "https://portal…/api/store/images/produtos/quatree-15kg.webp",
  "weightKg": 15.2, "stock": 18, "tag": "Oferta",
  "short": "Mix de carnes, sem corantes…", "description": "…",
  "specs": [{ "label": "Porte", "value": "Médio e grande" }],
  "images": ["…"], "promoEnds": "2026-11-16", "seo": { "title": "…", "description": "…" },
  "url": "https://…/produto/racao-quatree…", "updatedAt": "…"
}
```
- Em promoção (dentro do período, fuso de São Paulo): `price` = preço promocional e `compareAt` = preço
  normal (riscado), como o site espera. Sem promoção, `compareAt` não vem.
- `tag`: o selo escolhido no portal; se vazio e houver promoção, vem `"Oferta"`.
- `category` usa as 7 chaves do site (`SITE_CATEGORIES` em `public/shared/domain.js` = `categories` em
  `src/data/products.ts`). Categoria nova: acrescentar nos dois.
- `stock` é o do UniPlus. `images`, `promoEnds`, `seo`, `url` são extras (o site ignora o que não usa).

### `POST /api/catalog/stock-check` (também `/api/store/catalog/stock-check`)
`{ "items": [{ "productId": "…", "qty": 2 }] }` → `[{ "productId": "…", "requested": 2, "available": 18 }]`

### `GET /api/store/catalog/:slug` → `{ "product": Product }`
Fotos: enviadas pelo portal ficam no Vercel Blob e `image`/`images` já trazem a URL pública.
(`GET /api/store/images/<caminho>` só existe para fotos antigas em `media/`, com o portal rodando na loja.)
O catálogo tem cache de 30 s na CDN — mudança de preço/estoque aparece no site em até ~1 minuto.

## Pedidos — servidor do site → portal (`Authorization: Bearer <STORE_API_TOKEN>`)

### `POST /api/store/orders` — o `Order` do site, como está
Enviar depois de criar a cobrança no gateway (`status: "aguardando_pagamento"`) ou já pago (cartão aprovado).
Mesmo `id` não duplica. Resposta: o `Order` com `status`, `timeline` e `trackingCode` atuais.
O portal **nunca** recebe número de cartão: em `payment` só `method`, `status`, `brand`, `last4`,
`installments`, `gateway`, `gatewayId`.

### `PATCH /api/store/orders/:id` — webhook do gateway confirmou/recusou
`{ "status": "pago", "payment": { "status": "aprovado" } }` ou `{ "status": "cancelado", "payment": { "status": "expirado" } }`.

### `GET /api/store/orders/:id` — andamento para a página `/pedido/:id` e `/api/me/orders`
Devolve o `Order` com a etapa movida pela equipe no portal e o `trackingCode`.
Andamento movido pela equipe (separando, pronto, enviado, entregue) **não volta atrás** se o site
reenviar o pedido; só `cancelado` sobrescreve.

Etapas (iguais às do site): `aguardando_pagamento → pago → separando → pronto_retirada | enviado → entregue`
(ou `cancelado`). No portal: **pago → separando** e **separando → pronto para retirar** (só retirada) ou
**enviado** (exige rastreio) → **entregue**; cancelar exige motivo (dono/gerente).

## Avisos do site → leads (com o mesmo token)

| Rota no portal | Corpo (igual ao do site) | Vira |
|---|---|---|
| `POST /api/store/contact` | `{ name, email, phone?, subject, message }` | lead "Site" com a mensagem |
| `POST /api/store/newsletter` | `{ email }` | lead "Newsletter" |
| `POST /api/store/restock-alerts` | `{ sku, email }` | lead "Avisar quando chegar: <produto>" |

Contato repetido (mesmo e-mail/telefone, lead em aberto) vira comentário no lead existente.

## O que falta construir no projeto do site (servidor)

1. `/api/catalog` e `/api/catalog/stock-check`: repassar ao portal (ou o front lê direto do portal,
   com `STORE_ALLOWED_ORIGINS` liberando o domínio do site).
2. `/api/orders`: recalcular preços pelo catálogo do portal, frete e cupom (`src/lib/pricing.ts`),
   cobrar no gateway, gravar e **enviar ao portal** (`POST /api/store/orders`).
3. Webhook do gateway → `PATCH /api/store/orders/:id` no portal.
4. `/api/orders/:id` e `/api/me/orders`: ler do portal (`GET /api/store/orders/:id`).
5. `/api/contact`, `/api/newsletter`, `/api/restock-alerts`: repassar ao portal.
6. Frete (`/api/shipping/quote`, ex.: Melhor Envio), cupons e conta do cliente: no próprio site.
7. Na tela **Canais e taxas** do portal, colocar a taxa do gateway no canal "Site próprio".
