import { CatalogUseCase } from '../../application/catalog.use-case';
import { catalogCacheKey } from '../../domain/catalog-cache';
import { MemoryCatalogCache } from '../../infrastructure/redis-catalog.cache';
import { FakeXui } from '../../../../../test/fakes/fake-xui';

describe('caché de catálogo', () => {
  it('sirve la segunda lectura desde memoria sin volver a XUI', async () => {
    const xui = new FakeXui();
    xui.liveStreams = [
      { id: '1', name: 'Alfa', categoryId: '1', iconUrl: null, epgChannelId: null },
    ];
    let calls = 0;
    const original = xui.getLiveStreams.bind(xui);
    xui.getLiveStreams = (async () => {
      calls += 1;
      return original();
    }) as typeof xui.getLiveStreams;
    const cache = new MemoryCatalogCache();
    const catalog = new CatalogUseCase(xui, cache, {
      catalogCacheTtlSeconds: 300,
      catalogEpgCacheTtlSeconds: 120,
    } as never);

    await catalog.liveStreams({ page: 1, limit: 20 });
    await catalog.liveStreams({ page: 1, limit: 20 });
    expect(calls).toBe(1);
    expect(await cache.getJson(catalogCacheKey('user:server', 'live-streams'))).toHaveLength(1);
  });

  it('expira entradas de MemoryCatalogCache', async () => {
    const cache = new MemoryCatalogCache();
    await cache.setJson('k', { ok: true }, 1);
    expect(await cache.getJson('k')).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await cache.getJson('k')).toBeNull();
  });
});
