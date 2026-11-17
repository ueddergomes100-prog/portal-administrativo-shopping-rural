// Configurações da loja editáveis pelo dono: canais de venda e taxas; como o trabalho é dividido.
// Documento `settings/channels` = { items: [...] }. Sem documento salvo, vale DEFAULT_CHANNELS.
// Documento `settings/workflow` = { split }. Sem documento salvo, o dono faz tudo (split: false).
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, clean } from '../http.js';
import { DEFAULT_CHANNELS } from '../../public/shared/domain.js';

// "Cada um faz a sua parte" (Ajustes → Equipe). Lido em quase toda tela de anúncios: guardado por
// 30 s para não gastar uma leitura do Firestore a cada pedido (ver "custo do Firestore" no AGENTS.md).
const WORKFLOW_TTL = 30_000;
let workflowCache = null;

export async function getWorkflow() {
  if (workflowCache && Date.now() - workflowCache.at < WORKFLOW_TTL) return workflowCache.value;
  const doc = await getStore().get(C.settings, 'workflow');
  const value = { split: doc?.split === true };
  workflowCache = { at: Date.now(), value };
  return value;
}

export async function updateWorkflow(user, input) {
  if (user.role !== 'owner') throw forbidden('Só o dono muda como o trabalho é dividido.');
  const split = input?.split === true;
  const store = getStore();
  if (split) {
    const users = await store.list(C.users);
    if (!users.some(u => u.role === 'site' && u.active !== false)) {
      throw badRequest('Para dividir o trabalho, cadastre antes uma pessoa na função “Vendas na internet” (botão Cadastrar pessoa). É ela quem vai preparar os anúncios.');
    }
  }
  const before = await getWorkflow();
  await store.set(C.settings, 'workflow', { split, updatedAt: new Date().toISOString(), updatedBy: user.id });
  workflowCache = { at: Date.now(), value: { split } };
  await audit(user, {
    action: 'settings.workflow', entity: 'settings', entityId: 'workflow',
    summary: split ? 'Ligou “Cada um faz a sua parte”: a pessoa de Vendas na internet prepara e coloca à venda' : 'Desligou “Cada um faz a sua parte”: o dono e o gerente também preparam e colocam à venda',
    before, after: { split }
  });
  return { split };
}

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
