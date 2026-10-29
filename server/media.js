// Arquivos locais (fotos e artes) na pasta media/ desta máquina.
// Nada aqui é enviado ao GitHub nem ao Firebase Storage. O portal guarda só a REFERÊNCIA
// (caminho relativo). O arquivo é lido apenas quando o servidor local publica na Nuvemshop.
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
  if (!mediaAvailable()) return refs.map(ref => ({ ref, exists: null }));
  return refs.map(ref => ({ ref, exists: fs.existsSync(resolveMedia(ref)) }));
}

export function readImageBase64(ref) {
  const full = resolveMedia(ref);
  if (!IMAGE_EXT.has(path.extname(full).toLowerCase())) throw badRequest(`"${ref}" não é uma imagem aceita pela Nuvemshop.`);
  if (!fs.existsSync(full)) throw badRequest(`Arquivo não encontrado em media/: ${ref}`);
  const size = fs.statSync(full).size;
  if (size > 10 * 1024 * 1024) throw badRequest(`A imagem ${ref} passa de 10 MB.`);
  return { filename: path.basename(full), attachment: fs.readFileSync(full).toString('base64') };
}
