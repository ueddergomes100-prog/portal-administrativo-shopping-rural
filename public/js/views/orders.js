// Pedidos do site próprio. Chegam do servidor do site (POST /api/store/orders) já com o pagamento.
// A equipe move o andamento aqui (separando, pronto para retirar, enviado com rastreio, entregue)
// e o site mostra o mesmo andamento para o cliente. Shopee e Mercado Livre: painéis deles.
import { get, post } from '../api.js';
import { esc, icon, money, num, dateTime, pageHead, empty, openDrawer, statusTag, toast, confirmDialog, button, notice } from '../ui.js';
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHODS, DELIVERY_METHODS } from '../../shared/domain.js';

const total = o => o.totals?.total ?? o.total ?? 0;

const view = {
  id: 'pedidos',
  title: 'Pedidos',
  icon: 'orders',
  group: 'Operação',

  load: () => get('/orders'),

  render({ state, data }) {
    const { connected, orders } = data;
    const head = pageHead({ title: 'Pedidos do site', lead: 'Pedidos feitos no site próprio. Mova o andamento aqui — o cliente vê a mesma etapa na página do pedido.' });
    if (!orders.length) {
      return `${head}<section class="panel">${empty({
        title: connected ? 'Nenhum pedido ainda' : 'Site ainda não ligado',
        text: connected ? 'Quando alguém comprar no site, o pedido aparece aqui.' : 'Configure STORE_API_TOKEN no servidor e use o mesmo token no servidor do site (veja docs/SITE.md).',
        action: `<a class="btn" href="#/integracoes">${icon('link')}<span>Ver integrações</span></a>`, ic: 'orders'
      })}</section>`;
    }
    const filter = state.status || '';
    const list = filter ? orders.filter(o => o.status === filter) : orders;
    const paid = orders.filter(o => !['aguardando_pagamento', 'cancelado'].includes(o.status));
    return `${head}
      <div class="stat-strip">
        ${Object.entries(ORDER_STATUS).map(([k, v]) => {
          const n = orders.filter(o => o.status === k).length;
          return n || filter === k ? `<button class="stat-btn${filter === k ? ' is-active' : ''}" data-action="status" data-status="${k}" aria-pressed="${filter === k}"><strong>${num(n)}</strong> ${esc(v.label)}</button>` : '';
        }).join('')}
        <span><strong>${money(paid.reduce((t, o) => t + total(o), 0))}</strong> em pedidos pagos</span>
      </div>
      <section class="panel flush"><div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Pedido</th><th scope="col">Cliente</th><th scope="col">Data</th><th scope="col">Entrega</th><th scope="col" class="num">Total</th><th scope="col">Situação</th></tr></thead>
      <tbody>${list.map(o => `<tr class="row-link" data-action="open" data-id="${esc(o.id)}" tabindex="0">
        <td class="mono">${esc(o.number)}</td><td>${esc(o.customer?.name || '—')}<span class="sub">${esc(o.customer?.phone || o.customer?.email || '')}</span></td>
        <td class="nowrap">${dateTime(o.createdAt)}</td>
        <td>${esc(DELIVERY_METHODS[o.delivery?.method] || '—')}</td>
        <td class="num mono">${money(total(o))}<span class="sub">${esc(PAYMENT_METHODS[o.payment?.method] || '')}</span></td>
        <td>${statusTag(ORDER_STATUS, o.status)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  },

  async open(ctx, id) {
    const order = ctx.data?.orders?.find(o => o.id === id);
    if (!order) return;
    ctx.state.current = order;
    const a = order.delivery?.address;
    const t = order.totals || {};
    openDrawer({
      eyebrow: statusTag(ORDER_STATUS, order.status),
      title: `Pedido ${order.number}`,
      body: `<dl class="facts">
        <div><dt>Cliente</dt><dd>${esc(order.customer?.name || '—')}${order.customer?.cpf ? `<span class="mono sub">CPF ${esc(order.customer.cpf)}</span>` : ''}</dd></div>
        <div><dt>Contato</dt><dd>${esc([order.customer?.phone, order.customer?.email].filter(Boolean).join(' · ') || '—')}</dd></div>
        <div><dt>Data</dt><dd>${dateTime(order.createdAt)}</dd></div>
        <div><dt>Pagamento</dt><dd>${esc(PAYMENT_METHODS[order.payment?.method] || '—')} · ${esc(PAYMENT_STATUS[order.payment?.status] || '—')}${order.payment?.installments ? ` · ${order.payment.installments}x` : ''}</dd></div>
        <div><dt>Entrega</dt><dd>${esc(order.delivery?.label || DELIVERY_METHODS[order.delivery?.method] || '—')}</dd></div>
        <div><dt>Rastreio</dt><dd class="mono">${esc(order.trackingCode || '—')}</dd></div>
        ${a ? `<div class="full-row"><dt>Endereço</dt><dd>${esc([a.recipient, `${a.street || ''}, ${a.number || ''}${a.complement ? ' ' + a.complement : ''}`, a.district, `${a.city || ''}/${a.state || ''}`, a.cep].filter(Boolean).join(' · '))}</dd></div>` : ''}
      </dl>
      <section class="section"><h3>Itens</h3><div class="table-wrap"><table class="table compact"><thead><tr><th scope="col">Produto</th><th scope="col" class="num">Qtd.</th><th scope="col" class="num">Preço</th></tr></thead>
      <tbody>${order.items.map(i => `<tr><td>${esc(i.name)}<span class="mono sub">${esc([i.sku, i.measure].filter(Boolean).join(' · '))}</span></td><td class="num mono">${num(i.qty)}</td><td class="num mono">${money(i.unitPrice)}</td></tr>`).join('')}</tbody></table></div>
      <dl class="ledger compact-ledger">
        <div><dt>Subtotal</dt><dd class="mono">${money(t.subtotal)}</dd></div>
        ${t.couponDiscount ? `<div><dt>Cupom ${esc(t.coupon || '')}</dt><dd class="mono">− ${money(t.couponDiscount)}</dd></div>` : ''}
        ${t.pixDiscount ? `<div><dt>Desconto Pix</dt><dd class="mono">− ${money(t.pixDiscount)}</dd></div>` : ''}
        <div><dt>Frete</dt><dd class="mono">${money(t.shipping)}</dd></div>
        <div><dt>Total</dt><dd class="mono">${money(t.total)}</dd></div>
      </dl></section>
      ${order.status === 'aguardando_pagamento' ? notice('Aguardando a confirmação do pagamento pelo site/gateway. Não separe antes de ficar “Pago”.', 'warn') : ''}
      <section class="section"><h3>Andamento</h3><ul class="timeline">${(order.timeline || []).slice().reverse().map(h => `<li><span class="tl-when">${dateTime(h.at)}</span><span class="tl-what">${statusTag(ORDER_STATUS, h.status)}${h.by ? ` ${esc(h.by)}` : ''}${h.note ? `<q>${esc(h.note)}</q>` : ''}</span></li>`).join('')}</ul></section>`,
      footer: [...(order.transitions || [])].sort((x, y) => (y.to === 'cancelado') - (x.to === 'cancelado'))
        .map(tr => button(tr.label, { action: 'move', variant: tr.to === 'cancelado' ? 'ghost danger-text' : 'primary', data: { to: tr.to, requires: tr.requires || '', label: tr.label } })).join('')
    });
  },

  actions: {
    open(ctx, el) { ctx.navigate(`pedidos/${el.dataset.id}`); },
    status(ctx, el) { ctx.state.status = ctx.state.status === el.dataset.status ? '' : el.dataset.status; ctx.rerender(); },
    async move(ctx, el) {
      const order = ctx.state.current;
      const { to, requires, label } = el.dataset;
      const note = await confirmDialog({
        title: label,
        text: `Pedido ${esc(order.number)} vai para <strong>${esc(ORDER_STATUS[to].label)}</strong>. O cliente vê essa etapa no site.`,
        confirmLabel: label,
        tone: to === 'cancelado' ? 'danger' : 'primary',
        noteLabel: requires === 'tracking' ? 'Código de rastreio' : requires === 'note' ? 'Motivo do cancelamento' : '',
        noteRequired: !!requires
      });
      if (note === null) return;
      await post(`/orders/${encodeURIComponent(order.id)}/move`, { to, trackingCode: requires === 'tracking' ? note : undefined, note: requires === 'note' ? note : undefined });
      toast(`Pedido ${order.number}: ${ORDER_STATUS[to].label}.`);
      await ctx.refresh();
      ctx.refreshBadges();
      ctx.navigate(`pedidos/${order.id}`, { replace: true }); // reabre a ficha com os dados novos
    }
  }
};
export default view;
