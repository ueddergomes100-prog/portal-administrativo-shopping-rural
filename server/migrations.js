// Ajustes automáticos em dados gravados por versões anteriores do portal.
// Roda na inicialização do servidor; cada passo é idempotente (pode rodar várias vezes).
import { getStore, C } from './store/index.js';

const LEGACY_SITE = ['nuvemshop'];
const LEGACY_MANUAL = ['shopee', 'mercadolivre'];

// Out/2026: a loja saiu da Nuvemshop (site próprio) e marketplaces passaram a ser manuais.
function migrateChannel(channel) {
  const next = { ...channel };
  if (LEGACY_SITE.includes(next.integration)) {
    next.integration = 'site';
    if (/nuvemshop/i.test(next.name)) next.name = 'Site próprio';
    if (/nuvem pago/i.test(next.note || '')) next.note = 'Coloque a taxa do gateway de pagamento quando ele for escolhido (ex.: 4,99% no cartão).';
  } else if (LEGACY_MANUAL.includes(next.integration)) {
    next.integration = null;
  }
  return next;
}

function migrateListing(listing) {
  if (!listing) return listing;
  // Estados de envio automático deixaram de existir: o que não foi concluído volta para "falta publicar".
  if (listing.status === 'done') return listing;
  return { status: 'idle', externalId: '', url: '', publishedAt: null };
}

export async function runMigrations(log = console) {
  const store = getStore();
  let changed = 0;

  const settings = await store.get(C.settings, 'channels');
  if (settings?.items?.some(c => LEGACY_SITE.includes(c.integration) || LEGACY_MANUAL.includes(c.integration))) {
    await store.set(C.settings, 'channels', { ...settings, items: settings.items.map(migrateChannel) });
    changed++;
  }

  for (const item of await store.list(C.queue)) {
    const legacy = (item.channels || []).some(c => LEGACY_SITE.includes(c.integration) || LEGACY_MANUAL.includes(c.integration))
      || Object.values(item.listings || {}).some(l => ['publishing', 'failed'].includes(l?.status) || 'attempts' in (l || {}));
    if (!legacy) continue;
    const listings = Object.fromEntries(Object.entries(item.listings || {}).map(([k, v]) => [k, migrateListing(v)]));
    await store.update(C.queue, item.id, { channels: item.channels.map(migrateChannel), listings });
    changed++;
  }

  if (changed) log.info?.(`[migração] ${changed} registro(s) ajustado(s) para o site próprio.`);
  return changed;
}
