// Avisos no celular (server/services/push.js): cada passo do anúncio avisa só quem precisa agir,
// nunca quem fez a ação; lote vira um aviso só; aparelho que sumiu é apagado; falha no aviso não
// derruba a ação.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-avisos-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';

const { getStore, C } = await import('../server/store/index.js');
const { setPushSender, savePushToken, testPush, notify } = await import('../server/services/push.js');
const { selectProduct, bulkSelect, updateContent, transitionQueue } = await import('../server/services/queue.js');

const owner = { id: 'dono', name: 'Dono', role: 'owner', active: true };
const approver = { id: 'gerente', name: 'Gerente', role: 'manager', canApprove: true, active: true };
const manager = { id: 'gerente2', name: 'Gerente 2', role: 'manager', canApprove: false, active: true };
const site = { id: 'vendas', name: 'Vendas', role: 'site', active: true };
const gone = { id: 'saiu', name: 'Saiu', role: 'site', active: false };
const content = {
  title: 'No site', description: 'Descrição longa o bastante para passar na regra do site.',
  imageRefs: ['https://exemplo.public.blob.vercel-storage.com/a.webp'], brand: 'Marca', siteCategory: 'petiscos', pet: 'cao',
  measureValue: 1, measureUnit: 'kg', short: 'Resumo'
};

// Envio de mentira: guarda o que seria mandado. `failWith` simula resposta do Firebase por token.
let outbox = [];
let failWith = {};
setPushSender(async (tokens, data) => {
  outbox.push({ tokens: [...tokens].sort(), ...data });
  return tokens.map(t => failWith[t] || null);
});
const take = () => { const sent = outbox; outbox = []; return sent; };

test('preparação: dados e aparelhos', async () => {
  const store = getStore();
  for (const u of [owner, approver, manager, site, gone]) await store.set(C.users, u.id, u);
  await store.bulkSet(C.products, [1, 2, 3, 4, 5, 6].map(n => ({ id: `p${n}`, sku: `S-${n}`, name: `Produto ${n}`, category: 'Teste', unit: 'UN', basePrice: 10 * n, stock: 3 })));
  for (const u of [owner, approver, manager, site, gone]) await savePushToken(u, { token: `token-${u.id}`, device: 'Android' });
  take();
});

test('pedido de um produto: só Vendas na internet (ativa) recebe', async () => {
  const item = await selectProduct(owner, { productId: 'p1', channels: [{ id: 'site' }] });
  const [msg, ...rest] = take();
  assert.equal(rest.length, 0);
  assert.deepEqual(msg.tokens, ['token-vendas']);
  assert.equal(msg.title, 'Novo produto para preparar');
  assert.match(msg.body, /Produto 1/);
  assert.equal(msg.url, `/#/fila/${item.id}`);
});

test('mandar preparar vários: um aviso só para o lote', async () => {
  await bulkSelect(owner, { productIds: ['p2', 'p3', 'p4'], channels: ['site'] });
  const sent = take();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, '3 produtos para preparar');
  assert.match(sent[0].body, /Produto 2, Produto 3, Produto 4/);
  assert.equal(sent[0].url, '/#/fila');
});

test('pronto para aprovar: dono e gerente que aprova; aprovado e correção: Vendas na internet', async () => {
  const items = await getStore().list(C.queue);
  const a = items.find(i => i.productId === 'p2');
  const b = items.find(i => i.productId === 'p3');
  for (const item of [a, b]) {
    await updateContent(site, item.id, content);
    await transitionQueue(site, item.id, { to: 'review' });
  }
  const review = take();
  assert.equal(review.length, 2);
  assert.deepEqual(review[0].tokens, ['token-dono', 'token-gerente']); // não o gerente sem aprovação nem quem mandou
  assert.equal(review[0].title, 'Anúncio esperando sua aprovação');

  await transitionQueue(owner, a.id, { to: 'approved' });
  const [approved] = take();
  assert.deepEqual(approved.tokens, ['token-vendas']);
  assert.equal(approved.title, 'Anúncio aprovado');

  await transitionQueue(approver, b.id, { to: 'preparing', note: 'Trocar a foto principal' });
  const [fix] = take();
  assert.deepEqual(fix.tokens, ['token-vendas']);
  assert.equal(fix.title, 'Correção pedida');
  assert.match(fix.body, /Trocar a foto principal/);
});

test('aparelho que o Firebase diz não existir mais é apagado', async () => {
  failWith = { 'token-vendas': 'messaging/registration-token-not-registered' };
  await selectProduct(owner, { productId: 'p5', channels: [{ id: 'site' }] });
  failWith = {};
  take();
  const devices = await getStore().list(C.pushTokens);
  assert.equal(devices.some(d => d.userId === 'vendas'), false);
  await assert.rejects(() => testPush(site), /Nenhum aparelho/);
});

test('falha no envio nunca derruba a ação', async () => {
  setPushSender(async () => { throw new Error('Firebase fora do ar'); });
  await savePushToken(site, { token: 'token-vendas-2' });
  const item = await selectProduct(owner, { productId: 'p6', channels: [{ id: 'site' }] });
  assert.equal(item.stage, 'selected');
  assert.deepEqual(await notify({ to: { roles: ['site'] }, title: 'x' }), { sent: 0 });
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
