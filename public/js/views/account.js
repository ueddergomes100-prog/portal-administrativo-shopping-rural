// Minha conta: nome, troca de senha e resumo do papel.
import { patch } from '../api.js';
import { icon, pageHead, field, toast, button } from '../ui.js';
import { ROLES } from '../../shared/domain.js';
import { authMode, signOut } from '../auth.js';

export default {
  id: 'conta',
  title: 'Minha conta',
  icon: 'user',
  group: null, // acessada pelo rodapé da navegação

  load: () => Promise.resolve({}),

  render({ user }) {
    return `${pageHead({ title: 'Minha conta', lead: `${ROLES[user.role]?.label}: ${ROLES[user.role]?.description}` })}
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
          ${field('password', 'Nova senha', { type: 'password', required: true, full: true, hint: 'Mínimo de 8 caracteres.' })}
          ${field('confirm', 'Repita a nova senha', { type: 'password', required: true, full: true })}
          <div class="form-error full"></div>
          <div class="full form-actions"><button class="btn" type="submit">${icon('lock')}<span>Trocar senha</span></button></div>
        </form>
      </section>
    </div>
    <p>${button('Sair do portal', { action: 'logout', icon: 'logout', variant: 'ghost' })}</p>`;
  },

  forms: {
    async profile(ctx, data) {
      const { user } = await patch(`/users/${ctx.user.id}`, { name: data.name });
      Object.assign(ctx.user, user);
      toast('Dados salvos.');
      ctx.rerender();
    },
    async password(ctx, data, form) {
      if (data.password !== data.confirm) throw new Error('As duas senhas não são iguais.');
      await patch(`/users/${ctx.user.id}`, { password: data.password });
      form.reset();
      if (authMode() === 'local') {
        toast('Senha trocada. Entre novamente com a nova senha.');
        await signOut();
        setTimeout(() => location.reload(), 1200);
      } else {
        toast('Senha trocada.');
      }
    }
  }
};

