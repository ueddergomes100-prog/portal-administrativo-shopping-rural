// Conector UniPlus: lê o catálogo da API local do UniPlus e grava em `products`.
// O UniPlus é a fonte de SKU, estoque e preço-base — o portal nunca escreve esses campos por conta própria.
//
// Formato esperado de GET {UNIPLUS_API_URL}/api/erp/products:
//   { data: [{ id_produto, sku, nome_produto, nome_categoria, preco, estoque, preco_custo?, ... }] }
// Se a API do UniPlus da loja tiver outro formato, ajuste apenas `mapProduct`.
import { config } from '../config.js';
import { getStore, C } from '../store/index.js';
import { setIntegrationState } from '../services/integrations.js';
import { invalidateProductCache } from '../services/products.js';

const numberOrNull = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

export function mapProduct(item) {
  const id = String(item.id_produto ?? item.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    sku: String(item.sku ?? item.codigo ?? '').trim(),
    name: String(item.nome_produto ?? item.nome ?? '').trim() || 'Produto sem nome',
    category: String(item.nome_categoria ?? item.categoria ?? '').trim() || 'Sem categoria',
    basePrice: Number(item.preco ?? item.preco_venda ?? 0) || 0,
    // Custo é opcional: se a API do UniPlus não enviar, o portal só não mostra a margem.
    cost: numberOrNull(item.preco_custo ?? item.custo ?? item.custo_medio),
    stock: Number(item.estoque ?? item.saldo ?? 0) || 0,
    unit: String(item.unidade ?? '').trim()
  };
}

export async function fetchUniplusCatalog() {
  if (!config.uniplus.apiUrl) throw new Error('UNIPLUS_API_URL não configurada.');
  const url = config.uniplus.apiUrl.replace(/\/$/, '') + '/api/erp/products';
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`A API do UniPlus respondeu com status ${response.status}.`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(rows)) throw new Error('Resposta do UniPlus sem a lista de produtos (campo data).');
  return rows.map(mapProduct).filter(Boolean);
}

// Grava o catálogo recebido. Produtos que sumiram do UniPlus não são apagados:
// ficam marcados como `missingFromUniplus` para o dono decidir.
export async function saveCatalog(items, source = 'uniplus') {
  const store = getStore();
  const at = new Date().toISOString();
  const incoming = new Set(items.map(i => i.id));
  const existing = await store.list(C.products);
  const missing = existing.filter(p => !incoming.has(p.id) && !p.missingFromUniplus)
    .map(p => ({ id: p.id, missingFromUniplus: true, syncedAt: at }));
  const docs = items.map(item => ({ ...item, missingFromUniplus: false, syncedAt: at, source }));
  await store.bulkSet(C.products, [...docs, ...missing]);
  invalidateProductCache();
  return { received: items.length, missing: missing.length, at };
}

let running = false;
export async function syncUniplusOnce() {
  if (running) return { skipped: true };
  running = true;
  try {
    const items = await fetchUniplusCatalog();
    const result = await saveCatalog(items);
    await setIntegrationState('uniplus', {
      status: 'connected', lastSyncAt: result.at, lastError: '', itemCount: items.length, missingCount: result.missing
    });
    return result;
  } catch (error) {
    await setIntegrationState('uniplus', { status: 'error', lastError: error.message, lastErrorAt: new Date().toISOString() });
    throw error;
  } finally {
    running = false;
  }
}

export function startUniplusLoop(log = console) {
  if (!config.uniplus.apiUrl) {
    log.info?.('[uniplus] UNIPLUS_API_URL vazia — sincronização desligada.');
    return () => {};
  }
  const tick = () => syncUniplusOnce()
    .then(r => !r.skipped && log.info?.(`[uniplus] ${r.received} produtos sincronizados (${r.missing} ausentes).`))
    .catch(error => log.error?.('[uniplus] falha na sincronização:', error.message));
  tick();
  const timer = setInterval(tick, config.uniplus.syncSeconds * 1000);
  return () => clearInterval(timer);
}
