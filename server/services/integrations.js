// Estado das integrações. O status é calculado a partir de:
// 1) variáveis de ambiente presentes (credenciais ficam SÓ no servidor);
// 2) último resultado de sincronização gravado em `integrations/{id}`.
// Nada aqui inventa dados: sem credencial, o status é "não conectado".
import { config } from '../config.js';
import { getStore, C } from '../store/index.js';
import { INTEGRATIONS } from '../../public/shared/domain.js';
import { badRequest } from '../http.js';

// UniPlus: no servidor da loja o portal lê a API direto (UNIPLUS_API_URL); na Vercel quem manda os
// produtos é o conector na máquina da loja, autenticado com CONNECTOR_TOKEN.
const uniplusEnv = () => (config.isVercel ? ['CONNECTOR_TOKEN'] : ['UNIPLUS_API_URL']);
// Conector ligado manda sinal de vida a cada poucos minutos; sem notícia por mais tempo que isso, avisa.
const UNIPLUS_SILENCE_MS = 2 * 3600_000;
// GA4: com a conta de serviço do Firebase, falta só o número da propriedade.
const ga4Env = () => (config.ga4.credentials ? ['GA4_PROPERTY_ID'] : ['GA4_PROPERTY_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON']);
// E-mail da conta de serviço que precisa de acesso de Leitor no Analytics (não é segredo).
function serviceEmail(json) {
  try { return JSON.parse(json)?.client_email || ''; } catch { return ''; }
}

const configured = {
  uniplus: () => !!(config.isVercel ? config.connectorToken : config.uniplus.apiUrl),
  site: () => !!(config.store.apiToken && config.store.publicUrl && config.store.portalPublicUrl),
  ga4: () => !!(config.ga4.propertyId && config.ga4.credentials),
  googleads: () => !!(config.googleAds.customerId && config.googleAds.developerToken && config.googleAds.clientId && config.googleAds.clientSecret && config.googleAds.refreshToken),
  metaads: () => !!(config.metaAds.accountId && config.metaAds.accessToken),
  leads: () => !!config.leadsWebhookToken
};
const partially = {
  uniplus: () => false,
  site: () => !!(config.store.apiToken || config.store.publicUrl),
  ga4: () => !!config.ga4.propertyId,
  googleads: () => !!config.googleAds.customerId,
  metaads: () => !!config.metaAds.accountId,
  leads: () => false
};

// Integrações com código de comunicação pronto.
const IMPLEMENTED = new Set(['uniplus', 'site', 'ga4', 'googleads', 'metaads', 'leads']);

export async function setIntegrationState(id, patch) {
  const store = getStore();
  const current = (await store.get(C.integrations, id)) || {};
  return store.set(C.integrations, id, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

export async function listIntegrations() {
  const saved = Object.fromEntries((await getStore().list(C.integrations)).map(doc => [doc.id, doc]));
  return Object.entries(INTEGRATIONS).map(([id, meta]) => {
    const state = saved[id] || {};
    const hasCredentials = configured[id]();
    let status = 'not_connected';
    if (hasCredentials && !IMPLEMENTED.has(id)) status = 'awaiting_auth';
    else if (hasCredentials && state.status === 'error') status = 'error';
    else if (hasCredentials && state.status === 'connected') status = 'connected';
    else if (hasCredentials) status = 'awaiting_auth';
    else if (partially[id]()) status = 'awaiting_auth';
    let lastError = hasCredentials ? state.lastError || '' : '';
    // UniPlus "funcionando" mas o computador da loja parou de mandar notícias.
    if (id === 'uniplus' && status === 'connected' && state.lastSyncAt && Date.now() - Date.parse(state.lastSyncAt) > UNIPLUS_SILENCE_MS) {
      status = 'error';
      lastError = 'O computador da loja parou de mandar os produtos. Confira se ele está ligado, com internet, e se o conector do UniPlus está aberto.';
    }
    // Demonstração: mostra o estado gravado pelos dados de exemplo.
    if (config.demo && state.status) status = state.status;
    const env = id === 'uniplus' ? uniplusEnv() : id === 'ga4' ? ga4Env() : meta.env;
    return {
      id,
      ...meta,
      env,
      status,
      implemented: IMPLEMENTED.has(id),
      lastSyncAt: state.lastSyncAt || null,
      lastError,
      lastErrorAt: state.lastErrorAt || null,
      itemCount: state.itemCount ?? null,
      settings: state.settings || {},
      // Só os NOMES das variáveis que faltam, nunca valores. Ligado = nada faltando.
      missingEnv: hasCredentials ? [] : env.filter(name => !process.env[name]),
      ...(id === 'ga4' && config.ga4.credentials ? { accessEmail: serviceEmail(config.ga4.credentials) } : {})
    };
  });
}

// Preferências não secretas editáveis pelo portal (ex.: intervalo desejado, observações).
const EDITABLE = {
  uniplus: ['notes'],
  site: ['notes'],
  ga4: ['notes'],
  googleads: ['notes'],
  metaads: ['notes'],
  leads: ['notes']
};

export async function updateIntegrationSettings(id, input) {
  if (!INTEGRATIONS[id]) throw badRequest('Conexão não encontrada.');
  const settings = {};
  for (const key of EDITABLE[id]) if (input[key] !== undefined) settings[key] = String(input[key]).trim().slice(0, 500);
  if (settings.storeUrl && !/^https:\/\/[^\s]+$/.test(settings.storeUrl)) throw badRequest('Use um endereço que comece com https://');
  const store = getStore();
  const current = (await store.get(C.integrations, id)) || {};
  const before = current.settings || {};
  await store.set(C.integrations, id, { ...current, settings: { ...before, ...settings }, updatedAt: new Date().toISOString() });
  return { before, after: { ...before, ...settings } };
}
