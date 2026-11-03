// Início: primeiro o que a pessoa precisa resolver agora (com o botão que resolve), depois como está a
// loja em poucos números e o que vem nos próximos dias. Detalhes técnicos ficam recolhidos no fim.
import { get } from '../api.js';
import { esc, icon, tag, num, date, relative, pageHead, notice, statusTag } from '../ui.js';
import { QUEUE_STAGES, QUEUE_FLOW, INTEGRATION_STATUS } from '../../shared/domain.js';

const KIND_ICON = { queue: 'queue', arts: 'art', campaigns: 'campaign', promotions: 'tag', orders: 'orders' };

function greeting(name) {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()));
  const word = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `${word}, ${String(name).split(' ')[0]}`;
}

const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400_000);
function countdown(today, start, end) {
  const d = dayDiff(today, start);
  if (d > 1) return `Começa daqui a ${d} dias`;
  if (d === 1) return 'Começa amanhã';
  if (d === 0) return 'Começa hoje';
  return `Acontecendo agora, até ${date(end)}`;
}

const plural = (n = 0, one, many) => `${num(n)} ${n === 1 ? one : many}`;

export function trail(pipeline, { linkBase = '#/fila', active = '', sourceCount = null } = {}) {
  const counts = Object.fromEntries(pipeline.map(p => [p.stage, p.count]));
  return `<ol class="trail" aria-label="Caminho do produto até a venda">
    <li class="trail-station is-source"><span class="trail-dot" aria-hidden="true"></span><a class="trail-link" href="#/produtos">${sourceCount !== null ? `<span class="trail-count">${num(sourceCount)}</span>` : ''}<span class="trail-label">No sistema da loja</span><span class="trail-hint">produtos que vêm do UniPlus</span></a></li>
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
  <p class="trail-side">${tag(plural(counts.blocked, 'pausado', 'pausados'), 'danger')} ${tag(plural(counts.archived, 'guardado', 'guardados'), 'muted')}</p>`;
}

// Poucos números, escritos como frase, escolhidos pelo que cada papel acompanha.
function tiles(role, c) {
  const all = {
    published: [c.published, 'produto à venda na internet', 'produtos à venda na internet', '#/fila?etapa=published'],
    preparing: [c.queueOpen, 'produto sendo preparado para vender', 'produtos sendo preparados para vender', '#/fila'],
    promos: [c.promotionsLive, 'promoção valendo hoje', 'promoções valendo hoje', '#/promocoes'],
    leads: [c.leadsOpen, 'cliente interessado esperando resposta', 'clientes interessados esperando resposta', '#/leads'],
    arts: [c.artsOpen, 'arte em andamento', 'artes em andamento', '#/artes'],
    campaigns: [c.campaignsRunning, 'campanha acontecendo', 'campanhas acontecendo', '#/campanhas']
  };
  const pick = {
    owner: ['published', 'preparing', 'promos', 'leads'],
    manager: ['published', 'preparing', 'promos', 'leads'],
    marketing: ['arts', 'campaigns', 'promos', 'leads'],
    site: ['preparing', 'published', 'promos', 'arts']
  }[role] || ['published', 'preparing', 'promos', 'leads'];
  return pick.map(key => {
    const [n = 0, one, many, href] = all[key];
    const late = key === 'arts' && c.artsLate ? `<em class="late">${plural(c.artsLate, 'atrasada', 'atrasadas')}</em>` : '';
    return `<li><a class="tile" href="${href}"><strong>${num(n)}</strong><span>${esc(n === 1 ? one : many)}</span>${late}</a></li>`;
  }).join('');
}

export default {
  id: 'inicio',
  title: 'Início',
  icon: 'home',

  load: () => get('/dashboard'),

  render({ user, data }) {
    const today = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const todo = data.todo;
    const lead = todo.length
      ? `Você tem ${todo.length === 1 ? '1 coisa' : `${num(todo.length)} coisas`} para resolver. Comece pela primeira da lista.`
      : 'Tudo em dia. Nada esperando por você agora.';
    const uniplus = data.integrations.find(i => i.id === 'uniplus');
    const stockWarning = uniplus?.status === 'error' && user.role !== 'marketing'
      ? notice(`<strong>O estoque e os preços não estão atualizando.</strong> O sistema da loja (UniPlus) não está respondendo. Confira se o computador da loja está ligado. <a href="#/integracoes">Ver conexões</a>`, 'warn')
      : '';

    return `${pageHead({ eyebrow: esc(today), title: greeting(user.name), lead })}
    ${stockWarning}

    <section class="panel tasks-panel" aria-labelledby="todoTitle">
      <div class="panel-head"><h2 id="todoTitle">Para resolver agora</h2>${todo.length ? `<span class="count-pill">${num(todo.length)}</span>` : ''}</div>
      ${todo.length ? `<ol class="task-list">${todo.map(t => `
        <li class="task">
          <span class="task-icon" aria-hidden="true">${icon(KIND_ICON[t.kind] || 'arrow')}</span>
          <div class="task-text"><h3>${esc(t.title)}</h3>${t.detail ? `<p>${esc(t.detail)}</p>` : ''}</div>
          <a class="btn primary task-btn" href="#/${esc(t.route)}"><span>${esc(t.action || 'Abrir')}</span>${icon('arrow')}</a>
        </li>`).join('')}</ol>`
        : `<div class="all-done">${icon('check')}<div><h3>Tudo em dia</h3><p>Quando alguém precisar de você, o pedido aparece aqui com um botão para resolver.</p></div></div>`}
    </section>

    <section class="block" aria-labelledby="shopTitle">
      <h2 class="block-title" id="shopTitle">Como está a loja</h2>
      <ul class="tiles">${tiles(user.role, data.counts)}</ul>
    </section>

    ${data.upcoming?.length ? `<section class="panel" aria-labelledby="upTitle">
      <div class="panel-head"><h2 id="upTitle">Próximos dias</h2><a class="link" href="#/agenda">Ver a agenda ${icon('arrow')}</a></div>
      <ul class="upcoming">${data.upcoming.map(e => `<li><a href="#/${esc(e.route)}">
        <span class="up-when"><strong>${esc(date(e.start).slice(0, 5))}</strong><small>${e.kind === 'campaign' ? 'Campanha' : 'Promoção'}</small></span>
        <span class="up-what"><strong>${esc(e.name)}</strong><small>${esc(countdown(data.today, e.start, e.end))}</small></span></a></li>`).join('')}</ul>
    </section>` : ''}

    <details class="more">
      <summary>Ver mais detalhes</summary>
      <section class="panel trail-panel" aria-labelledby="trailTitle">
        <div class="panel-head"><h2 id="trailTitle">Caminho dos produtos até a venda</h2><a class="link" href="#/fila">Ver anúncios ${icon('arrow')}</a></div>
        ${trail(data.pipeline, { sourceCount: data.counts.products })}
      </section>
      <section class="panel" aria-labelledby="intTitle">
        <div class="panel-head"><h2 id="intTitle">Conexões</h2><a class="link" href="#/integracoes">Ver detalhes ${icon('arrow')}</a></div>
        <ul class="status-list">${data.integrations.map(i => `
          <li><span class="status-name">${esc(i.name)}</span>${statusTag(INTEGRATION_STATUS, i.status)}
          <small>${i.status === 'error' ? 'Não está respondendo.' : i.lastSyncAt ? 'Atualizado ' + relative(i.lastSyncAt) : 'Ainda não foi ligado.'}</small></li>`).join('')}
        </ul>
      </section>
      ${data.recent.length ? `<section class="panel" aria-labelledby="recentTitle">
        <div class="panel-head"><h2 id="recentTitle">O que a equipe fez por último</h2><a class="link" href="#/historico">Ver tudo ${icon('arrow')}</a></div>
        <ul class="feed">${data.recent.map(e => `<li><span class="feed-who">${esc(e.actorName)}</span><span class="feed-what">${esc(e.summary)}</span><time datetime="${esc(e.at)}">${relative(e.at)}</time></li>`).join('')}</ul>
      </section>` : ''}
    </details>`;
  },

  actions: {}
};
