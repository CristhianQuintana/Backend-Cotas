import { assertAllowedUpstreamUrl, isAllowedUpstreamUrl } from './allowed-upstream-host';

describe('allowed upstream URL', () => {
  it('allows an allowlisted host on standard HTTP ports', () => {
    expect(isAllowedUpstreamUrl('http://xui.test/live/1', ['xui.test'])).toBe(true);
    expect(isAllowedUpstreamUrl('https://xui.test/live/1', ['xui.test'])).toBe(true);
    expect(isAllowedUpstreamUrl('https://xui.test:80/live/1', ['xui.test'])).toBe(false);
  });

  it('requires an explicit host and port for nonstandard ports', () => {
    expect(isAllowedUpstreamUrl('http://xui.test:25461/live/1', ['xui.test'])).toBe(false);
    expect(isAllowedUpstreamUrl('http://xui.test:25461/live/1', ['xui.test:25461'])).toBe(true);
    expect(isAllowedUpstreamUrl('http://xui.test/live/1', ['xui.test:25461'])).toBe(false);
  });

  it('rejects credentials and unsupported protocols', () => {
    expect(isAllowedUpstreamUrl('http://user:pass@xui.test/live/1', ['xui.test'])).toBe(false);
    expect(isAllowedUpstreamUrl('ftp://xui.test/live/1', ['xui.test'])).toBe(false);
    expect(() => assertAllowedUpstreamUrl('http://xui.test:25461/', ['xui.test'])).toThrow(
      'upstream_denied',
    );
  });
});
