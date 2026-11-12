// Frete e entrega do site próprio. As regras ficam no portal (Ajustes › Frete e entrega) e o site
// pergunta ao portal quanto custa entregar o carrinho num CEP (POST /api/store/shipping/quote).
//
// Formas de entrega, nesta ordem na resposta:
// 1. Motoboy da loja — tabelas de preço ("zonas"): cada uma vale para uma lista de cidades e tem faixas
//    pelo valor da compra (ex.: até R$ 69,99 → R$ 7; de R$ 70 em diante → R$ 5), pedido mínimo, frete
//    grátis a partir de um valor e prazo. Cidades vêm da lista do IBGE (código + nome).
// 2. Transportadoras (Correios e Jadlog) — cotadas no Melhor Envio com o peso e as medidas da caixa.
// 3. Retirar na loja — sem custo.
//
// Documento `settings/shipping`. Sem documento salvo, vale DEFAULTS (só retirada na loja ligada).
// O formato antigo do motoboy (`areas`: uma linha por cidade com um preço só) é lido e convertido.
import { config } from '../config.js';
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, clean } from '../http.js';
import { CARRIER_SERVICES, BR_STATES, todayInSaoPaulo } from '../../public/shared/domain.js';
import { catalogSnapshot, toSiteProduct } from './catalog.js';
import { melhorEnvioReady, quoteMelhorEnvio } from '../integrations/melhor-envio.js';

const DOC = 'shipping';
export const SHIPPING_EDITORS = ['owner', 'manager'];

export const DEFAULTS = {
  originCep: '',
  pickup: { enabled: true, readyHours: 2 },
  motoboy: { enabled: false, zones: [] },
  carriers: { enabled: false, services: [1, 2, 3], extraDays: 1, freeFrom: null, insurance: true }
};
export const MAX_ZONES = 20;
export const MAX_ZONE_CITIES = 400;
export const MAX_TIERS = 10;

const digits = value => String(value ?? '').replace(/\D/g, '');
const money = n => `R$ ${Number(n).toFixed(2).replace('.', ',')}`;
const norm = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const round2 = n => Math.round(n * 100) / 100;

function intIn(value, { min, max, label, fallback }) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${label}: use um número inteiro de ${min} a ${max}.`);
  return n;
}

const blank = v => v === '' || v === null || v === undefined;

// Formato antigo (uma linha por cidade, um preço) → tabelas; cidades com as mesmas regras ficam juntas.
function legacyZones(areas = []) {
  const zones = new Map();
  for (const a of areas) {
    if (!a || blank(a.city)) continue;
    const rules = { tiers: [{ from: 0, price: a.price }], minOrder: a.minOrder ?? null, freeFrom: a.freeFrom ?? null, days: a.days ?? 0 };
    const key = JSON.stringify(rules);
    if (!zones.has(key)) zones.set(key, { cities: [], ...rules });
    zones.get(key).cities.push({ city: a.city, state: a.state });
  }
  return [...zones.values()];
}

function motoboyOf(raw = {}) {
  const zones = Array.isArray(raw.zones) ? raw.zones : legacyZones(raw.areas);
  return { enabled: !!raw.enabled && zones.length > 0, zones };
}

let cache = { at: 0, settings: null };
export async function getShippingSettings() {
  if (cache.settings && Date.now() - cache.at < 30_000) return cache.settings;
  const doc = await getStore().get(C.settings, DOC);
  const settings = {
    ...DEFAULTS, ...(doc || {}),
    pickup: { ...DEFAULTS.pickup, ...(doc?.pickup || {}) },
    motoboy: motoboyOf(doc?.motoboy),
    carriers: { ...DEFAULTS.carriers, ...(doc?.carriers || {}) }
  };
  cache = { at: Date.now(), settings };
  return settings;
}

export function shippingStatus() {
  return { melhorEnvio: { configured: melhorEnvioReady(), sandbox: config.melhorEnvio.sandbox, demo: config.demo && !melhorEnvioReady() } };
}

// Tabelas do motoboy vindas da tela. Cada uma: { cities: [{ city, state, ibge? }], tiers: [{ from, price }],
// minOrder, freeFrom, days }. A primeira faixa vale para compras de qualquer valor (from 0); as outras,
// "de R$ X em diante". Tabela totalmente vazia é ignorada. Aceita também o formato antigo (`areas`).
function readZones(motoboy = {}) {
  const raw = Array.isArray(motoboy?.zones) ? motoboy.zones : legacyZones(Array.isArray(motoboy?.areas) ? motoboy.areas : []);
  if (raw.length > MAX_ZONES) throw badRequest(`Dá para ter no máximo ${MAX_ZONES} tabelas de preço no motoboy.`);
  const where = new Map(); // cidade → número da tabela, para não repetir cidade em duas tabelas
  const zones = [];
  let total = 0;
  raw.forEach((z, k) => {
    const suffix = raw.length > 1 ? ` (tabela ${k + 1})` : '';
    const label = `Motoboy${suffix}`;
    const rawCities = Array.isArray(z?.cities) ? z.cities : [];
    // A primeira faixa é o preço normal (qualquer valor de compra); as outras só contam se preenchidas.
    const allTiers = Array.isArray(z?.tiers) ? z.tiers : [];
    const base = allTiers[0] || {};
    const extras = allTiers.slice(1).filter(t => !(blank(t?.price) && blank(t?.from)));
    if (!rawCities.length && blank(base.price) && !extras.length) return;
    if (!rawCities.length) throw badRequest(`${label}: escolha pelo menos uma cidade.`);
    if (extras.length + 1 > MAX_TIERS) throw badRequest(`${label}: no máximo ${MAX_TIERS} faixas de valor.`);
    const rawTiers = [base, ...extras];

    const cities = [];
    for (const c of rawCities) {
      const city = clean.text(c?.city, { required: true, max: 80, label: 'Cidade do motoboy' });
      const state = String(c?.state || '').trim().toUpperCase();
      if (!BR_STATES.includes(state)) throw badRequest(`${city}: escolha o estado (UF).`);
      const key = `${norm(city)}/${state}`;
      if (where.get(key) === k) continue; // repetida na mesma tabela: fica uma
      if (where.has(key)) throw badRequest(`${city}/${state} está em duas tabelas do motoboy. Deixe em uma só.`);
      where.set(key, k);
      const ibge = /^\d{7}$/.test(String(c?.ibge ?? '')) ? String(c.ibge) : null;
      cities.push(ibge ? { city, state, ibge } : { city, state });
    }
    total += cities.length;
    if (total > MAX_ZONE_CITIES) throw badRequest(`Dá para ter no máximo ${MAX_ZONE_CITIES} cidades no motoboy.`);

    const tiers = rawTiers.map((t, i) => ({
      from: i === 0 ? 0 : clean.money(t.from, { required: true, label: `O valor "compras a partir de" do motoboy${suffix}` }),
      price: clean.money(t.price, { required: true, allowZero: true, label: `O preço do frete do motoboy${suffix}` })
    }));
    if (tiers.slice(1).some(t => !(t.from > 0))) throw badRequest(`${label}: o "compras de R$ … ou mais" precisa ser maior que zero.`);
    tiers.sort((a, b) => a.from - b.from);
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].from === tiers[i - 1].from) throw badRequest(`${label}: há dois preços para compras de ${money(tiers[i].from)} ou mais. Deixe um só.`);
    }
    zones.push({
      cities, tiers,
      minOrder: clean.money(z.minOrder, { label: `O pedido mínimo do motoboy${suffix}` }),
      freeFrom: clean.money(z.freeFrom, { label: `O "grátis a partir de" do motoboy${suffix}` }),
      days: intIn(z.days, { min: 0, max: 15, label: `Prazo do motoboy${suffix} (dias)`, fallback: 0 })
    });
  });
  return zones;
}

// Confere e normaliza as regras vindas da tela (sem gravar). Usada ao salvar e ao simular.
export function readShippingSettings(input = {}) {
  const originCep = digits(input.originCep);
  if (originCep && originCep.length !== 8) throw badRequest('O CEP da loja precisa ter 8 números.');

  const pickup = {
    enabled: input.pickup?.enabled !== false,
    readyHours: intIn(input.pickup?.readyHours, { min: 0, max: 168, label: 'Horas para separar a retirada', fallback: 2 })
  };

  const zones = readZones(input.motoboy);
  const motoboy = { enabled: !!input.motoboy?.enabled && zones.length > 0, zones };
  if (input.motoboy?.enabled && !zones.length) throw badRequest('Para ligar o motoboy, escolha pelo menos uma cidade e o preço do frete.');

  const services = (Array.isArray(input.carriers?.services) ? input.carriers.services : [])
    .map(Number).filter(id => Object.hasOwn(CARRIER_SERVICES, id));
  const carriers = {
    enabled: !!input.carriers?.enabled,
    services: [...new Set(services)],
    extraDays: intIn(input.carriers?.extraDays, { min: 0, max: 15, label: 'Dias para separar e postar', fallback: 1 }),
    freeFrom: clean.money(input.carriers?.freeFrom, { label: 'Frete grátis (transportadora) a partir de' }),
    insurance: input.carriers?.insurance !== false
  };
  if (carriers.enabled && !carriers.services.length) throw badRequest('Marque pelo menos um serviço dos Correios ou da Jadlog.');
  if (carriers.enabled && !originCep) throw badRequest('Para cotar Correios e Jadlog, preencha o CEP de onde a mercadoria sai.');
  return { originCep, pickup, motoboy, carriers };
}

export async function updateShippingSettings(user, input = {}) {
  if (!SHIPPING_EDITORS.includes(user.role)) throw forbidden('Só o dono ou o gerente mudam o frete.');
  const before = await getShippingSettings();
  const settings = { ...readShippingSettings(input), updatedAt: new Date().toISOString(), updatedBy: user.id };
  await getStore().set(C.settings, DOC, settings);
  cache = { at: Date.now(), settings };
  quoteCache.clear();
  await audit(user, { action: 'settings.shipping', entity: 'settings', entityId: DOC, summary: 'Atualizou frete e entrega', before, after: settings });
  return settings;
}

// ---------------------------------------------------------------------------
// Cotação
// ---------------------------------------------------------------------------

// Caixa padrão quando o anúncio não tem as medidas da embalagem (cm), pelo peso total da linha.
// Nunca menor que o mínimo dos Correios (2 × 11 × 16 cm).
export function defaultBox(kg) {
  if (kg <= 0.3) return { heightCm: 4, widthCm: 12, lengthCm: 16 };
  if (kg <= 1) return { heightCm: 10, widthCm: 15, lengthCm: 20 };
  if (kg <= 3) return { heightCm: 15, widthCm: 20, lengthCm: 30 };
  if (kg <= 8) return { heightCm: 20, widthCm: 30, lengthCm: 40 };
  if (kg <= 16) return { heightCm: 15, widthCm: 40, lengthCm: 60 };
  return { heightCm: 20, widthCm: 45, lengthCm: 70 };
}
const atLeast = (value, min) => Math.max(min, Math.ceil(Number(value) || 0));

// Peso de uma unidade vendida no site: a medida quando é em kg; senão o "peso para frete".
const unitWeight = e => (e.measure?.unit === 'kg' ? Number(e.measure.value) || 0.2 : Number(e.weightKg) || 0.2);

// Cidade do CEP (ViaCEP, grátis). Guardada em memória por um dia.
const cityCache = new Map();
async function cityOf(cep) {
  const hit = cityCache.get(cep);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.value;
  let value = null;
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(5000) });
    const data = response.ok ? await response.json() : null;
    if (data && !data.erro && data.localidade) value = { city: data.localidade, state: data.uf, ...(/^\d{7}$/.test(String(data.ibge ?? '')) ? { ibge: String(data.ibge) } : {}) };
  } catch { /* sem cidade: o motoboy não aparece, o resto segue */ }
  if (value) {
    if (cityCache.size > 2000) cityCache.clear();
    cityCache.set(cep, { at: Date.now(), value });
  }
  return value;
}

// Mesma pergunta repetida (estimativa na página do produto, checkout, conferência do pedido):
// responde da memória por 10 minutos — o preço não muda no meio da compra e o Melhor Envio é poupado.
const quoteCache = new Map();
const QUOTE_TTL = 600_000;

// Transportadoras do Melhor Envio (ou, na demonstração sem token, preços de exemplo).
async function carrierOptions(settings, cep, lines) {
  const products = lines.map(l => {
    const box = l.dims || defaultBox(l.weightKg * l.qty);
    return {
      id: l.sku,
      height: atLeast(box.heightCm, 2), width: atLeast(box.widthCm, 11), length: atLeast(box.lengthCm, 16),
      weight: Math.max(0.01, round2(l.weightKg)),
      insurance_value: settings.carriers.insurance ? round2(l.price) : 0,
      quantity: l.qty
    };
  });
  if (!melhorEnvioReady() && config.demo) {
    const kg = lines.reduce((n, l) => n + l.weightKg * l.qty, 0);
    const near = cep.startsWith('3');
    const fake = { 1: [18.9, 0.9, near ? [3, 6] : [6, 10]], 2: [29.9, 1.6, near ? [1, 2] : [2, 4]], 17: [12.9, 0.7, [5, 9]], 3: [16.9, 0.8, near ? [3, 5] : [5, 8]], 4: [24.9, 1.2, [2, 4]] };
    return settings.carriers.services.filter(id => fake[id] && !(id === 17 && kg > 0.3))
      .map(id => ({ id, label: `${CARRIER_SERVICES[id]} (exemplo)`, price: round2(fake[id][0] + kg * fake[id][1]), days: fake[id][2] }));
  }
  const quotes = await quoteMelhorEnvio({ from: settings.originCep, to: cep, products, services: settings.carriers.services });
  return quotes.map(q => ({ id: q.id, label: [q.company, q.name].filter(Boolean).join(' ') || CARRIER_SERVICES[q.id] || 'Transportadora', price: round2(q.price), days: q.days }));
}

// Tabela do motoboy que atende a cidade. Pelo código do IBGE quando os dois lados têm; senão pelo nome.
export function zoneFor(zones, where) {
  if (!where?.city && !where?.ibge) return null;
  const state = String(where.state || '').toUpperCase();
  for (const zone of zones) {
    const city = zone.cities.find(c => (c.ibge && where.ibge ? c.ibge === String(where.ibge) : norm(c.city) === norm(where.city) && c.state === state));
    if (city) return { zone, city: city.city };
  }
  return null;
}

// Preço pela faixa do valor da compra; zero a partir do "grátis a partir de".
export function motoboyPrice(zone, subtotal) {
  if (zone.freeFrom != null && subtotal >= zone.freeFrom) return 0;
  return [...zone.tiers].reverse().find(t => subtotal >= t.from)?.price ?? zone.tiers[0].price;
}

// lines: [{ sku, price (R$ por unidade, já com promoção), qty, weightKg (por unidade), dims|null }]
async function quoteLines(settings, { cep, city, state, ibge, lines }) {
  const subtotal = round2(lines.reduce((n, l) => n + l.price * l.qty, 0));
  const options = [];
  const notices = [];
  let carrierError = '';

  if (settings.motoboy.enabled && settings.motoboy.zones.length) {
    const where = city && state ? { city, state, ibge } : await cityOf(cep);
    const hit = zoneFor(settings.motoboy.zones, where);
    if (hit) {
      const { zone, city: name } = hit;
      if (zone.minOrder && subtotal < zone.minOrder) {
        notices.push(`Entrega de motoboy em ${name} para compras a partir de ${money(zone.minOrder)}. Faltam ${money(zone.minOrder - subtotal)}.`);
      } else {
        const price = motoboyPrice(zone, subtotal);
        options.push({
          id: 'motoboy', label: 'Entrega de motoboy',
          description: price === 0 ? `Frete grátis em ${name}` : `Entrega da própria loja em ${name}`,
          price, days: [zone.days, zone.days]
        });
        // Quanto falta para pagar menos (próxima faixa mais barata) ou não pagar nada.
        if (price > 0) {
          const cheaper = zone.tiers.find(t => t.from > subtotal && t.price < price && t.price > 0 && !(zone.freeFrom != null && t.from >= zone.freeFrom));
          if (cheaper) notices.push(`Motoboy por ${money(cheaper.price)} em compras a partir de ${money(cheaper.from)}.`);
          const free = zone.freeFrom ?? zone.tiers.find(t => t.from > subtotal && t.price === 0)?.from;
          if (free != null) notices.push(`Motoboy grátis em ${name} a partir de ${money(free)}.`);
        }
      }
    }
  }

  if (settings.carriers.enabled && settings.originCep && (melhorEnvioReady() || config.demo)) {
    try {
      const extra = settings.carriers.extraDays;
      const carriers = (await carrierOptions(settings, cep, lines))
        .map(c => ({ id: `me-${c.id}`, label: c.label, description: 'Entrega pela transportadora, com rastreio', price: c.price, days: c.days ? [c.days[0] + extra, c.days[1] + extra] : null }))
        .sort((a, b) => a.price - b.price);
      const freeFrom = settings.carriers.freeFrom;
      if (carriers.length && freeFrom != null) {
        if (subtotal >= freeFrom) Object.assign(carriers[0], { price: 0, description: 'Frete grátis, com rastreio' });
        else notices.push(`Frete grátis pela transportadora a partir de ${money(freeFrom)}.`);
      }
      options.push(...carriers);
    } catch (error) {
      carrierError = error.message;
      console.warn('[frete] cotação do Melhor Envio falhou:', error.message);
    }
  }

  if (settings.pickup.enabled) {
    const hours = settings.pickup.readyHours;
    options.push({ id: 'retirada', label: 'Retirar na loja', description: hours ? `Separado em até ${hours} horas, sem custo` : 'Sem custo', price: 0, days: null });
  }
  return { options, notices, subtotal, carrierError };
}

// Pergunta do site: carrinho (sku + quantidade) e CEP. Preço e peso vêm do catálogo do portal — o
// site não consegue mudar o frete mandando outro valor. `city`/`state` são opcionais (o site já sabe
// pelo endereço); sem eles, o portal descobre pelo CEP.
export async function quoteForSite(input = {}) {
  const cep = digits(input.cep);
  if (cep.length !== 8) throw badRequest('CEP inválido.');
  const rawItems = Array.isArray(input.items) ? input.items.slice(0, 100) : [];
  if (!rawItems.length) throw badRequest('Mande os itens do carrinho.');
  const city = clean.text(input.city, { max: 80 });
  const state = clean.text(input.state, { max: 2 });
  const settings = await getShippingSettings();
  // Regras salvas de novo (em qualquer instância) mudam a chave: nada de preço velho na memória.
  const key = JSON.stringify([settings.updatedAt || '', cep, norm(city), state.toUpperCase(), rawItems.map(i => [String(i.sku), Number(i.qty)]).sort()]);
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL) return hit.value;

  const snapshot = await catalogSnapshot();
  const today = todayInSaoPaulo();
  const bySku = new Map(snapshot.items.map(e => [String(e.sku), e]));
  const lines = [];
  for (const raw of rawItems) {
    const e = bySku.get(String(raw.sku));
    const qty = Math.floor(Number(raw.qty));
    if (!e || !Number.isInteger(qty) || qty < 1 || qty > 999) continue;
    lines.push({ sku: e.sku, price: toSiteProduct(e, today).price, qty, weightKg: unitWeight(e), dims: e.dims || null });
  }
  if (!lines.length) throw badRequest('Nenhum produto do carrinho está à venda no site.');
  const { options, notices, subtotal } = await quoteLines(settings, { cep, city, state, lines });
  const value = { options, notices, subtotal };
  if (quoteCache.size > 500) quoteCache.clear();
  quoteCache.set(key, { at: Date.now(), value });
  return value;
}

// "Simular frete" na tela de Ajustes: um pacote de exemplo (valor e peso), sem carrinho, com as regras
// que estão na tela (`input.settings`, ainda sem salvar) ou, sem elas, as salvas.
export async function simulateShipping(user, input = {}) {
  if (!SHIPPING_EDITORS.includes(user.role)) throw forbidden();
  const cep = digits(input.cep);
  if (cep.length !== 8) throw badRequest('Digite um CEP com 8 números.');
  const subtotal = clean.money(input.subtotal, { required: true, label: 'Valor da compra' });
  const weightKg = Number(input.weightKg);
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 100) throw badRequest('Peso: use um número entre 0,01 e 100 kg.');
  const settings = input.settings ? readShippingSettings(input.settings) : await getShippingSettings();
  const where = await cityOf(cep);
  const result = await quoteLines(settings, { cep, ...(where || {}), lines: [{ sku: 'simulacao', price: subtotal, qty: 1, weightKg, dims: null }] });
  return { ...result, city: where?.city || '', state: where?.state || '', ...shippingStatus() };
}

// ---------------------------------------------------------------------------
// Cidades (para escolher na tela, sem digitar o nome certinho)
// ---------------------------------------------------------------------------

// Cidades do estado, da lista oficial do IBGE (grátis). `near` = região geográfica imediata do IBGE:
// cidades com o mesmo número ficam perto umas das outras (usado em "cidades perto de…").
// Guardada em memória por uma semana. Sem internet: lista vazia e a pessoa digita.
const citiesCache = new Map();
export async function citiesOf(user, uf) {
  if (!SHIPPING_EDITORS.includes(user.role)) throw forbidden();
  const state = String(uf || '').trim().toUpperCase();
  if (!BR_STATES.includes(state)) throw badRequest('Escolha o estado (UF).');
  const hit = citiesCache.get(state);
  if (hit && Date.now() - hit.at < 7 * 86_400_000) return { state, items: hit.items };
  try {
    const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`IBGE respondeu ${response.status}`);
    const items = (await response.json())
      .map(c => ({ ibge: String(c.id), city: c.nome, near: String(c['regiao-imediata']?.id ?? c.microrregiao?.id ?? '') }))
      .sort((a, b) => a.city.localeCompare(b.city, 'pt-BR'));
    citiesCache.set(state, { at: Date.now(), items });
    return { state, items };
  } catch (error) {
    console.warn('[frete] lista de cidades do IBGE falhou:', error.message);
    return { state, items: [], offline: true };
  }
}

// Cidade de um CEP (para a tela: o CEP da loja já diz qual é a cidade do motoboy).
export async function placeOf(user, cep) {
  if (!SHIPPING_EDITORS.includes(user.role)) throw forbidden();
  const digitsOnly = digits(cep);
  if (digitsOnly.length !== 8) throw badRequest('Digite um CEP com 8 números.');
  return { place: await cityOf(digitsOnly) };
}

// O que a tela de Ajustes recebe: as regras, a situação do Melhor Envio e a cidade da loja (pelo CEP).
export async function shippingScreen() {
  const settings = await getShippingSettings();
  const storeCity = settings.originCep ? await cityOf(settings.originCep) : null;
  return { settings, storeCity, ...shippingStatus() };
}
