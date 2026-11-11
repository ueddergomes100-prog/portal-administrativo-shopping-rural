import test from 'node:test';
import assert from 'node:assert/strict';

const { mapProduct, productKey } = await import('../server/integrations/uniplus.js');

test('UniPlus: preserva a caixa e calcula seu estoque a partir da unidade', () => {
  const product = mapProduct({
    id_produto: '7435', sku: '2654', nome_produto: 'NEX GARD SPECTRA 30,1 A 60KG - UNIDADE',
    nome_categoria: 'Antipulgas', unidade: 'UN', preco: '151.00', preco_custo: '90.93', estoque: '3',
    embalagens: [{
      id: '3014', unidade: 'CX', descricao: 'CAIXA', fator: '3', preco: '409.00',
      codigo_barras: '', envia_ecommerce: false
    }]
  });

  assert.equal(product.stock, 3);
  assert.equal(product.packages.length, 1);
  assert.deepEqual(product.packages[0], {
    id: '3014', unit: 'CX', description: 'CAIXA', factor: 3, price: 409,
    stock: 1, barcode: '', ecommerce: false, cost: 272.79
  });
});

test('UniPlus: mudança na embalagem pede nova sincronização', () => {
  const base = mapProduct({ id_produto: '1', sku: '1', nome_produto: 'Produto', preco: 10, estoque: 6, embalagens: [] });
  const withPackage = mapProduct({
    id_produto: '1', sku: '1', nome_produto: 'Produto', preco: 10, estoque: 6,
    embalagens: [{ id: 'cx', unidade: 'CX', fator: 3, preco: 27 }]
  });
  assert.notEqual(productKey(base), productKey(withPackage));
});
