// Cliente da API do portal. Todas as leituras e escritas passam por aqui.
// O token vem de auth.js (sessão local ou ID token do Firebase).
import { getToken, handleUnauthorized } from './auth.js';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL('/api' + path, location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor do portal. Verifique a internet ou se o servidor local está ligado.');
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) handleUnauthorized(payload.error);
  if (!response.ok) throw new ApiError(response.status, payload.error || `Erro ${response.status}`, payload.details);
  return payload;
}

export const get = (path, query) => api(path, { query });
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const patch = (path, body = {}) => api(path, { method: 'PATCH', body });
export const del = path => api(path, { method: 'DELETE' });
