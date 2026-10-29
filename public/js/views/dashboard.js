// Visão geral: a trilha de publicação, o que é "sua vez" e a saúde das integrações.
import { get } from '../api.js';
import { esc, icon, tag, num, relative, pageHead, empty, statusTag } from '../ui.js';
import { QUEUE_STAGES, QUEUE_FLOW, INTEGRATION_STATUS, ROLES } from '../../shared/domain.js';

const KIND_ICON = { queue: 'queue', arts: 'art', campaigns: 'campaign', promotions: 'tag' };

function greeting(name) {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()));
  const word = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `${word}, ${String(name).split(' ')[0]}`;
}

const plural = (n = 0, one, many) => `${num(n)} ${n === 1 ? one : many}`;

export function trail(pipeline, { linkBase = '#/fila', active = '', sourceCount = null } = {}) {
  const counts = Object.fromEntries(pipeline.map(p => [p.stage, p.count]));
  return `<ol class="trail" aria-label="Etapas da publicação de produtos">
    <li class="trail-station is-source"><span class="trail-dot" aria-hidden="true"></span><a class="trail-link" href="#/produtos">${sourceCount !== null ? `<span class="trail-count">${num(sourceCount)}</span>` : ''}<span class="trail-label">No UniPlus</span><span class="trail-hint">catálogo sincronizado</span></a></li>
    ${QUEUE_FLOW.map(stage => {
      const s = QUEUE_STAGES[stage];
      return `<li class="trail-station tone-${s.tone}${active === stage ? ' is-active' : ''}"><span class="trail-dot" aria-hidden="true"></span>
        <a class="trail-link" href="${linkBase}?etapa=${stage}">
          <span class="trail-count">${num(counts[stage] || 0)}</span>
          <span class="trail-label">${esc(s.label)}</span>
          <span class="trail-hint">${esc(s.hint)}</span>
        </a></li>`;
    }).join('')}
  </ol>
  <p class="trail-side">${tag(plural(counts.blocked, 'bloqueado', 'bloqueados'), 'danger')} ${tag(plural(counts.archived, 'arquivado', 'arquivados'), 'muted')}</p>`;
}

export default {
  id: 'inicio',
  title: 'Visão geral',
  icon: 'home',
  group: 'Hoje',

  load: () => get('/dashboard'),

  render({ user, data }) {
    const today = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const c = data.counts;
    const ledger = [
      ['Produtos no catálogo', num(c.products), '#/produtos'],
      ['Na fila do site', num(c.queueOpen), '#/fila'],
      ['Publicados', num(c.published), '#/fila'],
      ['Campanhas em andamento', num(c.campaignsRunning), '#/campanhas'],
      ['Promoções no ar', num(c.promotionsLive), '#/promocoes'],
      ['Artes abertas', `${num(c.artsOpen)}${c.artsLate ? ` <em class="late">${num(c.artsLate)} atrasada(s)</em>` : ''}`, '#/artes'],
      ['Leads em aberto', num(c.leadsOpen), '#/leads']
    ];

    return `${pageHead({ eyebrow: esc(today), title: greeting(user.name), lead: ROLES[user.role]?.description })}

    <section class="panel trail-panel" aria-labelledby="trailTitle">
      <div class="panel-head"><h2 id="trailTitle">Trilha de publicação</h2><a class="link" href="#/fila">Abrir fila ${icon('arrow')}</a></div>
      ${trail(data.pipeline, { sourceCount: data.counts.products })}
    </section>

    <div class="grid-2">
      <section class="panel" aria-labelledby="todoTitle">
        <div class="panel-head"><h2 id="todoTitle">Sua vez <span class="count-pill">${num(data.todo.length)}</span></h2></div>
        ${data.todo.length ? `<ul class="todo-list">${data.todo.map(t => `
          <li><a href="#/${esc(t.route)}" class="todo-item">${icon(KIND_ICON[t.kind] || 'arrow')}<span><strong>${esc(t.title)}</strong><small>${esc(t.detail || '')}</small></span>${icon('arrow', 'todo-go')}</a></li>`).join('')}</ul>`
          : empty({ title: 'Nada esperando por você', text: 'Quando alguém precisar da sua aprovação ou entrega, aparece aqui.', ic: 'check' })}
      </section>

      <section class="panel" aria-labelledby="intTitle">
        <div class="panel-head"><h2 id="intTitle">Integrações</h2><a class="link" href="#/integracoes">Detalhes ${icon('arrow')}</a></div>
        <ul class="status-list">${data.integrations.map(i => `
          <li><span class="status-name">${esc(i.name)}</span>${statusTag(INTEGRATION_STATUS, i.status)}
          <small>${i.status === 'error' ? esc(i.lastError) : i.lastSyncAt ? 'Última sincronização ' + relative(i.lastSyncAt) : 'Sem sincronização registrada'}</small></li>`).join('')}
        </ul>
      </section>
    </div>

    <section class="panel" aria-labelledby="ledgerTitle">
      <div class="panel-head"><h2 id="ledgerTitle">Em números</h2></div>
      <dl class="ledger">${ledger.map(([label, value, href]) => `<div><dt><a href="${href}">${esc(label)}</a></dt><dd>${value}</dd></div>`).join('')}</dl>
    </section>

    ${data.recent.length ? `<section class="panel" aria-labelledby="recentTitle">
      <div class="panel-head"><h2 id="recentTitle">Últimas movimentações</h2><a class="link" href="#/historico">Histórico completo ${icon('arrow')}</a></div>
      <ul class="feed">${data.recent.map(e => `<li><span class="feed-who">${esc(e.actorName)}</span><span class="feed-what">${esc(e.summary)}</span><time datetime="${esc(e.at)}">${relative(e.at)}</time></li>`).join('')}</ul>
    </section>` : ''}`;
  },

  actions: {}
};
