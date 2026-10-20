import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return filesUnder(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('límites de arquitectura', () => {
  it('el dominio no importa Nest, Prisma ni clientes HTTP', () => {
    const roots = [
      join('src', 'modules', 'identity', 'domain'),
      join('src', 'modules', 'integrations', 'xui', 'domain'),
      join('src', 'modules', 'playback', 'domain'),
      join('src', 'modules', 'audit', 'domain'),
    ];
    const offenders = roots.flatMap(filesUnder).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /@nestjs|@prisma|express|node:http|process\.env/u.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
