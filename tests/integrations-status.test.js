// Estado das conexões na Vercel: o UniPlus chega pelo conector da máquina da loja (CONNECTOR_TOKEN),
// então "Funcionando" não depende de UNIPLUS_API_URL; sem notícia por horas, vira "Com problema".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-int-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.CONNECTOR_TOKEN = 'conector-de-teste';
process.env.UNIPLUS_API_URL = '';

const { config } = await import('../server/config.js');
const { getStore } = await import('../server/store/index.js');
const { listIntegrations, setIntegrationState } = await import('../server/services/integrations.js');
// Banco local já aberto; daqui em diante o portal se comporta como na Vercel.
getStore();
config.isVercel = true;
const uniplus = async () => (await listIntegrations()).find(i => i.id === 'uniplus');

test('UniPlus pelo conector: funcionando, sem nada faltando; parado há horas: com problema', async () => {
  await setIntegrationState('uniplus', { status: 'connected', lastSyncAt: new Date().toISOString(), lastError: '', itemCount: 10240 });
  const ok = await uniplus();
  assert.equal(ok.status, 'connected');
  assert.deepEqual(ok.missingEnv, []);
  assert.equal(ok.itemCount, 10240);

  await setIntegrationState('uniplus', { lastSyncAt: new Date(Date.now() - 3 * 3600_000).toISOString() });
  const quiet = await uniplus();
  assert.equal(quiet.status, 'error');
  assert.match(quiet.lastError, /computador da loja parou/);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
