// Inicialização, rotas (#/area/id), navegação lateral e delegação de eventos.
// Cada tela é um módulo em js/views/ com: { id, title, icon, group, roles?, load, render, open?, actions?, forms? }.
import { get } from './api.js';
import { initAuth, storedSession, signOut, authMode } from './auth.js';
import { esc, icon, initials, toast, closeLayers, closeTopLayer, formData, formError, errorState, loading } from './ui.js';
import { ROLES } from '../shared/domain.js';
import { renderLogin } from './views/login.js';
import dashboard from './views/dashboard.js';
import products from './views/products.js';
import queue from './views/queue.js';
import promotions from './views/promotions.js';
import orders from './views/orders.js';
import campaigns from './views/campaigns.js';
import arts from './views/arts.js';
import leads from './views/leads.js';
import media from './views/media-metrics.js';
import integrations from './views/integrations.js';
import team from './views/team.js';
import historyView from './views/history.js';
import account from './views/account.js';

const VIEWS = [dashboard, products, queue, promotions, orders, campaigns, arts, leads, media, integrations, team, historyView, account];
const BY_ID = Object.fromEntries(VIEWS.map(v => [v.id, v]));
const GROUPS = ['Hoje', 'Operação', 'Marketing', 'Gestão'];

const app = {
  config: null,
  user: null,
  route: { name: 'inicio', id: null },
  data: null,
  viewState: {},       // estado de filtros por tela (sobrevive à troca de tela)
  todoCount: 0,
  cache: new Map()
};

// ---------------------------------------------------------------------------
// Contexto entregue às telas
// ---------------------------------------------------------------------------
function ctx() {
  const view = BY_ID[app.route.name];
  return {
    user: app.user,
    config: app.config,
    route: app.route,
    data: app.data,
    state: (app.viewState[view.id] ??= {}),
    refresh,
    rerender,
    navigate,
    lookup,
    invalidate,
    refreshBadges
  };
}

// Listas usadas em vários formulários (pessoas, campanhas, promoções). Cache de 60 s.
async function lookup(name) {
  const hit = app.cache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const loaders = {
    users: () => get('/users').then(r => r.users),
    campaigns: () => get('/campaigns').then(r => r.records),
    promotions: () => get('/promotions').then(r => r.records)
  };
  const value = await loaders[name]();
  app.cache.set(name, { at: Date.now(), value });
  return value;
}
function invalidate(...names) {
  if (!names.length) app.cache.clear();
  names.forEach(n => app.cache.delete(n));
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------
// Formato: #/area, #/area/id ou #/area?chave=valor (filtro inicial vindo de outro lugar).
function parseHash() {
  const [path, search = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, id] = path.split('/');
  return { name: BY_ID[name] ? name : 'inicio', id: id ? decodeURIComponent(id) : null, query: Object.fromEntries(new URLSearchParams(search)) };
}

export function navigate(hash, { replace = false } = {}) {
  const target = '#/' + hash.replace(/^#?\/?/, '');
  if (location.hash === target) return onRoute();
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) onRoute();
}

function allowed(view) {
  return !view.roles || view.roles.includes(app.user.role);
}

let renderSeq = 0;
async function onRoute() {
  const next = parseHash();
  const view = BY_ID[next.name];
  if (!allowed(view)) return navigate('inicio', { replace: true });
  const sameView = next.name === app.route.name && app.data !== null && JSON.stringify(next.query) === JSON.stringify(app.route.query);
  app.route = next;
  paintNav();
  document.title = `${view.title} · Shopping Rural`;
  if (!sameView) {
    closeLayers({ restoreFocus: false });
    await refresh({ scrollTop: true });
    if (view.enter && app.data !== null) {
      try { await view.enter(ctx()); } catch (error) { toast(error.message, 'danger'); }
    }
  } else if (!next.id) {
    closeLayers({ restoreFocus: false });
  }
  if (next.id && view.open) {
    try { await view.open(ctx(), next.id); } catch (error) { toast(error.message, 'danger'); }
  }
}

async function refresh({ scrollTop = false } = {}) {
  const view = BY_ID[app.route.name];
  const seq = ++renderSeq;
  const main = document.getElementById('main');
  if (app.data === null || scrollTop) main.innerHTML = loading();
  try {
    const data = await view.load(ctx());
    if (seq !== renderSeq) return;
    app.data = data;
    main.innerHTML = view.render(ctx());
  } catch (error) {
    if (seq !== renderSeq) return;
    app.data = null;
    main.innerHTML = errorState(error.message);
  }
  if (scrollTop) {
    window.scrollTo({ top: 0 });
    main.focus({ preventScroll: true });
  }
}

function rerender() {
  const view = BY_ID[app.route.name];
  if (app.data !== null) document.getElementById('main').innerHTML = view.render(ctx());
}

// ---------------------------------------------------------------------------
// Navegação lateral
// ---------------------------------------------------------------------------
function paintNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = GROUPS.map(group => {
    const items = VIEWS.filter(v => v.group === group && allowed(v));
    if (!items.length) return '';
    return `<div class="nav-group"><p class="nav-label">${group}</p>${items.map(v => {
      const active = v.id === app.route.name;
      const badge = v.id === 'inicio' && app.todoCount ? `<span class="nav-count" aria-label="${app.todoCount} pendências para você">${app.todoCount}</span>` : '';
      return `<a href="#/${v.id}" class="nav-link${active ? ' is-active' : ''}"${active ? ' aria-current="page"' : ''}>${icon(v.icon)}<span>${esc(v.title)}</span>${badge}</a>`;
    }).join('')}</div>`;
  }).join('');
  const u = app.user;
  document.getElementById('userChip').innerHTML = `<span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><span class="user-meta"><strong>${esc(u.name)}</strong><small>${esc(ROLES[u.role]?.label || u.role)}${u.role === 'manager' && u.canApprove ? ' · aprova' : ''}</small></span>`;
  document.getElementById('envLabel').textContent = app.config.backend === 'local' ? 'Servidor da loja' : 'Nuvem · Firebase';
}

async function refreshBadges() {
  try {
    const data = await get('/dashboard');
    app.todoCount = data.todo.length;
    paintNav();
  } catch {}
}

function toggleMenu(open) {
  document.body.classList.toggle('menu-open', open);
  document.getElementById('menuButton').setAttribute('aria-expanded', String(open));
}

// ---------------------------------------------------------------------------
// Eventos (delegação)
// ---------------------------------------------------------------------------
let busy = false;
async function guarded(target, fn) {
  if (busy) return;
  busy = true;
  const buttons = target ? [...target.querySelectorAll('button')] : [];
  buttons.forEach(b => (b.dataset.wasDisabled = b.disabled, b.disabled = true));
  target?.setAttribute('aria-busy', 'true');
  try {
    await fn();
  } catch (error) {
    // Erro em formulário visível aparece no próprio formulário; senão, em aviso flutuante.
    const visible = target?.tagName === 'FORM' && target.isConnected && (!target.closest('dialog') || target.closest('dialog').open);
    if (visible) formError(target, error.message);
    else toast(error.message, 'danger');
  } finally {
    busy = false;
    target?.removeAttribute('aria-busy');
    buttons.forEach(b => { if (b.isConnected) b.disabled = b.dataset.wasDisabled === 'true'; });
  }
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  if (action === 'close-layer') {
    event.preventDefault();
    const closed = closeTopLayer();
    if (closed === 'drawer' && app.route.id) navigate(app.route.name, { replace: true });
    return;
  }
  if (action === 'reload') return refresh();
  if (action === 'logout') return void signOut().then(() => location.reload());
  if (action === 'toggle-menu') return toggleMenu(!document.body.classList.contains('menu-open'));
  const view = BY_ID[app.route.name];
  const handler = view.actions?.[action];
  if (!handler) return;
  event.preventDefault();
  guarded(el.closest('dialog'), () => handler(ctx(), el, event));
});

document.addEventListener('submit', event => {
  const form = event.target;
  const name = form.dataset.form;
  if (!name) return;
  event.preventDefault();
  const view = BY_ID[app.route.name];
  const handler = view.forms?.[name];
  if (!handler) return;
  formError(form, '');
  guarded(form, () => handler(ctx(), formData(form), form));
});

document.addEventListener('input', event => {
  const el = event.target.closest('[data-input]');
  if (!el) return;
  BY_ID[app.route.name].inputs?.[el.dataset.input]?.(ctx(), el, event);
});
document.addEventListener('change', event => {
  const el = event.target.closest('[data-change]');
  if (!el) return;
  const handler = BY_ID[app.route.name].changes?.[el.dataset.change];
  if (handler) guarded(null, () => handler(ctx(), el, event));
});

// Fechar a gaveta com Esc ou clique fora volta a URL para a lista.
for (const id of ['drawer', 'modal']) {
  const el = document.getElementById(id);
  el.addEventListener('cancel', event => {
    event.preventDefault();
    const closed = closeTopLayer();
    if (closed === 'drawer' && app.route.id) navigate(app.route.name, { replace: true });
  });
  el.addEventListener('click', event => {
    if (event.target !== el) return;
    const rect = el.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) {
      const closed = closeTopLayer();
      if (closed === 'drawer' && app.route.id) navigate(app.route.name, { replace: true });
    }
  });
}

document.getElementById('menuButton').addEventListener('click', () => toggleMenu(!document.body.classList.contains('menu-open')));
document.getElementById('scrim').addEventListener('click', () => toggleMenu(false));
document.getElementById('nav').addEventListener('click', event => { if (event.target.closest('a')) toggleMenu(false); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') toggleMenu(false);
  // Linhas de tabela clicáveis respondem a Enter/Espaço como botões.
  const row = event.target.closest?.('tr[data-action][tabindex]');
  if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); row.click(); }
});
window.addEventListener('hashchange', onRoute);

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
async function showLogin(message) {
  document.getElementById('shell').hidden = true;
  const login = document.getElementById('login');
  login.hidden = false;
  renderLogin(login, { config: app.config, message, onSignedIn: start });
}

let started = false;
async function start() {
  try {
    const { user } = await get('/auth/me');
    app.user = user;
  } catch (error) {
    if (error.status === 403) {
      await signOut();
      return showLogin(error.message);
    }
    throw error;
  }
  document.getElementById('login').hidden = true;
  document.getElementById('shell').hidden = false;
  app.data = null;
  app.route = { name: '', id: null };
  await onRoute();
  refreshBadges();
  if (!started) {
    started = true;
    setInterval(refreshBadges, 120_000);
  }
}

async function boot() {
  const bootEl = document.getElementById('boot');
  try {
    app.config = await fetch('/api/config', { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error('O servidor do portal não respondeu (status ' + r.status + ').');
      return r.json();
    });
    await initAuth(app.config, {
      signedOut: message => {
        if (app.user) { app.user = null; showLogin(message || 'Sua sessão terminou. Entre novamente.'); }
      }
    });
    bootEl.hidden = true;
    if (app.config.needsSetup || !storedSession()) return showLogin();
    await start();
  } catch (error) {
    bootEl.innerHTML = `<div class="boot-card">${errorState(error.message)}</div>`;
    bootEl.querySelector('[data-action=reload]')?.addEventListener('click', () => location.reload());
  }
}

boot();
export { authMode };
