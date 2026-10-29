// Histórico de auditoria: quem fez o quê e quando, com antes/depois dos campos alterados.
import { get } from '../api.js';
import { esc, dateTime, pageHead, empty, openDrawer, tag } from '../ui.js';
import { ROLES } from '../../shared/domain.js';

const ENTITY_LABEL = {
  queue: 'Fila', products: 'Catálogo', campaigns: 'Campanhas', promotions: 'Promoções', arts: 'Artes',
  leads: 'Leads', orders: 'Pedidos', users: 'Equipe', integrations: 'Integrações'
};
const ENTITY_ROUTE = { queue: 'fila', campaigns: 'campanhas', promotions: 'promocoes', arts: 'artes', leads: 'leads' };

const show = value => (value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value));

export default {
  id: 'historico',
  title: 'Histórico',
  icon: 'history',
  group: 'Gestão',
  roles: ['owner', 'manager'],

  load: ({ state }) => get('/audit', { entity: state.entity, limit: 300 }),

  render({ state, data }) {
    return `${pageHead({ title: 'Histórico', lead: 'Registro permanente das ações no portal. Ninguém edita nem apaga estas linhas.' })}
    <div class="toolbar"><label class="select-inline"><span class="sr-only">Área</span><select data-change="entity"><option value="">Todas as áreas</option>${Object.entries(ENTITY_LABEL).map(([k, v]) => `<option value="${k}"${state.entity === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <section class="panel flush">${data.entries.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Quando</th><th scope="col">Quem</th><th scope="col">Área</th><th scope="col">O que aconteceu</th></tr></thead>
      <tbody>${data.entries.map(e => `<tr class="${e.changes ? 'row-link' : ''}"${e.changes ? ` data-action="detail" data-id="${esc(e.id)}" tabindex="0"` : ''}>
        <td class="nowrap mono">${dateTime(e.at)}</td>
        <td>${esc(e.actorName)}<span class="sub">${esc(ROLES[e.actorRole]?.label || e.actorRole)}</span></td>
        <td>${esc(ENTITY_LABEL[e.entity] || e.entity)}</td>
        <td>${esc(e.summary)}${e.changes ? ` ${tag(`${Object.keys(e.changes).length} campo(s)`, 'neutral')}` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty({ title: 'Nada registrado ainda', ic: 'history' })}</section>`;
  },

  changes: { entity(ctx, el) { ctx.state.entity = el.value; return ctx.refresh(); } },

  actions: {
    detail(ctx, el) {
      const e = ctx.data.entries.find(x => x.id === el.dataset.id);
      const route = ENTITY_ROUTE[e.entity];
      openDrawer({
        eyebrow: esc(dateTime(e.at)),
        title: e.summary,
        body: `<p>${esc(e.actorName)} · ${esc(ROLES[e.actorRole]?.label || e.actorRole)}</p>
          <div class="table-wrap"><table class="table compact"><thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
          <tbody>${Object.entries(e.changes).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="diff-old">${esc(show(v.before))}</td><td class="diff-new">${esc(show(v.after))}</td></tr>`).join('')}</tbody></table></div>
          ${route && e.entityId ? `<p><a class="link" href="#/${route}/${esc(e.entityId)}">Abrir registro</a></p>` : ''}`
      });
    }
  }
};
