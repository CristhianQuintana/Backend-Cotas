import { rewritePlaylistForProxy } from '../../infrastructure/resolve-stream-upstream';

describe('rewritePlaylistForProxy', () => {
  it('reescribe URIs absolutas y relativas al proxy del ticket', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="http://192.141.98.91/auth/key1"',
      'http://192.141.98.91/auth/seg1.ts',
      'seg2.ts',
      '',
    ].join('\n');
    const out = rewritePlaylistForProxy({
      body,
      playlistUrl: 'http://192.141.98.91/auth/play.m3u8',
      ticketId: 'abc123',
      publicApiBase: 'http://10.10.0.31:3100/api/v1',
    });
    expect(out).toContain(
      'URI="http://10.10.0.31:3100/api/v1/playback/media/abc123/u/auth/key1"',
    );
    expect(out).toContain(
      'http://10.10.0.31:3100/api/v1/playback/media/abc123/u/auth/seg1.ts',
    );
    expect(out).toContain(
      'http://10.10.0.31:3100/api/v1/playback/media/abc123/u/auth/seg2.ts',
    );
  });
});
