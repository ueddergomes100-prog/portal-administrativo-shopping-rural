// Conector UniPlus — roda NA MÁQUINA DA LOJA e mantém o portal na nuvem com estoque e preço em dia.
//
// A cada UNIPLUS_SYNC_SECONDS (sugestão: 30) lê a API local do UniPlus e envia ao portal SÓ os
// produtos que mudaram desde a última leitura. A cada UNIPLUS_FULL_SYNC_HOURS manda a lista completa
// (o portal marca o que sumiu do UniPlus). Sem mudanças, manda um sinal de vida a cada 5 minutos.
//
// Configuração no .env desta máquina:
//   UNIPLUS_API_URL=http://127.0.0.1:3001
//   PORTAL_URL=https://portal.shoppingrural.com
//   CONNECTOR_TOKEN=<mesmo valor configurado no portal>
// (Sem PORTAL_URL, grava direto no armazenamento configurado — usado no modo local/Firestore.)
//
// Uso: `npm run connector` (fica rodando) · `npm run connector -- --once` (uma vez) ·
//      instalar como tarefa do Windows: scripts/instalar-conector.ps1
import { config } from '../server/config.js';
import { fetchUniplusCatalog, syncUniplusOnce, diffCatalog, productKey } from '../server/integrations/uniplus.js';

const once = process.argv.includes('--once');
// No conector em produção, PORTAL_PUBLIC_URL vem da configuração da Vercel.
// PORTAL_URL continua aceito para instalações antigas ou configuração manual.
const portalUrl = (process.env.PORTAL_URL || config.store.portalPublicUrl || '').replace(/\/$/, '');
const HEARTBEAT_MS = 5 * 60_000;

let lastSeen = new Map();
let lastFullAt = 0;
let lastSentAt = 0;
let failures = 0;
// Depois de uma falha, espera cada vez mais antes de tentar de novo (até 15 min): repetir a cada
// 30 s com o portal fora do ar só gasta cota do banco e chamadas da Vercel.
let pausedUntil = 0;
const BATCH = 500;

const stamp = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

async function send(items, mode, ids) {
  const response = await fetch(`${portalUrl}/api/connector/uniplus/catalog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.connectorToken}` },
    body: JSON.stringify(ids ? { items, mode, ids } : { items, mode }),
    signal: AbortSignal.timeout(120_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Portal respondeu ${response.status}`);
  lastSentAt = Date.now();
  return payload;
}

async function pushToPortal() {
  const items = await fetchUniplusCatalog();
  const full = !lastFullAt || Date.now() - lastFullAt > config.uniplus.fullSyncHours * 3600_000;
  const changed = full ? items : diffCatalog(lastSeen, items);
  let result = null;
  if (full) {
    // Conferência completa em lotes de 500 (o portal grava só o que mudou) e, no fim, só os códigos
    // de todos, para o portal marcar o que sumiu do UniPlus.
    for (let i = 0; i < items.length; i += BATCH) await send(items.slice(i, i + BATCH), 'partial');
    result = await send([], 'full', items.map(i => i.id));
    lastFullAt = Date.now();
  } else if (changed.length || Date.now() - lastSentAt > HEARTBEAT_MS) {
    // Lotes de até 500 para não passar do limite de envio.
    for (let i = 0; i < Math.max(changed.length, 1); i += BATCH) result = await send(changed.slice(i, i + BATCH), 'partial');
  }
  // Só considera "visto" depois de enviado com sucesso.
  lastSeen = new Map(items.map(i => [i.id, productKey(i)]));
  return { read: items.length, sent: changed.length, full, result };
}

async function tick() {
  if (Date.now() < pausedUntil) return;
  const started = Date.now();
  try {
    if (portalUrl) {
      const r = await pushToPortal();
      if (r.full || r.sent) console.log(`[conector] ${stamp()} — ${r.full ? 'conferência completa' : 'atualização'}: ${r.sent} de ${r.read} produto(s) enviado(s) (${Date.now() - started} ms)`);
    } else {
      const r = await syncUniplusOnce();
      if (!r.skipped && (r.written || r.missing)) console.log(`[conector] ${stamp()} — ${r.written} alterado(s), ${r.missing} ausente(s)`);
    }
    if (failures) console.log(`[conector] ${stamp()} — voltou a funcionar depois de ${failures} falha(s).`);
    failures = 0;
  } catch (error) {
    failures++;
    // Na falha, a próxima tentativa reenvia tudo o que mudou (lastSeen não foi atualizado).
    const wait = Math.min(15 * 60_000, config.uniplus.syncSeconds * 1000 * 2 ** Math.min(failures - 1, 10));
    pausedUntil = Date.now() + wait;
    console.error(`[conector] ${stamp()} — falha ${failures}: ${error.message} (tenta de novo em ${Math.round(wait / 1000)} s)`);
    if (once) process.exitCode = 1;
  }
}

if (!config.uniplus.apiUrl) {
  console.error('Defina UNIPLUS_API_URL no .env (ex.: http://127.0.0.1:3001).');
  process.exit(1);
}
if (portalUrl && !config.connectorToken) {
  console.error('Defina CONNECTOR_TOKEN no .env (o mesmo valor configurado no portal).');
  process.exit(1);
}
console.log(`[conector] ${stamp()} — UniPlus ${config.uniplus.apiUrl} → ${portalUrl || 'armazenamento ' + config.backend}, a cada ${config.uniplus.syncSeconds}s`);
await tick();
if (!once) setInterval(tick, config.uniplus.syncSeconds * 1000);
