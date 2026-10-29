// Pedidos do site. Vêm da Nuvemshop — o portal não cria pedidos.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { forbidden } from '../http.js';
import { fetchRecentOrders, nuvemshopConfigured } from '../integrations/nuvemshop.js';
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
