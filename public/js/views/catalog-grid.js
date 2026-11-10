// Cadastro em grade: vários produtos lado a lado para colar as fotos e preencher tudo de uma vez,
// e no fim mandar todos juntos (POST /api/queue/bulk). Chega aqui pela tela Produtos: marcar os
// produtos → "Cadastrar em grade" (#/cadastro?ids=1,2,3).
// O que é preenchido fica guardado neste aparelho (rascunho) até ser enviado — fechar o app ou ele
// se atualizar sozinho não apaga nada. As fotos sobem na hora (estúdio: tira o fundo e padroniza).
import { get, post } from '../api.js';
import { esc, icon, money, num, pageHead, empty, notice, button, toast, confirmDialog, statusTag } from '../ui.js';
import { QUEUE_STAGES, SITE_CATEGORIES, SITE_PETS, SITE_UNITS, canApprove } from '../../shared/domain.js';
import { uploadFile } from '../upload.js';
import { prepareProductPhoto } from '../photo-studio.js';

const DRAFT_KEY = 'sr-cadastro-grade';
const CHUNK = 5; // produtos por envio: dá para mostrar o andamento e nenhum envio fica longo demais

function readDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; }
}
function writeDrafts(drafts) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch {}
}

const editable = row => !row.item || ['selected', 'preparing'].includes(row.item.stage);

// Ponto de partida de cada cartão: rascunho deste aparelho > texto já salvo em Anúncios > UniPlus.
function startingPoint(product, item) {
  const c = item?.content || {};
  const site = item?.channels?.find(ch => ch.id === 'site');
  return {
    title: c.title || product.name,
    price: site?.price ?? product.basePrice ?? '',
    brand: c.brand || '', siteCategory: c.siteCategory || '', pet: c.pet || '',
    measureValue: c.measureValue ?? '', measureUnit: c.measureUnit || 'un', weightKg: c.weightKg ?? '',
    short: c.short || '', description: c.description || '', imageRefs: c.imageRefs || []
  };
}

// O que falta para ir ao site — as mesmas regras do servidor (services/queue.js).
function missing(d, isNew) {
  const m = [];
  if (!d.imageRefs?.length) m.push('foto');
  if (!d.title) m.push('nome');
  if (isNew && !(Number(d.price) > 0)) m.push('preço');
  if (!d.brand) m.push('marca');
  if (!d.siteCategory) m.push('categoria');
  if (!d.pet) m.push('pet');
  if (!(Number(d.measureValue) > 0)) m.push('medida');
  if ((d.measureUnit || 'un') !== 'kg' && !(Number(d.weightKg) > 0)) m.push('peso para frete');
  if (!d.short) m.push('resumo');
  if ((d.description || '').length < 30) m.push('descrição (30 letras)');
  return m;
}

let activeId = null; // cartão que recebe a foto colada com Ctrl+V (o último tocado)
let lastCtx = null;  // contexto da tela aberta, para a colagem (que chega fora das ações)

function control(id, key, label, value, { type = 'text', options = null, full = false, max, hint = '', step, inputmode } = {}) {
  const fid = `g-${id}-${key}`;
  const data = `data-input="field" data-id="${esc(id)}" data-key="${key}"`;
  const el = options
    ? `<select id="${fid}" ${data}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
    : type === 'textarea'
      ? `<textarea id="${fid}" rows="3" ${data}${max ? ` maxlength="${max}"` : ''}>${esc(value)}</textarea>`
      : `<input id="${fid}" type="${type}" ${data} value="${esc(value)}"${max ? ` maxlength="${max}"` : ''}${step ? ` step="${step}" min="0"` : ''}${inputmode ? ` inputmode="${inputmode}"` : ''}>`;
  return `<div class="field${full ? ' full' : ''}"><label for="${fid}">${esc(label)}</label>${el}${hint ? `<small class="hint">${esc(hint)}</small>` : ''}</div>`;
}

const choose = map => [['', 'Escolha…'], ...Object.entries(map)];

function photosHtml(id, refs) {
  return `${refs.map((ref, k) => `<div class="grade-photo">
      ${/^https:\/\//.test(ref) ? `<img src="${esc(ref)}" alt="" loading="lazy">` : `<span class="photo-file">${icon('image')}<span class="mono">${esc(ref.split('/').pop())}</span></span>`}
      ${k === 0 ? '<span class="grade-main">Principal</span>' : ''}
      <button type="button" class="btn-icon" data-action="photo-remove" data-id="${esc(id)}" data-ref="${esc(ref)}" aria-label="Tirar esta foto">${icon('close')}</button>
    </div>`).join('')}
    <label class="grade-drop">${icon('image')}<span><strong>${refs.length ? 'Mais uma foto' : 'Foto do produto'}</strong><small>Toque para escolher ou cole (Ctrl+V)</small></span>
      <input type="file" accept="image/*" multiple hidden data-change="photos" data-id="${esc(id)}"></label>`;
}

function statusHtml(row, d, error) {
  if (error) return `<p class="grade-status is-error" data-status>${icon('alert')}<span>${esc(error)}</span></p>`;
  const m = missing(d, !row.item);
  return m.length
    ? `<p class="grade-status" data-status>${icon('info')}<span><strong>Falta:</strong> ${esc(m.join(', '))}</span></p>`
    : `<p class="grade-status is-ready" data-status>${icon('check')}<span>Pronto para enviar</span></p>`;
}

function card(row, d, error) {
  const { product: p, item } = row;
  const id = p.id;
  if (!editable(row)) {
    return `<li class="grade-card is-locked" data-card="${esc(id)}">
      <header class="grade-head"><div><strong>${esc(p.name)}</strong><small>código ${esc(p.sku || '—')}</small></div></header>
      <p>${statusTag(QUEUE_STAGES, item.stage)} Este produto já passou da preparação. <a href="#/fila/${esc(item.id)}">Abrir em Anúncios</a></p>
    </li>`;
  }
  return `<li class="grade-card${activeId === id ? ' is-active' : ''}" data-card="${esc(id)}">
    <header class="grade-head">
      <div><strong>${esc(p.name)}</strong><small>código ${esc(p.sku || '—')} · estoque ${num(p.stock)} · na loja ${money(p.basePrice)}</small>
        ${item ? `<span class="grade-tag">${statusTag(QUEUE_STAGES, item.stage)}</span>` : ''}</div>
      <button type="button" class="btn-icon" data-action="remove-card" data-id="${esc(id)}" aria-label="Tirar ${esc(p.name)} desta lista" title="Tirar desta lista">${icon('close')}</button>
    </header>
    <div class="grade-photos" data-photos="${esc(id)}">${photosHtml(id, d.imageRefs || [])}</div>
    <p class="grade-working" data-working="${esc(id)}" role="status" aria-live="polite"></p>
    <div class="grade-fields">
      ${control(id, 'title', 'Nome no site', d.title, { full: true, max: 160 })}
      ${item ? `<div class="field"><span class="field-label">Preço no site</span><p class="mono grade-price">${money(item.channels?.find(c => c.id === 'site')?.price)}</p></div>`
        : control(id, 'price', 'Preço no site (R$)', d.price, { type: 'number', step: '0.01', inputmode: 'decimal' })}
      ${control(id, 'brand', 'Marca', d.brand, { max: 80 })}
      ${control(id, 'siteCategory', 'Categoria do site', d.siteCategory, { options: choose(SITE_CATEGORIES) })}
      ${control(id, 'pet', 'Pet', d.pet, { options: choose(SITE_PETS) })}
      ${control(id, 'measureValue', 'Medida', d.measureValue, { type: 'number', step: '0.001', inputmode: 'decimal', hint: 'Ex.: 15 (kg) ou 1 (unidade).' })}
      ${control(id, 'measureUnit', 'Unidade', d.measureUnit, { options: Object.entries(SITE_UNITS) })}
      ${control(id, 'weightKg', 'Peso para frete (kg)', d.weightKg, { type: 'number', step: '0.001', inputmode: 'decimal', hint: 'Só se a medida não for em kg.' })}
      ${control(id, 'short', 'Resumo curto (vitrine)', d.short, { full: true, max: 160 })}
      ${control(id, 'description', 'Descrição', d.description, { type: 'textarea', full: true, max: 20000, hint: 'Pelo menos 30 letras.' })}
    </div>
    ${statusHtml(row, d, error)}
  </li>`;
}

function sendBar(ctx) {
  const { ready, total } = counts(ctx);
  const publish = canApprove(ctx.user);
  return `<div class="send-bar" data-send-bar>
    <span data-send-count><strong>${num(ready)}</strong> de ${num(total)} ${total === 1 ? 'pronto' : 'prontos'}</span>
    <button type="button" class="btn primary" data-action="send"${ready ? '' : ' disabled'}>${icon('send')}<span>${publish ? 'Colocar à venda no site' : 'Mandar para aprovação'}${ready ? ` (${num(ready)})` : ''}</span></button>
  </div>`;
}

function visibleRows(ctx) {
  const removed = new Set(ctx.state.removed || []);
  const sent = new Set((ctx.state.sent || []).filter(r => r.ok).map(r => r.productId));
  return ctx.data.rows.filter(r => !removed.has(r.product.id) && !sent.has(r.product.id));
}

function counts(ctx) {
  const drafts = readDrafts();
  const rows = visibleRows(ctx).filter(editable);
  const ready = rows.filter(r => !missing(drafts[r.product.id] || {}, !r.item).length).length;
  return { ready, total: rows.length };
}

// Depois de mexer num campo: atualiza só o aviso do cartão e a barra de envio (o resto da tela
// fica como está, para não tirar o cursor de onde a pessoa está digitando).
function refreshCardStatus(ctx, id) {
  const row = ctx.data.rows.find(r => r.product.id === id);
  const status = document.querySelector(`[data-card="${CSS.escape(id)}"] [data-status]`);
  if (row && status) status.outerHTML = statusHtml(row, readDrafts()[id] || {}, null);
  const bar = document.querySelector('[data-send-bar]');
  if (bar) bar.outerHTML = sendBar(ctx);
}

async function addPhotos(ctx, id, files) {
  const images = files.filter(f => f.type.startsWith('image/'));
  if (!images.length) return;
  const studio = document.querySelector('[data-studio]')?.checked ?? true;
  const working = document.querySelector(`[data-working="${CSS.escape(id)}"]`);
  const say = text => { if (working) working.textContent = text; };
  let kept = 0;
  try {
    for (const [k, file] of images.entries()) {
      const n = images.length > 1 ? ` ${k + 1} de ${images.length}` : '';
      let upload = file, prepared = false;
      if (studio) {
        say(`Tirando o fundo da foto${n}… (a primeira demora um pouco)`);
        const { blob, removed } = await prepareProductPhoto(file);
        upload = new File([blob], `${(file.name || 'foto').replace(/\.[^.]+$/, '')}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
        prepared = true;
        if (!removed) kept++;
      }
      say(`Enviando foto${n}…`);
      const { ref } = await uploadFile(upload, 'product', { prepared });
      const drafts = readDrafts();
      const d = drafts[id] ||= {};
      d.imageRefs = [...(d.imageRefs || []), ref].slice(0, 10);
      writeDrafts(drafts);
      const box = document.querySelector(`[data-photos="${CSS.escape(id)}"]`);
      if (box) box.innerHTML = photosHtml(id, d.imageRefs);
      refreshCardStatus(ctx, id);
    }
    say(kept ? 'Pronto — uma ou mais fotos ficaram com o fundo original.' : '');
  } catch (error) {
    say('');
    toast(error.message, 'danger');
  }
}

export default {
  id: 'cadastro',
  title: 'Cadastro em grade',
  icon: 'image',
  roles: ['owner', 'manager', 'site'],

  async load({ route, state }) {
    const ids = String(route.query?.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
    if (state.idsKey !== ids.join(',')) Object.assign(state, { idsKey: ids.join(','), removed: [], sent: [], errors: {} });
    if (!ids.length) return { rows: [] };
    const [{ items }, ...products] = await Promise.all([
      get('/queue'),
      ...ids.map(id => get(`/products/${encodeURIComponent(id)}`).then(r => r.product).catch(() => null))
    ]);
    const drafts = readDrafts();
    const rows = products.filter(Boolean).map(product => {
      const item = items.find(i => i.productId === product.id && i.stage !== 'archived') || null;
      // O rascunho deste aparelho vale por cima do que já estava salvo.
      drafts[product.id] = { ...startingPoint(product, item), ...(drafts[product.id] || {}) };
      return { product, item };
    });
    writeDrafts(drafts);
    activeId ??= rows.find(editable)?.product.id || null;
    return { rows };
  },

  render(ctx) {
    lastCtx = ctx;
    const { user, state } = ctx;
    const drafts = readDrafts();
    const rows = visibleRows(ctx);
    const sent = (state.sent || []).filter(r => r.ok);
    const done = sent.length ? notice(`<strong>${num(sent.length)} ${sent.length === 1 ? 'produto foi' : 'produtos foram'} ${canApprove(user) ? 'colocados à venda no site' : 'mandados para aprovação'}.</strong> ${sent.map(r => esc(r.name)).join(', ')}. <a href="#/fila">Ver em Anúncios</a>`, 'info') : '';
    const head = pageHead({
      eyebrow: `${num(rows.length)} ${rows.length === 1 ? 'produto' : 'produtos'}`,
      title: 'Cadastro em grade',
      lead: 'Cole as fotos e preencha cada cartão. Quando estiverem prontos, mande todos de uma vez.',
      actions: `<a class="btn ghost" href="#/produtos">${icon('back')}<span>Voltar para Produtos</span></a>`
    });
    if (!rows.length) {
      return `${head}${done}<section class="panel">${empty({
        title: sent.length ? 'Tudo enviado' : 'Nenhum produto para cadastrar',
        text: 'Em Produtos, marque os produtos e toque em “Cadastrar em grade”.',
        action: `<a class="btn primary" href="#/produtos">${icon('box')}<span>Ir para Produtos</span></a>`, ic: 'box'
      })}</section>`;
    }
    const fill = `<section class="panel fill-all" aria-labelledby="fillTitle">
      <div class="panel-head"><h2 id="fillTitle">Preencher igual em todos</h2></div>
      <div class="fill-grid">
        <div class="field"><label for="fillBrand">Marca</label><input id="fillBrand" data-fill="brand" maxlength="80"></div>
        <div class="field"><label for="fillCat">Categoria do site</label><select id="fillCat" data-fill="siteCategory">${choose(SITE_CATEGORIES).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label for="fillPet">Pet</label><select id="fillPet" data-fill="pet">${choose(SITE_PETS).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label for="fillUnit">Unidade</label><select id="fillUnit" data-fill="measureUnit">${[['', 'Escolha…'], ...Object.entries(SITE_UNITS)].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>
      </div>
      <div class="inline-actions">${button('Aplicar nos cartões em branco', { action: 'fill-all', icon: 'check' })}<small class="hint">Só preenche onde ainda está vazio — nada que você já escreveu é trocado.</small></div>
    </section>`;
    if (!rows.some(editable)) {
      return `${head}${done}${notice('Estes produtos já passaram da preparação. Abra cada um em Anúncios para ver onde estão.', 'info')}
        <ul class="grade">${rows.map(r => card(r, drafts[r.product.id] || {}, null)).join('')}</ul>`;
    }
    return `${head}${done}${fill}
      <label class="check photo-studio"><input type="checkbox" data-studio checked><span>Tirar o fundo das fotos e deixar no padrão do site (quadrado, fundo branco, mesmo tamanho)</span></label>
      <ul class="grade" data-unsaved>${rows.map(r => card(r, drafts[r.product.id] || {}, state.errors?.[r.product.id])).join('')}</ul>
      ${sendBar(ctx)}`;
  },

  inputs: {
    field(ctx, el) {
      const drafts = readDrafts();
      const d = drafts[el.dataset.id] ||= {};
      d[el.dataset.key] = el.value;
      writeDrafts(drafts);
      if (ctx.state.errors?.[el.dataset.id]) delete ctx.state.errors[el.dataset.id];
      refreshCardStatus(ctx, el.dataset.id);
    }
  },

  changes: {
    photos(ctx, el) {
      const files = [...el.files];
      el.value = '';
      return addPhotos(ctx, el.dataset.id, files);
    }
  },

  actions: {
    'remove-card'(ctx, el) {
      ctx.state.removed = [...(ctx.state.removed || []), el.dataset.id];
      ctx.rerender();
    },
    'photo-remove'(ctx, el) {
      const drafts = readDrafts();
      const d = drafts[el.dataset.id] ||= {};
      d.imageRefs = (d.imageRefs || []).filter(ref => ref !== el.dataset.ref);
      writeDrafts(drafts);
      const box = document.querySelector(`[data-photos="${CSS.escape(el.dataset.id)}"]`);
      if (box) box.innerHTML = photosHtml(el.dataset.id, d.imageRefs);
      refreshCardStatus(ctx, el.dataset.id);
    },
    'fill-all'(ctx) {
      const values = Object.fromEntries([...document.querySelectorAll('[data-fill]')].map(el => [el.dataset.fill, el.value.trim()]).filter(([, v]) => v));
      if (!Object.keys(values).length) return toast('Preencha pelo menos um campo de “Preencher igual em todos”.', 'warn');
      const drafts = readDrafts();
      let changed = 0;
      for (const row of visibleRows(ctx).filter(editable)) {
        const d = drafts[row.product.id] ||= {};
        for (const [key, value] of Object.entries(values)) {
          // Unidade começa como "un": conta como em branco enquanto a medida não foi escrita.
          const blank = !d[key] || (key === 'measureUnit' && !d.measureValue);
          if (blank && d[key] !== value) { d[key] = value; changed++; }
        }
      }
      writeDrafts(drafts);
      ctx.rerender();
      toast(changed ? 'Pronto: os campos em branco foram preenchidos.' : 'Nenhum cartão tinha esses campos em branco.', 'info');
    },
    async send(ctx) {
      const publish = canApprove(ctx.user);
      const drafts = readDrafts();
      const ready = visibleRows(ctx).filter(editable).filter(r => !missing(drafts[r.product.id] || {}, !r.item).length);
      if (!ready.length) return toast('Nenhum cartão está pronto ainda. Veja o que falta em cada um.', 'warn');
      const ok = await confirmDialog({
        title: publish ? `Colocar ${ready.length} ${ready.length === 1 ? 'produto' : 'produtos'} à venda no site?` : `Mandar ${ready.length} ${ready.length === 1 ? 'produto' : 'produtos'} para aprovação?`,
        text: publish ? 'Cada um é aprovado por você e entra no site na hora, com o preço e o estoque do sistema da loja.' : 'O dono ou o gerente confere e aprova cada um.',
        confirmLabel: publish ? 'Colocar à venda' : 'Mandar para aprovação'
      });
      if (ok === null) return;
      ctx.state.errors = {};
      const bar = () => document.querySelector('[data-send-count]');
      let done = 0;
      for (let i = 0; i < ready.length; i += CHUNK) {
        const chunk = ready.slice(i, i + CHUNK);
        if (bar()) bar().textContent = `Enviando ${Math.min(i + chunk.length, ready.length)} de ${ready.length}…`;
        const items = chunk.map(({ product, item }) => {
          const d = drafts[product.id];
          return {
            productId: product.id,
            ...(item ? {} : { price: Number(d.price) }),
            content: {
              title: d.title, description: d.description, brand: d.brand, siteCategory: d.siteCategory, pet: d.pet,
              measureValue: d.measureValue, measureUnit: d.measureUnit, weightKg: d.weightKg, short: d.short, imageRefs: d.imageRefs
            }
          };
        });
        try {
          const { results } = await post('/queue/bulk', { publish, items });
          for (const r of results) {
            const row = chunk.find(c => c.product.id === r.productId);
            if (r.ok) {
              ctx.state.sent = [...(ctx.state.sent || []), { ...r, name: row?.product.name || r.productId }];
              delete drafts[r.productId];
              done++;
            } else {
              ctx.state.errors[r.productId] = r.error;
            }
          }
        } catch (error) {
          for (const c of chunk) ctx.state.errors[c.product.id] = error.message;
        }
        writeDrafts(drafts);
      }
      ctx.rerender();
      ctx.refreshBadges();
      const failed = ready.length - done;
      toast(failed ? `${done} enviados. ${failed} com problema — veja o aviso no cartão.` : `${done} ${done === 1 ? 'produto enviado' : 'produtos enviados'}.`, failed ? 'warn' : 'ok');
    }
  }
};

// Ctrl+V na tela de cadastro: a foto vai para o último cartão tocado.
document.addEventListener('paste', event => {
  if (!document.querySelector('.grade')) return;
  const files = [...(event.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  event.preventDefault();
  const id = activeId && document.querySelector(`[data-card="${CSS.escape(activeId)}"]:not(.is-locked)`) ? activeId : document.querySelector('.grade-card:not(.is-locked)')?.dataset.card;
  if (!id) return;
  if (lastCtx) addPhotos(lastCtx, id, files);
});

// Último cartão tocado: destaca e passa a receber a foto colada.
document.addEventListener('focusin', event => markActive(event.target));
document.addEventListener('pointerdown', event => markActive(event.target));
function markActive(target) {
  const cardEl = target?.closest?.('.grade-card:not(.is-locked)');
  if (!cardEl || cardEl.dataset.card === activeId) return;
  document.querySelectorAll('.grade-card.is-active').forEach(el => el.classList.remove('is-active'));
  cardEl.classList.add('is-active');
  activeId = cardEl.dataset.card;
}
