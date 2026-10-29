// Solicitações de arte: nascem de campanha, promoção ou produto; marketing cria e entrega; dono/gerente aprova.
import { get, post, patch } from '../api.js';
import { esc, icon, date, dateTime, num, relative, pageHead, empty, button, field, openDrawer, openModal, closeLayers, toast, statusTag, tag, notice } from '../ui.js';
import { ART_STATUS, ART_FORMATS, ART_ORIGINS, PRIORITIES, todayInSaoPaulo } from '../../shared/domain.js';
import { productPicker, pickerActions, pickerInputs, transitionButtons, runTransition, notesSection, personName, peopleOptions } from './common.js';

const COLUMNS = ['requested', 'in_progress', 'changes', 'awaiting_approval', 'approved', 'published'];
const ORIGIN_ROUTE = { campaign: 'campanhas', promotion: 'promocoes', product: 'produtos' };

function card(a, users, today) {
  const late = a.deadline < today && !['approved', 'published'].includes(a.status);
  return `<li><button class="q-card${late ? ' has-error' : ''}" data-action="open" data-id="${esc(a.id)}">
    <span class="q-card-top">${['Alta', 'Urgente'].includes(a.priority) ? tag(a.priority, a.priority === 'Urgente' ? 'danger' : 'warn') : ''}${late ? tag('Atrasada', 'danger') : ''}</span>
    <strong class="q-title">${esc(a.title)}</strong>
    <span class="q-meta">${esc(a.format)} · ${esc(ART_ORIGINS[a.originType])}: ${esc(a.originName || '—')}</span>
    <span class="q-foot">${icon('calendar')}prazo ${date(a.deadline)} · ${esc(personName(users, a.assigneeId))}</span>
  </button></li>`;
}

const view = {
  id: 'artes',
  title: 'Artes',
  icon: 'art',
  group: 'Marketing',

  async load() {
    const [{ records }, { users }] = await Promise.all([get('/arts'), get('/users')]);
    return { records, users };
  },

  render({ data }) {
    const { records, users } = data;
    const today = todayInSaoPaulo();
    const board = records.length ? `<div class="board six" aria-label="Quadro de artes">${COLUMNS.map(status => {
      const list = records.filter(a => a.status === status).sort((a, b) => a.deadline.localeCompare(b.deadline));
      const s = ART_STATUS[status];
      return `<section class="board-col" aria-labelledby="art-${status}"><header class="board-head tone-${s.tone}"><h2 id="art-${status}">${esc(s.label)}</h2><span class="mono">${num(list.length)}</span></header>
        ${list.length ? `<ul class="board-list">${list.map(a => card(a, users, today)).join('')}</ul>` : '<p class="board-empty">—</p>'}</section>`;
    }).join('')}</div>`
      : `<section class="panel">${empty({ title: 'Nenhuma arte solicitada', text: 'Peça uma arte a partir de uma campanha, promoção ou produto.', action: button('Solicitar arte', { action: 'new', icon: 'plus', variant: 'primary' }), ic: 'art' })}</section>`;
    return `${pageHead({ title: 'Artes', lead: 'Marketing cria e indica o arquivo em media/. Dono ou gerente autorizado aprova. A publicação nos canais é registrada aqui.', actions: button('Solicitar arte', { action: 'new', icon: 'plus', variant: 'primary' }) })}${board}`;
  },

  // Pedido vindo de outra tela (produto, campanha, promoção): #/artes?nova=1
  enter(ctx) {
    if (ctx.route.query?.nova) return openForm(ctx);
  },

  async open(ctx, id) {
    const [{ record }, users] = await Promise.all([get(`/arts/${encodeURIComponent(id)}`), ctx.lookup('users')]);
    ctx.state.current = record;
    const editableFile = ['marketing', 'owner', 'manager'].includes(ctx.user.role) && !['approved', 'published'].includes(record.status);
    const body = `
      <dl class="facts">
        <div><dt>Origem</dt><dd>${esc(ART_ORIGINS[record.originType])}: <a href="#/${ORIGIN_ROUTE[record.originType]}/${esc(record.originId)}">${esc(record.originName || 'abrir')}</a></dd></div>
        <div><dt>Formato</dt><dd>${esc(record.format)}</dd></div>
        <div><dt>Prazo</dt><dd>${date(record.deadline)}</dd></div>
        <div><dt>Prioridade</dt><dd>${esc(record.priority)}</dd></div>
        <div><dt>Responsável</dt><dd>${esc(personName(users, record.assigneeId))}</dd></div>
        <div><dt>Solicitada por</dt><dd>${esc(record.createdBy?.name || '—')} <small>${relative(record.createdAt)}</small></dd></div>
      </dl>
      <section class="section"><h3>Briefing</h3><p class="prose">${esc(record.briefing).replaceAll('\n', '<br>')}</p></section>
      <section class="section"><h3>Arquivo da arte</h3>
        ${editableFile ? `<form data-form="file" class="inline-form">
          <label for="fileRef" class="sr-only">Caminho dentro de media/</label>
          <input id="fileRef" name="fileRef" class="mono" value="${esc(record.fileRef)}" placeholder="artes/2026-11/semana-pet-stories.png">
          <button class="btn small" type="submit">Salvar</button>
          <div class="form-error"></div></form>
          <p class="hint">Salve o arquivo na pasta <span class="mono">media/</span> do servidor da loja e indique o caminho. Usuários remotos veem só a referência.</p>`
          : record.fileRef ? `<p class="mono">${esc(record.fileRef)}</p>` : '<p class="muted">Nenhum arquivo indicado ainda.</p>'}
        ${record.deliveredAt ? `<p class="hint">Entregue ${dateTime(record.deliveredAt)}</p>` : ''}
      </section>
      ${record.publications?.length ? `<section class="section"><h3>Onde foi publicada</h3><ul class="timeline">${record.publications.map(p => `<li><span class="tl-when">${dateTime(p.at)}</span><span class="tl-what">${tag(p.channel, 'done')} por <strong>${esc(p.by)}</strong>${p.note ? ` — ${esc(p.note)}` : ''}</span></li>`).join('')}</ul></section>` : ''}
      ${record.status === 'approved' ? notice('Arte aprovada. Depois de postar ou enviar, use “Registrar publicação” para marcar os canais.', 'info') : ''}
      ${notesSection(record)}`;
    const footer = [record.can.edit ? button('Editar pedido', { action: 'edit', icon: 'edit', variant: 'ghost' }) : '', transitionButtons(record)].join('');
    openDrawer({ eyebrow: statusTag(ART_STATUS, record.status), title: record.title, body, footer });
  },

  inputs: { ...pickerInputs },
  changes: {
    async originType(ctx, el) {
      const box = el.closest('form').querySelector('[data-origin]');
      box.innerHTML = await originField(ctx, el.value, '');
    }
  },

  actions: {
    ...pickerActions,
    open(ctx, el) { ctx.navigate(`artes/${el.dataset.id}`); },
    new(ctx) { return openForm(ctx); },
    edit(ctx) { return openForm(ctx, ctx.state.current); },
    async transition(ctx, el) {
      const record = ctx.state.current;
      if (await runTransition({ entity: 'arts', record, el, statuses: ART_STATUS, name: record.title })) await reopen(ctx, record.id);
    }
  },

  forms: {
    async art(ctx, data, form) {
      const id = form.dataset.id;
      if (data.originType === 'product') data.originId = form.querySelector('[data-picker-row]')?.dataset.id || '';
      const { record } = id ? await patch(`/arts/${id}`, data) : await post('/arts', data);
      sessionStorage.removeItem('sr-art-origin');
      toast(id ? 'Pedido de arte atualizado.' : 'Arte solicitada ao marketing.');
      await reopen(ctx, record.id);
    },
    async file(ctx, data) {
      await patch(`/arts/${ctx.state.current.id}/file`, data);
      toast('Referência do arquivo salva.');
      await reopen(ctx, ctx.state.current.id);
    },
    async note(ctx, data) {
      await post(`/arts/${ctx.state.current.id}/notes`, data);
      await reopen(ctx, ctx.state.current.id);
    }
  }
};

export default view;

async function reopen(ctx, id) {
  closeLayers({ restoreFocus: false });
  await ctx.refresh();
  ctx.refreshBadges();
  if (ctx.route.id !== id) ctx.navigate(`artes/${id}`, { replace: true });
  else await view.open(ctx, id);
}

async function originField(ctx, type, selectedId, selectedName = '') {
  if (type === 'product') {
    return productPicker({ name: 'originProduct', label: 'Produto', mode: 'single', required: true, selected: selectedId ? [{ id: selectedId, name: selectedName || 'Produto selecionado' }] : [] });
  }
  const list = await ctx.lookup(type === 'campaign' ? 'campaigns' : 'promotions').catch(() => []);
  const open = list.filter(x => x.status !== 'cancelled');
  if (!open.length) return `<div class="field full">${notice(`Nenhuma ${type === 'campaign' ? 'campanha' : 'promoção'} cadastrada. Crie primeiro ou escolha outra origem.`, 'warn')}</div>`;
  return field('originId', type === 'campaign' ? 'Campanha' : 'Promoção', { type: 'select', full: true, required: true, value: selectedId, options: open.map(x => [x.id, x.name]) });
}

async function openForm(ctx, record = null) {
  let preset = {};
  if (!record) {
    try { preset = JSON.parse(sessionStorage.getItem('sr-art-origin') || '{}'); } catch {}
  }
  const r = record || { originType: preset.originType || 'campaign', originId: preset.originId || '', priority: 'Normal', format: 'Post' };
  let originName = record?.originName || '';
  if (!record && r.originType === 'product' && r.originId) {
    originName = await get(`/products/${encodeURIComponent(r.originId)}`).then(x => x.product.name).catch(() => '');
  }
  const users = await ctx.lookup('users');
  openModal({
    title: record ? 'Editar pedido de arte' : 'Solicitar arte',
    size: 'wide',
    body: `<form data-form="art" id="artForm" class="form-grid" data-id="${esc(record?.id || '')}">
      ${field('title', 'Título do pedido', { required: true, full: true, max: 140, value: r.title, placeholder: 'Ex.: Stories da Semana do pet — ração 15 kg' })}
      ${field('originType', 'Nasce de', { type: 'select', options: Object.entries(ART_ORIGINS), value: r.originType })}
      ${field('format', 'Formato', { type: 'select', options: ART_FORMATS, value: r.format })}
      <div class="full" data-origin>${await originField(ctx, r.originType, r.originId, originName)}</div>
      ${field('deadline', 'Prazo', { type: 'date', required: true, value: r.deadline })}
      ${field('priority', 'Prioridade', { type: 'select', options: PRIORITIES, value: r.priority })}
      ${field('assigneeId', 'Responsável (marketing)', { type: 'select', full: true, options: peopleOptions(users, { empty: 'Definir depois', roles: ['marketing', 'manager', 'owner'] }), value: r.assigneeId })}
      ${field('briefing', 'Briefing', { type: 'textarea', full: true, rows: 6, required: true, max: 8000, value: r.briefing, placeholder: 'Mensagem principal, texto da arte, preço, referências, tamanho, onde vai ser usada.' })}
      <div class="form-error full" aria-live="polite"></div>
    </form>`,
    footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button class="btn primary" type="submit" form="artForm">${icon('send')}<span>${record ? 'Salvar alterações' : 'Enviar ao marketing'}</span></button>`
  });
  if (!record && ctx.route.query?.nova) history.replaceState(null, '', '#/artes');
}

