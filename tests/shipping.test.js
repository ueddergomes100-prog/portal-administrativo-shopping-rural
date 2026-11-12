// Frete do site: motoboy por cidade (pedido mínimo, grátis a partir de), Correios/Jadlog pelo
// Melhor Envio (simulado aqui) e retirada na loja.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-frete-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';
process.env.MELHOR_ENVIO_TOKEN = 'token-de-teste';
process.env.MELHOR_ENVIO_CONTACT = 'contato@loja.test';
process.env.MELHOR_ENVIO_SANDBOX = 'true';

const { getStore, C } = await import('../server/store/index.js');
const { updateShippingSettings, quoteForSite, simulateShipping, defaultBox } = await import('../server/services/shipping.js');
const { isDeliveryMethod } = await import('../public/shared/domain.js');

const owner = { id: 'dono', name: 'Dono', role: 'owner' };
const entry = (sku, price, extra = {}) => ({
  id: `q-${sku}`, productId: sku, sku, slug: sku, name: `Produto ${sku}`, brand: '', category: '', pet: 'cao',
  measure: { value: 1, unit: 'un' }, weightKg: 0.5, dims: null, tag: '', short: '', description: '', specs: [], imageRefs: [],
  seoTitle: '', seoDescription: '', price, promoPrice: null, promoStart: '', promoEnd: '', factor: 1, stock: 10, updatedAt: '', ...extra
});

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).includes('viacep.com.br')) return new Response(JSON.stringify({ localidade: 'Divinópolis', uf: 'MG' }), { status: 200 });
  if (String(url).includes('melhorenvio.com.br')) {
    return new Response(JSON.stringify([
      { id: 2, name: 'SEDEX', company: { name: 'Correios' }, price: '41.00', custom_price: '40.00', custom_delivery_range: { min: 1, max: 2 } },
      { id: 3, name: '.Package', company: { name: 'Jadlog' }, error: 'Serviço indisponível para o trecho.' },
      { id: 1, name: 'PAC', company: { name: 'Correios' }, price: '26.00', custom_price: '25.50', custom_delivery_range: { min: 4, max: 6 } }
    ]), { status: 200 });
  }
  throw new Error(`fetch inesperado: ${url}`);
};

test('regras do frete: o que não faz sentido é recusado', async () => {
  await assert.rejects(() => updateShippingSettings(owner, { motoboy: { enabled: true, areas: [] } }), /pelo menos uma cidade/);
  await assert.rejects(() => updateShippingSettings(owner, { motoboy: { enabled: true, areas: [{ city: 'Divinópolis', state: 'MG', price: 10 }, { city: 'divinopolis', state: 'MG', price: 12 }] } }), /duas vezes/);
  await assert.rejects(() => updateShippingSettings(owner, { motoboy: { areas: [{ city: 'Divinópolis', state: '', price: 10 }] } }), /estado/);
  await assert.rejects(() => updateShippingSettings(owner, { carriers: { enabled: true, services: [1] } }), /CEP de onde/);
  await assert.rejects(() => updateShippingSettings({ ...owner, role: 'site' }, {}), /dono ou o gerente/);
});

test('motoboy com pedido mínimo e grátis a partir de; Correios pelo Melhor Envio; retirada', async () => {
  await getStore().set(C.settings, 'catalog', { generatedAt: '', items: [entry('A', 30), entry('R15', 120, { measure: { value: 15, unit: 'kg' }, weightKg: null, dims: { heightCm: 12, widthCm: 40, lengthCm: 65 } })] });
  await updateShippingSettings(owner, {
    originCep: '35500-001',
    pickup: { enabled: true, readyHours: 2 },
    motoboy: { enabled: true, areas: [{ city: 'Divinópolis', state: 'MG', price: 10, minOrder: 50, freeFrom: 200, days: 0 }] },
    carriers: { enabled: true, services: [1, 2, 3], extraDays: 1, freeFrom: 200, insurance: true }
  });

  // R$ 30: abaixo do pedido mínimo do motoboy — ele não aparece, mas o cliente é avisado.
  const small = await quoteForSite({ cep: '35500-000', items: [{ sku: 'A', qty: 1 }] });
  assert.deepEqual(small.options.map(o => o.id), ['me-1', 'me-2', 'retirada']);
  assert.match(small.notices.join(' '), /a partir de R\$ 50,00\. Faltam R\$ 20,00/);
  assert.deepEqual(small.options[0], { id: 'me-1', label: 'Correios PAC', description: 'Entrega pela transportadora, com rastreio', price: 25.5, days: [5, 7] });

  // O pedido para o Melhor Envio: caixa padrão pelo peso, seguro pelo preço, serviços escolhidos.
  const me = calls.find(c => c.url.includes('melhorenvio'));
  assert.equal(me.url, 'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
  assert.equal(me.init.headers.Authorization, 'Bearer token-de-teste');
  assert.equal(me.init.headers['User-Agent'], 'Portal Shopping Rural (contato@loja.test)');
  const body = JSON.parse(me.init.body);
  assert.deepEqual(body.from, { postal_code: '35500001' });
  assert.equal(body.services, '1,2,3');
  assert.deepEqual(body.products, [{ id: 'A', height: 10, width: 15, length: 20, weight: 0.5, insurance_value: 30, quantity: 1 }]);

  // R$ 60: motoboy aparece primeiro, no mesmo dia.
  const mid = await quoteForSite({ cep: '35500-000', items: [{ sku: 'A', qty: 2 }] });
  assert.deepEqual(mid.options[0], { id: 'motoboy', label: 'Entrega de motoboy', description: 'Entrega da própria loja em Divinópolis', price: 10, days: [0, 0] });

  // R$ 240 (ração de 15 kg com medidas + item): motoboy grátis e a transportadora mais barata grátis.
  const big = await quoteForSite({ cep: '35500-000', items: [{ sku: 'R15', qty: 1 }, { sku: 'A', qty: 4 }] });
  assert.equal(big.subtotal, 240);
  assert.equal(big.options[0].price, 0);
  assert.equal(big.options.find(o => o.id === 'me-1').price, 0);
  assert.equal(big.options.find(o => o.id === 'me-2').price, 40);
  const bigBody = JSON.parse(calls.filter(c => c.url.includes('melhorenvio')).at(-1).init.body);
  assert.deepEqual(bigBody.products[0], { id: 'R15', height: 12, width: 40, length: 65, weight: 15, insurance_value: 120, quantity: 1 });

  // Outra cidade: sem motoboy.
  const far = await quoteForSite({ cep: '01001-000', city: 'São Paulo', state: 'SP', items: [{ sku: 'A', qty: 2 }] });
  assert.ok(!far.options.some(o => o.id === 'motoboy'));

  await assert.rejects(() => quoteForSite({ cep: '123', items: [{ sku: 'A', qty: 1 }] }), /CEP/);
  await assert.rejects(() => quoteForSite({ cep: '35500-000', items: [{ sku: 'nao-existe', qty: 1 }] }), /Nenhum produto/);
});

test('simular usa as regras da tela, mesmo sem salvar', async () => {
  const r = await simulateShipping(owner, {
    cep: '35500000', subtotal: 80, weightKg: 1,
    settings: { pickup: { enabled: false }, motoboy: { enabled: true, areas: [{ city: 'Divinópolis', state: 'MG', price: 7, days: 1 }] } }
  });
  assert.deepEqual(r.options.map(o => [o.id, o.price]), [['motoboy', 7]]);
  assert.equal(r.city, 'Divinópolis');
});

test('caixa padrão nunca abaixo do mínimo dos Correios; pedidos aceitam motoboy e transportadora', () => {
  const box = defaultBox(0.1);
  assert.ok(box.heightCm >= 2 && box.widthCm >= 11 && box.lengthCm >= 16);
  assert.ok(isDeliveryMethod('motoboy') && isDeliveryMethod('me-17') && isDeliveryMethod('retirada'));
  assert.ok(!isDeliveryMethod('me-') && !isDeliveryMethod('foguete'));
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
