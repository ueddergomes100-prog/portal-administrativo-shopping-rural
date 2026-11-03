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
import { touchCatalogProducts } from '../services/catalog.js';

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

// Campos que vêm do UniPlus. Só grava no banco o produto em que algum deles mudou.
const FIELDS = ['sku', 'name', 'category', 'basePrice', 'cost', 'stock', 'unit'];
export const productKey = p => FIELDS.map(f => p[f] ?? '').join('|');

// Compara com a última leitura (Map id -> chave) e devolve só o que mudou.
export function diffCatalog(previous, items) {
  return items.filter(item => previous.get(item.id) !== productKey(item));
}

// Grava o catálogo recebido.
// - mode 'partial': grava só os itens enviados (o conector já filtrou o que mudou).
// - mode 'full': compara com o banco, grava só o que mudou e marca como `missingFromUniplus`
//   o que sumiu do UniPlus (nada é apagado — o dono decide).
// Se mudou estoque/preço de produto que está no site, o catálogo do site é refeito.
export async function saveCatalog(items, { mode = 'full', source = 'uniplus' } = {}) {
  const store = getStore();
  const at = new Date().toISOString();
  let changed = items;
  let missing = [];
  if (mode === 'full') {
    const existing = await store.list(C.products);
    const byId = new Map(existing.map(p => [p.id, p]));
    const incoming = new Set(items.map(i => i.id));
    changed = items.filter(item => {
      const current = byId.get(item.id);
      return !current || current.missingFromUniplus || productKey(current) !== productKey(item);
    });
    missing = existing.filter(p => !incoming.has(p.id) && !p.missingFromUniplus)
      .map(p => ({ id: p.id, missingFromUniplus: true, syncedAt: at }));
  }
  const docs = changed.map(item => ({ ...item, missingFromUniplus: false, syncedAt: at, source }));
  if (docs.length || missing.length) {
    await store.bulkSet(C.products, [...docs, ...missing]);
    invalidateProductCache();
    await touchCatalogProducts([...docs, ...missing].map(d => d.id));
  }
  return { received: items.length, written: docs.length, missing: missing.length, at, mode };
}

// Estado da integração: grava no máximo a cada 5 min (ou quando algo muda), para poupar escritas.
let lastStateAt = 0;
export async function recordUniplusHeartbeat(result, { force = false } = {}) {
  if (!force && !result.written && !result.missing && Date.now() - lastStateAt < 5 * 60_000) return;
  lastStateAt = Date.now();
  await setIntegrationState('uniplus', {
    status: 'connected', lastSyncAt: result.at, lastError: '',
    ...(result.mode === 'full' ? { itemCount: result.received, missingCount: result.missing } : {})
  });
}

// Sincronização dentro do servidor local: só manda ao banco o que mudou desde a última leitura;
// a cada UNIPLUS_FULL_SYNC_HOURS faz a conferência completa (inclui produtos que sumiram).
let running = false;
let lastSeen = new Map();
let lastFullAt = 0;
export async function syncUniplusOnce({ full = false } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    const items = await fetchUniplusCatalog();
    const doFull = full || !lastFullAt || Date.now() - lastFullAt > config.uniplus.fullSyncHours * 3600_000;
    const result = doFull ? await saveCatalog(items, { mode: 'full' }) : await saveCatalog(diffCatalog(lastSeen, items), { mode: 'partial' });
    if (doFull) { lastFullAt = Date.now(); result.received = items.length; }
    lastSeen = new Map(items.map(i => [i.id, productKey(i)]));
    await recordUniplusHeartbeat(result, { force: doFull });
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
    .then(r => !r.skipped && (r.written || r.missing || r.mode === 'full') && log.info?.(`[uniplus] ${r.mode === 'full' ? 'conferência completa' : 'atualização'}: ${r.written} produto(s) alterado(s), ${r.missing} ausente(s).`))
    .catch(error => log.error?.('[uniplus] falha na sincronização:', error.message));
  tick();
  const timer = setInterval(tick, config.uniplus.syncSeconds * 1000);
  return () => clearInterval(timer);
}
