// Campanha do site (Black Friday, Natal, Ano Novo): a parte visual — título e frase do topo, produtos em
// destaque, o aviso de oferta que aparece ao abrir o site e a contagem até o fim. Os preços NÃO mudam
// aqui: vêm das Promoções aprovadas (price/compareAt dos produtos do catálogo).
//
// Documento `settings/site-campaign` = { items: { [tema]: campanha } }, uma configuração por tema, cada
// uma com a sua janela. GET /api/catalog manda em `campaign` só a que vale AGORA (contrato em docs/SITE.md):
// - nada salvo ainda → o campo não vai (o site usa o modo automático dele);
// - salvo, mas nenhuma valendo agora → { enabled: false } (o site NÃO liga o automático).
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, clean } from '../http.js';

export const CAMPAIGN_THEMES = { 'black-friday': 'Black Friday', natal: 'Natal', 'ano-novo': 'Ano Novo' };
export const CAMPAIGN_EDITORS = ['owner', 'manager', 'marketing'];
export const MAX_HERO = 6;
const DOC = 'site-campaign';

let cache = { at: 0, doc: undefined };
async function readDoc() {
  if (cache.doc !== undefined && Date.now() - cache.at < 30_000) return cache.doc;
  const doc = await getStore().get(C.settings, DOC);
  cache = { at: Date.now(), doc: doc || null };
  return cache.doc;
}

// Horário de Brasília (sem horário de verão desde 2019): sempre guardado como "AAAA-MM-DDTHH:MM:SS-03:00".
const toBrasilia = ms => `${new Date(ms - 3 * 3600_000).toISOString().slice(0, 19)}-03:00`;
function readWhen(value, label) {
  if (value === '' || value == null) return null;
  const text = String(value).trim();
  const m = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) throw badRequest(`${label}: escolha o dia e a hora.`);
  const ms = Date.parse(m[3] ? text : `${m[1]}T${m[2]}:00-03:00`);
  if (!Number.isFinite(ms)) throw badRequest(`${label}: data inválida.`);
  return toBrasilia(ms);
}
const when = iso => (iso ? Date.parse(iso) : null);
const br = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : '');

// Sugestão para quem abre a tela pela primeira vez (tudo desligado).
export function defaultCampaigns(now = Date.now()) {
  const year = Number(toBrasilia(now).slice(0, 4));
  const at = (y, md, hm) => `${y}-${md}T${hm}:00-03:00`;
  const base = theme => ({ theme, enabled: false, title: '', subtitle: '', heroSkus: [], popup: { enabled: true, sku: '', title: '', text: '' } });
  return {
    'black-friday': { ...base('black-friday'), startsAt: null, endsAt: at(year, '11-30', '23:59') },
    natal: { ...base('natal'), startsAt: at(year, '12-01', '00:00'), endsAt: at(year, '12-25', '23:59') },
    'ano-novo': { ...base('ano-novo'), startsAt: at(year, '12-26', '00:00'), endsAt: at(year + 1, '01-01', '23:59') }
  };
}

// skus: produtos que estão no site agora (para conferir destaques e o produto do aviso).
function readCampaign(theme, raw = {}, skus) {
  const name = CAMPAIGN_THEMES[theme];
  const enabled = raw.enabled === true || raw.enabled === 'true';
  const startsAt = readWhen(raw.startsAt, `${name}: começa`);
  const endsAt = readWhen(raw.endsAt, `${name}: termina`);
  if (enabled && !endsAt) throw badRequest(`${name}: diga quando termina (o site mostra a contagem até o fim).`);
  if (startsAt && endsAt && when(endsAt) <= when(startsAt)) throw badRequest(`${name}: o fim precisa ser depois do começo.`);
  // Fim no passado não é erro: a campanha simplesmente não aparece mais (a tela mostra "já acabou").

  const rawHero = Array.isArray(raw.heroSkus) ? raw.heroSkus.map(s => String(s).trim()).filter(Boolean) : [];
  const heroSkus = [...new Set(rawHero)];
  if (heroSkus.length > MAX_HERO) throw badRequest(`${name}: escolha no máximo ${MAX_HERO} produtos em destaque.`);
  const missing = heroSkus.filter(s => !skus.has(s));
  if (missing.length) throw badRequest(`${name}: o produto de código ${missing.join(', ')} não está à venda no site. Tire dos destaques.`);

  const popupRaw = raw.popup || {};
  const popupSku = String(popupRaw.sku ?? '').trim();
  if (popupSku && !skus.has(popupSku)) throw badRequest(`${name}: o produto do aviso (código ${popupSku}) não está à venda no site.`);
  return {
    theme, enabled, startsAt, endsAt,
    title: clean.text(raw.title, { max: 40, label: `${name}: título` }),
    subtitle: clean.text(raw.subtitle, { max: 120, label: `${name}: frase do topo` }),
    heroSkus,
    popup: {
      enabled: popupRaw.enabled !== false && popupRaw.enabled !== 'false',
      sku: popupSku,
      title: clean.text(popupRaw.title, { max: 60, label: `${name}: título do aviso` }),
      text: clean.text(popupRaw.text, { max: 200, label: `${name}: texto do aviso` })
    }
  };
}

// Duas campanhas ligadas no mesmo período: o site não saberia qual mostrar.
function checkOverlap(items) {
  const on = Object.values(items).filter(c => c.enabled);
  for (let i = 0; i < on.length; i++) {
    for (let j = i + 1; j < on.length; j++) {
      const [a, b] = [on[i], on[j]];
      const aStart = when(a.startsAt) ?? -Infinity;
      const bStart = when(b.startsAt) ?? -Infinity;
      if (aStart < when(b.endsAt) && bStart < when(a.endsAt)) {
        throw badRequest(`${CAMPAIGN_THEMES[a.theme]} e ${CAMPAIGN_THEMES[b.theme]} estão ligadas ao mesmo tempo. Ajuste as datas para uma terminar antes da outra começar.`);
      }
    }
  }
}

// Produtos do site, do jeito que a tela precisa para escolher (com o desconto da promoção).
const pickable = products => products.map(p => ({
  sku: p.sku, name: p.name, price: p.price, compareAt: p.compareAt ?? null, image: p.image || '',
  discount: p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0, promoEnds: p.promoEnds || null
}));

// A que vale agora (ligada e dentro da janela), ou null.
function current(items, now) {
  return Object.values(items || {}).find(c => c.enabled && (!c.startsAt || when(c.startsAt) <= now) && c.endsAt && now < when(c.endsAt)) || null;
}

// Campo `campaign` do catálogo do site. products: os produtos que o site está mostrando.
export async function campaignForSite(products, now = Date.now()) {
  const doc = await readDoc();
  if (!doc?.items) return undefined;
  const c = current(doc.items, now);
  if (!c) return { enabled: false };
  const skus = new Set(products.map(p => p.sku));
  const out = { theme: c.theme, enabled: true, startsAt: c.startsAt, endsAt: c.endsAt };
  if (c.title) out.title = c.title;
  if (c.subtitle) out.subtitle = c.subtitle;
  const hero = c.heroSkus.filter(s => skus.has(s));
  if (hero.length) out.heroSkus = hero;
  out.popup = { enabled: c.popup.enabled };
  if (c.popup.sku && skus.has(c.popup.sku)) out.popup.sku = c.popup.sku;
  if (c.popup.title) out.popup.title = c.popup.title;
  if (c.popup.text) out.popup.text = c.popup.text;
  return out;
}

// Tela Ajustes › Campanha do site. listProducts: () => produtos do site agora.
export async function campaignScreen(user, listProducts) {
  if (!CAMPAIGN_EDITORS.includes(user.role)) throw forbidden('Só o dono, o gerente ou o marketing mexem na campanha do site.');
  const doc = await readDoc();
  const items = { ...defaultCampaigns(), ...(doc?.items || {}) };
  const products = pickable(await listProducts());
  return { items, saved: !!doc, live: current(doc?.items, Date.now())?.theme || null, products };
}

export async function updateSiteCampaigns(user, input = {}, listProducts) {
  if (!CAMPAIGN_EDITORS.includes(user.role)) throw forbidden('Só o dono, o gerente ou o marketing mexem na campanha do site.');
  const raw = input.items && typeof input.items === 'object' ? input.items : {};
  const skus = new Set((await listProducts()).map(p => p.sku));
  const before = (await readDoc())?.items || null;
  const items = {};
  for (const theme of Object.keys(CAMPAIGN_THEMES)) items[theme] = readCampaign(theme, raw[theme] || before?.[theme] || defaultCampaigns()[theme], skus);
  checkOverlap(items);
  const doc = { items, updatedAt: new Date().toISOString(), updatedBy: user.id };
  await getStore().set(C.settings, DOC, doc);
  cache = { at: Date.now(), doc };
  const on = Object.values(items).filter(c => c.enabled).map(c => `${CAMPAIGN_THEMES[c.theme]}${c.startsAt ? ` de ${br(c.startsAt)}` : ''} até ${br(c.endsAt)}`);
  await audit(user, {
    action: 'settings.site_campaign', entity: 'settings', entityId: DOC,
    summary: on.length ? `Campanha do site: ${on.join('; ')}` : 'Campanha do site: todas desligadas',
    before: before ? { items: before } : null, after: { items }
  });
  return { items, live: current(items, Date.now())?.theme || null };
}
