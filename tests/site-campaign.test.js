// Campanha do site (Black Friday, Natal, Ano Novo): o portal guarda uma por tema e o catálogo do site
// recebe só a que vale agora. Sem nada salvo, o campo não vai (o site usa o modo automático dele).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-camp-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';

const { getStore, C } = await import('../server/store/index.js');
const { listCatalog } = await import('../server/services/store.js');
const { campaignScreen, updateSiteCampaigns, campaignForSite } = await import('../server/services/site-campaign.js');

const owner = { id: 'dono', name: 'Dono', role: 'owner' };
const products = async () => (await listCatalog()).products;
const entry = (sku, price, promoPrice = null) => ({
  id: `q-${sku}`, productId: sku, sku, slug: `p-${sku}`, name: `Produto ${sku}`, brand: '', category: 'petiscos', pet: 'cao',
  measure: { value: 1, unit: 'un' }, weightKg: 0.5, dims: null, tag: '', short: '', description: '', specs: [], imageRefs: [],
  seoTitle: '', seoDescription: '', price, promoPrice, promoStart: promoPrice ? '2020-01-01' : '', promoEnd: promoPrice ? '2099-12-31' : '', factor: 1, stock: 10, updatedAt: ''
});
// Horário de Brasília, como o portal guarda.
const brt = msFromNow => `${new Date(Date.now() + msFromNow - 3 * 3600_000).toISOString().slice(0, 19)}-03:00`;
const DAY = 86_400_000;
const camp = (extra = {}) => ({ enabled: true, startsAt: '', endsAt: brt(3 * DAY), title: '', subtitle: '', heroSkus: [], popup: { enabled: true, sku: '', title: '', text: '' }, ...extra });
const off = { enabled: false };

test('sem nada salvo, o catálogo não manda campaign; a tela já sugere as datas', async () => {
  await getStore().set(C.settings, 'catalog', { generatedAt: '', items: [entry('A', 100, 80), entry('B', 50), entry('C', 200, 150)] });
  const catalog = await listCatalog();
  assert.equal(catalog.products.length, 3);
  assert.equal('campaign' in catalog, false);
  const screen = await campaignScreen(owner, products);
  assert.equal(screen.saved, false);
  assert.deepEqual(Object.keys(screen.items), ['black-friday', 'natal', 'ano-novo']);
  assert.equal(screen.products.find(p => p.sku === 'C').discount, 25);
});

test('Black Friday ligada agora vai no catálogo; desligada vira { enabled: false }', async () => {
  const saved = await updateSiteCampaigns(owner, { items: {
    'black-friday': camp({ title: 'Black Friday Rural', heroSkus: ['C', 'A', 'C'], popup: { enabled: true, sku: 'A', title: 'Imperdível', text: 'Só até domingo' } }),
    natal: { ...camp(), enabled: false }, 'ano-novo': { ...camp(), enabled: false }
  } }, products);
  assert.equal(saved.live, 'black-friday');
  const { campaign } = await listCatalog();
  assert.equal(campaign.theme, 'black-friday');
  assert.equal(campaign.enabled, true);
  assert.equal(campaign.title, 'Black Friday Rural');
  assert.match(campaign.endsAt, /-03:00$/);
  assert.equal(campaign.startsAt, null);
  assert.deepEqual(campaign.heroSkus, ['C', 'A']);
  assert.deepEqual(campaign.popup, { enabled: true, sku: 'A', title: 'Imperdível', text: 'Só até domingo' });
  assert.equal('subtitle' in campaign, false);

  // Produto que saiu do site some dos destaques (e do aviso) sem quebrar nada.
  const lessProducts = (await products()).filter(p => p.sku !== 'A');
  const trimmed = await campaignForSite(lessProducts);
  assert.deepEqual([trimmed.heroSkus, trimmed.popup.sku], [['C'], undefined]);

  await updateSiteCampaigns(owner, { items: { 'black-friday': { ...camp(), enabled: false }, natal: off, 'ano-novo': off } }, products);
  assert.deepEqual((await listCatalog()).campaign, { enabled: false });
});

test('Natal agendado: ainda não vale agora, vale na data; não pode cruzar com a Black Friday', async () => {
  await updateSiteCampaigns(owner, { items: {
    'black-friday': camp({ endsAt: brt(2 * DAY) }),
    natal: camp({ startsAt: brt(2 * DAY), endsAt: brt(10 * DAY) }),
    'ano-novo': off
  } }, products);
  assert.equal((await listCatalog()).campaign.theme, 'black-friday');
  const later = await campaignForSite(await products(), Date.now() + 3 * DAY);
  assert.equal(later.theme, 'natal');

  await assert.rejects(() => updateSiteCampaigns(owner, { items: {
    'black-friday': camp({ endsAt: brt(5 * DAY) }), natal: camp({ startsAt: brt(2 * DAY), endsAt: brt(10 * DAY) }), 'ano-novo': off
  } }, products), /Black Friday e Natal estão ligadas ao mesmo tempo/);
});

test('o que não faz sentido é recusado; só dono, gerente e marketing mexem', async () => {
  const items = extra => ({ items: { 'black-friday': camp(extra), natal: off, 'ano-novo': off } });
  await assert.rejects(() => updateSiteCampaigns(owner, items({ endsAt: '' }), products), /diga quando termina/);
  await assert.rejects(() => updateSiteCampaigns(owner, items({ startsAt: brt(5 * DAY), endsAt: brt(1 * DAY) }), products), /fim precisa ser depois/);
  await assert.rejects(() => updateSiteCampaigns(owner, items({ heroSkus: ['ZZ'] }), products), /código ZZ não está à venda/);
  await assert.rejects(() => updateSiteCampaigns(owner, items({ heroSkus: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }), products), /no máximo 6/);
  await assert.rejects(() => updateSiteCampaigns(owner, items({ popup: { enabled: true, sku: 'ZZ' } }), products), /produto do aviso/);
  // Data digitada na tela (sem fuso) é horário de Brasília.
  const r = await updateSiteCampaigns({ ...owner, role: 'marketing' }, items({ endsAt: '2099-12-31T23:59' }), products);
  assert.equal(r.items['black-friday'].endsAt, '2099-12-31T23:59:00-03:00');
  await assert.rejects(() => updateSiteCampaigns({ ...owner, role: 'site' }, items(), products), /dono, o gerente ou o marketing/);
  await assert.rejects(() => campaignScreen({ ...owner, role: 'separacao' }, products), /dono, o gerente ou o marketing/);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
