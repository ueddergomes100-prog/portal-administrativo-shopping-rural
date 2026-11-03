// Tela de entrada: login por e-mail/senha e, no primeiro uso do modo local, cadastro do dono.
import { esc, field, notice, formData } from '../ui.js';
import { signIn, setupOwner, resetPassword, signInDemo } from '../auth.js';
import { ROLES } from '../../shared/domain.js';

// Demonstração: escolher o papel e entrar, sem senha (dados fictícios).
function renderDemoLogin(root, { message, onSignedIn }) {
  const people = [['owner', 'Carlos Mendes'], ['manager', 'Juliana Prado'], ['marketing', 'Marina Alves'], ['site', 'Rafael Souza']];
  root.innerHTML = `
  <div class="login-wrap is-demo">
    <section class="login-brand" aria-hidden="true">
      <div class="brand-lockup big">${brandMark()}<span><strong>Shopping Rural</strong><small>Portal da loja</small></span></div>
    </section>
    <section class="login-panel">
      <div class="login-form">
        <span class="demo-pill">Demonstração</span>
        <h1>Escolha como entrar</h1>
        <p class="lead">Cada pessoa vê o portal do jeito da sua função. Os dados são de exemplo.</p>
        ${message ? notice(esc(message), 'warn') : ''}
        <ul class="role-pick">${people.map(([role, name]) => `
          <li><button type="button" class="role-btn" data-role="${role}">
            <span class="avatar" aria-hidden="true">${esc(name.split(' ').map(p => p[0]).join(''))}</span>
            <span><strong>${esc(ROLES[role].label)}</strong><small>${esc(name)} · ${esc(ROLES[role].description)}</small></span>
          </button></li>`).join('')}
        </ul>
        <div class="form-error" aria-live="polite"></div>
      </div>
    </section>
  </div>`;
  root.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', async () => {
    root.querySelectorAll('[data-role]').forEach(b => { b.disabled = true; });
    btn.setAttribute('aria-busy', 'true');
    try {
      await signInDemo(btn.dataset.role);
      await onSignedIn();
    } catch (error) {
      root.querySelector('.form-error').innerHTML = notice(esc(error.message), 'danger');
      root.querySelectorAll('[data-role]').forEach(b => { b.disabled = false; });
    }
  }));
}

export function renderLogin(root, { config, message, onSignedIn }) {
  if (config.demo) return renderDemoLogin(root, { message, onSignedIn });
  const setup = config.needsSetup;
  root.innerHTML = `
  <div class="login-wrap">
    <section class="login-brand" aria-hidden="true">
      <div class="brand-lockup big">${brandMark()}<span><strong>Shopping Rural</strong><small>Portal da loja</small></span></div>
      <ol class="login-trail">
        <li><span class="tag tone-neutral"><span class="tag-hole"></span>Sistema da loja</span><small>produtos e estoque</small></li>
        <li><span class="tag tone-info"><span class="tag-hole"></span>Preparar</span><small>fotos e texto</small></li>
        <li><span class="tag tone-warn"><span class="tag-hole"></span>Aprovar</span><small>dono ou gerente</small></li>
        <li><span class="tag tone-done"><span class="tag-hole"></span>À venda</span><small>site, Shopee, Mercado Livre</small></li>
      </ol>
    </section>
    <section class="login-panel">
      <form class="login-form" data-login novalidate>
        <h1>${setup ? 'Primeiro acesso' : 'Entrar no portal'}</h1>
        <p class="lead">${setup
          ? 'Ainda não tem ninguém cadastrado. Crie a conta do dono. Depois você cadastra a equipe em Equipe.'
          : 'Use o e-mail e a senha que o dono da loja cadastrou para você.'}</p>
        ${message ? notice(esc(message), 'warn') : ''}
        ${setup ? field('name', 'Seu nome', { required: true, max: 120 }) : ''}
        ${field('email', 'E-mail', { type: 'email', required: true })}
        ${field('password', 'Senha', { type: 'password', required: true, hint: setup ? 'Pelo menos 8 caracteres.' : '' })}
        <div class="form-error" aria-live="polite"></div>
        <button class="btn primary block" type="submit">${setup ? 'Criar conta do dono e entrar' : 'Entrar'}</button>
        ${!setup && config.backend === 'firestore' ? '<button class="btn ghost block" type="button" data-reset>Esqueci minha senha</button>' : ''}
        <p class="login-env">${config.backend === 'local' ? 'Portal no computador da loja' : 'Portal na internet'}</p>
      </form>
    </section>
  </div>`;

  const form = root.querySelector('form');
  const pwd = form.querySelector('input[type=password]');
  pwd.setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
  form.querySelector('input[type=email]').setAttribute('autocomplete', 'username');
  (form.querySelector('input[name=name]') || form.querySelector('input[type=email]')).focus();

  const showError = text => {
    form.querySelector('.form-error').innerHTML = text ? notice(esc(text), 'danger') : '';
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = formData(form);
    if (!data.email || !data.password || (setup && !data.name)) return showError(setup ? 'Preencha seu nome, o e-mail e a senha.' : 'Preencha o e-mail e a senha.');
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    showError('');
    try {
      if (setup) await setupOwner(data);
      else await signIn(data.email, data.password);
      config.needsSetup = false;
      await onSignedIn();
    } catch (error) {
      showError(error.message);
    } finally {
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });

  form.querySelector('[data-reset]')?.addEventListener('click', async () => {
    const email = form.elements.email.value.trim();
    if (!email) return showError('Digite seu e-mail no campo acima para receber o link de senha nova.');
    try {
      await resetPassword(email);
      form.querySelector('.form-error').innerHTML = notice('Se o e-mail estiver cadastrado, você vai receber um link para criar uma senha nova. Olhe também a caixa de spam.', 'info');
    } catch (error) {
      showError(error.message);
    }
  });
}

export function brandMark() {
  // Marca: porteira estilizada (três réguas e um travessão) — referência à entrada da fazenda.
  return `<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="currentColor"/><path d="M9 12v17M31 12v17M9 15h22M9 21h22M9 27h22M9 27l22-12" stroke="var(--brinco)" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;
}
