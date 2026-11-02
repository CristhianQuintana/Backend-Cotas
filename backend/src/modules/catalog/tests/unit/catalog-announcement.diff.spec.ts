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
    expect(result.nextIds).toEqual(['1', '2']);
    expect(result.announcements).toEqual([
      { kind: 'vod', contentId: '2', title: 'Nueva película' },
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
    expect(result.nextIds).toEqual(['1']);
  });
});
