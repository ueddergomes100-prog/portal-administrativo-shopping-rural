// Equipe: o dono cadastra pessoas, define papel, autoriza gerente a aprovar e ativa/desativa acesso.
import { get, post, patch } from '../api.js';
import { esc, icon, relative, pageHead, button, field, openModal, closeTopLayer, toast, confirmDialog, tag, initials } from '../ui.js';
import { ROLES, ROLE_KEYS } from '../../shared/domain.js';

export default {
  id: 'equipe',
  title: 'Equipe e acessos',
  icon: 'shield',
  group: 'Gestão',
  roles: ['owner', 'manager'],

  load: () => get('/users'),

  render({ user, data }) {
    const owner = user.role === 'owner';
    return `${pageHead({
      title: 'Equipe e acessos',
      lead: owner ? 'Cadastre quem usa o portal e defina o papel de cada pessoa. Desativar bloqueia o acesso na hora.' : 'Pessoas com acesso ao portal. Só o dono altera papéis e acessos.',
      actions: owner ? button('Cadastrar pessoa', { action: 'new', icon: 'plus', variant: 'primary' }) : ''
    })}
    <div class="role-guide">${ROLE_KEYS.map(r => `<div><strong>${esc(ROLES[r].label)}</strong><p>${esc(ROLES[r].description)}</p></div>`).join('')}</div>
    <section class="panel flush"><div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Pessoa</th><th scope="col">Papel</th><th scope="col">Aprova</th><th scope="col">Acesso</th><th scope="col">Último login</th>${owner ? '<th scope="col"><span class="sr-only">Ações</span></th>' : ''}</tr></thead>
      <tbody>${data.users.map(u => `<tr${u.active ? '' : ' class="is-muted"'}>
        <td><span class="person"><span class="avatar small" aria-hidden="true">${esc(initials(u.name))}</span><span><strong>${esc(u.name)}</strong><span class="sub">${esc(u.email || '')}</span></span></span></td>
        <td>${esc(ROLES[u.role]?.label || u.role)}</td>
        <td>${u.role === 'owner' || (u.role === 'manager' && u.canApprove) ? tag('Sim', 'ok') : '<span class="muted">Não</span>'}</td>
        <td>${u.active ? tag('Ativo', 'ok') : tag('Desativado', 'muted')}</td>
        <td class="nowrap">${esc(relative(u.lastLoginAt))}</td>
        ${owner ? `<td class="row-actions">${button('Editar', { action: 'edit', icon: 'edit', variant: 'ghost small', data: { id: u.id } })}</td>` : ''}
      </tr>`).join('')}</tbody></table></div></section>`;
  },

  actions: {
    new() {
      openModal({
        title: 'Cadastrar pessoa',
        body: `<form data-form="create" id="userForm" class="form-grid">
          ${field('name', 'Nome', { required: true, full: true, max: 120 })}
          ${field('email', 'E-mail de acesso', { type: 'email', required: true, full: true })}
          ${field('role', 'Papel', { type: 'select', options: ROLE_KEYS.map(r => [r, ROLES[r].label]), value: 'marketing' })}
          ${field('password', 'Senha inicial', { type: 'password', required: true, hint: 'Mínimo de 8 caracteres. Passe para a pessoa por um canal seguro e peça para trocar em Minha conta.' })}
          <label class="check full"><input type="checkbox" name="canApprove" value="true"><span>Gerente pode aprovar publicações, artes, campanhas e promoções</span></label>
          <div class="form-error full"></div>
        </form>`,
        footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button type="submit" class="btn primary" form="userForm">${icon('check')}<span>Cadastrar</span></button>`
      });
    },
    edit(ctx, el) {
      const u = ctx.data.users.find(x => x.id === el.dataset.id);
      const self = u.id === ctx.user.id;
      openModal({
        title: `Editar acesso · ${u.name}`,
        body: `<form data-form="update" id="userEdit" class="form-grid" data-id="${esc(u.id)}">
          ${field('name', 'Nome', { required: true, full: true, max: 120, value: u.name })}
          ${field('role', 'Papel', { type: 'select', options: ROLE_KEYS.map(r => [r, ROLES[r].label]), value: u.role })}
          ${field('active', 'Acesso', { type: 'select', options: [['true', 'Ativo'], ['false', 'Desativado']], value: String(u.active) })}
          <label class="check full"><input type="checkbox" name="canApprove" value="true"${u.canApprove ? ' checked' : ''}><span>Gerente pode aprovar (vale só para o papel Gerente)</span></label>
          ${field('password', 'Nova senha (opcional)', { type: 'password', full: true, hint: 'Preencha só se quiser redefinir. A pessoa precisará entrar de novo.' })}
          ${self ? '<p class="full hint">Você está editando o próprio acesso. O portal impede remover o último dono ativo.</p>' : ''}
          <div class="form-error full"></div>
        </form>`,
        footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button type="submit" class="btn primary" form="userEdit">${icon('check')}<span>Salvar</span></button>`
      });
    }
  },

  forms: {
    async create(ctx, data) {
      await post('/users', { ...data, canApprove: [].concat(data.canApprove || []).includes('true') });
      closeTopLayer();
      ctx.invalidate('users');
      toast('Pessoa cadastrada. Ela já pode entrar com o e-mail e a senha inicial.');
      await ctx.refresh();
    },
    async update(ctx, data, form) {
      const body = { name: data.name, role: data.role, active: data.active === 'true', canApprove: [].concat(data.canApprove || []).includes('true') };
      if (data.password) body.password = data.password;
      if (!body.active) {
        const ok = await confirmDialog({ title: 'Desativar acesso?', text: 'A pessoa sai do portal imediatamente e não consegue entrar até ser reativada.', confirmLabel: 'Desativar', tone: 'danger' });
        if (ok === null) return;
      }
      await patch(`/users/${form.dataset.id}`, body);
      closeTopLayer();
      ctx.invalidate('users');
      toast('Acesso atualizado.');
      await ctx.refresh();
    }
  }
};
