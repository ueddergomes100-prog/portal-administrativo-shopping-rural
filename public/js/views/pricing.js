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

// selected: [{ id, price, promoPrice }] (canais já escolhidos) — vazio = sugere o site marcado.
export function pricingEditor({ channels, product, selected = [], promoStart = '', promoEnd = '', showCost = false }) {
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
      <td class="calc-out" data-label="Recebe" data-out="price">${resultCells(price, channel, cost)}</td>
      <td data-label="Promoção"><label class="calc-money"><span class="sr-only">Preço promocional em ${esc(channel.name)}</span><span aria-hidden="true">R$</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" data-input="calc" data-calc="promo" value="${esc(promo)}" placeholder="—"${on ? '' : ' disabled'}></label></td>
      <td class="calc-out" data-label="Recebe na promoção" data-out="promo">${promo ? resultCells(promo, channel, cost) : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
  return `<div class="calc" data-cost="${cost ?? ''}">
    <div class="calc-head">
      <div><span class="calc-label">Preço no UniPlus</span><strong class="mono">${money(product.basePrice)}</strong></div>
      <div><span class="calc-label">Estoque</span><strong class="mono">${num(product.stock)}</strong></div>
      ${cost ? `<div><span class="calc-label">Custo</span><strong class="mono">${money(cost)}</strong></div>` : ''}
    </div>
    <div class="table-wrap"><table class="calc-table">
      <thead><tr><th scope="col">Canal</th><th scope="col">Vender por</th><th scope="col">Recebe (líquido)</th><th scope="col">Promoção</th><th scope="col">Recebe na promoção</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="calc-dates">
      ${field('promoStart', 'Promoção a partir de', { type: 'date', value: promoStart })}
      ${field('promoEnd', 'Promoção até', { type: 'date', value: promoEnd })}
      <small class="hint full">Preencha as datas só se algum canal tiver preço promocional.</small>
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
  return { channels, promoStart: form.elements.promoStart?.value || '', promoEnd: form.elements.promoEnd?.value || '' };
}

export const pricingInputs = { calc: (ctx, el) => recalcRow(el) };
export const pricingChanges = { 'calc-toggle': (ctx, el) => recalcRow(el) };

// Tabela de leitura (ficha da fila): o que foi decidido por canal.
export function pricingSummary(item, { showCost = false } = {}) {
  const rows = (item.channels || []).map(c => `<tr>
    <td><strong>${esc(c.name)}</strong></td>
    <td class="num mono">${money(c.price)}</td>
    <td class="num mono">− ${money(c.fee)}</td>
    <td class="num mono"><strong>${money(c.net)}</strong>${showCost && c.margin ? `<span class="sub ${c.margin.value < 0 ? 'is-danger' : ''}">${money(c.margin.value)} · ${num(c.margin.percent)}%</span>` : ''}</td>
    <td class="num mono">${c.promoPrice ? `${money(c.promoPrice)}<span class="sub">líquido ${money(c.promoNet)}</span>` : '—'}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table class="table compact">
    <thead><tr><th scope="col">Canal</th><th scope="col" class="num">Preço</th><th scope="col" class="num">Taxa</th><th scope="col" class="num">Líquido${showCost ? ' / lucro' : ''}</th><th scope="col" class="num">Promoção</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
