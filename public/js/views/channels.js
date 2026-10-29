// Canais de venda e taxas: o dono ajusta comissão e tarifa de cada canal; todos veem o simulador.
import { get, api } from '../api.js';
import { esc, icon, money, num, pageHead, button, toast, notice } from '../ui.js';
import { channelFees } from '../../shared/domain.js';
import { feeRuleText } from './pricing.js';

const INTEGRATION_LABEL = { site: 'Site próprio (catálogo do portal)', '': 'Anúncio feito à mão' };

function row(c, editable) {
  if (!editable) {
    return `<tr><td><strong>${esc(c.name)}</strong>${c.note ? `<span class="sub">${esc(c.note)}</span>` : ''}</td><td>${esc(feeRuleText(c))}</td><td>${esc(INTEGRATION_LABEL[c.integration || ''])}</td><td>${c.active !== false ? 'Sim' : 'Não'}</td></tr>`;
  }
  return `<tr data-channel-row data-id="${esc(c.id || '')}">
    <td><label class="sr-only" for="ch-name-${esc(c.id)}">Nome</label><input id="ch-name-${esc(c.id)}" class="cell-input" data-k="name" value="${esc(c.name)}" maxlength="60" required>
      <input class="cell-input small" data-k="note" value="${esc(c.note || '')}" maxlength="300" placeholder="Observação (opcional)" aria-label="Observação de ${esc(c.name)}"></td>
    <td><label class="cell-money"><input class="cell-input" type="number" min="0" max="100" step="0.01" data-k="percent" data-input="sim" value="${esc(c.percent)}" aria-label="Comissão de ${esc(c.name)} em %"><span>%</span></label></td>
    <td><label class="cell-money"><span>R$</span><input class="cell-input" type="number" min="0" step="0.01" data-k="fixed" data-input="sim" value="${esc(c.fixed)}" aria-label="Tarifa fixa de ${esc(c.name)}"></label></td>
    <td><label class="cell-money"><span>R$</span><input class="cell-input" type="number" min="0" step="0.01" data-k="fixedBelow" data-input="sim" value="${esc(c.fixedBelow ?? '')}" placeholder="sempre" aria-label="Tarifa fixa só abaixo de"></label></td>
    <td><select class="cell-input" data-k="integration" aria-label="Integração de ${esc(c.name)}">${Object.entries(INTEGRATION_LABEL).map(([k, v]) => `<option value="${k}"${(c.integration || '') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><input type="checkbox" data-k="active"${c.active !== false ? ' checked' : ''} aria-label="${esc(c.name)} ativo"></td>
    <td>${button('Remover', { action: 'remove-row', icon: 'trash', variant: 'ghost small danger-text' })}</td>
  </tr>`;
}

function readRows() {
  return [...document.querySelectorAll('[data-channel-row]')].map(tr => {
    const val = k => tr.querySelector(`[data-k=${k}]`);
    return {
      id: tr.dataset.id || undefined,
      name: val('name').value.trim(),
      note: val('note').value.trim(),
      percent: val('percent').value,
      fixed: val('fixed').value || 0,
      fixedBelow: val('fixedBelow').value || null,
      integration: val('integration').value || null,
      active: val('active').checked
    };
  });
}

function simulate(price, channels) {
  if (!(Number(price) > 0)) return '<p class="muted">Digite um preço para comparar.</p>';
  const rows = channels.filter(c => c.active !== false).map(c => ({ c, f: channelFees(price, c) })).sort((a, b) => b.f.net - a.f.net);
  return `<ul class="sim-list">${rows.map(({ c, f }, i) => `<li${i === 0 ? ' class="is-best"' : ''}><span>${esc(c.name)}</span><span class="mono">− ${money(f.fee)}</span><strong class="mono">${money(f.net)}</strong></li>`).join('')}</ul>`;
}

export default {
  id: 'canais',
  title: 'Canais e taxas',
  icon: 'money',
  group: 'Gestão',

  load: () => get('/settings/channels'),

  render({ user, state, data }) {
    const editable = user.role === 'owner';
    state.sim ??= 100;
    return `${pageHead({
      title: 'Canais e taxas',
      lead: 'Comissão e tarifa de cada canal de venda. O portal usa esta tabela para mostrar quanto sobra (valor líquido) em cada venda.',
      actions: editable ? button('Salvar taxas', { action: 'save', icon: 'check', variant: 'primary' }) : ''
    })}
    <div class="grid-channels">
      <section class="panel flush">
        <div class="table-wrap"><table class="table">
          <thead><tr>${editable
            ? '<th scope="col">Canal</th><th scope="col">Comissão</th><th scope="col">Tarifa fixa</th><th scope="col">Tarifa só abaixo de</th><th scope="col">Como publica</th><th scope="col">Ativo</th><th scope="col"><span class="sr-only">Ações</span></th>'
            : '<th scope="col">Canal</th><th scope="col">Taxa</th><th scope="col">Como publica</th><th scope="col">Ativo</th>'}</tr></thead>
          <tbody id="channelRows">${data.channels.map(c => row(c, editable)).join('')}</tbody>
        </table></div>
        ${editable ? `<div class="panel-foot">${button('Adicionar canal', { action: 'add-row', icon: 'plus', variant: 'ghost' })}</div>` : ''}
      </section>
      <section class="panel" aria-labelledby="simTitle">
        <div class="panel-head"><h2 id="simTitle">Simulador</h2></div>
        <label class="calc-money big"><span>R$</span><input type="number" min="0" step="0.01" data-input="sim-price" value="${esc(state.sim)}" aria-label="Preço de venda para simular"></label>
        <div id="simOut">${simulate(state.sim, data.channels)}</div>
        <p class="hint">Mostra quanto a loja recebe vendendo por esse preço em cada canal, do maior para o menor.</p>
      </section>
    </div>
    ${notice('As tabelas dos marketplaces mudam com frequência e variam por categoria e tipo de anúncio. Confira os valores vigentes na Shopee e no Mercado Livre e ajuste aqui.', 'info')}`;
  },

  inputs: {
    'sim-price'(ctx, el) {
      ctx.state.sim = el.value;
      document.getElementById('simOut').innerHTML = simulate(el.value, ctx.data.channels);
    },
    sim(ctx) {
      // Edição em andamento: simulador usa os valores digitados.
      const draft = readRows().map(r => ({ ...r, percent: Number(r.percent) || 0, fixed: Number(r.fixed) || 0, fixedBelow: r.fixedBelow === null ? null : Number(r.fixedBelow) }));
      document.getElementById('simOut').innerHTML = simulate(ctx.state.sim, draft);
    }
  },

  actions: {
    'add-row'() {
      document.getElementById('channelRows').insertAdjacentHTML('beforeend', row({ id: '', name: '', percent: 0, fixed: 0, fixedBelow: null, integration: null, active: true }, true));
      document.querySelector('#channelRows tr:last-child [data-k=name]').focus();
    },
    'remove-row'(ctx, el) {
      el.closest('tr').remove();
    },
    async save(ctx) {
      const { channels } = await api('/settings/channels', { method: 'PUT', body: { items: readRows() } });
      ctx.invalidate('channels');
      toast(`Taxas salvas (${num(channels.length)} canais).`);
      await ctx.refresh();
    }
  }
};
