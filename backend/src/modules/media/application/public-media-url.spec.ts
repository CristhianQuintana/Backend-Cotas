import { toPublicMediaUrl } from './public-media-url';
import { mediaExpiryUnix, signMedia } from './sign-media-url';

describe('toPublicMediaUrl', () => {
  const secret = 'x'.repeat(32);
  const panelLan = '10.0.0.25';
  const streamHost = '203.0.113.50';
  const allowed = [panelLan, streamHost];

  it('firma hosts XUI/LAN hacia /media/asset en el origen API', () => {
    const upstream = `http://${panelLan}/images/poster.jpg`;
    const signed = toPublicMediaUrl({
      raw: upstream,
      publicApiBase: 'https://api.cotasperu.com/api/v1',
      secret,
      allowedHosts: allowed,
    });
    expect(signed).toMatch(/^https:\/\/api\.cotasperu\.com\/api\/v1\/media\/asset\?/);
    const parsed = new URL(signed!);
    expect(parsed.searchParams.get('u')).toBe(upstream);
    const exp = Number(parsed.searchParams.get('exp'));
    const sig = parsed.searchParams.get('sig');
    expect(sig).toBe(signMedia(upstream, exp, secret));
  });

  it('firma IPs LAN privadas aunque no estén en el allowlist de streams', () => {
    const signed = toPublicMediaUrl({
      raw: `http://${panelLan}/images/a.png`,
      publicApiBase: 'https://api.cotasperu.com/api/v1',
      secret,
      allowedHosts: [streamHost],
    });
    expect(signed).toContain('/media/asset?');
  });

  it('reutiliza la misma firma dentro de la ventana de TTL', () => {
    const upstream = `http://${panelLan}/images/stable.jpg`;
    const a = toPublicMediaUrl({
      raw: upstream,
      publicApiBase: 'https://api.cotasperu.com/api/v1',
      secret,
      allowedHosts: allowed,
      ttlSeconds: 86_400,
    });
    const b = toPublicMediaUrl({
      raw: upstream,
      publicApiBase: 'https://api.cotasperu.com/api/v1',
      secret,
      allowedHosts: allowed,
      ttlSeconds: 86_400,
    });
    expect(a).toBe(b);
    expect(mediaExpiryUnix(86_400)).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('no altera CDN externos ni URLs ya proxificadas', () => {
    expect(
      toPublicMediaUrl({
        raw: 'https://image.tmdb.org/t/p/w500/x.jpg',
        publicApiBase: 'https://api.cotasperu.com/api/v1',
        secret,
        allowedHosts: allowed,
      }),
    ).toBe('https://image.tmdb.org/t/p/w500/x.jpg');

    const already = `https://api.cotasperu.com/api/v1/media/asset?u=http%3A%2F%2F${panelLan}%2Fa.jpg&exp=1&sig=abc`;
    expect(
      toPublicMediaUrl({
        raw: already,
        publicApiBase: 'https://api.cotasperu.com/api/v1',
        secret,
        allowedHosts: allowed,
      }),
    ).toBe(already);
  });
});
