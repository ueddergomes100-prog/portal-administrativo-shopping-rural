// Avisos no celular (push) — lado do aparelho. Detalhes no servidor em server/services/push.js.
// Cada pessoa toca "Ativar avisos" uma vez em cada aparelho. O token do Firebase vai para o servidor
// (POST /api/push/tokens) e fica guardado neste aparelho para poder desligar depois.
// iPhone: só recebe avisos com o portal na tela de início (Compartilhar → Adicionar à Tela de Início).
import { post } from './api.js';
import { getFirebaseApp, FIREBASE_VERSION } from './auth.js';

const TOKEN_KEY = 'sr-avisos-token';
const SEEN_KEY = 'sr-avisos-confirmado';
const LATER_KEY = 'sr-avisos-depois';
const SW_URL = '/push-sw.js';

const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {} };

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// 'server-off' (a loja ainda não ligou os avisos) | 'needs-install' (iPhone fora da tela de início) |
// 'unsupported' | 'denied' (bloqueado no aparelho) | 'off' | 'on'
export function pushState(config) {
  if (!config?.push?.vapidKey || !getFirebaseApp()) return 'server-off';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIos() && !installed() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && read(TOKEN_KEY) ? 'on' : 'off';
}

// "Agora não" no Início: o convite some por 30 dias neste aparelho.
export function askLater() { write(LATER_KEY, String(Date.now())); }
export function shouldInvite(config) {
  const later = Number(read(LATER_KEY) || 0);
  return ['off', 'needs-install'].includes(pushState(config)) && Date.now() - later > 30 * 86400_000;
}

async function messaging() {
  const registration = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  const mod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-messaging.js`);
  return { mod, registration, instance: mod.getMessaging(getFirebaseApp()) };
}

function deviceName() {
  const ua = navigator.userAgent;
  const kind = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : 'Navegador';
  return `${kind}${installed() ? ' (app)' : ''}`;
}

async function register(config) {
  const { mod, registration, instance } = await messaging();
  const token = await mod.getToken(instance, { vapidKey: config.push.vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('O aparelho não liberou os avisos. Tente de novo.');
  await post('/push/tokens', { token, device: deviceName() });
  write(TOKEN_KEY, token);
  write(SEEN_KEY, new Date().toISOString().slice(0, 10));
  return token;
}

// Tocou "Ativar avisos" (precisa ser num toque: o aparelho só pergunta assim).
export async function enablePush(config) {
  const state = pushState(config);
  if (state === 'needs-install') throw new Error('No iPhone, primeiro toque em Compartilhar → Adicionar à Tela de Início e abra o portal por lá.');
  if (state === 'unsupported') throw new Error('Este navegador não recebe avisos. Use o Chrome no Android ou no computador.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Os avisos estão bloqueados neste aparelho. Libere nas configurações do navegador para este site e tente de novo.'
      : 'Os avisos não foram liberados. Toque em "Permitir" quando o aparelho perguntar.');
  }
  return register(config);
}

// Desligar neste aparelho (ou ao sair do portal): o servidor esquece o aparelho.
export async function disablePush() {
  const token = read(TOKEN_KEY);
  write(TOKEN_KEY, null);
  write(SEEN_KEY, null);
  if (!token) return;
  try { await post('/push/forget', { token }); } catch {}
  try {
    const { mod, instance } = await messaging();
    await mod.deleteToken(instance);
  } catch {}
}

// Ao abrir o portal com avisos ligados: uma vez por dia confirma o token (o Firebase pode trocá-lo).
export async function refreshPush(config) {
  if (pushState(config) !== 'on') return;
  if (read(SEEN_KEY) === new Date().toISOString().slice(0, 10)) return;
  try { await register(config); } catch { /* tenta de novo amanhã */ }
}

export async function sendTestPush() {
  return post('/push/test');
}

// Tocou num aviso com o portal já aberto: o service worker pede para trocar de tela sem recarregar.
export function listenForPushClicks(go) {
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'open' && event.data.url) go(new URL(event.data.url).hash);
  });
}
