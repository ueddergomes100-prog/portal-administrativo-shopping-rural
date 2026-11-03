// Autenticação e sessão.
// - Modo local: e-mail/senha guardados com scrypt em `users`; sessão por token assinado (HMAC).
// - Modo firestore: o navegador entra pelo Firebase Authentication (e-mail/senha) e envia o ID token;
//   o servidor valida com o Admin SDK e lê o papel em `users/{uid}`.
// Em ambos os modos o papel vem SEMPRE do banco, nunca do navegador.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getStore, C } from './store/index.js';
import { getFirebaseAdmin } from './store/firestore-store.js';
import { HttpError, unauthorized, forbidden, badRequest, conflict } from './http.js';
import { ROLE_KEYS } from '../public/shared/domain.js';

const now = () => new Date().toISOString();

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, sessionVersion, ...rest } = user;
  return rest;
}

// ---------------------------------------------------------------------------
// Senhas (modo local)
// ---------------------------------------------------------------------------
export function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

export function validatePassword(password) {
  const text = String(password || '');
  if (text.length < 8) throw badRequest('A senha precisa ter pelo menos 8 caracteres.');
  if (text.length > 200) throw badRequest('A senha é longa demais.');
}

// ---------------------------------------------------------------------------
// Token de sessão (modo local)
// ---------------------------------------------------------------------------
let secret = null;
function sessionSecret() {
  if (secret) return secret;
  if (config.sessionSecret) return (secret = config.sessionSecret);
  // Demonstração na Vercel sem SESSION_SECRET: todas as instâncias da mesma publicação precisam do mesmo
  // segredo. A entrada da demo já não tem senha, então derivar da publicação não abre nada a mais.
  if (config.demo && process.env.VERCEL) {
    const seed = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'demo';
    return (secret = crypto.createHash('sha256').update(`portal-demo:${seed}`).digest('hex'));
  }
  // Sem SESSION_SECRET: gera um e guarda em data/ (fora do Git).
  const file = path.join(config.dataDir, '.session-secret');
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return (secret = fs.readFileSync(file, 'utf8').trim());
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyToken(token) {
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

// Limite simples de tentativas de login (por e-mail), em memória.
const attempts = new Map();
function checkRate(key) {
  const entry = attempts.get(key);
  if (entry && entry.until > Date.now() && entry.count >= 6) {
    throw new HttpError(429, 'Muitas tentativas. Aguarde 10 minutos e tente de novo.');
  }
}
function registerFailure(key) {
  const entry = attempts.get(key);
  const fresh = !entry || entry.until < Date.now();
  attempts.set(key, { count: fresh ? 1 : entry.count + 1, until: Date.now() + 10 * 60_000 });
}

export async function loginLocal({ email, password }) {
  if (!config.localAuth) throw badRequest('Neste ambiente o login é feito pelo Firebase.');
  const key = String(email || '').toLowerCase().trim();
  checkRate(key);
  const store = getStore();
  const [user] = await store.list(C.users, { where: [['email', '==', key]], limit: 1 });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    registerFailure(key);
    throw unauthorized('E-mail ou senha incorretos.');
  }
  if (!user.active) throw forbidden('Seu acesso está desativado. Fale com o dono da loja.');
  attempts.delete(key);
  await store.update(C.users, user.id, { lastLoginAt: now() });
  const token = sign({ uid: user.id, v: user.sessionVersion || 1, exp: Date.now() + config.sessionHours * 3600_000 });
  return { token, user: publicUser(user) };
}

// Demonstração: entra como a pessoa de exemplo do papel escolhido (sem senha). Só existe com DATA_BACKEND=demo.
export async function loginDemo({ role }) {
  if (!config.demo) throw forbidden('Entrada sem senha só existe no modo demonstração.');
  if (!ROLE_KEYS.includes(role)) throw badRequest('Papel inválido.');
  const { ensureDemoData } = await import('./demo.js');
  await ensureDemoData();
  const user = await getStore().get(C.users, `demo-${role}`);
  if (!user) throw badRequest('Pessoa de demonstração não encontrada.');
  const token = sign({ uid: user.id, v: user.sessionVersion || 1, exp: Date.now() + config.sessionHours * 3600_000 });
  return { token, user: publicUser(user) };
}

// Primeiro acesso no modo local: cria a conta do dono se ainda não houver usuários.
export async function setupFirstOwner({ name, email, password }) {
  if (!config.localAuth) throw badRequest('No modo Firebase, o primeiro dono é definido por BOOTSTRAP_OWNER_EMAIL.');
  const store = getStore();
  if ((await store.count(C.users)) > 0) throw conflict('O portal já tem usuários. Entre com sua conta.');
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw badRequest('Informe um e-mail válido.');
  const cleanName = String(name || '').trim().slice(0, 120);
  if (!cleanName) throw badRequest('Informe seu nome.');
  const user = await store.create(C.users, {
    name: cleanName, email: cleanEmail, role: 'owner', active: true, canApprove: true,
    passwordHash: hashPassword(password), sessionVersion: 1, createdAt: now(), updatedAt: now()
  });
  return loginLocal({ email: cleanEmail, password });
}

export async function needsSetup() {
  if (!config.localAuth || config.demo) return false;
  return (await getStore().count(C.users)) === 0;
}

// ---------------------------------------------------------------------------
// Identificação da requisição
// ---------------------------------------------------------------------------
export async function authenticate(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();
  const store = getStore();

  if (config.localAuth) {
    const payload = verifyToken(token);
    if (!payload) throw unauthorized('Sua sessão expirou. Entre novamente.');
    if (config.demo) await (await import('./demo.js')).ensureDemoData();
    const user = await store.get(C.users, payload.uid);
    if (!user || (user.sessionVersion || 1) !== payload.v) throw unauthorized('Sua sessão expirou. Entre novamente.');
    if (!user.active) throw forbidden('Seu acesso está desativado. Fale com o dono da loja.');
    return user;
  }

  const { auth } = await getFirebaseAdmin(config.firebase);
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    throw unauthorized('Sua sessão expirou. Entre novamente.');
  }
  let user = await store.get(C.users, decoded.uid);
  if (!user) {
    const email = String(decoded.email || '').toLowerCase();
    const owners = await store.list(C.users, { where: [['role', '==', 'owner']], limit: 1 });
    if (config.bootstrapOwnerEmail && email === config.bootstrapOwnerEmail && owners.length === 0) {
      user = await store.set(C.users, decoded.uid, {
        name: decoded.name || email.split('@')[0], email, role: 'owner', active: true, canApprove: true,
        createdAt: now(), updatedAt: now()
      });
    } else {
      throw forbidden('Sua conta existe, mas o acesso ao portal ainda não foi liberado. Peça ao dono da loja.');
    }
  }
  if (!user.active) throw forbidden('Seu acesso está desativado. Fale com o dono da loja.');
  return user;
}

// Conector local (UniPlus) usa um token próprio, separado das contas de pessoas.
export function authenticateConnector(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const expected = config.connectorToken;
  if (!expected) throw forbidden('CONNECTOR_TOKEN não configurado no servidor.');
  if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    throw unauthorized('Token do conector inválido.');
  }
  return { id: 'connector', name: 'Conector UniPlus', role: 'system' };
}

export function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw forbidden();
}

export { ROLE_KEYS };
