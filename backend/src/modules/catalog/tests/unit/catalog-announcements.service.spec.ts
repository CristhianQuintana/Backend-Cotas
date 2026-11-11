import { CatalogAnnouncementsService } from '../../application/catalog-announcements.service';

describe('CatalogAnnouncementsService', () => {
  it('uses a fixed high watermark and keyset cursor for complete incremental pages', async () => {
    const rows = [
      {
        id: 'a',
        sequence: 10n,
        kind: 'vod',
        contentId: '10',
        title: 'Movie',
        createdAt: new Date(),
        posterUrl: null,
        description: null,
        publishedAt: null,
        seriesId: null,
        seasonNumber: null,
        episodeNumber: null,
        available: true,
      },
      {
        id: 'b',
        sequence: 9n,
        kind: 'episode',
        contentId: '3',
        title: 'Episode',
        createdAt: new Date(),
        posterUrl: null,
        description: null,
        publishedAt: null,
        seriesId: '1',
        seasonNumber: 1,
        episodeNumber: 3,
        available: true,
      },
    ];
    let query: Record<string, unknown> | undefined;
    const prisma = {
      async $queryRaw() {
        return [{ value: 10n }];
      },
      catalogAnnouncement: {
        async findMany(args: Record<string, unknown>) {
          query = args;
          return rows.slice(0, args.take as number);
        },
        async count() {
          return 2;
        },
      },
    };
    const service = new CatalogAnnouncementsService(prisma as never);
    const first = await service.list({ limit: 1 });
    expect(first.items[0]).toMatchObject({ type: 'MOVIE', contentId: '10' });
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    expect(first.syncCursor).toBe(Buffer.from('10').toString('base64url'));

    await service.list({
      limit: 1,
      since: Buffer.from('8').toString('base64url'),
      cursor: first.nextCursor!,
    });
    expect(query?.where).toMatchObject({ sequence: { gt: 8n, lt: 10n, lte: 10n } });
  });

  it('filters only available records and maps episode navigation metadata', async () => {
    let query: Record<string, unknown> | undefined;
    const prisma = {
      async $queryRaw() {
        return [{ value: 5n }];
      },
      catalogAnnouncement: {
        async findMany(args: Record<string, unknown>) {
          query = args;
          return [
            {
              id: 'e',
              sequence: 5n,
              kind: 'episode',
              contentId: '9',
              title: 'S1E9',
              createdAt: new Date('2026-01-01T00:00:00Z'),
              posterUrl: null,
              description: 'Plot',
              publishedAt: null,
              seriesId: '77',
              seasonNumber: 1,
              episodeNumber: 9,
              available: true,
            },
          ];
        },
        async count() {
          return 1;
        },
      },
    };
    const service = new CatalogAnnouncementsService(prisma as never);
    const result = await service.list({ limit: 20, type: 'EPISODE' });
    expect(query?.where).toMatchObject({ kind: 'episode', available: true });
    expect(result.items[0]).toMatchObject({
      type: 'EPISODE',
      seriesId: '77',
      seasonNumber: 1,
      episodeNumber: 9,
      detailPath: '/api/v1/catalog/series/77',
    });
  });
});
