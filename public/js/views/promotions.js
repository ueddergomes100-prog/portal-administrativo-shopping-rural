// Promoções: preço normal (UniPlus) x preço promocional por produto, com período e aprovação.
import { get, post, patch, del } from '../api.js';
import { esc, icon, money, date, num, pageHead, empty, button, field, openDrawer, openModal, closeLayers, toast, confirmDialog, statusTag, tag } from '../ui.js';
import { PROMOTION_STATUS, ART_STATUS, promotionPhase, todayInSaoPaulo } from '../../shared/domain.js';
import { productPicker, pickerActions, pickerInputs, readPricedItems, transitionButtons, runTransition, notesSection } from './common.js';

const discount = item => (item.regularPrice ? Math.round((1 - item.promoPrice / item.regularPrice) * 100) : 0);
const phaseTag = p => {
  const phase = promotionPhase(p, todayInSaoPaulo());
  return phase ? tag(phase.label, phase.tone) : '';
};

const view = {
  id: 'promocoes',
  title: 'Promoções',
  icon: 'tag',
  group: 'Operação',

  async load({ state }) {
    return get('/promotions', { status: state.status });
  },

  render({ user, state, data }) {
    const canCreate = ['owner', 'manager'].includes(user.role);
    const records = data.records;
    const filter = `<div class="toolbar"><label class="select-inline"><span class="sr-only">Etapa</span><select data-change="status">
      <option value="">Todas as etapas</option>${Object.entries(PROMOTION_STATUS).map(([k, v]) => `<option value="${k}"${state.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label></div>`;
    const list = records.length ? `<section class="panel flush"><div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Promoção</th><th scope="col">Período</th><th scope="col" class="num">Produtos</th><th scope="col" class="num">Desconto</th><th scope="col">Etapa</th></tr></thead>
      <tbody>${records.map(p => {
        const ds = p.items.map(discount);
        const range = ds.length ? (Math.min(...ds) === Math.max(...ds) ? `${Math.min(...ds)}%` : `${Math.min(...ds)}–${Math.max(...ds)}%`) : '—';
        return `<tr class="row-link" data-action="open" data-id="${esc(p.id)}" tabindex="0">
          <td><strong>${esc(p.name)}</strong>${p.items[0] ? `<span class="sub">${esc(p.items[0].name)}${p.items.length > 1 ? ` e mais ${p.items.length - 1}` : ''}</span>` : ''}</td>
          <td class="nowrap">${date(p.start)} – ${date(p.end)}</td>
          <td class="num mono">${num(p.items.length)}</td>
          <td class="num mono">${range}</td>
          <td>${statusTag(PROMOTION_STATUS, p.status)} ${phaseTag(p)}</td></tr>`;
      }).join('')}</tbody></table></div></section>`
      : `<section class="panel">${empty({ title: 'Nenhuma promoção', text: 'Escolha produtos do catálogo e defina o preço promocional e o período.', action: canCreate ? button('Nova promoção', { action: 'new', icon: 'plus', variant: 'primary' }) : '', ic: 'tag' })}</section>`;
    return `${pageHead({ title: 'Promoções', lead: 'O preço normal vem do UniPlus. Alterar preço ou período de uma promoção aprovada exige nova aprovação.', actions: canCreate ? button('Nova promoção', { action: 'new', icon: 'plus', variant: 'primary' }) : '' })}${filter}${list}`;
  },

  async open(ctx, id) {
    const [{ record }, arts, campaigns] = await Promise.all([
      get(`/promotions/${encodeURIComponent(id)}`), get('/arts').then(r => r.records), ctx.lookup('campaigns').catch(() => [])
    ]);
    ctx.state.current = record;
    const campaign = campaigns.find(c => c.id === record.campaignId);
    const linkedArts = arts.filter(a => a.originType === 'promotion' && a.originId === id);
    const body = `
      <dl class="facts">
        <div><dt>Período</dt><dd>${date(record.start)} a ${date(record.end)}</dd></div>
        <div><dt>Situação</dt><dd>${statusTag(PROMOTION_STATUS, record.status)} ${phaseTag(record)}</dd></div>
        <div><dt>Campanha</dt><dd>${campaign ? `<a href="#/campanhas/${esc(campaign.id)}">${esc(campaign.name)}</a>` : '—'}</dd></div>
        <div><dt>Aprovada por</dt><dd>${esc(record.approvedBy?.name || '—')}</dd></div>
      </dl>
      ${record.description ? `<p class="prose">${esc(record.description)}</p>` : ''}
      <section class="section"><h3>Produtos</h3>
        <div class="table-wrap"><table class="table compact"><thead><tr><th scope="col">Produto</th><th scope="col" class="num">Normal</th><th scope="col" class="num">Promoção</th><th scope="col" class="num">Desc.</th></tr></thead>
        <tbody>${record.items.map(i => `<tr><td>${esc(i.name)}<span class="mono sub">${esc(i.sku)}</span></td><td class="num mono">${money(i.regularPrice)}</td><td class="num mono"><strong>${money(i.promoPrice)}</strong></td><td class="num mono">${discount(i)}%</td></tr>`).join('')}</tbody></table></div>
      </section>
      <section class="section"><div class="section-head"><h3>Artes (${num(linkedArts.length)})</h3>${button('Solicitar arte', { action: 'request-art', icon: 'art', variant: 'ghost small' })}</div>
        ${linkedArts.length ? `<ul class="plain-list">${linkedArts.map(a => `<li><a href="#/artes/${esc(a.id)}">${esc(a.title)}</a>${statusTag(ART_STATUS, a.status)}</li>`).join('')}</ul>` : '<p class="muted">Nenhuma arte solicitada.</p>'}
      </section>
      ${notesSection(record)}`;
    const footer = [
      record.can.remove ? button('Excluir', { action: 'remove', icon: 'trash', variant: 'ghost danger-text' }) : '',
      record.can.edit ? button('Editar', { action: 'edit', icon: 'edit', variant: 'ghost' }) : '',
      transitionButtons(record)
    ].join('');
    openDrawer({ eyebrow: statusTag(PROMOTION_STATUS, record.status), title: record.name, body, footer });
  },

  inputs: { ...pickerInputs },
  changes: { status(ctx, el) { ctx.state.status = el.value; return ctx.refresh(); } },

  actions: {
    ...pickerActions,
    open(ctx, el) { ctx.navigate(`promocoes/${el.dataset.id}`); },
    new(ctx) { return openForm(ctx, null); },
    edit(ctx) { return openForm(ctx, ctx.state.current); },
    async transition(ctx, el) {
      const record = ctx.state.current;
      if (await runTransition({ entity: 'promotions', record, el, statuses: PROMOTION_STATUS, name: record.name })) await reopen(ctx, record.id);
    },
    async remove(ctx) {
      const record = ctx.state.current;
      if ((await confirmDialog({ title: 'Excluir promoção?', text: `“${esc(record.name)}” será removida.`, confirmLabel: 'Excluir', tone: 'danger' })) === null) return;
      await del(`/promotions/${record.id}`);
      toast('Promoção excluída.');
      closeLayers({ restoreFocus: false });
      ctx.navigate('promocoes', { replace: true });
      await ctx.refresh();
    },
    'request-art'(ctx) {
      sessionStorage.setItem('sr-art-origin', JSON.stringify({ originType: 'promotion', originId: ctx.state.current.id }));
      closeLayers({ restoreFocus: false });
      ctx.navigate('artes?nova=1');
    }
  },

  forms: {
    async promotion(ctx, data, form) {
      const id = form.dataset.id;
      data.items = readPricedItems(form);
      const { record } = id ? await patch(`/promotions/${id}`, data) : await post('/promotions', data);
      toast(id ? 'Promoção atualizada.' : 'Promoção criada como rascunho.');
      ctx.invalidate('promotions');
      await reopen(ctx, record.id);
    },
    async note(ctx, data) {
      await post(`/promotions/${ctx.state.current.id}/notes`, data);
      await reopen(ctx, ctx.state.current.id);
    }
  }
};
export default view;

async function reopen(ctx, id) {
  closeLayers({ restoreFocus: false });
  await ctx.refresh();
  ctx.refreshBadges();
  if (ctx.route.id !== id) ctx.navigate(`promocoes/${id}`);
  else await view.open(ctx, id);
}

async function openForm(ctx, record) {
  const campaigns = await ctx.lookup('campaigns').catch(() => []);
  const r = record || { items: [] };
  openModal({
    title: record ? 'Editar promoção' : 'Nova promoção',
    size: 'wide',
    body: `<form data-form="promotion" id="promotionForm" class="form-grid" data-id="${esc(record?.id || '')}">
      ${field('name', 'Nome da promoção', { required: true, full: true, max: 120, value: r.name, placeholder: 'Ex.: Semana do pet — rações 15 kg' })}
      ${field('start', 'Início', { type: 'date', required: true, value: r.start })}
      ${field('end', 'Fim', { type: 'date', required: true, value: r.end })}
      ${field('campaignId', 'Campanha', { type: 'select', full: true, value: r.campaignId, options: [['', 'Nenhuma'], ...campaigns.filter(c => c.status !== 'cancelled').map(c => [c.id, c.name])] })}
      ${productPicker({ name: 'items', label: 'Produtos e preço promocional', mode: 'price', required: true, selected: r.items.map(i => ({ id: i.productId, name: i.name, sku: i.sku, basePrice: i.regularPrice, promoPrice: i.promoPrice })), hint: 'O preço promocional precisa ser menor que o preço do UniPlus.' })}
      ${field('description', 'Observações', { type: 'textarea', full: true, rows: 3, max: 3000, value: r.description })}
      ${record?.status === 'approved' ? '<p class="full hint">Esta promoção está aprovada. Salvar alterações a devolve para rascunho.</p>' : ''}
      <div class="form-error full" aria-live="polite"></div>
    </form>`,
    footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button class="btn primary" type="submit" form="promotionForm">${icon('check')}<span>${record ? 'Salvar alterações' : 'Criar promoção'}</span></button>`
  });
}
