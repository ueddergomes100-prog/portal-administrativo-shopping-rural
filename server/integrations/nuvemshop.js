// Cliente da API da Nuvemshop (servidor apenas).
// Documentação oficial: https://tiendanube.github.io/api-documentation/
// Autenticação: cabeçalho `Authentication: bearer <token>` + `User-Agent` identificando o app.
//
// IMPORTANTE: o código abaixo segue a documentação pública, mas ainda NÃO foi testado contra a
// loja real (sem credenciais neste repositório). Teste primeiro com um produto oculto.
import { config } from '../config.js';
import { mediaAvailable, readImageBase64 } from '../media.js';

export class NuvemshopNotConfigured extends Error {
  constructor() {
    super('Nuvemshop ainda não está conectada. Configure NUVEMSHOP_STORE_ID e NUVEMSHOP_ACCESS_TOKEN no servidor.');
    this.code = 'NOT_CONFIGURED';
  }
}

export const nuvemshopConfigured = () => !!(config.nuvemshop.storeId && config.nuvemshop.accessToken);

async function call(method, pathname, body) {
  if (!nuvemshopConfigured()) throw new NuvemshopNotConfigured();
  const url = `${config.nuvemshop.apiBase}/${config.nuvemshop.storeId}${pathname}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authentication: `bearer ${config.nuvemshop.accessToken}`,
      'User-Agent': config.nuvemshop.userAgent,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    const detail = data?.description || data?.message || data?.error || text.slice(0, 300);
    const error = new Error(`Nuvemshop respondeu ${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// Monta o produto a partir do item aprovado da fila.
export function buildProductPayload(item) {
  const product = item.productSnapshot || {};
  const price = item.priceMode === 'custom' ? item.sitePrice : product.basePrice;
  const variant = { price: String(price ?? 0), stock: Math.max(0, Math.floor(product.stock || 0)), sku: product.sku || undefined };
  if (item.promoPrice) variant.promotional_price = String(item.promoPrice);
  return {
    name: { pt: item.content?.title || product.name },
    description: { pt: item.content?.description || '' },
    handle: undefined,
    published: true,
    seo_title: item.content?.seoTitle || undefined,
    seo_description: item.content?.seoDescription || undefined,
    variants: [variant]
  };
}

// Cria (ou atualiza, se já tiver externalId) o produto e envia as imagens locais.
export async function publishProduct(item) {
  const payload = buildProductPayload(item);
  let result;
  if (item.publish?.externalId) {
    result = await call('PUT', `/products/${item.publish.externalId}`, {
      name: payload.name, description: payload.description, published: true,
      seo_title: payload.seo_title, seo_description: payload.seo_description
    });
  } else {
    result = await call('POST', '/products', payload);
  }
  const externalId = result?.id ?? item.publish?.externalId;
  const imageWarnings = [];
  const refs = item.content?.imageRefs || [];
  if (refs.length && !item.publish?.imagesSent) {
    if (!mediaAvailable()) {
      imageWarnings.push('As imagens ficam em media/ na máquina da loja. Publique pelo portal local para enviá-las.');
    } else {
      for (const ref of refs) {
        try {
          const image = readImageBase64(ref);
          await call('POST', `/products/${externalId}/images`, image);
        } catch (error) {
          imageWarnings.push(`${ref}: ${error.message}`);
        }
      }
    }
  }
  return {
    externalId: String(externalId),
    url: result?.canonical_url || null,
    imagesSent: refs.length > 0 && imageWarnings.length === 0,
    imageWarnings
  };
}

// Pedidos recentes (para a tela de pedidos). Converte para o formato interno.
export async function fetchRecentOrders({ perPage = 50 } = {}) {
  const orders = await call('GET', `/orders?per_page=${perPage}`);
  return (orders || []).map(order => ({
    id: `ns-${order.id}`,
    externalId: String(order.id),
    number: String(order.number ?? order.id),
    customer: order.customer?.name || order.contact_name || '',
    email: order.contact_email || order.customer?.email || '',
    total: Number(order.total) || 0,
    paymentStatus: order.payment_status || '',
    shippingStatus: order.shipping_status || '',
    status: order.status === 'cancelled' ? 'cancelled'
      : order.shipping_status === 'delivered' ? 'delivered'
      : order.shipping_status === 'shipped' ? 'shipped'
      : order.payment_status === 'paid' ? 'paid' : 'open',
    createdAt: order.created_at,
    items: (order.products || []).map(p => ({ name: p.name, sku: p.sku, quantity: Number(p.quantity) || 0, price: Number(p.price) || 0 })),
    source: 'nuvemshop'
  }));
}
