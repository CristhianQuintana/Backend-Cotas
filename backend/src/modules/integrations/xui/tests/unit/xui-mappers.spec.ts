import { DomainError } from '../../../../../common/exceptions/domain-error';
import {
  mapCategories,
  mapLineStatus,
  mapLiveStreams,
  mapSeriesInfo,
  mapServerInfo,
  mapShortEpg,
  mapVodInfo,
  mapVodStreams,
} from '../../infrastructure/mappers/xui-mappers';

describe('mapeadores XUI', () => {
  it('normaliza categorías y streams válidos e ignora campos desconocidos', () => {
    const categories = mapCategories([
      { category_id: '2', category_name: 'Deportes', parent_id: 0, internal_password: 'no' },
      { category_id: '2', category_name: 'Duplicado' },
      { category_name: 'sin id' },
    ]);
    expect(categories).toEqual([{ id: '2', name: 'Deportes', parentId: null }]);

    const streams = mapLiveStreams([
      {
        stream_id: 1001,
        name: 'Canal Demo',
        category_id: '2',
        stream_icon: 'javascript:alert(1)',
        epg_channel_id: 'demo',
        direct_source: 'http://user:pass@hidden',
      },
    ]);
    expect(streams[0]).toEqual({
      id: '1001',
      name: 'Canal Demo',
      categoryId: '2',
      iconUrl: null,
      posterUrl: null,
      backdropUrl: null,
      epgChannelId: 'demo',
    });
    expect(JSON.stringify(streams)).not.toContain('pass');
  });

  it('devuelve lista vacía sin inventar programación y decodifica título base64', () => {
    expect(mapShortEpg({ epg_listings: [] })).toEqual([]);
    const title = Buffer.from('Noticias demo', 'utf8').toString('base64');
    const [item] = mapShortEpg({
      epg_listings: [
        {
          id: '9',
          title,
          description: '',
          start: '2026-10-19 12:00:00',
          end: '2026-10-19 13:00:00',
          start_timestamp: 1_729_335_600,
          stop_timestamp: 1_729_339_200,
        },
      ],
    });
    expect(item?.title).toBe('Noticias demo');
    expect(item?.startAt).toBe('2024-10-19T11:00:00.000Z');
    expect(item?.endAt).toBe('2024-10-19T12:00:00.000Z');
  });

  it('rechaza autenticación fallida y no copia la contraseña de la línea', () => {
    expect(() => mapCategories({ user_info: { auth: 0, password: 'secret-line' } })).toThrow(
      DomainError,
    );
    const status = mapLineStatus({
      user_info: {
        auth: 1,
        status: 'Active',
        username: 'line',
        password: 'secret-line',
        name: 'Cliente Demo',
        exp_date: '2026-12-31 23:59:59',
        max_connections: '3',
        active_cons: 1,
        is_trial: '0',
      },
    });
    expect(status.authenticated).toBe(true);
    expect(status.status).toBe('Active');
    expect(status.username).toBe('line');
    expect(status.displayName).toBe('Cliente Demo');
    expect(status.maxConnections).toBe(3);
    expect(status.activeConnections).toBe(1);
    expect(status.isTrial).toBe(false);
    expect(status.expiresAt).toBe('2026-12-31T23:59:59.000Z');
    expect(JSON.stringify(status)).not.toContain('secret-line');
  });

  it('rechaza un host de reproducción que no está permitido', () => {
    expect(() =>
      mapServerInfo(
        {
          user_info: { auth: 1 },
          server_info: { url: 'evil.test', port: '80', server_protocol: 'http' },
        },
        ['stream.test.local'],
      ),
    ).toThrow(DomainError);
  });

  it('normaliza VOD incompleto sin fabricar extensión', () => {
    expect(
      mapVodStreams([{ stream_id: '5', name: 'Pelicula', container_extension: '../mp4' }]),
    ).toEqual([
      {
        id: '5',
        name: 'Pelicula',
        categoryId: null,
        iconUrl: null,
        posterUrl: null,
        backdropUrl: null,
        containerExtension: null,
        rating: null,
        categoryIds: [],
        year: null,
      },
    ]);
  });

  it('normaliza el detalle de una película y una serie sin copiar el origen directo', () => {
    const movie = mapVodInfo({
      info: {
        name: 'Pelicula',
        plot: 'Sinopsis',
        duration: '01:10:00',
        rating: 8,
        movie_image: 'http://cdn.test/poster.jpg',
        backdrop_path: ['http://cdn.test/backdrop.jpg'],
      },
      movie_data: {
        stream_id: '15',
        name: 'Pelicula',
        container_extension: 'mp4',
        category_id: '3',
        category_ids: [3, '4'],
        direct_source: 'http://user:pass@hidden',
      },
    });
    expect(movie?.id).toBe('15');
    expect(movie?.categoryIds).toEqual(['3', '4']);
    expect(movie?.extension).toBe('mp4');
    expect(movie?.posterUrl).toBe('http://cdn.test/poster.jpg');
    expect(movie?.backdropUrl).toBe('http://cdn.test/backdrop.jpg');
    expect(JSON.stringify(movie)).not.toContain('pass');
    expect(mapVodInfo({ info: {}, movie_data: {} })).toBeNull();

    const sameImage = mapVodInfo({
      info: {
        name: 'Misma',
        movie_image: 'http://cdn.test/only.jpg',
        backdrop_path: ['http://cdn.test/only.jpg'],
      },
      movie_data: { stream_id: '16', name: 'Misma', container_extension: 'mp4' },
    });
    expect(sameImage?.posterUrl).toBe('http://cdn.test/only.jpg');
    expect(sameImage?.backdropUrl).toBeNull();

    const series = mapSeriesInfo(
      {
        info: { name: 'Serie demo', category_id: '2' },
        seasons: [{ season_number: 0, name: 'Especiales', episode_count: 0 }],
        episodes: {
          '2': [{ id: '9', title: 'Final', season: 2, episode_num: 1, container_extension: 'mp4' }],
          '1': [
            { id: '8', title: 'Inicio', season: '1', episode_num: '2', info: { plot: 'Capítulo' } },
          ],
        },
      },
      '4',
    );
    expect(series?.seasons.map((season) => season.number)).toEqual([0, 1, 2]);
    expect(series?.episodes.map((episode) => episode.id)).toEqual(['8', '9']);
    expect(series?.seasons.find((season) => season.number === 0)?.episodeCount).toBe(0);
    expect(mapSeriesInfo({ info: {} }, '4')).toBeNull();

    // Array plano + título vacío + episode_count mentiroso no debe dejar temporadas vacías.
    const flat = mapSeriesInfo(
      {
        info: { name: 'Serie plana', category_id: '2' },
        seasons: [{ season_number: 0, name: 'Especiales', episode_count: 24 }],
        episodes: [
          { id: 101, season: 0, episode_num: 1, container_extension: 'mp4' },
          { stream_id: '102', season_number: 0, episode_number: 2, info: { title: 'Extra' } },
        ],
      },
      '5',
    );
    expect(flat?.episodes).toHaveLength(2);
    expect(flat?.episodes[0]?.name).toBe('Episodio 1');
    expect(flat?.episodes[1]?.name).toBe('Extra');
    expect(flat?.seasons.find((season) => season.number === 0)?.episodeCount).toBe(2);
  });
});
