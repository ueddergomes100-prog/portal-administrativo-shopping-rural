// Integrações: estado real de cada conexão, o que falta configurar e ações de sincronização.
import { get, post, patch } from '../api.js';
import { esc, icon, num, relative, dateTime, pageHead, notice, button, field, openModal, closeTopLayer, toast, statusTag } from '../ui.js';
import { INTEGRATION_STATUS } from '../../shared/domain.js';

const HELP = {
  uniplus: 'O servidor da loja lê a API local do UniPlus e atualiza o catálogo no intervalo de UNIPLUS_SYNC_SECONDS. Com o portal na Vercel, rode `npm run connector` na máquina do UniPlus.',
  site: 'O site próprio lê o catálogo publicado em /api/store/catalog e envia os pedidos (com a situação do pagamento) para /api/store/orders usando STORE_API_TOKEN. Contrato completo em docs/SITE.md.',
  ga4: 'Crie uma conta de serviço no Google Cloud, dê acesso de leitor à propriedade GA4 e informe o JSON no servidor.',
  googleads: 'Requer developer token aprovado, ID do cliente, app OAuth (client id/secret) e refresh token da conta de anúncios.',
  metaads: 'Gere um token de usuário do sistema no Gerenciador de Negócios com acesso à conta de anúncios (permissão ads_read). Para leads, um token da página com leads_retrieval.',
  leads: 'Defina LEADS_WEBHOOK_TOKEN no servidor. Ferramentas externas enviam leads para /api/leads/inbound com esse token (detalhes em Resultados).'
};

export default {
  id: 'integracoes',
  title: 'Conexões',
  icon: 'link',

  load: () => get('/integrations'),

  render({ user, config, data }) {
    const manage = ['owner', 'manager'].includes(user.role);
    return `${pageHead({ title: 'Conexões', lead: 'Veja se o portal está ligado ao sistema da loja, ao site e às contas de anúncios. Se algo estiver com problema, avise quem instalou o portal.' })}
    <div class="int-list">${data.integrations.map(i => `
      <section class="panel int-card" aria-labelledby="int-${i.id}">
        <div class="int-head">
          <div><h2 id="int-${i.id}">${esc(i.name)}</h2><p class="muted">${esc(i.role)}</p></div>
          ${statusTag(INTEGRATION_STATUS, i.status)}
        </div>
        <dl class="facts">
          <div><dt>Última atualização</dt><dd>${i.lastSyncAt ? `${esc(relative(i.lastSyncAt))} <small>${dateTime(i.lastSyncAt)}</small>` : 'Ainda não'}</dd></div>
          ${i.itemCount !== null ? `<div><dt>Itens recebidos da última vez</dt><dd class="mono">${num(i.itemCount)}</dd></div>` : ''}
          ${i.settings?.storeUrl ? `<div><dt>Endereço</dt><dd><a href="${esc(i.settings.storeUrl)}" target="_blank" rel="noopener noreferrer">${esc(i.settings.storeUrl)} ${icon('external')}</a></dd></div>` : ''}
        </dl>
        ${i.lastError ? notice(`<strong>Problema${i.lastErrorAt ? ' ' + esc(relative(i.lastErrorAt)) : ''}:</strong> ${esc(i.lastError)}`, 'danger') : ''}
        ${i.missingEnv.length ? '<p class="hint">Falta terminar a ligação. Quem instala o portal vê o que falta em “Como ligar”.</p>' : ''}
        ${!i.implemented ? '<p class="hint">Esta conexão ainda não está pronta no portal. Vem numa próxima etapa.</p>' : ''}
        <details class="int-help"><summary>Como ligar (para quem instala o portal)</summary><p>${esc(HELP[i.id])}</p>${i.missingEnv.length ? `<p class="hint">Falta no servidor: ${i.missingEnv.map(v => `<code>${esc(v)}</code>`).join(' ')}</p>` : ''}</details>
        <div class="int-actions">
          ${i.id === 'uniplus' && manage && !i.missingEnv.length && config.mediaAvailable ? button('Atualizar agora', { action: 'sync-uniplus', icon: 'sync' }) : ''}
          ${manage ? button('Anotações', { action: 'settings', icon: 'settings', variant: 'ghost', data: { id: i.id } }) : ''}
        </div>
      </section>`).join('')}
    </div>`;
  },

  actions: {
    async 'sync-uniplus'(ctx) {
      toast('Buscando os produtos no sistema da loja…', 'info');
      const r = await post('/products/sync');
      toast(r.skipped ? 'Já tem uma atualização em andamento. Espere um pouco.' : `${num(r.received)} produtos atualizados.`);
      await ctx.refresh();
    },
    settings(ctx, el) {
      const i = ctx.data.integrations.find(x => x.id === el.dataset.id);
      openModal({
        title: `Anotações · ${i.name}`,
        body: `<form data-form="settings" id="intForm" class="form-grid" data-id="${esc(i.id)}">
          ${field('notes', 'Anotações da equipe', { type: 'textarea', full: true, rows: 3, value: i.settings.notes, max: 500 })}
          <p class="full hint">Não escreva senhas nem códigos de acesso aqui.</p>
          <div class="form-error full"></div>
        </form>`,
        footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button type="submit" class="btn primary" form="intForm">Salvar</button>`
      });
    }
  },

  forms: {
    async settings(ctx, data, form) {
      await patch(`/integrations/${form.dataset.id}`, data);
      closeTopLayer();
      toast('Anotações salvas.');
      await ctx.refresh();
    }
  }
};
