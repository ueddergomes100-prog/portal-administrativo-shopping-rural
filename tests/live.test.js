// Telas ao vivo (server/live.js): escrita avisa as telas com UM documento settings/live; leitura nunca avisa.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-ao-vivo-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';

const { getStore, C } = await import('../server/store/index.js');
const { withLive, flushLive, liveKey } = await import('../server/live.js');

const live = () => getStore().get(C.settings, 'live');

test('chaves: coleção; em settings, o documento; fatias de produto contam como products', () => {
  assert.equal(liveKey('publicationQueue', 'x'), 'publicationQueue');
  assert.equal(liveKey('settings', 'workflow'), 'settings:workflow');
  assert.equal(liveKey('settings', 'products-shard-7'), 'products');
  assert.equal(liveKey('settings', 'live'), null);
  assert.equal(liveKey('audit', 'x'), null);
  assert.equal(liveKey('integrations', 'uniplus'), null);
});

test('um pedido que muda várias coisas grava o aviso uma vez, com cada chave', async () => {
  const store = getStore();
  await withLive(async () => {
    await store.create(C.queue, { stage: 'selected' });
    await store.set(C.settings, 'workflow', { split: true });
    await store.create(C.audit, { action: 'x' }); // histórico não avisa
    await flushLive();
  });
  const first = await live();
  assert.ok(first.at);
  assert.equal(first.changes.publicationQueue, first.at);
  assert.equal(first.changes['settings:workflow'], first.at);
  assert.equal(first.changes.audit, undefined);

  // Mudança seguinte só atualiza a sua chave; as outras continuam com o horário de antes.
  await new Promise(resolve => setTimeout(resolve, 5));
  await withLive(async () => {
    await store.create(C.orders, { status: 'novo' });
    await flushLive();
  });
  const second = await live();
  assert.notEqual(second.at, first.at);
  assert.equal(second.changes.orders, second.at);
  assert.equal(second.changes.publicationQueue, first.at);
});

test('leitura (GET) nunca avisa, mesmo que grave algo por dentro', async () => {
  const before = await live();
  await withLive(async () => {
    await getStore().create(C.leads, { name: 'Ana' });
    await flushLive();
  }, { readOnly: true });
  assert.deepEqual(await live(), before);
});

test('mudança fora de um pedido (tarefa de fundo) também avisa', async () => {
  await getStore().create(C.campaigns, { name: 'Natal' });
  await new Promise(resolve => setTimeout(resolve, 400));
  const after = await live();
  assert.equal(after.changes.campaigns, after.at);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
