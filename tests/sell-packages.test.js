// Vender em embalagem do UniPlus (ex.: caixa com 3): preço, custo e estoque da caixa.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-embalagem-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';

const { getStore, C } = await import('../server/store/index.js');
const { selectProduct, updatePricing } = await import('../server/services/queue.js');
const { forUser } = await import('../server/services/products.js');

const owner = { id: 'dono', name: 'Dono', role: 'owner' };
const product = {
  id: '7435', sku: '2654', name: 'NEX GARD SPECTRA 30,1 A 60KG - UNIDADE', category: 'Antipulgas', unit: 'UN',
  basePrice: 151, cost: 90.93, stock: 7,
  packages: [{ id: '3014', unit: 'CX', description: 'CAIXA', factor: 3, price: 409, stock: 2, cost: 272.79 }]
};

test('vender a caixa com 3: preço, custo e estoque da caixa; dá para voltar para unidade', async () => {
  await getStore().bulkSet(C.products, [product]);

  const item = await selectProduct(owner, { productId: '7435', packageId: '3014', channels: [{ id: 'site' }] });
  assert.deepEqual(item.sellAs, { id: '3014', unit: 'CX', description: 'CAIXA', factor: 3 });
  assert.equal(item.channels[0].price, 409);            // preço sugerido = o da caixa
  assert.equal(item.productSnapshot.stock, 2);          // 7 unidades = 2 caixas
  assert.equal(item.productSnapshot.cost, 272.79);      // lucro calculado pelo custo da caixa

  const back = await updatePricing(owner, item.id, { packageId: '', channels: [{ id: 'site', price: 151 }] });
  assert.equal(back.sellAs, null);
  assert.equal(back.productSnapshot.stock, 7);

  await assert.rejects(() => selectProduct(owner, { productId: '7435', packageId: 'nao-existe', channels: [{ id: 'site' }] }));
});

test('custo da caixa não aparece para quem não vê custo', () => {
  const seen = forUser(product, { role: 'site' });
  assert.equal(seen.cost, undefined);
  assert.equal(seen.packages[0].cost, undefined);
  assert.equal(seen.packages[0].price, 409);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
