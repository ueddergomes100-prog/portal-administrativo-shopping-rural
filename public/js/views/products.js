// Produtos e estoque: espelho do UniPlus. O dono escolhe aqui o que vai à venda e por quanto em cada canal.
import { get, post } from '../api.js';
import { esc, icon, tag, money, num, relative, pageHead, empty, notice, button, field, openDrawer, openModal, closeLayers, toast, statusTag } from '../ui.js';
import { QUEUE_STAGES, PRIORITIES, isPreparer, canApprove } from '../../shared/domain.js';
import { pricingEditor, readPricing, pricingInputs, pricingChanges } from './pricing.js';

const FILTERS = [
  ['', 'Todos'],
  ['not_selected', 'Ainda não estão à venda'],
  ['in_queue', 'Já escolhidos para vender'],
  ['in_stock', 'Com estoque'],
  ['stockout', 'Sem estoque'],
  ['missing', 'Saíram do sistema da loja']
];

let searchTimer;
const canSell = user => user.role === 'owner' || (user.role === 'manager' && canApprove(user));
const seesCost = user => ['owner', 'manager'].includes(user.role);
// Marcar vários produtos. Pode marcar: produto novo (quem escolhe o que vender) ou já escolhido e ainda
// em preparação (quem prepara). Quem prepara vai para o cadastro em grade (#/cadastro?ids=…).
// Com "Cada um faz a sua parte" ligado, o dono não prepara: os marcados vão para a pessoa de Vendas na
// internet pelo botão "Mandar preparar" (POST /api/queue/bulk-select).
const PICK_MAX = 30;
const canPick = (user, workflow, p) => !p.missingFromUniplus && (p.queue
  ? ['selected', 'preparing'].includes(p.queue.stage) && isPreparer(user, workflow)
  : canSell(user));
const sendsToTeam = (user, workflow) => canSell(user) && !isPreparer(user, workflow);

const view = {
  id: 'produtos',
  title: 'Produtos',
  icon: 'box',

  async load({ state }) {
    state.page ??= 1;
    const [catalog, { integrations }] = await Promise.all([
      get('/products', { search: state.search, filter: state.filter, category: state.category, page: state.page, pageSize: 30 }),
      get('/integrations')
    ]);
    return { catalog, uniplus: integrations.find(i => i.id === 'uniplus') };
  },

  render({ user, workflow, state, data }) {
    const { catalog, uniplus } = data;
    const toTeam = sendsToTeam(user, workflow);
    const showCost = seesCost(user) && catalog.data.some(p => p.cost !== null && p.cost !== undefined);
    const statusLine = uniplus.status === 'error'
      ? notice(`<strong>O sistema da loja (UniPlus) não respondeu na última tentativa.</strong> ${esc(uniplus.lastError)}. A lista abaixo é da última vez que deu certo.`, 'danger')
      : '';
    const eyebrow = catalog.lastSyncAt ? `Atualizado com o sistema da loja ${esc(relative(catalog.lastSyncAt))}` : 'Esperando a primeira atualização';
    const actions = ['owner', 'manager'].includes(user.role) && !uniplus.missingEnv?.length
      ? button('Atualizar agora', { action: 'sync', icon: 'sync' }) : '';
    const lead = canSell(user)
      ? 'Estoque e preço vêm do sistema da loja. Toque em “Colocar à venda” para escolher onde vender e ver quanto sobra depois das taxas.'
      : 'Estoque e preço vêm do sistema da loja. Abra um produto para pedir promoção ou arte.';

    if (!catalog.total) {
      return `${pageHead({ eyebrow, title: 'Produtos', lead, actions })}
      ${statusLine}
      <section class="panel">${empty({
        title: 'Nenhum produto chegou ainda',
        text: uniplus.missingEnv?.length
          ? 'O portal ainda não foi ligado ao sistema da loja. Quem instalou o portal precisa fazer essa ligação.'
          : 'O sistema da loja ainda não mandou os produtos. Toque em “Atualizar agora” ou confira se o UniPlus está aberto no computador da loja.',
        action: `<a class="btn" href="#/integracoes">${icon('link')}<span>Ver conexões</span></a>`,
        ic: 'box'
      })}</section>`;
    }

    // Marcados que já foram enviados (não estão mais em preparação) saem da marcação sozinhos.
    const sentHere = new Set(catalog.data.filter(p => !canPick(user, workflow, p)).map(p => p.id));
    state.picked = (state.picked || []).filter(id => !sentHere.has(id));
    const picked = new Set(state.picked);
    const pickable = catalog.data.filter(p => canPick(user, workflow, p));
    const pickBar = `<div data-pick-slot>${pickBarHtml(picked, toTeam)}</div>`;
    const pickHint = toTeam
      ? 'Para mandar vários de uma vez para a pessoa de Vendas na internet preparar, marque os produtos e toque em <strong>Mandar preparar</strong>.'
      : 'Para cadastrar vários de uma vez, marque os produtos e toque em <strong>Cadastrar em grade</strong>.';
    const pickTitle = toTeam ? 'Marcar para mandar preparar' : 'Marcar para o cadastro em grade';

    return `${pageHead({ eyebrow, title: 'Produtos', lead, actions })}
    ${statusLine}
    ${pickable.length ? `<p class="pick-hint">${icon('check')}<span>${pickHint}</span>
      ${button('Marcar todos desta página', { action: 'pick-page', variant: 'ghost small' })}</p>` : ''}
    <div class="stat-strip">
      <span><strong>${num(catalog.total)}</strong> produtos</span>
      <span><strong>${num(catalog.summary.inQueue)}</strong> à venda ou a caminho</span>
      <span><strong>${num(catalog.summary.stockout)}</strong> sem estoque</span>
      ${catalog.summary.missing ? `<span class="is-warn"><strong>${num(catalog.summary.missing)}</strong> saíram do sistema da loja</span>` : ''}
    </div>

    <div class="toolbar" role="search">
      <label class="search">${icon('search')}<span class="sr-only">Buscar produto</span>
        <input type="search" data-input="search" value="${esc(state.search || '')}" placeholder="Nome, código ou categoria (ex.: Ração+Quatree+20kg)" autocomplete="off"></label>
      <label class="select-inline"><span class="sr-only">Situação</span><select data-change="filter">${FILTERS.map(([v, l]) => `<option value="${v}"${(state.filter || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="select-inline"><span class="sr-only">Categoria</span><select data-change="category"><option value="">Todas as categorias</option>${catalog.categories.map(c => `<option${state.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    </div>

    <section class="panel flush">
      ${catalog.data.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Produto</th><th scope="col">Categoria</th>${showCost ? '<th scope="col" class="num">Custo</th>' : ''}<th scope="col" class="num">Preço</th><th scope="col" class="num">Estoque</th><th scope="col">À venda</th></tr></thead>
        <tbody>${catalog.data.map(p => `
          <tr class="row-link${p.missingFromUniplus ? ' is-muted' : ''}" data-action="open" data-id="${esc(p.id)}" tabindex="0">
            <td>${canPick(user, workflow, p) ? `<label class="pick" data-action="pick-label" title="${pickTitle}"><input type="checkbox" data-change="pick" data-id="${esc(p.id)}"${picked.has(p.id) ? ' checked' : ''}><span class="sr-only">Marcar ${esc(p.name)}</span></label>` : ''}<strong>${esc(p.name)}</strong><span class="mono sub">código ${esc(p.sku || '—')}</span></td>
            <td>${esc(p.category)}</td>
            ${showCost ? `<td class="num mono">${p.cost ? money(p.cost) : '—'}</td>` : ''}
            <td class="num mono">${money(p.basePrice)}</td>
            <td class="num mono ${p.stock <= 0 ? 'is-danger' : ''}">${num(p.stock)}${p.unit ? ' ' + esc(p.unit) : ''}</td>
            <td>${p.missingFromUniplus ? tag('Saiu do sistema', 'danger')
              : p.queue ? statusTag(QUEUE_STAGES, p.queue.stage)
              : canSell(user) ? `<button type="button" class="btn small" data-action="sell" data-id="${esc(p.id)}">${icon('tag')}<span>Colocar à venda</span></button>`
              : '<span class="muted">—</span>'}</td>
          </tr>`).join('')}</tbody></table></div>
        <nav class="pager" aria-label="Páginas">
          <span>${num((catalog.page - 1) * catalog.pageSize + 1)}–${num(Math.min(catalog.page * catalog.pageSize, catalog.filteredTotal))} de ${num(catalog.filteredTotal)}</span>
          ${button('Anterior', { action: 'page', data: { page: catalog.page - 1 }, disabled: catalog.page <= 1, variant: 'ghost', icon: 'back' })}
          <span class="mono">${catalog.page}/${catalog.totalPages}</span>
          ${button('Próxima', { action: 'page', data: { page: catalog.page + 1 }, disabled: catalog.page >= catalog.totalPages, variant: 'ghost', icon: 'arrow' })}
        </nav>`
        : empty({ title: 'Nenhum produto com essa busca', text: 'Mude a busca ou limpe os filtros para ver todos.', action: button('Limpar filtros', { action: 'clear' }), ic: 'search' })}
    </section>
    ${pickBar}`;
  },

  async open(ctx, id) {
    const { product } = await get(`/products/${encodeURIComponent(id)}`);
    const row = ctx.data?.catalog?.data.find(p => p.id === id);
    const queue = row?.queue || null;
    const packages = Array.isArray(product.packages) ? product.packages : [];
    const body = `<dl class="facts">
      <div><dt>Código</dt><dd class="mono">${esc(product.sku || '—')}</dd></div>
      <div><dt>Categoria</dt><dd>${esc(product.category)}</dd></div>
      <div><dt>Preço na loja</dt><dd class="mono">${money(product.basePrice)}</dd></div>
      ${product.cost ? `<div><dt>Custo</dt><dd class="mono">${money(product.cost)}</dd></div>` : ''}
      <div><dt>Estoque</dt><dd class="mono">${num(product.stock)} ${esc(product.unit || '')}</dd></div>
      <div><dt>Atualizado</dt><dd>${esc(relative(product.syncedAt))}</dd></div>
    </dl>
    ${packages.length ? `<section class="section"><h3>Outras formas de venda no sistema da loja</h3>
      <p class="hint">O estoque da caixa é calculado pelas unidades disponíveis no UniPlus.</p>
      <ul class="plain-list">${packages.map(pack => `<li><strong>${esc(pack.description || pack.unit || 'Embalagem')}</strong><span class="mono sub">${esc(pack.unit || '')}${pack.factor ? ` · ${num(pack.factor)} unidade${Number(pack.factor) === 1 ? '' : 's'}` : ''} · ${money(pack.price)} · estoque ${num(pack.stock)}</span></li>`).join('')}</ul>
    </section>` : ''}
    ${product.missingFromUniplus ? notice('Este produto não veio na última atualização do sistema da loja. Confira no UniPlus antes de vender.', 'warn') : ''}
    ${queue ? `<div class="callout">${statusTag(QUEUE_STAGES, queue.stage)}<p>Este produto já está em Anúncios.</p><a class="btn" href="#/fila/${esc(queue.id)}">${icon('queue')}<span>Abrir em Anúncios</span></a></div>` : ''}
    <section class="section"><h3>O que fazer com este produto</h3>
      <ul class="choice-list">
        ${!queue && canSell(ctx.user) ? `<li><button type="button" class="choice" data-action="sell" data-id="${esc(product.id)}">${icon('tag')}<span><strong>Colocar à venda</strong><small>Escolher onde vender (site, Shopee, Mercado Livre) e ver quanto sobra em cada um.</small></span></button></li>` : ''}
        ${['owner', 'manager'].includes(ctx.user.role) ? `<li><button type="button" class="choice" data-action="request-promo" data-id="${esc(product.id)}">${icon('money')}<span><strong>Pedir promoção</strong><small>Um preço mais baixo por um período e, se quiser, uma arte para divulgar.</small></span></button></li>` : ''}
        <li><button type="button" class="choice" data-action="request-art" data-id="${esc(product.id)}">${icon('art')}<span><strong>Pedir arte</strong><small>O marketing recebe o pedido e faz a arte.</small></span></button></li>
      </ul>
    </section>`;
    openDrawer({ eyebrow: 'Produto do sistema da loja', title: product.name, body });
  },

  inputs: {
    ...pricingInputs,
    search(ctx, el) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        ctx.state.search = el.value;
        ctx.state.page = 1;
        ctx.refresh({ preserveFocus: el });
      }, 300);
    }
  },

  changes: {
    ...pricingChanges,
    filter(ctx, el) { ctx.state.filter = el.value; ctx.state.page = 1; return ctx.refresh(); },
    pick(ctx, el) {
      const picked = new Set(ctx.state.picked);
      if (el.checked && picked.size >= PICK_MAX) {
        el.checked = false;
        return toast(`Dá para cadastrar até ${PICK_MAX} produtos de cada vez.`, 'warn');
      }
      if (el.checked) picked.add(el.dataset.id); else picked.delete(el.dataset.id);
      ctx.state.picked = [...picked];
      // Só a barra de baixo muda: a caixinha já está marcada e o resto da tela fica parado.
      const slot = document.querySelector('[data-pick-slot]');
      if (slot) slot.innerHTML = pickBarHtml(picked, sendsToTeam(ctx.user, ctx.workflow));
    },
    category(ctx, el) { ctx.state.category = el.value; ctx.state.page = 1; return ctx.refresh(); }
  },

  actions: {
    open(ctx, el) { ctx.navigate(`produtos/${el.dataset.id}`); },
    page(ctx, el) { ctx.state.page = Number(el.dataset.page); return ctx.refresh({ scrollTop: true }); },
    clear(ctx) { Object.assign(ctx.state, { search: '', filter: '', category: '', page: 1 }); return ctx.refresh(); },
    'pick-clear'(ctx) { ctx.state.picked = []; ctx.rerender(); },
    'pick-page'(ctx) {
      const picked = new Set(ctx.state.picked);
      for (const p of ctx.data.catalog.data) if (canPick(ctx.user, ctx.workflow, p) && picked.size < PICK_MAX) picked.add(p.id);
      ctx.state.picked = [...picked];
      ctx.rerender();
    },
    async sync(ctx) {
      toast('Buscando os produtos no sistema da loja…', 'info');
      const result = await post('/products/sync');
      toast(result.skipped ? 'Já tem uma atualização em andamento. Espere um pouco.' : `${num(result.received)} produtos atualizados.`);
      await ctx.refresh();
    },
    sell(ctx, el) { return openSellForm(ctx, el.dataset.id); },
    'send-picked'(ctx) { return openSendForm(ctx); },
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
      toast(`${item.productSnapshot.name} foi para Anúncios (${item.channels.map(c => c.name).join(', ')}).`);
      closeLayers({ restoreFocus: false });
      if (ctx.route.id) ctx.navigate('produtos', { replace: true });
      await ctx.refresh();
      ctx.refreshBadges();
    },
    async 'send-picked'(ctx, data) {
      const channels = [].concat(data.channels || []);
      if (!channels.length) throw new Error('Escolha pelo menos um lugar para vender.');
      const { results } = await post('/queue/bulk-select', {
        productIds: ctx.state.picked || [], channels, priority: data.priority, campaignId: data.campaignId, notes: data.notes
      });
      const sent = results.filter(r => r.ok);
      const failed = results.filter(r => !r.ok);
      closeLayers({ restoreFocus: false });
      // Os que não foram continuam marcados para tentar de novo.
      ctx.state.picked = failed.map(r => r.productId);
      if (sent.length) toast(`${sent.length === 1 ? '1 produto foi' : `${num(sent.length)} produtos foram`} para Anúncios. A pessoa de Vendas na internet já pode preparar.`);
      if (failed.length) toast(`${failed.length === 1 ? '1 produto não foi' : `${num(failed.length)} produtos não foram`}: ${failed.map(r => r.error).join(' ')}`, 'danger');
      await ctx.refresh();
      ctx.refreshBadges();
    }
  }
};
export default view;

// Barra de baixo com os marcados: "Cadastrar em grade" (quem prepara) ou "Mandar preparar" (dono, com
// "Cada um faz a sua parte" ligado).
function pickBarHtml(picked, toTeam) {
  if (!picked.size) return '';
  const go = toTeam
    ? button(`Mandar preparar (${num(picked.size)})`, { action: 'send-picked', icon: 'send', variant: 'primary' })
    : `<a class="btn primary" href="#/cadastro?ids=${[...picked].map(encodeURIComponent).join(',')}">${icon('image')}<span>Cadastrar em grade</span></a>`;
  return `<div class="pick-bar" role="region" aria-label="Produtos marcados">
    <span><strong>${num(picked.size)}</strong> ${picked.size === 1 ? 'produto marcado' : 'produtos marcados'}</span>
    ${button('Desmarcar', { action: 'pick-clear', variant: 'ghost' })}
    ${go}
  </div>`;
}

// Pop-up "Mandar preparar": onde vender os marcados, prioridade, campanha e recado. Cada produto entra em
// Anúncios com o preço da loja em cada lugar; o dono muda o preço depois na ficha, se quiser.
async function openSendForm(ctx) {
  const count = (ctx.state.picked || []).length;
  if (!count) return;
  const [channels, campaigns] = await Promise.all([ctx.lookup('channels'), ctx.lookup('campaigns').catch(() => [])]);
  const active = channels.filter(c => c.active !== false);
  const names = (ctx.data?.catalog?.data || []).filter(p => ctx.state.picked.includes(p.id)).map(p => p.name);
  openModal({
    title: `Mandar preparar ${count === 1 ? '1 produto' : `${num(count)} produtos`}`,
    body: `<form data-form="send-picked" id="sendPickedForm" class="form-grid">
      ${names.length ? `<p class="full hint">${esc(names.slice(0, 6).join(', '))}${count > 6 ? ` e mais ${num(count - 6)}` : ''}.</p>` : ''}
      ${field('channels', 'Onde vender', { type: 'checkboxes', full: true, options: active.map(c => [c.id, c.name]), value: active.map(c => c.id), hint: 'Cada produto começa com o preço da loja em cada lugar. Para mudar o preço de um deles, abra o produto em Anúncios.' })}
      ${field('priority', 'Prioridade', { type: 'select', options: PRIORITIES, value: 'Normal' })}
      ${field('campaignId', 'Faz parte de uma campanha?', { type: 'select', options: [['', 'Não'], ...campaigns.filter(c => !['cancelled', 'done'].includes(c.status)).map(c => [c.id, c.name])] })}
      ${field('notes', 'Recado para quem prepara os anúncios', { type: 'textarea', full: true, rows: 2, max: 2000, placeholder: 'Ex.: usar fotos com fundo branco; destacar que é a embalagem nova.' })}
      <p class="full hint">A pessoa de Vendas na internet prepara fotos e texto e manda para você aprovar. Depois de aprovado, ela coloca à venda.</p>
      <div class="form-error full" aria-live="polite"></div>
    </form>`,
    footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button class="btn primary" type="submit" form="sendPickedForm">${icon('send')}<span>Mandar preparar</span></button>`
  });
}

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
      <div class="full">${pricingEditor({ channels, product, showCost: seesCost(ctx.user), unit: { price: product.basePrice, cost: product.cost, stock: product.stock, unit: product.unit }, packages: product.packages || [] })}</div>
      ${field('priority', 'Prioridade', { type: 'select', options: PRIORITIES, value: 'Normal' })}
      ${field('campaignId', 'Faz parte de uma campanha?', { type: 'select', options: [['', 'Não'], ...campaigns.filter(c => !['cancelled', 'done'].includes(c.status)).map(c => [c.id, c.name])] })}
      ${field('notes', 'Recado para quem prepara o anúncio', { type: 'textarea', full: true, rows: 2, max: 2000, placeholder: 'Ex.: avisar que vem com brinde; usar a foto da embalagem nova.' })}
      <p class="full hint">As taxas ficam em <a href="#/canais">Taxas de venda</a>. Depois de mandar, a pessoa das vendas na internet prepara fotos e texto, você aprova e o produto é colocado à venda.</p>
      <div class="form-error full" aria-live="polite"></div>
    </form>`,
    footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button class="btn primary" type="submit" form="sellForm">${icon('send')}<span>Mandar preparar o anúncio</span></button>`
  });
}
