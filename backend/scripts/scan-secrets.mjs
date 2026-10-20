import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const skipDirectories = new Set(['node_modules', 'dist', 'coverage', '.git']);
const allowedDbPasswords = new Set(['local_only_dev_password', 'test_only_password', 'CHANGE_ME_local_only']);
const findings = [];

await walk(root);
if (findings.length > 0) {
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}
console.log('Análisis de secretos: sin hallazgos en el árbol revisado.');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (skipDirectories.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example')) {
      continue;
    }
    const info = await stat(fullPath);
    if (info.size > 1_000_000) {
      continue;
    }
    const text = await readFile(fullPath, 'utf8').catch(() => '');
    review(path.relative(root, fullPath), text);
  }
}

function review(relativePath, text) {
  const internalXuiAddress = ['10', '10', '0', '100'].join('.');
  if (text.includes(internalXuiAddress)) {
    findings.push(`${relativePath}: contiene la IP interna verificada de XUI`);
  }
  if (/BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/.test(text)) {
    findings.push(`${relativePath}: contiene una clave privada`);
  }
  const urls = text.matchAll(/postgres(?:ql)?:\/\/([^:\s]+):([^@\s]+)@/g);
  for (const match of urls) {
    const password = match[2] ?? '';
    if (!allowedDbPasswords.has(password) && !password.includes('CHANGE_ME')) {
      findings.push(`${relativePath}: URL de PostgreSQL con contraseña no permitida en el repositorio`);
    }
  }
}
