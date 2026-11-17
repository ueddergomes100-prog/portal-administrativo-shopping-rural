// Escolhe o armazenamento conforme DATA_BACKEND. Os serviços usam apenas esta interface:
// get, list, create, set, update, remove, bulkSet, merge, count.
// Toda escrita avisa server/live.js, para as telas abertas se atualizarem sozinhas.
import { config } from '../config.js';
import { createJsonStore } from './json-store.js';
import { createFirestoreStore } from './firestore-store.js';
import { markChanged, registerLiveWriter } from '../live.js';

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
  let raw;
  if (config.backend === 'firestore') raw = createFirestoreStore(config);
  else if (config.backend === 'demo') raw = createJsonStore(config);
  else if (config.backend === 'local') {
    if (config.isVercel) throw new Error('DATA_BACKEND=local não funciona na Vercel (sistema de arquivos temporário). Use firestore.');
    raw = createJsonStore(config);
  } else throw new Error(`DATA_BACKEND inválido: "${config.backend}". Use local, firestore ou demo.`);
  // O aviso "algo mudou" (settings/live) é gravado direto, sem contar ele mesmo como mudança.
  registerLiveWriter(data => raw.merge(C.settings, 'live', data));
  store = withChangeMarks(raw);
  return store;
}

// Mesmo store, mas cada escrita que deu certo anota a coleção mexida (server/live.js).
function withChangeMarks(raw) {
  return {
    ...raw,
    async create(collection, data, id) {
      const doc = await (id === undefined ? raw.create(collection, data) : raw.create(collection, data, id));
      markChanged(collection, doc?.id ?? id);
      return doc;
    },
    async set(collection, id, data) {
      const doc = await raw.set(collection, id, data);
      markChanged(collection, id);
      return doc;
    },
    async update(collection, id, patch) {
      const doc = await raw.update(collection, id, patch);
      if (doc) markChanged(collection, id);
      return doc;
    },
    async remove(collection, id) {
      await raw.remove(collection, id);
      markChanged(collection, id);
    },
    async bulkSet(collection, docs) {
      const count = await raw.bulkSet(collection, docs);
      for (const doc of docs) markChanged(collection, doc?.id);
      return count;
    },
    async merge(collection, id, data) {
      const doc = await raw.merge(collection, id, data);
      markChanged(collection, id);
      return doc;
    }
  };
}
