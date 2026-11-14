// Leads: origem, campanha, responsável, etapa, valor e histórico de contato.
import { get, post, patch, del } from '../api.js';
import { esc, icon, money, num, relative, pageHead, empty, button, field, openDrawer, openModal, closeLayers, toast, confirmDialog, statusTag, notice } from '../ui.js';
import { LEAD_STATUS, LEAD_SOURCES } from '../../shared/domain.js';
import { notesSection, personName, peopleOptions } from './common.js';

const view = {
  id: 'leads',
  title: 'Clientes interessados',
  icon: 'users',

  async load({ state }) {
    const [{ records }, { users }, campaigns] = await Promise.all([get('/leads', { status: state.status }), get('/users'), get('/campaigns').then(r => r.records)]);
    return { records, users, campaigns };
  },

  render({ user, state, data }) {
    const { records, users, campaigns } = data;
    const canCheck = ['owner', 'manager'].includes(user.role);
    // Suspeitos de robô ficam fora da lista principal e das contas; têm o botão deles.
    const main = Object.keys(LEAD_STATUS).filter(k => k !== 'spam');
    const suspects = records.filter(r => r.status === 'spam').length;
    const shown = state.status ? records : records.filter(r => r.status !== 'spam');
    const totals = main.map(k => [k, records.filter(r => r.status === k)]);
    const strip = `<div class="stat-strip">${totals.map(([k, list]) => `<button class="stat-btn${state.status === k ? ' is-active' : ''}" data-action="status" data-status="${k}" aria-pressed="${state.status === k}"><strong>${num(list.length)}</strong> ${esc(LEAD_STATUS[k].label)}<span class="mono">${money(list.reduce((s, l) => s + (l.value || 0), 0))}</span></button>`).join('')}${suspects || state.status === 'spam' ? `<button class="stat-btn stat-spam${state.status === 'spam' ? ' is-active' : ''}" data-action="status" data-status="spam" aria-pressed="${state.status === 'spam'}">${icon('shield')}<strong>${num(suspects)}</strong> Suspeitos de robô</button>` : ''}${state.status ? button('Ver todos', { action: 'status', data: { status: '' }, variant: 'ghost small' }) : ''}${canCheck && (!state.status || state.status === 'spam') ? button('Procurar robôs', { action: 'bot-check', icon: 'shield', variant: 'ghost small', title: 'Confere os contatos novos que chegaram sozinhos e separa os que parecem robô' }) : ''}</div>`;
    const spamNote = state.status === 'spam' ? notice('Contatos que o portal separou sozinho porque parecem de robô (e-mail picotado com pontos, e-mail descartável, mensagem cheia de links…). Eles não entram nas contas nem no Início. Se algum for gente de verdade, abra e toque em <strong>Não é robô</strong>.', 'info') : '';
    const list = shown.length ? `<section class="panel flush"><div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Cliente</th><th scope="col">Veio de</th><th scope="col">Campanha</th><th scope="col">Quem atende</th><th scope="col" class="num">Valor</th><th scope="col">Situação</th><th scope="col">Atualizado</th></tr></thead>
      <tbody>${shown.map(l => `<tr class="row-link" data-action="open" data-id="${esc(l.id)}" tabindex="0">
        <td><strong>${esc(l.name)}</strong><span class="sub">${esc(l.phone || l.email || 'sem telefone')}</span></td>
        <td>${esc(l.source)}</td>
        <td>${esc(campaigns.find(c => c.id === l.campaignId)?.name || '—')}</td>
        <td>${esc(personName(users, l.assigneeId))}</td>
        <td class="num mono">${money(l.value)}</td>
        <td>${statusTag(LEAD_STATUS, l.status)}</td>
        <td class="nowrap">${esc(relative(l.updatedAt))}</td></tr>`).join('')}</tbody></table></div></section>`
      : state.status === 'spam'
        ? `<section class="panel">${empty({ title: 'Nenhum suspeito de robô', text: 'Quando o portal separar algum contato com cara de robô, ele aparece aqui.', ic: 'shield' })}</section>`
        : `<section class="panel">${empty({ title: state.status ? 'Ninguém com essa situação' : 'Nenhum cliente interessado ainda', text: 'Anote aqui quem pediu informação pelo WhatsApp, pelo site, pelas redes sociais ou na loja.', action: button('Novo contato', { action: 'new', icon: 'plus', variant: 'primary' }), ic: 'users' })}</section>`;
    return `${pageHead({ title: 'Clientes interessados', lead: 'Anote quem se interessou por algum produto e acompanhe até a compra. Os contatos do site e dos anúncios podem chegar aqui sozinhos.', actions: button('Novo contato', { action: 'new', icon: 'plus', variant: 'primary' }) })}${strip}${spamNote}${list}`;
  },

  async open(ctx, id) {
    const { record } = await get(`/leads/${encodeURIComponent(id)}`);
    const users = await ctx.lookup('users');
    const campaigns = await ctx.lookup('campaigns').catch(() => []);
    ctx.state.current = record;
    const contact = [
      record.phone ? `<a href="https://wa.me/55${esc(record.phone.replace(/\D/g, '').replace(/^55/, ''))}" target="_blank" rel="noopener noreferrer">${esc(record.phone)} ${icon('external')}</a>` : '',
      record.email ? `<a href="mailto:${esc(record.email)}">${esc(record.email)}</a>` : ''
    ].filter(Boolean).join('<br>') || '—';
    const campaign = campaigns.find(c => c.id === record.campaignId);
    const suspect = record.status === 'spam'
      ? notice(`<strong>Parece robô.</strong> ${record.botReasons?.length ? esc(record.botReasons.join('; ')) + '.' : 'Marcado como suspeito.'}<br>${button('Não é robô', { action: 'set-status', icon: 'check', variant: 'secondary small', data: { status: 'new' } })}`, 'warn')
      : '';
    const body = `${suspect}<dl class="facts">
        <div><dt>Telefone e e-mail</dt><dd>${contact}</dd></div>
        <div><dt>Veio de</dt><dd>${esc(record.source)}</dd></div>
        <div><dt>Campanha</dt><dd>${campaign ? `<a href="#/campanhas/${esc(campaign.id)}">${esc(campaign.name)}</a>` : '—'}</dd></div>
        <div><dt>Quem atende</dt><dd>${esc(personName(users, record.assigneeId))}</dd></div>
        <div><dt>Valor estimado</dt><dd class="mono">${money(record.value)}</dd></div>
        <div><dt>Anotado por</dt><dd>${esc(record.createdBy?.name || '—')} <small>${relative(record.createdAt)}</small></dd></div>
      </dl>
      ${record.interest ? `<section class="section"><h3>O que a pessoa quer</h3><p class="prose">${esc(record.interest).replaceAll('\n', '<br>')}</p></section>` : ''}
      <section class="section"><h3>Mudar situação</h3><div class="segmented wrap">${Object.entries(LEAD_STATUS).map(([k, v]) => `<button type="button" class="seg-btn${record.status === k ? ' is-active' : ''}" data-action="set-status" data-status="${k}" aria-pressed="${record.status === k}">${esc(v.label)}</button>`).join('')}</div></section>
      ${notesSection(record)}`;
    const footer = [record.can.remove ? button('Apagar', { action: 'remove', icon: 'trash', variant: 'ghost danger-text' }) : '', button('Editar', { action: 'edit', icon: 'edit', variant: 'ghost' })].join('');
    openDrawer({ eyebrow: statusTag(LEAD_STATUS, record.status), title: record.name, body, footer });
  },

  actions: {
    open(ctx, el) { ctx.navigate(`leads/${el.dataset.id}`); },
    status(ctx, el) { ctx.state.status = ctx.state.status === el.dataset.status ? '' : el.dataset.status; return ctx.refresh(); },
    async 'bot-check'(ctx) {
      const { checked, moved } = await post('/leads/bot-check');
      toast(moved ? `${num(moved)} contato(s) com cara de robô foram para "Suspeitos de robô".` : `Conferi ${num(checked)} contato(s) novos: nenhum parece robô.`);
      await ctx.refresh();
    },
    new(ctx) { return openForm(ctx); },
    edit(ctx) { return openForm(ctx, ctx.state.current); },
    async 'set-status'(ctx, el) {
      const record = ctx.state.current;
      if (record.status === el.dataset.status) return;
      await patch(`/leads/${record.id}`, { status: el.dataset.status });
      toast(`${record.name}: ${LEAD_STATUS[el.dataset.status].label}.`);
      await reopen(ctx, record.id);
    },
    async remove(ctx) {
      const record = ctx.state.current;
      if ((await confirmDialog({ title: 'Apagar contato?', text: `“${esc(record.name)}” vai ser apagado.`, confirmLabel: 'Apagar', tone: 'danger' })) === null) return;
      await del(`/leads/${record.id}`);
      toast('Contato apagado.');
      closeLayers({ restoreFocus: false });
      ctx.navigate('leads', { replace: true });
      await ctx.refresh();
    }
  },

  forms: {
    async lead(ctx, data, form) {
      const id = form.dataset.id;
      const { record } = id ? await patch(`/leads/${id}`, data) : await post('/leads', data);
      toast('Contato salvo.');
      await reopen(ctx, record.id);
    },
    async note(ctx, data) {
      await post(`/leads/${ctx.state.current.id}/notes`, data);
      await reopen(ctx, ctx.state.current.id);
    }
  }
};
export default view;

async function reopen(ctx, id) {
  closeLayers({ restoreFocus: false });
  await ctx.refresh();
  if (ctx.route.id !== id) ctx.navigate(`leads/${id}`);
  else await view.open(ctx, id);
}

async function openForm(ctx, record = null) {
  const [users, campaigns] = await Promise.all([ctx.lookup('users'), ctx.lookup('campaigns').catch(() => [])]);
  const r = record || { source: 'WhatsApp', status: 'new', assigneeId: ctx.user.id };
  openModal({
    title: record ? 'Editar contato' : 'Novo contato',
    body: `<form data-form="lead" id="leadForm" class="form-grid" data-id="${esc(record?.id || '')}">
      ${field('name', 'Nome', { required: true, full: true, max: 120, value: r.name })}
      ${field('phone', 'Telefone / WhatsApp', { type: 'tel', max: 40, value: r.phone })}
      ${field('email', 'E-mail', { type: 'email', value: r.email })}
      ${field('source', 'Veio de', { type: 'select', options: LEAD_SOURCES, value: r.source })}
      ${field('status', 'Situação', { type: 'select', options: Object.entries(LEAD_STATUS).map(([k, v]) => [k, v.label]), value: r.status })}
      ${field('campaignId', 'Veio de alguma campanha?', { type: 'select', options: [['', 'Não'], ...campaigns.map(c => [c.id, c.name])], value: r.campaignId })}
      ${field('assigneeId', 'Quem atende', { type: 'select', options: peopleOptions(users), value: r.assigneeId })}
      ${field('value', 'Valor estimado (R$)', { type: 'number', min: 0, step: '0.01', value: r.value ?? '' })}
      ${field('interest', 'O que a pessoa quer', { type: 'textarea', full: true, rows: 4, max: 3000, value: r.interest })}
      <div class="form-error full" aria-live="polite"></div>
    </form>`,
    footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button class="btn primary" type="submit" form="leadForm">${icon('check')}<span>${record ? 'Salvar' : 'Salvar contato'}</span></button>`
  });
}
