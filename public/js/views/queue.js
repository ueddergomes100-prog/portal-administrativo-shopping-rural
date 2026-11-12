// Anúncios (fila de publicação): etapas uma embaixo da outra, a que precisa de você primeiro, e a ficha
// completa do item (canais e preços, conteúdo, publicação por canal, histórico).
import { get, post, patch, del } from '../api.js';
import {
  esc, icon, tag, money, num, date, dateTime, relative, pageHead, empty, notice, button, field,
  openDrawer, openModal, closeTopLayer, closeLayers, toast, confirmDialog, statusTag
} from '../ui.js';
import { QUEUE_STAGES, QUEUE_FLOW, PRIORITIES, LISTING_STATUS, SITE_CATEGORIES, SITE_PETS, SITE_UNITS, SITE_TAGS, canApprove } from '../../shared/domain.js';
import { pricingEditor, pricingSummary, readPricing, pricingInputs, pricingChanges } from './pricing.js';
import { uploadFile } from '../upload.js';
import { prepareProductPhoto, photoFile, canUndoCut, rememberOriginal, originalOf, forgetOriginal } from '../photo-studio.js';

const TABS = [['flow', 'Em andamento'], ['blocked', 'Pausados'], ['archived', 'Guardados']];

const inProgressLabel = n => (n === 1 ? '1 produto a caminho da venda' : `${num(n)} produtos a caminho da venda`);
const listingsOf = item => (item.channels || []).map(c => ({ channel: c, listing: item.listings?.[c.id] || { status: 'idle' } }));

// Etapas em que a próxima ação é de quem está olhando: aparecem primeiro, em destaque.
function yourStages(user) {
  if (user.role === 'site') return ['selected', 'preparing', 'approved'];
  return canApprove(user) ? ['review'] : [];
}

// Como funciona, em quatro passos (a ordem é o próprio fluxo, por isso numerada).
const HOW = [
  ['Escolher', 'O dono escolhe o produto e onde vender, em Produtos.'],
  ['Preparar', 'Fotos e texto do anúncio. Quem faz é a pessoa das vendas na internet ou o próprio dono.'],
  ['Aprovar', 'O dono ou o gerente confere e aprova.'],
  ['Vender', 'Depois de aprovado, “Colocar à venda no site” (e anunciar na Shopee e no Mercado Livre).']
];

function card(item) {
  const urgent = ['Alta', 'Urgente'].includes(item.priority);
  const failed = listingsOf(item).some(l => l.listing.status === 'failed');
  const first = item.channels?.[0];
  return `<li><button class="q-card${failed ? ' has-error' : ''}" data-action="open" data-id="${esc(item.id)}">
    <span class="q-card-top">${urgent ? tag(item.priority, item.priority === 'Urgente' ? 'danger' : 'warn') : ''}${failed ? tag('Não deu certo', 'danger') : ''}</span>
    <strong class="q-title">${esc(item.productSnapshot.name)}</strong>
    ${first ? `<span class="q-price"><span class="mono">${money(first.price)}</span>${first.promoPrice ? `<span class="q-promo mono">na promoção ${money(first.promoPrice)}</span>` : ''}</span>` : ''}
    <span class="q-channels" aria-label="Onde vai vender">${listingsOf(item).map(({ channel, listing }) => `<span class="q-chan${listing.status === 'done' ? ' is-done' : ''}">${listing.status === 'done' ? icon('check') : ''}${esc(channel.name)}</span>`).join('')}</span>
    <span class="q-foot">Atualizado ${esc(relative(item.updatedAt))} · código ${esc(item.productSnapshot.sku || '—')}</span>
    <span class="q-open">Abrir ${icon('arrow')}</span>
  </button></li>`;
}

const view = {
  id: 'fila',
  title: 'Anúncios',
  icon: 'queue',

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
      owner: 'Aqui estão os produtos que você escolheu para vender na internet. Nada vai para a venda sem a sua aprovação.',
      manager: 'Acompanhe os produtos que estão sendo preparados para vender na internet.',
      site: 'Prepare as fotos e o texto, mande para aprovação e, depois de aprovado, coloque à venda.',
      marketing: 'Veja quais produtos vão entrar à venda, para planejar as artes.'
    }[user.role];
    const yours = yourStages(user);
    const tabs = `<div class="tabs" role="tablist">${TABS.map(([key, label]) => {
      const n = key === 'flow' ? items.filter(i => QUEUE_FLOW.includes(i.stage)).length : count(key);
      return `<button role="tab" class="tab${state.tab === key ? ' is-active' : ''}" aria-selected="${state.tab === key}" data-action="tab" data-tab="${key}">${label} <span class="mono">${num(n)}</span></button>`;
    }).join('')}</div>`;

    let content;
    if (!items.length) {
      content = `<section class="panel">${empty({
        title: 'Nenhum produto escolhido ainda',
        text: user.role === 'owner' ? 'Em Produtos, toque em “Colocar à venda” e escolha onde vender.' : 'Quando o dono escolher produtos para vender, eles aparecem aqui.',
        action: user.role === 'owner' ? `<a class="btn primary" href="#/produtos">${icon('box')}<span>Escolher produtos</span></a>` : '',
        ic: 'queue'
      })}</section>`;
    } else if (state.tab === 'flow') {
      // A etapa que espera por você vem primeiro; as outras seguem a ordem do caminho.
      const order = [...QUEUE_FLOW.filter(s => yours.includes(s)), ...QUEUE_FLOW.filter(s => !yours.includes(s))];
      content = `<div class="board" aria-label="Produtos por etapa">${order.map(stage => {
        const list = items.filter(i => i.stage === stage);
        const s = QUEUE_STAGES[stage];
        const mine = yours.includes(stage) && list.length;
        return `<section class="board-col${state.focus === stage ? ' is-focus' : ''}${mine ? ' is-yours' : ''}${list.length ? '' : ' is-empty'}" aria-labelledby="col-${stage}">
          <header class="board-head tone-${s.tone}">
            <h2 id="col-${stage}">${esc(s.label)} <span class="board-count">${num(list.length)}</span></h2>
            ${mine ? '<span class="yours-pill">Precisa de você</span>' : ''}
            <p class="board-hint">${esc(s.hint)}</p>
          </header>
          ${list.length ? `<ul class="board-list">${list.map(card).join('')}</ul>` : ''}
        </section>`;
      }).join('')}</div>`;
    } else {
      const list = items.filter(i => i.stage === state.tab);
      content = list.length ? `<section class="panel flush"><ul class="board-list as-rows">${list.map(card).join('')}</ul></section>`
        : `<section class="panel">${empty({ title: state.tab === 'blocked' ? 'Nenhum produto pausado' : 'Nenhum produto guardado', ic: 'archive' })}</section>`;
    }
    const how = `<ol class="how" aria-label="Como funciona">${HOW.map(([title, text]) => `<li><strong>${esc(title)}</strong><span>${esc(text)}</span></li>`).join('')}</ol>`;
    return `${pageHead({ eyebrow: inProgressLabel(items.filter(i => !['published', 'archived'].includes(i.stage)).length), title: 'Anúncios', lead })}
      ${how}${tabs}${content}`;
  },

  async open(ctx, id) {
    const [{ item }, { entries }] = await Promise.all([
      get(`/queue/${encodeURIComponent(id)}`),
      get('/audit', { entity: 'queue', entityId: id, limit: 50 }).catch(() => ({ entries: [] }))
    ]);
    ctx.state.current = item;
    // Produto do UniPlus (com as embalagens) só para quem pode mudar o preço / a forma de venda.
    const [campaigns, channels, product] = await Promise.all([
      ctx.lookup('campaigns').catch(() => []), ctx.lookup('channels'),
      item.can?.editPricing ? get(`/products/${encodeURIComponent(item.productId)}`).then(r => r.product).catch(() => null) : null
    ]);
    openDrawer({
      eyebrow: `${statusTag(QUEUE_STAGES, item.stage)}`,
      title: item.productSnapshot.name,
      body: renderItem(ctx, item, entries, campaigns, channels, product),
      footer: renderFooter(item)
    });
  },

  changes: {
    ...pricingChanges,
    // Fotos escolhidas no computador: passam pelo estúdio, sobem e já entram na lista (salvar grava no anúncio).
    async 'upload-photos'(ctx, el) {
      const files = [...el.files];
      el.value = '';
      await addPhotos(files);
    }
  },

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
        noteLabel: requires === 'note' ? 'Explique o motivo (a equipe vai ler)' : 'Recado (se quiser)',
        noteRequired: requires === 'note'
      });
      if (note === null) return;
      await post(`/queue/${item.id}/transition`, { to, note });
      toast(`${item.productSnapshot.name}: ${QUEUE_STAGES[to].label}.`);
      await afterChange(ctx, item.id);
    },

    async 'publish-site'(ctx) {
      const item = ctx.state.current;
      const channel = item.channels.find(c => c.integration === 'site');
      const ok = await confirmDialog({
        title: 'Colocar à venda no site?',
        text: `O produto vai aparecer no site por ${money(channel.price)}${channel.promoPrice ? ` (na promoção, ${money(channel.promoPrice)} de ${date(item.promoStart)} a ${date(item.promoEnd)})` : ''}. O estoque e o preço continuam se atualizando sozinhos.`,
        confirmLabel: 'Colocar à venda no site'
      });
      if (ok === null) return;
      await post(`/queue/${item.id}/site`);
      toast('Produto à venda no site.');
      await afterChange(ctx, item.id);
    },

    async 'remove-listing'(ctx, el) {
      const item = ctx.state.current;
      const channel = item.channels.find(c => c.id === el.dataset.channel);
      const site = channel.integration === 'site';
      const ok = await confirmDialog({
        title: site ? 'Tirar do site?' : `Desmarcar o anúncio em ${channel.name}?`,
        text: site ? 'O produto sai do site na hora. Dá para colocar de novo depois.' : `${esc(channel.name)} volta para “Falta colocar à venda”. Se precisar, pause também o anúncio lá em ${esc(channel.name)}.`,
        confirmLabel: site ? 'Tirar do site' : 'Desmarcar',
        tone: 'danger'
      });
      if (ok === null) return;
      await del(`/queue/${item.id}/listings/${channel.id}`);
      toast(site ? 'Produto tirado do site.' : `Anúncio em ${channel.name} desmarcado.`);
      await afterChange(ctx, item.id);
    },

    // Marketplace: a pessoa anunciou no painel do canal e registra aqui o link.
    'record-listing'(ctx, el) {
      const item = ctx.state.current;
      const channel = item.channels.find(c => c.id === el.dataset.channel);
      const listing = item.listings?.[channel.id] || {};
      openModal({
        title: `${listing.status === 'done' ? 'Atualizar anúncio' : 'Anúncio feito'} em ${channel.name}`,
        body: `<form data-form="recordListing" id="listingForm" class="form-grid" data-channel="${esc(channel.id)}">
          <div class="full callout-plain">
            <p><strong>Anuncie com estes valores:</strong></p>
            <p class="mono">Preço ${money(channel.price)}${channel.promoPrice ? ` · na promoção ${money(channel.promoPrice)} de ${date(item.promoStart)} a ${date(item.promoEnd)}` : ''}</p>
            <p class="hint">O título, a descrição e as fotos estão em “Texto e fotos do anúncio”, nesta mesma tela.</p>
          </div>
          ${field('url', 'Link do anúncio', { type: 'url', full: true, placeholder: 'https://…', value: listing.url || '', hint: 'Copie o endereço da página do anúncio e cole aqui.' })}
          ${field('externalId', 'Número do anúncio (se não tiver o link)', { full: true, max: 120, value: listing.externalId || '' })}
          ${field('note', 'Recado (se quiser)', { full: true, max: 500 })}
          <div class="form-error full"></div>
        </form>`,
        footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button type="submit" class="btn primary" form="listingForm">Salvar anúncio</button>`
      });
    },

    'pick-media'(ctx) {
      openModal({
        title: 'Escolher foto do computador da loja',
        size: 'wide',
        body: `<label class="search">${icon('search')}<span class="sr-only">Buscar foto</span><input type="search" data-input="mediaSearch" placeholder="Nome do arquivo" autocomplete="off"></label><div id="mediaList" class="media-list" aria-live="polite">Carregando…</div>`
      });
      loadMedia('');
    },
    'add-media'(ctx, el) {
      addPhoto(el.dataset.ref);
      closeTopLayer();
      toast('Foto colocada. Toque em “Salvar texto e fotos” para guardar.', 'info');
    },
    // Botão "Colar imagem" (celular e quem não usa Ctrl+V). O navegador pede permissão na primeira vez.
    async 'paste-photo'() {
      let items;
      try {
        items = await navigator.clipboard.read();
      } catch {
        toast('Não deu para ler a área de transferência. Copie a imagem e aperte Ctrl+V nesta tela.', 'warn');
        return;
      }
      const files = [];
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) files.push(new File([await item.getType(type)], `colada.${type.split('/')[1] || 'png'}`, { type }));
      }
      if (!files.length) return toast('Nenhuma imagem copiada. Clique na imagem com o botão direito → “Copiar imagem” e tente de novo.', 'warn');
      await addPhotos(files);
    },
    'photo-first'(ctx, el) {
      const li = el.closest('[data-photo]');
      li.parentElement.prepend(li);
    },
    'photo-remove'(ctx, el) {
      el.closest('[data-photo]').remove();
    },
    // Recorte ruim: refaz a foto inteira (com o fundo original, ainda no quadrado padrão) no mesmo lugar.
    async 'photo-whole'(ctx, el) {
      const li = el.closest('[data-photo]');
      const ref = li?.querySelector('input[name="imageRefs"]')?.value;
      const file = ref && originalOf(ref);
      if (!file) return;
      el.disabled = true;
      el.textContent = 'Refazendo…';
      try {
        const { blob } = await prepareProductPhoto(file, { removeBackground: false });
        const { ref: whole } = await uploadFile(photoFile(blob, file), 'product', { prepared: true });
        forgetOriginal(ref);
        li.outerHTML = photoItem(whole);
        toast('Pronto: a foto voltou inteira. Toque em “Salvar texto e fotos” para guardar.', 'info');
      } catch (error) {
        el.disabled = false;
        el.textContent = 'Desfazer recorte';
        throw error;
      }
    }
  },

  forms: {
    async pricing(ctx, data, form) {
      const item = ctx.state.current;
      await patch(`/queue/${item.id}/pricing`, { ...data, ...readPricing(form) });
      toast('Preços salvos.');
      await afterChange(ctx, item.id);
    },
    async recordListing(ctx, data, form) {
      const item = ctx.state.current;
      await post(`/queue/${item.id}/listings/${form.dataset.channel}`, data);
      closeTopLayer();
      toast('Anúncio salvo.');
      await afterChange(ctx, item.id);
    },
    async content(ctx, data) {
      const item = ctx.state.current;
      data.imageRefs = [].concat(data.imageRefs || []).filter(Boolean);
      await patch(`/queue/${item.id}/content`, data);
      toast('Texto e fotos salvos.');
      await afterChange(ctx, item.id);
    }
  }
};
export default view;

// Foto enviada para a nuvem tem URL (mostra a miniatura); foto em media/ mostra o nome do arquivo.
function photoItem(ref, { readonly = false } = {}) {
  const remote = /^https:\/\//.test(ref);
  const name = ref.split('/').pop();
  return `<li class="photo" data-photo>
    ${readonly ? '' : `<input type="hidden" name="imageRefs" value="${esc(ref)}">`}
    <div class="photo-box">
      ${remote ? `<img src="${esc(ref)}" alt="" loading="lazy">` : `<span class="photo-file">${icon('image')}<span class="mono">${esc(name)}</span></span>`}
      ${readonly ? '' : `<span class="photo-actions">
        <button type="button" class="btn-icon" data-action="photo-first" aria-label="Usar como foto principal" title="Usar como principal">${icon('arrow')}</button>
        <button type="button" class="btn-icon" data-action="photo-remove" aria-label="Tirar esta foto" title="Tirar foto">${icon('close')}</button>
      </span>`}
    </div>
    ${!readonly && originalOf(ref) ? '<button type="button" class="photo-undo" data-action="photo-whole">Desfazer recorte</button>' : ''}
  </li>`;
}

function addPhoto(ref) {
  const grid = document.querySelector('#contentForm [data-photos]');
  if (!grid || grid.querySelector(`input[value="${CSS.escape(ref)}"]`)) return;
  grid.insertAdjacentHTML('beforeend', photoItem(ref));
}

// Fotos novas (enviadas ou coladas): com a opção ligada, tiram o fundo e ficam no padrão do site
// (quadrado branco 1200 px, produto centralizado, WebP); depois sobem e entram na lista.
let photoQueue = Promise.resolve();
function addPhotos(files) {
  const images = files.filter(f => f.type.startsWith('image/'));
  if (!images.length) return photoQueue;
  photoQueue = photoQueue.then(async () => {
    const studio = document.querySelector('#contentForm [data-photo-studio]')?.checked ?? true;
    const status = document.querySelector('#contentForm [data-photo-status]');
    const say = text => { if (status) status.textContent = text; };
    let kept = 0;
    try {
      for (const [k, file] of images.entries()) {
        const n = images.length > 1 ? ` ${k + 1} de ${images.length}` : '';
        say(studio ? `Tirando o fundo da foto${n}… (a primeira demora um pouco)` : `Enviando foto${n}…`);
        let upload = file, prepared = false, cut = false;
        if (studio) {
          const { blob, removed, method } = await prepareProductPhoto(file);
          upload = photoFile(blob, file);
          prepared = true;
          if (!removed) kept++;
          cut = canUndoCut(method);
        }
        say(`Enviando foto${n}…`);
        const { ref } = await uploadFile(upload, 'product', { prepared });
        if (cut) rememberOriginal(ref, file);
        addPhoto(ref);
      }
      say('');
      toast(kept ? `Foto(s) prontas, mas ${kept} ficou(aram) com o fundo original. Toque em “Salvar texto e fotos”.` : 'Foto(s) prontas. Toque em “Salvar texto e fotos” para guardar.', kept ? 'warn' : 'info');
    } catch (error) {
      say('');
      toast(error.message, 'danger');
    }
  });
  return photoQueue;
}

// Ctrl+V com a ficha do anúncio aberta: a imagem copiada vira foto do produto.
document.addEventListener('paste', event => {
  if (!document.querySelector('#contentForm [data-photos]')) return;
  const files = [...(event.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  event.preventDefault();
  addPhotos(files);
});

let mediaTimer;
async function loadMedia(search) {
  const box = document.getElementById('mediaList');
  if (!box) return;
  try {
    const result = await get('/media', { search });
    if (!result.available) {
      box.innerHTML = notice('Esta lista só funciona quando o portal está aberto no computador da loja. Use o botão “Enviar fotos”.', 'info');
      return;
    }
    box.innerHTML = result.files.length
      ? `<ul>${result.files.map(f => `<li><button class="media-item" data-action="add-media" data-ref="${esc(f.ref)}">${icon(f.image ? 'image' : 'file')}<span class="mono">${esc(f.ref)}</span><small>${num(Math.ceil(f.size / 1024))} KB · ${esc(relative(f.modifiedAt))}</small></button></li>`).join('')}</ul>`
      : empty({ title: 'Nenhuma foto encontrada', text: 'Coloque as fotos na pasta de fotos do portal, no computador da loja, ou use “Enviar fotos”.', ic: 'folder' });
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

// "Próximo passo": diz, em uma frase, o que quem está olhando precisa fazer agora — e onde fica o botão.
function nextStep(item) {
  const can = to => item.transitions.some(t => t.to === to);
  const pendingSite = (item.channels || []).some(c => c.id === 'site' && item.listings?.site?.status !== 'done');
  let text = '';
  if (item.stage === 'selected' && can('preparing')) text = 'Toque em <strong>Começar a preparar</strong>, no rodapé.';
  else if (item.stage === 'preparing' && item.can.editContent) text = 'Preencha <strong>Texto e fotos do anúncio</strong> aqui embaixo, toque em <strong>Salvar texto e fotos</strong> e depois em <strong>Mandar para aprovação</strong>, no rodapé.';
  else if (item.stage === 'review' && can('approved')) text = 'Confira o texto e as fotos aqui embaixo. Se estiver tudo certo, toque em <strong>Aprovar</strong>, no rodapé.';
  else if (item.stage === 'approved' && item.can.publish && pendingSite) text = 'Aprovado! Desça até <strong>Onde está à venda</strong> e toque em <strong>Colocar à venda no site</strong>.';
  else if (item.stage === 'approved' && item.can.publish) text = 'Aprovado! Anuncie na Shopee e no Mercado Livre e marque <strong>Já anunciei</strong> em cada um, lá embaixo.';
  return text ? `<div class="next-step">${notice(`<strong>Próximo passo:</strong> ${text}`, 'info')}</div>` : '';
}

function renderItem(ctx, item, entries, campaigns, channels, product = null) {
  const p = item.productSnapshot;
  const c = item.content || {};
  const campaign = campaigns.find(x => x.id === item.campaignId);
  const stepIndex = QUEUE_FLOW.indexOf(item.stage);

  const steps = `<ol class="steps" aria-label="Caminho até a venda">${QUEUE_FLOW.map((s, i) => `<li class="${i < stepIndex ? 'is-done' : i === stepIndex ? 'is-current' : ''}"${i === stepIndex ? ' aria-current="step"' : ''}>${esc(QUEUE_STAGES[s].label)}</li>`).join('')}</ol>`;

  const facts = `<dl class="facts">
    <div><dt>Código</dt><dd class="mono">${esc(p.sku || '—')}</dd></div>
    <div><dt>Estoque</dt><dd class="mono">${num(p.stock)}</dd></div>
    <div><dt>Vende como</dt><dd>${item.sellAs ? `${esc(item.sellAs.description)} com ${num(item.sellAs.factor)} ${esc(p.unit || 'un')}` : `Unidade${p.unit ? ` (${esc(p.unit)})` : ''}`}</dd></div>
    <div><dt>Preço na loja</dt><dd class="mono">${money(p.basePrice)}</dd></div>
    <div><dt>Período da promoção</dt><dd>${item.promoStart ? `${date(item.promoStart)} a ${date(item.promoEnd)}` : '—'}</dd></div>
    <div><dt>Prioridade</dt><dd>${esc(item.priority)}</dd></div>
    <div><dt>Campanha</dt><dd>${campaign ? `<a href="#/campanhas/${esc(campaign.id)}">${esc(campaign.name)}</a>` : '—'}</dd></div>
    <div><dt>Escolhido por</dt><dd>${esc(item.requestedBy?.name || '—')} <small>${date(item.createdAt)}</small></dd></div>
  </dl>
  ${item.notes ? `<blockquote class="note-quote"><span>Recado do dono</span>${esc(item.notes)}</blockquote>` : ''}
  <section class="section"><h3>Onde vender e por quanto</h3>${pricingSummary(item, { showCost: ['owner', 'manager'].includes(ctx.user.role) })}</section>`;

  const pricing = item.can.editPricing ? `
    <details class="section">
      <summary><h3>Mudar onde vender, preços e prioridade</h3></summary>
      <form data-form="pricing" class="form-grid">
        <div class="full">${pricingEditor({ channels, product: p, selected: item.channels, promoStart: item.promoStart, promoEnd: item.promoEnd, showCost: ['owner', 'manager'].includes(ctx.user.role),
          unit: product ? { price: product.basePrice, cost: product.cost, stock: product.stock, unit: product.unit } : null, packages: product?.packages || [], sellAs: item.sellAs?.id || '' })}</div>
        ${field('priority', 'Prioridade', { type: 'select', options: PRIORITIES, value: item.priority })}
        ${field('campaignId', 'Faz parte de uma campanha?', { type: 'select', value: item.campaignId, options: [['', 'Não'], ...campaigns.map(x => [x.id, x.name])] })}
        ${field('notes', 'Recado para quem prepara o anúncio', { type: 'textarea', full: true, rows: 2, value: item.notes, max: 2000 })}
        <div class="form-error full" aria-live="polite"></div>
        <div class="full form-actions"><button class="btn" type="submit">${icon('check')}<span>Salvar preços</span></button></div>
      </form>
    </details>` : '';

  // Atenção: o teste mediaRows.includes('Não encontrado') logo abaixo depende deste texto.
  const mediaRows = (item.mediaCheck || []).map(m => `<li>${icon('image')}<span class="mono">${esc(m.ref)}</span>${m.exists === true ? tag('Encontrado', 'ok') : m.exists === false ? tag('Não encontrado', 'danger') : tag('Conferir no computador da loja', 'muted')}</li>`).join('');
  const content = item.can.editContent ? `
    <section class="section">
      <h3>Texto e fotos do anúncio</h3>
      <form data-form="content" class="form-grid" id="contentForm">
        ${field('title', 'Nome do produto no anúncio', { full: true, value: c.title, max: 160, required: true })}
        ${field('description', 'Descrição', { type: 'textarea', full: true, rows: 7, value: c.description, max: 20000, hint: 'Escreva pelo menos 30 letras para poder mandar para aprovação. Conte para que serve, medidas, composição e indicação.' })}
        <div class="field full"><label for="seoTitle">Título para o Google</label><input id="seoTitle" name="seoTitle" maxlength="70" value="${esc(c.seoTitle)}" data-input="counter"><small class="hint counter">${(c.seoTitle || '').length}/70</small></div>
        <div class="field full"><label for="seoDescription">Descrição para o Google</label><textarea id="seoDescription" name="seoDescription" maxlength="320" rows="2" data-input="counter">${esc(c.seoDescription)}</textarea><small class="hint counter">${(c.seoDescription || '').length}/320</small></div>
        <fieldset class="field full site-fields"><legend>O que aparece no site</legend>
          <div class="form-grid">
            ${field('siteCategory', 'Categoria do site', { type: 'select', value: c.siteCategory, options: [['', 'Escolha…'], ...Object.entries(SITE_CATEGORIES)] })}
            ${field('pet', 'Pet', { type: 'select', value: c.pet, options: [['', 'Escolha…'], ...Object.entries(SITE_PETS)] })}
            ${field('brand', 'Marca', { value: c.brand, max: 80 })}
            ${field('tag', 'Selo na foto do produto', { type: 'select', value: c.tag, options: SITE_TAGS.map(t => [t, t || 'Nenhum (na promoção aparece “Oferta”)']) })}
            ${field('measureValue', 'Medida', { type: 'number', min: 0, step: '0.001', value: c.measureValue ?? '', hint: 'Ex.: 15 para 15 kg; 1 para 1 unidade.' })}
            ${field('measureUnit', 'Unidade', { type: 'select', value: c.measureUnit || 'un', options: Object.entries(SITE_UNITS) })}
            ${field('weightKg', 'Peso para frete (kg)', { type: 'number', min: 0, step: '0.001', value: c.weightKg ?? '', hint: 'Preencha quando a medida não for em kg.' })}
            ${field('short', 'Resumo curto (aparece na vitrine do site)', { full: true, value: c.short, max: 160, placeholder: 'Ex.: Mix de carnes, sem corantes, 4 fontes de proteína animal.' })}
            ${field('specs', 'Detalhes (um por linha, assim: Nome: valor)', { type: 'textarea', full: true, rows: 4, value: (c.specs || []).map(x => `${x.label}: ${x.value}`).join('\n'), placeholder: 'Porte: Médio e grande\nFase: Adulto' })}
          </div>
        </fieldset>
        <div class="field full"><span class="field-label">Fotos — a primeira é a principal no site</span>
          <ul class="photo-grid" data-photos>${(c.imageRefs || []).map(photoItem).join('')}</ul>
          <div class="inline-actions">
            <label class="btn small">${icon('upload')}<span>Enviar fotos</span><input type="file" accept="image/*" multiple hidden data-change="upload-photos"></label>
            ${button('Colar imagem', { action: 'paste-photo', icon: 'image', variant: 'small' })}
            ${ctx.config.mediaAvailable ? button('Escolher do computador da loja', { action: 'pick-media', icon: 'folder', variant: 'ghost small' }) : ''}
          </div>
          <label class="check photo-studio"><input type="checkbox" data-photo-studio checked><span>Tirar o fundo e deixar no padrão do site (quadrado, fundo branco, mesmo tamanho)</span></label>
          <p class="photo-status" data-photo-status role="status" aria-live="polite"></p>
          <small class="hint">Dica: clique com o botão direito numa imagem → “Copiar imagem” e aperte Ctrl+V aqui.</small>
        </div>
        ${mediaRows.includes('Não encontrado') ? `<ul class="media-check full">${mediaRows}</ul>` : ''}
        ${field('siteNotes', 'Anotações da equipe (não aparecem no site)', { type: 'textarea', full: true, rows: 2, value: c.siteNotes, max: 2000 })}
        <div class="form-error full" aria-live="polite"></div>
        <div class="full form-actions"><button class="btn" type="submit">${icon('check')}<span>Salvar texto e fotos</span></button></div>
      </form>
    </section>` : `
    <section class="section">
      <h3>Texto e fotos do anúncio</h3>
      <dl class="facts one-col">
        <div><dt>Nome no anúncio</dt><dd>${esc(c.title || '—')}</dd></div>
        <div><dt>Descrição</dt><dd class="prose">${c.description ? esc(c.description).replaceAll('\n', '<br>') : '<span class="muted">Ainda não escrita</span>'}</dd></div>
        <div><dt>Título para o Google</dt><dd>${esc(c.seoTitle || '—')}</dd></div>
        <div><dt>Descrição para o Google</dt><dd>${esc(c.seoDescription || '—')}</dd></div>
        <div><dt>No site</dt><dd>${esc([SITE_CATEGORIES[c.siteCategory], SITE_PETS[c.pet], c.brand, c.measureValue ? `${c.measureValue} ${c.measureUnit}` : '', c.weightKg ? `${c.weightKg} kg para frete` : '', c.tag].filter(Boolean).join(' · ') || '—')}</dd></div>
        <div><dt>Resumo</dt><dd>${esc(c.short || '—')}</dd></div>
        ${(c.specs || []).length ? `<div><dt>Detalhes</dt><dd>${c.specs.map(x => `${esc(x.label)}: ${esc(x.value)}`).join('<br>')}</dd></div>` : ''}
        <div><dt>Anotações da equipe</dt><dd>${esc(c.siteNotes || '—')}</dd></div>
      </dl>
      ${(c.imageRefs || []).length ? `<ul class="photo-grid readonly">${c.imageRefs.map(ref => photoItem(ref, { readonly: true })).join('')}</ul>` : '<p class="muted">Nenhuma foto ainda.</p>'}
    </section>`;

  const publication = ['approved', 'published'].includes(item.stage) || listingsOf(item).some(l => l.listing.status === 'done') ? `
    <section class="section">
      <h3>Onde está à venda</h3>
      <ul class="listing-list">${listingsOf(item).map(({ channel, listing }) => {
        const site = channel.integration === 'site';
        const done = listing.status === 'done';
        const status = LISTING_STATUS[listing.status] || LISTING_STATUS.idle;
        const can = item.can.publish;
        const actions = !can ? '' : site
          ? (done ? button('Tirar do site', { action: 'remove-listing', icon: 'pause', variant: 'ghost small danger-text', data: { channel: channel.id } })
                  : button('Colocar à venda no site', { action: 'publish-site', icon: 'send', variant: 'primary small' }))
          : (done ? [
              listing.needsUpdate ? button('Já atualizei o anúncio', { action: 'record-listing', icon: 'check', variant: 'primary small', data: { channel: channel.id } }) : '',
              button('Desmarcar', { action: 'remove-listing', icon: 'close', variant: 'ghost small', data: { channel: channel.id } })
            ].join('')
                  : button('Já anunciei', { action: 'record-listing', icon: 'check', variant: 'primary small', data: { channel: channel.id } }));
        return `<li class="listing">
          <div class="listing-head"><strong>${esc(channel.name)}</strong>${tag(status.label, status.tone)}${listing.needsUpdate ? tag('O preço mudou: atualize o anúncio', 'warn') : ''}</div>
          <p class="listing-meta">
            ${done ? `${site ? 'No site' : 'Anunciado'} desde ${dateTime(listing.publishedAt)}${listing.by ? ` · ${esc(listing.by)}` : ''}` : site ? 'Ainda não está no site.' : `Anuncie em ${esc(channel.name)} e depois toque em “Já anunciei” para guardar o link.`}
            ${listing.externalId && !site ? ` · código <span class="mono">${esc(listing.externalId)}</span>` : ''}
            ${listing.url ? ` · <a href="${esc(listing.url)}" target="_blank" rel="noopener noreferrer">ver ${site ? 'no site' : 'anúncio'} ${icon('external')}</a>` : ''}
          </p>
          ${actions ? `<div class="listing-actions">${actions}</div>` : ''}
        </li>`;
      }).join('')}</ul>
    </section>` : '';

  const stageHistory = (item.stageHistory || []).slice().reverse();
  const historyHtml = `
    <section class="section">
      <h3>Histórico</h3>
      ${stageHistory.length || entries.length ? `<ul class="timeline">
        ${stageHistory.map(h => `<li><span class="tl-when">${dateTime(h.at)}</span><span class="tl-what"><strong>${esc(h.by)}</strong> mudou para ${statusTag(QUEUE_STAGES, h.to)}${h.note ? `<q>${esc(h.note)}</q>` : ''}</span></li>`).join('')}
        ${entries.filter(e => e.action !== 'queue.stage').map(e => `<li><span class="tl-when">${dateTime(e.at)}</span><span class="tl-what"><strong>${esc(e.actorName)}</strong> ${esc(e.summary)}</span></li>`).join('')}
      </ul>` : '<p class="muted">Nada mudou ainda.</p>'}
    </section>`;

  return `${steps}${item.stage === 'blocked' ? notice('Produto pausado. O motivo está no histórico, mais abaixo.', 'danger') : nextStep(item)}${facts}${pricing}${content}${publication}${historyHtml}`;
}
