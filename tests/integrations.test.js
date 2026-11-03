// Integrações externas com respostas simuladas (sem rede): confere autenticação montada,
// leitura dos campos e o formato entregue à tela. Quando houver contas reais, valide também ao vivo.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
Object.assign(process.env, {
  DATA_BACKEND: 'local',
  GA4_PROPERTY_ID: '123456',
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'portal@teste.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
  GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ADS_DEVELOPER_TOKEN: 'dev', GOOGLE_ADS_CLIENT_ID: 'cid', GOOGLE_ADS_CLIENT_SECRET: 'sec', GOOGLE_ADS_REFRESH_TOKEN: 'ref',
  META_AD_ACCOUNT_ID: 'act_999', META_ACCESS_TOKEN: 'meta-token', META_LEAD_FORM_IDS: 'form1', META_PAGE_ACCESS_TOKEN: 'page-token'
});

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  calls.push({ url: u, options });
  const reply = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u === 'https://oauth2.googleapis.com/token') return reply({ access_token: 'google-token', expires_in: 3600 });
  if (u.includes('analyticsdata.googleapis.com')) {
    const body = JSON.parse(options.body);
    if (!body.dimensions) return reply({ rows: [{ metricValues: [{ value: '1000' }, { value: '800' }, { value: '25' }, { value: '4500.5' }] }] });
    return reply({ rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '600' }, { value: '500' }, { value: '15' }, { value: '0' }] }] });
  }
  if (u.includes('googleads.googleapis.com')) {
    return reply({ results: [
      { campaign: { name: 'Pesquisa marca' }, metrics: { costMicros: '150000000', impressions: '9000', clicks: '300', conversions: 10 } },
      { campaign: { name: 'Shopping' }, metrics: { costMicros: '50000000', impressions: '3000', clicks: '100', conversions: 0 } }
    ] });
  }
  if (u.includes('/act_999/insights')) {
    return reply({ data: [{ campaign_name: 'Leads pet', spend: '200.00', impressions: '10000', reach: '7000', clicks: '250', actions: [{ action_type: 'lead', value: '8' }] }] });
  }
  if (u.includes('/form1/leads')) {
    return reply({ data: [{ id: 'L1', created_time: '2026-10-28T10:00:00+0000', campaign_name: 'Leads pet', ad_name: 'Anúncio A',
      field_data: [{ name: 'full_name', values: ['Carlos Lima'] }, { name: 'phone_number', values: ['+5534988887777'] }] }] });
  }
  return new Response('{}', { status: 404 });
};

const analytics = await import('../server/integrations/analytics.js');

test('GA4: troca a conta de serviço por token e monta o resumo', async () => {
  const report = await analytics.fetchGa4();
  const tokenCall = calls.find(c => c.url === 'https://oauth2.googleapis.com/token');
  assert.match(String(tokenCall.options.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
  const byKey = Object.fromEntries(report.summary.map(m => [m.key, m.value]));
  assert.equal(byKey.sessions, 1000);
  assert.equal(byKey.keyEvents, 25);
  assert.equal(byKey.rate, 2.5);
  assert.equal(report.table.rows[0].channel, 'Organic Search');
  assert.ok(calls.some(c => c.url.includes('properties/123456:runReport') && c.options.headers.Authorization === 'Bearer google-token'));
});

test('Google Ads: soma investimento em reais e calcula custo por conversão', async () => {
  const report = await analytics.fetchGoogleAds();
  const byKey = Object.fromEntries(report.summary.map(m => [m.key, m.value]));
  assert.equal(byKey.cost, 200);
  assert.equal(byKey.conversions, 10);
  assert.equal(byKey.cpa, 20);
  const call = calls.find(c => c.url.includes('googleads.googleapis.com'));
  assert.match(call.url, /customers\/1234567890\/googleAds:search/);
  assert.equal(call.options.headers['developer-token'], 'dev');
});

test('Meta Ads: lê gasto e leads das ações', async () => {
  const report = await analytics.fetchMetaAds();
  const byKey = Object.fromEntries(report.summary.map(m => [m.key, m.value]));
  assert.equal(byKey.spend, 200);
  assert.equal(byKey.leads, 8);
  assert.equal(byKey.cpl, 25);
});

test('Meta Lead Ads: converte os campos do formulário', async () => {
  const [lead] = await analytics.fetchMetaLeads();
  assert.equal(lead.name, 'Carlos Lima');
  assert.equal(lead.phone, '+5534988887777');
  assert.equal(lead.externalId, 'L1');
});
