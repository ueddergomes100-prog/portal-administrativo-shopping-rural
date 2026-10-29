// Agenda: calendário do mês com campanhas, promoções e prazos de arte, e a lista do que vem por aí.
import { get } from '../api.js';
import { esc, icon, date, num, pageHead, button, empty, statusTag } from '../ui.js';
import { CAMPAIGN_STATUS, PROMOTION_STATUS, ART_STATUS, todayInSaoPaulo } from '../../shared/domain.js';

const KIND = {
  campaign: { label: 'Campanha', route: 'campanhas' },
  promotion: { label: 'Promoção', route: 'promocoes' },
  art: { label: 'Prazo de arte', route: 'artes' }
};

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400_000);

function when(today, start, end) {
  const toStart = daysBetween(today, start);
  if (toStart > 1) return `começa em ${num(toStart)} dias`;
  if (toStart === 1) return 'começa amanhã';
  if (toStart === 0) return 'começa hoje';
  const toEnd = daysBetween(today, end);
  return toEnd === 0 ? 'termina hoje' : `rolando · termina em ${num(toEnd)} dia(s)`;
}

export default {
  id: 'agenda',
  title: 'Agenda',
  icon: 'calendar',
  group: 'Marketing',

  async load({ state }) {
    const today = todayInSaoPaulo();
    state.month ??= today.slice(0, 7);
    const [campaigns, promotions, arts] = await Promise.all([
      get('/campaigns').then(r => r.records), get('/promotions').then(r => r.records), get('/arts').then(r => r.records)
    ]);
    const events = [
      ...campaigns.filter(c => c.status !== 'cancelled').map(c => ({ kind: 'campaign', id: c.id, name: c.name, start: c.start, end: c.end, status: CAMPAIGN_STATUS[c.status] })),
      ...promotions.filter(p => p.status !== 'cancelled').map(p => ({ kind: 'promotion', id: p.id, name: p.name, start: p.start, end: p.end, status: PROMOTION_STATUS[p.status] })),
      ...arts.filter(a => a.status !== 'published' && a.deadline).map(a => ({ kind: 'art', id: a.id, name: a.title, start: a.deadline, end: a.deadline, status: ART_STATUS[a.status] }))
    ];
    return { events, today };
  },

  render({ user, state, data }) {
    const { events, today } = data;
    const [year, month] = state.month.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7; // semana começa na segunda
    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
    const label = monthName[0].toUpperCase() + monthName.slice(1);

    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<div class="cal-cell is-out" aria-hidden="true"></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const day = iso(year, month, d);
      const list = events.filter(e => e.start <= day && e.end >= day);
      cells.push(`<div class="cal-cell${day === today ? ' is-today' : ''}"><span class="cal-day">${d}</span>
        ${list.slice(0, 4).map(e => `<a class="cal-event kind-${e.kind}" href="#/${KIND[e.kind].route}/${esc(e.id)}" title="${esc(KIND[e.kind].label)}: ${esc(e.name)}">${esc(e.name)}</a>`).join('')}
        ${list.length > 4 ? `<span class="cal-more">+${list.length - 4}</span>` : ''}</div>`);
    }

    const horizon = new Date(Date.parse(today + 'T12:00:00Z') + 90 * 86400_000).toISOString().slice(0, 10);
    const upcoming = events.filter(e => e.kind !== 'art' && e.end >= today && e.start <= horizon).sort((a, b) => a.start.localeCompare(b.start));
    const deadlines = events.filter(e => e.kind === 'art' && e.end >= today && e.start <= horizon).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 10);
    const canCreate = ['owner', 'manager', 'marketing'].includes(user.role);

    return `${pageHead({
      title: 'Agenda',
      lead: 'Tudo que vem por aí: campanhas, promoções e prazos de arte. Clique para abrir.',
      actions: canCreate ? `<a class="btn primary" href="#/campanhas">${icon('plus')}<span>Planejar campanha</span></a>` : ''
    })}
    <div class="grid-agenda">
      <section class="panel" aria-labelledby="calTitle">
        <div class="panel-head">
          <h2 id="calTitle" class="cal-title">${esc(label)}</h2>
          <div class="cal-nav">${button('Mês anterior', { action: 'month', data: { delta: -1 }, icon: 'back', variant: 'ghost small' })}${button('Hoje', { action: 'month', data: { delta: 0 }, variant: 'ghost small' })}${button('Próximo mês', { action: 'month', data: { delta: 1 }, icon: 'arrow', variant: 'ghost small' })}</div>
        </div>
        <div class="cal-legend"><span class="cal-event kind-campaign">Campanha</span><span class="cal-event kind-promotion">Promoção</span><span class="cal-event kind-art">Prazo de arte</span></div>
        <div class="cal" role="grid" aria-label="Calendário de ${esc(label)}">
          ${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(d => `<div class="cal-dow" role="columnheader">${d}</div>`).join('')}
          ${cells.join('')}
        </div>
      </section>
      <div>
        <section class="panel" aria-labelledby="nextTitle">
          <div class="panel-head"><h2 id="nextTitle">Próximos 90 dias</h2></div>
          ${upcoming.length ? `<ul class="upcoming">${upcoming.map(e => `<li><a href="#/${KIND[e.kind].route}/${esc(e.id)}">
            <span class="up-when"><strong>${esc(date(e.start).slice(0, 5))}</strong><small>${esc(KIND[e.kind].label)}</small></span>
            <span class="up-what"><strong>${esc(e.name)}</strong><small>${esc(when(today, e.start, e.end))} · até ${esc(date(e.end))}</small></span>
            ${e.status ? `<span class="up-tag">${statusTag({ x: e.status }, 'x')}</span>` : ''}</a></li>`).join('')}</ul>`
            : empty({ title: 'Nada agendado', text: 'Planeje a próxima campanha com antecedência para dar tempo das artes.', ic: 'calendar' })}
        </section>
        <section class="panel" aria-labelledby="dlTitle">
          <div class="panel-head"><h2 id="dlTitle">Prazos de arte</h2><a class="link" href="#/artes">Quadro de artes ${icon('arrow')}</a></div>
          ${deadlines.length ? `<ul class="upcoming">${deadlines.map(e => `<li><a href="#/artes/${esc(e.id)}">
            <span class="up-when"><strong>${esc(date(e.start).slice(0, 5))}</strong><small>${daysBetween(today, e.start) === 0 ? 'hoje' : `em ${num(daysBetween(today, e.start))} d`}</small></span>
            <span class="up-what"><strong>${esc(e.name)}</strong><small>${esc(e.status?.label || '')}</small></span></a></li>`).join('')}</ul>`
            : '<p class="muted">Nenhum prazo nos próximos 90 dias.</p>'}
        </section>
      </div>
    </div>`;
  },

  actions: {
    month(ctx, el) {
      const delta = Number(el.dataset.delta);
      if (delta === 0) ctx.state.month = todayInSaoPaulo().slice(0, 7);
      else {
        const [y, m] = ctx.state.month.split('-').map(Number);
        const next = new Date(Date.UTC(y, m - 1 + delta, 1));
        ctx.state.month = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
      }
      ctx.rerender();
    }
  }
};
