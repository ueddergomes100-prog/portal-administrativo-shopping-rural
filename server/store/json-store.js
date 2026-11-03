// Armazenamento local em arquivo JSON (data/portal-db.json).
// Usado no modo de desenvolvimento e quando o portal roda só na máquina da loja.
// Mesma interface do firestore-store.js — os serviços não sabem qual está ativo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createJsonStore({ dataDir }) {
  const file = path.join(dataDir, 'portal-db.json');
  let db = null;
  let writing = Promise.resolve();

  function load() {
    if (db) return db;
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      db = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Arquivo corrompido: preserva uma cópia antes de recomeçar.
        const backup = file + '.corrompido-' + Date.now();
        fs.copyFileSync(file, backup);
        console.error(`[store] ${file} ilegível; cópia salva em ${backup}`);
      }
      db = { version: 3, collections: {} };
    }
    db.collections ??= {};
    return db;
  }

  function persist() {
    const snapshot = JSON.stringify(db, null, 2);
    writing = writing.then(() => {
      const temp = file + '.tmp';
      fs.writeFileSync(temp, snapshot, 'utf8');
      fs.renameSync(temp, file);
    }).catch(error => console.error('[store] falha ao salvar', error));
    return writing;
  }

  const col = name => (load().collections[name] ??= {});
  const copy = value => (value === undefined ? null : structuredClone(value));

  function matches(doc, where) {
    return where.every(([field, op, value]) => {
      const current = doc[field];
      if (op === '==') return current === value;
      if (op === '!=') return current !== value;
      if (op === 'in') return value.includes(current);
      if (op === 'array-contains') return Array.isArray(current) && current.includes(value);
      if (op === '>=') return current >= value;
      if (op === '<=') return current <= value;
      throw new Error('Operador não suportado: ' + op);
    });
  }

  return {
    kind: 'local',
    async get(collection, id) {
      return copy(col(collection)[id]) || null;
    },
    async list(collection, { where = [], orderBy, direction = 'desc', limit } = {}) {
      let docs = Object.values(col(collection)).filter(doc => matches(doc, where));
      if (orderBy) {
        docs.sort((a, b) => String(a[orderBy] ?? '').localeCompare(String(b[orderBy] ?? '')) * (direction === 'desc' ? -1 : 1));
      }
      if (limit) docs = docs.slice(0, limit);
      return copy(docs);
    },
    async create(collection, data, id = crypto.randomUUID()) {
      const doc = { ...data, id };
      col(collection)[id] = doc;
      await persist();
      return copy(doc);
    },
    async set(collection, id, data) {
      const doc = { ...data, id };
      col(collection)[id] = doc;
      await persist();
      return copy(doc);
    },
    async update(collection, id, patch) {
      const current = col(collection)[id];
      if (!current) return null;
      const doc = { ...current, ...patch, id };
      col(collection)[id] = doc;
      await persist();
      return copy(doc);
    },
    async remove(collection, id) {
      delete col(collection)[id];
      await persist();
    },
    async bulkSet(collection, docs) {
      const target = col(collection);
      for (const doc of docs) target[doc.id] = { ...target[doc.id], ...doc };
      await persist();
      return docs.length;
    },
    async count(collection) {
      return Object.keys(col(collection)).length;
    }
  };
}
