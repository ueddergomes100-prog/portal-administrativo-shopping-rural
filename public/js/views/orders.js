// Pedidos do site, importados da Nuvemshop. O portal não cria nem altera pedidos.
import { get, post } from '../api.js';
import { esc, icon, money, num, dateTime, pageHead, empty, button, openDrawer, toast, statusTag, notice } from '../ui.js';
import { ORDER_STATUS } from '../../shared/domain.js';

export default {
  id: 'pedidos',
  title: 'Pedidos',
  icon: 'orders',
  group: 'Operação',

  load: () => get('/orders'),

  render({ user, data }) {
    const { connected, orders } = data;
    const canSync = connected && ['owner', 'manager', 'site'].includes(user.role);
    const head = pageHead({
      title: 'Pedidos do site',
      lead: 'Pedidos da loja virtual, trazidos da Nuvemshop. Pagamento e entrega são geridos na própria Nuvemshop.',
      actions: canSync ? button('Importar pedidos recentes', { action: 'sync', icon: 'sync' }) : ''
    });
    if (!connected) {
      return `${head}<section class="panel">${empty({
        title: 'Nuvemshop não conectada',
        text: 'Os pedidos aparecem aqui depois que NUVEMSHOP_STORE_ID e NUVEMSHOP_ACCESS_TOKEN forem configurados no servidor.',
        action: `<a class="btn" href="#/integracoes">${icon('link')}<span>Ver integrações</span></a>`, ic: 'orders'
      })}</section>`;
    }
    if (!orders.length) return `${head}<section class="panel">${empty({ title: 'Nenhum pedido importado', text: 'Use “Importar pedidos recentes” para trazer os últimos pedidos.', ic: 'orders' })}</section>`;
    return `${head}<section class="panel flush"><div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Pedido</th><th scope="col">Cliente</th><th scope="col">Data</th><th scope="col" class="num">Total</th><th scope="col">Situação</th></tr></thead>
      <tbody>${orders.map(o => `<tr class="row-link" data-action="open" data-id="${esc(o.id)}" tabindex="0">
        <td class="mono">#${esc(o.number)}</td><td>${esc(o.customer || '—')}<span class="sub">${esc(o.email)}</span></td>
        <td class="nowrap">${dateTime(o.createdAt)}</td><td class="num mono">${money(o.total)}</td><td>${statusTag(ORDER_STATUS, o.status)}</td></tr>`).join('')}
      </tbody></table></div></section>
      ${notice('Lista com os pedidos importados mais recentes. Importações automáticas por webhook estão no roteiro (docs/ROADMAP.md).', 'info')}`;
  },

  async open(ctx, id) {
    const order = ctx.data?.orders?.find(o => o.id === id);
    if (!order) return;
    openDrawer({
      eyebrow: statusTag(ORDER_STATUS, order.status),
      title: `Pedido #${order.number}`,
      body: `<dl class="facts">
        <div><dt>Cliente</dt><dd>${esc(order.customer || '—')}</dd></div>
        <div><dt>E-mail</dt><dd>${esc(order.email || '—')}</dd></div>
        <div><dt>Data</dt><dd>${dateTime(order.createdAt)}</dd></div>
        <div><dt>Total</dt><dd class="mono">${money(order.total)}</dd></div>
        <div><dt>Pagamento</dt><dd>${esc(order.paymentStatus || '—')}</dd></div>
        <div><dt>Envio</dt><dd>${esc(order.shippingStatus || '—')}</dd></div>
      </dl>
      <section class="section"><h3>Itens</h3><div class="table-wrap"><table class="table compact"><thead><tr><th scope="col">Produto</th><th scope="col" class="num">Qtd.</th><th scope="col" class="num">Preço</th></tr></thead>
      <tbody>${order.items.map(i => `<tr><td>${esc(i.name)}<span class="mono sub">${esc(i.sku || '')}</span></td><td class="num mono">${num(i.quantity)}</td><td class="num mono">${money(i.price)}</td></tr>`).join('')}</tbody></table></div></section>`
    });
  },

  actions: {
    open(ctx, el) { ctx.navigate(`pedidos/${el.dataset.id}`); },
    async sync(ctx) {
      const result = await post('/orders/sync');
      toast(`${num(result.count)} pedidos importados.`);
      await ctx.refresh();
    }
  }
};
