import { spawn } from 'node:child_process';
import path from 'node:path';

const fictional = {
  NODE_ENV: 'test',
  PORT: '3000',
  API_PREFIX: 'api/v1',
  DATABASE_URL: 'postgresql://cotas:local_only_dev_password@127.0.0.1:5432/cotas_dev',
  JWT_ACCESS_SECRET: 'openapi-export-jwt-secret-not-a-credential',
  JWT_ISSUER: 'cotas.local',
  JWT_AUDIENCE: 'cotas-api',
  MFA_ENCRYPTION_KEY: 'openapi-export-mfa-key-not-a-credential',
  XUI_BASE_URL: 'http://xui.local',
  XUI_USERNAME: 'openapi_export_user',
  XUI_PASSWORD: 'openapi_export_password',
  XUI_ALLOWED_STREAM_HOSTS: 'xui.local',
  CORS_ORIGINS: 'http://localhost:3000',
  SWAGGER_ENABLED: 'false',
  ARGON2_MEMORY_COST: '4096',
  ARGON2_TIME_COST: '1',
  REDIS_ENABLED: 'false',
};

for (const [name, value] of Object.entries(fictional)) {
  process.env[name] = value;
}

const root = path.resolve(import.meta.dirname, '..');
await run(process.execPath, [path.join(root, 'node_modules/typescript/lib/tsc.js'), '-p', 'tsconfig.build.json']);
await import(pathToFileUrl(path.join(root, 'dist/export-openapi.js')));

function pathToFileUrl(file) {
  const resolved = path.resolve(file).replace(/\\/g, '/');
  return `file:///${resolved}`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`tsc terminó con código ${code ?? 'desconocido'}`));
    });
  });
}
