import { diffNewCatalogItems } from '../../application/catalog-announcement.diff';

describe('diffNewCatalogItems', () => {
  it('anuncia solo IDs nuevos y actualiza el snapshot', () => {
    const result = diffNewCatalogItems(
      'vod',
      [
        { id: '1', name: 'Antigua' },
        { id: '2', name: 'Nueva película' },
      ],
      ['1'],
    );
    expect(result.nextIds).toEqual(['vod::1', 'vod::2']);
    expect(result.announcements).toMatchObject([
      { kind: 'vod', contentId: '2', title: 'Nueva película', dedupeKey: 'vod::2' },
    ]);
  });

  it('sin snapshot previo anuncia todo el catálogo', () => {
    const result = diffNewCatalogItems('series', [{ id: '9', name: 'Serie X' }], []);
    expect(result.announcements).toHaveLength(1);
    expect(result.announcements[0]?.kind).toBe('series');
  });

  it('sin cambios no genera anuncios', () => {
    const result = diffNewCatalogItems('vod', [{ id: '1', name: 'Misma' }], ['1']);
    expect(result.announcements).toEqual([]);
    expect(result.nextIds).toEqual(['vod::1']);
  });

  it('identifica episodios por serie y mantiene sus metadatos', () => {
    const result = diffNewCatalogItems(
      'episode',
      [
        { id: '7', seriesId: '20', name: 'Capítulo 1', description: 'Trama', posterUrl: '/p.jpg' },
        { id: '7', seriesId: '21', name: 'Capítulo 1 otra serie' },
      ],
      [],
    );
    expect(result.announcements).toHaveLength(2);
    expect(result.announcements[0]).toMatchObject({
      kind: 'episode',
      contentId: '7',
      seriesId: '20',
      description: 'Trama',
      posterUrl: '/p.jpg',
    });
    expect(result.nextIds).toEqual(['episode:20:7', 'episode:21:7']);
  });
});
