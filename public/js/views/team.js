// Equipe: o dono cadastra pessoas, define papel, autoriza gerente a aprovar e ativa/desativa acesso.
// Também é aqui que o dono liga "Cada um faz a sua parte" (settings/workflow): com a caixinha marcada,
// ele escolhe e aprova, e só a pessoa de Vendas na internet cadastra e coloca à venda.
import { get, post, patch, api } from '../api.js';
import { esc, icon, relative, pageHead, button, field, openModal, closeTopLayer, toast, confirmDialog, tag, initials } from '../ui.js';
import { ROLES, ROLE_KEYS } from '../../shared/domain.js';

function workflowPanel(owner, split, hasSiteTeam) {
  const how = `<p class="hint"><strong>Marcada:</strong> o dono escolhe os produtos (um por um ou vários de uma vez) e manda preparar;
    a pessoa de Vendas na internet cadastra fotos e texto e manda para aprovação; o dono (ou o gerente que pode aprovar) aprova;
    ela coloca à venda.<br><strong>Desmarcada:</strong> o dono e o gerente fazem tudo sozinhos — escolhem, cadastram, aprovam e
    colocam à venda. Bom quando só uma pessoa usa o portal.</p>`;
  return `<section class="panel" aria-labelledby="workflowTitle">
    <div class="panel-head"><h2 id="workflowTitle">Como a equipe divide o trabalho dos anúncios</h2></div>
    ${owner
      ? `<label class="check"><input type="checkbox" data-change="workflow"${split ? ' checked' : ''}><span><strong>Cada um faz a sua parte</strong></span></label>`
      : `<p><strong>${split ? 'Cada um faz a sua parte' : 'O dono e o gerente fazem tudo'}</strong> <span class="muted">(só o dono muda)</span></p>`}
    ${how}
    ${owner && !split && !hasSiteTeam ? '<p class="hint">Para marcar, cadastre antes uma pessoa na função <strong>Vendas na internet</strong>.</p>' : ''}
  </section>`;
}

export default {
  id: 'equipe',
  title: 'Equipe',
  icon: 'shield',
  roles: ['owner', 'manager'],

  async load() {
    const [people, { workflow }] = await Promise.all([get('/users'), get('/settings/workflow')]);
    return { ...people, workflow };
  },

  render({ user, data }) {
    const owner = user.role === 'owner';
    const hasSiteTeam = data.users.some(u => u.role === 'site' && u.active);
    return `${pageHead({
      title: 'Equipe',
      lead: owner ? 'Cadastre quem usa o portal e escolha a função de cada pessoa. Se tirar o acesso, a pessoa sai na hora.' : 'Quem usa o portal. Só o dono muda a função e o acesso das pessoas.',
      actions: owner ? button('Cadastrar pessoa', { action: 'new', icon: 'plus', variant: 'primary' }) : ''
    })}
    ${workflowPanel(owner, data.workflow?.split === true, hasSiteTeam)}
    <div class="role-guide">${ROLE_KEYS.map(r => `<div><strong>${esc(ROLES[r].label)}</strong><p>${esc(ROLES[r].description)}</p></div>`).join('')}</div>
    <section class="panel flush"><div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Pessoa</th><th scope="col">Função</th><th scope="col">Aprova</th><th scope="col">Acesso</th><th scope="col">Último acesso</th>${owner ? '<th scope="col"><span class="sr-only">Ações</span></th>' : ''}</tr></thead>
      <tbody>${data.users.map(u => `<tr${u.active ? '' : ' class="is-muted"'}>
        <td><span class="person"><span class="avatar small" aria-hidden="true">${esc(initials(u.name))}</span><span><strong>${esc(u.name)}</strong><span class="sub">${esc(u.email || '')}</span></span></span></td>
        <td>${esc(ROLES[u.role]?.label || u.role)}</td>
        <td>${u.role === 'owner' || (u.role === 'manager' && u.canApprove) ? tag('Sim', 'ok') : '<span class="muted">Não</span>'}</td>
        <td>${u.active ? tag('Liberado', 'ok') : tag('Sem acesso', 'muted')}</td>
        <td class="nowrap">${esc(relative(u.lastLoginAt))}</td>
        ${owner ? `<td class="row-actions">${button('Editar', { action: 'edit', icon: 'edit', variant: 'ghost small', data: { id: u.id } })}</td>` : ''}
      </tr>`).join('')}</tbody></table></div></section>`;
  },

  changes: {
    // Caixinha "Cada um faz a sua parte": confirma com as mesmas palavras e grava no servidor.
    async workflow(ctx, el) {
      const split = el.checked;
      const ok = await confirmDialog({
        title: split ? 'Marcar “Cada um faz a sua parte”?' : 'Desmarcar “Cada um faz a sua parte”?',
        text: split
          ? 'Você (e o gerente que pode aprovar) passam a escolher os produtos e aprovar. Quem cadastra fotos e texto e coloca à venda passa a ser só a pessoa de Vendas na internet.'
          : 'Você e o gerente voltam a poder fazer tudo: escolher, cadastrar, aprovar e colocar à venda.',
        confirmLabel: split ? 'Marcar' : 'Desmarcar'
      });
      if (ok === null) { el.checked = !split; return; }
      try {
        const { workflow } = await api('/settings/workflow', { method: 'PUT', body: { split } });
        ctx.setWorkflow(workflow);
        toast(workflow.split ? 'Pronto: cada um faz a sua parte.' : 'Pronto: o dono e o gerente fazem tudo.');
      } catch (error) {
        el.checked = !split;
        toast(error.message, 'danger');
        return;
      }
      await ctx.refresh();
    }
  },

  actions: {
    new() {
      openModal({
        title: 'Cadastrar pessoa',
        body: `<form data-form="create" id="userForm" class="form-grid">
          ${field('name', 'Nome', { required: true, full: true, max: 120 })}
          ${field('email', 'E-mail para entrar', { type: 'email', required: true, full: true })}
          ${field('role', 'Função', { type: 'select', options: ROLE_KEYS.map(r => [r, ROLES[r].label]), value: 'marketing' })}
          ${field('password', 'Senha do primeiro acesso', { type: 'password', required: true, hint: 'Pelo menos 8 caracteres. Passe a senha pessoalmente e peça para a pessoa trocar em Minha conta.' })}
          <label class="check full"><input type="checkbox" name="canApprove" value="true"><span>Gerente pode aprovar anúncios, artes, campanhas e promoções</span></label>
          <div class="form-error full"></div>
        </form>`,
        footer: `<button type="button" class="btn ghost" data-action="close-layer">Cancelar</button><button type="submit" class="btn primary" form="userForm">${icon('check')}<span>Cadastrar</span></button>`
      });
    },
    edit(ctx, el) {
      const u = ctx.data.users.find(x => x.id === el.dataset.id);
      const self = u.id === ctx.user.id;
      openModal({
        title: `Editar · ${u.name}`,
        body: `<form data-form="update" id="userEdit" class="form-grid" data-id="${esc(u.id)}">
          ${field('name', 'Nome', { required: true, full: true, max: 120, value: u.name })}
          ${field('role', 'Função', { type: 'select', options: ROLE_KEYS.map(r => [r, ROLES[r].label]), value: u.role })}
          ${field('active', 'Acesso', { type: 'select', options: [['true', 'Liberado'], ['false', 'Sem acesso']], value: String(u.active) })}
          <label class="check full"><input type="checkbox" name="canApprove" value="true"${u.canApprove ? ' checked' : ''}><span>Pode aprovar (só vale para Gerente)</span></label>
          ${field('password', 'Nova senha (opcional)', { type: 'password', full: true, hint: 'Só preencha se quiser trocar a senha. A pessoa vai precisar entrar de novo.' })}
          ${self ? '<p class="full hint">Você está mudando o seu próprio acesso. A loja precisa ter sempre pelo menos um dono com acesso.</p>' : ''}
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
      toast('Pessoa cadastrada. Ela já pode entrar com o e-mail e a senha que você criou.');
      await ctx.refresh();
    },
    async update(ctx, data, form) {
      const body = { name: data.name, role: data.role, active: data.active === 'true', canApprove: [].concat(data.canApprove || []).includes('true') };
      if (data.password) body.password = data.password;
      if (!body.active) {
        const ok = await confirmDialog({ title: 'Tirar o acesso?', text: 'A pessoa sai do portal na hora e só volta a entrar quando o acesso for liberado de novo.', confirmLabel: 'Tirar acesso', tone: 'danger' });
        if (ok === null) return;
      }
      await patch(`/users/${form.dataset.id}`, body);
      closeTopLayer();
      ctx.invalidate('users');
      toast('Cadastro salvo.');
      await ctx.refresh();
    }
  }
};
