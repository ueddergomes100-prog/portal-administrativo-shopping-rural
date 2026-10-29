// Indicadores de mídia (GA4, Google Ads, Meta Ads). Sem integração conectada, nada de número inventado:
// a tela mostra exatamente o que falta configurar.
import { get } from '../api.js';
import { esc, icon, pageHead, notice, statusTag } from '../ui.js';
import { INTEGRATION_STATUS } from '../../shared/domain.js';

const SOURCES = [
  ['ga4', 'Visitas, origem do tráfego (orgânico, redes, anúncios, direto) e conversões do site.', ['Sessões', 'Usuários', 'Conversões', 'Taxa de conversão']],
  ['googleads', 'Investimento, cliques, custo por clique e conversões por campanha de pesquisa.', ['Investimento', 'Cliques', 'Conversões', 'Custo por conversão']],
  ['metaads', 'Alcance, gasto, leads gerados e conversões no Facebook e Instagram.', ['Alcance', 'Gasto', 'Leads', 'Custo por lead']]
];

export default {
  id: 'midia',
  title: 'Indicadores de mídia',
  icon: 'chart',
  group: 'Marketing',

  load: () => get('/integrations'),

  render({ data }) {
    const byId = Object.fromEntries(data.integrations.map(i => [i.id, i]));
    return `${pageHead({ title: 'Indicadores de mídia', lead: 'Resultados de tráfego e anúncios. Cada bloco mostra números reais assim que a conta for conectada no servidor.' })}
    <div class="metric-sources">${SOURCES.map(([id, text, metrics]) => {
      const i = byId[id];
      return `<section class="panel source-card" aria-labelledby="src-${id}">
        <div class="panel-head"><h2 id="src-${id}">${esc(i.name)}</h2>${statusTag(INTEGRATION_STATUS, i.status)}</div>
        <p class="muted">${esc(text)}</p>
        <dl class="ledger dim">${metrics.map(m => `<div><dt>${esc(m)}</dt><dd aria-label="sem dados">—</dd></div>`).join('')}</dl>
        ${i.missingEnv.length ? `<p class="hint">Falta configurar no servidor: ${i.missingEnv.map(v => `<code>${esc(v)}</code>`).join(', ')}</p>` : ''}
        ${i.status === 'awaiting_auth' && !i.implemented ? '<p class="hint">Credenciais presentes. A leitura dos relatórios desta fonte ainda será implementada (docs/ROADMAP.md).</p>' : ''}
      </section>`;
    }).join('')}</div>
    ${notice('Conversões atribuídas pelo Google e pela Meta podem contar a mesma venda. O portal não soma esses números como vendas únicas.', 'info')}
    <p><a class="link" href="#/integracoes">Ver todas as integrações ${icon('arrow')}</a></p>`;
  }
};
