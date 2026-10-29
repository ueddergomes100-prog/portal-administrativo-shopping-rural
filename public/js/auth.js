// Sessão do navegador.
// - backend "local": token assinado pelo servidor do portal, guardado em sessionStorage (some ao fechar o navegador).
// - backend "firestore": Firebase Authentication (e-mail/senha) carregado do CDN oficial; o ID token é renovado pelo SDK.
const TOKEN_KEY = 'sr-portal-token';
const FIREBASE_VERSION = '10.12.2';

let mode = 'local';
let firebaseAuth = null;
let firebaseFns = null;
let onSignedOut = () => {};

export async function initAuth(config, { signedOut }) {
  mode = config.backend;
  onSignedOut = signedOut;
  if (mode !== 'firestore') return;
  if (!config.firebase?.apiKey) throw new Error('Configuração pública do Firebase ausente no servidor (FIREBASE_WEB_API_KEY, FIREBASE_WEB_AUTH_DOMAIN, FIREBASE_WEB_APP_ID).');
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, authModule] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`)]);
  const app = initializeApp(config.firebase);
  firebaseAuth = authModule.getAuth(app);
  firebaseFns = authModule;
  await firebaseAuth.authStateReady();
}

export function storedSession() {
  if (mode === 'firestore') return !!firebaseAuth?.currentUser;
  try { return !!sessionStorage.getItem(TOKEN_KEY); } catch { return false; }
}

export async function getToken() {
  if (mode === 'firestore') return firebaseAuth?.currentUser ? firebaseAuth.currentUser.getIdToken() : null;
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export async function signIn(email, password) {
  if (mode === 'firestore') {
    try {
      await firebaseFns.signInWithEmailAndPassword(firebaseAuth, email, password);
    } catch (error) {
      throw new Error(firebaseMessage(error.code));
    }
    return;
  }
  const { post } = await import('./api.js');
  const { token } = await post('/auth/login', { email, password });
  sessionStorage.setItem(TOKEN_KEY, token);
}

export async function setupOwner(data) {
  const { post } = await import('./api.js');
  const { token } = await post('/auth/setup', data);
  sessionStorage.setItem(TOKEN_KEY, token);
}

export async function resetPassword(email) {
  if (mode !== 'firestore') throw new Error('No modo local, peça ao dono para definir uma nova senha em Equipe.');
  await firebaseFns.sendPasswordResetEmail(firebaseAuth, email);
}

export async function signOut() {
  if (mode === 'firestore') await firebaseFns.signOut(firebaseAuth);
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

export function handleUnauthorized(message) {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  onSignedOut(message);
}

export const authMode = () => mode;

function firebaseMessage(code) {
  return {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/user-disabled': 'Seu acesso está desativado. Fale com o dono da loja.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com o Firebase. Verifique a internet.'
  }[code] || 'Não foi possível entrar. Tente novamente.';
}
