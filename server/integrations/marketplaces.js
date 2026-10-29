// Marketplaces (Shopee e Mercado Livre).
//
// Situação: a autenticação e o formato das chamadas estão prontos; a criação automática do anúncio
// AINDA NÃO está ligada, porque os dois exigem dados que o portal ainda não coleta (categoria do
// marketplace, atributos obrigatórios, logística, fotos por URL pública). Enquanto isso, a equipe
// publica no painel do marketplace e usa "Registrar anúncio feito à mão" na ficha da fila.
//
// Para ligar (ver docs/INTEGRACOES.md):
//  - Mercado Livre: POST /items com buildMeliItem() + upload de fotos em /pictures/items/upload.
//  - Shopee: POST /api/v2/product/add_item assinado com shopeeSign() + upload em /api/v2/media_space/upload_image.
import crypto from 'node:crypto';
import { config } from '../config.js';

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export const shopeeConfigured = () => !!(config.shopee.partnerId && config.shopee.partnerKey && config.shopee.shopId && config.shopee.accessToken);
export const meliConfigured = () => !!(config.mercadoLivre.accessToken && config.mercadoLivre.userId);

// ---------------------------------------------------------------------------
// Shopee Open Platform v2 — assinatura das chamadas de loja.
// sign = HMAC-SHA256(partner_key, partner_id + path + timestamp + access_token + shop_id)
// ---------------------------------------------------------------------------
export function shopeeSign(path, timestamp = Math.floor(Date.now() / 1000)) {
  const { partnerId, partnerKey, shopId, accessToken } = config.shopee;
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return { timestamp, sign: crypto.createHmac('sha256', partnerKey).update(base).digest('hex') };
}

export async function shopeeRequest(method, path, body) {
  if (!shopeeConfigured()) throw codedError('Shopee não conectada (SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_SHOP_ID, SHOPEE_ACCESS_TOKEN).', 'NOT_CONFIGURED');
  const { timestamp, sign } = shopeeSign(path);
  const { partnerId, shopId, accessToken } = config.shopee;
  const url = `https://partner.shopeemobile.com${path}?partner_id=${partnerId}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${sign}`;
  const response = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(`Shopee respondeu ${response.status}: ${data.message || data.error || 'erro desconhecido'}`);
  return data.response ?? data;
}

// ---------------------------------------------------------------------------
// Mercado Livre — API REST com token OAuth (renovar com refresh token a cada 6 h; ver docs).
// ---------------------------------------------------------------------------
export async function meliRequest(method, path, body) {
  if (!meliConfigured()) throw codedError('Mercado Livre não conectado (MELI_ACCESS_TOKEN, MELI_USER_ID).', 'NOT_CONFIGURED');
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.mercadoLivre.accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mercado Livre respondeu ${response.status}: ${data.message || data.error || 'erro desconhecido'}`);
  return data;
}

// Rascunho do anúncio do ML a partir do item da fila. Falta categoria e atributos obrigatórios.
export function buildMeliItem(item, channel) {
  return {
    title: (item.content?.title || item.productSnapshot.name).slice(0, 60),
    category_id: null, // TODO: GET /sites/MLB/domain_discovery/search?q=<título> para sugerir a categoria
    price: channel.promoPrice ?? channel.price,
    currency_id: 'BRL',
    available_quantity: Math.max(0, Math.floor(item.productSnapshot.stock || 0)),
    buying_mode: 'buy_it_now',
    condition: 'new',
    listing_type_id: 'gold_special',
    seller_custom_field: item.productSnapshot.sku || undefined,
    pictures: [], // TODO: subir as fotos de media/ em /pictures/items/upload e usar os IDs aqui
    attributes: [] // TODO: atributos obrigatórios da categoria (GET /categories/{id}/attributes)
  };
}

// Ponto único chamado pela fila. Sem integração pronta, devolve um erro que a interface
// transforma em "registre o anúncio à mão".
export async function publishToMarketplace(channel, item) {
  const which = channel.integration;
  if (which === 'shopee') {
    if (!shopeeConfigured()) throw codedError(`${channel.name} ainda não está conectada. Anuncie no painel da Shopee e registre aqui o link do anúncio.`, 'NOT_CONFIGURED');
    throw codedError('A criação automática de anúncios na Shopee ainda não foi ligada (ver docs/INTEGRACOES.md). Anuncie no painel e registre o link.', 'NOT_IMPLEMENTED');
  }
  if (which === 'mercadolivre') {
    if (!meliConfigured()) throw codedError(`${channel.name} ainda não está conectado. Anuncie no Mercado Livre e registre aqui o link do anúncio.`, 'NOT_CONFIGURED');
    throw codedError('A criação automática de anúncios no Mercado Livre ainda não foi ligada (ver docs/INTEGRACOES.md). Anuncie no painel e registre o link.', 'NOT_IMPLEMENTED');
  }
  throw codedError(`${channel.name} não tem integração automática. Publique no canal e registre aqui o link ou código.`, 'NOT_IMPLEMENTED');
}
