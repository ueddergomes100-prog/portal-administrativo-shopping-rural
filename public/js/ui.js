// Kit de interface: escape de HTML, ícones, formatação BR, componentes de marcação e camadas (gaveta, modal, aviso).
// Toda string vinda do usuário/API passa por esc() antes de entrar no HTML.

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = esc;

// ---------------------------------------------------------------------------
// Ícones (traço 1.75, estilo Lucide). Sempre decorativos: o texto vizinho dá o sentido.
// ---------------------------------------------------------------------------
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5 9v12h5v-6h4v6h5V9',
  box: 'm3 7.5 9-4.5 9 4.5v9L12 21l-9-4.5ZM3 7.5l9 4.5 9-4.5M12 12v9',
  queue: 'M4 5h4v14H4ZM10 5h4v9h-4ZM16 5h4v5h-4Z',
  tag: 'M3 3h8l10 10-8 8L3 11ZM7.5 7.5h.01',
  campaign: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1ZM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  art: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.9-9-7.9ZM7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  orders: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0',
  chart: 'M3 3v18h18M7 16l4-5 3 3 5-7',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12A9 9 0 0 1 18.5 5.8L21 8M21 3v5h-5M3 21v-5h5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 17v3h16v-3',
  image: 'M3 5h18v14H3ZM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 19',
  file: 'M14 3H6v18h12V7ZM14 3v4h4',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  menu: 'M4 6h16M4 12h16M4 18h16',
  calendar: 'M4 5h16v16H4ZM16 3v4M8 3v4M4 10h16',
  money: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4Z',
  lock: 'M5 11h14v10H5ZM8 11V7a4 4 0 0 1 8 0v4',
  pause: 'M8 5v14M16 5v14',
  archive: 'M3 4h18v4H3ZM5 8v12h14V8M10 12h4',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  sync: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PATHS[name] || PATHS.box}"/></svg>`;

// ---------------------------------------------------------------------------
// Formatação (pt-BR, BRL, fuso America/Sao_Paulo)
// ---------------------------------------------------------------------------
const TZ = 'America/Sao_Paulo';
const moneyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = value => (value === null || value === undefined || value === '' ? '—' : moneyFormat.format(Number(value) || 0));
export const num = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
export function date(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? value + 'T12:00:00-03:00' : value);
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : '—';
}
export function dateShort(value) {
  if (!value) return '—';
  const d = new Date(String(value).length === 10 ? value + 'T12:00:00-03:00' : value);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short' }).format(d).replace('.', '');
}
export function dateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
export function relative(value) {
  if (!value) return 'nunca';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return 'agora há pouco';
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.round(diff / 86400)} dia(s)`;
  return date(value);
}
export const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------
// "Brinco": etiqueta de status com furo, a assinatura visual do portal.
export const tag = (label, tone = 'neutral') => `<span class="tag tone-${esc(tone)}"><span class="tag-hole" aria-hidden="true"></span>${esc(label)}</span>`;
export const statusTag = (map, key) => (map[key] ? tag(map[key].label, map[key].tone) : tag(key || '—'));

export function button(label, { action, icon: ic, variant = '', type = 'button', data = {}, disabled = false, title = '' } = {}) {
  const dataAttrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button type="${type}" class="btn ${variant}"${action ? ` data-action="${esc(action)}"` : ''}${dataAttrs}${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${ic ? icon(ic) : ''}<span>${esc(label)}</span></button>`;
}

export function iconButton(label, ic, { action, data = {} } = {}) {
  const dataAttrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button type="button" class="btn-icon" aria-label="${esc(label)}" title="${esc(label)}"${action ? ` data-action="${esc(action)}"` : ''}${dataAttrs}>${icon(ic)}</button>`;
}

export function pageHead({ eyebrow = '', title, lead = '', actions = '' }) {
  return `<header class="page-head">
    <div class="page-head-text">
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
      <h1>${esc(title)}</h1>
      ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

export function empty({ title, text = '', action = '', ic = 'box' }) {
  return `<div class="empty">${icon(ic, 'empty-icon')}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

export function notice(html, tone = 'info') {
  const ic = tone === 'danger' ? 'alert' : tone === 'warn' ? 'alert' : 'info';
  return `<div class="notice tone-${tone}" role="${tone === 'danger' ? 'alert' : 'note'}">${icon(ic)}<div>${html}</div></div>`;
}

export function loading(label = 'Carregando…') {
  return `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(label)}</div>`;
}

export function errorState(message, retryAction = 'reload') {
  return `<div class="empty is-error">${icon('alert', 'empty-icon')}<h3>Não foi possível carregar</h3><p>${esc(message)}</p>${button('Tentar de novo', { action: retryAction, icon: 'refresh' })}</div>`;
}

// ---------------------------------------------------------------------------
// Formulários
// ---------------------------------------------------------------------------
let fieldSeq = 0;
export function field(name, label, { type = 'text', value = '', required = false, options = [], hint = '', full = false, max, min, step, placeholder = '', rows = 4, disabled = false, mono = false } = {}) {
  const id = `f-${name}-${++fieldSeq}`;
  const common = `name="${esc(name)}" id="${id}"${required ? ' required' : ''}${disabled ? ' disabled' : ''}${hint ? ` aria-describedby="${id}-hint"` : ''}${mono ? ' class="mono"' : ''}`;
  let input;
  if (type === 'select') {
    input = `<select ${common}>${options.map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`;
    }).join('')}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea ${common} rows="${rows}"${max ? ` maxlength="${max}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${esc(value)}</textarea>`;
  } else if (type === 'checkboxes') {
    const selected = new Set(Array.isArray(value) ? value : []);
    return `<fieldset class="field ${full ? 'full' : ''}"><legend>${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</legend><div class="chips">${options.map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<label class="chip"><input type="checkbox" name="${esc(name)}" value="${esc(v)}"${selected.has(v) ? ' checked' : ''}><span>${esc(l)}</span></label>`;
    }).join('')}</div>${hint ? `<small class="hint">${esc(hint)}</small>` : ''}</fieldset>`;
  } else {
    input = `<input ${common} type="${type}" value="${esc(value)}"${max ? ` maxlength="${max}"` : ''}${min !== undefined ? ` min="${min}"` : ''}${step ? ` step="${step}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${type === 'password' ? ' autocomplete="new-password"' : ''}>`;
  }
  return `<div class="field ${full ? 'full' : ''}"><label for="${id}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>${input}${hint ? `<small class="hint" id="${id}-hint">${esc(hint)}</small>` : ''}</div>`;
}

export function formData(form) {
  const data = {};
  const fd = new FormData(form);
  for (const [key, raw] of fd.entries()) {
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const input = form.querySelector(`[name="${CSS.escape(key)}"]`);
    if (input?.type === 'checkbox') (data[key] ??= []).push(value);
    else if (key in data) data[key] = [].concat(data[key], value); // nomes repetidos viram lista
    else data[key] = value;
  }
  form.querySelectorAll('input[type=checkbox]').forEach(input => { if (!(input.name in data)) data[input.name] = []; });
  return data;
}

export function formError(form, message) {
  const box = form.querySelector('.form-error');
  if (box) {
    box.innerHTML = message ? notice(esc(message), 'danger') : '';
    if (message) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ---------------------------------------------------------------------------
// Camadas: aviso (toast), gaveta lateral e modal
// ---------------------------------------------------------------------------
let toastTimer;
export function toast(message, tone = 'ok') {
  const el = document.getElementById('toast');
  el.className = `toast tone-${tone} show`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), tone === 'danger' ? 7000 : 4000);
}

let lastFocus = null;
function openLayer(el, html, labelId) {
  if (!el.open) lastFocus = document.activeElement;
  el.innerHTML = html;
  el.setAttribute('aria-labelledby', labelId);
  if (!el.open) el.showModal();
  const first = el.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), textarea, select, .layer-body button');
  (first || el.querySelector('.layer-close'))?.focus();
}

export function openDrawer({ eyebrow = '', title, body, footer = '' }) {
  const el = document.getElementById('drawer');
  openLayer(el, `<div class="layer-head"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h2 id="drawerTitle">${esc(title)}</h2></div>${iconButton('Fechar', 'close', { action: 'close-layer' })}</div><div class="layer-body">${body}</div>${footer ? `<div class="layer-foot">${footer}</div>` : ''}`, 'drawerTitle');
}

export function openModal({ title, body, footer = '', size = '' }) {
  const el = document.getElementById('modal');
  el.className = `modal ${size}`;
  openLayer(el, `<div class="layer-head"><h2 id="modalTitle">${esc(title)}</h2>${iconButton('Fechar', 'close', { action: 'close-layer' })}</div><div class="layer-body">${body}</div>${footer ? `<div class="layer-foot">${footer}</div>` : ''}`, 'modalTitle');
}

export function closeLayers({ restoreFocus = true } = {}) {
  for (const id of ['modal', 'drawer']) {
    const el = document.getElementById(id);
    if (el.open) el.close();
  }
  if (restoreFocus && lastFocus?.isConnected) lastFocus.focus();
}

export function closeTopLayer() {
  const modal = document.getElementById('modal');
  if (modal.open) { modal.close(); return 'modal'; }
  const drawer = document.getElementById('drawer');
  if (drawer.open) { drawer.close(); if (lastFocus?.isConnected) lastFocus.focus(); return 'drawer'; }
  return null;
}

// Pede confirmação com campo de observação opcional/obrigatório. Resolve com o texto ou null.
export function confirmDialog({ title, text = '', confirmLabel = 'Confirmar', tone = '', noteLabel = '', noteRequired = false }) {
  return new Promise(resolve => {
    const el = document.getElementById('confirm');
    el.innerHTML = `<form method="dialog" class="confirm-form">
      <h2 id="confirmTitle">${esc(title)}</h2>
      ${text ? `<p>${text}</p>` : ''}
      ${noteLabel ? field('note', noteLabel, { type: 'textarea', required: noteRequired, full: true, rows: 3 }) : ''}
      <div class="confirm-actions">
        <button type="button" class="btn ghost" value="cancel" data-confirm="cancel">Cancelar</button>
        <button type="submit" class="btn ${tone || 'primary'}" value="ok">${esc(confirmLabel)}</button>
      </div></form>`;
    el.setAttribute('aria-labelledby', 'confirmTitle');
    const form = el.querySelector('form');
    const done = value => { el.close(); resolve(value); };
    el.querySelector('[data-confirm=cancel]').addEventListener('click', () => done(null), { once: true });
    el.addEventListener('cancel', e => { e.preventDefault(); done(null); }, { once: true });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const note = form.elements.note?.value.trim() || '';
      if (noteRequired && !note) { form.elements.note.focus(); return; }
      done(note || '');
    });
    el.showModal();
    (form.elements.note || form.querySelector('[type=submit]')).focus();
  });
}
