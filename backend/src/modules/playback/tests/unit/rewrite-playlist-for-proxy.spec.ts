import { rewritePlaylistForProxy } from '../../infrastructure/resolve-stream-upstream';

describe('rewritePlaylistForProxy', () => {
  it('reescribe segmentos relativos y absolutos hacia el proxy', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/1.key"',
      'seg0.ts',
      'https://stream.test.local/live/seg1.ts',
      '',
    ].join('\n');
    const out = rewritePlaylistForProxy({
      body,
      playlistUrl: 'https://stream.test.local/live/index.m3u8',
      ticketId: 'abc',
      publicApiBase: 'https://api.test/api/v1',
    });
    expect(out).toContain('/playback/media/abc/seg?p=');
    expect(out).toContain(encodeURIComponent('/live/seg0.ts'));
    expect(out).toContain(encodeURIComponent('/live/seg1.ts'));
    expect(out).toContain(encodeURIComponent('/live/keys/1.key'));
  });
});
