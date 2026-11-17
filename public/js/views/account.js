// Minha conta: nome, troca de senha, avisos neste aparelho e resumo do papel.
import { patch } from '../api.js';
import { icon, pageHead, field, toast, button, notice } from '../ui.js';
import { ROLES } from '../../shared/domain.js';
import { authMode, signOut } from '../auth.js';
import { pushState, enablePush, disablePush, sendTestPush } from '../push.js';

// Avisos no celular deste aparelho: diz como está e o botão que resolve.
function pushPanel(config) {
  const state = pushState(config);
  const text = {
    'server-off': 'Os avisos no celular ainda não foram ligados na loja. Quem instala o portal precisa colocar a chave dos avisos.',
    'needs-install': 'No iPhone, os avisos só chegam com o portal na tela de início: toque em <strong>Compartilhar</strong> → <strong>Adicionar à Tela de Início</strong> e abra o portal pelo ícone.',
    unsupported: 'Este navegador não recebe avisos. No Android ou no computador, use o Chrome.',
    denied: 'Os avisos estão <strong>bloqueados</strong> neste aparelho. Libere nas configurações do navegador para este site e volte aqui.',
    off: 'Os avisos estão <strong>desligados</strong> neste aparelho.',
    on: 'Os avisos estão <strong>ligados</strong> neste aparelho. Você recebe quando um produto for pedido, ficar pronto para aprovar, for aprovado ou precisar de correção.'
  }[state];
  const actions = state === 'on'
    ? `${button('Mandar um aviso de teste', { action: 'push-test', icon: 'send' })}${button('Desligar avisos', { action: 'push-off', variant: 'ghost' })}`
    : state === 'off' ? button('Ativar avisos', { action: 'push-on', icon: 'bell', variant: 'primary' }) : '';
  return `<section class="panel"><div class="panel-head"><h2>Avisos neste aparelho</h2></div>
    ${notice(text, state === 'on' ? 'ok' : state === 'denied' ? 'warn' : 'info')}
    ${actions ? `<div class="form-actions">${actions}</div>` : ''}
  </section>`;
}

export default {
  id: 'conta',
  title: 'Minha conta',
  icon: 'user',

  load: () => Promise.resolve({}),

  render({ user, config }) {
    return `${pageHead({ title: 'Minha conta', lead: `${ROLES[user.role]?.label}: ${ROLES[user.role]?.description}` })}
    ${pushPanel(config)}
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Seus dados</h2></div>
        <form data-form="profile" class="form-grid">
          ${field('name', 'Nome', { required: true, full: true, value: user.name, max: 120 })}
          ${field('email', 'E-mail', { full: true, value: user.email, disabled: true, hint: 'Para trocar o e-mail, fale com o dono da loja.' })}
          <div class="form-error full"></div>
          <div class="full form-actions"><button class="btn" type="submit">${icon('check')}<span>Salvar</span></button></div>
        </form>
      </section>
      <section class="panel"><div class="panel-head"><h2>Trocar senha</h2></div>
        <form data-form="password" class="form-grid">
          ${field('password', 'Nova senha', { type: 'password', required: true, full: true, hint: 'Pelo menos 8 caracteres.' })}
          ${field('confirm', 'Digite a nova senha de novo', { type: 'password', required: true, full: true })}
          <div class="form-error full"></div>
          <div class="full form-actions"><button class="btn" type="submit">${icon('lock')}<span>Trocar senha</span></button></div>
        </form>
      </section>
    </div>
    <p>${button('Sair do portal', { action: 'logout', icon: 'logout', variant: 'ghost' })}</p>`;
  },

  actions: {
    async 'push-on'(ctx) {
      try {
        await enablePush(ctx.config);
        toast('Pronto! Os avisos vão chegar neste aparelho.');
      } catch (error) {
        toast(error.message, 'danger');
      }
      ctx.rerender();
    },
    async 'push-off'(ctx) {
      await disablePush();
      toast('Avisos desligados neste aparelho.');
      ctx.rerender();
    },
    async 'push-test'() {
      try {
        await sendTestPush();
        toast('Aviso de teste enviado. Ele chega em alguns segundos.');
      } catch (error) {
        toast(error.message, 'danger');
      }
    }
  },

  forms: {
    async profile(ctx, data) {
      const { user } = await patch(`/users/${ctx.user.id}`, { name: data.name });
      Object.assign(ctx.user, user);
      toast('Dados salvos.');
      ctx.rerender();
    },
    async password(ctx, data, form) {
      if (data.password !== data.confirm) throw new Error('As duas senhas estão diferentes. Digite a mesma senha nos dois campos.');
      await patch(`/users/${ctx.user.id}`, { password: data.password });
      form.reset();
      if (authMode() === 'local') {
        toast('Senha trocada. Entre de novo com a senha nova.');
        await signOut();
        setTimeout(() => location.reload(), 1200);
      } else {
        toast('Senha trocada.');
      }
    }
  }
};

