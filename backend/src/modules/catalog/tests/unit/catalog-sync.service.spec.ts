import type { AppConfig } from '../../../../config/app-config';
import type { XuiClient } from '../../../integrations/xui/domain/models';
import type { CatalogCache } from '../../domain/catalog-cache';
import { CatalogSyncService } from '../../application/catalog-sync.service';

describe('CatalogSyncService catalog announcements', () => {
  const config = {
    xuiUsername: 'probe',
    xuiPassword: 'secret',
    catalogCacheTtlSeconds: 60,
    catalogSyncConcurrency: 2,
  } as AppConfig;

  function makeXui() {
    return {
      getLineStatus: jest.fn().mockResolvedValue({ authenticated: true }),
      getLiveCategories: jest.fn().mockResolvedValue([]),
      getLiveStreams: jest.fn().mockResolvedValue([]),
      getVodCategories: jest.fn().mockResolvedValue([]),
      getVodStreams: jest.fn().mockResolvedValue([{ id: 'm1', name: 'Movie', posterUrl: '/m' }]),
      getSeriesCategories: jest.fn().mockResolvedValue([]),
      getSeries: jest.fn().mockResolvedValue([{ id: 's1', name: 'Series', posterUrl: '/s' }]),
      getSeriesInfo: jest.fn().mockResolvedValue({
        id: 's1',
        name: 'Series',
        posterUrl: '/s',
        episodes: [
          {
            id: 'e1',
            name: 'Episode',
            plot: 'Plot',
            posterUrl: '/e',
            seasonNumber: 1,
            episodeNumber: 1,
          },
        ],
      }),
    } as unknown as jest.Mocked<XuiClient>;
  }

  it('publishes movie, series and episode snapshots after a complete XUI inventory', async () => {
    const xui = makeXui();
    const announcements = { detectAndPersist: jest.fn().mockResolvedValue(3) };
    const cache = {
      setJson: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CatalogSyncService(
      xui,
      cache as unknown as CatalogCache,
      config,
      announcements as never,
    );
    const result = await service.syncProbeCatalog();
    expect(result.announcements).toBe(3);
    expect(announcements.detectAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        movies: [expect.objectContaining({ id: 'm1', name: 'Movie' })],
        series: [expect.objectContaining({ id: 's1', name: 'Series' })],
        episodes: [
          expect.objectContaining({ id: 'e1', seriesId: 's1', seasonNumber: 1, episodeNumber: 1 }),
        ],
      }),
    );
    expect(xui.getSeriesInfo).toHaveBeenCalledWith('s1', expect.any(Object));
  });

  it('does not persist a partial inventory when an XUI detail request fails', async () => {
    const xui = makeXui();
    xui.getSeriesInfo = jest.fn().mockRejectedValue(new Error('XUI timeout'));
    const announcements = { detectAndPersist: jest.fn() };
    const cache = { setJson: jest.fn(), del: jest.fn() };
    const service = new CatalogSyncService(
      xui,
      cache as unknown as CatalogCache,
      config,
      announcements as never,
    );
    await expect(service.syncProbeCatalog()).rejects.toThrow('XUI timeout');
    expect(announcements.detectAndPersist).not.toHaveBeenCalled();
    expect(cache.setJson).not.toHaveBeenCalled();
  });
});
