// Fila de publicação: quadro por etapa e ficha completa do item (canais e preços, conteúdo, publicação por canal, histórico).
import { get, post, patch } from '../api.js';
import {
  esc, icon, tag, money, num, date, dateTime, relative, pageHead, empty, notice, button, field,
  openDrawer, openModal, closeTopLayer, closeLayers, toast, confirmDialog, statusTag
} from '../ui.js';
import { QUEUE_STAGES, QUEUE_FLOW, PRIORITIES, LISTING_STATUS } from '../../shared/domain.js';
import { pricingEditor, pricingSummary, readPricing, pricingInputs, pricingChanges } from './pricing.js';

const TABS = [['flow', 'Em andamento'], ['blocked', 'Bloqueados'], ['archived', 'Arquivados']];

const inProgressLabel = n => (n === 1 ? '1 item em andamento' : `${num(n)} itens em andamento`);
const listingsOf = item => (item.channels || []).map(c => ({ channel: c, listing: item.listings?.[c.id] || { status: 'idle' } }));

function card(item) {
  const urgent = ['Alta', 'Urgente'].includes(item.priority);
  const failed = listingsOf(item).some(l => l.listing.status === 'failed');
  const first = item.channels?.[0];
  return `<li><button class="q-card${failed ? ' has-error' : ''}" data-action="open" data-id="${esc(item.id)}">
    <span class="q-card-top">${urgent ? tag(item.priority, item.priority === 'Urgente' ? 'danger' : 'warn') : ''}${failed ? tag('Falha ao publicar', 'danger') : ''}</span>
    <strong class="q-title">${esc(item.productSnapshot.name)}</strong>
    <span class="q-meta mono">SKU ${esc(item.productSnapshot.sku || '—')}</span>
    ${first ? `<span class="q-price"><span class="mono">${money(first.price)}</span>${first.promoPrice ? `<span class="q-promo mono">promo ${money(first.promoPrice)}</span>` : ''}</span>` : ''}
    <span class="q-channels">${listingsOf(item).map(({ channel, listing }) => `<span class="q-chan${listing.status === 'done' ? ' is-done' : ''}" title="${esc(channel.name)}: ${esc(LISTING_STATUS[listing.status]?.label || '')}">${esc(channel.name.split(' ')[0])}</span>`).join('')}</span>
    <span class="q-foot">${icon('history')}${esc(relative(item.updatedAt))}</span>
  </button></li>`;
}

const view = {
  id: 'fila',
  title: 'Fila de publicação',
  icon: 'queue',
  group: 'Operação',

  async load({ route, state }) {
    if (route.query?.etapa) {
      state.focus = route.query.etapa;
      state.tab = ['blocked', 'archived'].includes(route.query.etapa) ? route.query.etapa : 'flow';
    }
    state.tab ??= 'flow';
    return get('/queue');
  },

  render({ user, state, data }) {
    const items = data.items;
    const count = stage => items.filter(i => i.stage === stage).length;
    const lead = {
      owner: 'Você aprova o que o site preparou. A publicação só acontece depois da sua aprovação.',
      manager: 'Acompanhe a preparação e aprove quando estiver autorizado.',
      site: 'Prepare foto, descrição e SEO; envie para aprovação; publique em cada canal o que for aprovado.',
      marketing: 'Veja quais produtos estão indo à venda para planejar as artes.'
    }[user.role];
    const tabs = `<div class="tabs" role="tablist">${TABS.map(([key, label]) => {
      const n = key === 'flow' ? items.filter(i => QUEUE_FLOW.includes(i.stage)).length : count(key);
      return `<button role="tab" class="tab${state.tab === key ? ' is-active' : ''}" aria-selected="${state.tab === key}" data-action="tab" data-tab="${key}">${label} <span class="mono">${num(n)}</span></button>`;
    }).join('')}</div>`;

    let content;
    if (!items.length) {
      content = `<section class="panel">${empty({
        title: 'A fila está vazia',
        text: user.role === 'owner' ? 'Em Produtos e estoque, clique em “Colocar à venda” e escolha os canais.' : 'Quando o dono escolher produtos para vender, eles aparecem aqui.',
        action: user.role === 'owner' ? `<a class="btn primary" href="#/produtos">${icon('box')}<span>Escolher produtos</span></a>` : '',
        ic: 'queue'
      })}</section>`;
    } else if (state.tab === 'flow') {
      content = `<div class="board" aria-label="Quadro da fila de publicação">${QUEUE_FLOW.map(stage => {
        const list = items.filter(i => i.stage === stage);
        const s = QUEUE_STAGES[stage];
        return `<section class="board-col${state.focus === stage ? ' is-focus' : ''}" aria-labelledby="col-${stage}">
          <header class="board-head tone-${s.tone}"><h2 id="col-${stage}">${esc(s.label)}</h2><span class="mono">${num(list.length)}</span></header>
          ${list.length ? `<ul class="board-list">${list.map(card).join('')}</ul>` : `<p class="board-empty">${esc(s.hint)}</p>`}
        </section>`;
      }).join('')}</div>`;
    } else {
      const list = items.filter(i => i.stage === state.tab);
      content = list.length ? `<section class="panel flush"><ul class="board-list as-rows">${list.map(card).join('')}</ul></section>`
        : `<section class="panel">${empty({ title: state.tab === 'blocked' ? 'Nada bloqueado' : 'Nada arquivado', ic: 'archive' })}</section>`;
    }
    return `${pageHead({ eyebrow: inProgressLabel(items.filter(i => !['published', 'archived'].includes(i.stage)).length), title: 'Fila de publicação', lead })}
      ${tabs}${content}`;
  },

  async open(ctx, id) {
    const [{ item }, { entries }] = await Promise.all([
      get(`/queue/${encodeURIComponent(id)}`),
      get('/audit', { entity: 'queue', entityId: id, limit: 50 }).catch(() => ({ entries: [] }))
    ]);
    ctx.state.current = item;
    const [campaigns, channels] = await Promise.all([ctx.lookup('campaigns').catch(() => []), ctx.lookup('channels')]);
    openDrawer({
      eyebrow: `${statusTag(QUEUE_STAGES, item.stage)}`,
      title: item.productSnapshot.name,
      body: renderItem(ctx, item, entries, campaigns, channels),
      footer: renderFooter(item)
    });
  },

  changes: { ...pricingChanges },

  inputs: {
    ...pricingInputs,
    counter(ctx, el) {
      const out = el.closest('.field').querySelector('.counter');
      if (out) out.textContent = `${el.value.length}/${el.maxLength}`;
    },
    mediaSearch(ctx, el) {
      clearTimeout(mediaTimer);
      mediaTimer = setTimeout(() => loadMedia(el.value), 250);
    }
  },

  actions: {
    tab(ctx, el) { ctx.state.tab = el.dataset.tab; ctx.state.focus = null; ctx.rerender(); },
    open(ctx, el) { ctx.navigate(`fila/${el.dataset.id}`); },

    async transition(ctx, el) {
      const item = ctx.state.current;
      const { to, requires, label } = el.dataset;
      const note = await confirmDialog({
        title: label,
        text: `${esc(item.productSnapshot.name)} vai para <strong>${esc(QUEUE_STAGES[to].label)}</strong>.`,
        confirmLabel: label,
        tone: to === 'blocked' || to === 'archived' ? 'danger' : 'primary',
        noteLabel: requires === 'note' ? 'Motivo (a equipe vai ler)' : 'Observação (opcional)',
        noteRequired: requires === 'note'
      });
      if (note === null) return;
      await post(`/queue/${item.id}/transition`, { to, note });
      toast(`${item.productSnapshot.name}: ${QUEUE_STAGES[to].label}.`);
      await afterChange(ctx, item.id);
    },

    async publish(ctx, el) {
      const item = ctx.state.current;
      const channel = item.channels.find(c => c.id === el.dataset.channel);
      const ok = await confirmDialog({
        title: `Publicar em ${channel.name}?`,
        text: `O anúncio será criado com preço ${money(channel.price)}${channel.promoPrice ? ` e promoção ${money(channel.promoPrice)}` : ''}.${channel.integration === 'nuvemshop' ? ' As fotos de <span class="mono">media/</span> são enviadas pelo servidor da loja.' : ''}`,
        confirmLabel: 'Publicar agora'
      });
      if (ok === null) return;
      try {
        const result = await post(`/queue/${item.id}/publish`, { channel: channel.id });
        toast(`Publicado em ${channel.name}.`);
        if (result.warnings?.length) toast('Publicado, mas houve aviso nas imagens: ' + result.warnings[0], 'warn');
      } catch (error) {
        toast(error.message, ['NOT_CONFIGURED', 'NOT_IMPLEMENTED'].includes(error.details?.code) ? 'warn' : 'danger');
      }
      await afterChange(ctx, item.id);
    },

    // Canal sem integração automática: a pessoa anuncia no painel do canal e registra o link aqui.
    'manual-listing'(ctx, el) {
      const item = ctx.state.current;
      const channel = item.channels.find(c => c.id === el.dataset.channel);
      openModal({
        title: `Registrar anúncio em ${channel.name}`,
        body: `<form data-form="manualListing" id="manualForm" class="form-grid" data-channel="${esc(channel.id)}">
          <p class="full lead">Use quando o anúncio foi criado direto no painel do canal. Fica registrado que foi feito à mão, por você.</p>
          ${field('url', 'Link do anúncio', { type: 'url', full: true, placeholder: 'https://…' })}
          ${field('externalId', 'Código do anúncio (opcional)', { full: true, max: 120 })}
          ${field('note', 'Observação (opcional)', { full: true, max: 500 })}
          <div class="form-error full"></div>
        </form>`,
        footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button type="submit" class="btn primary" form="manualForm">Registrar anúncio</button>`
      });
    },

    'pick-media'(ctx) {
      openModal({
        title: 'Escolher arquivo de media/',
        size: 'wide',
        body: `<label class="search">${icon('search')}<span class="sr-only">Buscar arquivo</span><input type="search" data-input="mediaSearch" placeholder="Nome do arquivo" autocomplete="off"></label><div id="mediaList" class="media-list" aria-live="polite">Carregando…</div>`
      });
      loadMedia('');
    },
    'add-media'(ctx, el) {
      const textarea = document.querySelector('#contentForm textarea[name=imageRefs]');
      if (!textarea) return;
      const refs = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!refs.includes(el.dataset.ref)) refs.push(el.dataset.ref);
      textarea.value = refs.join('\n');
      closeTopLayer();
      toast('Referência adicionada. Salve o conteúdo para gravar.', 'info');
    }
  },

  forms: {
    async pricing(ctx, data, form) {
      const item = ctx.state.current;
      await patch(`/queue/${item.id}/pricing`, { ...data, ...readPricing(form) });
      toast('Canais e preços salvos.');
      await afterChange(ctx, item.id);
    },
    async manualListing(ctx, data, form) {
      const item = ctx.state.current;
      await post(`/queue/${item.id}/listings/${form.dataset.channel}`, data);
      closeTopLayer();
      toast('Anúncio registrado.');
      await afterChange(ctx, item.id);
    },
    async content(ctx, data) {
      const item = ctx.state.current;
      data.imageRefs = String(data.imageRefs || '').split('\n').map(s => s.trim()).filter(Boolean);
      await patch(`/queue/${item.id}/content`, data);
      toast('Conteúdo do site salvo.');
      await afterChange(ctx, item.id);
    }
  }
};
export default view;

let mediaTimer;
async function loadMedia(search) {
  const box = document.getElementById('mediaList');
  if (!box) return;
  try {
    const result = await get('/media', { search });
    if (!result.available) {
      box.innerHTML = notice('A pasta media/ só é acessível no servidor da loja. Digite o caminho manualmente (ex.: produtos/racao-15kg.jpg).', 'info');
      return;
    }
    box.innerHTML = result.files.length
      ? `<ul>${result.files.map(f => `<li><button class="media-item" data-action="add-media" data-ref="${esc(f.ref)}">${icon(f.image ? 'image' : 'file')}<span class="mono">${esc(f.ref)}</span><small>${num(Math.ceil(f.size / 1024))} KB · ${esc(relative(f.modifiedAt))}</small></button></li>`).join('')}</ul>`
      : empty({ title: 'Nenhum arquivo encontrado', text: 'Coloque as fotos na pasta media/ do servidor da loja.', ic: 'folder' });
  } catch (error) {
    box.innerHTML = notice(esc(error.message), 'danger');
  }
}

// Recarrega o quadro e reabre a ficha com os dados novos.
async function afterChange(ctx, id) {
  ctx.invalidate();
  await ctx.refresh();
  ctx.refreshBadges();
  await view.open(ctx, id);
}

// Ordem do rodapé: ações destrutivas à esquerda, avanço principal à direita.
const FOOTER_ORDER = { archived: 0, blocked: 1, preparing: 2, selected: 3, review: 4, approved: 5 };
function renderFooter(item) {
  const transitions = [...item.transitions].sort((a, b) => (FOOTER_ORDER[a.to] ?? 3) - (FOOTER_ORDER[b.to] ?? 3));
  const buttons = transitions.map(t => button(t.label, {
    action: 'transition',
    variant: t.to === 'approved' ? 'primary' : ['blocked', 'archived'].includes(t.to) ? 'ghost danger-text' : t.to === 'review' ? 'primary' : 'ghost',
    data: { to: t.to, requires: t.requires || '', label: t.label }
  }));
  return buttons.join('');
}

function renderItem(ctx, item, entries, campaigns, channels) {
  const p = item.productSnapshot;
  const c = item.content || {};
  const campaign = campaigns.find(x => x.id === item.campaignId);
  const stepIndex = QUEUE_FLOW.indexOf(item.stage);

  const steps = `<ol class="steps" aria-label="Progresso">${QUEUE_FLOW.map((s, i) => `<li class="${i < stepIndex ? 'is-done' : i === stepIndex ? 'is-current' : ''}"${i === stepIndex ? ' aria-current="step"' : ''}>${esc(QUEUE_STAGES[s].label)}</li>`).join('')}</ol>`;

  const facts = `<dl class="facts">
    <div><dt>SKU</dt><dd class="mono">${esc(p.sku || '—')}</dd></div>
    <div><dt>Estoque (UniPlus)</dt><dd class="mono">${num(p.stock)}</dd></div>
    <div><dt>Preço no UniPlus</dt><dd class="mono">${money(p.basePrice)}</dd></div>
    <div><dt>Período da promoção</dt><dd>${item.promoStart ? `${date(item.promoStart)} a ${date(item.promoEnd)}` : '—'}</dd></div>
    <div><dt>Prioridade</dt><dd>${esc(item.priority)}</dd></div>
    <div><dt>Campanha</dt><dd>${campaign ? `<a href="#/campanhas/${esc(campaign.id)}">${esc(campaign.name)}</a>` : '—'}</dd></div>
    <div><dt>Selecionado por</dt><dd>${esc(item.requestedBy?.name || '—')} <small>${date(item.createdAt)}</small></dd></div>
  </dl>
  ${item.notes ? `<blockquote class="note-quote"><span>Observação do dono</span>${esc(item.notes)}</blockquote>` : ''}
  <section class="section"><h3>Canais e preços</h3>${pricingSummary(item, { showCost: ['owner', 'manager'].includes(ctx.user.role) })}</section>`;

  const pricing = item.can.editPricing ? `
    <details class="section">
      <summary><h3>Alterar canais, preços e prioridade</h3></summary>
      <form data-form="pricing" class="form-grid">
        <div class="full">${pricingEditor({ channels, product: p, selected: item.channels, promoStart: item.promoStart, promoEnd: item.promoEnd, showCost: ['owner', 'manager'].includes(ctx.user.role) })}</div>
        ${field('priority', 'Prioridade', { type: 'select', options: PRIORITIES, value: item.priority })}
        ${field('campaignId', 'Campanha', { type: 'select', value: item.campaignId, options: [['', 'Nenhuma'], ...campaigns.map(x => [x.id, x.name])] })}
        ${field('notes', 'Observação para quem prepara o anúncio', { type: 'textarea', full: true, rows: 2, value: item.notes, max: 2000 })}
        <div class="form-error full" aria-live="polite"></div>
        <div class="full form-actions"><button class="btn" type="submit">${icon('check')}<span>Salvar canais e preços</span></button></div>
      </form>
    </details>` : '';

  const mediaRows = (item.mediaCheck || []).map(m => `<li>${icon('image')}<span class="mono">${esc(m.ref)}</span>${m.exists === true ? tag('Encontrado', 'ok') : m.exists === false ? tag('Não encontrado em media/', 'danger') : tag('Verificar no servidor da loja', 'muted')}</li>`).join('');
  const content = item.can.editContent ? `
    <section class="section">
      <h3>Conteúdo do site</h3>
      <form data-form="content" class="form-grid" id="contentForm">
        ${field('title', 'Título do produto na loja', { full: true, value: c.title, max: 160, required: true })}
        ${field('description', 'Descrição', { type: 'textarea', full: true, rows: 7, value: c.description, max: 20000, hint: 'Mínimo de 30 caracteres para enviar à aprovação. Conte para que serve, medidas, composição e indicação.' })}
        <div class="field full"><label for="seoTitle">Título SEO</label><input id="seoTitle" name="seoTitle" maxlength="70" value="${esc(c.seoTitle)}" data-input="counter"><small class="hint counter">${(c.seoTitle || '').length}/70</small></div>
        <div class="field full"><label for="seoDescription">Descrição SEO</label><textarea id="seoDescription" name="seoDescription" maxlength="320" rows="2" data-input="counter">${esc(c.seoDescription)}</textarea><small class="hint counter">${(c.seoDescription || '').length}/320</small></div>
        ${field('category', 'Categoria na loja', { full: true, value: c.category, max: 120 })}
        <div class="field full"><label for="imageRefs">Fotos (uma por linha, caminho dentro de media/)</label>
          <textarea id="imageRefs" name="imageRefs" class="mono" rows="3" placeholder="produtos/racao-premium-15kg-frente.jpg">${esc((c.imageRefs || []).join('\n'))}</textarea>
          <div class="inline-actions">${button('Escolher de media/', { action: 'pick-media', icon: 'folder', variant: 'ghost small' })}</div>
        </div>
        ${mediaRows ? `<ul class="media-check full">${mediaRows}</ul>` : ''}
        ${field('siteNotes', 'Observações do site', { type: 'textarea', full: true, rows: 2, value: c.siteNotes, max: 2000 })}
        <div class="form-error full" aria-live="polite"></div>
        <div class="full form-actions"><button class="btn" type="submit">${icon('check')}<span>Salvar conteúdo</span></button></div>
      </form>
    </section>` : `
    <section class="section">
      <h3>Conteúdo do site</h3>
      <dl class="facts one-col">
        <div><dt>Título</dt><dd>${esc(c.title || '—')}</dd></div>
        <div><dt>Descrição</dt><dd class="prose">${c.description ? esc(c.description).replaceAll('\n', '<br>') : '<span class="muted">Ainda não preenchida</span>'}</dd></div>
        <div><dt>Título SEO</dt><dd>${esc(c.seoTitle || '—')}</dd></div>
        <div><dt>Descrição SEO</dt><dd>${esc(c.seoDescription || '—')}</dd></div>
        <div><dt>Categoria</dt><dd>${esc(c.category || '—')}</dd></div>
        <div><dt>Observações do site</dt><dd>${esc(c.siteNotes || '—')}</dd></div>
      </dl>
      ${mediaRows ? `<ul class="media-check">${mediaRows}</ul>` : '<p class="muted">Nenhuma foto indicada.</p>'}
    </section>`;

  const publication = ['approved', 'published'].includes(item.stage) || listingsOf(item).some(l => l.listing.attempts) ? `
    <section class="section">
      <h3>Publicação por canal</h3>
      <ul class="listing-list">${listingsOf(item).map(({ channel, listing }) => {
        const status = LISTING_STATUS[listing.status] || LISTING_STATUS.idle;
        const auto = channel.integration === 'nuvemshop';
        const actions = item.can.publish && listing.status !== 'done' ? [
          button(listing.status === 'failed' ? 'Tentar de novo' : 'Publicar', { action: 'publish', icon: 'send', variant: auto ? 'primary small' : 'ghost small', data: { channel: channel.id } }),
          auto ? '' : button('Registrar anúncio feito à mão', { action: 'manual-listing', icon: 'check', variant: 'small', data: { channel: channel.id } })
        ].join('') : '';
        return `<li class="listing">
          <div class="listing-head"><strong>${esc(channel.name)}</strong>${tag(status.label, status.tone)}${listing.manual ? tag('registrado à mão', 'neutral') : ''}</div>
          <p class="listing-meta">
            ${listing.publishedAt ? `Publicado ${dateTime(listing.publishedAt)}${listing.by ? ` por ${esc(listing.by)}` : ''}` : listing.attempts ? `${num(listing.attempts)} tentativa(s) · última ${dateTime(listing.lastAttemptAt)}` : 'Ainda não publicado'}
            ${listing.externalId ? ` · código <span class="mono">${esc(listing.externalId)}</span>` : ''}
            ${listing.url ? ` · <a href="${esc(listing.url)}" target="_blank" rel="noopener noreferrer">ver anúncio ${icon('external')}</a>` : ''}
          </p>
          ${listing.lastError ? notice(esc(listing.lastError), listing.status === 'failed' ? 'danger' : 'warn') : ''}
          ${listing.imageWarnings?.length ? notice(`<strong>Imagens:</strong> ${listing.imageWarnings.map(esc).join('<br>')}`, 'warn') : ''}
          ${actions ? `<div class="listing-actions">${actions}</div>` : ''}
        </li>`;
      }).join('')}</ul>
    </section>` : '';

  const stageHistory = (item.stageHistory || []).slice().reverse();
  const historyHtml = `
    <section class="section">
      <h3>Histórico</h3>
      ${stageHistory.length || entries.length ? `<ul class="timeline">
        ${stageHistory.map(h => `<li><span class="tl-when">${dateTime(h.at)}</span><span class="tl-what"><strong>${esc(h.by)}</strong> moveu para ${statusTag(QUEUE_STAGES, h.to)}${h.note ? `<q>${esc(h.note)}</q>` : ''}</span></li>`).join('')}
        ${entries.filter(e => e.action !== 'queue.stage').map(e => `<li><span class="tl-when">${dateTime(e.at)}</span><span class="tl-what"><strong>${esc(e.actorName)}</strong> ${esc(e.summary)}</span></li>`).join('')}
      </ul>` : '<p class="muted">Sem movimentações ainda.</p>'}
    </section>`;

  return `${steps}${item.stage === 'blocked' ? notice('Item bloqueado. Veja o motivo no histórico.', 'danger') : ''}${facts}${pricing}${content}${publication}${historyHtml}`;
}
