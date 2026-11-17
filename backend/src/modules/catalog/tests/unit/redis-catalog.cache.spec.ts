import type { AppConfig } from '../../../../config/app-config';
import { MemoryCatalogCache, RedisCatalogCache } from '../../infrastructure/redis-catalog.cache';

describe('RedisCatalogCache', () => {
  it('opera con cliente Redis inyectado', async () => {
    const kv = new Map<string, string>();
    const redis = {
      get: jest.fn(async (k: string) => kv.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        kv.set(k, v);
        return 'OK';
      }),
      del: jest.fn(async (k: string) => {
        kv.delete(k);
        return 1;
      }),
      ping: jest.fn(async () => 'PONG'),
    };
    const cache = new RedisCatalogCache({ redisEnabled: true } as AppConfig, redis as never);
    await cache.onModuleInit();
    expect(cache.isEnabled()).toBe(true);
    await cache.setJson('k1', { a: 1 }, 60);
    await expect(cache.getJson<{ a: number }>('k1')).resolves.toEqual({ a: 1 });
    await expect(cache.ping()).resolves.toBe(true);
    await cache.del('k1');
    await expect(cache.getJson('k1')).resolves.toBeNull();
    await cache.onModuleDestroy();
  });

  it('degrada si el cliente compartido es null', async () => {
    const cache = new RedisCatalogCache({ redisEnabled: true } as AppConfig, null);
    await cache.onModuleInit();
    expect(cache.isEnabled()).toBe(false);
    await cache.setJson('x', 1, 10);
    await expect(cache.getJson('x')).resolves.toBeNull();
  });
});

describe('MemoryCatalogCache eviction', () => {
  it('purga entradas antiguas al superar el tope', async () => {
    const cache = new MemoryCatalogCache();
    for (let i = 0; i < 85; i += 1) {
      await cache.setJson(`k${i}`, i, 60);
    }
    expect(await cache.ping()).toBe(true);
    expect(cache.isEnabled()).toBe(true);
  });
});
