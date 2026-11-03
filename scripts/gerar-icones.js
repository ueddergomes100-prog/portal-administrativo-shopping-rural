// Gera os ícones PNG do aplicativo (tela inicial do celular) a partir do desenho da marca (porteira).
// Uso: node scripts/gerar-icones.js  → public/assets/icon-180.png e icon-512.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const GREEN = [0x12, 0x35, 0x28];
const YELLOW = [0xf2, 0xbf, 0x1f];
// Mesmos traços de public/assets/favicon.svg (espaço 40×40).
const SEGMENTS = [[9, 12, 9, 29], [31, 12, 31, 29], [9, 15, 31, 15], [9, 21, 31, 21], [9, 27, 31, 27], [9, 27, 31, 15]];
const HALF_WIDTH = 1.45;

function distance(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function icon(size) {
  // Margem de segurança para ícones "maskable" (o Android recorta em círculo).
  const pad = size * 0.14, scale = (size - 2 * pad) / 40;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5 - pad) / scale, py = (y + 0.5 - pad) / scale;
      const d = Math.min(...SEGMENTS.map(s => distance(px, py, s)));
      const a = Math.max(0, Math.min(1, (HALF_WIDTH - d) * scale + 0.5)); // borda suavizada
      for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = Math.round(GREEN[c] * (1 - a) + YELLOW[c] * a);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [180, 512]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), icon(size));
  console.log(`public/assets/icon-${size}.png`);
}
