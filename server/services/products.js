// Catálogo espelhado do UniPlus (somente leitura no portal).
import { getStore, C } from '../store/index.js';
import { notFound } from '../http.js';

// Cache curto em memória para não ler o catálogo inteiro do Firestore a cada página.
let cache = { at: 0, items: null };
const TTL = 60_000;

export function invalidateProductCache() {
  cache = { at: 0, items: null };
}

async function allProducts() {
  if (cache.items && Date.now() - cache.at < TTL) return cache.items;
  const items = await getStore().list(C.products);
  cache = { at: Date.now(), items };
  return items;
}

const normalize = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Situação na fila (por produto) para mostrar na lista do catálogo.
async function queueIndex() {
  const queue = await getStore().list(C.queue);
  const index = new Map();
  for (const item of queue) if (item.stage !== 'archived') index.set(item.productId, { id: item.id, stage: item.stage });
  return index;
}

export async function listProducts({ search = '', filter = '', category = '', page = 1, pageSize = 25 } = {}) {
  const items = await allProducts();
  const queue = await queueIndex();
  const term = normalize(search);
  const filtered = items.filter(p => {
    if (term && !normalize(`${p.sku} ${p.name} ${p.category}`).includes(term)) return false;
    if (category && p.category !== category) return false;
    const inQueue = queue.get(p.id);
    if (filter === 'in_stock' && p.stock <= 0) return false;
    if (filter === 'stockout' && p.stock > 0) return false;
    if (filter === 'not_selected' && inQueue) return false;
    if (filter === 'in_queue' && !inQueue) return false;
    if (filter === 'missing' && !p.missingFromUniplus) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const lastSync = items.reduce((latest, p) => (p.syncedAt > latest ? p.syncedAt : latest), '');
  return {
    total: items.length,
    filteredTotal: filtered.length,
    page: current,
    pageSize: size,
    totalPages,
    lastSyncAt: lastSync || null,
    categories: [...new Set(items.map(p => p.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    summary: {
      stockout: items.filter(p => p.stock <= 0).length,
      inQueue: queue.size,
      missing: items.filter(p => p.missingFromUniplus).length
    },
    data: filtered.slice((current - 1) * size, current * size).map(p => ({ ...p, queue: queue.get(p.id) || null }))
  };
}

export async function getProduct(id) {
  const product = await getStore().get(C.products, id);
  if (!product) throw notFound('Produto não encontrado no catálogo sincronizado do UniPlus.');
  return product;
}
