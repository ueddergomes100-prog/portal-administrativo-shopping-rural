// API para o SITE PRÓPRIO da loja (projeto "Site Shopping Rural"). Contrato em docs/SITE.md.
// Fala nos MESMOS formatos do site (src/data/products.ts e src/types/commerce.ts de lá):
//
// Catálogo (leitura pública): produtos com o canal "site" publicado. Preço e promoção vêm do que o
//   dono definiu; estoque vem do UniPlus; fotos servidas pelo portal.
// Pedidos (STORE_API_TOKEN, servidor do site -> portal): o site cobra no gateway e envia o pedido;
//   a equipe move o andamento no portal (separando, enviado...) e o site lê de volta.
// Avisos (contato, newsletter, aviso de reposição) viram leads.
import { config } from '../config.js';
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, notFound, forbidden, clean } from '../http.js';
import { imageFile } from '../media.js';
import { setIntegrationState } from './integrations.js';
import { catalogSnapshot, toSiteProduct } from './catalog.js';
import { receiveLead } from './leads-inbound.js';
import {
  todayInSaoPaulo, ORDER_STATUS, ORDER_TRANSITIONS, PAYMENT_STATUS, PAYMENT_METHODS, DELIVERY_METHODS,
  findTransition, roleMatches, availableTransitions
} from '../../public/shared/domain.js';

const SYSTEM = { id: 'site', name: 'Site próprio', role: 'system' };
const now = () => new Date().toISOString();

export async function listCatalog() {
  const today = todayInSaoPaulo();
  const products = (await catalogSnapshot()).items.map(e => toSiteProduct(e, today));
  products.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { products };
}

export async function getCatalogItem(slug) {
  const found = (await catalogSnapshot()).items.find(e => e.slug === slug);
  if (!found) throw notFound('Produto não encontrado ou fora do ar.');
  return toSiteProduct(found, todayInSaoPaulo());
}

// POST /api/catalog/stock-check  { items: [{ productId, qty }] } -> [{ productId, requested, available }]
export async function stockCheck(input) {
  const items = Array.isArray(input.items) ? input.items.slice(0, 200) : [];
  const byId = new Map((await catalogSnapshot()).items.map(e => [e.id, e]));
  return items.map(({ productId, qty }) => ({
    productId: String(productId),
    requested: Math.max(0, Math.floor(Number(qty) || 0)),
    available: byId.get(String(productId))?.stock ?? 0
  }));
}

// Só serve fotos (em media/) que pertencem a um produto publicado no site.
export async function siteImage(ref) {
  const wanted = String(ref || '');
  const allowed = (await catalogSnapshot()).items.some(e => e.imageRefs.includes(wanted));
  if (!allowed) throw notFound('Imagem não encontrada.');
  const file = imageFile(wanted);
  if (!file) throw notFound('Imagem não encontrada no servidor da loja.');
  return file;
}

// ---------------------------------------------------------------------------
// Pedidos (formato `Order` do site)
// ---------------------------------------------------------------------------
function readSiteOrder(input) {
  const id = clean.text(input.id, { required: true, max: 80, label: 'ID do pedido' });
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw badRequest('O pedido precisa ter itens.');
  const customer = input.customer || {};
  const totals = input.totals || {};
  const delivery = input.delivery || {};
  const payment = input.payment || {};
  const status = clean.oneOf(input.status, Object.keys(ORDER_STATUS), { label: 'Situação do pedido', fallback: 'aguardando_pagamento' });
  const money = (v, label) => clean.money(v, { label, allowZero: true }) ?? 0;
  return {
    externalId: id,
    number: id,
    customer: {
      name: clean.text(customer.name, { max: 120, label: 'Cliente' }),
      email: clean.email(customer.email),
      phone: clean.text(customer.phone, { max: 40, label: 'Telefone' }),
      cpf: clean.text(customer.cpf, { max: 20, label: 'CPF' })
    },
    items: items.slice(0, 200).map(i => ({
      productId: clean.text(i.productId, { max: 120 }), sku: clean.text(i.sku, { max: 60 }), slug: clean.text(i.slug, { max: 120 }),
      name: clean.text(i.name, { required: true, max: 160, label: 'Nome do item' }), brand: clean.text(i.brand, { max: 80 }),
      image: clean.text(i.image, { max: 500 }), measure: clean.text(i.measure, { max: 40 }),
      unitPrice: money(i.unitPrice, 'Preço do item'), qty: Math.max(1, Math.floor(Number(i.qty) || 1))
    })),
    delivery: {
      method: clean.oneOf(delivery.method, Object.keys(DELIVERY_METHODS), { label: 'Entrega', fallback: 'economica' }),
      label: clean.text(delivery.label, { max: 80 }),
      price: money(delivery.price, 'Frete'),
      days: Array.isArray(delivery.days) ? delivery.days.slice(0, 2).map(Number) : null,
      address: delivery.address && typeof delivery.address === 'object' ? Object.fromEntries(
        ['label', 'recipient', 'cep', 'street', 'number', 'complement', 'district', 'city', 'state']
          .map(k => [k, clean.text(delivery.address[k], { max: 160 })]).filter(([, v]) => v)) : null
    },
    payment: {
      method: clean.oneOf(payment.method, Object.keys(PAYMENT_METHODS), { label: 'Forma de pagamento', fallback: 'pix' }),
      status: clean.oneOf(payment.status, Object.keys(PAYMENT_STATUS), { label: 'Situação do pagamento', fallback: 'pendente' }),
      // Só dados que o cliente já vê; nunca número de cartão.
      brand: clean.text(payment.brand, { max: 30 }), last4: clean.text(payment.last4, { max: 4 }),
      installments: payment.installments ? Math.floor(Number(payment.installments)) || null : null,
      gateway: clean.text(payment.gateway, { max: 40 }), gatewayId: clean.text(payment.gatewayId, { max: 120 })
    },
    totals: {
      subtotal: money(totals.subtotal, 'Subtotal'), couponDiscount: money(totals.couponDiscount, 'Desconto do cupom'),
      pixDiscount: money(totals.pixDiscount, 'Desconto Pix'), shipping: money(totals.shipping, 'Frete'),
      total: clean.money(totals.total, { required: true, label: 'Total', allowZero: true }), coupon: clean.text(totals.coupon, { max: 40 })
    },
    status,
    createdAt: input.createdAt && Number.isFinite(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : now()
  };
}

// Pedido no formato do site (o site lê o andamento daqui).
export function toSiteOrder(order) {
  return {
    id: order.externalId,
    createdAt: order.createdAt,
    customer: order.customer,
    items: order.items,
    delivery: { ...order.delivery, ...(order.delivery?.address ? {} : { address: undefined }) },
    payment: order.payment,
    totals: order.totals,
    status: order.status,
    timeline: order.timeline,
    trackingCode: order.trackingCode || undefined
  };
}

// Cria ou atualiza (mesmo `id` não duplica). Andamento já movido pela equipe não volta atrás.
export async function upsertSiteOrder(input) {
  const store = getStore();
  const data = readSiteOrder(input);
  const id = `site-${data.externalId}`;
  const current = await store.get(C.orders, id);
  const keepTeamStatus = current && ['separando', 'pronto_retirada', 'enviado', 'entregue'].includes(current.status) && data.status !== 'cancelado';
  const status = keepTeamStatus ? current.status : data.status;
  const timeline = [...(current?.timeline || (Array.isArray(input.timeline) ? input.timeline.filter(t => ORDER_STATUS[t.status]).map(t => ({ status: t.status, at: t.at })) : []))];
  if (!timeline.length || timeline[timeline.length - 1].status !== status) timeline.push({ status, at: now() });
  const order = { ...current, ...data, status, timeline: timeline.slice(-50), channel: 'site', syncedAt: now() };
  await store.set(C.orders, id, order);
  if (!current || current.status !== status) {
    await audit(SYSTEM, { action: current ? 'orders.status' : 'orders.create', entity: 'orders', entityId: id,
      summary: `Pedido ${data.number}: ${ORDER_STATUS[status].label} (${data.customer.name || 'cliente'})` });
  }
  await setIntegrationState('site', { status: 'connected', lastSyncAt: now(), lastError: '' });
  return toSiteOrder(order);
}

// Atualização vinda do site/gateway: { status?, payment? } (ex.: Pix confirmado).
export async function updateSiteOrder(externalId, input) {
  const store = getStore();
  const id = `site-${clean.text(externalId, { required: true, max: 80 })}`;
  const current = await store.get(C.orders, id);
  if (!current) throw notFound('Pedido não encontrado. Envie o pedido completo antes de atualizar.');
  return upsertSiteOrder({
    ...toSiteOrder(current),
    ...(input.status ? { status: input.status } : {}),
    payment: { ...current.payment, ...(input.payment || {}) }
  });
}

export async function getSiteOrder(externalId) {
  const order = await getStore().get(C.orders, `site-${externalId}`);
  if (!order) throw notFound('Pedido não encontrado.');
  return toSiteOrder(order);
}

// Equipe da loja move o pedido no portal (separando, pronto, enviado com rastreio, entregue).
export async function moveOrder(user, id, { to, trackingCode, note }) {
  const store = getStore();
  const order = await store.get(C.orders, id);
  if (!order) throw notFound('Pedido não encontrado.');
  const transition = findTransition(ORDER_TRANSITIONS, order.status, to);
  if (!transition) throw badRequest(`Não é possível ir de "${ORDER_STATUS[order.status]?.label}" para "${ORDER_STATUS[to]?.label || to}".`);
  if (!roleMatches(user, transition.who)) throw forbidden();
  if (transition.delivery === 'retirada' && order.delivery?.method !== 'retirada') throw badRequest('Este pedido é para entrega, não retirada.');
  if (transition.delivery === 'entrega' && order.delivery?.method === 'retirada') throw badRequest('Este pedido é para retirada na loja.');
  const code = clean.text(trackingCode, { max: 80, label: 'Código de rastreio' });
  if (transition.requires === 'tracking' && !code) throw badRequest('Informe o código de rastreio.');
  const cleanNote = clean.text(note, { max: 500, label: 'Motivo' });
  if (transition.requires === 'note' && !cleanNote) throw badRequest('Escreva o motivo do cancelamento.');
  const patch = {
    status: to,
    timeline: [...(order.timeline || []), { status: to, at: now(), by: user.name, ...(cleanNote ? { note: cleanNote } : {}) }].slice(-50),
    ...(code ? { trackingCode: code } : {}),
    updatedAt: now()
  };
  const saved = await store.update(C.orders, id, patch);
  await audit(user, { action: 'orders.move', entity: 'orders', entityId: id, summary: `Pedido ${order.number}: ${ORDER_STATUS[order.status].label} → ${ORDER_STATUS[to].label}${code ? ` (rastreio ${code})` : ''}` });
  return { ...saved, transitions: orderTransitions(saved, user) };
}

export function orderTransitions(order, user) {
  return availableTransitions(ORDER_TRANSITIONS, order.status, user)
    .filter(t => !t.delivery || (t.delivery === 'retirada') === (order.delivery?.method === 'retirada'))
    .map(t => ({ to: t.to, label: t.label, requires: t.requires || null }));
}

// ---------------------------------------------------------------------------
// Avisos do site -> leads
// ---------------------------------------------------------------------------
export function siteContact(body) {
  return receiveLead({
    name: body.name, email: body.email, phone: body.phone, source: 'Site',
    message: [body.subject, body.message].filter(Boolean).join(': ')
  }, { source: 'Site' });
}

export function siteNewsletter(body) {
  return receiveLead({ name: 'Newsletter', email: body.email, source: 'Site', message: 'Assinou a newsletter do site' }, { source: 'Site' });
}

export async function siteRestockAlert(body) {
  const sku = clean.text(body.sku, { required: true, max: 60, label: 'SKU' });
  const product = (await getStore().list(C.products, { where: [['sku', '==', sku]], limit: 1 }))[0];
  return receiveLead({ name: 'Aviso de reposição', email: body.email, source: 'Site', message: `Avisar quando chegar: ${product?.name || ''} (SKU ${sku})` }, { source: 'Site' });
}
