// Promoções: escolhe ONDE vale (site, Shopee, Mercado Livre…) e os anúncios à venda ali, com um preço de
// promoção por lugar. Aprovada, entra sozinha no site nas datas; Shopee/ML viram tarefa ("Já cadastrei").
import { get, post, patch, del } from '../api.js';
import { esc, icon, money, date, num, pageHead, empty, button, field, openDrawer, openModal, closeLayers, toast, confirmDialog, statusTag, tag, notice } from '../ui.js';
import { PROMOTION_STATUS, ART_STATUS, promotionPhase, todayInSaoPaulo, channelFees } from '../../shared/domain.js';
import { transitionButtons, runTransition, notesSection, artRequestSection, artChanges, readArtRequest } from './common.js';

const discount = item => (item.regularPrice ? Math.round((1 - item.promoPrice / item.regularPrice) * 100) : 0);
const pct = (promo, regular) => (regular ? Math.round((1 - promo / regular) * 100) : 0);
const TASK_ROLES = ['owner', 'manager', 'site'];
const phaseTag = p => {
  const phase = promotionPhase(p, todayInSaoPaulo());
  return phase ? tag(phase.label, phase.tone) : '';
};

// ---------------------------------------------------------------------------
// Escolha dos anúncios (formulário)
// ---------------------------------------------------------------------------
const formChannels = form => {
  const all = JSON.parse(form.dataset.channels || '[]');
  const chosen = [...form.querySelectorAll('input[name=channels]:checked')].map(i => i.value);
  return all.filter(c => chosen.includes(c.id));
};

// r = { queueId, name, sku, prices: { canal: preço normal }, listedOn: [canais], values: { canal: preço da promoção } }
function promoRow(r, channels) {
  const cells = channels.map(c => (r.listedOn.includes(c.id) && r.prices[c.id] != null
    ? `<label class="promo-price"><span class="promo-price-head"><strong>${esc(c.name)}</strong><small>normal ${money(r.prices[c.id])}</small></span>
        <span class="calc-money"><span aria-hidden="true">R$</span><input type="number" min="0" step="0.01" inputmode="decimal" data-ch="${esc(c.id)}" data-regular="${esc(r.prices[c.id])}" data-input="promo-net" value="${esc(r.values?.[c.id] ?? '')}" aria-label="Preço da promoção de ${esc(r.name)} em ${esc(c.name)}" required></span>
        <small class="promo-net" data-net aria-live="polite"></small></label>`
    : `<p class="promo-off">${esc(c.name)}: não está à venda lá</p>`)).join('');
  return `<li class="promo-row" data-promo-row data-row="${esc(JSON.stringify(r))}">
    <div class="promo-row-head"><span><strong>${esc(r.name)}</strong><span class="mono sub">${esc(r.sku || '')}</span></span>
      <button type="button" class="btn-icon" data-action="promo-remove" aria-label="Tirar ${esc(r.name)} da promoção">${icon('close')}</button></div>
    <div class="promo-prices">${cells || '<p class="promo-off">Marque onde a promoção vale.</p>'}</div>
  </li>`;
}

// Guarda o que já foi digitado em cada linha antes de redesenhar (troca de lugares marcados).
function rowsData(form) {
  return [...form.querySelectorAll('[data-promo-row]')].map(li => {
    const r = JSON.parse(li.dataset.row);
    li.querySelectorAll('[data-ch]').forEach(input => { (r.values ||= {})[input.dataset.ch] = input.value; });
    return r;
  });
}

function redrawRows(form) {
  const list = form.querySelector('[data-promo-chosen]');
  list.innerHTML = rowsData(form).map(r => promoRow(r, formChannels(form))).join('');
  updateNet(form);
}

// Desconto e quanto a loja recebe em cada lugar, enquanto a pessoa digita.
function updateNet(form) {
  const channels = Object.fromEntries(JSON.parse(form.dataset.channels || '[]').map(c => [c.id, c]));
  form.querySelectorAll('[data-ch]').forEach(input => {
    const out = input.closest('.promo-price').querySelector('[data-net]');
    const price = Number(input.value);
    const regular = Number(input.dataset.regular);
    if (!(price > 0)) { out.textContent = ''; out.classList.remove('is-bad'); return; }
    const bad = price >= regular;
    out.classList.toggle('is-bad', bad);
    out.textContent = bad ? 'Precisa ser menor que o normal' : `−${pct(price, regular)}% · loja recebe ${money(channelFees(price, channels[input.dataset.ch]).net)}`;
  });
  const count = form.querySelectorAll('[data-promo-row]').length;
  const counter = form.querySelector('[data-promo-count]');
  if (counter) counter.textContent = count ? `${num(count)} produto${count === 1 ? '' : 's'} na promoção` : 'Nenhum produto ainda';
}

function readItems(form) {
  return [...form.querySelectorAll('[data-promo-row]')].map(li => {
    const r = JSON.parse(li.dataset.row);
    return { queueId: r.queueId, prices: Object.fromEntries([...li.querySelectorAll('[data-ch]')].map(i => [i.dataset.ch, i.value])) };
  });
}

// Quantos estão marcados na busca: o botão diz "Adicionar 3 marcados" e o "Marcar todos" acompanha.
function updatePicked(form) {
  const boxes = [...form.querySelectorAll('[data-pick]:not(:disabled)')];
  const n = boxes.filter(b => b.checked).length;
  const add = form.querySelector('[data-action="promo-add-picked"]');
  if (add) {
    add.disabled = !n;
    add.querySelector('span').textContent = n ? `Adicionar ${num(n)} marcado${n === 1 ? '' : 's'}` : 'Adicionar marcados';
  }
  const all = form.querySelector('[data-pick-all]');
  if (all) { all.checked = n > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; }
}

let searchTimer;
async function searchListings(form, term) {
  const box = form.querySelector('[data-promo-results]');
  const channels = formChannels(form);
  if (!channels.length) { box.innerHTML = '<li class="picker-none">Marque primeiro onde a promoção vale.</li>'; return; }
  if (term.length < 2) { box.innerHTML = ''; return; }
  try {
    const { items, more } = await get('/promotions/candidates', { channels: channels.map(c => c.id).join(','), search: term });
    const chosen = new Set(rowsData(form).map(r => r.queueId));
    const free = items.filter(i => !chosen.has(i.queueId)).length;
    // Marca quantos quiser (ou "Marcar todos") e coloca todos de uma vez com "Adicionar marcados".
    box.innerHTML = items.length ? `${free ? `<li class="picker-bar">
        <label class="check"><input type="checkbox" data-pick-all data-change="promo-pick-all"><span>Marcar todos (${num(free)})</span></label>
        ${button('Adicionar marcados', { action: 'promo-add-picked', icon: 'plus', variant: 'primary small', disabled: true })}
      </li>` : ''}
      ${items.map(i => `<li><label class="picker-option picker-check${chosen.has(i.queueId) ? ' is-done' : ''}">
        <input type="checkbox" data-pick data-change="promo-pick" data-item="${esc(JSON.stringify(i))}"${chosen.has(i.queueId) ? ' disabled checked' : ''}>
        <span class="picker-text"><strong>${esc(i.name)}</strong><span class="mono">${esc(i.sku)} · ${channels.filter(c => i.listedOn.includes(c.id)).map(c => `${esc(c.name)} ${money(i.prices[c.id])}`).join(' · ')}</span>
        ${i.promotion ? `<span class="sub">Já está na promoção “${esc(i.promotion.name)}” até ${date(i.promotion.end)}</span>` : ''}
        ${i.ownPromoEnd !== null && i.ownPromoEnd !== undefined ? `<span class="sub">Já tem promoção própria no anúncio${i.ownPromoEnd ? ` até ${date(i.ownPromoEnd)}` : ''}: tire antes de aprovar esta</span>` : ''}${chosen.has(i.queueId) ? '<span class="sub">Já está na lista</span>' : ''}</span>
      </label></li>`).join('')}
      ${more ? `<li class="picker-none">Mostrando os ${num(items.length)} primeiros. Escreva mais do nome para achar os outros.</li>` : ''}`
      : `<li class="picker-none">Nenhum anúncio à venda em ${esc(channels.map(c => c.name).join(' ou '))} com esse nome ou código.</li>`;
  } catch (error) {
    box.innerHTML = `<li class="picker-none">${esc(error.message)}</li>`;
  }
}

// ---------------------------------------------------------------------------
// Ficha da promoção: onde ela está
// ---------------------------------------------------------------------------
function whereItIs(record, channels, user) {
  const phase = promotionPhase(record, todayInSaoPaulo());
  const canTask = TASK_ROLES.includes(user.role);
  const rows = channels.map(c => {
    const count = record.items.filter(i => !i.channels || i.channels[c.id]).length;
    if (c.integration === 'site') {
      const text = record.status !== 'approved' ? 'Entra no site sozinha quando for aprovada.'
        : phase?.key === 'active' ? 'No ar no site agora. Sai sozinha no fim.'
          : phase?.key === 'scheduled' ? `Entra no site sozinha em ${date(record.start)}.` : 'Já saiu do site.';
      return `<li><span><strong>${esc(c.name)}</strong> · ${num(count)} produto${count === 1 ? '' : 's'}</span><span>${esc(text)}</span></li>`;
    }
    const task = record.channelTasks?.[c.id];
    if (task?.status === 'pending') return `<li class="is-todo"><span><strong>${esc(c.name)}</strong> · ${num(count)} produto${count === 1 ? '' : 's'}</span><span>Falta cadastrar a promoção lá, com os preços abaixo e as mesmas datas.</span>${canTask ? button(`Já cadastrei na ${c.name}`, { action: 'channel-task', data: { channel: c.id }, icon: 'check', variant: 'primary small' }) : ''}</li>`;
    if (task?.status === 'undo') return `<li class="is-todo"><span><strong>${esc(c.name)}</strong></span><span>A promoção foi cancelada ou mudou: tire a promoção de lá.</span>${canTask ? button(`Já tirei da ${c.name}`, { action: 'channel-task', data: { channel: c.id }, icon: 'check', variant: 'primary small' }) : ''}</li>`;
    if (task?.status === 'done') return `<li><span><strong>${esc(c.name)}</strong> · ${num(count)} produto${count === 1 ? '' : 's'}</span><span>Cadastrada por ${esc(task.by || '—')} em ${date(task.at?.slice(0, 10))}.</span></li>`;
    return `<li><span><strong>${esc(c.name)}</strong> · ${num(count)} produto${count === 1 ? '' : 's'}</span><span>${record.status === 'approved' ? 'Nada a fazer.' : 'Quando for aprovada, vira tarefa: cadastrar a promoção lá.'}</span></li>`;
  }).join('');
  return `<section class="section"><h3>Onde a promoção está</h3><ul class="promo-where">${rows}</ul></section>`;
}

function itemsTable(record, channels) {
  return `<div class="table-wrap"><table class="table compact"><thead><tr><th scope="col">Produto</th>${channels.map(c => `<th scope="col" class="num">${esc(c.name)}</th>`).join('')}</tr></thead>
    <tbody>${record.items.map(i => `<tr><td>${esc(i.name)}<span class="mono sub">${esc(i.sku)}</span></td>${channels.map(c => {
      // Promoção antiga (antes dos preços por lugar): o mesmo preço em todos.
      const p = i.channels ? i.channels[c.id] : { regularPrice: i.regularPrice, promoPrice: i.promoPrice };
      return p ? `<td class="num"><div class="promo-cell"><strong class="mono">${money(p.promoPrice)}</strong><span class="sub">era ${money(p.regularPrice)} · −${pct(p.promoPrice, p.regularPrice)}%</span><span class="sub">loja recebe ${money(channelFees(p.promoPrice, c).net)}</span></div></td>` : '<td class="num muted">—</td>';
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const view = {
  id: 'promocoes',
  title: 'Promoções',
  icon: 'tag',

  async load({ state }) {
    return get('/promotions', { status: state.status });
  },

  render({ user, state, data }) {
    const canCreate = ['owner', 'manager'].includes(user.role);
    const records = data.records;
    const filter = `<div class="toolbar"><label class="select-inline"><span class="sr-only">Situação</span><select data-change="status">
      <option value="">Todas as situações</option>${Object.entries(PROMOTION_STATUS).map(([k, v]) => `<option value="${k}"${state.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label></div>`;
    const list = records.length ? `<section class="panel flush"><div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Promoção</th><th scope="col">Período</th><th scope="col" class="num">Produtos</th><th scope="col" class="num">Desconto</th><th scope="col">Situação</th></tr></thead>
      <tbody>${records.map(p => {
        const ds = p.items.map(discount);
        const range = ds.length ? (Math.min(...ds) === Math.max(...ds) ? `${Math.min(...ds)}%` : `${Math.min(...ds)}–${Math.max(...ds)}%`) : '—';
        const todo = Object.values(p.channelTasks || {}).some(t => t.status !== 'done');
        return `<tr class="row-link" data-action="open" data-id="${esc(p.id)}" tabindex="0">
          <td><strong>${esc(p.name)}</strong>${p.items[0] ? `<span class="sub">${esc(p.items[0].name)}${p.items.length > 1 ? ` e mais ${p.items.length - 1}` : ''}</span>` : ''}</td>
          <td class="nowrap">${date(p.start)} – ${date(p.end)}</td>
          <td class="num mono">${num(p.items.length)}</td>
          <td class="num mono">${range}</td>
          <td>${statusTag(PROMOTION_STATUS, p.status)} ${phaseTag(p)}${todo ? ` ${tag('Falta em marketplace', 'warn')}` : ''}</td></tr>`;
      }).join('')}</tbody></table></div></section>`
      : `<section class="panel">${empty({ title: state.status ? 'Nenhuma promoção com essa situação' : 'Nenhuma promoção ainda', text: 'Escolha onde vale, os produtos, o preço da promoção e as datas.', action: canCreate ? button('Nova promoção', { action: 'new', icon: 'plus', variant: 'primary' }) : '', ic: 'tag' })}</section>`;
    return `${pageHead({ title: 'Promoções', lead: 'Preço especial por um período, no site e nos marketplaces. Aprovada, entra no site sozinha; na Shopee e no Mercado Livre vira tarefa para a equipe.', actions: canCreate ? button('Nova promoção', { action: 'new', icon: 'plus', variant: 'primary' }) : '' })}${filter}${list}`;
  },

  // Pedido vindo da ficha do produto: #/promocoes?nova=1
  async enter(ctx) {
    if (!ctx.route.query?.nova) return;
    const productId = sessionStorage.getItem('sr-promo-product');
    sessionStorage.removeItem('sr-promo-product');
    let preset = null;
    if (productId) {
      const { items } = await get('/promotions/candidates', { productId });
      if (items.length) preset = { items: [], rows: items.map(i => ({ ...i, values: {} })) };
      else toast('Este produto ainda não está à venda em nenhum lugar. Coloque à venda antes de pôr em promoção.', 'warn');
    }
    history.replaceState(null, '', '#/promocoes');
    return openForm(ctx, null, preset);
  },

  async open(ctx, id) {
    const [{ record }, arts, campaigns, channels] = await Promise.all([
      get(`/promotions/${encodeURIComponent(id)}`), get('/arts').then(r => r.records), ctx.lookup('campaigns').catch(() => []), ctx.lookup('channels')
    ]);
    const promoChannels = channels.filter(c => (record.channels || []).includes(c.id));
    ctx.state.current = record;
    const campaign = campaigns.find(c => c.id === record.campaignId);
    const linkedArts = arts.filter(a => a.originType === 'promotion' && a.originId === id);
    const body = `
      <dl class="facts">
        <div><dt>Período</dt><dd>${date(record.start)} a ${date(record.end)}</dd></div>
        <div><dt>Situação</dt><dd>${statusTag(PROMOTION_STATUS, record.status)} ${phaseTag(record)}</dd></div>
        <div><dt>Campanha</dt><dd>${campaign ? `<a href="#/campanhas/${esc(campaign.id)}">${esc(campaign.name)}</a>` : '—'}</dd></div>
        <div><dt>Aprovada por</dt><dd>${esc(record.approvedBy?.name || '—')}</dd></div>
        <div><dt>Vale em</dt><dd>${promoChannels.length ? esc(promoChannels.map(c => c.name).join(', ')) : '—'}</dd></div>
        <div><dt>Pedida por</dt><dd>${esc(record.createdBy?.name || '—')}</dd></div>
      </dl>
      ${record.description ? `<p class="prose">${esc(record.description)}</p>` : ''}
      ${whereItIs(record, promoChannels, ctx.user)}
      <section class="section"><h3>Produtos e preços</h3>${itemsTable(record, promoChannels)}</section>
      <section class="section"><div class="section-head"><h3>Artes (${num(linkedArts.length)})</h3>${button('Pedir arte', { action: 'request-art', icon: 'art', variant: 'ghost small' })}</div>
        ${linkedArts.length ? `<ul class="plain-list">${linkedArts.map(a => `<li><a href="#/artes/${esc(a.id)}">${esc(a.title)}</a>${statusTag(ART_STATUS, a.status)}</li>`).join('')}</ul>` : '<p class="muted">Nenhuma arte pedida ainda.</p>'}
      </section>
      ${notesSection(record)}`;
    const footer = [
      record.can.remove && record.status !== 'approved' ? button('Apagar', { action: 'remove', icon: 'trash', variant: 'ghost danger-text' }) : '',
      record.can.edit ? button('Editar', { action: 'edit', icon: 'edit', variant: 'ghost' }) : '',
      transitionButtons(record)
    ].join('');
    openDrawer({ eyebrow: statusTag(PROMOTION_STATUS, record.status), title: record.name, body, footer });
  },

  inputs: {
    'promo-net'(ctx, el) { updateNet(el.closest('form')); },
    'promo-search'(ctx, el) {
      clearTimeout(searchTimer);
      const form = el.closest('form');
      searchTimer = setTimeout(() => searchListings(form, el.value.trim()), 250);
    }
  },
  changes: {
    ...artChanges,
    status(ctx, el) { ctx.state.status = el.value; return ctx.refresh(); },
    'promo-channel'(ctx, el) {
      const form = el.closest('form');
      redrawRows(form);
      const term = form.querySelector('[data-input=promo-search]').value.trim();
      if (term.length >= 2) searchListings(form, term);
    },
    'promo-pick'(ctx, el) { updatePicked(el.closest('form')); },
    'promo-pick-all'(ctx, el) {
      const form = el.closest('form');
      form.querySelectorAll('[data-pick]:not(:disabled)').forEach(box => { box.checked = el.checked; });
      updatePicked(form);
    }
  },

  actions: {
    open(ctx, el) { ctx.navigate(`promocoes/${el.dataset.id}`); },
    new(ctx) { return openForm(ctx, null); },
    edit(ctx) { return openForm(ctx, ctx.state.current); },
    // Coloca na promoção todos os anúncios marcados na busca.
    'promo-add-picked'(ctx, el) {
      const form = el.closest('form');
      const picked = [...form.querySelectorAll('[data-pick]:checked:not(:disabled)')].map(box => JSON.parse(box.dataset.item));
      if (!picked.length) return toast('Marque pelo menos um produto da lista.', 'warn');
      const list = form.querySelector('[data-promo-chosen]');
      const first = list.children.length;
      list.insertAdjacentHTML('beforeend', picked.map(item => promoRow({ ...item, values: {} }, formChannels(form))).join(''));
      form.querySelector('[data-promo-results]').innerHTML = '';
      const search = form.querySelector('[data-input=promo-search]');
      search.value = '';
      (list.children[first]?.querySelector('[data-ch]') || search).focus();
      updateNet(form);
      toast(`${num(picked.length)} produto${picked.length === 1 ? '' : 's'} na promoção. Coloque os preços ou use "Dar X% em todos".`);
    },
    'promo-remove'(ctx, el) {
      const form = el.closest('form');
      el.closest('[data-promo-row]').remove();
      updateNet(form);
    },
    // "Dar 10% de desconto em todos": preenche cada preço a partir do preço normal de cada lugar.
    'promo-percent'(ctx, el) {
      const form = el.closest('form');
      const percent = Number(form.querySelector('[data-percent]').value);
      if (!(percent > 0 && percent < 100)) return toast('Digite um desconto entre 1 e 99%.', 'warn');
      const inputs = form.querySelectorAll('[data-ch]');
      if (!inputs.length) return toast('Coloque produtos na promoção primeiro.', 'warn');
      inputs.forEach(input => { input.value = (Math.round(Number(input.dataset.regular) * (100 - percent)) / 100).toFixed(2); });
      updateNet(form);
    },
    async 'channel-task'(ctx, el) {
      const record = ctx.state.current;
      await post(`/promotions/${record.id}/channel-task`, { channel: el.dataset.channel });
      toast('Anotado. Obrigado!');
      await reopen(ctx, record.id);
    },
    async transition(ctx, el) {
      const record = ctx.state.current;
      if (await runTransition({ entity: 'promotions', record, el, statuses: PROMOTION_STATUS, name: record.name })) {
        if (el.dataset.to === 'approved') toast('Aprovada. No site entra sozinha nas datas; na Shopee e no Mercado Livre virou tarefa para a equipe.');
        await reopen(ctx, record.id);
      }
    },
    async remove(ctx) {
      const record = ctx.state.current;
      if ((await confirmDialog({ title: 'Apagar promoção?', text: `“${esc(record.name)}” vai ser apagada.`, confirmLabel: 'Apagar', tone: 'danger' })) === null) return;
      await del(`/promotions/${record.id}`);
      toast('Promoção apagada.');
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
      data.items = readItems(form);
      data.channels = [].concat(data.channels || []);
      if (!data.items.length) throw new Error('Coloque pelo menos um produto na promoção.');
      if (!id) data.art = readArtRequest(data);
      const result = id ? await patch(`/promotions/${id}`, data) : await post('/promotions', data);
      const record = result.record;
      toast(id ? 'Promoção salva.' : record.createdArtId ? 'Promoção salva e arte pedida ao marketing.' : 'Promoção salva. Quando estiver pronta, mande para aprovação.');
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

// Linhas de uma promoção salva: o preço normal e onde está à venda vêm do anúncio de hoje.
async function savedRows(record) {
  const ids = record.items.map(i => i.queueId).filter(Boolean);
  const current = ids.length ? (await get('/promotions/candidates', { ids: ids.join(',') })).items : [];
  const byId = new Map(current.map(i => [i.queueId, i]));
  return record.items.map(i => {
    const now = byId.get(i.queueId);
    const values = i.channels ? Object.fromEntries(Object.entries(i.channels).map(([ch, p]) => [ch, p.promoPrice])) : {};
    if (now) return { ...now, values };
    // Anúncio que saiu de todos os lugares (ou promoção antiga, sem anúncio): só o nome, sem preço.
    return { queueId: i.queueId || '', name: i.name, sku: i.sku, prices: {}, listedOn: [], values };
  });
}

async function openForm(ctx, record, preset = null) {
  const [campaigns, channels, users] = await Promise.all([ctx.lookup('campaigns').catch(() => []), ctx.lookup('channels'), ctx.lookup('users')]);
  const r = record || preset || { items: [] };
  const rows = record ? await savedRows(record) : preset?.rows || [];
  const activeChannels = channels.filter(c => c.active !== false);
  const chosen = r.channels || ['site'];
  openModal({
    title: record ? 'Editar promoção' : 'Nova promoção',
    size: 'wide',
    body: `<form data-form="promotion" id="promotionForm" class="form-grid" data-id="${esc(record?.id || '')}" data-channels="${esc(JSON.stringify(activeChannels))}">
      ${field('name', 'Nome da promoção', { required: true, full: true, max: 120, value: r.name, placeholder: 'Ex.: Semana do pet — rações 15 kg' })}
      ${field('start', 'Começa em', { type: 'date', required: true, value: r.start })}
      ${field('end', 'Termina em', { type: 'date', required: true, value: r.end })}
      ${field('campaignId', 'Faz parte de uma campanha?', { type: 'select', full: true, value: r.campaignId, options: [['', 'Não'], ...campaigns.filter(c => c.status !== 'cancelled').map(c => [c.id, c.name])] })}
      <fieldset class="field full"><legend>1. Onde vale</legend><div class="chips">${activeChannels.map(c => `<label class="chip"><input type="checkbox" name="channels" value="${esc(c.id)}" data-change="promo-channel"${chosen.includes(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>
        <small class="hint">No site, a promoção entra e sai sozinha nas datas. Na Shopee e no Mercado Livre, a equipe recebe a tarefa de cadastrar lá.</small></fieldset>
      <div class="field full promo-picker">
        <span class="field-label">2. Produtos e preço da promoção <span class="req" aria-hidden="true">*</span></span>
        <div class="picker-search">${icon('search')}<input type="search" data-input="promo-search" placeholder="Buscar anúncio por nome ou código" autocomplete="off" aria-label="Buscar anúncio para a promoção"></div>
        <ul class="picker-results" data-promo-results aria-label="Anúncios encontrados (marque um ou vários)"></ul>
        <div class="promo-bulk"><span data-promo-count></span>
          <label class="promo-percent">Dar <input type="number" min="1" max="99" step="1" data-percent inputmode="numeric" aria-label="Porcentagem de desconto"> % de desconto em todos</label>
          ${button('Aplicar', { action: 'promo-percent', variant: 'ghost small' })}</div>
        <ul class="promo-rows" data-promo-chosen>${rows.map(row => promoRow(row, activeChannels.filter(c => chosen.includes(c.id)))).join('')}</ul>
        <small class="hint">Só aparecem anúncios que estão à venda nos lugares marcados. O preço normal de cada lugar vem do anúncio.</small>
      </div>
      ${field('description', 'Observações', { type: 'textarea', full: true, rows: 3, max: 3000, value: r.description })}
      ${record ? '' : artRequestSection(users, { title: 'Pedir a arte desta promoção' })}
      ${record?.status === 'approved' ? `<div class="full">${notice('Esta promoção já foi aprovada. Se você mudar e salvar, ela sai do site, volta para rascunho e precisa ser aprovada de novo.', 'warn')}</div>` : ''}
      <div class="form-error full" aria-live="polite"></div>
    </form>`,
    footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button class="btn primary" type="submit" form="promotionForm">${icon('check')}<span>${record ? 'Salvar' : 'Salvar promoção'}</span></button>`
  });
  updateNet(document.getElementById('promotionForm'));
}
