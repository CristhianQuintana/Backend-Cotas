import { toPublicMediaUrl } from './public-media-url';
import { signMedia } from './sign-media-url';

describe('toPublicMediaUrl', () => {
  const secret = 'x'.repeat(32);
  const allowed = ['10.10.0.100', '192.141.98.91'];

  it('firma hosts XUI/LAN hacia /media/asset en el origen API', () => {
    const signed = toPublicMediaUrl({
      raw: 'http://10.10.0.100/images/poster.jpg',
      publicApiBase: 'https://api.cotasperu.com/api/v1',
      secret,
      allowedHosts: allowed,
    });
    expect(signed).toMatch(/^https:\/\/api\.cotasperu\.com\/api\/v1\/media\/asset\?/);
    const parsed = new URL(signed!);
    expect(parsed.searchParams.get('u')).toBe('http://10.10.0.100/images/poster.jpg');
    const exp = Number(parsed.searchParams.get('exp'));
    const sig = parsed.searchParams.get('sig');
    expect(sig).toBe(signMedia('http://10.10.0.100/images/poster.jpg', exp, secret));
  });

  it('firma IPs LAN privadas aunque no estén en el allowlist de streams', () => {
    const signed = toPublicMediaUrl({
      raw: 'http://10.10.0.100/images/a.png',
      publicApiBase: 'https://api.cotasperu.com/api/v1',
      secret,
      allowedHosts: ['192.141.98.91'],
    });
    expect(signed).toContain('/media/asset?');
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

    const already =
      'https://api.cotasperu.com/api/v1/media/asset?u=http%3A%2F%2F10.10.0.100%2Fa.jpg&exp=1&sig=abc';
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
