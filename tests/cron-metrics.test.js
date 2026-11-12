// Cron da Vercel: atualiza os indicadores ligados; sem CRON_SECRET só aceita o agendador da Vercel
// e não repete em menos de 6 h.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-cron-'));
process.env.DATA_BACKEND = 'local';
process.env.DATA_DIR = dir;
process.env.UNIPLUS_API_URL = '';
process.env.CRON_SECRET = '';
process.env.META_AD_ACCOUNT_ID = '123';
process.env.META_ACCESS_TOKEN = 'token-de-teste';
process.env.GA4_PROPERTY_ID = '';

let calls = 0;
globalThis.fetch = async url => {
  if (String(url).includes('graph.facebook.com')) {
    calls++;
    return new Response(JSON.stringify({ data: [{ campaign_name: 'Ração', spend: '50.5', impressions: '1000', reach: '800', clicks: '40', actions: [] }] }), { status: 200 });
  }
  throw new Error(`fetch inesperado: ${url}`);
};

const { handleApi } = await import('../server/router.js');

function call(pathname, headers = {}) {
  return new Promise(resolve => {
    const req = { method: 'GET', headers, url: pathname };
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body || '{}') }); } };
    handleApi(req, res, pathname, new URLSearchParams());
  });
}

test('cron: só o agendador da Vercel; atualiza a Meta e não repete em seguida', async () => {
  const stranger = await call('/api/cron/metrics', { 'user-agent': 'curl/8' });
  assert.equal(stranger.status, 403);

  const first = await call('/api/cron/metrics', { 'user-agent': 'vercel-cron/1.0' });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.synced, { metaads: 'ok' });
  assert.equal(calls, 1);

  const again = await call('/api/cron/metrics', { 'user-agent': 'vercel-cron/1.0' });
  assert.deepEqual(again.body.synced, { metaads: 'pulado' });
  assert.equal(calls, 1);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
