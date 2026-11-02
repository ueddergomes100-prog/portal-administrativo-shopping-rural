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

// Só o site próprio publica pelo portal; os demais canais são anunciados à mão.
const INTEGRATIONS = ['site'];

export async function updateChannels(user, input) {
  if (user.role !== 'owner') throw forbidden('Só o dono pode mudar as taxas de venda.');
  const list = Array.isArray(input.items) ? input.items : null;
  if (!list || !list.length) throw badRequest('Deixe pelo menos um lugar de venda.');
  if (list.length > 20) throw badRequest('Dá para ter no máximo 20 lugares de venda.');
  const ids = new Set();
  const items = list.map(raw => {
    const name = clean.text(raw.name, { required: true, max: 60, label: 'Nome do lugar de venda' });
    const id = clean.text(raw.id || name, { max: 40 }).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id || ids.has(id)) throw badRequest(`Lugar de venda repetido ou sem nome: ${name}`);
    ids.add(id);
    const percent = Number(raw.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw badRequest(`${name}: a comissão precisa estar entre 0 e 100%.`);
    return {
      id, name, percent: Math.round(percent * 100) / 100,
      fixed: clean.money(raw.fixed, { label: `Valor fixo de ${name}`, allowZero: true }) ?? 0,
      fixedBelow: clean.money(raw.fixedBelow, { label: `Valor fixo só abaixo de (${name})` }),
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
