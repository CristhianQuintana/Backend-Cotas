import { DomainError } from '../../../../common/exceptions/domain-error';
import { CatalogUseCase } from '../../application/catalog.use-case';
import { FakeXui } from '../../../../../test/fakes/fake-xui';

describe('CatalogUseCase', () => {
  it('pagina, filtra y no inventa EPG vacío como error', async () => {
    const xui = new FakeXui();
    xui.liveStreams = [
      { id: '2', name: 'Zeta', categoryId: '1', iconUrl: null, epgChannelId: null },
      { id: '1', name: 'Alfa', categoryId: '2', iconUrl: null, epgChannelId: null },
    ];
    xui.epg.set('1', []);
    const catalog = new CatalogUseCase(xui);
    const page = await catalog.liveStreams({ page: 1, limit: 1, categoryId: '2' });
    expect(page.total).toBe(1);
    expect(page.items[0]?.name).toBe('Alfa');
    await expect(catalog.shortEpg('1')).resolves.toMatchObject({
      streamId: '1',
      now: null,
      next: null,
      items: [],
    });
    await expect(catalog.shortEpg('999')).rejects.toBeInstanceOf(DomainError);
    const batch = await catalog.shortEpgBatch(['1', '999']);
    expect(batch.channels).toHaveLength(1);
    expect(batch.channels[0]?.streamId).toBe('1');
  });

  it('no trata un catálogo vacío con línea inválida como éxito', async () => {
    const xui = new FakeXui();
    xui.line = { authenticated: false, status: null };
    const catalog = new CatalogUseCase(xui);
    await expect(catalog.liveCategories({ page: 1, limit: 20 })).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('filtra películas por texto y devuelve una temporada sin episodios', async () => {
    const xui = new FakeXui();
    xui.vodStreams = [
      {
        id: '2',
        name: 'Otra',
        categoryId: '1',
        categoryIds: ['1'],
        iconUrl: null,
        containerExtension: 'mp4',
        rating: null,
        year: '2020',
      },
      {
        id: '1',
        name: 'Alpha',
        categoryId: '1',
        categoryIds: ['1', '2'],
        iconUrl: null,
        containerExtension: 'mp4',
        rating: null,
        year: null,
      },
    ];
    xui.seriesDetails.set('7', {
      id: '7',
      name: 'Serie',
      categoryIds: ['3'],
      posterUrl: null,
      plot: null,
      year: null,
      rating: null,
      genre: null,
      cast: null,
      director: null,
      seasons: [{ number: 2, name: 'Temporada 2', episodeCount: 0, posterUrl: null }],
      episodes: [],
    });
    const catalog = new CatalogUseCase(xui);
    const page = await catalog.vodStreams({ page: 1, limit: 20, search: 'alp', categoryId: '2' });
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe('1');
    await expect(catalog.episodes('7', 2)).resolves.toEqual({
      seriesId: '7',
      seasonNumber: 2,
      items: [],
    });
    await expect(catalog.vodDetails('404')).rejects.toBeInstanceOf(DomainError);
  });
});
