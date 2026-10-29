// Campanhas, promoções, solicitações de arte e leads.
// Cada entidade tem: listar, criar, editar, mudar etapa (com regras do domínio) e histórico.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, notFound, clean } from '../http.js';
import { getProduct } from './products.js';
import { getChannels } from './settings.js';
import {
  CAMPAIGN_STATUS, CAMPAIGN_TRANSITIONS, CAMPAIGN_CHANNELS, CAMPAIGN_OBJECTIVES,
  PROMOTION_STATUS, PROMOTION_TRANSITIONS,
  ART_STATUS, ART_TRANSITIONS, ART_FORMATS, ART_ORIGINS, PUBLICATION_CHANNELS, PRIORITIES,
  LEAD_STATUS, LEAD_SOURCES,
  availableTransitions, findTransition, roleMatches
} from '../../public/shared/domain.js';

const now = () => new Date().toISOString();
const brl = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const ENTITIES = {
  campaigns: { collection: C.campaigns, statuses: CAMPAIGN_STATUS, transitions: CAMPAIGN_TRANSITIONS, label: 'campanha', initial: 'draft',
    canCreate: ['owner', 'manager', 'marketing'], canEdit: ['owner', 'manager', 'marketing'] },
  promotions: { collection: C.promotions, statuses: PROMOTION_STATUS, transitions: PROMOTION_TRANSITIONS, label: 'promoção', initial: 'draft',
    canCreate: ['owner', 'manager'], canEdit: ['owner', 'manager'] },
  arts: { collection: C.arts, statuses: ART_STATUS, transitions: ART_TRANSITIONS, label: 'solicitação de arte', initial: 'requested',
    canCreate: ['owner', 'manager', 'marketing', 'site'], canEdit: ['owner', 'manager', 'marketing'] },
  leads: { collection: C.leads, statuses: LEAD_STATUS, transitions: null, label: 'lead', initial: 'new',
    canCreate: ['owner', 'manager', 'marketing', 'site'], canEdit: ['owner', 'manager', 'marketing', 'site'] }
};

function meta(entity) {
  const m = ENTITIES[entity];
  if (!m) throw notFound('Área desconhecida.');
  return m;
}

function nameOf(entity, record) {
  return record.name || record.title || 'registro';
}

// ---------------------------------------------------------------------------
// Validação por entidade
// ---------------------------------------------------------------------------
async function readCampaign(input) {
  const start = clean.date(input.start, { required: true, label: 'Início' });
  const end = clean.date(input.end, { required: true, label: 'Fim' });
  if (end < start) throw badRequest('O fim da campanha precisa ser depois do início.');
  const productIds = clean.ids(input.productIds, { label: 'Produtos' });
  // Guarda nome/SKU junto para a campanha continuar legível mesmo se o produto sair do UniPlus.
  const products = [];
  for (const id of productIds) {
    const product = await getProduct(id);
    products.push({ id: product.id, name: product.name, sku: product.sku, basePrice: product.basePrice });
  }
  return {
    products,
    name: clean.text(input.name, { required: true, max: 120, label: 'Nome' }),
    objective: clean.oneOf(input.objective, CAMPAIGN_OBJECTIVES, { label: 'Objetivo', fallback: 'Vendas' }),
    description: clean.text(input.description, { max: 5000, label: 'Descrição' }),
    start, end,
    channels: clean.list(input.channels, CAMPAIGN_CHANNELS, { label: 'Canais' }),
    budget: clean.money(input.budget, { label: 'Orçamento', allowZero: true }),
    ownerId: clean.text(input.ownerId, { max: 120 }),
    productIds: clean.ids(input.productIds, { label: 'Produtos' })
  };
}

async function readPromotion(input) {
  const start = clean.date(input.start, { required: true, label: 'Início' });
  const end = clean.date(input.end, { required: true, label: 'Fim' });
  if (end < start) throw badRequest('O fim da promoção precisa ser depois do início.');
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) throw badRequest('Adicione ao menos um produto à promoção.');
  if (rawItems.length > 200) throw badRequest('No máximo 200 produtos por promoção.');
  const items = [];
  for (const raw of rawItems) {
    const product = await getProduct(String(raw.productId || ''));
    const promoPrice = clean.money(raw.promoPrice, { required: true, label: `Preço promocional de ${product.name}` });
    if (promoPrice >= product.basePrice) throw badRequest(`${product.name}: o preço promocional precisa ser menor que ${brl(product.basePrice)}.`);
    items.push({ productId: product.id, sku: product.sku, name: product.name, regularPrice: product.basePrice, promoPrice });
  }
  const channelIds = (await getChannels()).map(c => c.id);
  return {
    name: clean.text(input.name, { required: true, max: 120, label: 'Nome' }),
    description: clean.text(input.description, { max: 3000, label: 'Observações' }),
    start, end, items,
    // Em quais canais a promoção vale (a tela mostra taxa e líquido de cada um).
    channels: clean.list(input.channels, channelIds, { label: 'Canais' }),
    campaignId: clean.text(input.campaignId, { max: 120 })
  };
}

async function readArt(input) {
  const originType = clean.oneOf(input.originType, Object.keys(ART_ORIGINS), { label: 'Origem' });
  const originId = clean.text(input.originId, { required: true, max: 120, label: 'Origem' });
  // Confirma que a origem existe.
  const store = getStore();
  const originCollection = { campaign: C.campaigns, promotion: C.promotions, product: C.products }[originType];
  const origin = await store.get(originCollection, originId);
  if (!origin) throw badRequest('A campanha, promoção ou produto de origem não foi encontrado.');
  return {
    title: clean.text(input.title, { required: true, max: 140, label: 'Título' }),
    originType, originId, originName: origin.name || '',
    briefing: clean.text(input.briefing, { required: true, max: 8000, label: 'Briefing' }),
    format: clean.oneOf(input.format, ART_FORMATS, { label: 'Formato', fallback: 'Post' }),
    deadline: clean.date(input.deadline, { required: true, label: 'Prazo' }),
    priority: clean.oneOf(input.priority, PRIORITIES, { label: 'Prioridade', fallback: 'Normal' }),
    assigneeId: clean.text(input.assigneeId, { max: 120 })
  };
}

async function readLead(input) {
  return {
    name: clean.text(input.name, { required: true, max: 120, label: 'Nome' }),
    email: clean.email(input.email),
    phone: clean.text(input.phone, { max: 40, label: 'Telefone' }),
    source: clean.oneOf(input.source, LEAD_SOURCES, { label: 'Origem', fallback: 'Outro' }),
    campaignId: clean.text(input.campaignId, { max: 120 }),
    assigneeId: clean.text(input.assigneeId, { max: 120 }),
    value: clean.money(input.value, { label: 'Valor', allowZero: true }),
    interest: clean.text(input.interest, { max: 3000, label: 'Interesse' }),
    status: clean.oneOf(input.status, Object.keys(LEAD_STATUS), { label: 'Etapa', fallback: 'new' })
  };
}

const readers = { campaigns: readCampaign, promotions: readPromotion, arts: readArt, leads: readLead };

// ---------------------------------------------------------------------------
// Operações genéricas
// ---------------------------------------------------------------------------
function decorate(entity, record, user) {
  const m = meta(entity);
  return {
    ...record,
    transitions: m.transitions ? availableTransitions(m.transitions, record.status, user).map(t => ({ to: t.to, label: t.label, requires: t.requires || null })) : [],
    can: {
      edit: m.canEdit.includes(user.role) && !['cancelled', 'published', 'done'].includes(record.status),
      remove: ['owner', 'manager'].includes(user.role)
    }
  };
}

export async function listRecords(entity, user, { status, campaignId } = {}) {
  const m = meta(entity);
  const where = [];
  if (status) where.push(['status', '==', status]);
  if (campaignId) where.push(['campaignId', '==', campaignId]);
  const records = await getStore().list(m.collection, { where });
  records.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return records.map(r => decorate(entity, r, user));
}

export async function getRecord(entity, user, id) {
  const record = await getStore().get(meta(entity).collection, id);
  if (!record) throw notFound();
  return decorate(entity, record, user);
}

export async function createRecord(entity, user, input) {
  const m = meta(entity);
  if (!m.canCreate.includes(user.role)) throw forbidden(`Seu papel não cria ${m.label}.`);
  const data = await readers[entity](input);
  const record = {
    ...data,
    status: entity === 'leads' ? data.status : m.initial,
    createdBy: { id: user.id, name: user.name },
    createdAt: now(), updatedAt: now(), updatedBy: user.id,
    notes: []
  };
  if (entity === 'arts') Object.assign(record, { fileRef: '', publications: [] });
  // Pedido de arte junto (campanha/promoção): valida antes de gravar qualquer coisa.
  const artInput = ['campaigns', 'promotions'].includes(entity) && input.art?.requested ? input.art : null;
  if (artInput) {
    clean.date(artInput.deadline, { required: true, label: 'Prazo da arte' });
    clean.text(artInput.briefing, { required: true, max: 8000, label: 'Briefing da arte' });
  }
  const saved = await getStore().create(m.collection, record);
  await audit(user, { action: `${entity}.create`, entity, entityId: saved.id, summary: `Criou ${m.label}: ${nameOf(entity, saved)}`, after: record });
  const result = decorate(entity, saved, user);
  if (artInput) {
    const art = await createRecord('arts', user, {
      ...artInput,
      title: artInput.title || `Arte: ${nameOf(entity, saved)}`,
      originType: entity === 'campaigns' ? 'campaign' : 'promotion',
      originId: saved.id
    });
    result.createdArtId = art.id;
  }
  return result;
}

export async function updateRecord(entity, user, id, input) {
  const m = meta(entity);
  const store = getStore();
  const current = await store.get(m.collection, id);
  if (!current) throw notFound();
  if (!m.canEdit.includes(user.role)) throw forbidden(`Seu papel não edita ${m.label}.`);
  if (['cancelled', 'published', 'done'].includes(current.status)) throw badRequest('Registro encerrado não pode ser editado.');
  // Promoção aprovada volta para rascunho se o preço ou período mudar — precisa de nova aprovação.
  const data = await readers[entity]({ ...current, ...input });
  const patch = { ...data, updatedAt: now(), updatedBy: user.id };
  if (entity === 'promotions' && current.status === 'approved') patch.status = 'draft';
  if (entity === 'leads' && data.status !== current.status) {
    patch.notes = [...(current.notes || []), { text: `Etapa: ${LEAD_STATUS[current.status].label} → ${LEAD_STATUS[data.status].label}`, at: now(), by: user.name }];
  }
  const saved = await store.update(m.collection, id, patch);
  await audit(user, { action: `${entity}.update`, entity, entityId: id, summary: `Editou ${m.label}: ${nameOf(entity, saved)}`, before: current, after: saved });
  return decorate(entity, saved, user);
}

export async function transitionRecord(entity, user, id, { to, note, channels, channelNote }) {
  const m = meta(entity);
  if (!m.transitions) throw badRequest('Esta área não usa fluxo de aprovação.');
  const store = getStore();
  const current = await store.get(m.collection, id);
  if (!current) throw notFound();
  const transition = findTransition(m.transitions, current.status, to);
  if (!transition) throw badRequest(`Não é possível ir de "${m.statuses[current.status]?.label}" para "${m.statuses[to]?.label || to}".`);
  if (!roleMatches(user, transition.who)) throw forbidden('Seu papel não permite esta mudança de etapa.');
  const cleanNote = clean.text(note, { max: 2000, label: 'Observação' });
  if (transition.requires === 'note' && !cleanNote) throw badRequest('Escreva o motivo para a equipe entender o que fazer.');
  if (transition.requires === 'file' && !current.fileRef) throw badRequest('Indique a referência do arquivo da arte (pasta media/) antes de entregar.');
  const patch = { status: to, updatedAt: now(), updatedBy: user.id };
  const noteText = `${m.statuses[current.status].label} → ${m.statuses[to].label}${cleanNote ? `: ${cleanNote}` : ''}`;
  patch.notes = [...(current.notes || []), { text: noteText, at: now(), by: user.name }].slice(-200);
  if (transition.requires === 'channels') {
    const list = clean.list(channels, PUBLICATION_CHANNELS, { label: 'Canais' });
    if (!list.length) throw badRequest('Marque em quais canais a arte foi enviada ou publicada.');
    patch.publications = [...(current.publications || []), ...list.map(channel => ({ channel, at: now(), by: user.name, note: clean.text(channelNote, { max: 500 }) }))];
  }
  if (to === 'approved') patch.approvedBy = { id: user.id, name: user.name, at: now() };
  if (entity === 'arts' && to === 'awaiting_approval') patch.deliveredAt = now();
  const saved = await store.update(m.collection, id, patch);
  await audit(user, { action: `${entity}.status`, entity, entityId: id, summary: `${m.label[0].toUpperCase()}${m.label.slice(1)} "${nameOf(entity, current)}": ${noteText}`, before: { status: current.status }, after: { status: to } });
  return decorate(entity, saved, user);
}

export async function addNote(entity, user, id, text) {
  const m = meta(entity);
  const store = getStore();
  const current = await store.get(m.collection, id);
  if (!current) throw notFound();
  const note = { text: clean.text(text, { required: true, max: 2000, label: 'Observação' }), at: now(), by: user.name };
  const saved = await store.update(m.collection, id, { notes: [...(current.notes || []), note].slice(-200), updatedAt: now() });
  await audit(user, { action: `${entity}.note`, entity, entityId: id, summary: `Comentou em ${m.label} "${nameOf(entity, current)}"` });
  return decorate(entity, saved, user);
}

// Marketing indica o arquivo local da arte (caminho dentro de media/).
export async function setArtFile(user, id, fileRef) {
  if (!['marketing', 'owner', 'manager'].includes(user.role)) throw forbidden();
  const store = getStore();
  const current = await store.get(C.arts, id);
  if (!current) throw notFound();
  const ref = clean.fileRef(fileRef);
  const saved = await store.update(C.arts, id, { fileRef: ref, updatedAt: now(), updatedBy: user.id });
  await audit(user, { action: 'arts.file', entity: 'arts', entityId: id, summary: `Arquivo da arte "${current.title}": ${ref || '(removido)'}`, before: { fileRef: current.fileRef }, after: { fileRef: ref } });
  return decorate('arts', saved, user);
}

export async function removeRecord(entity, user, id) {
  const m = meta(entity);
  if (!['owner', 'manager'].includes(user.role)) throw forbidden('Somente dono ou gerente excluem registros.');
  const store = getStore();
  const current = await store.get(m.collection, id);
  if (!current) throw notFound();
  if (entity === 'campaigns' || entity === 'promotions') {
    const arts = await store.list(C.arts, { where: [['originId', '==', id]] });
    if (arts.length) throw badRequest(`Existem ${arts.length} artes ligadas a este registro. Cancele em vez de excluir.`);
  }
  await store.remove(m.collection, id);
  await audit(user, { action: `${entity}.delete`, entity, entityId: id, summary: `Excluiu ${m.label}: ${nameOf(entity, current)}`, before: current });
}
