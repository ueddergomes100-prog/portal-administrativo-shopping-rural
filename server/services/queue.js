// Fila de publicação: do produto escolhido pelo dono até estar à venda em cada canal
// (site próprio, Shopee, Mercado Livre…). Cada canal tem preço, taxa e líquido próprios.
// Site próprio: "publicar" coloca o produto no catálogo que o site lê (services/store.js).
// Marketplaces: a equipe anuncia no painel do canal e registra aqui o link.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, notFound, conflict, clean } from '../http.js';
import { getProduct, invalidateProductCache, seesCost } from './products.js';
import { getChannels } from './settings.js';
import { checkMediaRefs } from '../media.js';
import { config } from '../config.js';
import {
  QUEUE_STAGES, QUEUE_TRANSITIONS, PRIORITIES, availableTransitions, findTransition, roleMatches, canApprove, channelFees, marginOf, slugify,
  SITE_CATEGORIES, SITE_PETS, SITE_UNITS, SITE_TAGS
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
      editPricing: isPricer(user) && !['archived', 'blocked'].includes(item.stage),
      editContent: user.role === 'site' && ['selected', 'preparing'].includes(item.stage),
      publish: ['site', 'owner'].includes(user.role) && ['approved', 'published'].includes(item.stage),
      siteUrl: config.store.publicUrl || ''
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
  for (const c of channels) listings[c.id] = previous[c.id] || { status: 'idle', externalId: '', url: '', publishedAt: null };
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
    content: {
      title: product.name, description: '', seoTitle: '', seoDescription: '', category: product.category, imageRefs: [], siteNotes: '',
      // Campos que o site próprio exibe (ver docs/SITE.md).
      brand: '', pet: '', siteCategory: '', measureValue: null, measureUnit: 'un', weightKg: null, tag: '', short: '', specs: []
    },
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
  const product = await getProduct(item.productId);
  const pricing = await readChannels({ ...item, ...input }, product);
  // Site próprio lê o preço novo na hora. Marketplaces já anunciados ficam marcados
  // "atualizar anúncio" até a pessoa corrigir no painel e confirmar.
  const listings = mergeListings(item.listings, pricing.channels);
  for (const channel of pricing.channels) {
    const old = (item.channels || []).find(c => c.id === channel.id);
    const changed = old && (old.price !== channel.price || old.promoPrice !== channel.promoPrice || item.promoStart !== pricing.promoStart || item.promoEnd !== pricing.promoEnd);
    if (changed && !channel.integration && listings[channel.id]?.status === 'done') listings[channel.id] = { ...listings[channel.id], needsUpdate: true };
  }
  const patch = {
    ...pricing,
    listings,
    productSnapshot: { ...item.productSnapshot, basePrice: product.basePrice, stock: product.stock, cost: product.cost ?? null },
    priority: clean.oneOf(input.priority ?? item.priority, PRIORITIES, { label: 'Prioridade' }),
    notes: clean.text(input.notes ?? item.notes, { max: 2000, label: 'Observação' }),
    campaignId: clean.text(input.campaignId ?? item.campaignId, { max: 120 }),
    updatedAt: now(), updatedBy: user.id
  };
  let saved = await store.update(C.queue, id, patch);
  saved = await settleStage(store, saved, user);
  invalidateProductCache();
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
    siteNotes: clean.text(input.siteNotes ?? item.content.siteNotes, { max: 2000, label: 'Observações' }),
    ...readSiteFields(input, item.content)
  };
  const patch = { content, updatedAt: now(), updatedBy: user.id };
  if (item.stage === 'selected') patch.stage = 'preparing';
  const saved = await store.update(C.queue, id, patch);
  await audit(user, { action: 'queue.content', entity: 'queue', entityId: id, summary: `Atualizou conteúdo de ${item.productSnapshot.name}`, before: item, after: saved });
  return decorate(saved, user);
}

// "Rótulo: valor" por linha (ou lista de objetos) -> [{ label, value }].
function readSpecs(value) {
  const rows = Array.isArray(value) ? value : String(value ?? '').split('\n');
  return rows.map(row => {
    if (row && typeof row === 'object') return { label: String(row.label ?? '').trim(), value: String(row.value ?? '').trim() };
    const [label, ...rest] = String(row).split(':');
    return { label: label.trim(), value: rest.join(':').trim() };
  }).filter(s => s.label && s.value).slice(0, 20).map(s => ({ label: s.label.slice(0, 60), value: s.value.slice(0, 160) }));
}

const optionalNumber = (value, label) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw badRequest(`${label} precisa ser um número maior que zero.`);
  return Math.round(n * 1000) / 1000;
};

function readSiteFields(input, current = {}) {
  const pick = key => (input[key] !== undefined ? input[key] : current[key]);
  return {
    brand: clean.text(pick('brand'), { max: 80, label: 'Marca' }),
    pet: clean.oneOf(pick('pet') || '', ['', ...Object.keys(SITE_PETS)], { label: 'Pet' }),
    siteCategory: clean.oneOf(pick('siteCategory') || '', ['', ...Object.keys(SITE_CATEGORIES)], { label: 'Categoria do site' }),
    measureValue: optionalNumber(pick('measureValue'), 'Medida'),
    measureUnit: clean.oneOf(pick('measureUnit') || 'un', Object.keys(SITE_UNITS), { label: 'Unidade da medida' }),
    weightKg: optionalNumber(pick('weightKg'), 'Peso para frete'),
    tag: clean.oneOf(pick('tag') || '', SITE_TAGS, { label: 'Selo' }),
    short: clean.text(pick('short'), { max: 160, label: 'Resumo' }),
    specs: readSpecs(pick('specs'))
  };
}

// O que o site precisa para exibir o produto (além de título, descrição e foto).
function siteProblems(item) {
  const c = item.content || {};
  const missing = [];
  if (!c.brand) missing.push('marca');
  if (!c.siteCategory) missing.push('categoria do site');
  if (!c.pet) missing.push('pet (cão, gato ou ambos)');
  if (!c.measureValue) missing.push('medida (ex.: 15 kg, 1 un)');
  if (!c.short) missing.push('resumo');
  if (c.measureUnit !== 'kg' && !c.weightKg) missing.push('peso para frete');
  return missing;
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
    // Com o canal Site próprio, os dados que o site exibe já são cobrados aqui.
    const hasSite = (item.channels || []).some(c => c.integration === 'site');
    const missing = [...contentProblems(item), ...(hasSite ? siteProblems(item) : [])];
    if (missing.length) throw badRequest('Antes de enviar para aprovação, preencha: ' + missing.join(', ') + '.');
  }
  const history = [...(item.stageHistory || []), { from: item.stage, to, at: now(), by: user.name, note: cleanNote }].slice(-50);
  const patch = { stage: to, stageHistory: history, updatedAt: now(), updatedBy: user.id };
  if (to === 'approved') patch.approvedBy = { id: user.id, name: user.name, at: now() };
  // Bloquear ou arquivar tira o produto do site na hora (marketplaces: a equipe pausa no painel).
  if (['blocked', 'archived'].includes(to) && item.listings?.site?.status === 'done') {
    patch.listings = { ...item.listings, site: { status: 'idle', externalId: '', url: '', publishedAt: null, removedAt: now(), removedBy: user.name } };
  }
  let saved = await store.update(C.queue, id, patch);
  if (to === 'approved') saved = await settleStage(store, saved, user);
  invalidateProductCache();
  await audit(user, {
    action: 'queue.stage', entity: 'queue', entityId: id,
    summary: `${item.productSnapshot.name}: ${QUEUE_STAGES[item.stage].label} → ${QUEUE_STAGES[to].label}${cleanNote ? ` (${cleanNote})` : ''}`,
    before: { stage: item.stage }, after: { stage: to }
  });
  return decorate(saved, user);
}

// Quando todos os canais escolhidos estão publicados, o item vai para "Publicado".
// Se algum canal deixar de estar publicado, volta para "Aprovado".
async function settleStage(store, item, user) {
  const allDone = (item.channels || []).every(c => item.listings?.[c.id]?.status === 'done');
  if (allDone && item.stage === 'approved') {
    const history = [...(item.stageHistory || []), { from: 'approved', to: 'published', at: now(), by: user.name, note: 'Todos os canais publicados' }];
    return store.update(C.queue, item.id, { stage: 'published', stageHistory: history, updatedAt: now() });
  }
  if (!allDone && item.stage === 'published') {
    const history = [...(item.stageHistory || []), { from: 'published', to: 'approved', at: now(), by: user.name, note: 'Um canal saiu do ar' }];
    return store.update(C.queue, item.id, { stage: 'approved', stageHistory: history, updatedAt: now() });
  }
  return item;
}

async function loadForListing(user, id, channelId) {
  const store = getStore();
  const item = await store.get(C.queue, id);
  if (!item) throw notFound('Item da fila não encontrado.');
  if (!['site', 'owner'].includes(user.role)) throw forbidden('Quem publica é o responsável pelo site e marketplaces, ou o dono.');
  if (!['approved', 'published'].includes(item.stage)) throw badRequest('Só itens aprovados podem ser publicados.');
  const channel = (item.channels || []).find(c => c.id === channelId);
  if (!channel) throw badRequest('Este canal não foi escolhido para este produto.');
  return { store, item, channel };
}

// Endereço único do produto no site (usa o título; se repetir, acrescenta o SKU).
async function uniqueSlug(store, item) {
  if (item.slug) return item.slug;
  const base = slugify(item.content?.title || item.productSnapshot.name);
  const taken = new Set((await store.list(C.queue)).filter(i => i.id !== item.id && i.slug).map(i => i.slug));
  let slug = taken.has(base) ? `${base}-${slugify(item.productSnapshot.sku || item.productId)}` : base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export function siteProductUrl(slug) {
  if (!config.store.publicUrl) return '';
  return config.store.publicUrl + config.store.productPath.replace('{slug}', encodeURIComponent(slug));
}

// Site próprio: coloca o produto no catálogo lido pelo site (GET /api/store/catalog).
export async function publishToSite(user, id) {
  const { store, item, channel } = await loadForListing(user, id, 'site');
  if (channel.integration !== 'site') throw badRequest('Este canal não é o site próprio.');
  const missing = [...contentProblems(item), ...siteProblems(item)];
  if (missing.length) throw badRequest('Para publicar no site, complete no conteúdo do anúncio: ' + missing.join(', ') + '.');
  const slug = await uniqueSlug(store, item);
  const listing = { status: 'done', manual: false, publishedAt: now(), by: user.name, externalId: slug, url: siteProductUrl(slug) };
  let saved = await store.update(C.queue, id, { slug, listings: { ...item.listings, site: listing }, updatedAt: now(), updatedBy: user.id });
  saved = await settleStage(store, saved, user);
  invalidateProductCache();
  await audit(user, { action: 'queue.publish_site', entity: 'queue', entityId: id, summary: `Publicou ${item.productSnapshot.name} no site (/${slug})` });
  return decorate(saved, user);
}

// Marketplaces: a pessoa anunciou no painel do canal e registra aqui o link/código.
export async function recordListing(user, id, channelId, input) {
  const { store, item, channel } = await loadForListing(user, id, channelId);
  if (channel.integration === 'site') throw badRequest('O site próprio é publicado pelo botão "Publicar no site".');
  const url = clean.text(input.url, { max: 500, label: 'Link do anúncio' });
  if (url && !/^https:\/\/\S+$/.test(url)) throw badRequest('O link do anúncio precisa começar com https://');
  const externalId = clean.text(input.externalId, { max: 120, label: 'Código do anúncio' });
  if (!url && !externalId) throw badRequest('Informe o link ou o código do anúncio para a equipe conseguir conferir.');
  const listing = { status: 'done', manual: true, by: user.name, publishedAt: now(), url, externalId, note: clean.text(input.note, { max: 500 }) };
  let saved = await store.update(C.queue, id, { listings: { ...item.listings, [channelId]: listing }, updatedAt: now(), updatedBy: user.id });
  saved = await settleStage(store, saved, user);
  invalidateProductCache();
  await audit(user, { action: 'queue.listing', entity: 'queue', entityId: id, summary: `Registrou anúncio de ${item.productSnapshot.name} em ${channel.name}` });
  return decorate(saved, user);
}

// Tira do site (sai do catálogo) ou desfaz o registro de um marketplace.
export async function removeListing(user, id, channelId) {
  const { store, item, channel } = await loadForListing(user, id, channelId);
  const before = item.listings?.[channelId];
  if (before?.status !== 'done') throw badRequest(`${channel.name} não está publicado.`);
  const listing = { status: 'idle', externalId: '', url: '', publishedAt: null, removedAt: now(), removedBy: user.name };
  let saved = await store.update(C.queue, id, { listings: { ...item.listings, [channelId]: listing }, updatedAt: now(), updatedBy: user.id });
  saved = await settleStage(store, saved, user);
  invalidateProductCache();
  await audit(user, {
    action: 'queue.listing_removed', entity: 'queue', entityId: id,
    summary: channel.integration === 'site' ? `Tirou ${item.productSnapshot.name} do site` : `Desfez o registro de ${item.productSnapshot.name} em ${channel.name}`
  });
  return decorate(saved, user);
}
