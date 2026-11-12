// Categorias do site, editadas em Ajustes › Categorias do site. Documento `settings/categories`
// = { items: [{ id, name, short, icon, active }] } na ordem em que aparecem no site.
// Sem documento salvo, valem as categorias que o site já tinha (DEFAULT_SITE_CATEGORIES).
//
// O `id` nunca muda depois de criado (os anúncios guardam o id): renomear muda só o nome.
// Categoria escondida (active: false) some do site junto com os produtos dela.
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, clean } from '../http.js';
import { DEFAULT_SITE_CATEGORIES, CATEGORY_ICONS } from '../../public/shared/domain.js';
import { catalogSnapshot, withDeferredCatalog, touchCatalog } from './catalog.js';

const DOC = 'categories';
export const CATEGORY_EDITORS = ['owner', 'manager'];

let cache = { at: 0, items: null };
export async function getSiteCategories() {
  if (cache.items && Date.now() - cache.at < 30_000) return cache.items;
  const doc = await getStore().get(C.settings, DOC);
  const items = Array.isArray(doc?.items) && doc.items.length ? doc.items : DEFAULT_SITE_CATEGORIES.map(c => ({ ...c, active: true }));
  cache = { at: Date.now(), items };
  return items;
}

// Ids aceitos no anúncio (escondidas também: o anúncio continua válido, só não aparece no site).
export const siteCategoryIds = async () => (await getSiteCategories()).map(c => c.id);
export const activeCategoryIds = async () => new Set((await getSiteCategories()).filter(c => c.active !== false).map(c => c.id));

const slug = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Quantos anúncios usam cada categoria (todos e os que estão no site agora).
async function usage() {
  const queue = await getStore().list(C.queue);
  const onSite = await catalogSnapshot();
  const count = {};
  for (const item of queue) {
    const id = item.content?.siteCategory;
    if (!id || item.stage === 'archived') continue;
    (count[id] ||= { total: 0, onSite: 0 }).total++;
  }
  for (const e of onSite.items) if (e.category) (count[e.category] ||= { total: 0, onSite: 0 }).onSite++;
  return { count, queue };
}

export async function listSiteCategories(user) {
  if (!CATEGORY_EDITORS.includes(user.role)) return { items: await getSiteCategories(), usage: {} };
  const { count } = await usage();
  return { items: await getSiteCategories(), usage: count };
}

// input: { items: [{ id?, name, short?, icon, active }], moves: { idApagado: idDestino } }
export async function updateSiteCategories(user, input = {}) {
  if (!CATEGORY_EDITORS.includes(user.role)) throw forbidden('Só o dono ou o gerente mudam as categorias do site.');
  const raw = Array.isArray(input.items) ? input.items : [];
  if (!raw.length) throw badRequest('Deixe pelo menos uma categoria.');
  if (raw.length > 60) throw badRequest('Dá para ter no máximo 60 categorias.');
  const before = await getSiteCategories();
  const known = new Set(before.map(c => c.id));
  const ids = new Set();
  const names = new Set();
  const items = raw.map(r => {
    const name = clean.text(r.name, { required: true, max: 40, label: 'Nome da categoria' });
    const key = name.toLowerCase();
    if (names.has(key)) throw badRequest(`A categoria "${name}" está duas vezes.`);
    names.add(key);
    // Categoria que já existia mantém o id; nova ganha um id a partir do nome.
    let id = known.has(String(r.id || '')) ? String(r.id) : slug(name);
    if (!id) throw badRequest(`"${name}": use letras ou números no nome.`);
    if (!known.has(String(r.id || ''))) { let n = 2; const base = id; while (ids.has(id) || known.has(id)) id = `${base}-${n++}`; }
    if (ids.has(id)) throw badRequest(`A categoria "${name}" está duas vezes.`);
    ids.add(id);
    return {
      id, name,
      short: clean.text(r.short, { max: 20, label: `Nome curto de ${name}` }) || name.slice(0, 20),
      icon: Object.hasOwn(CATEGORY_ICONS, r.icon) ? r.icon : 'tag',
      active: r.active !== false
    };
  });

  // Categorias apagadas: só se nenhum anúncio usa, ou se a pessoa disse para onde mover os produtos.
  const removed = before.filter(c => !ids.has(c.id));
  const moves = input.moves && typeof input.moves === 'object' ? input.moves : {};
  let moved = 0;
  if (removed.length) {
    const { count, queue } = await usage();
    for (const c of removed) {
      const used = count[c.id]?.total || 0;
      const to = moves[c.id];
      if (used && !ids.has(to)) throw badRequest(`"${c.name}" tem ${used} produto(s). Escolha para qual categoria eles vão, ou só esconda a categoria do site.`);
    }
    const store = getStore();
    await withDeferredCatalog(async () => {
      for (const item of queue) {
        const from = item.content?.siteCategory;
        const to = removed.some(c => c.id === from) ? moves[from] : null;
        if (!to) continue;
        const saved = await store.update(C.queue, item.id, { content: { ...item.content, siteCategory: to }, updatedAt: new Date().toISOString(), updatedBy: user.id });
        await touchCatalog(item, saved);
        moved++;
      }
    });
  }

  await getStore().set(C.settings, DOC, { items, updatedAt: new Date().toISOString(), updatedBy: user.id });
  // Nome e "mostrar no site" valem na hora: o catálogo do site é montado com as categorias ativas.
  cache = { at: Date.now(), items };
  await audit(user, {
    action: 'settings.categories', entity: 'settings', entityId: DOC,
    summary: `Atualizou as categorias do site${removed.length ? ` (apagou ${removed.map(c => c.name).join(', ')}${moved ? `; ${moved} produto(s) mudaram de categoria` : ''})` : ''}`,
    before: { items: before }, after: { items }
  });
  return { items, moved };
}
