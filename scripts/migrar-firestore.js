// Migra os dados operacionais do banco local para o Firestore sem apagar nada.
// Uso seguro (apenas relatório): npm run migrate:firestore
// Para gravar: npm run migrate:firestore -- --apply
// Usuários não entram: eles precisam existir no Firebase Authentication antes.
import { config } from '../server/config.js';
import { createJsonStore } from '../server/store/json-store.js';
import { createFirestoreStore } from '../server/store/firestore-store.js';
import { C } from '../server/store/index.js';

const apply = process.argv.includes('--apply');
const local = createJsonStore({ dataDir: config.dataDir });
const collections = Object.entries(C).filter(([key]) => key !== 'users');

console.log(apply
  ? 'Migração para Firestore iniciada. Nenhum documento local será apagado.'
  : 'Modo de conferência: nenhum dado será enviado. Use --apply para migrar.');

const report = [];
for (const [key, collection] of collections) {
  const documents = await local.list(collection);
  report.push({ key, collection, count: documents.length });
}

for (const item of report) console.log(`- ${item.key}: ${item.count} registro(s)`);
console.log('- users: ignorado (crie as contas no Firebase Authentication antes da migração)');

if (!apply) process.exit(0);

if (!config.firebase.projectId) throw new Error('Defina FIREBASE_PROJECT_ID antes de migrar.');
if (!config.firebase.serviceAccountJson && !config.firebase.serviceAccountFile) {
  throw new Error('Defina FIREBASE_SERVICE_ACCOUNT_JSON ou GOOGLE_APPLICATION_CREDENTIALS antes de migrar.');
}

const firestore = createFirestoreStore({ firebase: config.firebase });
let total = 0;
for (const item of report) {
  const documents = await local.list(item.collection);
  if (!documents.length) continue;
  await firestore.bulkSet(item.collection, documents);
  total += documents.length;
  console.log(`✓ ${item.collection}: ${documents.length} registro(s) enviados`);
}
console.log(`Concluído: ${total} documento(s) enviados ao Firestore.`);
