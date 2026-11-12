// Frete e entrega do site próprio. As regras ficam no portal (Ajustes › Frete e entrega) e o site
// pergunta ao portal quanto custa entregar o carrinho num CEP (POST /api/store/shipping/quote).
//
// Formas de entrega, nesta ordem na resposta:
// 1. Motoboy da loja — preço por cidade, com pedido mínimo e frete grátis a partir de um valor.
// 2. Transportadoras (Correios e Jadlog) — cotadas no Melhor Envio com o peso e as medidas da caixa.
// 3. Retirar na loja — sem custo.
//
// Documento `settings/shipping`. Sem documento salvo, vale DEFAULTS (só retirada na loja ligada).
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
  motoboy: { enabled: false, areas: [] },
  carriers: { enabled: false, services: [1, 2, 3], extraDays: 1, freeFrom: null, insurance: true }
};

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

let cache = { at: 0, settings: null };
export async function getShippingSettings() {
  if (cache.settings && Date.now() - cache.at < 30_000) return cache.settings;
  const doc = await getStore().get(C.settings, DOC);
  const settings = {
    ...DEFAULTS, ...(doc || {}),
    pickup: { ...DEFAULTS.pickup, ...(doc?.pickup || {}) },
    motoboy: { ...DEFAULTS.motoboy, ...(doc?.motoboy || {}) },
    carriers: { ...DEFAULTS.carriers, ...(doc?.carriers || {}) }
  };
  cache = { at: Date.now(), settings };
  return settings;
}

export function shippingStatus() {
  return { melhorEnvio: { configured: melhorEnvioReady(), sandbox: config.melhorEnvio.sandbox, demo: config.demo && !melhorEnvioReady() } };
}

// Confere e normaliza as regras vindas da tela (sem gravar). Usada ao salvar e ao simular.
export function readShippingSettings(input = {}) {
  const originCep = digits(input.originCep);
  if (originCep && originCep.length !== 8) throw badRequest('O CEP da loja precisa ter 8 números.');

  const pickup = {
    enabled: input.pickup?.enabled !== false,
    readyHours: intIn(input.pickup?.readyHours, { min: 0, max: 168, label: 'Horas para separar a retirada', fallback: 2 })
  };

  const rawAreas = Array.isArray(input.motoboy?.areas) ? input.motoboy.areas : [];
  if (rawAreas.length > 100) throw badRequest('Dá para cadastrar no máximo 100 cidades no motoboy.');
  const seen = new Set();
  const areas = rawAreas
    .filter(a => String(a?.city ?? '').trim() || a?.price !== '' && a?.price != null)
    .map(a => {
      const city = clean.text(a.city, { required: true, max: 80, label: 'Cidade do motoboy' });
      const state = String(a.state || '').trim().toUpperCase();
      if (!BR_STATES.includes(state)) throw badRequest(`${city}: escolha o estado (UF).`);
      const key = `${norm(city)}/${state}`;
      if (seen.has(key)) throw badRequest(`${city}/${state} está duas vezes no motoboy.`);
      seen.add(key);
      return {
        city, state,
        price: clean.money(a.price, { required: true, allowZero: true, label: `Preço do motoboy em ${city}` }),
        minOrder: clean.money(a.minOrder, { label: `Pedido mínimo em ${city}` }),
        freeFrom: clean.money(a.freeFrom, { label: `Frete grátis a partir de (${city})` }),
        days: intIn(a.days, { min: 0, max: 15, label: `Prazo do motoboy em ${city} (dias)`, fallback: 0 })
      };
    });
  const motoboy = { enabled: !!input.motoboy?.enabled && areas.length > 0, areas };
  if (input.motoboy?.enabled && !areas.length) throw badRequest('Para ligar o motoboy, cadastre pelo menos uma cidade com preço.');

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
    if (data && !data.erro && data.localidade) value = { city: data.localidade, state: data.uf };
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

// lines: [{ sku, price (R$ por unidade, já com promoção), qty, weightKg (por unidade), dims|null }]
async function quoteLines(settings, { cep, city, state, lines }) {
  const subtotal = round2(lines.reduce((n, l) => n + l.price * l.qty, 0));
  const options = [];
  const notices = [];
  let carrierError = '';

  if (settings.motoboy.enabled && settings.motoboy.areas.length) {
    const where = city && state ? { city, state } : await cityOf(cep);
    const area = where && settings.motoboy.areas.find(a => norm(a.city) === norm(where.city) && a.state === String(where.state).toUpperCase());
    if (area && area.minOrder && subtotal < area.minOrder) {
      notices.push(`Entrega de motoboy em ${area.city} para compras a partir de ${money(area.minOrder)}. Faltam ${money(area.minOrder - subtotal)}.`);
    } else if (area) {
      const free = area.freeFrom != null && subtotal >= area.freeFrom;
      options.push({
        id: 'motoboy', label: 'Entrega de motoboy',
        description: free ? `Frete grátis em ${area.city}` : `Entrega da própria loja em ${area.city}`,
        price: free ? 0 : area.price, days: [area.days, area.days]
      });
      if (!free && area.freeFrom != null) notices.push(`Motoboy grátis em ${area.city} a partir de ${money(area.freeFrom)}.`);
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
