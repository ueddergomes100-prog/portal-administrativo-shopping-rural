// Arquivos enviados pelo portal (fotos de produto e arquivos de arte).
//
// - Na nuvem (Vercel): Vercel Blob, com URL pública — o site exibe direto. Precisa de BLOB_READ_WRITE_TOKEN.
// - No servidor da loja (modo local): pasta media/uploads/. O site vê as fotos por /api/store/images/...
//
// A referência guardada é a URL (Blob) ou o caminho relativo dentro de media/ (local).
// Referências antigas digitadas à mão (caminhos em media/) continuam funcionando.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { badRequest } from './http.js';

const KINDS = {
  product: { folder: 'produtos', types: ['image/webp', 'image/jpeg', 'image/png'], maxBytes: 3 * 1024 * 1024 },
  art: { folder: 'artes', types: ['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'application/pdf'], maxBytes: 3 * 1024 * 1024 }
};
const EXT = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'application/pdf': '.pdf' };

export const storageDriver = () => (config.storage.driver === 'blob' || (config.storage.driver === 'auto' && config.storage.blobToken) ? 'blob' : 'local');

export const isRemoteRef = ref => /^https:\/\//.test(String(ref || ''));

function safeName(filename) {
  return String(filename || 'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'arquivo';
}

// input: { kind, filename, contentType, data (base64) } -> { ref, url, name, size }
export async function saveUpload(input) {
  const kind = KINDS[input.kind];
  if (!kind) throw badRequest('Tipo de envio inválido.');
  const contentType = String(input.contentType || '');
  if (!kind.types.includes(contentType)) throw badRequest('Formato não aceito. Use JPG, PNG ou WebP' + (input.kind === 'art' ? ', GIF ou PDF.' : '.'));
  const base64 = String(input.data || '').replace(/^data:[^,]+,/, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw badRequest('Arquivo vazio.');
  if (buffer.length > kind.maxBytes) throw badRequest(`Arquivo grande demais (máximo ${Math.round(kind.maxBytes / 1024 / 1024)} MB).`);
  const month = new Date().toISOString().slice(0, 7);
  const name = `${safeName(input.filename)}${EXT[contentType]}`;

  if (storageDriver() === 'blob') {
    let blob;
    try {
      blob = await import('@vercel/blob');
    } catch {
      throw badRequest('Pacote @vercel/blob não instalado. Rode `npm install`.');
    }
    const result = await blob.put(`${kind.folder}/${month}/${name}`, buffer, {
      access: 'public', contentType, addRandomSuffix: true, token: config.storage.blobToken
    });
    return { ref: result.url, url: result.url, name, size: buffer.length };
  }

  if (config.isVercel) throw badRequest('Configure BLOB_READ_WRITE_TOKEN para enviar arquivos na nuvem.');
  const relative = `uploads/${kind.folder}/${month}/${crypto.randomUUID().slice(0, 8)}-${name}`;
  const full = path.join(config.mediaDir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return { ref: relative, url: null, name, size: buffer.length };
}
