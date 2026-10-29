// Usuários e papéis. Só o dono cria, ativa/desativa e muda papéis.
import { config } from '../config.js';
import { getStore, C } from '../store/index.js';
import { audit } from '../audit.js';
import { getFirebaseAdmin } from '../store/firestore-store.js';
import { publicUser, hashPassword, validatePassword } from '../auth.js';
import { badRequest, forbidden, notFound, conflict, clean } from '../http.js';
import { ROLE_KEYS } from '../../public/shared/domain.js';

const now = () => new Date().toISOString();

// Todos veem um diretório mínimo (para escolher responsáveis). Dono/gerente veem tudo.
export async function listUsers(user) {
  const users = await getStore().list(C.users);
  users.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (['owner', 'manager'].includes(user.role)) return users.map(publicUser);
  return users.filter(u => u.active).map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active }));
}

export async function createUser(actor, input) {
  if (actor.role !== 'owner') throw forbidden('Somente o dono cadastra pessoas.');
  const email = clean.email(input.email, { required: true });
  const name = clean.text(input.name, { required: true, max: 120, label: 'Nome' });
  const role = clean.oneOf(input.role, ROLE_KEYS, { label: 'Papel' });
  const password = String(input.password || '');
  validatePassword(password);
  const store = getStore();
  const existing = await store.list(C.users, { where: [['email', '==', email]], limit: 1 });
  if (existing.length) throw conflict('Já existe uma pessoa com este e-mail.');
  const base = { name, email, role, active: true, canApprove: role === 'manager' ? input.canApprove === true : role === 'owner', createdAt: now(), updatedAt: now() };

  let saved;
  if (config.backend === 'local') {
    saved = await store.create(C.users, { ...base, passwordHash: hashPassword(password), sessionVersion: 1 });
  } else {
    const { auth } = await getFirebaseAdmin(config.firebase);
    let record;
    try {
      record = await auth.createUser({ email, password, displayName: name });
    } catch (error) {
      if (error.code === 'auth/email-already-exists') record = await auth.getUserByEmail(email);
      else throw badRequest('Firebase recusou o cadastro: ' + error.message);
    }
    saved = await store.set(C.users, record.uid, base);
  }
  await audit(actor, { action: 'users.create', entity: 'users', entityId: saved.id, summary: `Cadastrou ${name} como ${role}`, after: base });
  return publicUser(saved);
}

export async function updateUser(actor, id, input) {
  const store = getStore();
  const current = await store.get(C.users, id);
  if (!current) throw notFound('Pessoa não encontrada.');
  const self = actor.id === id;
  if (actor.role !== 'owner' && !self) throw forbidden('Somente o dono altera o cadastro de outras pessoas.');

  const patch = { updatedAt: now() };
  if (input.name !== undefined) patch.name = clean.text(input.name, { required: true, max: 120, label: 'Nome' });
  if (actor.role === 'owner') {
    if (input.role !== undefined) patch.role = clean.oneOf(input.role, ROLE_KEYS, { label: 'Papel' });
    if (input.active !== undefined) patch.active = input.active === true;
    if (input.canApprove !== undefined) patch.canApprove = input.canApprove === true;
    if (self && (patch.active === false || (patch.role && patch.role !== 'owner'))) {
      const owners = (await store.list(C.users, { where: [['role', '==', 'owner']] })).filter(u => u.active);
      if (owners.length <= 1) throw badRequest('Você é o único dono ativo. Cadastre outro dono antes de mudar seu acesso.');
    }
  }
  if (patch.role && patch.role !== 'manager') patch.canApprove = patch.role === 'owner';

  if (input.password) {
    if (!self && actor.role !== 'owner') throw forbidden();
    validatePassword(input.password);
    if (config.backend === 'local') {
      patch.passwordHash = hashPassword(input.password);
      patch.sessionVersion = (current.sessionVersion || 1) + 1; // derruba sessões antigas
    } else {
      const { auth } = await getFirebaseAdmin(config.firebase);
      await auth.updateUser(id, { password: input.password });
    }
  }
  if (config.backend === 'firestore' && (patch.active !== undefined || patch.name)) {
    const { auth } = await getFirebaseAdmin(config.firebase);
    await auth.updateUser(id, { disabled: patch.active === false ? true : patch.active === true ? false : undefined, displayName: patch.name });
  }
  // Desativar também invalida sessões locais.
  if (patch.active === false && config.backend === 'local') patch.sessionVersion = (current.sessionVersion || 1) + 1;

  const saved = await store.update(C.users, id, patch);
  await audit(actor, {
    action: 'users.update', entity: 'users', entityId: id,
    summary: input.password ? `Alterou a senha de ${current.name}` : `Atualizou o acesso de ${current.name}`,
    before: publicUser(current), after: publicUser(saved)
  });
  return publicUser(saved);
}
