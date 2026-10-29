// Todas as rotas da API em um só lugar. Usado pelo servidor local (server.js)
// e pela função serverless da Vercel (api/index.js). Lista documentada em docs/API.md.
import { config } from './config.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { HttpError, sendJson, readJsonBody, notFound, forbidden, badRequest, unauthorized } from './http.js';
import { authenticate, authenticateConnector, loginLocal, setupFirstOwner, needsSetup, publicUser, requireRole } from './auth.js';
import { listAudit, audit } from './audit.js';
import { listProducts, getProduct, forUser } from './services/products.js';
import { listQueue, getQueueItem, selectProduct, updatePricing, updateContent, transitionQueue, publishToSite, recordListing, removeListing } from './services/queue.js';
import {
  listCatalog, getCatalogItem, stockCheck, siteImage, upsertSiteOrder, updateSiteOrder, getSiteOrder, moveOrder,
  siteContact, siteNewsletter, siteRestockAlert
} from './services/store.js';
import { listRecords, getRecord, createRecord, updateRecord, transitionRecord, addNote, setArtFile, removeRecord } from './services/marketing.js';
import { listUsers, createUser, updateUser } from './services/users.js';
import { listOrders } from './services/orders.js';
import { getChannels, updateChannels } from './services/settings.js';
import { listMetrics, syncMetrics } from './services/metrics.js';
import { receiveLead, importMetaLeads } from './services/leads-inbound.js';
import { listIntegrations, updateIntegrationSettings } from './services/integrations.js';
import { dashboard } from './services/dashboard.js';
import { syncUniplusOnce, saveCatalog, mapProduct } from './integrations/uniplus.js';
import { listMedia, mediaAvailable } from './media.js';

const ENTITY = '(campaigns|promotions|arts|leads)';

// [método, padrão, handler, opções]. `:nome` vira parâmetro.
// auth: 'user' (padrão) | 'public' | 'connector' | 'leads' (LEADS_WEBHOOK_TOKEN) | 'store' (STORE_API_TOKEN).
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
  ['GET', '/api/products', ({ query, user }) => listProducts(query, user)],
  ['GET', '/api/products/:id', async ({ params, user }) => ({ product: forUser(await getProduct(params.id), user) })],
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
  ['POST', '/api/queue/:id/site', async ({ user, params }) => ({ item: await publishToSite(user, params.id) })],
  ['POST', '/api/queue/:id/listings/:channel', async ({ user, params, body }) => ({ item: await recordListing(user, params.id, params.channel, body) })],
  ['DELETE', '/api/queue/:id/listings/:channel', async ({ user, params }) => ({ item: await removeListing(user, params.id, params.channel) })],

  // API do site próprio (contrato em docs/SITE.md) — mesmos formatos do projeto do site.
  // Catálogo: leitura pública (também em /api/catalog, o caminho que o site já usa).
  ['GET', '/api/store/catalog', () => listCatalog(), { auth: 'public', cors: true }],
  ['GET', '/api/catalog', () => listCatalog(), { auth: 'public', cors: true }],
  ['GET', '/api/store/catalog/:slug', async ({ params }) => ({ product: await getCatalogItem(params.slug) }), { auth: 'public', cors: true }],
  ['POST', '/api/store/catalog/stock-check', ({ body }) => stockCheck(body), { auth: 'public', cors: true }],
  ['POST', '/api/catalog/stock-check', ({ body }) => stockCheck(body), { auth: 'public', cors: true }],
  ['GET', '/api/store/images/:ref(.+)', async ({ params }) => ({ __file: await siteImage(params.ref) }), { auth: 'public', cors: true }],
  // Pedidos e avisos: só o SERVIDOR do site, com STORE_API_TOKEN.
  ['POST', '/api/store/orders', ({ body }) => upsertSiteOrder(body), { auth: 'store' }],
  ['GET', '/api/store/orders/:id', ({ params }) => getSiteOrder(params.id), { auth: 'store' }],
  ['PATCH', '/api/store/orders/:id', ({ params, body }) => updateSiteOrder(params.id, body), { auth: 'store' }],
  ['POST', '/api/store/contact', ({ body }) => siteContact(body), { auth: 'store' }],
  ['POST', '/api/store/newsletter', ({ body }) => siteNewsletter(body), { auth: 'store' }],
  ['POST', '/api/store/restock-alerts', ({ body }) => siteRestockAlert(body), { auth: 'store' }],

  // Canais de venda e taxas
  ['GET', '/api/settings/channels', async () => ({ channels: await getChannels() })],
  ['PUT', '/api/settings/channels', async ({ user, body }) => ({ channels: await updateChannels(user, body) })],

  // Indicadores de mídia (GA4, Google Ads, Meta Ads)
  ['GET', '/api/metrics', async () => ({ metrics: await listMetrics() })],
  ['POST', '/api/metrics/:source/sync', async ({ user, params }) => {
    requireRole(user, ['owner', 'manager', 'marketing']);
    return { report: await syncMetrics(params.source, user) };
  }],

  // Entrada de leads: ferramentas externas e Meta Lead Ads
  ['POST', '/api/leads/inbound', ({ body }) => receiveLead(body, { source: 'Site' }), { auth: 'leads' }],
  ['POST', '/api/leads/import-meta', async ({ user }) => {
    requireRole(user, ['owner', 'manager', 'marketing']);
    try { return await importMetaLeads(user); } catch (error) { throw badRequest(error.message, { code: error.code }); }
  }],

  // Pedidos (chegam do site próprio; a equipe move o andamento)
  ['GET', '/api/orders', ({ user }) => listOrders(user)],
  ['POST', '/api/orders/:id/move', async ({ user, params, body }) => ({ order: await moveOrder(user, params.id, body) })],

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
  return { method, regex: new RegExp(`^${source}/?$`), handler, auth: options.auth || 'user', cors: !!options.cors };
});

// Token de ferramentas externas: cabeçalho Authorization: Bearer <token> (ou ?token=<token> para leads).
function checkToken(req, query, expected, name) {
  if (!expected) throw forbidden(`${name} não configurado no servidor.`);
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(query.token || '');
  if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw unauthorized(`Token inválido (${name}).`);
}

// Catálogo lido direto pelo navegador do site: libera só as origens de STORE_ALLOWED_ORIGINS.
function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowed = config.store.allowedOrigins;
  if (!origin || !(allowed.includes('*') || allowed.includes(origin))) return {};
  return { 'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
}

export async function handleApi(req, res, pathname, searchParams) {
  let extraHeaders = {};
  try {
    const candidates = compiled.filter(r => r.regex.test(pathname));
    if (!candidates.length) throw notFound('Rota da API não encontrada.');
    if (req.method === 'OPTIONS' && candidates.some(r => r.cors)) {
      res.writeHead(204, { ...corsHeaders(req), 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    const route = candidates.find(r => r.method === req.method);
    if (!route) throw new HttpError(405, 'Método não permitido nesta rota.');
    extraHeaders = route.cors ? corsHeaders(req) : {};
    const params = Object.fromEntries(Object.entries(pathname.match(route.regex).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    const query = Object.fromEntries(searchParams);
    let user = null;
    if (route.auth === 'user') user = await authenticate(req);
    if (route.auth === 'connector') user = authenticateConnector(req);
    if (route.auth === 'leads') checkToken(req, query, config.leadsWebhookToken, 'LEADS_WEBHOOK_TOKEN');
    if (route.auth === 'store') checkToken(req, {}, config.store.apiToken, 'STORE_API_TOKEN');
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJsonBody(req) : {};
    const result = await route.handler({ req, params, query, body, user });
    if (result?.__file) {
      // Imagem do catálogo: cache de 1 h no navegador/CDN do site.
      res.writeHead(200, { ...extraHeaders, 'Content-Type': result.__file.type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return void fs.createReadStream(result.__file.full).pipe(res);
    }
    sendJson(res, 200, result ?? { ok: true }, extraHeaders);
  } catch (error) {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error('[api]', req.method, pathname, error);
    // Na nuvem o detalhe técnico fica só no log; no servidor da loja, mostrar ajuda a resolver.
    const message = status >= 500 ? (config.isVercel ? 'Erro interno no servidor. O detalhe foi registrado no log.' : `Erro interno: ${error.message}`) : error.message;
    // `message` é o campo que o site lê nos erros; `error` é o do portal.
    sendJson(res, status, { error: message, message, ...(error.details ? { details: error.details } : {}) }, extraHeaders);
  }
}
