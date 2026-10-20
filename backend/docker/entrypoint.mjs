import { spawn } from 'node:child_process';

applyDatabaseUrl();

if (process.env.RUN_MIGRATIONS !== 'false') {
  await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
}

const server = spawn(process.execPath, ['dist/main.js'], { stdio: 'inherit' });
const forward = (signal) => {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill(signal);
  }
};
process.on('SIGTERM', () => forward('SIGTERM'));
process.on('SIGINT', () => forward('SIGINT'));
server.on('exit', (code) => {
  process.exit(code ?? 0);
});

function applyDatabaseUrl() {
  const current = process.env.DATABASE_URL ?? '';
  let hostname = '';
  if (current.startsWith('postgres')) {
    try {
      hostname = new URL(current).hostname;
    } catch {
      hostname = '';
    }
  }
  if (current.length > 0 && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return;
  }
  const user = process.env.POSTGRES_USER || 'cotas';
  const password = process.env.POSTGRES_PASSWORD || 'local_only_dev_password';
  const database = process.env.POSTGRES_DB || 'cotas_dev';
  const host = process.env.POSTGRES_HOST || 'postgres';
  process.env.DATABASE_URL = [
    'postgresql://',
    encodeURIComponent(user),
    ':',
    encodeURIComponent(password),
    '@',
    host,
    ':5432/',
    database,
  ].join('');
  if (password === 'local_only_dev_password') {
    console.error(
      'Aviso: PostgreSQL usa la contraseña local de desarrollo. Defina POSTGRES_PASSWORD antes del primer arranque en el servidor.',
    );
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Migración terminó con código ${code ?? 'desconocido'}`));
    });
  });
}
