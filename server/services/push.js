// Avisos no celular (push) pelo Firebase Cloud Messaging — grátis, chega mesmo com o portal fechado.
//
// - Cada aparelho em que a pessoa tocou "Ativar" fica em `pushTokens/<hash do token>` =
//   { userId, userName, token, device, updatedAt }. Só o servidor lê (regras do Firestore fecham tudo).
// - notify() manda um aviso só para quem precisa agir (por papel, aprovadores ou pessoas) e nunca para
//   quem fez a ação. Aparelho que o Firebase diz não existir mais é apagado.
// - Nada aqui derruba a ação da pessoa: se o aviso falhar, fica só no log.
// - Só funciona na nuvem (DATA_BACKEND=firestore) com FIREBASE_WEB_VAPID_KEY. No modo local/demonstração
//   não há envio (os testes trocam o envio por setPushSender).
import crypto from 'node:crypto';
import { getStore, C } from '../store/index.js';
import { config } from '../config.js';
import { badRequest, clean } from '../http.js';
import { canApprove } from '../../public/shared/domain.js';
import { getFirebaseAdmin } from '../store/firestore-store.js';

const tokenId = token => crypto.createHash('sha256').update(token).digest('hex').slice(0, 40);
// Erros do Firebase que querem dizer "este aparelho não recebe mais": o registro é apagado.
const GONE = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

let sender = null;
export function setPushSender(fn) { sender = fn; }

const enabled = () => !!sender || (config.backend === 'firestore' && !!config.firebase.vapidKey);

// Vai para o navegador em /api/config: sem chave, a tela nem oferece os avisos.
export function pushConfig() {
  return config.backend === 'firestore' && config.firebase.vapidKey ? { vapidKey: config.firebase.vapidKey } : null;
}

export async function savePushToken(user, input) {
  const token = clean.text(input?.token, { required: true, max: 4096, label: 'Aparelho' });
  const device = clean.text(input?.device, { max: 120 });
  await getStore().set(C.pushTokens, tokenId(token), { userId: user.id, userName: user.name, token, device, updatedAt: new Date().toISOString() });
  return { ok: true };
}

// Desligar os avisos neste aparelho (ou sair do portal nele).
export async function removePushToken(user, input) {
  const token = clean.text(input?.token, { max: 4096 });
  if (!token) throw badRequest('Aparelho não informado.');
  await getStore().remove(C.pushTokens, tokenId(token));
  return { ok: true };
}

export async function testPush(user) {
  const { sent } = await notify({ to: { userIds: [user.id] }, title: 'Avisos ligados', body: 'Pronto! Este aparelho vai receber os avisos do portal.', url: '/#/inicio', tag: 'teste' });
  if (!sent) throw badRequest('Nenhum aparelho seu está com os avisos ligados. Toque em "Ativar avisos" neste aparelho.');
  return { sent };
}

// to: { roles?: ['site'], approvers?: true, userIds?: [...] }. exclude: quem fez a ação.
export async function notify({ to = {}, exclude = null, title, body = '', url = '/#/inicio', tag = '' }) {
  if (!enabled()) return { sent: 0 };
  try {
    const store = getStore();
    const users = (await store.list(C.users)).filter(u => u.active !== false && u.id !== exclude);
    const ids = users.filter(u => (to.roles || []).includes(u.role) || (to.approvers && canApprove(u)) || (to.userIds || []).includes(u.id)).map(u => u.id);
    if (!ids.length) return { sent: 0 };
    const devices = [];
    for (let i = 0; i < ids.length; i += 30) devices.push(...await store.list(C.pushTokens, { where: [['userId', 'in', ids.slice(i, i + 30)]] }));
    if (!devices.length) return { sent: 0 };
    const errors = await (sender || sendWithFirebase)(devices.map(d => d.token), { title, body, url, tag });
    const gone = devices.filter((d, i) => GONE.has(errors[i]));
    await Promise.all(gone.map(d => store.remove(C.pushTokens, d.id)));
    return { sent: errors.filter(e => !e).length };
  } catch (error) {
    console.error('[push] aviso não enviado:', title, error);
    return { sent: 0 };
  }
}

// Só "data": quem desenha o aviso é o nosso service worker (public/push-sw.js), igual em todo aparelho.
async function sendWithFirebase(tokens, data) {
  const { app } = await getFirebaseAdmin(config.firebase);
  const { getMessaging } = await import('firebase-admin/messaging');
  const result = await getMessaging(app).sendEachForMulticast({
    tokens,
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')])),
    webpush: { headers: { Urgency: 'high', TTL: '86400' } }
  });
  return result.responses.map(r => (r.success ? null : r.error?.code || 'erro'));
}

// Lista curta de nomes para o texto do aviso: "A, B, C e mais 4".
export function shortList(names, max = 3) {
  const list = names.slice(0, max).join(', ');
  return names.length > max ? `${list} e mais ${names.length - max}` : list;
}
