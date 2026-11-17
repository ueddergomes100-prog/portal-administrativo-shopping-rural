// "Cada um faz a sua parte" (Ajustes → Equipe, settings/workflow): com a caixinha marcada, o dono escolhe
// (um ou vários) e aprova; só a pessoa de Vendas na internet cadastra e coloca à venda. Desmarcada (padrão),
// o dono faz tudo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-divisao-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';

const { getStore, C } = await import('../server/store/index.js');
const { getWorkflow, updateWorkflow } = await import('../server/services/settings.js');
const { selectProduct, bulkSelect, bulkPrepare, updateContent, transitionQueue, getQueueItem } = await import('../server/services/queue.js');

const owner = { id: 'dono', name: 'Dono', role: 'owner', active: true };
const manager = { id: 'gerente', name: 'Gerente', role: 'manager', canApprove: true, active: true };
const site = { id: 'vendas', name: 'Vendas', role: 'site', active: true };
const products = [1, 2, 3, 4].map(n => ({ id: `p${n}`, sku: `S-${n}`, name: `Produto ${n}`, category: 'Teste', unit: 'UN', basePrice: 10 * n, cost: 5 * n, stock: 4 }));
const content = {
  title: 'Produto no site', description: 'Descrição longa o bastante para passar na regra do site.',
  imageRefs: ['https://exemplo.public.blob.vercel-storage.com/a.webp'], brand: 'Marca', siteCategory: 'petiscos', pet: 'cao',
  measureValue: 1, measureUnit: 'kg', short: 'Resumo'
};

test('desmarcada (padrão): o dono escolhe e também cadastra', async () => {
  await getStore().bulkSet(C.products, products);
  await getStore().set(C.users, owner.id, owner);
  assert.deepEqual(await getWorkflow(), { split: false });

  const item = await selectProduct(owner, { productId: 'p1', channels: [{ id: 'site' }] });
  assert.equal(item.can.editContent, true);
  assert.ok(item.transitions.some(t => t.to === 'preparing'));
  const saved = await updateContent(owner, item.id, content);
  assert.equal(saved.content.brand, 'Marca');
});

test('só o dono marca, e só com alguém em Vendas na internet', async () => {
  await assert.rejects(() => updateWorkflow(manager, { split: true }), /Só o dono/);
  await assert.rejects(() => updateWorkflow(owner, { split: true }), /Vendas na internet/);
  await getStore().set(C.users, site.id, site);
  assert.deepEqual(await updateWorkflow(owner, { split: true }), { split: true });
  assert.deepEqual(await getWorkflow(), { split: true });
});

test('marcada: o dono manda preparar vários; só Vendas na internet cadastra; o dono aprova', async () => {
  // Vários de uma vez: entram em Anúncios como "Escolhido", com o preço da loja.
  const sent = await bulkSelect(owner, { productIds: ['p2', 'p3', 'p1'], channels: ['site'], notes: 'Fundo branco' });
  assert.deepEqual(sent.results.map(r => r.ok), [true, true, false]); // p1 já estava em Anúncios
  const [p2, p3] = sent.results;
  assert.equal((await getQueueItem(owner, p2.id)).channels[0].price, 20);
  await assert.rejects(() => bulkSelect(site, { productIds: ['p4'], channels: ['site'] }), /Só o dono/);

  // O dono não cadastra nem pela ficha nem pela grade (e a grade não deixa nada pela metade).
  const ownerView = await getQueueItem(owner, p2.id);
  assert.equal(ownerView.stage, 'selected');
  assert.equal(ownerView.can.editContent, false);
  assert.ok(!ownerView.transitions.some(t => t.to === 'preparing'));
  await assert.rejects(() => updateContent(owner, p2.id, content), /Vendas na internet/);
  await assert.rejects(() => transitionQueue(owner, p2.id, { to: 'preparing' }), /Vendas na internet/);
  await assert.rejects(() => bulkPrepare(owner, { publish: true, items: [{ productId: 'p4', price: 40, content }] }), /Vendas na internet/);
  assert.equal((await getStore().list(C.queue)).some(i => i.productId === 'p4'), false);

  // Vendas na internet cadastra e manda para aprovação; o dono aprova; ela coloca à venda.
  assert.equal((await getQueueItem(site, p2.id)).can.editContent, true);
  await updateContent(site, p2.id, content);
  await transitionQueue(site, p2.id, { to: 'review' });
  await assert.rejects(() => transitionQueue(site, p2.id, { to: 'approved' }));
  const approved = await transitionQueue(owner, p2.id, { to: 'approved' });
  assert.equal(approved.stage, 'approved');
  assert.equal(approved.can.publish, false);
  assert.equal((await getQueueItem(site, p2.id)).can.publish, true);

  // Gerente que aprova também só escolhe e aprova.
  assert.equal((await getQueueItem(manager, p3.id)).can.editContent, false);
});

test('desmarcar devolve tudo ao dono', async () => {
  assert.deepEqual(await updateWorkflow(owner, { split: false }), { split: false });
  const item = (await getStore().list(C.queue)).find(i => i.productId === 'p3');
  assert.equal((await getQueueItem(owner, item.id)).can.editContent, true);
  await updateContent(owner, item.id, content);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
