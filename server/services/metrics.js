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

export async function syncMetrics(source, actor = null) {
  const def = SOURCES[source];
  if (!def) throw badRequest('Fonte de indicadores desconhecida.');
  try {
    const report = await def.fetch();
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

// Atualização automática no servidor local (a cada METRICS_SYNC_HOURS). Na Vercel use um Cron Job
// chamando POST /api/metrics/{fonte}/sync (ver docs/INTEGRACOES.md).
export function startMetricsLoop(log = console) {
  if (!config.metricsSyncHours) return () => {};
  const tick = async () => {
    for (const [source, def] of Object.entries(SOURCES)) {
      if (!def.configured()) continue;
      try {
        await syncMetrics(source);
        log.info?.(`[indicadores] ${source} atualizado.`);
      } catch (error) {
        log.error?.(`[indicadores] ${source}: ${error.message}`);
      }
    }
  };
  setTimeout(tick, 15_000);
  const timer = setInterval(tick, config.metricsSyncHours * 3600_000);
  return () => clearInterval(timer);
}
