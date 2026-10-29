// Configuração lida de variáveis de ambiente. Em desenvolvimento local, um arquivo
// `.env` na raiz é carregado automaticamente (sem dependência externa).
// Documentação de cada variável: `.env.example`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadDotEnv();

const env = (name, fallback = '') => (process.env[name] ?? fallback).trim();
const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  // `local`: dados em data/portal-db.json, login próprio. `firestore`: Firebase Auth + Firestore.
  backend: env('DATA_BACKEND', process.env.VERCEL ? 'firestore' : 'local'),
  isVercel: !!process.env.VERCEL,
  host: env('HOST', '127.0.0.1'),
  port: num('PORT', 4173),
  dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
  mediaDir: path.resolve(ROOT, env('MEDIA_DIR', 'media')),
  sessionSecret: env('SESSION_SECRET'),
  sessionHours: num('SESSION_HOURS', 12),
  connectorToken: env('CONNECTOR_TOKEN'),
  bootstrapOwnerEmail: env('BOOTSTRAP_OWNER_EMAIL').toLowerCase(),

  firebase: {
    projectId: env('FIREBASE_PROJECT_ID', 'portalspr-e0490'),
    serviceAccountJson: env('FIREBASE_SERVICE_ACCOUNT_JSON'),
    serviceAccountFile: env('GOOGLE_APPLICATION_CREDENTIALS'),
    // Configuração PÚBLICA do SDK web (não é segredo). Vai para o navegador.
    web: {
      apiKey: env('FIREBASE_WEB_API_KEY'),
      authDomain: env('FIREBASE_WEB_AUTH_DOMAIN'),
      projectId: env('FIREBASE_PROJECT_ID', 'portalspr-e0490'),
      appId: env('FIREBASE_WEB_APP_ID')
    }
  },

  uniplus: {
    apiUrl: env('UNIPLUS_API_URL'),
    syncSeconds: num('UNIPLUS_SYNC_SECONDS', 300),
    // Liga a sincronização dentro do servidor local. Na Vercel, use `npm run connector` na máquina da loja.
    autoSync: env('UNIPLUS_AUTO_SYNC', 'true') !== 'false'
  },

  nuvemshop: {
    storeId: env('NUVEMSHOP_STORE_ID'),
    accessToken: env('NUVEMSHOP_ACCESS_TOKEN'),
    userAgent: env('NUVEMSHOP_USER_AGENT', 'Portal Shopping Rural'),
    apiBase: env('NUVEMSHOP_API_BASE', 'https://api.nuvemshop.com.br/v1'),
    // Segredo do app (client secret) — valida a assinatura dos webhooks de pedidos.
    appSecret: env('NUVEMSHOP_APP_SECRET')
  },

  shopee: {
    partnerId: env('SHOPEE_PARTNER_ID'), partnerKey: env('SHOPEE_PARTNER_KEY'),
    shopId: env('SHOPEE_SHOP_ID'), accessToken: env('SHOPEE_ACCESS_TOKEN')
  },
  mercadoLivre: { accessToken: env('MELI_ACCESS_TOKEN'), userId: env('MELI_USER_ID') },

  // Indicadores sincronizados automaticamente a cada N horas (0 = só manual).
  metricsSyncHours: Number(process.env.METRICS_SYNC_HOURS ?? 6) || 0,
  ga4: { propertyId: env('GA4_PROPERTY_ID'), credentials: env('GOOGLE_SERVICE_ACCOUNT_JSON') },
  googleAds: {
    customerId: env('GOOGLE_ADS_CUSTOMER_ID').replaceAll('-', ''),
    loginCustomerId: env('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replaceAll('-', ''),
    developerToken: env('GOOGLE_ADS_DEVELOPER_TOKEN'),
    clientId: env('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: env('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken: env('GOOGLE_ADS_REFRESH_TOKEN'),
    apiVersion: env('GOOGLE_ADS_API_VERSION', 'v20')
  },
  metaAds: {
    accountId: env('META_AD_ACCOUNT_ID').replace(/^act_/, ''),
    accessToken: env('META_ACCESS_TOKEN'),
    apiVersion: env('META_API_VERSION', 'v21.0'),
    // Formulários de Lead Ads para importar leads (IDs separados por vírgula) e token da página.
    leadFormIds: env('META_LEAD_FORM_IDS').split(',').map(s => s.trim()).filter(Boolean),
    pageAccessToken: env('META_PAGE_ACCESS_TOKEN')
  },
  // Token para ferramentas externas (formulário do site, WhatsApp, Zapier/Make) enviarem leads.
  leadsWebhookToken: env('LEADS_WEBHOOK_TOKEN')
};
