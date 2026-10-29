// Fila de publicação: do produto escolhido pelo dono até o anúncio em cada canal de venda
// (site/Nuvemshop, Shopee, Mercado Livre…). Cada canal tem preço, taxa e líquido próprios.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, notFound, conflict, clean } from '../http.js';
import { getProduct, invalidateProductCache, seesCost } from './products.js';
import { getChannels } from './settings.js';
import { publishProduct, NuvemshopNotConfigured } from '../integrations/nuvemshop.js';
import { publishToMarketplace } from '../integrations/marketplaces.js';
import { checkMediaRefs } from '../media.js';
import {
  QUEUE_STAGES, QUEUE_TRANSITIONS, PRIORITIES, availableTransitions, findTransition, roleMatches, canApprove, channelFees, marginOf
} from '../../public/shared/domain.js';

const now = () => new Date().toISOString();
const isPricer = user => user.role === 'owner' || (user.role === 'manager' && canApprove(user));

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
  const out = {
    ...item,
    transitions: availableTransitions(QUEUE_TRANSITIONS, item.stage, user).map(t => ({ to: t.to, label: t.label, requires: t.requires || null })),
    can: {
      editPricing: isPricer(user) && item.stage !== 'published',
      editContent: user.role === 'site' && ['selected', 'preparing'].includes(item.stage),
      publish: ['site', 'owner'].includes(user.role) && ['approved', 'published'].includes(item.stage)
    }
  };
  if (!seesCost(user)) {
    // Custo e margem são só de dono/gerente.
    out.productSnapshot = { ...item.productSnapshot, cost: undefined };
    out.channels = (item.channels || []).map(({ margin, promoMargin, ...rest }) => rest);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preço por canal. Entrada: channels: [{ id, price, promoPrice? }], promoStart, promoEnd.
// Guarda junto a taxa e o líquido calculados com a tabela vigente (histórico do que foi decidido).
// ---------------------------------------------------------------------------
async function readChannels(input, product) {
  const config = await getChannels();
  const raw = Array.isArray(input.channels) ? input.channels : [];
  if (!raw.length) throw badRequest('Escolha ao menos um canal de venda.');
  const promoStart = clean.date(input.promoStart, { label: 'Início da promoção' });
  const promoEnd = clean.date(input.promoEnd, { label: 'Fim da promoção' });
  const seen = new Set();
  const channels = raw.map(entry => {
    const channel = config.find(c => c.id === entry.id && c.active !== false);
    if (!channel) throw badRequest(`Canal de venda inválido: ${entry.id}`);
    if (seen.has(channel.id)) throw badRequest(`${channel.name} aparece duas vezes.`);
    seen.add(channel.id);
    const price = clean.money(entry.price ?? product.basePrice, { required: true, label: `Preço em ${channel.name}` });
    const promoPrice = clean.money(entry.promoPrice, { label: `Preço promocional em ${channel.name}` });
    if (promoPrice !== null && !(promoPrice < price)) throw badRequest(`${channel.name}: o preço promocional precisa ser menor que ${price.toFixed(2).replace('.', ',')}.`);
    const fees = channelFees(price, channel);
    const promoFees = promoPrice !== null ? channelFees(promoPrice, channel) : null;
    return {
      id: channel.id, name: channel.name, integration: channel.integration || null,
      price, promoPrice,
      feeRule: { percent: channel.percent, fixed: channel.fixed, fixedBelow: channel.fixedBelow ?? null },
      fee: fees.fee, net: fees.net,
      promoFee: promoFees?.fee ?? null, promoNet: promoFees?.net ?? null,
      margin: marginOf(fees, product.cost), promoMargin: promoFees ? marginOf(promoFees, product.cost) : null
    };
  });
  const hasPromo = channels.some(c => c.promoPrice !== null);
  if (hasPromo) {
    if (!promoStart || !promoEnd) throw badRequest('Informe início e fim da promoção.');
    if (promoEnd < promoStart) throw badRequest('O fim da promoção precisa ser depois do início.');
  }
  return { channels, promoStart: hasPromo ? promoStart : '', promoEnd: hasPromo ? promoEnd : '' };
}

// Mantém a situação de publicação dos canais que continuam escolhidos.
function mergeListings(previous = {}, channels) {
  const listings = {};
  for (const c of channels) listings[c.id] = previous[c.id] || { status: 'idle', attempts: 0, lastError: '', externalId: '', url: '', publishedAt: null };
  return listings;
}

// Dono (ou gerente aprovador) escolhe o produto, os canais e o preço em cada um.
export async function selectProduct(user, input) {
  if (!isPricer(user)) throw forbidden('Somente o dono (ou gerente autorizado) escolhe produtos e preços de venda.');
  const product = await getProduct(clean.text(input.productId, { required: true, label: 'Produto' }));
  const store = getStore();
  const active = await store.list(C.queue, { where: [['productId', '==', product.id]] });
  if (active.some(i => i.stage !== 'archived')) throw conflict('Este produto já está na fila de publicação. Abra o item existente.');

  const pricing = await readChannels(input, product);
  const item = {
    productId: product.id,
    productSnapshot: { sku: product.sku, name: product.name, category: product.category, basePrice: product.basePrice, stock: product.stock, cost: product.cost ?? null },
    stage: 'selected',
    ...pricing,
    listings: mergeListings({}, pricing.channels),
    priority: clean.oneOf(input.priority, PRIORITIES, { label: 'Prioridade', fallback: 'Normal' }),
    notes: clean.text(input.notes, { max: 2000, label: 'Observação' }),
    campaignId: clean.text(input.campaignId, { max: 120 }),
    content: { title: product.name, description: '', seoTitle: '', seoDescription: '', category: product.category, imageRefs: [], siteNotes: '' },
    requestedBy: { id: user.id, name: user.name },
    createdAt: now(), updatedAt: now(), updatedBy: user.id
  };
  const saved = await store.create(C.queue, item);
  invalidateProductCache();
  await audit(user, {
    action: 'queue.select', entity: 'queue', entityId: saved.id,
    summary: `Escolheu ${product.name} para ${pricing.channels.map(c => c.name).join(', ')}`, after: item
  });
  return decorate(saved, user);
}

export async function updatePricing(user, id, input) {
  const store = getStore();
  const item = await store.get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  if (!isPricer(user)) throw forbidden('Só o dono ou gerente autorizado altera preço.');
  if (item.stage === 'published') throw badRequest('Produto já publicado: mudanças de preço nos canais ainda não são enviadas automaticamente (ver docs/ROADMAP.md).');
  const product = await getProduct(item.productId);
  const pricing = await readChannels({ ...item, ...input }, product);
  const patch = {
    ...pricing,
    listings: mergeListings(item.listings, pricing.channels),
    productSnapshot: { ...item.productSnapshot, basePrice: product.basePrice, stock: product.stock, cost: product.cost ?? null },
    priority: clean.oneOf(input.priority ?? item.priority, PRIORITIES, { label: 'Prioridade' }),
    notes: clean.text(input.notes ?? item.notes, { max: 2000, label: 'Observação' }),
    campaignId: clean.text(input.campaignId ?? item.campaignId, { max: 120 }),
    updatedAt: now(), updatedBy: user.id
  };
  const saved = await store.update(C.queue, id, patch);
  await audit(user, { action: 'queue.pricing', entity: 'queue', entityId: id, summary: `Atualizou canais e preços de ${item.productSnapshot.name}`, before: item, after: saved });
  return decorate(saved, user);
}

// Conteúdo do anúncio (responsável pelo site). Vale para todos os canais.
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
  if (to === 'published') throw badRequest('A etapa "Publicado" muda sozinha quando todos os canais estiverem publicados.');
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

// Quando todos os canais escolhidos estão publicados, o item vai para "Publicado".
async function settleStage(store, item, user) {
  const allDone = (item.channels || []).every(c => item.listings?.[c.id]?.status === 'done');
  if (!allDone || item.stage === 'published') return item;
  const history = [...(item.stageHistory || []), { from: item.stage, to: 'published', at: now(), by: user.name, note: 'Todos os canais publicados' }];
  return store.update(C.queue, item.id, { stage: 'published', stageHistory: history, updatedAt: now() });
}

function requireListing(item, channelId, user) {
  if (!['site', 'owner'].includes(user.role)) throw forbidden('A publicação é feita pelo responsável do site ou pelo dono.');
  if (!['approved', 'published'].includes(item.stage)) throw badRequest('Só itens aprovados podem ser publicados.');
  const channel = (item.channels || []).find(c => c.id === channelId);
  if (!channel) throw badRequest('Este canal não foi escolhido para este produto.');
  return channel;
}

// Publicação automática pela API do canal. Sem integração configurada, registra a pendência sem fingir sucesso.
export async function publishQueueItem(user, id, channelId = 'site') {
  const store = getStore();
  const item = await store.get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  const channel = requireListing(item, channelId, user);
  const listing = item.listings?.[channelId] || { attempts: 0 };
  if (listing.status === 'publishing') throw conflict('Este canal já está sendo enviado. Aguarde.');
  if (listing.status === 'done') throw conflict(`${channel.name} já está publicado.`);

  const attempts = (listing.attempts || 0) + 1;
  await store.update(C.queue, id, { listings: { ...item.listings, [channelId]: { ...listing, status: 'publishing', attempts, lastAttemptAt: now() } } });
  try {
    const result = channel.integration === 'nuvemshop'
      ? await publishProduct({ ...item, listing }, channel)
      : await publishToMarketplace(channel, item);
    const done = {
      ...listing, status: 'done', attempts, lastError: '', lastAttemptAt: now(), publishedAt: now(), manual: false,
      externalId: result.externalId, url: result.url || '', imageWarnings: result.imageWarnings || [], imagesSent: !!result.imagesSent, by: user.name
    };
    let saved = await store.update(C.queue, id, { listings: { ...item.listings, [channelId]: done }, updatedAt: now(), updatedBy: user.id });
    saved = await settleStage(store, saved, user);
    invalidateProductCache();
    await audit(user, { action: 'queue.publish', entity: 'queue', entityId: id, summary: `Publicou ${item.productSnapshot.name} em ${channel.name} (ID ${result.externalId})` });
    return { item: decorate(saved, user), warnings: result.imageWarnings || [] };
  } catch (error) {
    const notConfigured = error instanceof NuvemshopNotConfigured || error.code === 'NOT_CONFIGURED' || error.code === 'NOT_IMPLEMENTED';
    const failed = { ...listing, status: notConfigured ? 'idle' : 'failed', attempts, lastAttemptAt: now(), lastError: error.message };
    const saved = await store.update(C.queue, id, { listings: { ...item.listings, [channelId]: failed }, updatedAt: now(), updatedBy: user.id });
    await audit(user, {
      action: notConfigured ? 'queue.publish_pending' : 'queue.publish_failed', entity: 'queue', entityId: id,
      summary: `${notConfigured ? 'Publicação pendente' : 'Falha ao publicar'} ${item.productSnapshot.name} em ${channel.name}: ${error.message}`
    });
    throw badRequest(error.message, { item: decorate(saved, user), code: error.code || (notConfigured ? 'NOT_CONFIGURED' : 'PUBLISH_FAILED') });
  }
}

// Canal sem integração automática: a pessoa publica no painel do canal e registra aqui o link/ID.
// Fica marcado como "registrado à mão por <nome>" — não é confundido com confirmação da API.
export async function recordManualListing(user, id, channelId, input) {
  const store = getStore();
  const item = await store.get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  const channel = requireListing(item, channelId, user);
  if (channel.integration === 'nuvemshop') throw badRequest('O site é publicado pela integração com a Nuvemshop. Use "Publicar".');
  const url = clean.text(input.url, { max: 500, label: 'Link do anúncio' });
  if (url && !/^https:\/\/\S+$/.test(url)) throw badRequest('O link do anúncio precisa começar com https://');
  const externalId = clean.text(input.externalId, { max: 120, label: 'Código do anúncio' });
  if (!url && !externalId) throw badRequest('Informe o link ou o código do anúncio para a equipe conseguir conferir.');
  const listing = { ...(item.listings?.[channelId] || {}), status: 'done', manual: true, by: user.name, publishedAt: now(), url, externalId, lastError: '', note: clean.text(input.note, { max: 500 }) };
  let saved = await store.update(C.queue, id, { listings: { ...item.listings, [channelId]: listing }, updatedAt: now(), updatedBy: user.id });
  saved = await settleStage(store, saved, user);
  invalidateProductCache();
  await audit(user, { action: 'queue.listing_manual', entity: 'queue', entityId: id, summary: `Registrou anúncio de ${item.productSnapshot.name} em ${channel.name} (feito à mão)` });
  return decorate(saved, user);
}
