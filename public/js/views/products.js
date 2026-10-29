// Produtos e estoque: espelho do UniPlus. O dono escolhe aqui o que vai à venda e por quanto em cada canal.
import { get, post } from '../api.js';
import { esc, icon, tag, money, num, relative, pageHead, empty, notice, button, field, openDrawer, openModal, closeLayers, toast, statusTag } from '../ui.js';
import { QUEUE_STAGES, PRIORITIES, canApprove } from '../../shared/domain.js';
import { pricingEditor, readPricing, pricingInputs, pricingChanges } from './pricing.js';

const FILTERS = [
  ['', 'Todos'],
  ['not_selected', 'Ainda não estão à venda'],
  ['in_queue', 'Na fila / publicados'],
  ['in_stock', 'Com estoque'],
  ['stockout', 'Sem estoque'],
  ['missing', 'Sumiram do UniPlus']
];

let searchTimer;
const canSell = user => user.role === 'owner' || (user.role === 'manager' && canApprove(user));
const seesCost = user => ['owner', 'manager'].includes(user.role);

const view = {
  id: 'produtos',
  title: 'Produtos e estoque',
  icon: 'box',
  group: 'Operação',

  async load({ state }) {
    state.page ??= 1;
    const [catalog, { integrations }] = await Promise.all([
      get('/products', { search: state.search, filter: state.filter, category: state.category, page: state.page, pageSize: 30 }),
      get('/integrations')
    ]);
    return { catalog, uniplus: integrations.find(i => i.id === 'uniplus') };
  },

  render({ user, state, data }) {
    const { catalog, uniplus } = data;
    const showCost = seesCost(user) && catalog.data.some(p => p.cost !== null && p.cost !== undefined);
    const statusLine = uniplus.status === 'error'
      ? notice(`<strong>O UniPlus não respondeu na última tentativa.</strong> ${esc(uniplus.lastError)}. Os dados abaixo são da última sincronização bem-sucedida.`, 'danger')
      : '';
    const eyebrow = catalog.lastSyncAt ? `Sincronizado com o UniPlus ${esc(relative(catalog.lastSyncAt))}` : 'Aguardando a primeira sincronização';
    const actions = ['owner', 'manager'].includes(user.role) && !uniplus.missingEnv?.length
      ? button('Sincronizar agora', { action: 'sync', icon: 'sync' }) : '';
    const lead = canSell(user)
      ? 'Estoque e preço vêm do UniPlus. Clique em “Colocar à venda” para escolher os canais e ver quanto sobra depois das taxas.'
      : 'Estoque e preço vêm do UniPlus. Abra um produto para pedir promoção ou arte.';

    if (!catalog.total) {
      return `${pageHead({ eyebrow, title: 'Produtos e estoque', lead, actions })}
      ${statusLine}
      <section class="panel">${empty({
        title: 'Nenhum produto sincronizado ainda',
        text: uniplus.missingEnv?.length
          ? 'Configure UNIPLUS_API_URL no servidor da loja (arquivo .env) e reinicie o portal. A sincronização começa sozinha.'
          : 'A sincronização com o UniPlus ainda não trouxe produtos. Use “Sincronizar agora” ou verifique se o UniPlus está aberto.',
        action: `<a class="btn" href="#/integracoes">${icon('link')}<span>Ver integrações</span></a>`,
        ic: 'box'
      })}</section>`;
    }

    return `${pageHead({ eyebrow, title: 'Produtos e estoque', lead, actions })}
    ${statusLine}
    <div class="stat-strip">
      <span><strong>${num(catalog.total)}</strong> produtos</span>
      <span><strong>${num(catalog.summary.inQueue)}</strong> à venda ou na fila</span>
      <span><strong>${num(catalog.summary.stockout)}</strong> sem estoque</span>
      ${catalog.summary.missing ? `<span class="is-warn"><strong>${num(catalog.summary.missing)}</strong> sumiram do UniPlus</span>` : ''}
    </div>

    <div class="toolbar" role="search">
      <label class="search">${icon('search')}<span class="sr-only">Buscar produto</span>
        <input type="search" data-input="search" value="${esc(state.search || '')}" placeholder="Nome, SKU ou categoria" autocomplete="off"></label>
      <label class="select-inline"><span class="sr-only">Situação</span><select data-change="filter">${FILTERS.map(([v, l]) => `<option value="${v}"${(state.filter || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="select-inline"><span class="sr-only">Categoria</span><select data-change="category"><option value="">Todas as categorias</option>${catalog.categories.map(c => `<option${state.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    </div>

    <section class="panel flush">
      ${catalog.data.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Produto</th><th scope="col">Categoria</th>${showCost ? '<th scope="col" class="num">Custo</th>' : ''}<th scope="col" class="num">Preço UniPlus</th><th scope="col" class="num">Estoque</th><th scope="col">À venda</th></tr></thead>
        <tbody>${catalog.data.map(p => `
          <tr class="row-link${p.missingFromUniplus ? ' is-muted' : ''}" data-action="open" data-id="${esc(p.id)}" tabindex="0">
            <td><strong>${esc(p.name)}</strong><span class="mono sub">SKU ${esc(p.sku || '—')}</span></td>
            <td>${esc(p.category)}</td>
            ${showCost ? `<td class="num mono">${p.cost ? money(p.cost) : '—'}</td>` : ''}
            <td class="num mono">${money(p.basePrice)}</td>
            <td class="num mono ${p.stock <= 0 ? 'is-danger' : ''}">${num(p.stock)}${p.unit ? ' ' + esc(p.unit) : ''}</td>
            <td>${p.missingFromUniplus ? tag('Fora do UniPlus', 'danger')
              : p.queue ? statusTag(QUEUE_STAGES, p.queue.stage)
              : canSell(user) ? `<button type="button" class="btn small" data-action="sell" data-id="${esc(p.id)}">${icon('tag')}<span>Colocar à venda</span></button>`
              : '<span class="muted">—</span>'}</td>
          </tr>`).join('')}</tbody></table></div>
        <nav class="pager" aria-label="Paginação">
          <span>${num((catalog.page - 1) * catalog.pageSize + 1)}–${num(Math.min(catalog.page * catalog.pageSize, catalog.filteredTotal))} de ${num(catalog.filteredTotal)}</span>
          ${button('Anterior', { action: 'page', data: { page: catalog.page - 1 }, disabled: catalog.page <= 1, variant: 'ghost', icon: 'back' })}
          <span class="mono">${catalog.page}/${catalog.totalPages}</span>
          ${button('Próxima', { action: 'page', data: { page: catalog.page + 1 }, disabled: catalog.page >= catalog.totalPages, variant: 'ghost', icon: 'arrow' })}
        </nav>`
        : empty({ title: 'Nenhum produto com esses filtros', text: 'Ajuste a busca ou limpe os filtros.', action: button('Limpar filtros', { action: 'clear' }), ic: 'search' })}
    </section>`;
  },

  async open(ctx, id) {
    const { product } = await get(`/products/${encodeURIComponent(id)}`);
    const row = ctx.data?.catalog?.data.find(p => p.id === id);
    const queue = row?.queue || null;
    const body = `<dl class="facts">
      <div><dt>SKU</dt><dd class="mono">${esc(product.sku || '—')}</dd></div>
      <div><dt>Categoria</dt><dd>${esc(product.category)}</dd></div>
      <div><dt>Preço no UniPlus</dt><dd class="mono">${money(product.basePrice)}</dd></div>
      ${product.cost ? `<div><dt>Custo</dt><dd class="mono">${money(product.cost)}</dd></div>` : ''}
      <div><dt>Estoque</dt><dd class="mono">${num(product.stock)} ${esc(product.unit || '')}</dd></div>
      <div><dt>Sincronizado</dt><dd>${esc(relative(product.syncedAt))}</dd></div>
    </dl>
    ${product.missingFromUniplus ? notice('Este produto não veio na última sincronização do UniPlus. Confirme no ERP antes de vender.', 'warn') : ''}
    ${queue ? `<div class="callout">${statusTag(QUEUE_STAGES, queue.stage)}<p>Este produto já está na fila de venda.</p><a class="btn" href="#/fila/${esc(queue.id)}">${icon('queue')}<span>Abrir na fila</span></a></div>` : ''}
    <section class="section"><h3>O que fazer com este produto</h3>
      <ul class="choice-list">
        ${!queue && canSell(ctx.user) ? `<li><button type="button" class="choice" data-action="sell" data-id="${esc(product.id)}">${icon('tag')}<span><strong>Colocar à venda</strong><small>Escolher canais (site, Shopee, Mercado Livre) e ver o valor líquido de cada um.</small></span></button></li>` : ''}
        ${['owner', 'manager'].includes(ctx.user.role) ? `<li><button type="button" class="choice" data-action="request-promo" data-id="${esc(product.id)}">${icon('money')}<span><strong>Pedir promoção</strong><small>Preço promocional, período e, se quiser, a arte para divulgar.</small></span></button></li>` : ''}
        <li><button type="button" class="choice" data-action="request-art" data-id="${esc(product.id)}">${icon('art')}<span><strong>Pedir arte</strong><small>O marketing recebe o pedido com o briefing.</small></span></button></li>
      </ul>
    </section>`;
    openDrawer({ eyebrow: 'Produto do UniPlus', title: product.name, body });
  },

  inputs: {
    ...pricingInputs,
    search(ctx, el) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { ctx.state.search = el.value; ctx.state.page = 1; ctx.refresh(); }, 300);
    }
  },

  changes: {
    ...pricingChanges,
    filter(ctx, el) { ctx.state.filter = el.value; ctx.state.page = 1; return ctx.refresh(); },
    category(ctx, el) { ctx.state.category = el.value; ctx.state.page = 1; return ctx.refresh(); }
  },

  actions: {
    open(ctx, el) { ctx.navigate(`produtos/${el.dataset.id}`); },
    page(ctx, el) { ctx.state.page = Number(el.dataset.page); return ctx.refresh({ scrollTop: true }); },
    clear(ctx) { Object.assign(ctx.state, { search: '', filter: '', category: '', page: 1 }); return ctx.refresh(); },
    async sync(ctx) {
      toast('Sincronizando com o UniPlus…', 'info');
      const result = await post('/products/sync');
      toast(result.skipped ? 'Uma sincronização já estava em andamento.' : `${num(result.received)} produtos sincronizados.`);
      await ctx.refresh();
    },
    sell(ctx, el) { return openSellForm(ctx, el.dataset.id); },
    'request-art'(ctx, el) {
      sessionStorage.setItem('sr-art-origin', JSON.stringify({ originType: 'product', originId: el.dataset.id }));
      closeLayers({ restoreFocus: false });
      ctx.navigate('artes?nova=1');
    },
    'request-promo'(ctx, el) {
      sessionStorage.setItem('sr-promo-product', el.dataset.id);
      closeLayers({ restoreFocus: false });
      ctx.navigate('promocoes?nova=1');
    }
  },

  forms: {
    async sell(ctx, data, form) {
      const { item } = await post('/queue', { ...data, ...readPricing(form) });
      toast(`${item.productSnapshot.name} entrou na fila de venda (${item.channels.map(c => c.name).join(', ')}).`);
      closeLayers({ restoreFocus: false });
      if (ctx.route.id) ctx.navigate('produtos', { replace: true });
      await ctx.refresh();
      ctx.refreshBadges();
    }
  }
};
export default view;

// Pop-up "Colocar à venda": canais, preço em cada um, taxa e líquido calculados na hora.
async function openSellForm(ctx, productId) {
  const [{ product }, channels, campaigns] = await Promise.all([
    get(`/products/${encodeURIComponent(productId)}`), ctx.lookup('channels'), ctx.lookup('campaigns').catch(() => [])
  ]);
  openModal({
    title: `Colocar à venda · ${product.name}`,
    size: 'wide',
    body: `<form data-form="sell" id="sellForm" class="form-grid">
      <input type="hidden" name="productId" value="${esc(product.id)}">
      <div class="full">${pricingEditor({ channels, product, showCost: seesCost(ctx.user) })}</div>
      ${field('priority', 'Prioridade', { type: 'select', options: PRIORITIES, value: 'Normal' })}
      ${field('campaignId', 'Campanha associada', { type: 'select', options: [['', 'Nenhuma'], ...campaigns.filter(c => !['cancelled', 'done'].includes(c.status)).map(c => [c.id, c.name])] })}
      ${field('notes', 'Observação para quem prepara o anúncio', { type: 'textarea', full: true, rows: 2, max: 2000, placeholder: 'Ex.: destacar que acompanha brinde; usar foto da embalagem nova.' })}
      <p class="full hint">Taxas configuradas em <a href="#/canais">Canais e taxas</a>. O produto vai para a fila: o site prepara foto e descrição, você aprova e então ele é publicado em cada canal.</p>
      <div class="form-error full" aria-live="polite"></div>
    </form>`,
    footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button class="btn primary" type="submit" form="sellForm">${icon('send')}<span>Enviar para a fila de venda</span></button>`
  });
}
