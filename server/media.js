// Arquivos locais (fotos e artes) na pasta media/ desta máquina.
// Nada aqui é enviado ao GitHub nem ao Firebase Storage. O portal guarda só a REFERÊNCIA
// (caminho relativo). Fotos de produtos publicados no site próprio são servidas por
// GET /api/store/images/... (somente as que pertencem a um produto publicado).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { badRequest } from './http.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const ANY_EXT = new Set([...IMAGE_EXT, '.pdf', '.mp4', '.mov', '.psd', '.ai', '.svg', '.zip']);

export function mediaAvailable() {
  return !config.isVercel && fs.existsSync(config.mediaDir);
}

export function resolveMedia(ref) {
  const full = path.resolve(config.mediaDir, ref);
  if (!full.startsWith(config.mediaDir + path.sep)) throw badRequest('Caminho fora da pasta media/.');
  return full;
}

// Lista arquivos para ajudar a escolher a referência (somente no servidor local).
export function listMedia({ search = '', limit = 300 } = {}) {
  if (!mediaAvailable()) return { available: false, files: [] };
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (ANY_EXT.has(path.extname(entry.name).toLowerCase())) {
        const ref = path.relative(config.mediaDir, full).replaceAll('\\', '/');
        if (!search || ref.toLowerCase().includes(search.toLowerCase())) {
          const stat = fs.statSync(full);
          files.push({ ref, size: stat.size, modifiedAt: stat.mtime.toISOString(), image: IMAGE_EXT.has(path.extname(full).toLowerCase()) });
        }
      }
      if (files.length >= limit) return;
    }
  };
  walk(config.mediaDir);
  return { available: true, files: files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) };
}

export function checkMediaRefs(refs) {
  return refs.map(ref => {
    if (/^https:\/\//.test(ref)) return { ref, exists: true, url: ref }; // enviado para a nuvem
    if (!mediaAvailable()) return { ref, exists: null };
    return { ref, exists: fs.existsSync(resolveMedia(ref)) };
  });
}

export const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

// Caminho completo de uma imagem existente em media/ (ou null).
export function imageFile(ref) {
  const full = resolveMedia(ref);
  const type = IMAGE_TYPES[path.extname(full).toLowerCase()];
  if (!type || !fs.existsSync(full)) return null;
  return { full, type };
}
