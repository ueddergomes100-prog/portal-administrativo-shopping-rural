// Calculadora de preço por canal (pop-up "Colocar à venda" e edição na fila).
// Para cada canal: preço de venda, preço promocional, taxa do canal, valor líquido e margem
// (margem só aparece para dono/gerente e quando o UniPlus informa o custo).
import { esc, money, num, field } from '../ui.js';
import { channelFees, marginOf } from '../../shared/domain.js';

export function feeRuleText(channel) {
  const parts = [];
  if (Number(channel.percent)) parts.push(`${num(channel.percent)}%`);
  if (Number(channel.fixed)) parts.push(`${money(channel.fixed)}${channel.fixedBelow ? ` abaixo de ${money(channel.fixedBelow)}` : ''}`);
  return parts.length ? parts.join(' + ') : 'sem taxa';
}

function resultCells(price, channel, cost) {
  if (!(Number(price) > 0)) return '<span class="muted">—</span>';
  const fees = channelFees(price, channel);
  const margin = marginOf(fees, cost);
  return `<span class="calc-fee">− ${money(fees.fee)}</span><strong class="calc-net">${money(fees.net)}</strong>${margin ? `<span class="calc-margin ${margin.value < 0 ? 'is-neg' : ''}">${margin.value < 0 ? 'prejuízo' : 'lucro'} ${money(margin.value)} · ${num(margin.percent)}%</span>` : ''}`;
}

// "Vender como": unidade do UniPlus ou uma embalagem dele (ex.: caixa com 3). Cada opção leva o
// preço, o custo e o estoque daquela forma; trocar atualiza a tabela (ver 'sell-as' abaixo).
// unit = { price, cost, stock, unit } da unidade; packages = embalagens do produto (UniPlus).
function sellAsSelect({ unit, packages, sellAs, showCost }) {
  const u = unit.unit || 'un';
  const option = (value, label, price, cost, stock) => `<option value="${esc(value)}" data-price="${esc(price)}" data-cost="${showCost && cost != null ? esc(cost) : ''}" data-stock="${esc(stock)}"${String(sellAs) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
  return `<label class="field sell-as"><span class="calc-label">Vender como</span>
    <select name="packageId" data-change="sell-as">
      ${option('', `Unidade (${u}) · ${money(unit.price)} · estoque ${num(unit.stock)}`, unit.price, unit.cost, unit.stock)}
      ${packages.map(p => option(p.id || p.unit, `${p.description || p.unit} com ${num(p.factor)} ${u} · ${money(p.price)} · estoque ${num(p.stock)}`, p.price, p.cost, p.stock)).join('')}
    </select></label>`;
}

// selected: [{ id, price, promoPrice }] (canais já escolhidos) — vazio = sugere o site marcado.
export function pricingEditor({ channels, product, selected = [], promoStart = '', promoEnd = '', showCost = false, unit = null, packages = [], sellAs = '' }) {
  const cost = showCost ? product.cost ?? null : null;
  const chosen = Object.fromEntries(selected.map(c => [c.id, c]));
  const noneChosen = !selected.length;
  const rows = channels.filter(c => c.active !== false || chosen[c.id]).map(channel => {
    const current = chosen[channel.id];
    const on = !!current || (noneChosen && channel.id === 'site');
    const price = Number(current?.price ?? product.basePrice).toFixed(2);
    const promo = current?.promoPrice ? Number(current.promoPrice).toFixed(2) : '';
    return `<tr class="calc-row${on ? '' : ' is-off'}" data-channel="${esc(channel.id)}"
        data-percent="${esc(channel.percent)}" data-fixed="${esc(channel.fixed)}" data-fixed-below="${esc(channel.fixedBelow ?? '')}">
      <td><label class="calc-toggle"><input type="checkbox" data-change="calc-toggle" data-calc="on"${on ? ' checked' : ''}>
        <span><strong>${esc(channel.name)}</strong><small>${esc(feeRuleText(channel) === 'sem taxa' ? 'sem taxa' : 'taxa ' + feeRuleText(channel))}</small></span></label></td>
      <td data-label="Vender por"><label class="calc-money"><span class="sr-only">Preço em ${esc(channel.name)}</span><span aria-hidden="true">R$</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" data-input="calc" data-calc="price" value="${esc(price)}"${on ? '' : ' disabled'}></label></td>
      <td class="calc-out" data-label="Você recebe" data-out="price">${resultCells(price, channel, cost)}</td>
      <td data-label="Na promoção"><label class="calc-money"><span class="sr-only">Preço na promoção em ${esc(channel.name)}</span><span aria-hidden="true">R$</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" data-input="calc" data-calc="promo" value="${esc(promo)}" placeholder="—"${on ? '' : ' disabled'}></label></td>
      <td class="calc-out" data-label="Recebe na promoção" data-out="promo">${promo ? resultCells(promo, channel, cost) : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
  return `<div class="calc" data-cost="${cost ?? ''}">
    ${unit && packages.length ? sellAsSelect({ unit, packages, sellAs, showCost }) : ''}
    <div class="calc-head">
      <div><span class="calc-label">Preço na loja</span><strong class="mono" data-head="price">${money(product.basePrice)}</strong></div>
      <div><span class="calc-label">Estoque</span><strong class="mono" data-head="stock">${num(product.stock)}</strong></div>
      ${cost != null ? `<div><span class="calc-label">Custo</span><strong class="mono" data-head="cost">${money(cost)}</strong></div>` : ''}
    </div>
    <div class="table-wrap"><table class="calc-table">
      <thead><tr><th scope="col">Onde vender</th><th scope="col">Vender por</th><th scope="col">Você recebe</th><th scope="col">Na promoção</th><th scope="col">Recebe na promoção</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="calc-dates">
      ${field('promoStart', 'Promoção começa em', { type: 'date', value: promoStart })}
      ${field('promoEnd', 'Promoção termina em', { type: 'date', value: promoEnd })}
      <small class="hint full">Só preencha as datas se colocar preço de promoção em algum lugar.</small>
    </div>
  </div>`;
}

// Recalcula a linha em que a pessoa digitou (chamado pelos handlers data-input/data-change da tela).
export function recalcRow(el) {
  const row = el.closest('[data-channel]');
  if (!row) return;
  const calc = row.closest('.calc');
  const cost = calc.dataset.cost ? Number(calc.dataset.cost) : null;
  const channel = { percent: Number(row.dataset.percent), fixed: Number(row.dataset.fixed), fixedBelow: row.dataset.fixedBelow === '' ? null : Number(row.dataset.fixedBelow) };
  const on = row.querySelector('[data-calc=on]').checked;
  row.classList.toggle('is-off', !on);
  row.querySelectorAll('input[type=number]').forEach(i => { i.disabled = !on; });
  const price = row.querySelector('[data-calc=price]').value;
  const promo = row.querySelector('[data-calc=promo]').value;
  row.querySelector('[data-out=price]').innerHTML = resultCells(price, channel, cost);
  row.querySelector('[data-out=promo]').innerHTML = promo ? resultCells(promo, channel, cost) : '<span class="muted">—</span>';
}

// Lê o que foi preenchido para enviar à API.
export function readPricing(form) {
  const channels = [...form.querySelectorAll('.calc [data-channel]')]
    .filter(row => row.querySelector('[data-calc=on]').checked)
    .map(row => ({ id: row.dataset.channel, price: row.querySelector('[data-calc=price]').value, promoPrice: row.querySelector('[data-calc=promo]').value }));
  const sellAs = form.querySelector('.calc [name=packageId]');
  return { channels, promoStart: form.elements.promoStart?.value || '', promoEnd: form.elements.promoEnd?.value || '', ...(sellAs ? { packageId: sellAs.value } : {}) };
}

// Trocou unidade ↔ caixa: preço, custo e estoque passam a ser os da forma escolhida, e os preços
// dos lugares de venda voltam ao preço da loja dessa forma (a promoção é apagada para conferir).
function changeSellAs(el) {
  const calc = el.closest('.calc');
  const opt = el.selectedOptions[0];
  const price = Number(opt.dataset.price) || 0;
  calc.dataset.cost = opt.dataset.cost || '';
  calc.querySelector('[data-head=price]').textContent = money(price);
  calc.querySelector('[data-head=stock]').textContent = num(opt.dataset.stock);
  const costEl = calc.querySelector('[data-head=cost]');
  if (costEl && opt.dataset.cost) costEl.textContent = money(opt.dataset.cost);
  calc.querySelectorAll('[data-channel]').forEach(row => {
    row.querySelector('[data-calc=price]').value = price.toFixed(2);
    row.querySelector('[data-calc=promo]').value = '';
    recalcRow(row.querySelector('[data-calc=price]'));
  });
}

export const pricingInputs = { calc: (ctx, el) => recalcRow(el) };
export const pricingChanges = { 'calc-toggle': (ctx, el) => recalcRow(el), 'sell-as': (ctx, el) => changeSellAs(el) };

// Tabela de leitura (ficha da fila): o que foi decidido por canal.
export function pricingSummary(item, { showCost = false } = {}) {
  const rows = (item.channels || []).map(c => `<tr>
    <td><strong>${esc(c.name)}</strong></td>
    <td class="num mono">${money(c.price)}</td>
    <td class="num mono">− ${money(c.fee)}</td>
    <td class="num mono"><strong>${money(c.net)}</strong>${showCost && c.margin ? `<span class="sub ${c.margin.value < 0 ? 'is-danger' : ''}">${money(c.margin.value)} · ${num(c.margin.percent)}%</span>` : ''}</td>
    <td class="num mono">${c.promoPrice ? `${money(c.promoPrice)}<span class="sub">recebe ${money(c.promoNet)}</span>` : '—'}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table class="table compact">
    <thead><tr><th scope="col">Onde</th><th scope="col" class="num">Preço</th><th scope="col" class="num">Taxa</th><th scope="col" class="num">Você recebe${showCost ? ' / lucro' : ''}</th><th scope="col" class="num">Promoção</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
