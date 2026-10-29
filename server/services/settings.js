// Configurações da loja editáveis pelo dono. Hoje: canais de venda e taxas.
// Documento `settings/channels` = { items: [...] }. Sem documento salvo, vale DEFAULT_CHANNELS.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, clean } from '../http.js';
import { DEFAULT_CHANNELS } from '../../public/shared/domain.js';

export async function getChannels() {
  const doc = await getStore().get(C.settings, 'channels');
  return Array.isArray(doc?.items) && doc.items.length ? doc.items : DEFAULT_CHANNELS;
}

export async function getChannel(id) {
  return (await getChannels()).find(c => c.id === id) || null;
}

const INTEGRATIONS = ['nuvemshop', 'shopee', 'mercadolivre'];

export async function updateChannels(user, input) {
  if (user.role !== 'owner') throw forbidden('Só o dono altera canais e taxas.');
  const list = Array.isArray(input.items) ? input.items : null;
  if (!list || !list.length) throw badRequest('Informe ao menos um canal.');
  if (list.length > 20) throw badRequest('No máximo 20 canais.');
  const ids = new Set();
  const items = list.map(raw => {
    const name = clean.text(raw.name, { required: true, max: 60, label: 'Nome do canal' });
    const id = clean.text(raw.id || name, { max: 40 }).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id || ids.has(id)) throw badRequest(`Canal repetido ou sem nome: ${name}`);
    ids.add(id);
    const percent = Number(raw.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw badRequest(`${name}: a comissão precisa estar entre 0 e 100%.`);
    return {
      id, name, percent: Math.round(percent * 100) / 100,
      fixed: clean.money(raw.fixed, { label: `Tarifa fixa de ${name}`, allowZero: true }) ?? 0,
      fixedBelow: clean.money(raw.fixedBelow, { label: `Limite da tarifa fixa de ${name}` }),
      integration: INTEGRATIONS.includes(raw.integration) ? raw.integration : null,
      active: raw.active !== false,
      note: clean.text(raw.note, { max: 300, label: 'Observação' })
    };
  });
  const before = await getChannels();
  await getStore().set(C.settings, 'channels', { items, updatedAt: new Date().toISOString(), updatedBy: user.id });
  await audit(user, { action: 'settings.channels', entity: 'settings', entityId: 'channels', summary: 'Atualizou canais de venda e taxas', before: { items: before }, after: { items } });
  return items;
}
