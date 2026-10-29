// Indicadores de mídia (GA4, Google Ads, Meta Ads) e entrada de leads.
// Mostra o último resumo guardado de cada fonte. Sem conexão, nada de número inventado:
// a tela diz exatamente o que falta configurar.
import { get, post } from '../api.js';
import { esc, icon, money, num, relative, pageHead, notice, button, statusTag, toast } from '../ui.js';
import { INTEGRATION_STATUS } from '../../shared/domain.js';

const SOURCES = [
  ['ga4', 'Visitas, origem do tráfego e conversões do site.'],
  ['googleads', 'Investimento, cliques e conversões das campanhas no Google.'],
  ['metaads', 'Gasto, alcance e leads no Facebook e Instagram.']
];

const fmt = (value, format) => format === 'money' ? money(value) : format === 'percent' ? `${num(Math.round(value * 100) / 100)}%` : format === 'int' ? num(Math.round(value)) : esc(value);

function sourceCard(id, text, integration, report, canSync) {
  const head = `<div class="panel-head"><h2 id="src-${id}">${esc(integration.name)}</h2>${statusTag(INTEGRATION_STATUS, integration.status)}</div>`;
  if (!report) {
    return `<section class="panel source-card" aria-labelledby="src-${id}">${head}
      <p class="muted">${esc(text)}</p>
      ${integration.missingEnv.length ? `<p class="hint">Falta configurar no servidor: ${integration.missingEnv.map(v => `<code>${esc(v)}</code>`).join(' ')}</p>` : ''}
      ${integration.lastError ? notice(esc(integration.lastError), 'danger') : ''}
      ${canSync && !integration.missingEnv.length ? button('Buscar dados agora', { action: 'sync', icon: 'sync', data: { source: id } }) : ''}
    </section>`;
  }
  return `<section class="panel source-card" aria-labelledby="src-${id}">${head}
    <p class="hint">${esc(report.period)} · atualizado ${esc(relative(report.syncedAt))}</p>
    <dl class="ledger">${report.summary.map(m => `<div><dt>${esc(m.label)}</dt><dd>${fmt(m.value, m.format)}</dd></div>`).join('')}</dl>
    ${integration.lastError ? notice(`Última atualização falhou: ${esc(integration.lastError)}`, 'warn') : ''}
    ${report.table?.rows?.length ? `<details class="section"><summary><h3>${esc(report.table.title)}</h3></summary>
      <div class="table-wrap"><table class="table compact"><thead><tr>${report.table.columns.map(c => `<th scope="col"${c.format !== 'text' ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${report.table.rows.slice(0, 20).map(r => `<tr>${report.table.columns.map(c => `<td${c.format !== 'text' ? ' class="num mono"' : ''}>${fmt(r[c.key], c.format)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : ''}
    ${canSync ? `<div class="int-actions">${button('Atualizar agora', { action: 'sync', icon: 'sync', variant: 'ghost small', data: { source: id } })}</div>` : ''}
  </section>`;
}

export default {
  id: 'midia',
  title: 'Indicadores e leads',
  icon: 'chart',
  group: 'Marketing',

  async load() {
    const [{ integrations }, { metrics }] = await Promise.all([get('/integrations'), get('/metrics')]);
    return { integrations, metrics };
  },

  render({ user, data }) {
    const byId = Object.fromEntries(data.integrations.map(i => [i.id, i]));
    const canSync = ['owner', 'manager', 'marketing'].includes(user.role);
    const leads = byId.leads;
    const meta = byId.metaads;
    const endpoint = `${location.origin}/api/leads/inbound`;
    return `${pageHead({ title: 'Indicadores e leads', lead: 'Resultados de tráfego e anúncios, atualizados automaticamente quando as contas estiverem conectadas no servidor.' })}
    <div class="metric-sources">${SOURCES.map(([id, text]) => sourceCard(id, text, byId[id], data.metrics[id], canSync)).join('')}</div>
    ${notice('Conversões atribuídas pelo Google e pela Meta podem contar a mesma venda. O portal não soma esses números como vendas únicas.', 'info')}

    <section class="panel" aria-labelledby="leadsIn">
      <div class="panel-head"><h2 id="leadsIn">Entrada automática de leads</h2>${statusTag(INTEGRATION_STATUS, leads.status)}</div>
      <p>Qualquer ferramenta pode criar leads no portal (formulário do site via servidor, robô de WhatsApp, Zapier, Make). Se o contato já existir, a mensagem vira comentário no lead.</p>
      <dl class="facts one-col">
        <div><dt>Endereço</dt><dd class="mono">POST ${esc(endpoint)}</dd></div>
        <div><dt>Autenticação</dt><dd>Cabeçalho <code>Authorization: Bearer &lt;LEADS_WEBHOOK_TOKEN&gt;</code>${leads.missingEnv.length ? ' — <strong>token ainda não configurado no servidor</strong>' : ''}</dd></div>
        <div><dt>Corpo (JSON)</dt><dd><code>{"name":"Maria","phone":"34999990000","email":"","source":"WhatsApp","message":"Quer ração 15 kg","campaign":"Semana do gato"}</code></dd></div>
      </dl>
      <div class="int-actions">
        <a class="btn ghost" href="#/leads">${icon('users')}<span>Ver leads</span></a>
        ${canSync && !meta.missingEnv.length ? button('Importar leads do Meta', { action: 'import-meta', icon: 'sync' }) : ''}
      </div>
      <p class="hint">Leads de formulários do Facebook/Instagram: configure <code>META_LEAD_FORM_IDS</code> e <code>META_PAGE_ACCESS_TOKEN</code>.</p>
    </section>`;
  },

  actions: {
    async sync(ctx, el) {
      try {
        await post(`/metrics/${el.dataset.source}/sync`);
        toast('Indicadores atualizados.');
      } catch (error) {
        toast(error.message, 'danger');
      }
      await ctx.refresh();
    },
    async 'import-meta'(ctx) {
      const result = await post('/leads/import-meta');
      toast(`${num(result.created)} lead(s) novo(s) de ${num(result.received)} recebido(s).`);
      await ctx.refresh();
    }
  }
};
