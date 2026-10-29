// Catálogo do site guardado num documento único (`settings/catalog`).
//
// Por quê: na nuvem, cada visita do site que lesse a fila e os produtos gastaria centenas de leituras
// do Firestore. Assim, uma consulta ao catálogo custa UMA leitura (e ainda fica em cache por 30 s no
// servidor e na CDN da Vercel). O documento é refeito quando algo do site muda: publicar/tirar do site,
// preço, conteúdo, bloqueio/arquivo e estoque de produto publicado (sincronização do UniPlus).
//
// Limite: um documento do Firestore tem até 1 MB (~600 produtos com descrição). Acima disso, dividir
// em páginas (ver docs/ROADMAP.md).
import { config } from '../config.js';
import { getStore, C } from '../store/index.js';
import { currentPrice } from '../../public/shared/domain.js';

const DOC = 'catalog';
const TTL = 30_000;
let cache = { at: 0, snapshot: null };

export function siteProductUrl(slug) {
  if (!config.store.publicUrl) return '';
  return config.store.publicUrl + config.store.productPath.replace('{slug}', encodeURIComponent(slug));
}

// Foto enviada para a nuvem já tem URL pública; foto em media/ é servida pelo portal.
export const imageUrl = ref => (/^https:\/\//.test(ref) ? ref : `${config.store.portalPublicUrl || ''}/api/store/images/${ref.split('/').map(encodeURIComponent).join('/')}`);

const isOnSite = item => item?.listings?.site?.status === 'done' && !['blocked', 'archived'].includes(item.stage) && !!item.slug;

// Entrada guardada no documento (sem decidir promoção: isso depende da data da consulta).
function entry(item, product) {
  const site = item.channels.find(c => c.id === 'site') || {};
  const c = item.content || {};
  return {
    id: item.id,
    productId: item.productId,
    sku: item.productSnapshot.sku,
    slug: item.slug,
    name: c.title || item.productSnapshot.name,
    brand: c.brand || '',
    category: c.siteCategory || '',
    pet: c.pet || 'ambos',
    measure: { value: c.measureValue || 1, unit: c.measureUnit || 'un' },
    weightKg: c.weightKg || null,
    tag: c.tag || '',
    short: c.short || '',
    description: c.description || '',
    specs: c.specs || [],
    imageRefs: c.imageRefs || [],
    seoTitle: c.seoTitle || '',
    seoDescription: c.seoDescription || '',
    price: site.price ?? 0,
    promoPrice: site.promoPrice ?? null,
    promoStart: item.promoStart || '',
    promoEnd: item.promoEnd || '',
    stock: product && !product.missingFromUniplus ? Math.max(0, Math.floor(product.stock || 0)) : 0,
    updatedAt: item.updatedAt
  };
}

export async function rebuildCatalog() {
  const store = getStore();
  const published = (await store.list(C.queue)).filter(isOnSite);
  const products = await Promise.all(published.map(i => store.get(C.products, i.productId)));
  const snapshot = { generatedAt: new Date().toISOString(), items: published.map((item, k) => entry(item, products[k])) };
  const size = JSON.stringify(snapshot).length;
  if (size > 900_000) console.warn(`[catálogo] documento com ${Math.round(size / 1024)} KB — perto do limite de 1 MB do Firestore.`);
  await store.set(C.settings, DOC, snapshot);
  cache = { at: Date.now(), snapshot };
  return snapshot;
}

export async function catalogSnapshot() {
  if (cache.snapshot && Date.now() - cache.at < TTL) return cache.snapshot;
  const doc = await getStore().get(C.settings, DOC);
  const snapshot = doc?.items ? doc : await rebuildCatalog();
  cache = { at: Date.now(), snapshot };
  return snapshot;
}

// Chamado depois de mudar itens da fila: refaz o catálogo só se algum deles está (ou estava) no site.
export async function touchCatalog(...items) {
  if (items.some(i => i?.listings?.site?.status === 'done')) await rebuildCatalog();
}

// Depois da sincronização do UniPlus: refaz só se mudou estoque/preço de produto que está no site.
export async function touchCatalogProducts(productIds) {
  if (!productIds.length) return;
  const snapshot = await catalogSnapshot();
  const onSite = new Set(snapshot.items.map(i => i.productId));
  if (productIds.some(id => onSite.has(id))) await rebuildCatalog();
}

// Produto no formato `Product` do site (src/data/products.ts do projeto do site).
export function toSiteProduct(e, today) {
  const price = currentPrice({ price: e.price, promoPrice: e.promoPrice }, e.promoStart, e.promoEnd, today);
  const promoOn = price.promoPrice !== null;
  const images = e.imageRefs.map(imageUrl);
  const out = {
    id: e.id, sku: e.sku, slug: e.slug, name: e.name, brand: e.brand, category: e.category, pet: e.pet,
    // Na promoção, o site cobra `price` e mostra `compareAt` riscado.
    price: promoOn ? price.promoPrice : price.price,
    measure: e.measure, image: images[0] || '', stock: e.stock, short: e.short, description: e.description, specs: e.specs
  };
  if (promoOn) out.compareAt = price.price;
  if (e.weightKg) out.weightKg = e.weightKg;
  const tag = e.tag || (promoOn ? 'Oferta' : '');
  if (tag) out.tag = tag;
  // Extras que o site pode usar (o tipo do site ignora o que não conhece).
  out.images = images;
  out.promoEnds = price.promoEnds;
  out.seo = { title: e.seoTitle || e.name, description: e.seoDescription || e.short };
  out.url = siteProductUrl(e.slug);
  out.updatedAt = e.updatedAt;
  return out;
}
