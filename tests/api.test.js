// Teste de ponta a ponta da API no modo local: sobe o servidor com um UniPlus falso
// e percorre o fluxo produto → fila → aprovação → tentativa de publicação.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sr-test-'));
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sr-media-'));
fs.mkdirSync(path.join(mediaDir, 'produtos'));
fs.writeFileSync(path.join(mediaDir, 'produtos', 'foto.jpg'), 'x');

const products = [
  { id_produto: 1, sku: 'T-1', nome_produto: 'Produto de teste A', nome_categoria: 'Teste', preco: 100, preco_custo: 60, estoque: 5 },
  { id_produto: 2, sku: 'T-2', nome_produto: 'Produto de teste B', nome_categoria: 'Teste', preco: 50, estoque: 0 }
];
const mock = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: products }));
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
// Porta livre escolhida pelo sistema (evita colidir com outro programa).
const port = await new Promise(resolve => {
  const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env, DATA_BACKEND: 'local', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, MEDIA_DIR: mediaDir,
    UNIPLUS_API_URL: `http://127.0.0.1:${mock.address().port}`, UNIPLUS_SYNC_SECONDS: '3600',
    SESSION_SECRET: 'segredo-de-teste', LEADS_WEBHOOK_TOKEN: 'token-leads-teste', METRICS_SYNC_HOURS: '0',
    STORE_API_TOKEN: 'token-loja-teste', STORE_PUBLIC_URL: 'https://loja.teste', PORTAL_PUBLIC_URL: 'https://portal.teste'
  },
  stdio: 'pipe'
});

async function call(method, url, body, token) {
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('tempo esgotado');
}

test.after(() => {
  server.kill();
  mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

test('fluxo completo da fila no modo local', async () => {
  await waitFor(async () => (await call('GET', '/health')).status === 200);

  const setup = await call('POST', '/auth/setup', { name: 'Dono', email: 'dono@teste.localhost', password: 'senha-teste-1' });
  assert.equal(setup.status, 200);
  const owner = setup.body.token;
  assert.equal((await call('POST', '/auth/setup', { name: 'X', email: 'x@teste.localhost', password: 'senha-teste-1' })).status, 409);

  await call('POST', '/users', { name: 'Site', email: 'site@teste.localhost', role: 'site', password: 'senha-teste-2' }, owner);
  const site = (await call('POST', '/auth/login', { email: 'site@teste.localhost', password: 'senha-teste-2' })).body.token;
  assert.ok(site);
  assert.equal((await call('POST', '/auth/login', { email: 'site@teste.localhost', password: 'errada' })).status, 401);

  await waitFor(async () => (await call('GET', '/products', null, owner)).body.total === 2);

  // Site não escolhe produto; dono escolhe canais e preço em cada um.
  const channels = [{ id: 'site', price: 90, promoPrice: 80 }, { id: 'shopee', price: 110 }];
  assert.equal((await call('POST', '/queue', { productId: '1', channels }, site)).status, 403);
  assert.equal((await call('POST', '/queue', { productId: '1', channels: [] }, owner)).status, 400);
  const badPromo = await call('POST', '/queue', { productId: '1', channels: [{ id: 'site', price: 90, promoPrice: 95 }], promoStart: '2026-11-01', promoEnd: '2026-11-02' }, owner);
  assert.equal(badPromo.status, 400);
  assert.equal((await call('POST', '/queue', { productId: '1', channels }, owner)).status, 400); // promoção sem datas
  const selected = await call('POST', '/queue', { productId: '1', channels, promoStart: '2026-11-01', promoEnd: '2026-11-02' }, owner);
  assert.equal(selected.status, 200);
  const id = selected.body.item.id;
  // Shopee padrão: 20% + R$ 6 -> R$ 110 vira R$ 82 líquido.
  const shopee = selected.body.item.channels.find(c => c.id === 'shopee');
  assert.equal(shopee.fee, 28);
  assert.equal(shopee.net, 82);
  assert.equal((await call('POST', '/queue', { productId: '1', channels }, owner)).status, 409);

  // Sem conteúdo suficiente, não vai para aprovação.
  await call('POST', `/queue/${id}/transition`, { to: 'preparing' }, site);
  assert.equal((await call('POST', `/queue/${id}/transition`, { to: 'review' }, site)).status, 400);

  // Caminho de imagem fora de media/ é recusado.
  assert.equal((await call('PATCH', `/queue/${id}/content`, { imageRefs: ['../segredo.jpg'] }, site)).status, 400);
  const content = await call('PATCH', `/queue/${id}/content`, {
    title: 'Produto A', description: 'Descrição longa o suficiente para passar na validação.', imageRefs: ['produtos/foto.jpg']
  }, site);
  assert.equal(content.status, 200);
  // Com o canal Site próprio, os dados que o site exibe são cobrados antes da aprovação.
  const incomplete = await call('POST', `/queue/${id}/transition`, { to: 'review' }, site);
  assert.equal(incomplete.status, 400);
  assert.match(incomplete.body.message, /categoria do site/);
  const siteData = await call('PATCH', `/queue/${id}/content`, {
    brand: 'Marca X', pet: 'cao', siteCategory: 'racao-caes', measureValue: 15, measureUnit: 'kg', tag: '',
    short: 'Resumo do card', specs: 'Porte: Médio\nFase: Adulto'
  }, site);
  assert.equal(siteData.status, 200);
  assert.deepEqual(siteData.body.item.content.specs, [{ label: 'Porte', value: 'Médio' }, { label: 'Fase', value: 'Adulto' }]);
  assert.equal((await call('POST', `/queue/${id}/transition`, { to: 'review' }, site)).status, 200);

  // Site não aprova; dono aprova.
  assert.equal((await call('POST', `/queue/${id}/transition`, { to: 'approved' }, site)).status, 403);
  assert.equal((await call('POST', `/queue/${id}/transition`, { to: 'approved' }, owner)).status, 200);

  // Antes de publicar, o catálogo do site está vazio (rota pública, sem login).
  assert.equal((await call('GET', '/catalog')).body.products.length, 0);

  // Shopee: anúncio feito à mão, registrado com link. Site ainda pendente -> continua "aprovado".
  assert.equal((await call('POST', `/queue/${id}/listings/shopee`, { url: 'http://inseguro' }, site)).status, 400);
  assert.equal((await call('POST', `/queue/${id}/listings/shopee`, { url: 'https://shopee.com.br/p/1' }, site)).status, 200);
  assert.equal((await call('POST', `/queue/${id}/listings/site`, { url: 'https://loja.com/p' }, site)).status, 400);
  let after = await call('GET', `/queue/${id}`, null, owner);
  assert.equal(after.body.item.listings.shopee.manual, true);
  assert.equal(after.body.item.stage, 'approved');

  // Publicar no site próprio: entra no catálogo e, com todos os canais feitos, o item fica "Publicado".
  const published = await call('POST', `/queue/${id}/site`, null, site);
  assert.equal(published.status, 200);
  assert.equal(published.body.item.stage, 'published');
  assert.equal(published.body.item.listings.site.url, 'https://loja.teste/produto/produto-a');

  // Catálogo no formato `Product` do site (src/data/products.ts do projeto do site).
  const catalog = await call('GET', '/catalog');
  assert.equal(catalog.body.products.length, 1);
  const product = catalog.body.products[0];
  assert.equal(product.slug, 'produto-a');
  assert.equal(product.name, 'Produto A');
  assert.equal(product.brand, 'Marca X');
  assert.equal(product.category, 'racao-caes');
  assert.equal(product.pet, 'cao');
  assert.deepEqual(product.measure, { value: 15, unit: 'kg' });
  assert.equal(product.price, 90); // promoção ainda não começou (01/11)
  assert.equal(product.compareAt, undefined);
  assert.equal(product.stock, 5);
  assert.equal(product.image, 'https://portal.teste/api/store/images/produtos/foto.jpg');
  assert.equal((await call('GET', '/store/catalog/produto-a')).body.product.short, 'Resumo do card');
  const stock = await call('POST', '/catalog/stock-check', { items: [{ productId: id, qty: 9 }, { productId: 'nao-existe', qty: 1 }] });
  assert.deepEqual(stock.body, [{ productId: id, requested: 9, available: 5 }, { productId: 'nao-existe', requested: 1, available: 0 }]);

  // Foto do produto publicado é servida; outro arquivo não.
  const image = await fetch(base + '/api/store/images/produtos/foto.jpg');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(base + '/api/store/images/produtos/outra.jpg')).status, 404);

  // Novo preço: o site lê na hora; a Shopee fica marcada para atualizar o anúncio.
  await call('PATCH', `/queue/${id}/pricing`, { channels: [{ id: 'site', price: 95, promoPrice: 80 }, { id: 'shopee', price: 120 }] }, owner);
  assert.equal((await call('GET', '/catalog')).body.products[0].price, 95);
  after = await call('GET', `/queue/${id}`, null, owner);
  assert.equal(after.body.item.listings.shopee.needsUpdate, true);

  // Tirar do site: sai do catálogo e o item volta para "Aprovado".
  const removed = await call('DELETE', `/queue/${id}/listings/site`, null, site);
  assert.equal(removed.body.item.stage, 'approved');
  assert.equal((await call('GET', '/catalog')).body.products.length, 0);

  // Pedidos no formato `Order` do site: só com STORE_API_TOKEN; reenviar não duplica.
  const storeCall = (method, url, body, token) => fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  const order = {
    id: 'SR-100200', createdAt: '2026-10-29T14:00:00-03:00',
    customer: { name: 'Maria', email: 'maria@teste.localhost', cpf: '00000000000', phone: '34999990000' },
    items: [{ productId: id, sku: 'T-1', slug: 'produto-a', name: 'Produto A', brand: 'Marca X', image: '', measure: '15 kg', unitPrice: 95, qty: 2 }],
    delivery: { method: 'economica', label: 'Econômica', price: 20, days: [3, 6], address: { cep: '38400-000', street: 'Rua A', number: '10', district: 'Centro', city: 'Uberlândia', state: 'MG' } },
    payment: { method: 'pix', status: 'pendente', pixCode: 'copia-e-cola' },
    totals: { subtotal: 190, couponDiscount: 0, pixDiscount: 9.5, shipping: 20, total: 200.5 },
    status: 'aguardando_pagamento', timeline: [{ status: 'aguardando_pagamento', at: '2026-10-29T17:00:00.000Z' }]
  };
  assert.equal((await storeCall('POST', '/store/orders', order, 'token-errado-da-loja')).status, 401);
  assert.equal((await (await storeCall('POST', '/store/orders', order, 'token-loja-teste')).json()).status, 'aguardando_pagamento');
  assert.equal((await (await storeCall('POST', '/store/orders', order, 'token-loja-teste')).json()).timeline.length, 1);
  // Gateway confirmou o Pix.
  const paidOrder = await (await storeCall('PATCH', '/store/orders/SR-100200', { status: 'pago', payment: { status: 'aprovado' } }, 'token-loja-teste')).json();
  assert.equal(paidOrder.status, 'pago');
  assert.equal(paidOrder.payment.status, 'aprovado');
  // A equipe move o pedido no portal; envio exige rastreio; retirada não vale para entrega.
  const orderId = 'site-SR-100200';
  assert.equal((await call('POST', `/orders/${orderId}/move`, { to: 'separando' }, site)).status, 200);
  assert.equal((await call('POST', `/orders/${orderId}/move`, { to: 'pronto_retirada' }, site)).status, 400);
  assert.equal((await call('POST', `/orders/${orderId}/move`, { to: 'enviado' }, site)).status, 400);
  assert.equal((await call('POST', `/orders/${orderId}/move`, { to: 'enviado', trackingCode: 'BR123' }, site)).status, 200);
  // Reenvio do site não desfaz o andamento feito pela equipe; o site lê a etapa e o rastreio.
  await storeCall('POST', '/store/orders', { ...order, status: 'pago' }, 'token-loja-teste');
  const fromSite = await (await storeCall('GET', '/store/orders/SR-100200', null, 'token-loja-teste')).json();
  assert.equal(fromSite.status, 'enviado');
  assert.equal(fromSite.trackingCode, 'BR123');
  assert.deepEqual(fromSite.timeline.map(t => t.status), ['aguardando_pagamento', 'pago', 'separando', 'enviado']);
  const orders = await call('GET', '/orders', null, owner);
  assert.equal(orders.body.orders.length, 1);
  assert.deepEqual(orders.body.orders[0].transitions.map(t => t.to), ['entregue']);

  // Avisos do site viram leads.
  assert.equal((await (await storeCall('POST', '/store/restock-alerts', { sku: 'T-1', email: 'joao@teste.localhost' }, 'token-loja-teste')).json()).created, true);

  // Custo e margem não aparecem para o site.
  const siteView = await call('GET', `/queue/${id}`, null, site);
  assert.equal(siteView.body.item.channels[0].margin, undefined);

  // Histórico registrou as ações; site não lê o histórico completo.
  const audit = await call('GET', '/audit', null, owner);
  assert.ok(audit.body.entries.some(e => e.action === 'queue.select'));
  assert.equal((await call('GET', '/audit', null, site)).status, 403);

  // Leads de ferramentas externas: token obrigatório e contato repetido vira comentário.
  const inbound = (body, token) => fetch(base + '/api/leads/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  assert.equal((await inbound({ name: 'A', phone: '1' }, 'token-errado-qualquer')).status, 401);
  assert.equal((await (await inbound({ name: 'Ana', phone: '(34) 98888-1111' }, 'token-leads-teste')).json()).created, true);
  assert.equal((await (await inbound({ name: 'Ana', phone: '5534988881111', message: 'de novo' }, 'token-leads-teste')).json()).merged, true);

  // Promoção com pedido de arte junto: a arte nasce ligada à promoção.
  const promo = await call('POST', '/promotions', {
    name: 'Promo teste', start: '2026-11-01', end: '2026-11-05', channels: ['site'], items: [{ productId: '2', promoPrice: 40 }],
    art: { requested: true, deadline: '2026-10-30', briefing: 'Post com o preço novo' }
  }, owner);
  assert.equal(promo.status, 200);
  const art = await call('GET', '/arts/' + promo.body.record.createdArtId, null, owner);
  assert.equal(art.body.record.originType, 'promotion');
  assert.equal(art.body.record.originId, promo.body.record.id);

  // Só o dono altera taxas.
  assert.equal((await call('PUT', '/settings/channels', { items: [{ name: 'Site', percent: 5 }] }, site)).status, 403);

  // Desativar derruba a sessão na hora.
  const users = (await call('GET', '/users', null, owner)).body.users;
  const siteUser = users.find(u => u.email === 'site@teste.localhost');
  await call('PATCH', `/users/${siteUser.id}`, { active: false }, owner);
  assert.equal((await call('GET', '/auth/me', null, site)).status, 401);
});
