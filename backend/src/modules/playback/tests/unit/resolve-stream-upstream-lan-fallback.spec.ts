import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveStreamUpstream } from '../../infrastructure/resolve-stream-upstream';

describe('resolveStreamUpstream LAN fallback', () => {
  it('reusa el path del Location en el host LAN si el IP público no sirve el stream', async () => {
    const lan = http.createServer((req, res) => {
      if (req.url?.startsWith('/live/')) {
        res.writeHead(302, { Location: 'http://192.0.2.9/auth/token-xyz' });
        res.end();
        return;
      }
      if (req.url === '/auth/token-xyz') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => lan.listen(0, '127.0.0.1', resolve));
    const port = (lan.address() as AddressInfo).port;
    const lanHost = `127.0.0.1:${port}`;

    try {
      const resolved = await resolveStreamUpstream(
        'http://192.0.2.9/live/user/pass/1.m3u8',
        lanHost,
        ['127.0.0.1', lanHost, '192.0.2.9'],
      );
      expect(resolved).toBe(`http://127.0.0.1:${port}/auth/token-xyz`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        lan.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
