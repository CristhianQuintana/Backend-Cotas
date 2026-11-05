import { CatalogUseCase } from '../../application/catalog.use-case';
import type { XuiClient } from '../../../integrations/xui/domain/models';
import { MemoryCatalogCache } from '../../infrastructure/redis-catalog.cache';

describe('CatalogUseCase.home', () => {
  it('arma heroes y rails livianos desde caché de listados', async () => {
    const xui: Partial<XuiClient> = {
      async getLineStatus() {
        return {
          authenticated: true,
          status: 'Active',
          username: 'u',
          displayName: 'u',
          expiresAt: null,
          maxConnections: 3,
          activeConnections: 0,
          isTrial: false,
        };
      },
      async getLiveStreams() {
        return [
          {
            id: '1',
            name: 'Canal 1',
            categoryId: '10',
            iconUrl: 'http://10.0.0.1/a.png',
            posterUrl: 'http://10.0.0.1/a.png',
            backdropUrl: null,
            epgChannelId: null,
          },
        ];
      },
      async getLiveCategories() {
        return [{ id: '10', name: 'News', parentId: null }];
      },
      async getVodStreams() {
        return [
          {
            id: '100',
            name: 'Film A',
            categoryId: '20',
            categoryIds: ['20'],
            iconUrl: null,
            posterUrl: 'http://10.0.0.1/p.jpg',
            backdropUrl: null,
            containerExtension: 'mp4',
            rating: '8',
            year: '2024',
          },
          {
            id: '101',
            name: 'Film B',
            categoryId: '21',
            categoryIds: ['21'],
            iconUrl: null,
            posterUrl: 'http://10.0.0.1/q.jpg',
            backdropUrl: null,
            containerExtension: 'mp4',
            rating: null,
            year: '2023',
          },
        ];
      },
      async getVodCategories() {
        return [
          { id: '20', name: 'Acción', parentId: null },
          { id: '21', name: 'Drama', parentId: null },
        ];
      },
      async getSeries() {
        return [
          {
            id: '200',
            name: 'Serie A',
            categoryId: '30',
            categoryIds: ['30'],
            posterUrl: 'http://10.0.0.1/s.jpg',
            backdropUrl: null,
            rating: null,
            year: '2022',
          },
        ];
      },
      async getSeriesCategories() {
        return [{ id: '30', name: 'Series', parentId: null }];
      },
    };

    const useCase = new CatalogUseCase(xui as XuiClient, new MemoryCatalogCache(), {
      catalogCacheTtlSeconds: 300,
      catalogEpgCacheTtlSeconds: 120,
      mediaAssetTtlSeconds: 86_400,
    } as never);

    const home = await useCase.home({ username: 'u', password: 'p' });
    expect(home.heroes.length).toBeGreaterThan(0);
    expect(home.rails.some((rail) => rail.id === 'live-featured')).toBe(true);
    expect(home.rails.some((rail) => rail.id === 'vod-featured')).toBe(true);
    expect(home.rails.some((rail) => rail.id.startsWith('genre-'))).toBe(true);
    expect(home.rails[0]?.items[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      section: expect.any(String),
    });

    const again = await useCase.home({ username: 'u', password: 'p' });
    expect(again.generatedAt).toBe(home.generatedAt);
  });
});
