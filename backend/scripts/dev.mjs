import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tsc = path.join(root, 'node_modules/typescript/lib/tsc.js');
await run(process.execPath, [tsc, '-p', 'tsconfig.build.json']);
const watch = spawn(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], {
  cwd: root,
  stdio: 'inherit',
});
const app = spawn(process.execPath, ['--watch', path.join(root, 'dist/main.js')], {
  cwd: root,
  stdio: 'inherit',
});

function stop() {
  watch.kill();
  app.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

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
