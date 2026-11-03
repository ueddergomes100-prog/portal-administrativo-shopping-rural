// Pedidos. Chegam do site próprio pela API da loja (services/store.js). O portal não cria pedidos;
// a equipe só move o andamento (separando, pronto, enviado, entregue). Shopee e Mercado Livre: painéis deles.
import { config } from '../config.js';
import { getStore, C } from '../store/index.js';
import { orderTransitions } from './store.js';

export async function listOrders(user) {
  const orders = await getStore().list(C.orders, { orderBy: 'createdAt', direction: 'desc', limit: 500 });
  return { connected: !!config.store.apiToken, orders: orders.map(o => ({ ...o, transitions: orderTransitions(o, user) })) };
}
