// Histórico imutável: quem fez, quando, o quê, e os campos que mudaram (antes/depois).
// Só o servidor escreve em `audit` — as regras do Firestore bloqueiam o navegador.
import { getStore, C } from './store/index.js';

const IGNORED = new Set(['updatedAt', 'updatedBy', 'id', 'passwordHash', 'sessionVersion']);

export function diff(before = {}, after = {}) {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    const a = JSON.stringify(before?.[key] ?? null);
    const b = JSON.stringify(after?.[key] ?? null);
    if (a !== b) changes[key] = { before: before?.[key] ?? null, after: after?.[key] ?? null };
  }
  return changes;
}

export async function audit(actor, { action, entity, entityId, summary, before, after }) {
  const changes = before || after ? diff(before, after) : undefined;
  const entry = {
    at: new Date().toISOString(),
    actorId: actor?.id || 'system',
    actorName: actor?.name || 'Sistema',
    actorRole: actor?.role || 'system',
    action,
    entity,
    entityId: entityId ? String(entityId) : '',
    summary: summary || '',
    ...(changes && Object.keys(changes).length ? { changes } : {})
  };
  try {
    await getStore().create(C.audit, entry);
  } catch (error) {
    // Falha no histórico não deve derrubar a operação, mas precisa aparecer no log do servidor.
    console.error('[audit] não foi possível registrar', entry.action, error.message);
  }
  return entry;
}

export async function listAudit({ entity, entityId, limit = 100 } = {}) {
  const where = [];
  if (entity) where.push(['entity', '==', entity]);
  if (entityId) where.push(['entityId', '==', String(entityId)]);
  // Com filtro + orderBy o Firestore exige índice composto (firebase/firestore.indexes.json).
  const items = await getStore().list(C.audit, { where, orderBy: 'at', direction: 'desc', limit: Math.min(limit, 500) });
  return items;
}
