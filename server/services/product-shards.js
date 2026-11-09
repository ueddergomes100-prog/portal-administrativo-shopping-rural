// Lista de produtos do UniPlus guardada em poucas "fatias" (documentos em `settings`).
// Motivo: a cota do Firestore cobra uma leitura por documento. Listar ou comparar milhares de
// produtos lendo a coleção `products` inteira esgotava a cota grátis em poucas rodadas. Com as
// fatias, listar tudo ou fazer a conferência completa custa SHARDS leituras.
// A coleção `products` continua sendo gravada (cada produto aberto sozinho usa ela).
import crypto from 'node:crypto';
import { getStore, C } from '../store/index.js';

export const SHARDS = 16;
export const ALL_SHARDS = Array.from({ length: SHARDS }, (_, n) => n);
const docId = n => `products-shard-${n}`;
export const shardOf = id => crypto.createHash('md5').update(String(id)).digest()[0] % SHARDS;

// Guardado como texto (JSON) e não como mapa: mapa com milhares de campos geraria milhares de
// entradas de índice no Firestore por documento.
const decode = doc => (typeof doc?.data === 'string' ? JSON.parse(doc.data) : null);

// Primeira vez (fatias ainda não existem): monta tudo a partir da coleção `products`.
// Custa uma leitura por produto, uma única vez.
let building = null;
async function buildShards() {
  const store = getStore();
  const shards = new Map(ALL_SHARDS.map(n => [n, {}]));
  for (const product of await store.list(C.products)) shards.get(shardOf(product.id))[product.id] = product;
  await writeShards(shards);
  return shards;
}

// Lê as fatias pedidas: Map(número -> { idDoProduto: produto }).
export async function readShards(numbers = ALL_SHARDS) {
  const store = getStore();
  const wanted = [...new Set(numbers)];
  const docs = await Promise.all(wanted.map(n => store.get(C.settings, docId(n))));
  const shards = new Map(wanted.map((n, k) => [n, decode(docs[k])]));
  if ([...shards.values()].every(Boolean)) return shards;
  building ??= buildShards().finally(() => { building = null; });
  const all = await building;
  return new Map(wanted.map(n => [n, all.get(n)]));
}

export async function writeShards(shards) {
  const store = getStore();
  const at = new Date().toISOString();
  await Promise.all([...shards].map(([n, items]) => {
    const data = JSON.stringify(items);
    if (data.length > 900_000) console.warn(`[produtos] fatia ${n} com ${Math.round(data.length / 1024)} KB — perto do limite de 1 MB do Firestore; aumente SHARDS.`);
    return store.set(C.settings, docId(n), { data, count: Object.keys(items).length, updatedAt: at });
  }));
}

export async function allShardProducts() {
  const shards = await readShards(ALL_SHARDS);
  return [...shards.values()].flatMap(items => Object.values(items));
}
