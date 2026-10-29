// Integrações: estado real de cada conexão, o que falta configurar e ações de sincronização.
import { get, post, patch } from '../api.js';
import { esc, icon, num, relative, dateTime, pageHead, notice, button, field, openModal, closeTopLayer, toast, statusTag } from '../ui.js';
import { INTEGRATION_STATUS } from '../../shared/domain.js';

const HELP = {
  uniplus: 'O servidor da loja lê a API local do UniPlus e atualiza o catálogo no intervalo de UNIPLUS_SYNC_SECONDS. Com o portal na Vercel, rode `npm run connector` na máquina do UniPlus.',
  nuvemshop: 'Crie um app na Nuvemshop (Parceiros) e autorize a loja para obter o token. A publicação e a importação de pedidos usam essas credenciais apenas no servidor.',
  ga4: 'Crie uma conta de serviço no Google Cloud, dê acesso de leitor à propriedade GA4 e informe o JSON no servidor.',
  googleads: 'Requer developer token aprovado, ID do cliente e refresh token OAuth da conta de anúncios.',
  metaads: 'Gere um token de sistema no Gerenciador de Negócios com acesso à conta de anúncios.'
};

export default {
  id: 'integracoes',
  title: 'Integrações',
  icon: 'link',
  group: 'Gestão',

  load: () => get('/integrations'),

  render({ user, config, data }) {
    const manage = ['owner', 'manager'].includes(user.role);
    return `${pageHead({ title: 'Integrações', lead: 'Credenciais ficam só no servidor (arquivo .env ou variáveis da Vercel). Aqui você vê o estado de cada conexão e o que falta.' })}
    <div class="int-list">${data.integrations.map(i => `
      <section class="panel int-card" aria-labelledby="int-${i.id}">
        <div class="int-head">
          <div><h2 id="int-${i.id}">${esc(i.name)}</h2><p class="muted">${esc(i.role)}</p></div>
          ${statusTag(INTEGRATION_STATUS, i.status)}
        </div>
        <dl class="facts">
          <div><dt>Última sincronização</dt><dd>${i.lastSyncAt ? `${esc(relative(i.lastSyncAt))} <small>${dateTime(i.lastSyncAt)}</small>` : 'Nunca'}</dd></div>
          ${i.itemCount !== null ? `<div><dt>Itens na última leitura</dt><dd class="mono">${num(i.itemCount)}</dd></div>` : ''}
          ${i.settings?.storeUrl ? `<div><dt>Loja</dt><dd><a href="${esc(i.settings.storeUrl)}" target="_blank" rel="noopener noreferrer">${esc(i.settings.storeUrl)} ${icon('external')}</a></dd></div>` : ''}
        </dl>
        ${i.lastError ? notice(`<strong>Erro${i.lastErrorAt ? ' ' + esc(relative(i.lastErrorAt)) : ''}:</strong> ${esc(i.lastError)}`, 'danger') : ''}
        ${i.missingEnv.length ? `<p class="hint">Falta no servidor: ${i.missingEnv.map(v => `<code>${esc(v)}</code>`).join(' ')}</p>` : ''}
        ${!i.implemented ? '<p class="hint">Leitura de dados desta fonte: próxima etapa do projeto.</p>' : ''}
        <details class="int-help"><summary>Como conectar</summary><p>${esc(HELP[i.id])}</p></details>
        <div class="int-actions">
          ${i.id === 'uniplus' && manage && !i.missingEnv.length && config.mediaAvailable ? button('Sincronizar agora', { action: 'sync-uniplus', icon: 'sync' }) : ''}
          ${i.id === 'nuvemshop' && manage && !i.missingEnv.length ? button('Importar pedidos', { action: 'sync-orders', icon: 'orders' }) : ''}
          ${manage ? button('Preferências', { action: 'settings', icon: 'settings', variant: 'ghost', data: { id: i.id } }) : ''}
        </div>
      </section>`).join('')}
    </div>`;
  },

  actions: {
    async 'sync-uniplus'(ctx) {
      toast('Sincronizando com o UniPlus…', 'info');
      const r = await post('/products/sync');
      toast(r.skipped ? 'Já havia uma sincronização em andamento.' : `${num(r.received)} produtos sincronizados.`);
      await ctx.refresh();
    },
    async 'sync-orders'(ctx) {
      const r = await post('/orders/sync');
      toast(`${num(r.count)} pedidos importados.`);
      await ctx.refresh();
    },
    settings(ctx, el) {
      const i = ctx.data.integrations.find(x => x.id === el.dataset.id);
      openModal({
        title: `Preferências · ${i.name}`,
        body: `<form data-form="settings" id="intForm" class="form-grid" data-id="${esc(i.id)}">
          ${i.id === 'nuvemshop' ? field('storeUrl', 'Endereço público da loja', { type: 'url', full: true, value: i.settings.storeUrl, placeholder: 'https://www.shoppingrural.com.br' }) : ''}
          ${field('notes', 'Anotações da equipe', { type: 'textarea', full: true, rows: 3, value: i.settings.notes, max: 500 })}
          <p class="full hint">Não escreva senhas ou tokens aqui. Credenciais vão apenas nas variáveis de ambiente do servidor.</p>
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
      toast('Preferências salvas.');
      await ctx.refresh();
    }
  }
};
