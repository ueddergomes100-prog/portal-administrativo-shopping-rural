// Campanhas: período, canais, objetivo, orçamento, responsável, produtos e tudo que nasce delas.
import { get, post, patch, del } from '../api.js';
import { esc, icon, money, date, num, pageHead, empty, button, field, openDrawer, openModal, closeLayers, toast, confirmDialog, statusTag } from '../ui.js';
import { CAMPAIGN_STATUS, CAMPAIGN_CHANNELS, CAMPAIGN_OBJECTIVES, ART_STATUS, PROMOTION_STATUS, QUEUE_STAGES, LEAD_STATUS } from '../../shared/domain.js';
import { productPicker, pickerActions, pickerInputs, transitionButtons, runTransition, notesSection, personName, peopleOptions } from './common.js';

const view = {
  id: 'campanhas',
  title: 'Campanhas',
  icon: 'campaign',
  group: 'Marketing',

  async load({ state }) {
    const [{ records }, users] = await Promise.all([get('/campaigns', { status: state.status }), ctxUsers()]);
    return { records, users };
  },

  render({ user, state, data }) {
    const { records, users } = data;
    const canCreate = ['owner', 'manager', 'marketing'].includes(user.role);
    const filter = `<div class="toolbar"><label class="select-inline"><span class="sr-only">Etapa</span><select data-change="status">
      <option value="">Todas as etapas</option>${Object.entries(CAMPAIGN_STATUS).map(([k, v]) => `<option value="${k}"${state.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label></div>`;
    const list = records.length ? `<section class="panel flush"><div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Campanha</th><th scope="col">Período</th><th scope="col">Canais</th><th scope="col" class="num">Orçamento</th><th scope="col">Responsável</th><th scope="col">Etapa</th></tr></thead>
      <tbody>${records.map(c => `<tr class="row-link" data-action="open" data-id="${esc(c.id)}" tabindex="0">
        <td><strong>${esc(c.name)}</strong><span class="sub">${esc(c.objective)} · ${num(c.products?.length || 0)} produto(s)</span></td>
        <td class="nowrap">${date(c.start)} – ${date(c.end)}</td>
        <td>${esc((c.channels || []).join(', ') || '—')}</td>
        <td class="num mono">${money(c.budget)}</td>
        <td>${esc(personName(users, c.ownerId))}</td>
        <td>${statusTag(CAMPAIGN_STATUS, c.status)}</td></tr>`).join('')}</tbody></table></div></section>`
      : `<section class="panel">${empty({ title: state.status ? 'Nenhuma campanha nesta etapa' : 'Nenhuma campanha ainda', text: 'Planeje datas, canais, produtos e o que precisa de arte.', action: canCreate ? button('Nova campanha', { action: 'new', icon: 'plus', variant: 'primary' }) : '', ic: 'campaign' })}</section>`;
    return `${pageHead({ title: 'Campanhas', lead: 'Cada campanha reúne produtos, promoções, artes e leads. Aprovação por dono ou gerente autorizado.', actions: canCreate ? button('Nova campanha', { action: 'new', icon: 'plus', variant: 'primary' }) : '' })}${filter}${list}`;
  },

  async open(ctx, id) {
    const [{ record }, users, arts, promos, queue, leads] = await Promise.all([
      get(`/campaigns/${encodeURIComponent(id)}`), ctx.lookup('users'),
      get('/arts').then(r => r.records), get('/promotions', { campaignId: id }).then(r => r.records),
      get('/queue').then(r => r.items), get('/leads', { campaignId: id }).then(r => r.records)
    ]);
    ctx.state.current = record;
    const linkedArts = arts.filter(a => a.originType === 'campaign' && a.originId === id);
    const linkedQueue = queue.filter(q => q.campaignId === id);
    const body = `
      <dl class="facts">
        <div><dt>Objetivo</dt><dd>${esc(record.objective)}</dd></div>
        <div><dt>Período</dt><dd>${date(record.start)} a ${date(record.end)}</dd></div>
        <div><dt>Canais</dt><dd>${esc((record.channels || []).join(', ') || '—')}</dd></div>
        <div><dt>Orçamento</dt><dd class="mono">${money(record.budget)}</dd></div>
        <div><dt>Responsável</dt><dd>${esc(personName(users, record.ownerId))}</dd></div>
        <div><dt>Criada por</dt><dd>${esc(record.createdBy?.name || '—')} <small>${date(record.createdAt)}</small></dd></div>
      </dl>
      ${record.description ? `<p class="prose">${esc(record.description).replaceAll('\n', '<br>')}</p>` : ''}
      <section class="section"><h3>Produtos (${num(record.products?.length || 0)})</h3>
        ${record.products?.length ? `<ul class="plain-list">${record.products.map(p => `<li><a href="#/produtos/${esc(p.id)}">${esc(p.name)}</a><span class="mono sub">${esc(p.sku)} · ${money(p.basePrice)}</span></li>`).join('')}</ul>` : '<p class="muted">Nenhum produto vinculado.</p>'}
      </section>
      <section class="section"><div class="section-head"><h3>Artes (${num(linkedArts.length)})</h3>${button('Solicitar arte', { action: 'request-art', icon: 'art', variant: 'ghost small' })}</div>
        ${linkedArts.length ? `<ul class="plain-list">${linkedArts.map(a => `<li><a href="#/artes/${esc(a.id)}">${esc(a.title)}</a>${statusTag(ART_STATUS, a.status)}<span class="sub">prazo ${date(a.deadline)}</span></li>`).join('')}</ul>` : '<p class="muted">Nenhuma arte solicitada.</p>'}
      </section>
      <section class="section"><h3>Promoções (${num(promos.length)})</h3>
        ${promos.length ? `<ul class="plain-list">${promos.map(p => `<li><a href="#/promocoes/${esc(p.id)}">${esc(p.name)}</a>${statusTag(PROMOTION_STATUS, p.status)}</li>`).join('')}</ul>` : '<p class="muted">Nenhuma promoção ligada a esta campanha.</p>'}
      </section>
      <section class="section"><h3>Produtos na fila do site (${num(linkedQueue.length)})</h3>
        ${linkedQueue.length ? `<ul class="plain-list">${linkedQueue.map(q => `<li><a href="#/fila/${esc(q.id)}">${esc(q.productSnapshot.name)}</a>${statusTag(QUEUE_STAGES, q.stage)}</li>`).join('')}</ul>` : '<p class="muted">Nenhum item da fila associado.</p>'}
      </section>
      <section class="section"><h3>Leads (${num(leads.length)})</h3>
        ${leads.length ? `<ul class="plain-list">${leads.map(l => `<li><a href="#/leads/${esc(l.id)}">${esc(l.name)}</a>${statusTag(LEAD_STATUS, l.status)}<span class="mono sub">${money(l.value)}</span></li>`).join('')}</ul>` : '<p class="muted">Nenhum lead atribuído.</p>'}
      </section>
      ${notesSection(record)}`;
    const footer = [
      record.can.remove ? button('Excluir', { action: 'remove', icon: 'trash', variant: 'ghost danger-text' }) : '',
      record.can.edit ? button('Editar', { action: 'edit', icon: 'edit', variant: 'ghost' }) : '',
      transitionButtons(record)
    ].join('');
    openDrawer({ eyebrow: statusTag(CAMPAIGN_STATUS, record.status), title: record.name, body, footer });
  },

  inputs: { ...pickerInputs },
  changes: {
    status(ctx, el) { ctx.state.status = el.value; return ctx.refresh(); }
  },

  actions: {
    ...pickerActions,
    open(ctx, el) { ctx.navigate(`campanhas/${el.dataset.id}`); },
    async new(ctx) { openForm(ctx, null); },
    async edit(ctx) { openForm(ctx, ctx.state.current); },
    async transition(ctx, el) {
      const record = ctx.state.current;
      if (await runTransition({ entity: 'campaigns', record, el, statuses: CAMPAIGN_STATUS, name: record.name })) await reopen(ctx, record.id);
    },
    async remove(ctx) {
      const record = ctx.state.current;
      const ok = await confirmDialog({ title: 'Excluir campanha?', text: `“${esc(record.name)}” será removida. O histórico continua registrado.`, confirmLabel: 'Excluir', tone: 'danger' });
      if (ok === null) return;
      await del(`/campaigns/${record.id}`);
      toast('Campanha excluída.');
      closeLayers({ restoreFocus: false });
      ctx.invalidate('campaigns');
      ctx.navigate('campanhas', { replace: true });
      await ctx.refresh();
    },
    'request-art'(ctx) {
      sessionStorage.setItem('sr-art-origin', JSON.stringify({ originType: 'campaign', originId: ctx.state.current.id }));
      closeLayers({ restoreFocus: false });
      ctx.navigate('artes?nova=1');
    }
  },

  forms: {
    async campaign(ctx, data, form) {
      const id = form.dataset.id;
      data.channels = [].concat(data.channels || []);
      data.productIds = [].concat(data.productIds || []);
      const { record } = id ? await patch(`/campaigns/${id}`, data) : await post('/campaigns', data);
      toast(id ? 'Campanha atualizada.' : 'Campanha criada como rascunho.');
      ctx.invalidate('campaigns');
      await ctx.refresh();
      await reopen(ctx, record.id);
    },
    async note(ctx, data) {
      await post(`/campaigns/${ctx.state.current.id}/notes`, data);
      await reopen(ctx, ctx.state.current.id);
    }
  }
};
export default view;

let usersCache = null;
async function ctxUsers() {
  usersCache = await get('/users').then(r => r.users).catch(() => usersCache || []);
  return usersCache;
}

async function reopen(ctx, id) {
  closeLayers({ restoreFocus: false });
  ctx.invalidate('campaigns');
  await ctx.refresh();
  ctx.refreshBadges();
  if (ctx.route.id !== id) ctx.navigate(`campanhas/${id}`);
  else await view.open(ctx, id);
}

async function openForm(ctx, record) {
  const users = await ctx.lookup('users');
  const r = record || { channels: [], products: [] };
  openModal({
    title: record ? 'Editar campanha' : 'Nova campanha',
    size: 'wide',
    body: `<form data-form="campaign" id="campaignForm" class="form-grid" data-id="${esc(record?.id || '')}">
      ${field('name', 'Nome da campanha', { required: true, full: true, max: 120, value: r.name })}
      ${field('objective', 'Objetivo', { type: 'select', options: CAMPAIGN_OBJECTIVES, value: r.objective || 'Vendas' })}
      ${field('ownerId', 'Responsável', { type: 'select', options: peopleOptions(users), value: r.ownerId })}
      ${field('start', 'Início', { type: 'date', required: true, value: r.start })}
      ${field('end', 'Fim', { type: 'date', required: true, value: r.end })}
      ${field('budget', 'Orçamento (R$)', { type: 'number', min: 0, step: '0.01', value: r.budget ?? '' })}
      ${field('channels', 'Canais', { type: 'checkboxes', full: true, options: CAMPAIGN_CHANNELS, value: r.channels })}
      ${productPicker({ name: 'productIds', label: 'Produtos da campanha', selected: r.products || [] })}
      ${field('description', 'Descrição e mensagem principal', { type: 'textarea', full: true, rows: 4, max: 5000, value: r.description })}
      <div class="form-error full" aria-live="polite"></div>
    </form>`,
    footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button class="btn primary" type="submit" form="campaignForm">${icon('check')}<span>${record ? 'Salvar alterações' : 'Criar campanha'}</span></button>`
  });
}

