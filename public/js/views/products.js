// Produtos e estoque: espelho do UniPlus. O dono escolhe aqui o que vai para o site.
import { get, post } from '../api.js';
import { esc, icon, tag, money, num, relative, pageHead, empty, notice, button, field, openDrawer, closeLayers, toast, statusTag } from '../ui.js';
import { QUEUE_STAGES, PRIORITIES, canApprove } from '../../shared/domain.js';

const FILTERS = [
  ['', 'Todos'],
  ['not_selected', 'Ainda fora do site'],
  ['in_queue', 'Na fila / publicados'],
  ['in_stock', 'Com estoque'],
  ['stockout', 'Sem estoque'],
  ['missing', 'Sumiram do UniPlus']
];

let searchTimer;
const canSelect = user => user.role === 'owner' || (user.role === 'manager' && canApprove(user));

async function loadIntegration() {
  const { integrations } = await get('/integrations');
  return integrations.find(i => i.id === 'uniplus');
}

export default {
  id: 'produtos',
  title: 'Produtos e estoque',
  icon: 'box',
  group: 'Operação',

  async load({ state }) {
    state.page ??= 1;
    const [catalog, uniplus] = await Promise.all([
      get('/products', { search: state.search, filter: state.filter, category: state.category, page: state.page, pageSize: 30 }),
      loadIntegration()
    ]);
    return { catalog, uniplus };
  },

  render({ user, state, data }) {
    const { catalog, uniplus } = data;
    const statusLine = uniplus.status === 'error'
      ? notice(`<strong>O UniPlus não respondeu na última tentativa.</strong> ${esc(uniplus.lastError)}. Os dados abaixo são da última sincronização bem-sucedida.`, 'danger')
      : '';
    const eyebrow = catalog.lastSyncAt ? `Sincronizado com o UniPlus ${esc(relative(catalog.lastSyncAt))}` : 'Aguardando a primeira sincronização';
    const actions = ['owner', 'manager'].includes(user.role) && !uniplus.missingEnv?.length
      ? button('Sincronizar agora', { action: 'sync', icon: 'sync' }) : '';

    if (!catalog.total) {
      return `${pageHead({ eyebrow, title: 'Produtos e estoque', lead: 'Catálogo, SKU, estoque e preço-base vêm do UniPlus. O portal não altera esses dados.', actions })}
      ${statusLine}
      <section class="panel">${empty({
        title: 'Nenhum produto sincronizado ainda',
        text: uniplus.missingEnv?.length
          ? 'Configure UNIPLUS_API_URL no servidor da loja (arquivo .env) e reinicie o portal. A sincronização começa sozinha.'
          : 'A sincronização com o UniPlus ainda não trouxe produtos. Use "Sincronizar agora" ou verifique se o UniPlus está aberto.',
        action: `<a class="btn" href="#/integracoes">${icon('link')}<span>Ver integrações</span></a>`,
        ic: 'box'
      })}</section>`;
    }

    return `${pageHead({ eyebrow, title: 'Produtos e estoque', lead: 'Catálogo, SKU, estoque e preço-base vêm do UniPlus. Abra um produto para enviá-lo ao site.', actions })}
    ${statusLine}
    <div class="stat-strip">
      <span><strong>${num(catalog.total)}</strong> produtos</span>
      <span><strong>${num(catalog.summary.inQueue)}</strong> na fila ou publicados</span>
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
        <thead><tr><th scope="col">Produto</th><th scope="col">Categoria</th><th scope="col" class="num">Preço UniPlus</th><th scope="col" class="num">Estoque</th><th scope="col">No site</th></tr></thead>
        <tbody>${catalog.data.map(p => `
          <tr class="row-link${p.missingFromUniplus ? ' is-muted' : ''}" data-action="open" data-id="${esc(p.id)}" tabindex="0">
            <td><strong>${esc(p.name)}</strong><span class="mono sub">SKU ${esc(p.sku || '—')}</span></td>
            <td>${esc(p.category)}</td>
            <td class="num mono">${money(p.basePrice)}</td>
            <td class="num mono ${p.stock <= 0 ? 'is-danger' : ''}">${num(p.stock)}${p.unit ? ' ' + esc(p.unit) : ''}</td>
            <td>${p.missingFromUniplus ? tag('Fora do UniPlus', 'danger') : p.queue ? statusTag(QUEUE_STAGES, p.queue.stage) : '<span class="muted">—</span>'}</td>
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
    const campaigns = canSelect(ctx.user) ? await ctx.lookup('campaigns').catch(() => []) : [];
    const info = `<dl class="facts">
      <div><dt>SKU</dt><dd class="mono">${esc(product.sku || '—')}</dd></div>
      <div><dt>Categoria</dt><dd>${esc(product.category)}</dd></div>
      <div><dt>Preço-base (UniPlus)</dt><dd class="mono">${money(product.basePrice)}</dd></div>
      <div><dt>Estoque</dt><dd class="mono">${num(product.stock)} ${esc(product.unit || '')}</dd></div>
      <div><dt>Sincronizado</dt><dd>${esc(relative(product.syncedAt))}</dd></div>
    </dl>
    ${product.missingFromUniplus ? notice('Este produto não veio na última sincronização do UniPlus. Confirme no ERP antes de publicar.', 'warn') : ''}`;

    let body = info;
    let footer = '';
    if (queue) {
      body += `<div class="callout">${statusTag(QUEUE_STAGES, queue.stage)}<p>Este produto já está na fila de publicação.</p><a class="btn" href="#/fila/${esc(queue.id)}">${icon('queue')}<span>Abrir na fila</span></a></div>`;
    } else if (canSelect(ctx.user)) {
      body += `<form data-form="select" class="form-grid" id="selectForm">
        <input type="hidden" name="productId" value="${esc(product.id)}">
        <h3 class="full section-title">Enviar para o site</h3>
        <fieldset class="field full"><legend>Preço no site</legend>
          <div class="segmented">
            <label><input type="radio" name="priceMode" value="erp" checked data-change="priceMode"><span>Manter preço do UniPlus (${money(product.basePrice)})</span></label>
            <label><input type="radio" name="priceMode" value="custom" data-change="priceMode"><span>Definir preço do site</span></label>
          </div>
        </fieldset>
        <div class="full" data-custom-price hidden>${field('sitePrice', 'Preço do site (R$)', { type: 'number', min: 0, step: '0.01' })}</div>
        ${field('promoPrice', 'Preço promocional (R$)', { type: 'number', min: 0, step: '0.01', hint: 'Opcional. Precisa ser menor que o preço de venda.' })}
        ${field('priority', 'Prioridade', { type: 'select', options: PRIORITIES, value: 'Normal' })}
        ${field('promoStart', 'Promoção a partir de', { type: 'date' })}
        ${field('promoEnd', 'Promoção até', { type: 'date' })}
        ${field('campaignId', 'Campanha associada', { type: 'select', full: true, options: [['', 'Nenhuma'], ...campaigns.filter(c => !['cancelled', 'done'].includes(c.status)).map(c => [c.id, c.name])] })}
        ${field('notes', 'Observação para o site', { type: 'textarea', full: true, rows: 3, max: 2000, placeholder: 'Ex.: destacar que acompanha brinde; usar foto da embalagem nova.' })}
        <div class="form-error full" aria-live="polite"></div>
      </form>`;
      footer = `${button('Solicitar arte deste produto', { action: 'request-art', data: { id: product.id }, icon: 'art', variant: 'ghost' })}<button class="btn primary" type="submit" form="selectForm">${icon('send')}<span>Enviar para a fila do site</span></button>`;
    } else {
      body += notice('Somente o dono (ou gerente autorizado) envia produtos para o site.', 'info');
      if (['manager', 'marketing'].includes(ctx.user.role)) footer = button('Solicitar arte deste produto', { action: 'request-art', data: { id: product.id }, icon: 'art' });
    }
    openDrawer({ eyebrow: 'Produto do UniPlus', title: product.name, body, footer });
  },

  inputs: {
    search(ctx, el) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { ctx.state.search = el.value; ctx.state.page = 1; ctx.refresh(); }, 300);
    }
  },

  changes: {
    filter(ctx, el) { ctx.state.filter = el.value; ctx.state.page = 1; return ctx.refresh(); },
    category(ctx, el) { ctx.state.category = el.value; ctx.state.page = 1; return ctx.refresh(); },
    priceMode(ctx, el) {
      const box = el.closest('form').querySelector('[data-custom-price]');
      box.hidden = el.value !== 'custom';
      box.querySelector('input').required = el.value === 'custom';
    }
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
    'request-art'(ctx, el) {
      sessionStorage.setItem('sr-art-origin', JSON.stringify({ originType: 'product', originId: el.dataset.id }));
      closeLayers({ restoreFocus: false });
      ctx.navigate('artes?nova=1');
    }
  },

  forms: {
    async select(ctx, data) {
      const { item } = await post('/queue', data);
      toast(`${item.productSnapshot.name} entrou na fila do site.`);
      closeLayers({ restoreFocus: false });
      ctx.navigate('produtos', { replace: true });
      await ctx.refresh();
      ctx.refreshBadges();
    }
  }
};
