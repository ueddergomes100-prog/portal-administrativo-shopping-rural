// Armazenamento no Cloud Firestore via Firebase Admin SDK (somente servidor).
// As credenciais da conta de serviço NUNCA vão para o navegador nem para o Git:
// use FIREBASE_SERVICE_ACCOUNT_JSON (Vercel) ou GOOGLE_APPLICATION_CREDENTIALS (máquina local).
import fs from 'node:fs';
import crypto from 'node:crypto';

let adminPromise = null;

export async function getFirebaseAdmin(firebaseConfig) {
  adminPromise ??= (async () => {
    let appModule, firestoreModule, authModule;
    try {
      appModule = await import('firebase-admin/app');
      firestoreModule = await import('firebase-admin/firestore');
      authModule = await import('firebase-admin/auth');
    } catch {
      throw new Error('Pacote firebase-admin não instalado. Rode `npm install` para usar DATA_BACKEND=firestore.');
    }
    const { initializeApp, cert, applicationDefault, getApps } = appModule;
    let credential;
    if (firebaseConfig.serviceAccountJson) {
      credential = cert(JSON.parse(firebaseConfig.serviceAccountJson));
    } else if (firebaseConfig.serviceAccountFile && fs.existsSync(firebaseConfig.serviceAccountFile)) {
      credential = cert(JSON.parse(fs.readFileSync(firebaseConfig.serviceAccountFile, 'utf8')));
    } else {
      credential = applicationDefault();
    }
    const app = getApps()[0] || initializeApp({ credential, projectId: firebaseConfig.projectId });
    const db = firestoreModule.getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
    return { app, db, auth: authModule.getAuth(app) };
  })();
  return adminPromise;
}

export function createFirestoreStore({ firebase }) {
  const ready = () => getFirebaseAdmin(firebase).then(admin => admin.db);
  const toDoc = snap => (snap.exists ? { ...snap.data(), id: snap.id } : null);

  return {
    kind: 'firestore',
    async get(collection, id) {
      const db = await ready();
      return toDoc(await db.collection(collection).doc(String(id)).get());
    },
    async list(collection, { where = [], orderBy, direction = 'desc', limit } = {}) {
      const db = await ready();
      let query = db.collection(collection);
      for (const [field, op, value] of where) query = query.where(field, op, value);
      if (orderBy) query = query.orderBy(orderBy, direction);
      if (limit) query = query.limit(limit);
      const snap = await query.get();
      return snap.docs.map(toDoc);
    },
    async create(collection, data, id = crypto.randomUUID()) {
      const db = await ready();
      const doc = { ...data, id };
      await db.collection(collection).doc(id).create(doc);
      return doc;
    },
    async set(collection, id, data) {
      const db = await ready();
      const doc = { ...data, id: String(id) };
      await db.collection(collection).doc(String(id)).set(doc);
      return doc;
    },
    async update(collection, id, patch) {
      const db = await ready();
      const ref = db.collection(collection).doc(String(id));
      try {
        await ref.update({ ...patch, id: String(id) });
      } catch (error) {
        if (error.code === 5) return null; // NOT_FOUND
        throw error;
      }
      return toDoc(await ref.get());
    },
    async remove(collection, id) {
      const db = await ready();
      await db.collection(collection).doc(String(id)).delete();
    },
    async bulkSet(collection, docs) {
      const db = await ready();
      // Firestore aceita até 500 operações por lote.
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        for (const doc of docs.slice(i, i + 400)) batch.set(db.collection(collection).doc(String(doc.id)), doc, { merge: true });
        await batch.commit();
      }
      return docs.length;
    },
    async count(collection) {
      const db = await ready();
      const snap = await db.collection(collection).count().get();
      return snap.data().count;
    }
  };
}
