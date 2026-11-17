// Telas ao vivo: avisa o app quando algo muda no banco, para a tela se atualizar sozinha (detalhes em
// server/live.js). O servidor grava um documento só, `settings/live` = { at, changes: { chave: quando } }.
// - Nuvem: escuta esse documento em tempo real no Firestore (onSnapshot). Chega em ~1 s e custa
//   1 leitura por mudança. As regras já deixam pessoas ativas lerem `settings`.
// - Local/demonstração (ou se a escuta falhar): pergunta GET /api/live de tempos em tempos, só com a
//   tela visível.
import { get } from './api.js';
import { getFirebaseApp, FIREBASE_VERSION } from './auth.js';

const POLL_LOCAL_MS = 3000;   // arquivo local: não custa nada
const POLL_BACKUP_MS = 20000; // reserva na nuvem: cada pergunta é 1 leitura

let started = false;

// `onChange(chaves)` recebe as chaves que mudaram desde a última vez (ex.: ['publicationQueue']).
// `isActive()` diz se ainda há alguém logado (depois de sair, nada é chamado).
export async function startLive(config, { onChange, isActive }) {
  if (started) return;
  started = true;
  let seen = null;
  const handle = live => {
    const changes = live?.changes || {};
    if (!seen) { seen = { ...changes }; return; } // primeira leitura: só guarda como está agora
    const changed = Object.keys(changes).filter(key => changes[key] && changes[key] !== seen[key]);
    seen = { ...seen, ...changes };
    if (changed.length && isActive()) onChange(changed);
  };

  const poll = every => {
    const check = async () => {
      if (!isActive() || document.visibilityState === 'hidden') return;
      try { handle((await get('/live')).live); } catch { /* sem rede: tenta na próxima */ }
    };
    check();
    setInterval(check, every);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  };

  const app = config.backend === 'firestore' ? getFirebaseApp() : null;
  if (!app) return poll(POLL_LOCAL_MS);
  try {
    const { getFirestore, doc, onSnapshot } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
    let fellBack = false;
    onSnapshot(doc(getFirestore(app), 'settings', 'live'), snap => handle(snap.data()), error => {
      console.warn('[ao vivo] escuta do Firestore parou; usando a pergunta periódica.', error?.code || error);
      if (!fellBack) { fellBack = true; poll(POLL_BACKUP_MS); }
    });
  } catch (error) {
    console.warn('[ao vivo] não deu para carregar o Firestore; usando a pergunta periódica.', error);
    poll(POLL_BACKUP_MS);
  }
}
