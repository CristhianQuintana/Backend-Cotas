import { DomainError } from '../../../../common/exceptions/domain-error';
import { buildPlaybackReference, playbackLogFields } from '../../domain/playback-reference';

const base = {
  streamId: '1001',
  title: 'Canal Demo',
  server: { protocol: 'http' as const, host: 'stream.test.local', port: '80' },
  allowedHosts: ['stream.test.local'],
  username: 'line',
  password: 'secret-line',
};

describe('buildPlaybackReference', () => {
  it('arma una referencia HLS directa sin aceptar un host fuera de la lista', () => {
    const reference = buildPlaybackReference({ ...base, contentType: 'live' });
    expect(reference.streamUrl).toBe('http://stream.test.local:80/live/line/secret-line/1001.m3u8');
    expect(reference.delivery).toBe('direct');
    expect(reference.expiresAt).toBeNull();
    expect(playbackLogFields(reference)).toEqual({ contentType: 'live', streamId: '1001' });
    expect(JSON.stringify(playbackLogFields(reference))).not.toContain('secret-line');

    expect(() =>
      buildPlaybackReference({
        ...base,
        contentType: 'live',
        server: { ...base.server, host: 'evil.test' },
      }),
    ).toThrow(DomainError);
  });

  it('rechaza VOD sin extensión segura', () => {
    expect(() =>
      buildPlaybackReference({ ...base, contentType: 'vod', containerExtension: 'm3u8/../' }),
    ).toThrow(DomainError);
  });

  it('arma la ruta directa de una película y de un episodio', () => {
    const movie = buildPlaybackReference({
      ...base,
      contentType: 'vod',
      containerExtension: 'mp4',
    });
    expect(movie.streamUrl).toBe('http://stream.test.local:80/movie/line/secret-line/1001.mp4');
    expect(movie.protocolHint).toBe('progressive');
    const episode = buildPlaybackReference({
      ...base,
      contentType: 'series',
      streamId: '50',
      containerExtension: 'mp4',
    });
    expect(episode.streamUrl).toBe('http://stream.test.local:80/series/line/secret-line/50.mp4');
    expect(JSON.stringify(playbackLogFields(episode))).not.toContain('secret-line');
  });
});
