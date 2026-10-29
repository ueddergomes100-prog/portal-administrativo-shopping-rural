// Servidor local do portal: serve a interface (public/) e a API (/api/*).
// Uso: `npm start` (ou `node server.js`). Configuração em `.env` — ver `.env.example`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './server/config.js';
import { handleApi } from './server/router.js';
import { getStore } from './server/store/index.js';
import { startUniplusLoop } from './server/integrations/uniplus.js';
import { startMetricsLoop } from './server/services/metrics.js';
import { runMigrations } from './server/migrations.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY'
};

function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, SECURITY_HEADERS);
    return res.end('Método não permitido');
  }
  let file = path.resolve(PUBLIC_DIR, '.' + pathname);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end('Proibido');
  }
  // Rotas da interface (sem extensão) caem no index.html.
  if (!path.extname(file) || !fs.existsSync(file)) {
    if (path.extname(file) && path.extname(file) !== '.html') {
      res.writeHead(404, SECURITY_HEADERS);
      return res.end('Não encontrado');
    }
    file = path.join(PUBLIC_DIR, 'index.html');
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, SECURITY_HEADERS);
      return res.end('Não encontrado');
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end('URL inválida');
  }
  if (pathname.startsWith('/api/')) return void handleApi(req, res, pathname, url.searchParams);
  serveStatic(req, res, pathname);
});

try {
  getStore();
} catch (error) {
  console.error('[config]', error.message);
  process.exit(1);
}

server.listen(config.port, config.host, () => {
  console.log(`Portal Shopping Rural em http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`Dados: ${config.backend === 'local' ? 'arquivo local (data/portal-db.json)' : 'Firestore ' + config.firebase.projectId}`);
  runMigrations(console).catch(error => console.error('[migração]', error.message));
  if (config.uniplus.autoSync) startUniplusLoop(console);
  startMetricsLoop(console);
});
