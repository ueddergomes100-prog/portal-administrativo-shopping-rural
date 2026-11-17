// Telas "ao vivo": quando algo muda no banco, as telas abertas se atualizam sozinhas, sem recarregar.
//
// Como funciona (barato de propósito — ver "custo do Firestore" no AGENTS.md):
// - O store (store/index.js) avisa aqui cada escrita: `markChanged(coleção, id)`.
// - No fim de cada pedido à API que mudou algo — ou logo depois de uma tarefa de fundo (conector do
//   UniPlus no servidor da loja) — o servidor grava UM documento: `settings/live` =
//   { at, changes: { [chave]: quando mudou } }. Um pedido que mexe em 30 produtos grava uma vez só.
// - Na nuvem o navegador escuta esse documento em tempo real (Firestore onSnapshot: 1 leitura por
//   mudança para cada pessoa com o portal aberto). No modo local/demonstração ele pergunta
//   GET /api/live a cada poucos segundos (arquivo local, sem custo).
// - Cada tela diz de quais chaves depende (LIVE em public/js/app.js) e só ela se recarrega.
//
// Leituras (GET) nunca contam como mudança, mesmo que gravem algo por dentro (cache, migração): assim
// uma tela que se recarrega por causa de uma mudança não dispara outra, e não vira um ciclo.
import { AsyncLocalStorage } from 'node:async_hooks';

// Histórico, resultados de mídia e situação das conexões mudam o tempo todo (o conector avisa que está
// vivo a cada envio) e nenhuma tela do dia a dia depende deles: ficam de fora para não gastar leituras.
const IGNORED = new Set(['audit', 'metrics', 'integrations']);

const context = new AsyncLocalStorage();
let writer = null;          // grava settings/live (registrado por store/index.js, sem passar por aqui de novo)
let background = new Set(); // mudanças feitas fora de um pedido à API
let backgroundTimer = null;

export function registerLiveWriter(fn) {
  writer = fn;
}

// Chave que a tela usa: o nome da coleção; em `settings`, o documento (`settings:workflow`). As 16
// fatias da lista de produtos contam como `products`.
export function liveKey(collection, id) {
  if (IGNORED.has(collection)) return null;
  if (collection !== 'settings') return collection;
  const doc = String(id ?? '');
  if (doc === 'live') return null;
  if (doc.startsWith('products-shard')) return 'products';
  return `settings:${doc}`;
}

export function markChanged(collection, id) {
  const key = liveKey(collection, id);
  if (!key) return;
  const current = context.getStore();
  if (current) {
    if (!current.readOnly) current.touched.add(key);
    return;
  }
  background.add(key);
  backgroundTimer ??= setTimeout(() => {
    backgroundTimer = null;
    const keys = background;
    background = new Set();
    publish(keys).catch(error => console.error('[live] falha ao avisar as telas', error));
  }, 300);
  backgroundTimer.unref?.();
}

// Roda um pedido à API anotando o que ele muda. `readOnly`: leituras não avisam ninguém.
export function withLive(fn, { readOnly = false } = {}) {
  return context.run({ touched: new Set(), readOnly }, fn);
}

// Grava o aviso com o que o pedido atual mudou (chamar antes de responder: na Vercel a função
// pode ser congelada logo depois da resposta). Um erro aqui nunca derruba o pedido.
export async function flushLive() {
  const current = context.getStore();
  if (!current?.touched.size) return;
  const keys = current.touched;
  current.touched = new Set();
  try {
    await publish(keys);
  } catch (error) {
    console.error('[live] falha ao avisar as telas', error);
  }
}

async function publish(keys) {
  if (!writer || !keys.size) return;
  const at = new Date().toISOString();
  await writer({ at, changes: Object.fromEntries([...keys].map(key => [key, at])) });
}
