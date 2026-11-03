// Verificação rápida antes de commit/deploy: sintaxe de todos os .js e importação do roteador.
// Uso: npm run check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['server', 'public/js', 'public/shared', 'api', 'connector', 'scripts', 'tests'];
const files = ['server.js'];
const walk = dir => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(path.relative(root, full));
  }
};
dirs.forEach(d => walk(path.join(root, d)));

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    failed++;
    console.error(`✗ ${file}\n${error.stderr?.toString() || error.message}`);
  }
}

try {
  await import('../server/router.js');
} catch (error) {
  failed++;
  console.error('✗ Falha ao carregar server/router.js:', error.message);
}

if (failed) {
  console.error(`\n${failed} problema(s) encontrado(s).`);
  process.exit(1);
}
console.log(`✓ ${files.length} arquivos verificados, roteador carregado.`);
