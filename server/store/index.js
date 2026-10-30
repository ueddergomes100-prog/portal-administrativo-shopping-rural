// Escolhe o armazenamento conforme DATA_BACKEND. Os serviços usam apenas esta interface:
// get, list, create, set, update, remove, bulkSet, count.
import { config } from '../config.js';
import { createJsonStore } from './json-store.js';
import { createFirestoreStore } from './firestore-store.js';

// Nomes das coleções (iguais no JSON local e no Firestore). Documentados em docs/DADOS.md.
export const C = {
  users: 'users',
  products: 'products',
  queue: 'publicationQueue',
  campaigns: 'campaigns',
  promotions: 'promotions',
  arts: 'artRequests',
  leads: 'leads',
  orders: 'orders',
  integrations: 'integrations',
  metrics: 'metrics',
  settings: 'settings',
  audit: 'audit'
};

let store = null;

export function getStore() {
  if (store) return store;
  if (config.backend === 'firestore') store = createFirestoreStore(config);
  else if (config.backend === 'demo') store = createJsonStore(config);
  else if (config.backend === 'local') {
    if (config.isVercel) throw new Error('DATA_BACKEND=local não funciona na Vercel (sistema de arquivos temporário). Use firestore.');
    store = createJsonStore(config);
  } else throw new Error(`DATA_BACKEND inválido: "${config.backend}". Use local, firestore ou demo.`);
  return store;
}
