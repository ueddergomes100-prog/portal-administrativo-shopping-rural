// Envio de arquivos para o portal (POST /api/uploads).
// Fotos de produto são reduzidas no navegador (WebP, até 1600 px) antes de subir: ficam leves para o
// site e cabem no limite de envio da nuvem. Arquivos de arte vão como estão (até 3 MB).
import { post } from './api.js';

const MAX_SIDE = 1600;

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(blob);
  });
}

async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name}: não é uma imagem que o navegador consiga abrir.`);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
  return blob && blob.size ? blob : file;
}

// kind: 'product' | 'art'. Devolve { ref, url, name, size }.
export async function uploadFile(file, kind) {
  const blob = kind === 'product' ? await shrinkImage(file) : file;
  if (blob.size > 3 * 1024 * 1024) throw new Error(`${file.name}: arquivo maior que 3 MB.`);
  const { file: saved } = await post('/uploads', {
    kind,
    filename: file.name,
    contentType: blob.type || file.type,
    data: await toBase64(blob)
  });
  return saved;
}
