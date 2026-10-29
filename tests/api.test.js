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
  { id_produto: 1, sku: 'T-1', nome_produto: 'Produto de teste A', nome_categoria: 'Teste', preco: 100, estoque: 5 },
  { id_produto: 2, sku: 'T-2', nome_produto: 'Produto de teste B', nome_categoria: 'Teste', preco: 50, estoque: 0 }
];
const mock = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: products }));
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const port = 40000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env, DATA_BACKEND: 'local', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, MEDIA_DIR: mediaDir,
    UNIPLUS_API_URL: `http://127.0.0.1:${mock.address().port}`, UNIPLUS_SYNC_SECONDS: '3600',
    NUVEMSHOP_STORE_ID: '', NUVEMSHOP_ACCESS_TOKEN: '', SESSION_SECRET: 'segredo-de-teste'
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

  // Site não seleciona produto; dono seleciona com preço próprio e promoção.
  assert.equal((await call('POST', '/queue', { productId: '1' }, site)).status, 403);
  const badPromo = await call('POST', '/queue', { productId: '1', priceMode: 'custom', sitePrice: 90, promoPrice: 95, promoStart: '2026-11-01', promoEnd: '2026-11-02' }, owner);
  assert.equal(badPromo.status, 400);
  const selected = await call('POST', '/queue', { productId: '1', priceMode: 'custom', sitePrice: 90, promoPrice: 80, promoStart: '2026-11-01', promoEnd: '2026-11-02' }, owner);
  assert.equal(selected.status, 200);
  const id = selected.body.item.id;
  assert.equal((await call('POST', '/queue', { productId: '1' }, owner)).status, 409);

  // Sem conteúdo suficiente, não vai para aprovação.
  await call('POST', `/queue/${id}/transition`, { to: 'preparing' }, site);
  assert.equal((await call('POST', `/queue/${id}/transition`, { to: 'review' }, site)).status, 400);

  // Caminho de imagem fora de media/ é recusado.
  assert.equal((await call('PATCH', `/queue/${id}/content`, { imageRefs: ['../segredo.jpg'] }, site)).status, 400);
  const content = await call('PATCH', `/queue/${id}/content`, {
    title: 'Produto A', description: 'Descrição longa o suficiente para passar na validação.', imageRefs: ['produtos/foto.jpg']
  }, site);
  assert.equal(content.status, 200);
  assert.equal((await call('POST', `/queue/${id}/transition`, { to: 'review' }, site)).status, 200);

  // Site não aprova; dono aprova.
  assert.equal((await call('POST', `/queue/${id}/transition`, { to: 'approved' }, site)).status, 403);
  assert.equal((await call('POST', `/queue/${id}/transition`, { to: 'approved' }, owner)).status, 200);

  // Publicação sem Nuvemshop: recusa e mantém "aprovado", registrando a tentativa.
  const publish = await call('POST', `/queue/${id}/publish`, null, site);
  assert.equal(publish.status, 400);
  assert.equal(publish.body.details.code, 'NOT_CONFIGURED');
  const after = await call('GET', `/queue/${id}`, null, owner);
  assert.equal(after.body.item.stage, 'approved');
  assert.equal(after.body.item.publish.attempts, 1);

  // Histórico registrou as ações; site não lê o histórico completo.
  const audit = await call('GET', '/audit', null, owner);
  assert.ok(audit.body.entries.some(e => e.action === 'queue.select'));
  assert.equal((await call('GET', '/audit', null, site)).status, 403);

  // Desativar derruba a sessão na hora.
  const users = (await call('GET', '/users', null, owner)).body.users;
  const siteUser = users.find(u => u.email === 'site@teste.localhost');
  await call('PATCH', `/users/${siteUser.id}`, { active: false }, owner);
  assert.equal((await call('GET', '/auth/me', null, site)).status, 401);
});
