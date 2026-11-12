// Promoção ligada aos anúncios (site automático; Shopee/ML por tarefa) e categorias editáveis do site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-promo-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';

const { getStore, C } = await import('../server/store/index.js');
const { createRecord, transitionRecord, updateRecord, removeRecord } = await import('../server/services/marketing.js');
const { markChannelTask, promotionCandidates } = await import('../server/services/promotion-channels.js');
const { updateSiteCategories, listSiteCategories } = await import('../server/services/categories.js');
const { rebuildCatalog } = await import('../server/services/catalog.js');
const { listCatalog } = await import('../server/services/store.js');
const { todayInSaoPaulo } = await import('../public/shared/domain.js');

const owner = { id: 'dono', name: 'Dono', role: 'owner', canApprove: true };
const today = todayInSaoPaulo();
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

const anuncio = (id, sku, { site = 100, shopee = 120, category = 'petiscos' } = {}) => ({
  id, productId: `p-${sku}`, stage: 'published', slug: `produto-${sku}`, priority: 'Normal',
  productSnapshot: { sku, name: `Produto ${sku}`, basePrice: 90, stock: 10, cost: 50 },
  channels: [
    { id: 'site', name: 'Site próprio', integration: 'site', price: site, promoPrice: null },
    { id: 'shopee', name: 'Shopee', integration: null, price: shopee, promoPrice: null }
  ],
  listings: { site: { status: 'done' }, shopee: { status: 'done', url: 'https://shopee.com.br/x' } },
  content: { title: `Produto ${sku} no site`, description: 'Descrição longa o bastante.', imageRefs: [], brand: 'Marca', siteCategory: category, pet: 'cao', measureValue: 1, measureUnit: 'un', weightKg: 0.3, short: 'Resumo' },
  promoStart: '', promoEnd: ''
});

test('promoção aprovada entra no site, vira tarefa na Shopee e sai ao cancelar', async () => {
  const store = getStore();
  await store.bulkSet(C.products, [
    { id: 'p-A1', sku: 'A1', name: 'Produto A1', basePrice: 90, cost: 50, stock: 10 },
    { id: 'p-B2', sku: 'B2', name: 'Produto B2', basePrice: 90, cost: 50, stock: 10 }
  ]);
  await store.bulkSet(C.queue, [anuncio('q1', 'A1'), anuncio('q2', 'B2')]);
  await rebuildCatalog();

  // Só aparecem anúncios à venda no lugar escolhido, com o preço de cada lugar.
  const cand = await promotionCandidates(owner, { channels: 'shopee', search: 'a1' });
  assert.deepEqual(cand.items.map(i => [i.queueId, i.prices.shopee]), [['q1', 120]]);

  // Preço da promoção precisa ser menor que o preço normal de cada lugar.
  await assert.rejects(() => createRecord('promotions', owner, { name: 'X', start: today, end: addDays(today, 5), channels: ['site', 'shopee'], items: [{ queueId: 'q1', prices: { site: 90, shopee: 130 } }] }), /Shopee o preço normal é R\$\s?120,00/);

  const promo = await createRecord('promotions', owner, {
    name: 'Semana do pet', start: today, end: addDays(today, 5), channels: ['site', 'shopee'],
    items: [{ queueId: 'q1', prices: { site: 90, shopee: 108 } }]
  });
  assert.deepEqual(promo.items[0].channels, { site: { regularPrice: 100, promoPrice: 90 }, shopee: { regularPrice: 120, promoPrice: 108 } });

  await transitionRecord('promotions', owner, promo.id, { to: 'awaiting_approval' });
  const approved = await transitionRecord('promotions', owner, promo.id, { to: 'approved' });
  assert.equal(approved.channelTasks.shopee.status, 'pending');
  assert.equal(approved.channelTasks.site, undefined);

  // No anúncio: preço de promoção só no site, com as datas; a Shopee não é marcada "atualizar anúncio".
  const q1 = await store.get(C.queue, 'q1');
  assert.equal(q1.channels.find(c => c.id === 'site').promoPrice, 90);
  assert.equal(q1.channels.find(c => c.id === 'shopee').promoPrice, null);
  assert.deepEqual([q1.promoStart, q1.promoEnd], [today, addDays(today, 5)]);
  assert.equal(q1.promotion.id, promo.id);
  assert.ok(!q1.listings.shopee.needsUpdate);
  const onSite = (await listCatalog()).products.find(p => p.sku === 'A1');
  assert.deepEqual([onSite.price, onSite.compareAt], [90, 100]);

  // Outra promoção no mesmo anúncio e período: não aprova.
  const other = await createRecord('promotions', owner, { name: 'Outra', start: addDays(today, 2), end: addDays(today, 3), channels: ['site'], items: [{ queueId: 'q1', prices: { site: 85 } }] });
  await transitionRecord('promotions', owner, other.id, { to: 'awaiting_approval' });
  await assert.rejects(() => transitionRecord('promotions', owner, other.id, { to: 'approved' }), /Semana do pet/);

  // Aprovada não se apaga (cancela).
  await assert.rejects(() => removeRecord('promotions', owner, promo.id), /Cancelar/);

  // Equipe cadastra na Shopee e marca como feito.
  await markChannelTask(owner, promo.id, { channel: 'shopee' });
  assert.equal((await store.get(C.promotions, promo.id)).channelTasks.shopee.status, 'done');

  // Cancelar: sai do site e a Shopee vira "tirar a promoção".
  const cancelled = await transitionRecord('promotions', owner, promo.id, { to: 'cancelled', note: 'Mudou o plano' });
  assert.equal(cancelled.channelTasks.shopee.status, 'undo');
  const back = await store.get(C.queue, 'q1');
  assert.equal(back.channels.find(c => c.id === 'site').promoPrice, null);
  assert.equal(back.promotion, null);
  assert.equal((await listCatalog()).products.find(p => p.sku === 'A1').price, 100);
  await markChannelTask(owner, promo.id, { channel: 'shopee' });
  assert.deepEqual((await store.get(C.promotions, promo.id)).channelTasks, {});

  // Depois de cancelada a primeira, a outra aprova.
  const ok = await transitionRecord('promotions', owner, other.id, { to: 'approved' });
  assert.equal(ok.status, 'approved');
  // Editar a aprovada: volta a rascunho e sai do site.
  const edited = await updateRecord('promotions', owner, other.id, { name: 'Outra (editada)' });
  assert.equal(edited.status, 'draft');
  assert.equal((await store.get(C.queue, 'q1')).channels.find(c => c.id === 'site').promoPrice, null);

  // Promoção antiga (produto do UniPlus, um preço só): ao aprovar, vira o formato novo e entra no site.
  const legacy = await store.create(C.promotions, {
    name: 'Antiga', start: today, end: addDays(today, 2), status: 'awaiting_approval', channels: ['site'], notes: [],
    items: [{ productId: 'p-B2', sku: 'B2', name: 'Produto B2', regularPrice: 90, promoPrice: 80 }]
  });
  const converted = await transitionRecord('promotions', owner, legacy.id, { to: 'approved' });
  assert.deepEqual(converted.items[0].channels, { site: { regularPrice: 100, promoPrice: 80 } });
  assert.equal((await store.get(C.queue, 'q2')).channels.find(c => c.id === 'site').promoPrice, 80);
});

test('categorias: criar, esconder (some do site com os produtos) e apagar movendo os produtos', async () => {
  const store = getStore();
  const { items } = await listSiteCategories(owner);
  assert.ok(items.some(c => c.id === 'petiscos'));

  const next = [...items.map(c => (c.id === 'petiscos' ? { ...c, name: 'Petiscos e ossinhos' } : c)), { name: 'Rações para bovinos', short: 'Bovinos', icon: 'cow', active: true }];
  const saved = await updateSiteCategories(owner, { items: next });
  const bov = saved.items.find(c => c.name === 'Rações para bovinos');
  assert.equal(bov.id, 'racoes-para-bovinos');
  let catalog = await listCatalog();
  assert.equal(catalog.categories.find(c => c.id === 'petiscos').name, 'Petiscos e ossinhos');

  // Escondida: a categoria e os produtos dela somem do site.
  await updateSiteCategories(owner, { items: saved.items.map(c => (c.id === 'petiscos' ? { ...c, active: false } : c)) });
  catalog = await listCatalog();
  assert.ok(!catalog.categories.some(c => c.id === 'petiscos'));
  assert.ok(!catalog.products.some(p => p.sku === 'A1'));

  // Apagar com produtos: só dizendo para onde vão.
  const without = saved.items.filter(c => c.id !== 'petiscos');
  await assert.rejects(() => updateSiteCategories(owner, { items: without }), /tem 2 produto/);
  const moved = await updateSiteCategories(owner, { items: without, moves: { petiscos: bov.id } });
  assert.equal(moved.moved, 2);
  assert.equal((await store.get(C.queue, 'q1')).content.siteCategory, bov.id);
  catalog = await listCatalog();
  assert.equal(catalog.products.find(p => p.sku === 'A1').category, bov.id);

  await assert.rejects(() => updateSiteCategories({ ...owner, role: 'site' }, { items: without }), /dono ou o gerente/);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
