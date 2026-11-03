// Tokens de acesso do Google sem dependências externas.
// - Conta de serviço (GA4): JWT assinado com a chave privada → token OAuth.
// - Refresh token (Google Ads): troca o refresh token por um token de acesso.
// Tokens ficam em memória até 1 minuto antes de expirar.
import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const cache = new Map();

async function postToken(params) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google recusou a autorização: ${data.error_description || data.error || response.status}`);
  return data;
}

function cached(key) {
  const hit = cache.get(key);
  return hit && hit.expiresAt > Date.now() + 60_000 ? hit.token : null;
}

export async function serviceAccountToken(serviceAccountJson, scope) {
  let account;
  try {
    account = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido (cole o arquivo inteiro em uma linha).');
  }
  const key = `sa:${account.client_email}:${scope}`;
  const hit = cached(key);
  if (hit) return hit;
  const now = Math.floor(Date.now() / 1000);
  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
  const data = await postToken({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` });
  cache.set(key, { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

export async function refreshToken({ clientId, clientSecret, refreshToken: token }) {
  const key = `rt:${clientId}`;
  const hit = cached(key);
  if (hit) return hit;
  const data = await postToken({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: token });
  cache.set(key, { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}
