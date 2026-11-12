// Frete e entrega do site: retirada na loja, motoboy e Correios/Jadlog pelo Melhor Envio.
// "Simular" testa um CEP com o que está na tela, sem salvar.
//
// Motoboy: uma ou mais tabelas de preço. Cada tabela vale para uma lista de cidades (escolhidas na
// lista do IBGE, com atalho para as cidades perto) e cobra pelo valor da compra: preço normal, preços
// menores para compras maiores e grátis a partir de um valor. Enquanto a pessoa mexe, a tela (DOM) é
// a fonte da verdade; `readForm` lê tudo na hora de salvar ou simular.
import { get, post, api } from '../api.js';
import { esc, icon, money, pageHead, button, toast, notice } from '../ui.js';
import { CARRIER_SERVICES, BR_STATES } from '../../shared/domain.js';

const EDITORS = ['owner', 'manager'];
const DAYS = [[0, 'No mesmo dia'], [1, 'No dia seguinte'], [2, 'Em 2 dias'], [3, 'Em 3 dias'], [5, 'Em 5 dias']];
const value = v => (v === null || v === undefined ? '' : v);
const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const digits = v => String(v ?? '').replace(/\D/g, '');

// ---------------------------------------------------------------------------
// Lista de cidades por estado (IBGE, pelo portal). Guardada enquanto a página estiver aberta.
// ---------------------------------------------------------------------------
const cityLists = new Map(); // UF → Promise<{ items, offline, byIbge, byName }>
const readyLists = new Map(); // UF → lista já carregada (para desenhar sem esperar)
function loadCities(uf) {
  if (!BR_STATES.includes(uf)) return Promise.resolve({ items: [], offline: true, byIbge: new Map(), byName: new Map() });
  if (!cityLists.has(uf)) {
    const job = get(`/shipping/cities?uf=${uf}`).then(r => {
      const list = { items: r.items, offline: !!r.offline, byIbge: new Map(r.items.map(c => [c.ibge, c])), byName: new Map(r.items.map(c => [norm(c.city), c])) };
      if (!list.offline) readyLists.set(uf, list);
      else cityLists.delete(uf); // sem internet agora: tenta de novo da próxima vez
      return list;
    }).catch(error => { cityLists.delete(uf); throw error; });
    cityLists.set(uf, job);
  }
  return cityLists.get(uf);
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------
function cityChip(c) {
  return `<li class="ship-chip" data-city data-name="${esc(c.city)}" data-state="${esc(c.state)}" data-ibge="${esc(c.ibge || '')}">
    <span>${esc(c.city)} <small>${esc(c.state)}</small></span>
    <button type="button" class="ship-chip-x" data-action="city-remove" aria-label="Tirar ${esc(c.city)}" title="Tirar ${esc(c.city)}">${icon('close')}</button>
  </li>`;
}

function tierRow(t = {}, k = Date.now()) {
  const id = `tier-${k}`;
  return `<li class="ship-tier" data-tier>
    <label for="${id}-from">Compras de R$</label>
    <input id="${id}-from" data-t="from" data-input="zone-rule" type="number" min="0.01" step="0.01" inputmode="decimal" value="${esc(value(t.from))}" placeholder="70,00" aria-label="Compras a partir de (R$)">
    <label for="${id}-price">ou mais pagam R$</label>
    <input id="${id}-price" data-t="price" data-input="zone-rule" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(t.price))}" placeholder="5,00" aria-label="Preço do frete nessa faixa (R$)">
    <button type="button" class="btn-icon" data-action="tier-remove" aria-label="Tirar esta faixa" title="Tirar esta faixa">${icon('trash')}</button>
  </li>`;
}

function zoneHtml(z, k, { many, defaultUf, key = k }) {
  const id = `zone-${key}`;
  const uf = z.cities?.[0]?.state || defaultUf;
  const days = DAYS.some(([d]) => d === Number(z.days ?? 0)) ? DAYS : [...DAYS, [Number(z.days), `Em ${z.days} dias`]];
  const base = z.tiers?.[0] || {};
  const list = readyLists.get(uf);
  return `<li class="ship-zone" data-zone>
    <div class="ship-zone-head">
      <h3 data-zone-title>${many ? `Tabela de preço ${k + 1}` : 'Cidades e preço'}</h3>
      ${many ? button('Tirar esta tabela', { action: 'zone-remove', icon: 'trash', variant: 'ghost small danger-text' }) : ''}
    </div>

    <fieldset class="ship-block">
      <legend>Cidades atendidas</legend>
      <ul class="ship-chips" data-city-list>${(z.cities || []).map(cityChip).join('')}</ul>
      <p class="hint" data-no-city${z.cities?.length ? ' hidden' : ''}>Nenhuma cidade ainda. Escolha abaixo.</p>
      <div class="ship-city-add">
        <div class="field ship-uf"><label for="${id}-uf">Estado</label>
          <select id="${id}-uf" data-k="uf" data-change="zone-uf">${BR_STATES.map(s => `<option value="${s}"${s === uf ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field ship-city"><label for="${id}-city">Cidade</label>
          <input id="${id}-city" data-k="new-city" data-input="city-type" data-change="city-pick" list="${id}-list" autocomplete="off" placeholder="Digite e escolha na lista">
          <datalist id="${id}-list" data-city-options>${list ? list.items.map(c => `<option value="${esc(c.city)}"></option>`).join('') : ''}</datalist></div>
        <div class="ship-city-go">${button('Adicionar', { action: 'city-add', icon: 'plus', variant: 'secondary small' })}</div>
      </div>
      <div class="ship-near" data-near></div>
    </fieldset>

    <fieldset class="ship-block">
      <legend>Quanto o cliente paga</legend>
      <div class="form-grid ship-zone-rules">
        <div class="field"><label for="${id}-price">Preço do frete (R$)</label>
          <input id="${id}-price" data-k="price" data-input="zone-rule" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(base.price))}" placeholder="7,00"></div>
        <div class="field"><label for="${id}-free">Grátis a partir de (R$)</label>
          <input id="${id}-free" data-k="freeFrom" data-input="zone-rule" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(z.freeFrom))}" placeholder="nunca grátis"></div>
        <div class="field"><label for="${id}-min">Pedido mínimo (R$)</label>
          <input id="${id}-min" data-k="minOrder" data-input="zone-rule" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(z.minOrder))}" placeholder="sem mínimo"></div>
        <div class="field"><label for="${id}-days">Prazo</label>
          <select id="${id}-days" data-k="days">${days.map(([d, l]) => `<option value="${d}"${d === Number(z.days ?? 0) ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <p class="ship-sub">Frete mais barato para compras maiores</p>
      <ul class="ship-tiers" data-tiers>${(z.tiers || []).slice(1).map((t, i) => tierRow(t, `${k}-${i}`)).join('')}</ul>
      ${button('Preço menor para compras maiores', { action: 'tier-add', icon: 'plus', variant: 'ghost small' })}
      <p class="ship-summary" data-summary aria-live="polite">${esc(summaryText(z))}</p>
    </fieldset>
  </li>`;
}

// "No site: compras até R$ 69,99 pagam R$ 7,00 · R$ 70,00 ou mais, R$ 5,00 · R$ 150,00 ou mais, grátis."
function summaryText(z) {
  const base = Number(z.tiers?.[0]?.price);
  if (z.tiers?.[0]?.price === '' || z.tiers?.[0]?.price == null || !Number.isFinite(base)) return 'Coloque o preço do frete para ver como fica no site.';
  const free = z.freeFrom === '' || z.freeFrom == null ? null : Number(z.freeFrom);
  const steps = (z.tiers || []).slice(1)
    .filter(t => t.from !== '' && t.from != null && t.price !== '' && t.price != null)
    .map(t => ({ from: Number(t.from), price: Number(t.price) }))
    .filter(t => t.from > 0 && (free == null || t.from < free))
    .sort((a, b) => a.from - b.from);
  const brl = n => money(n).replace(/ /g, ' ');
  const below = (steps[0]?.from ?? free);
  const parts = [`${below != null ? `compras até ${brl(below - 0.01)}` : 'qualquer compra'} ${base === 0 ? 'não pagam frete' : `pagam ${brl(base)}`}`];
  steps.forEach(t => parts.push(`${brl(t.from)} ou mais, ${t.price === 0 ? 'grátis' : brl(t.price)}`));
  if (free != null) parts.push(`${brl(free)} ou mais, grátis`);
  const min = z.minOrder === '' || z.minOrder == null ? null : Number(z.minOrder);
  return `No site: ${parts.join(' · ')}.${min ? ` Abaixo de ${brl(min)} o motoboy não aparece.` : ''}`;
}

function meStatus(me) {
  if (me.configured) return notice(me.sandbox ? 'Melhor Envio conectado no modo de teste (sandbox): os preços não são os de verdade.' : 'Melhor Envio conectado. Os preços são os da conta da loja.', me.sandbox ? 'warn' : 'ok');
  if (me.demo) return notice('Demonstração: os preços dos Correios e da Jadlog aqui são de exemplo.', 'info');
  return notice('O Melhor Envio ainda não está conectado. Crie a conta da loja em melhorenvio.com.br, gere um token (Integrações › Permissões de acesso) e coloque na Vercel: MELHOR_ENVIO_TOKEN e MELHOR_ENVIO_CONTACT (o e-mail da loja). Enquanto isso, o site mostra só motoboy e retirada.', 'warn');
}

// ---------------------------------------------------------------------------
// Leitura da tela
// ---------------------------------------------------------------------------
function readZone(z) {
  const k = name => z.querySelector(`[data-k="${name}"]`).value.trim();
  return {
    cities: [...z.querySelectorAll('[data-city]')].map(c => ({ city: c.dataset.name, state: c.dataset.state, ...(c.dataset.ibge ? { ibge: c.dataset.ibge } : {}) })),
    tiers: [{ from: 0, price: k('price') }, ...[...z.querySelectorAll('[data-tier]')].map(t => ({ from: t.querySelector('[data-t=from]').value.trim(), price: t.querySelector('[data-t=price]').value.trim() }))],
    freeFrom: k('freeFrom'), minOrder: k('minOrder'), days: k('days')
  };
}

function readForm() {
  const form = document.getElementById('shippingForm');
  const val = name => form.querySelector(`[name="${name}"]`);
  return {
    originCep: val('originCep').value,
    pickup: { enabled: val('pickupEnabled').checked, readyHours: val('readyHours').value },
    motoboy: { enabled: val('motoboyEnabled').checked, zones: [...form.querySelectorAll('[data-zone]')].map(readZone) },
    carriers: {
      enabled: val('carriersEnabled').checked,
      services: [...form.querySelectorAll('[name="service"]:checked')].map(el => Number(el.value)),
      extraDays: val('extraDays').value,
      freeFrom: val('carriersFreeFrom').value,
      insurance: val('insurance').checked
    }
  };
}

// ---------------------------------------------------------------------------
// Ajudantes da tela (cidades, cidades perto, resumo)
// ---------------------------------------------------------------------------
const zoneOf = el => el.closest('[data-zone]');
const allCityKeys = () => new Map([...document.querySelectorAll('[data-zone]')].flatMap((z, k) =>
  [...z.querySelectorAll('[data-city]')].map(c => [`${norm(c.dataset.name)}/${c.dataset.state}`, k])));

function updateSummary(zone) {
  zone.querySelector('[data-summary]').textContent = summaryText(readZone(zone));
}

function renumberZones() {
  const zones = [...document.querySelectorAll('[data-zone]')];
  zones.forEach((z, k) => {
    z.querySelector('[data-zone-title]').textContent = zones.length > 1 ? `Tabela de preço ${k + 1}` : 'Cidades e preço';
    const remove = z.querySelector('[data-action="zone-remove"]');
    if (zones.length > 1 && !remove) z.querySelector('.ship-zone-head').insertAdjacentHTML('beforeend', button('Tirar esta tabela', { action: 'zone-remove', icon: 'trash', variant: 'ghost small danger-text' }));
    if (zones.length === 1 && remove) remove.remove();
  });
}

async function fillCityOptions(zone) {
  const uf = zone.querySelector('[data-k="uf"]').value;
  const list = await loadCities(uf).catch(() => null);
  const box = zone.querySelector('[data-city-options]');
  if (!box || zone.querySelector('[data-k="uf"]').value !== uf) return list;
  box.innerHTML = list ? list.items.map(c => `<option value="${esc(c.city)}"></option>`).join('') : '';
  return list;
}

// "Cidades perto de Manhuaçu": as da mesma região do IBGE que ainda não estão em nenhuma tabela.
async function updateNear(zone) {
  const out = zone.querySelector('[data-near]');
  const cities = [...zone.querySelectorAll('[data-city]')].map(c => ({ city: c.dataset.name, state: c.dataset.state, ibge: c.dataset.ibge }));
  if (!cities.length) { out.innerHTML = ''; return; }
  const states = [...new Set(cities.map(c => c.state))];
  const lists = new Map(await Promise.all(states.map(async uf => [uf, await loadCities(uf).catch(() => null)])));
  const taken = allCityKeys();
  const regions = new Set();
  for (const c of cities) {
    const list = lists.get(c.state);
    const hit = list && (list.byIbge.get(c.ibge) || list.byName.get(norm(c.city)));
    if (hit?.near) regions.add(`${c.state}:${hit.near}`);
  }
  const near = [];
  for (const [uf, list] of lists) {
    for (const c of list?.items || []) if (regions.has(`${uf}:${c.near}`) && !taken.has(`${norm(c.city)}/${uf}`)) near.push({ ...c, state: uf });
  }
  if (!zone.isConnected) return;
  if (!near.length) { out.innerHTML = ''; return; }
  const shown = near.slice(0, 40);
  out.innerHTML = `<p class="hint">Cidades perto (toque para incluir):</p>
    <div class="ship-near-list">${shown.map(c => `<button type="button" class="ship-near-btn" data-action="city-add-near" data-name="${esc(c.city)}" data-state="${esc(c.state)}" data-ibge="${esc(c.ibge)}">${icon('plus')}<span>${esc(c.city)}</span></button>`).join('')}</div>
    ${shown.length > 1 ? button(`Incluir todas (${shown.length})`, { action: 'city-add-all', icon: 'plus', variant: 'ghost small' }) : ''}`;
}

// Uma cidade nova numa tabela some das sugestões de todas.
const updateAllNear = () => document.querySelectorAll('[data-zone]').forEach(updateNear);

// Põe a cidade na tabela. Devolve false (com aviso) se ela já está em alguma tabela.
function addCity(zone, c, { quiet = false } = {}) {
  const key = `${norm(c.city)}/${c.state}`;
  const zones = [...document.querySelectorAll('[data-zone]')];
  const where = allCityKeys().get(key);
  if (where !== undefined) {
    if (!quiet) toast(where === zones.indexOf(zone) ? `${c.city} já está nesta lista.` : `${c.city} já está na tabela de preço ${where + 1}.`, 'warn');
    return false;
  }
  zone.querySelector('[data-city-list]').insertAdjacentHTML('beforeend', cityChip(c));
  zone.querySelector('[data-no-city]').hidden = true;
  return true;
}

// Cidade digitada: só entra se for um nome da lista do IBGE (sem internet, entra como digitada).
async function addTyped(zone, { fromList = false } = {}) {
  const input = zone.querySelector('[data-k="new-city"]');
  const typed = input.value.trim();
  if (!typed) return fromList ? null : toast('Digite o nome da cidade e escolha na lista.', 'warn');
  const uf = zone.querySelector('[data-k="uf"]').value;
  const list = await loadCities(uf).catch(() => null);
  const hit = list?.byName.get(norm(typed));
  if (!hit) {
    if (fromList) return null;
    if (list && !list.offline && list.items.length) return toast(`Não achei “${typed}” em ${uf}. Confira o estado e escolha um nome da lista.`, 'warn');
  }
  if (addCity(zone, hit ? { city: hit.city, state: uf, ibge: hit.ibge } : { city: typed, state: uf })) {
    input.value = '';
    input.focus();
    updateAllNear();
  }
}

async function setupZones() {
  for (const zone of document.querySelectorAll('[data-zone]')) {
    fillCityOptions(zone);
    updateNear(zone);
  }
}

// ---------------------------------------------------------------------------
// Simulação
// ---------------------------------------------------------------------------
const prazo = days => {
  if (!days) return '';
  const [a, b] = days;
  if (b === 0) return 'chega hoje';
  if (a === b) return `${a} dia${a === 1 ? '' : 's'} útil${a === 1 ? '' : 'eis'}`;
  return `${a} a ${b} dias úteis`;
};

function simResult(r) {
  return `${r.city ? `<p class="muted">CEP de ${esc(r.city)}/${esc(r.state)} · compra de ${money(r.subtotal)}</p>`
      : notice('Não achei a cidade desse CEP, então o motoboy não entra na conta. CEP geral de cidade (terminado em 000) não vale: use o CEP de uma rua. No site isso não acontece, porque o cliente informa o endereço.', 'warn')}
    ${r.options.length ? `<ul class="ship-options">${r.options.map(o => `<li><span><strong>${esc(o.label)}</strong><small>${esc(o.description)}${o.days ? ` · ${prazo(o.days)}` : ''}</small></span><strong class="mono">${o.price ? money(o.price) : 'Grátis'}</strong></li>`).join('')}</ul>`
      : '<p>Nenhuma forma de entrega para esse CEP.</p>'}
    ${r.notices.map(n => `<p class="hint">${icon('info')} ${esc(n)}</p>`).join('')}
    ${r.carrierError ? notice(`Correios e Jadlog não responderam: ${esc(r.carrierError)}`, 'danger') : ''}`;
}

export default {
  id: 'frete',
  title: 'Frete e entrega',
  icon: 'truck',
  roles: EDITORS,

  load: () => get('/settings/shipping'),

  render({ data, state }) {
    const s = data.settings;
    state.sim ??= { cep: '', subtotal: 150, weightKg: 2 };
    const store = data.storeCity;
    const defaultUf = store?.state || 'MG';
    // Sem nada salvo: começa com a cidade da loja (pelo CEP) e o preço em branco.
    const zones = s.motoboy.zones.length ? s.motoboy.zones : [{ cities: store ? [store] : [], tiers: [{ from: 0, price: '' }], days: 0 }];
    return `${pageHead({
      title: 'Frete e entrega',
      lead: 'Como o cliente do site recebe a compra e quanto paga de frete.',
      actions: button('Salvar frete', { action: 'save', icon: 'check', variant: 'primary' })
    })}
    <form id="shippingForm" class="ship-form" onsubmit="return false">
      <section class="panel" aria-labelledby="storeTitle">
        <div class="panel-head"><h2 id="storeTitle">${icon('home')} Endereço da loja</h2></div>
        <div class="form-grid">
          <div class="field"><label for="originCep">CEP da loja</label>
            <input id="originCep" name="originCep" data-change="origin-cep" inputmode="numeric" maxlength="9" value="${esc(s.originCep)}" placeholder="00000-000">
            <small class="hint" id="storeCity">${store ? `${esc(store.city)}/${esc(store.state)}` : 'De onde saem as entregas. Use o CEP da rua da loja.'}</small></div>
        </div>
      </section>

      <section class="panel" aria-labelledby="motoboyTitle">
        <div class="panel-head"><h2 id="motoboyTitle">${icon('truck')} Entrega de motoboy</h2></div>
        <label class="check big-check"><input type="checkbox" name="motoboyEnabled"${s.motoboy.enabled ? ' checked' : ''}><span>Entregar de motoboy</span></label>
        <ul class="ship-zones" id="shipZones">${zones.map((z, k) => zoneHtml(z, k, { many: zones.length > 1, defaultUf })).join('')}</ul>
        ${button('Outra tabela de preço', { action: 'zone-add', icon: 'plus', variant: 'ghost' })}
        <p class="hint">Use outra tabela para cidades com preço diferente (ex.: as mais longe).</p>
      </section>

      <section class="panel" aria-labelledby="carriersTitle">
        <div class="panel-head"><h2 id="carriersTitle">${icon('box')} Correios e Jadlog</h2></div>
        ${meStatus(data.melhorEnvio)}
        <label class="check big-check"><input type="checkbox" name="carriersEnabled"${s.carriers.enabled ? ' checked' : ''}><span>Mandar pelos Correios e pela Jadlog (cotação no Melhor Envio)</span></label>
        <div class="form-grid">
          <div class="field"><label for="extraDays">Dias para separar e postar</label><input id="extraDays" name="extraDays" type="number" min="0" max="15" step="1" value="${esc(s.carriers.extraDays)}"><small class="hint">Somado ao prazo da transportadora.</small></div>
          <div class="field"><label for="carriersFreeFrom">Frete grátis a partir de (R$)</label><input id="carriersFreeFrom" name="carriersFreeFrom" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(s.carriers.freeFrom))}" placeholder="nunca grátis"><small class="hint">Vale para a opção mais barata.</small></div>
          <fieldset class="field full"><legend>Serviços oferecidos no site</legend>
            <div class="check-list">${Object.entries(CARRIER_SERVICES).map(([id, label]) => `<label class="check"><input type="checkbox" name="service" value="${id}"${s.carriers.services.includes(Number(id)) ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>
          </fieldset>
          <label class="check field"><input type="checkbox" name="insurance"${s.carriers.insurance ? ' checked' : ''}><span>Declarar o valor da compra (seguro em caso de extravio)</span></label>
        </div>
      </section>

      <section class="panel" aria-labelledby="pickupTitle">
        <div class="panel-head"><h2 id="pickupTitle">${icon('home')} Retirar na loja</h2></div>
        <label class="check big-check"><input type="checkbox" name="pickupEnabled"${s.pickup.enabled ? ' checked' : ''}><span>Cliente pode retirar na loja, sem custo</span></label>
        <div class="form-grid"><div class="field"><label for="readyHours">Fica pronto em quantas horas?</label><input id="readyHours" name="readyHours" type="number" min="0" max="168" step="1" value="${esc(s.pickup.readyHours)}"></div></div>
      </section>
    </form>

    <section class="panel" aria-labelledby="simTitle">
      <div class="panel-head"><h2 id="simTitle">Simular frete</h2></div>
      <p class="hint">Veja o que o cliente vai ver no site. Usa o que está nesta tela, mesmo antes de salvar.</p>
      <form class="form-grid ship-sim" data-form="simulate">
        <div class="field"><label for="simCep">CEP do cliente</label><input id="simCep" name="cep" inputmode="numeric" maxlength="9" required value="${esc(state.sim.cep)}" placeholder="00000-000"></div>
        <div class="field"><label for="simSubtotal">Valor da compra (R$)</label><input id="simSubtotal" name="subtotal" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${esc(state.sim.subtotal)}"></div>
        <div class="field"><label for="simWeight">Peso (kg)</label><input id="simWeight" name="weightKg" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${esc(state.sim.weightKg)}"></div>
        <div class="field ship-sim-go">${button('Simular', { type: 'submit', icon: 'search', variant: 'secondary' })}</div>
      </form>
      <div id="simOut" aria-live="polite">${state.simResult ? simResult(state.simResult) : ''}</div>
    </section>`;
  },

  // Depois de desenhar: lista de cidades do estado e as cidades perto.
  enter: () => setupZones(),

  actions: {
    'city-add'(ctx, el) { return addTyped(zoneOf(el)); },
    'city-remove'(ctx, el) {
      const zone = zoneOf(el);
      el.closest('[data-city]').remove();
      zone.querySelector('[data-no-city]').hidden = !!zone.querySelector('[data-city]');
      updateAllNear();
    },
    'city-add-near'(ctx, el) {
      const zone = zoneOf(el);
      if (addCity(zone, { city: el.dataset.name, state: el.dataset.state, ibge: el.dataset.ibge })) updateAllNear();
    },
    'city-add-all'(ctx, el) {
      const zone = zoneOf(el);
      let n = 0;
      for (const b of zone.querySelectorAll('[data-action="city-add-near"]')) {
        if (addCity(zone, { city: b.dataset.name, state: b.dataset.state, ibge: b.dataset.ibge }, { quiet: true })) n++;
      }
      toast(`${n} cidade(s) incluída(s). Confira a lista antes de salvar.`);
      updateAllNear();
    },
    'tier-add'(ctx, el) {
      const zone = zoneOf(el);
      const list = zone.querySelector('[data-tiers]');
      list.insertAdjacentHTML('beforeend', tierRow({}, Date.now()));
      list.lastElementChild.querySelector('[data-t=from]').focus();
    },
    'tier-remove'(ctx, el) {
      const zone = zoneOf(el);
      el.closest('[data-tier]').remove();
      updateSummary(zone);
    },
    'zone-add'() {
      const list = document.getElementById('shipZones');
      const uf = list.querySelector('[data-k="uf"]')?.value || 'MG';
      list.insertAdjacentHTML('beforeend', zoneHtml({ cities: [], tiers: [{ from: 0, price: '' }], days: 0 }, list.children.length, { many: true, defaultUf: uf, key: Date.now() }));
      renumberZones();
      const zone = list.lastElementChild;
      fillCityOptions(zone);
      zone.querySelector('[data-k="new-city"]').focus();
    },
    'zone-remove'(ctx, el) {
      zoneOf(el).remove();
      renumberZones();
      updateAllNear();
    },
    async save(ctx) {
      const { settings } = await api('/settings/shipping', { method: 'PUT', body: readForm() });
      const cities = settings.motoboy.zones.reduce((n, z) => n + z.cities.length, 0);
      toast(`Frete salvo.${settings.motoboy.enabled ? ` Motoboy em ${cities} cidade(s).` : ''}`);
      await ctx.refresh();
      setupZones();
    }
  },

  inputs: {
    'zone-rule'(ctx, el) { updateSummary(zoneOf(el)); },
    // Escolheu um nome na lista (não está só digitando): entra direto.
    'city-type'(ctx, el, event) {
      if (event.inputType && event.inputType !== 'insertReplacementText') return;
      addTyped(zoneOf(el), { fromList: true });
    }
  },

  changes: {
    'zone-uf'(ctx, el) { return fillCityOptions(zoneOf(el)); },
    'city-pick'(ctx, el) { return addTyped(zoneOf(el), { fromList: true }); },
    // CEP da loja: mostra a cidade e, se o motoboy ainda não tem cidade, já põe a da loja.
    async 'origin-cep'(ctx, el) {
      const hint = document.getElementById('storeCity');
      if (digits(el.value).length !== 8) return;
      const { place } = await get(`/shipping/place?cep=${digits(el.value)}`);
      if (!place) { hint.textContent = 'Não achei esse CEP. Use o CEP da rua da loja (não o geral da cidade, que termina em 000).'; return; }
      hint.textContent = `${place.city}/${place.state}`;
      const first = document.querySelector('[data-zone]');
      if (first && !first.querySelector('[data-city]')) {
        first.querySelector('[data-k="uf"]').value = place.state;
        fillCityOptions(first);
        if (addCity(first, place, { quiet: true })) updateAllNear();
      }
    }
  },

  forms: {
    async simulate(ctx, data) {
      ctx.state.sim = { cep: data.cep, subtotal: data.subtotal, weightKg: data.weightKg };
      const out = document.getElementById('simOut');
      out.innerHTML = '<p class="muted">Calculando…</p>';
      try {
        const result = await post('/shipping/simulate', { ...data, settings: readForm() });
        ctx.state.simResult = result;
        out.innerHTML = simResult(result);
      } catch (error) {
        out.innerHTML = '';
        throw error;
      }
    }
  }
};
