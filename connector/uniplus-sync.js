// Conector UniPlus para rodar NA MÁQUINA DA LOJA quando o portal está na Vercel.
// Lê a API local do UniPlus e envia o catálogo para o portal.
//
// Dois modos (escolhidos por variáveis no .env desta máquina):
//  1. PORTAL_URL + CONNECTOR_TOKEN  → envia para /api/connector/uniplus/catalog (recomendado).
//  2. DATA_BACKEND=firestore + credencial de serviço → grava direto no Firestore.
//
// Uso: `npm run connector` (fica rodando) ou `npm run connector -- --once`.
import { config } from '../server/config.js';
import { fetchUniplusCatalog, syncUniplusOnce } from '../server/integrations/uniplus.js';

const once = process.argv.includes('--once');
const portalUrl = (process.env.PORTAL_URL || '').replace(/\/$/, '');

async function pushToPortal() {
  const items = await fetchUniplusCatalog();
  const response = await fetch(`${portalUrl}/api/connector/uniplus/catalog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.connectorToken}` },
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(120_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Portal respondeu ${response.status}`);
  return payload;
}

async function tick() {
  const started = Date.now();
  try {
    const result = portalUrl ? await pushToPortal() : await syncUniplusOnce();
    console.log(`[conector] ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — ${result.received} produtos, ${result.missing} ausentes (${Date.now() - started} ms)`);
  } catch (error) {
    console.error('[conector] falha:', error.message);
    if (once) process.exitCode = 1;
  }
}

if (!config.uniplus.apiUrl) {
  console.error('Defina UNIPLUS_API_URL no .env (ex.: http://127.0.0.1:3001).');
  process.exit(1);
}
if (portalUrl && !config.connectorToken) {
  console.error('Defina CONNECTOR_TOKEN no .env (o mesmo valor configurado no servidor do portal).');
  process.exit(1);
}
console.log(`[conector] UniPlus: ${config.uniplus.apiUrl} → ${portalUrl || 'armazenamento ' + config.backend} a cada ${config.uniplus.syncSeconds}s`);
await tick();
if (!once) setInterval(tick, config.uniplus.syncSeconds * 1000);
