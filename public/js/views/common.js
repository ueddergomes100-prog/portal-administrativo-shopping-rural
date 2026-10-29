// Peças reaproveitadas pelas telas de campanhas, promoções, artes e leads:
// seletor de produtos, mudança de etapa com observação, comentários e histórico.
import { get, post } from '../api.js';
import { esc, icon, money, dateTime, field, confirmDialog, toast, openModal, closeTopLayer, statusTag } from '../ui.js';
import { PUBLICATION_CHANNELS } from '../../shared/domain.js';

// ---------------------------------------------------------------------------
// Seletor de produtos (busca no catálogo sincronizado)
// mode: 'multi' (lista de IDs) | 'single' (um ID) | 'price' (ID + preço promocional por produto)
// ---------------------------------------------------------------------------
export function productPicker({ name = 'productIds', label = 'Produtos', mode = 'multi', selected = [], required = false, hint = '' }) {
  const rows = selected.map(p => pickerRow(name, mode, p)).join('');
  return `<div class="field full picker" data-picker="${esc(name)}" data-mode="${mode}">
    <label for="picker-${esc(name)}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    <ul class="picker-chosen" data-chosen>${rows}</ul>
    <div class="picker-search">${icon('search')}<input id="picker-${esc(name)}" type="search" data-input="picker-search" placeholder="Buscar produto por nome ou SKU" autocomplete="off" aria-describedby="picker-${esc(name)}-hint"></div>
    <ul class="picker-results" data-results role="listbox" aria-label="Resultados"></ul>
    <small class="hint" id="picker-${esc(name)}-hint">${esc(hint || (mode === 'single' ? 'Escolha um produto.' : 'Busque e clique para adicionar.'))}</small>
  </div>`;
}

function pickerRow(name, mode, p) {
  const base = `<span class="picker-name"><strong>${esc(p.name)}</strong><span class="mono sub">${esc(p.sku || '')}${p.basePrice !== undefined ? ' · ' + money(p.basePrice) : ''}</span></span>`;
  const remove = `<button type="button" class="btn-icon" data-action="picker-remove" aria-label="Remover ${esc(p.name)}">${icon('close')}</button>`;
  if (mode === 'price') {
    return `<li class="picker-row" data-picker-row data-id="${esc(p.id)}">${base}
      <label class="picker-price"><span class="sr-only">Preço promocional de ${esc(p.name)}</span><span aria-hidden="true">R$</span><input type="number" min="0" step="0.01" required data-promo value="${esc(p.promoPrice ?? '')}" placeholder="Promo"></label>${remove}</li>`;
  }
  return `<li class="picker-row" data-picker-row data-id="${esc(p.id)}"><input type="hidden" name="${esc(name)}" value="${esc(p.id)}">${base}${remove}</li>`;
}

let pickerTimer;
export const pickerInputs = {
  'picker-search'(ctx, el) {
    clearTimeout(pickerTimer);
    const box = el.closest('[data-picker]').querySelector('[data-results]');
    const term = el.value.trim();
    if (term.length < 2) { box.innerHTML = ''; return; }
    pickerTimer = setTimeout(async () => {
      try {
        const result = await get('/products', { search: term, pageSize: 8 });
        box.innerHTML = result.data.length ? result.data.map(p => `<li><button type="button" class="picker-option" data-action="picker-add"
          data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-sku="${esc(p.sku)}" data-price="${esc(p.basePrice)}">
          <strong>${esc(p.name)}</strong><span class="mono">${esc(p.sku)} · ${money(p.basePrice)} · estoque ${esc(p.stock)}</span></button></li>`).join('')
          : '<li class="picker-none">Nenhum produto encontrado.</li>';
      } catch (error) {
        box.innerHTML = `<li class="picker-none">${esc(error.message)}</li>`;
      }
    }, 250);
  }
};

export const pickerActions = {
  'picker-add'(ctx, el) {
    const picker = el.closest('[data-picker]');
    const chosen = picker.querySelector('[data-chosen]');
    const mode = picker.dataset.mode;
    const { id, name, sku, price } = el.dataset;
    if (chosen.querySelector(`[data-id="${CSS.escape(id)}"]`)) return;
    const row = pickerRow(picker.dataset.picker, mode, { id, name, sku, basePrice: Number(price) });
    if (mode === 'single') chosen.innerHTML = row;
    else chosen.insertAdjacentHTML('beforeend', row);
    picker.querySelector('[data-results]').innerHTML = '';
    const input = picker.querySelector('[data-input=picker-search]');
    input.value = '';
    (chosen.querySelector(`[data-id="${CSS.escape(id)}"] [data-promo]`) || input).focus();
  },
  'picker-remove'(ctx, el) {
    el.closest('[data-picker-row]').remove();
  }
};

export function readPricedItems(form) {
  return [...form.querySelectorAll('[data-picker-row]')].map(row => ({ productId: row.dataset.id, promoPrice: row.querySelector('[data-promo]')?.value }));
}

// ---------------------------------------------------------------------------
// Mudança de etapa (campanhas, promoções, artes)
// ---------------------------------------------------------------------------
const PRIMARY = ['approved', 'awaiting_approval', 'running', 'published', 'in_progress', 'done'];
export function transitionButtons(record) {
  const rank = t => (t.to === 'cancelled' ? 0 : PRIMARY.includes(t.to) ? 2 : 1);
  return [...(record.transitions || [])].sort((a, b) => rank(a) - rank(b)).map(t => `<button type="button" class="btn ${PRIMARY.includes(t.to) ? 'primary' : t.to === 'cancelled' ? 'ghost danger-text' : 'ghost'}"
    data-action="transition" data-to="${esc(t.to)}" data-requires="${esc(t.requires || '')}" data-label="${esc(t.label)}">${esc(t.label)}</button>`).join('');
}

export async function runTransition({ entity, record, el, statuses, name }) {
  const { to, requires, label } = el.dataset;
  const body = { to };
  if (requires === 'channels') {
    const result = await channelsPrompt(name);
    if (!result) return false;
    Object.assign(body, result);
  } else {
    const note = await confirmDialog({
      title: label,
      text: `“${esc(name)}” vai para <strong>${esc(statuses[to].label)}</strong>.`,
      confirmLabel: label,
      tone: to === 'cancelled' ? 'danger' : 'primary',
      noteLabel: requires === 'note' ? 'Motivo (a equipe vai ler)' : 'Observação (opcional)',
      noteRequired: requires === 'note'
    });
    if (note === null) return false;
    body.note = note;
  }
  await post(`/${entity}/${record.id}/transition`, body);
  toast(`${name}: ${statuses[to].label}.`);
  return true;
}

// Registro de onde a arte foi publicada/enviada. O portal não envia nada sozinho.
function channelsPrompt(name) {
  return new Promise(resolve => {
    openModal({
      title: 'Registrar publicação',
      body: `<form id="channelsForm" class="form-grid">
        <p class="full lead">Marque onde “${esc(name)}” foi publicada ou enviada. Isto é um registro da equipe — o portal não publica nem envia mensagens automaticamente.</p>
        ${field('channels', 'Canais', { type: 'checkboxes', full: true, options: PUBLICATION_CHANNELS, required: true })}
        ${field('channelNote', 'Detalhe (opcional)', { full: true, max: 500, placeholder: 'Ex.: grupo de clientes do WhatsApp; post fixado no Instagram' })}
        <div class="form-error full"></div>
      </form>`,
      footer: `<button type="button" class="btn ghost" data-cancel>Cancelar</button><button type="submit" form="channelsForm" class="btn primary">Registrar</button>`
    });
    const modal = document.getElementById('modal');
    const form = modal.querySelector('#channelsForm');
    const finish = value => { modal.removeEventListener('close', onClose); closeTopLayer(); resolve(value); };
    const onClose = () => resolve(null);
    modal.addEventListener('close', onClose, { once: true });
    modal.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const channels = [...form.querySelectorAll('input[name=channels]:checked')].map(i => i.value);
      if (!channels.length) {
        form.querySelector('.form-error').innerHTML = '<p class="error-text">Marque ao menos um canal.</p>';
        return;
      }
      finish({ channels, channelNote: form.elements.channelNote.value.trim() });
    });
  });
}

// ---------------------------------------------------------------------------
// Comentários e histórico
// ---------------------------------------------------------------------------
export function notesSection(record) {
  const notes = (record.notes || []).slice().reverse();
  return `<section class="section">
    <h3>Comentários e etapas</h3>
    <form data-form="note" class="note-form">
      <label for="noteText" class="sr-only">Novo comentário</label>
      <textarea id="noteText" name="text" rows="2" maxlength="2000" placeholder="Escreva um comentário para a equipe" required></textarea>
      <button class="btn small" type="submit">Comentar</button>
      <div class="form-error"></div>
    </form>
    ${notes.length ? `<ul class="timeline">${notes.map(n => `<li><span class="tl-when">${dateTime(n.at)}</span><span class="tl-what"><strong>${esc(n.by || '')}</strong> ${esc(n.text)}</span></li>`).join('')}</ul>` : '<p class="muted">Nenhum comentário ainda.</p>'}
  </section>`;
}

export function personName(users, id) {
  return users.find(u => u.id === id)?.name || '—';
}

export function peopleOptions(users, { empty = 'Sem responsável', roles } = {}) {
  return [['', empty], ...users.filter(u => u.active !== false && (!roles || roles.includes(u.role))).map(u => [u.id, u.name])];
}

export { statusTag };
