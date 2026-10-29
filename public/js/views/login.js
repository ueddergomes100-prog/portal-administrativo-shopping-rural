// Tela de entrada: login por e-mail/senha e, no primeiro uso do modo local, cadastro do dono.
import { esc, field, notice, formData } from '../ui.js';
import { signIn, setupOwner, resetPassword } from '../auth.js';

export function renderLogin(root, { config, message, onSignedIn }) {
  const setup = config.needsSetup;
  root.innerHTML = `
  <div class="login-wrap">
    <section class="login-brand" aria-hidden="true">
      <div class="brand-lockup big">${brandMark()}<span><strong>Shopping Rural</strong><small>Portal da operação</small></span></div>
      <ol class="login-trail">
        <li><span class="tag tone-neutral"><span class="tag-hole"></span>UniPlus</span><small>catálogo e estoque</small></li>
        <li><span class="tag tone-info"><span class="tag-hole"></span>Preparação</span><small>foto, descrição, SEO</small></li>
        <li><span class="tag tone-warn"><span class="tag-hole"></span>Aprovação</span><small>dono ou gerente</small></li>
        <li><span class="tag tone-done"><span class="tag-hole"></span>Nuvemshop</span><small>publicado no site</small></li>
      </ol>
    </section>
    <section class="login-panel">
      <form class="login-form" data-login novalidate>
        <h1>${setup ? 'Configure o primeiro acesso' : 'Entrar no portal'}</h1>
        <p class="lead">${setup
          ? 'Ainda não há ninguém cadastrado. Crie a conta do dono — depois você convida a equipe em Equipe.'
          : 'Use o e-mail e a senha cadastrados pelo dono da loja.'}</p>
        ${message ? notice(esc(message), 'warn') : ''}
        ${setup ? field('name', 'Seu nome', { required: true, max: 120 }) : ''}
        ${field('email', 'E-mail', { type: 'email', required: true })}
        ${field('password', 'Senha', { type: 'password', required: true, hint: setup ? 'Mínimo de 8 caracteres.' : '' })}
        <div class="form-error" aria-live="polite"></div>
        <button class="btn primary block" type="submit">${setup ? 'Criar conta do dono e entrar' : 'Entrar'}</button>
        ${!setup && config.backend === 'firestore' ? '<button class="btn ghost block" type="button" data-reset>Esqueci minha senha</button>' : ''}
        <p class="login-env">${config.backend === 'local' ? 'Servidor da loja · dados guardados nesta máquina' : 'Nuvem · Firebase ' + esc(config.firebase?.projectId || '')}</p>
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
    if (!data.email || !data.password || (setup && !data.name)) return showError('Preencha todos os campos.');
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
    if (!email) return showError('Digite seu e-mail acima para receber o link de nova senha.');
    try {
      await resetPassword(email);
      form.querySelector('.form-error').innerHTML = notice('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.', 'info');
    } catch (error) {
      showError(error.message);
    }
  });
}

export function brandMark() {
  // Marca: porteira estilizada (três réguas e um travessão) — referência à entrada da fazenda.
  return `<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="currentColor"/><path d="M9 12v17M31 12v17M9 15h22M9 21h22M9 27h22M9 27l22-12" stroke="var(--brinco)" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;
}
