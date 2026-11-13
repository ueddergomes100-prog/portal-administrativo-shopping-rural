// Promoção ligada aos anúncios de cada lugar de venda.
//
// - A promoção escolhe ONDE vale (site, Shopee, Mercado Livre…) e os ANÚNCIOS que estão à venda ali,
//   com um preço de promoção por lugar (o preço normal de cada lugar vem do anúncio).
// - Aprovada: no site, o preço da promoção e as datas entram no anúncio e o site começa/termina
//   sozinho. Shopee e Mercado Livre são anunciados à mão (decisão da loja): a promoção ganha a tarefa
//   "cadastrar na Shopee", que aparece em "Para resolver agora" até alguém marcar como feita.
// - Cancelada ou editada depois de aprovada: sai do site (volta o que o anúncio tinha antes) e, onde
//   já tinha sido cadastrada à mão, vira a tarefa "tirar a promoção da Shopee".
import { getStore, C } from '../store/index.js';
import { badRequest, forbidden, notFound, clean } from '../http.js';
import { getChannels } from './settings.js';
import { withDeferredCatalog } from './catalog.js';
import { repriceItem } from './queue.js';
import { todayInSaoPaulo } from '../../public/shared/domain.js';

const brl = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const br = iso => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
const norm = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;
export const TASK_ROLES = ['owner', 'manager', 'site'];

// Anúncio à venda neste lugar: no site, publicado no catálogo; nos marketplaces, marcado "À venda".
export const isListed = (item, channelId) =>
  !['archived', 'blocked'].includes(item.stage) && item.listings?.[channelId]?.status === 'done' && (item.channels || []).some(c => c.id === channelId);

const itemName = item => item.content?.title || item.productSnapshot?.name || 'Produto';

// Anúncios que podem entrar numa promoção. query: channels=site,shopee · search · ids=queueIds · productId
export async function promotionCandidates(user, query = {}) {
  const channels = await getChannels();
  const known = new Set(channels.map(c => c.id));
  const wanted = String(query.channels || '').split(',').map(s => s.trim()).filter(id => known.has(id));
  const chosen = wanted.length ? wanted : [...known];
  const ids = new Set(String(query.ids || '').split(',').map(s => s.trim()).filter(Boolean));
  const terms = norm(query.search).split(/[+\s]+/).filter(Boolean);
  const queue = await getStore().list(C.queue);
  const out = [];
  for (const item of queue) {
    if (ids.size && !ids.has(item.id)) continue;
    if (query.productId && item.productId !== String(query.productId)) continue;
    const listedOn = chosen.filter(id => isListed(item, id));
    if (!listedOn.length && !ids.size) continue;
    const name = itemName(item);
    const text = norm(`${item.productSnapshot?.sku} ${name} ${item.productSnapshot?.name}`);
    if (terms.length && !terms.every(t => text.includes(t))) continue;
    out.push({
      queueId: item.id, productId: item.productId, sku: item.productSnapshot?.sku || '', name,
      prices: Object.fromEntries((item.channels || []).map(c => [c.id, c.price])),
      listedOn: [...known].filter(id => isListed(item, id)),
      promotion: item.promotion ? { id: item.promotion.id, name: item.promotion.name, start: item.promotion.start, end: item.promotion.end } : null,
      // Promoção feita no próprio anúncio, ainda valendo: impede aprovar (ver conflicts).
      ownPromoEnd: !item.promotion && (item.channels || []).some(c => c.promoPrice != null) && (item.promoEnd || '9999-12-31') >= todayInSaoPaulo() ? item.promoEnd || '' : null
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  // Busca: até 50 (para "Marcar todos" pegar uma família inteira, ex.: as areias); `more` avisa que há mais.
  const limit = ids.size ? 300 : 50;
  return { items: out.slice(0, limit), more: !ids.size && out.length > limit };
}

// Confere os produtos da promoção. raw: { queueId, prices: { canal: preço } } (ou o formato salvo,
// { queueId, channels: { canal: { promoPrice } } }, ou o antigo { productId, promoPrice }).
export async function readPromotionItems(rawItems, channelIds) {
  if (!rawItems.length) throw badRequest('Coloque pelo menos um produto na promoção.');
  if (rawItems.length > 200) throw badRequest('Uma promoção pode ter no máximo 200 produtos. Divida em duas.');
  const channels = (await getChannels()).filter(c => channelIds.includes(c.id));
  const queue = await getStore().list(C.queue);
  const byId = new Map(queue.map(i => [i.id, i]));
  const seen = new Set();
  const items = [];
  for (const raw of rawItems) {
    const item = byId.get(String(raw.queueId || '')) || queue.find(i => i.productId === String(raw.productId || '') && i.stage !== 'archived');
    if (!item) throw badRequest('Um dos produtos ainda não tem anúncio. Coloque à venda antes de pôr em promoção.');
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const name = itemName(item);
    const where = channels.filter(c => isListed(item, c.id));
    if (!where.length) throw badRequest(`${name} não está à venda em ${channels.map(c => c.name).join(' nem ')}. Tire da lista ou marque outro lugar.`);
    const prices = {};
    for (const channel of where) {
      const regularPrice = (item.channels || []).find(c => c.id === channel.id)?.price;
      const value = raw.prices?.[channel.id] ?? raw.channels?.[channel.id]?.promoPrice ?? raw.promoPrice;
      const promoPrice = clean.money(value, { required: true, label: `Preço da promoção de ${name} em ${channel.name}` });
      if (!(promoPrice < regularPrice)) throw badRequest(`${name}: em ${channel.name} o preço normal é ${brl(regularPrice)}. O da promoção precisa ser menor.`);
      prices[channel.id] = { regularPrice, promoPrice };
    }
    const first = prices[where[0].id];
    items.push({ queueId: item.id, productId: item.productId, sku: item.productSnapshot?.sku || '', name, channels: prices, regularPrice: first.regularPrice, promoPrice: first.promoPrice });
  }
  return items;
}

// Antes de aprovar: o mesmo anúncio não pode estar em duas promoções no mesmo lugar e período,
// nem ter promoção própria (feita no anúncio) que a do portal apagaria. O anúncio guarda um período
// de promoção só: enquanto outra promoção do portal não acabar, esta espera.
async function conflicts(promo, queue, siteIds) {
  const problems = [];
  const today = todayInSaoPaulo();
  const others = (await getStore().list(C.promotions, { where: [['status', '==', 'approved']] })).filter(p => p.id !== promo.id && overlaps(p, promo));
  for (const pi of promo.items || []) {
    if (!pi.queueId) continue;
    for (const other of others) {
      const hit = (other.items || []).find(o => o.queueId === pi.queueId);
      const shared = hit && Object.keys(pi.channels || {}).filter(ch => hit.channels?.[ch]);
      if (shared?.length) problems.push(`${pi.name} já está na promoção "${other.name}" (${br(other.start)} a ${br(other.end)})`);
    }
    const item = queue.get(pi.queueId);
    if (!item || item.promotion?.id === promo.id) continue;
    const onSite = siteIds.some(id => pi.channels?.[id]);
    if (onSite && item.promotion && item.promotion.end >= today) problems.push(`${pi.name} está na promoção "${item.promotion.name}" até ${br(item.promotion.end)}. Aprove esta depois que aquela acabar`);
    const ownPromo = (item.channels || []).some(c => c.promoPrice != null && !(item.promotion && siteIds.includes(c.id)));
    if (ownPromo && (item.promoEnd || '9999-12-31') >= today) problems.push(`${pi.name} já tem promoção própria no anúncio (até ${br(item.promoEnd)}). Tire a promoção do anúncio antes`);
  }
  if (problems.length) throw badRequest(`Não deu para aprovar: ${[...new Set(problems)].join('; ')}.`);
}

// Aprovou: entra no site (preço e datas no anúncio) e cria as tarefas dos marketplaces.
export async function applyPromotion(user, promo) {
  const store = getStore();
  const channels = await getChannels();
  const siteIds = channels.filter(c => c.integration === 'site').map(c => c.id);
  const queue = new Map((await store.list(C.queue)).map(i => [i.id, i]));
  await conflicts(promo, queue, siteIds);
  await withDeferredCatalog(async () => {
    for (const pi of promo.items || []) {
      const item = queue.get(pi.queueId);
      const onSite = siteIds.filter(id => pi.channels?.[id]);
      if (!item || !onSite.length) continue;
      const previous = item.promotion?.id === promo.id ? item.promotion.previous
        : { promoStart: item.promoStart || '', promoEnd: item.promoEnd || '', prices: Object.fromEntries((item.channels || []).map(c => [c.id, c.promoPrice ?? null])) };
      const input = {
        // Preço de promoção que sobrou de uma promoção já acabada sai (o período agora é o desta).
        channels: (item.channels || []).map(c => ({ id: c.id, price: c.price, promoPrice: onSite.includes(c.id) ? pi.channels[c.id].promoPrice : null })),
        promoStart: promo.start, promoEnd: promo.end
      };
      await repriceItem(user, item, input, { promotion: { id: promo.id, name: promo.name, start: promo.start, end: promo.end, previous } });
    }
  });
  // Marketplaces (anunciados à mão): uma tarefa por lugar onde a promoção tem produto.
  const tasks = {};
  for (const channel of channels.filter(c => c.integration !== 'site' && (promo.channels || []).includes(c.id))) {
    if ((promo.items || []).some(pi => pi.channels?.[channel.id])) tasks[channel.id] = { status: 'pending', since: new Date().toISOString() };
  }
  return tasks;
}

// Cancelou ou voltou para rascunho: sai do site e ajusta as tarefas dos marketplaces.
export async function withdrawPromotion(user, promo) {
  const store = getStore();
  const queue = await store.list(C.queue);
  await withDeferredCatalog(async () => {
    for (const item of queue.filter(i => i.promotion?.id === promo.id)) {
      const prev = item.promotion.previous || {};
      const input = {
        channels: (item.channels || []).map(c => ({ id: c.id, price: c.price, promoPrice: prev.prices?.[c.id] ?? null })),
        promoStart: prev.promoStart || '', promoEnd: prev.promoEnd || ''
      };
      // Promoção antiga que já tinha acabado não volta a valer.
      if (!input.channels.some(c => c.promoPrice != null)) Object.assign(input, { promoStart: '', promoEnd: '' });
      await repriceItem(user, item, input, { promotion: null });
    }
  });
  // Já cadastrada à mão num marketplace → agora precisa tirar de lá; se nem tinha sido, some a tarefa.
  const tasks = {};
  for (const [channelId, task] of Object.entries(promo.channelTasks || {})) {
    if (task.status === 'done') tasks[channelId] = { status: 'undo', since: new Date().toISOString() };
  }
  return tasks;
}

// "Já cadastrei na Shopee" / "Já tirei da Shopee".
export async function markChannelTask(user, id, { channel }) {
  if (!TASK_ROLES.includes(user.role)) throw forbidden();
  const store = getStore();
  const promo = await store.get(C.promotions, id);
  if (!promo) throw notFound();
  const task = promo.channelTasks?.[channel];
  if (!task || !['pending', 'undo'].includes(task.status)) throw badRequest('Esta tarefa já foi feita ou não existe. Atualize a página.');
  const tasks = { ...promo.channelTasks };
  if (task.status === 'pending') tasks[channel] = { status: 'done', at: new Date().toISOString(), by: user.name };
  else delete tasks[channel];
  const channelName = (await getChannels()).find(c => c.id === channel)?.name || channel;
  const text = task.status === 'pending' ? `Cadastrada em ${channelName}` : `Tirada de ${channelName}`;
  const saved = await store.update(C.promotions, id, {
    channelTasks: tasks,
    notes: [...(promo.notes || []), { text, at: new Date().toISOString(), by: user.name }].slice(-200),
    updatedAt: new Date().toISOString()
  });
  return { saved, text, channelName };
}
