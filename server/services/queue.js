// Fila de publicação: do produto escolhido pelo dono até o cadastro confirmado na Nuvemshop.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, notFound, conflict, clean } from '../http.js';
import { getProduct } from './products.js';
import { invalidateProductCache } from './products.js';
import { publishProduct, NuvemshopNotConfigured } from '../integrations/nuvemshop.js';
import { checkMediaRefs } from '../media.js';
import {
  QUEUE_STAGES, QUEUE_TRANSITIONS, PRIORITIES, availableTransitions, findTransition, roleMatches, canApprove
} from '../../public/shared/domain.js';

const now = () => new Date().toISOString();

// O responsável pelo site só vê o que é relevante para ele (sem itens arquivados).
export async function listQueue(user, { stage } = {}) {
  let items = await getStore().list(C.queue, { orderBy: 'updatedAt', direction: 'desc' });
  if (user.role === 'site') items = items.filter(i => i.stage !== 'archived');
  if (user.role === 'marketing') items = items.filter(i => !['archived', 'blocked'].includes(i.stage));
  if (stage) items = items.filter(i => i.stage === stage);
  return items.map(item => decorate(item, user));
}

export async function getQueueItem(user, id) {
  const item = await getStore().get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  const decorated = decorate(item, user);
  decorated.mediaCheck = checkMediaRefs(item.content?.imageRefs || []);
  return decorated;
}

function decorate(item, user) {
  return {
    ...item,
    transitions: availableTransitions(QUEUE_TRANSITIONS, item.stage, user).map(t => ({ to: t.to, label: t.label, requires: t.requires || null })),
    can: {
      editPricing: ['owner'].includes(user.role) || (user.role === 'manager' && canApprove(user)),
      editContent: user.role === 'site' && ['selected', 'preparing'].includes(item.stage),
      publish: ['site', 'owner'].includes(user.role) && item.stage === 'approved'
    }
  };
}

function readPricing(input, product) {
  const priceMode = clean.oneOf(input.priceMode, ['erp', 'custom'], { label: 'Modo de preço', fallback: 'erp' });
  const sitePrice = priceMode === 'custom' ? clean.money(input.sitePrice, { required: true, label: 'Preço do site' }) : null;
  const basePrice = priceMode === 'custom' ? sitePrice : product.basePrice;
  const promoPrice = clean.money(input.promoPrice, { label: 'Preço promocional' });
  const promoStart = clean.date(input.promoStart, { label: 'Início da promoção' });
  const promoEnd = clean.date(input.promoEnd, { label: 'Fim da promoção' });
  if (promoPrice !== null) {
    if (!(promoPrice < basePrice)) throw badRequest('O preço promocional precisa ser menor que o preço de venda.');
    if (!promoStart || !promoEnd) throw badRequest('Informe início e fim da promoção.');
    if (promoEnd < promoStart) throw badRequest('O fim da promoção precisa ser depois do início.');
  }
  return { priceMode, sitePrice, promoPrice, promoStart: promoPrice ? promoStart : '', promoEnd: promoPrice ? promoEnd : '' };
}

// Dono (ou gerente aprovador) seleciona o produto para o site.
export async function selectProduct(user, input) {
  if (!(user.role === 'owner' || (user.role === 'manager' && canApprove(user)))) {
    throw forbidden('Somente o dono (ou gerente autorizado) seleciona produtos para o site.');
  }
  const product = await getProduct(clean.text(input.productId, { required: true, label: 'Produto' }));
  const store = getStore();
  const active = await store.list(C.queue, { where: [['productId', '==', product.id]] });
  if (active.some(i => i.stage !== 'archived')) throw conflict('Este produto já está na fila de publicação. Abra o item existente.');

  const item = {
    productId: product.id,
    productSnapshot: { sku: product.sku, name: product.name, category: product.category, basePrice: product.basePrice, stock: product.stock },
    stage: 'selected',
    ...readPricing(input, product),
    priority: clean.oneOf(input.priority, PRIORITIES, { label: 'Prioridade', fallback: 'Normal' }),
    notes: clean.text(input.notes, { max: 2000, label: 'Observação' }),
    campaignId: clean.text(input.campaignId, { max: 120 }),
    content: { title: product.name, description: '', seoTitle: '', seoDescription: '', category: product.category, imageRefs: [], siteNotes: '' },
    publish: { status: 'idle', attempts: 0, lastError: '', externalId: '', lastAttemptAt: null, publishedAt: null },
    requestedBy: { id: user.id, name: user.name },
    createdAt: now(),
    updatedAt: now(),
    updatedBy: user.id
  };
  const saved = await store.create(C.queue, item);
  invalidateProductCache();
  await audit(user, { action: 'queue.select', entity: 'queue', entityId: saved.id, summary: `Selecionou ${product.name} para o site`, after: item });
  return decorate(saved, user);
}

// Ajuste de preço/prioridade/campanha (dono ou gerente aprovador).
export async function updatePricing(user, id, input) {
  const store = getStore();
  const item = await store.get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  if (!(user.role === 'owner' || (user.role === 'manager' && canApprove(user)))) throw forbidden('Só o dono ou gerente autorizado altera preço.');
  if (item.stage === 'published') throw badRequest('Produto já publicado: alterações de preço no site ainda não são sincronizadas (ver docs/ROADMAP.md).');
  const product = await getProduct(item.productId);
  const patch = {
    ...readPricing({ ...item, ...input }, product),
    priority: clean.oneOf(input.priority ?? item.priority, PRIORITIES, { label: 'Prioridade' }),
    notes: clean.text(input.notes ?? item.notes, { max: 2000, label: 'Observação' }),
    campaignId: clean.text(input.campaignId ?? item.campaignId, { max: 120 }),
    updatedAt: now(), updatedBy: user.id
  };
  const saved = await store.update(C.queue, id, patch);
  await audit(user, { action: 'queue.pricing', entity: 'queue', entityId: id, summary: `Atualizou preço/prioridade de ${item.productSnapshot.name}`, before: item, after: saved });
  return decorate(saved, user);
}

// Conteúdo do site (responsável pelo site).
export async function updateContent(user, id, input) {
  const store = getStore();
  const item = await store.get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  if (user.role !== 'site') throw forbidden('O conteúdo é preparado pelo responsável do site.');
  if (!['selected', 'preparing'].includes(item.stage)) throw badRequest('O conteúdo só pode ser editado em "Selecionado" ou "Em preparação".');
  const imageRefs = clean.ids(input.imageRefs ?? item.content.imageRefs, { label: 'Imagens', max: 10 }).map(clean.mediaRef).filter(Boolean);
  const content = {
    title: clean.text(input.title ?? item.content.title, { max: 160, label: 'Título' }),
    description: clean.text(input.description ?? item.content.description, { max: 20000, label: 'Descrição' }),
    seoTitle: clean.text(input.seoTitle ?? item.content.seoTitle, { max: 70, label: 'Título SEO' }),
    seoDescription: clean.text(input.seoDescription ?? item.content.seoDescription, { max: 320, label: 'Descrição SEO' }),
    category: clean.text(input.category ?? item.content.category, { max: 120, label: 'Categoria' }),
    imageRefs,
    siteNotes: clean.text(input.siteNotes ?? item.content.siteNotes, { max: 2000, label: 'Observações' })
  };
  const patch = { content, updatedAt: now(), updatedBy: user.id };
  if (item.stage === 'selected') patch.stage = 'preparing';
  const saved = await store.update(C.queue, id, patch);
  await audit(user, { action: 'queue.content', entity: 'queue', entityId: id, summary: `Atualizou conteúdo de ${item.productSnapshot.name}`, before: item, after: saved });
  return decorate(saved, user);
}

function contentProblems(item) {
  const missing = [];
  if (!item.content?.title) missing.push('título');
  if (!item.content?.description || item.content.description.length < 30) missing.push('descrição (mín. 30 caracteres)');
  if (!item.content?.imageRefs?.length) missing.push('ao menos uma foto');
  return missing;
}

export async function transitionQueue(user, id, { to, note }) {
  const store = getStore();
  const item = await store.get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  if (!QUEUE_STAGES[to]) throw badRequest('Etapa inválida.');
  if (to === 'published') throw badRequest('Use "Publicar na Nuvemshop" — a etapa muda só depois da confirmação da loja.');
  const transition = findTransition(QUEUE_TRANSITIONS, item.stage, to);
  if (!transition) throw badRequest(`Não é possível ir de "${QUEUE_STAGES[item.stage].label}" para "${QUEUE_STAGES[to].label}".`);
  if (!roleMatches(user, transition.who)) throw forbidden('Seu papel não permite esta mudança de etapa.');
  const cleanNote = clean.text(note, { max: 2000, label: 'Observação' });
  if (transition.requires === 'note' && !cleanNote) throw badRequest('Escreva o motivo para a equipe entender o que fazer.');
  if (transition.requires === 'content') {
    const missing = contentProblems(item);
    if (missing.length) throw badRequest('Antes de enviar para aprovação, preencha: ' + missing.join(', ') + '.');
  }
  const history = [...(item.stageHistory || []), { from: item.stage, to, at: now(), by: user.name, note: cleanNote }].slice(-50);
  const patch = { stage: to, stageHistory: history, updatedAt: now(), updatedBy: user.id };
  if (to === 'approved') patch.approvedBy = { id: user.id, name: user.name, at: now() };
  const saved = await store.update(C.queue, id, patch);
  invalidateProductCache();
  await audit(user, {
    action: 'queue.stage', entity: 'queue', entityId: id,
    summary: `${item.productSnapshot.name}: ${QUEUE_STAGES[item.stage].label} → ${QUEUE_STAGES[to].label}${cleanNote ? ` (${cleanNote})` : ''}`,
    before: { stage: item.stage }, after: { stage: to }
  });
  return decorate(saved, user);
}

// Publicação real. Sem integração configurada, registra a pendência sem fingir sucesso.
export async function publishQueueItem(user, id) {
  const store = getStore();
  const item = await store.get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  if (!['site', 'owner'].includes(user.role)) throw forbidden('A publicação é feita pelo responsável do site.');
  if (item.stage !== 'approved') throw badRequest('Só itens aprovados podem ser publicados na Nuvemshop.');
  if (item.publish?.status === 'publishing') throw conflict('Este item já está sendo enviado. Aguarde.');

  const attempts = (item.publish?.attempts || 0) + 1;
  await store.update(C.queue, id, { publish: { ...item.publish, status: 'publishing', attempts, lastAttemptAt: now() } });
  try {
    const result = await publishProduct(item);
    const publish = {
      ...item.publish, status: 'done', attempts, lastError: '', lastAttemptAt: now(), publishedAt: now(),
      externalId: result.externalId, url: result.url, imagesSent: result.imagesSent, imageWarnings: result.imageWarnings
    };
    const history = [...(item.stageHistory || []), { from: 'approved', to: 'published', at: now(), by: user.name, note: '' }];
    const saved = await store.update(C.queue, id, { stage: 'published', publish, stageHistory: history, updatedAt: now(), updatedBy: user.id });
    invalidateProductCache();
    await audit(user, { action: 'queue.publish', entity: 'queue', entityId: id, summary: `Publicou ${item.productSnapshot.name} na Nuvemshop (ID ${result.externalId})` });
    return { item: decorate(saved, user), warnings: result.imageWarnings };
  } catch (error) {
    const notConfigured = error instanceof NuvemshopNotConfigured;
    const publish = { ...item.publish, status: notConfigured ? 'idle' : 'failed', attempts, lastAttemptAt: now(), lastError: error.message };
    const saved = await store.update(C.queue, id, { publish, updatedAt: now(), updatedBy: user.id });
    await audit(user, {
      action: notConfigured ? 'queue.publish_pending' : 'queue.publish_failed', entity: 'queue', entityId: id,
      summary: `${notConfigured ? 'Publicação pendente' : 'Falha ao publicar'} ${item.productSnapshot.name}: ${error.message}`
    });
    const response = badRequest(error.message, { item: decorate(saved, user), code: notConfigured ? 'NOT_CONFIGURED' : 'PUBLISH_FAILED' });
    throw response;
  }
}
