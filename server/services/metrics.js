// Indicadores de mídia: busca nos provedores, guarda o último resumo em `metrics/{fonte}`
// e atualiza o estado da integração. A tela lê só o que está guardado (rápido e sem custo de API).
import { config } from '../config.js';
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest } from '../http.js';
import { setIntegrationState } from './integrations.js';
import { fetchGa4, fetchGoogleAds, fetchMetaAds, ga4Configured, googleAdsConfigured, metaConfigured } from '../integrations/analytics.js';

const SOURCES = {
  ga4: { fetch: fetchGa4, configured: ga4Configured },
  googleads: { fetch: fetchGoogleAds, configured: googleAdsConfigured },
  metaads: { fetch: fetchMetaAds, configured: metaConfigured }
};

export async function listMetrics() {
  const docs = await getStore().list(C.metrics);
  return Object.fromEntries(docs.map(d => [d.id, d]));
}

const NAMES = { ga4: 'Google Analytics', googleads: 'Google Ads', metaads: 'Meta (Instagram/Facebook)' };
// Falha de rede ou demora do provedor: passa sozinha. Tenta mais uma vez antes de dar erro.
const transient = error => error?.name === 'TimeoutError' || error?.name === 'AbortError' || /aborted due to timeout|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(String(error?.message));
export let RETRY_WAIT_MS = 3000;
export const setRetryWait = ms => { RETRY_WAIT_MS = ms; };

async function fetchWithRetry(def) {
  try {
    return await def.fetch();
  } catch (error) {
    if (!transient(error)) throw error;
    await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS));
    return def.fetch();
  }
}

export async function syncMetrics(source, actor = null) {
  const def = SOURCES[source];
  if (!def) throw badRequest('Esta conta de resultados não existe no portal.');
  try {
    const report = await fetchWithRetry(def).catch(error => {
      if (!transient(error)) throw error;
      const friendly = new Error(`O ${NAMES[source] || source} demorou para responder. Tente "Atualizar agora" daqui a alguns minutos; de qualquer jeito o portal tenta de novo sozinho amanhã às 6h.`);
      friendly.code = 'PROVIDER_TIMEOUT';
      throw friendly;
    });
    const at = new Date().toISOString();
    await getStore().set(C.metrics, source, { ...report, syncedAt: at });
    await setIntegrationState(source, { status: 'connected', lastSyncAt: at, lastError: '' });
    if (actor) await audit(actor, { action: 'metrics.sync', entity: 'integrations', entityId: source, summary: `Atualizou indicadores de ${source}` });
    return { ...report, syncedAt: at };
  } catch (error) {
    if (error.code !== 'NOT_CONFIGURED') {
      await setIntegrationState(source, { status: 'error', lastError: error.message, lastErrorAt: new Date().toISOString() });
    }
    throw badRequest(error.message, { code: error.code || 'SYNC_FAILED' });
  }
}

// Atualiza todas as fontes ligadas. `minAgeHours`: pula a fonte atualizada há menos tempo que isso.
// Devolve { fonte: 'ok' | 'pulado' | mensagem de erro } — usado pelo laço local e pelo Cron da Vercel.
export async function syncAllMetrics({ minAgeHours = 0, log = console } = {}) {
  const saved = minAgeHours ? await listMetrics() : {};
  const result = {};
  for (const [source, def] of Object.entries(SOURCES)) {
    if (!def.configured()) continue;
    const last = Date.parse(saved[source]?.syncedAt || '');
    if (minAgeHours && Number.isFinite(last) && Date.now() - last < minAgeHours * 3600_000) { result[source] = 'pulado'; continue; }
    try {
      await syncMetrics(source);
      result[source] = 'ok';
      log.info?.(`[indicadores] ${source} atualizado.`);
    } catch (error) {
      result[source] = error.message;
      log.error?.(`[indicadores] ${source}: ${error.message}`);
    }
  }
  return result;
}

// Atualização automática no servidor local (a cada METRICS_SYNC_HOURS). Na Vercel, o Cron Job
// (vercel.json) chama GET /api/cron/metrics uma vez por dia.
export function startMetricsLoop(log = console) {
  if (!config.metricsSyncHours) return () => {};
  const tick = () => syncAllMetrics({ log });
  setTimeout(tick, 15_000);
  const timer = setInterval(tick, config.metricsSyncHours * 3600_000);
  return () => clearInterval(timer);
}
