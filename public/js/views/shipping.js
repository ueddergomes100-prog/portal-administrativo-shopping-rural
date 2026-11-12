// Frete e entrega do site: retirada na loja, motoboy por cidade (preço, pedido mínimo, grátis a partir
// de) e Correios/Jadlog pelo Melhor Envio. "Simular" testa um CEP com o que está na tela, sem salvar.
import { get, post, api } from '../api.js';
import { esc, icon, money, pageHead, button, toast, notice } from '../ui.js';
import { CARRIER_SERVICES, BR_STATES } from '../../shared/domain.js';

const EDITORS = ['owner', 'manager'];
const DAYS = [[0, 'No mesmo dia'], [1, 'Em 1 dia'], [2, 'Em 2 dias'], [3, 'Em 3 dias'], [5, 'Em 5 dias']];
const value = v => (v === null || v === undefined ? '' : v);

function areaRow(a = {}, k = Date.now()) {
  const id = `ar-${k}`;
  const days = DAYS.some(([d]) => d === Number(a.days ?? 0)) ? DAYS : [...DAYS, [Number(a.days), `Em ${a.days} dias`]];
  return `<li class="ship-area" data-area>
    <div class="field ship-city"><label for="${id}-city">Cidade</label><input id="${id}-city" data-k="city" value="${esc(value(a.city))}" maxlength="80" placeholder="Ex.: Divinópolis"></div>
    <div class="field ship-uf"><label for="${id}-uf">Estado</label><select id="${id}-uf" data-k="state">${['', ...BR_STATES].map(uf => `<option value="${uf}"${uf === (a.state || '') ? ' selected' : ''}>${uf || '—'}</option>`).join('')}</select></div>
    <div class="field"><label for="${id}-price">Preço do frete (R$)</label><input id="${id}-price" data-k="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(a.price))}"></div>
    <div class="field"><label for="${id}-days">Prazo</label><select id="${id}-days" data-k="days">${days.map(([d, l]) => `<option value="${d}"${d === Number(a.days ?? 0) ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="${id}-min">Pedido mínimo (R$)</label><input id="${id}-min" data-k="minOrder" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(a.minOrder))}" placeholder="sem mínimo"></div>
    <div class="field"><label for="${id}-free">Grátis a partir de (R$)</label><input id="${id}-free" data-k="freeFrom" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(a.freeFrom))}" placeholder="nunca grátis"></div>
    <div class="ship-area-remove">${button('Tirar cidade', { action: 'remove-area', icon: 'trash', variant: 'ghost small danger-text' })}</div>
  </li>`;
}

function meStatus(me) {
  if (me.configured) return notice(me.sandbox ? 'Melhor Envio conectado no modo de teste (sandbox): os preços não são os de verdade.' : 'Melhor Envio conectado. Os preços são os da conta da loja.', me.sandbox ? 'warn' : 'ok');
  if (me.demo) return notice('Demonstração: os preços dos Correios e da Jadlog aqui são de exemplo.', 'info');
  return notice('O Melhor Envio ainda não está conectado. Crie a conta da loja em melhorenvio.com.br, gere um token (Integrações › Permissões de acesso) e coloque na Vercel: MELHOR_ENVIO_TOKEN e MELHOR_ENVIO_CONTACT (o e-mail da loja). Enquanto isso, o site mostra só motoboy e retirada.', 'warn');
}

function readForm() {
  const form = document.getElementById('shippingForm');
  const val = name => form.querySelector(`[name="${name}"]`);
  return {
    originCep: val('originCep').value,
    pickup: { enabled: val('pickupEnabled').checked, readyHours: val('readyHours').value },
    motoboy: {
      enabled: val('motoboyEnabled').checked,
      areas: [...form.querySelectorAll('[data-area]')].map(li => Object.fromEntries([...li.querySelectorAll('[data-k]')].map(el => [el.dataset.k, el.value.trim()])))
    },
    carriers: {
      enabled: val('carriersEnabled').checked,
      services: [...form.querySelectorAll('[name="service"]:checked')].map(el => Number(el.value)),
      extraDays: val('extraDays').value,
      freeFrom: val('carriersFreeFrom').value,
      insurance: val('insurance').checked
    }
  };
}

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
    return `${pageHead({
      title: 'Frete e entrega',
      lead: 'Como o cliente do site recebe a compra e quanto paga de frete.',
      actions: button('Salvar frete', { action: 'save', icon: 'check', variant: 'primary' })
    })}
    <form id="shippingForm" class="ship-form" onsubmit="return false">
      <section class="panel" aria-labelledby="motoboyTitle">
        <div class="panel-head"><h2 id="motoboyTitle">${icon('truck')} Entrega de motoboy</h2></div>
        <label class="check big-check"><input type="checkbox" name="motoboyEnabled"${s.motoboy.enabled ? ' checked' : ''}><span>Entregar de motoboy nestas cidades</span></label>
        <p class="hint">Uma linha por cidade. <strong>Pedido mínimo</strong>: abaixo dele o motoboy não aparece para o cliente. <strong>Grátis a partir de</strong>: acima desse valor o frete fica zero.</p>
        <ul class="ship-areas" id="shipAreas">${(s.motoboy.areas.length ? s.motoboy.areas : [{}]).map((a, k) => areaRow(a, k)).join('')}</ul>
        ${button('Adicionar cidade', { action: 'add-area', icon: 'plus', variant: 'ghost' })}
      </section>

      <section class="panel" aria-labelledby="carriersTitle">
        <div class="panel-head"><h2 id="carriersTitle">${icon('box')} Correios e Jadlog</h2></div>
        ${meStatus(data.melhorEnvio)}
        <label class="check big-check"><input type="checkbox" name="carriersEnabled"${s.carriers.enabled ? ' checked' : ''}><span>Mandar pelos Correios e pela Jadlog (cotação no Melhor Envio)</span></label>
        <div class="form-grid">
          <div class="field"><label for="originCep">CEP de onde a mercadoria sai</label><input id="originCep" name="originCep" inputmode="numeric" maxlength="9" value="${esc(s.originCep)}" placeholder="00000-000"></div>
          <div class="field"><label for="extraDays">Dias para separar e postar</label><input id="extraDays" name="extraDays" type="number" min="0" max="15" step="1" value="${esc(s.carriers.extraDays)}"><small class="hint">Somado ao prazo da transportadora.</small></div>
          <fieldset class="field full"><legend>Serviços oferecidos no site</legend>
            <div class="check-list">${Object.entries(CARRIER_SERVICES).map(([id, label]) => `<label class="check"><input type="checkbox" name="service" value="${id}"${s.carriers.services.includes(Number(id)) ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>
          </fieldset>
          <div class="field"><label for="carriersFreeFrom">Frete grátis a partir de (R$)</label><input id="carriersFreeFrom" name="carriersFreeFrom" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(s.carriers.freeFrom))}" placeholder="nunca grátis"><small class="hint">Vale para a opção mais barata.</small></div>
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

  actions: {
    'add-area'() {
      const list = document.getElementById('shipAreas');
      list.insertAdjacentHTML('beforeend', areaRow({}, Date.now()));
      list.lastElementChild.querySelector('[data-k=city]').focus();
    },
    'remove-area'(ctx, el) {
      el.closest('[data-area]').remove();
    },
    async save(ctx) {
      const { settings } = await api('/settings/shipping', { method: 'PUT', body: readForm() });
      toast(`Frete salvo.${settings.motoboy.enabled ? ` Motoboy em ${settings.motoboy.areas.length} cidade(s).` : ''}`);
      await ctx.refresh();
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
