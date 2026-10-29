// Função serverless da Vercel: recebe todas as chamadas /api/* (ver rewrites em vercel.json)
// e repassa para o mesmo roteador usado no servidor local.
import { handleApi } from '../server/router.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // O rewrite envia o caminho original em ?path=; sem ele, usamos a própria URL.
  const forwarded = url.searchParams.get('path');
  url.searchParams.delete('path');
  const pathname = forwarded !== null ? '/api/' + forwarded.replace(/^\/+/, '') : url.pathname;
  return handleApi(req, res, pathname, url.searchParams);
}
