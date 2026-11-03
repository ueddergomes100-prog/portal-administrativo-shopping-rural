// Leitura de indicadores: Google Analytics 4, Google Ads e Meta Ads.
// Cada função devolve o mesmo formato, que a tela "Indicadores de mídia" desenha sem saber a fonte:
//   { period, summary: [{ key, label, value, format }], table: { title, columns: [{key,label,format}], rows: [...] } }
// format: 'int' | 'money' | 'percent' | 'text'.
//
// Código escrito conforme a documentação oficial; precisa ser validado com as contas reais
// (ver docs/INTEGRACOES.md). Erros voltam com a mensagem do provedor para facilitar o ajuste.
import { config } from '../config.js';
import { serviceAccountToken, refreshToken } from './google-auth.js';

const DAYS = 30;

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function json(response, provider) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error?.message || data.error?.error_user_msg || data.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`${provider} respondeu ${response.status}: ${detail}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Google Analytics 4 — Data API (runReport)
// ---------------------------------------------------------------------------
export const ga4Configured = () => !!(config.ga4.propertyId && config.ga4.credentials);

async function ga4Report(token, body) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(config.ga4.propertyId)}:runReport`;
  return json(await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  }), 'Google Analytics');
}

export async function fetchGa4() {
  if (!ga4Configured()) throw codedError('GA4 não configurado (GA4_PROPERTY_ID e GOOGLE_SERVICE_ACCOUNT_JSON).', 'NOT_CONFIGURED');
  const token = await serviceAccountToken(config.ga4.credentials, 'https://www.googleapis.com/auth/analytics.readonly');
  const dateRanges = [{ startDate: `${DAYS}daysAgo`, endDate: 'today' }];
  const metrics = [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }, { name: 'totalRevenue' }];
  const [totals, byChannel] = await Promise.all([
    ga4Report(token, { dateRanges, metrics }),
    ga4Report(token, { dateRanges, metrics, dimensions: [{ name: 'sessionDefaultChannelGroup' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 12 })
  ]);
  const values = (totals.rows?.[0]?.metricValues || []).map(v => Number(v.value) || 0);
  const [sessions = 0, users = 0, keyEvents = 0, revenue = 0] = values;
  return {
    period: `Últimos ${DAYS} dias`,
    summary: [
      { key: 'sessions', label: 'Sessões', value: sessions, format: 'int' },
      { key: 'users', label: 'Usuários', value: users, format: 'int' },
      { key: 'keyEvents', label: 'Conversões (eventos-chave)', value: keyEvents, format: 'int' },
      { key: 'rate', label: 'Taxa de conversão', value: sessions ? (keyEvents / sessions) * 100 : 0, format: 'percent' },
      { key: 'revenue', label: 'Receita registrada', value: revenue, format: 'money' }
    ],
    table: {
      title: 'Origem das visitas',
      columns: [{ key: 'channel', label: 'Canal', format: 'text' }, { key: 'sessions', label: 'Sessões', format: 'int' }, { key: 'users', label: 'Usuários', format: 'int' }, { key: 'keyEvents', label: 'Conversões', format: 'int' }],
      rows: (byChannel.rows || []).map(r => ({
        channel: r.dimensionValues[0].value,
        sessions: Number(r.metricValues[0].value) || 0,
        users: Number(r.metricValues[1].value) || 0,
        keyEvents: Number(r.metricValues[2].value) || 0
      }))
    }
  };
}

// ---------------------------------------------------------------------------
// Google Ads — API REST (googleAds:search com GAQL)
// ---------------------------------------------------------------------------
export const googleAdsConfigured = () => {
  const g = config.googleAds;
  return !!(g.customerId && g.developerToken && g.clientId && g.clientSecret && g.refreshToken);
};

export async function fetchGoogleAds() {
  if (!googleAdsConfigured()) throw codedError('Google Ads não configurado (ver .env.example).', 'NOT_CONFIGURED');
  const g = config.googleAds;
  const token = await refreshToken(g);
  const headers = { Authorization: `Bearer ${token}`, 'developer-token': g.developerToken, 'Content-Type': 'application/json' };
  if (g.loginCustomerId) headers['login-customer-id'] = g.loginCustomerId;
  const query = `SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0`;
  const rows = [];
  let pageToken;
  do {
    const data = await json(await fetch(`https://googleads.googleapis.com/${g.apiVersion}/customers/${g.customerId}/googleAds:search`, {
      method: 'POST', headers, body: JSON.stringify({ query, pageToken }), signal: AbortSignal.timeout(30_000)
    }), 'Google Ads');
    rows.push(...(data.results || []));
    pageToken = data.nextPageToken;
  } while (pageToken && rows.length < 2000);

  const campaigns = rows.map(r => ({
    campaign: r.campaign?.name || '—',
    cost: (Number(r.metrics?.costMicros) || 0) / 1e6,
    impressions: Number(r.metrics?.impressions) || 0,
    clicks: Number(r.metrics?.clicks) || 0,
    conversions: Number(r.metrics?.conversions) || 0
  })).sort((a, b) => b.cost - a.cost);
  const sum = key => campaigns.reduce((total, c) => total + c[key], 0);
  const cost = sum('cost');
  const conversions = sum('conversions');
  return {
    period: 'Últimos 30 dias',
    summary: [
      { key: 'cost', label: 'Investimento', value: cost, format: 'money' },
      { key: 'clicks', label: 'Cliques', value: sum('clicks'), format: 'int' },
      { key: 'conversions', label: 'Conversões', value: conversions, format: 'int' },
      { key: 'cpa', label: 'Custo por conversão', value: conversions ? cost / conversions : 0, format: 'money' }
    ],
    table: {
      title: 'Desempenho por campanha',
      columns: [{ key: 'campaign', label: 'Campanha', format: 'text' }, { key: 'cost', label: 'Investimento', format: 'money' }, { key: 'clicks', label: 'Cliques', format: 'int' }, { key: 'conversions', label: 'Conversões', format: 'int' }],
      rows: campaigns
    }
  };
}

// ---------------------------------------------------------------------------
// Meta Ads — Graph API (insights por campanha)
// ---------------------------------------------------------------------------
export const metaConfigured = () => !!(config.metaAds.accountId && config.metaAds.accessToken);

const actionValue = (actions, types) => (actions || []).filter(a => types.includes(a.action_type)).reduce((t, a) => t + (Number(a.value) || 0), 0);

export async function fetchMetaAds() {
  if (!metaConfigured()) throw codedError('Meta Ads não configurado (META_AD_ACCOUNT_ID e META_ACCESS_TOKEN).', 'NOT_CONFIGURED');
  const m = config.metaAds;
  const params = new URLSearchParams({
    level: 'campaign', date_preset: 'last_30d', limit: '200',
    fields: 'campaign_name,spend,impressions,reach,clicks,actions',
    access_token: m.accessToken
  });
  const data = await json(await fetch(`https://graph.facebook.com/${m.apiVersion}/act_${m.accountId}/insights?${params}`, { signal: AbortSignal.timeout(30_000) }), 'Meta');
  const campaigns = (data.data || []).map(r => ({
    campaign: r.campaign_name || '—',
    spend: Number(r.spend) || 0,
    reach: Number(r.reach) || 0,
    clicks: Number(r.clicks) || 0,
    leads: actionValue(r.actions, ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped']),
    purchases: actionValue(r.actions, ['purchase', 'omni_purchase'])
  })).sort((a, b) => b.spend - a.spend);
  const sum = key => campaigns.reduce((t, c) => t + c[key], 0);
  const spend = sum('spend');
  const leads = sum('leads');
  return {
    period: 'Últimos 30 dias',
    summary: [
      { key: 'spend', label: 'Gasto', value: spend, format: 'money' },
      { key: 'reach', label: 'Alcance (soma das campanhas)', value: sum('reach'), format: 'int' },
      { key: 'leads', label: 'Leads', value: leads, format: 'int' },
      { key: 'cpl', label: 'Custo por lead', value: leads ? spend / leads : 0, format: 'money' }
    ],
    table: {
      title: 'Desempenho por campanha',
      columns: [{ key: 'campaign', label: 'Campanha', format: 'text' }, { key: 'spend', label: 'Gasto', format: 'money' }, { key: 'clicks', label: 'Cliques', format: 'int' }, { key: 'leads', label: 'Leads', format: 'int' }, { key: 'purchases', label: 'Compras', format: 'int' }],
      rows: campaigns
    }
  };
}

// Leads de formulários do Meta Lead Ads (precisa do token da PÁGINA com leads_retrieval).
export const metaLeadsConfigured = () => !!(config.metaAds.leadFormIds.length && (config.metaAds.pageAccessToken || config.metaAds.accessToken));

export async function fetchMetaLeads({ since } = {}) {
  if (!metaLeadsConfigured()) throw codedError('Leads do Meta não configurados (META_LEAD_FORM_IDS e META_PAGE_ACCESS_TOKEN).', 'NOT_CONFIGURED');
  const m = config.metaAds;
  const token = m.pageAccessToken || m.accessToken;
  const leads = [];
  for (const formId of m.leadFormIds) {
    const params = new URLSearchParams({ fields: 'created_time,field_data,ad_name,campaign_name,form_id', limit: '100', access_token: token });
    if (since) params.set('filtering', JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(new Date(since).getTime() / 1000) }]));
    const data = await json(await fetch(`https://graph.facebook.com/${m.apiVersion}/${encodeURIComponent(formId)}/leads?${params}`, { signal: AbortSignal.timeout(30_000) }), 'Meta');
    for (const lead of data.data || []) {
      const field = names => lead.field_data?.find(f => names.includes(f.name))?.values?.[0] || '';
      leads.push({
        externalId: lead.id,
        createdAt: lead.created_time,
        name: field(['full_name', 'nome', 'nome_completo', 'first_name']) || 'Lead do Meta',
        email: field(['email']),
        phone: field(['phone_number', 'telefone', 'whatsapp']),
        campaignName: lead.campaign_name || '',
        adName: lead.ad_name || ''
      });
    }
  }
  return leads;
}
