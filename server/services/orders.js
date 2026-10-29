// Pedidos do site. Vêm da Nuvemshop — o portal não cria pedidos.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { forbidden } from '../http.js';
import { fetchRecentOrders, fetchOrder, nuvemshopConfigured } from '../integrations/nuvemshop.js';
import { setIntegrationState } from './integrations.js';

export async function listOrders() {
  const orders = await getStore().list(C.orders, { orderBy: 'createdAt', direction: 'desc', limit: 500 });
  return { connected: nuvemshopConfigured(), orders };
}

export async function syncOrders(user) {
  if (!['owner', 'manager', 'site'].includes(user.role)) throw forbidden();
  const orders = await fetchRecentOrders();
  await getStore().bulkSet(C.orders, orders.map(o => ({ ...o, syncedAt: new Date().toISOString() })));
  await setIntegrationState('nuvemshop', { status: 'connected', lastSyncAt: new Date().toISOString(), lastError: '' });
  await audit(user, { action: 'orders.sync', entity: 'orders', summary: `Importou ${orders.length} pedidos da Nuvemshop` });
  return { count: orders.length };
}

// Webhook da Nuvemshop: { store_id, event: 'order/created' | 'order/paid' | ..., id }.
export async function upsertOrderFromWebhook(payload) {
  if (!String(payload.event || '').startsWith('order/') || !payload.id) return { ignored: true };
  const order = await fetchOrder(payload.id);
  await getStore().set(C.orders, order.id, { ...order, syncedAt: new Date().toISOString() });
  await setIntegrationState('nuvemshop', { status: 'connected', lastSyncAt: new Date().toISOString(), lastError: '' });
  return { ok: true, id: order.id };
}
