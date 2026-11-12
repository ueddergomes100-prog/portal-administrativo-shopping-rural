// Ajustes: o que se usa de vez em quando fica reunido aqui, longe do dia a dia.
import { esc, icon, pageHead } from '../ui.js';

const CARDS = [
  { href: '#/conta', ic: 'user', title: 'Minha conta', text: 'Seu nome e sua senha.' },
  { href: '#/canais', ic: 'money', title: 'Taxas de venda', text: 'Quanto a Shopee, o Mercado Livre e o site cobram em cada venda.' },
  { href: '#/frete', ic: 'truck', title: 'Frete e entrega', text: 'Motoboy por cidade, Correios e Jadlog, e retirada na loja.', roles: ['owner', 'manager'] },
  { href: '#/equipe', ic: 'shield', title: 'Equipe', text: 'Quem usa o portal e o que cada pessoa pode fazer.', roles: ['owner', 'manager'] },
  { href: '#/integracoes', ic: 'link', title: 'Conexões', text: 'Se o sistema da loja e o site estão funcionando.' },
  { href: '#/historico', ic: 'history', title: 'Histórico', text: 'Tudo o que foi feito no portal, por quem e quando.', roles: ['owner', 'manager'] }
];

export default {
  id: 'ajustes',
  title: 'Ajustes',
  icon: 'settings',

  load: () => Promise.resolve({}),

  render({ user }) {
    const big = document.documentElement.classList.contains('big-text');
    const cards = CARDS.filter(c => !c.roles || c.roles.includes(user.role));
    return `${pageHead({ title: 'Ajustes', lead: 'Coisas que a gente mexe de vez em quando.' })}
    <ul class="hub">
      <li><button type="button" class="hub-card" data-action="text-size" aria-pressed="${big}">
        <span class="hub-icon" aria-hidden="true">Aa</span>
        <span><strong>Letra maior</strong><small>${big ? 'Ligada. Toque de novo para voltar ao tamanho normal.' : 'Deixa todo o portal com letras e botões maiores neste aparelho.'}</small></span>
        <span class="hub-switch" aria-hidden="true"></span>
      </button></li>
      <li><button type="button" class="hub-card" data-action="update-app">
        <span class="hub-icon" aria-hidden="true">${icon('refresh')}</span>
        <span><strong>Atualizar o portal</strong><small>Carrega a versão mais nova. Use se algo parecer antigo ou travado.</small></span>
        ${icon('arrow', 'hub-go')}
      </button></li>
      ${cards.map(c => `<li><a class="hub-card" href="${c.href}">
        <span class="hub-icon">${icon(c.ic)}</span>
        <span><strong>${esc(c.title)}</strong><small>${esc(c.text)}</small></span>
        ${icon('arrow', 'hub-go')}
      </a></li>`).join('')}
    </ul>`;
  },

  actions: {}
};
