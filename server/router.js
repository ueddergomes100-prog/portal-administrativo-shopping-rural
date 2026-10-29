// Todas as rotas da API em um só lugar. Usado pelo servidor local (server.js)
// e pela função serverless da Vercel (api/index.js). Lista documentada em docs/API.md.
import { config } from './config.js';
import { HttpError, sendJson, readJsonBody, notFound, forbidden, badRequest } from './http.js';
import { authenticate, authenticateConnector, loginLocal, setupFirstOwner, needsSetup, publicUser, requireRole } from './auth.js';
import { listAudit, audit } from './audit.js';
import { listProducts, getProduct } from './services/products.js';
import { listQueue, getQueueItem, selectProduct, updatePricing, updateContent, transitionQueue, publishQueueItem } from './services/queue.js';
import { listRecords, getRecord, createRecord, updateRecord, transitionRecord, addNote, setArtFile, removeRecord } from './services/marketing.js';
import { listUsers, createUser, updateUser } from './services/users.js';
import { listOrders, syncOrders } from './services/orders.js';
import { listIntegrations, updateIntegrationSettings } from './services/integrations.js';
import { dashboard } from './services/dashboard.js';
import { syncUniplusOnce, saveCatalog, mapProduct } from './integrations/uniplus.js';
import { listMedia, mediaAvailable } from './media.js';

const ENTITY = '(campaigns|promotions|arts|leads)';

// [método, padrão, handler, opções]. `:nome` vira parâmetro. auth: 'user' (padrão) | 'public' | 'connector'.
const routes = [
  ['GET', '/api/health', () => ({ ok: true, backend: config.backend, time: new Date().toISOString() }), { auth: 'public' }],
  ['GET', '/api/config', async () => ({
    backend: config.backend,
    needsSetup: await needsSetup(),
    mediaAvailable: mediaAvailable(),
    firebase: config.backend === 'firestore' ? config.firebase.web : null
  }), { auth: 'public' }],

  // Autenticação (modo local). No modo firestore o login acontece no navegador via Firebase Auth.
  ['POST', '/api/auth/setup', ({ body }) => setupFirstOwner(body), { auth: 'public' }],
  ['POST', '/api/auth/login', ({ body }) => loginLocal(body), { auth: 'public' }],
  ['GET', '/api/auth/me', ({ user }) => ({ user: publicUser(user) })],

  ['GET', '/api/dashboard', ({ user }) => dashboard(user)],

  ['GET', '/api/users', async ({ user }) => ({ users: await listUsers(user) })],
  ['POST', '/api/users', async ({ user, body }) => ({ user: await createUser(user, body) })],
  ['PATCH', '/api/users/:id', async ({ user, params, body }) => ({ user: await updateUser(user, params.id, body) })],

  // Catálogo (somente leitura; escrita só pelo conector UniPlus)
  ['GET', '/api/products', ({ query }) => listProducts(query)],
  ['GET', '/api/products/:id', async ({ params }) => ({ product: await getProduct(params.id) })],
  ['POST', '/api/products/sync', async ({ user }) => {
    requireRole(user, ['owner', 'manager']);
    if (config.isVercel) throw badRequest('A sincronização roda na máquina da loja (npm run connector). Aqui só mostramos o último resultado.');
    const result = await syncUniplusOnce();
    await audit(user, { action: 'products.sync', entity: 'products', summary: `Sincronização manual do UniPlus: ${result.received ?? 0} produtos` });
    return result;
  }],
  ['POST', '/api/connector/uniplus/catalog', async ({ body }) => {
    const items = Array.isArray(body.items) ? body.items.map(i => (i.basePrice !== undefined ? i : mapProduct(i))).filter(Boolean) : null;
    if (!items) throw badRequest('Envie { items: [...] }.');
    return saveCatalog(items, 'connector');
  }, { auth: 'connector' }],

  // Fila de publicação
  ['GET', '/api/queue', async ({ user, query }) => ({ items: await listQueue(user, query) })],
  ['POST', '/api/queue', async ({ user, body }) => ({ item: await selectProduct(user, body) })],
  ['GET', '/api/queue/:id', async ({ user, params }) => ({ item: await getQueueItem(user, params.id) })],
  ['PATCH', '/api/queue/:id/pricing', async ({ user, params, body }) => ({ item: await updatePricing(user, params.id, body) })],
  ['PATCH', '/api/queue/:id/content', async ({ user, params, body }) => ({ item: await updateContent(user, params.id, body) })],
  ['POST', '/api/queue/:id/transition', async ({ user, params, body }) => ({ item: await transitionQueue(user, params.id, body) })],
  ['POST', '/api/queue/:id/publish', ({ user, params }) => publishQueueItem(user, params.id)],

  // Pedidos (Nuvemshop)
  ['GET', '/api/orders', () => listOrders()],
  ['POST', '/api/orders/sync', ({ user }) => syncOrders(user)],

  // Integrações
  ['GET', '/api/integrations', async () => ({ integrations: await listIntegrations() })],
  ['PATCH', '/api/integrations/:id', async ({ user, params, body }) => {
    requireRole(user, ['owner', 'manager']);
    const change = await updateIntegrationSettings(params.id, body);
    await audit(user, { action: 'integrations.settings', entity: 'integrations', entityId: params.id, summary: `Atualizou preferências de ${params.id}`, ...change });
    return { integrations: await listIntegrations() };
  }],

  // Histórico
  ['GET', '/api/audit', async ({ user, query }) => {
    if (!query.entityId && !['owner', 'manager'].includes(user.role)) throw forbidden('O histórico completo é visível para dono e gerente.');
    return { entries: await listAudit({ entity: query.entity, entityId: query.entityId, limit: Number(query.limit) || 100 }) };
  }],

  // Arquivos locais (somente no servidor da loja)
  ['GET', '/api/media', ({ query }) => listMedia({ search: query.search })],

  // Arte: referência do arquivo local
  ['PATCH', '/api/arts/:id/file', async ({ user, params, body }) => ({ record: await setArtFile(user, params.id, body.fileRef) })],

  // Campanhas, promoções, artes e leads (genérico)
  ['GET', `/api/:entity${ENTITY}`, async ({ user, params, query }) => ({ records: await listRecords(params.entity, user, query) })],
  ['POST', `/api/:entity${ENTITY}`, async ({ user, params, body }) => ({ record: await createRecord(params.entity, user, body) })],
  ['GET', `/api/:entity${ENTITY}/:id`, async ({ user, params }) => ({ record: await getRecord(params.entity, user, params.id) })],
  ['PATCH', `/api/:entity${ENTITY}/:id`, async ({ user, params, body }) => ({ record: await updateRecord(params.entity, user, params.id, body) })],
  ['DELETE', `/api/:entity${ENTITY}/:id`, async ({ user, params }) => { await removeRecord(params.entity, user, params.id); return { ok: true }; }],
  ['POST', `/api/:entity${ENTITY}/:id/transition`, async ({ user, params, body }) => ({ record: await transitionRecord(params.entity, user, params.id, body) })],
  ['POST', `/api/:entity${ENTITY}/:id/notes`, async ({ user, params, body }) => ({ record: await addNote(params.entity, user, params.id, body.text) })]
];

// Compila "/api/:entity(a|b)/:id" em regex com grupos nomeados.
const compiled = routes.map(([method, pattern, handler, options = {}]) => {
  const source = pattern.replace(/:(\w+)(\([^)]+\))?/g, (_, name, group) => `(?<${name}>${group ? group.slice(1, -1) : '[^/]+'})`);
  return { method, regex: new RegExp(`^${source}/?$`), handler, auth: options.auth || 'user' };
});

export async function handleApi(req, res, pathname, searchParams) {
  try {
    const candidates = compiled.filter(r => r.regex.test(pathname));
    if (!candidates.length) throw notFound('Rota da API não encontrada.');
    const route = candidates.find(r => r.method === req.method);
    if (!route) throw new HttpError(405, 'Método não permitido nesta rota.');
    const params = Object.fromEntries(Object.entries(pathname.match(route.regex).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    const query = Object.fromEntries(searchParams);
    let user = null;
    if (route.auth === 'user') user = await authenticate(req);
    if (route.auth === 'connector') user = authenticateConnector(req);
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJsonBody(req) : {};
    const result = await route.handler({ req, params, query, body, user });
    sendJson(res, 200, result ?? { ok: true });
  } catch (error) {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error('[api]', req.method, pathname, error);
    sendJson(res, status, {
      // Na nuvem o detalhe técnico fica só no log; no servidor da loja, mostrar ajuda a resolver.
      error: status >= 500 ? (config.isVercel ? 'Erro interno no servidor. O detalhe foi registrado no log.' : `Erro interno: ${error.message}`) : error.message,
      ...(error.details ? { details: error.details } : {})
    });
  }
}
