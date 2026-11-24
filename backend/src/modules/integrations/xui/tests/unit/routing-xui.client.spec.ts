import { RoutingXuiClient } from '../../infrastructure/http/routing-xui.client';
import type { XuiClient, XuiCredentials } from '../../domain/models';

function fakeClient(name: string): XuiClient & { calls: string[] } {
  const calls: string[] = [];
  const mark =
    (method: string) =>
    async (..._args: unknown[]) => {
      calls.push(`${name}:${method}`);
      return [] as never;
    };
  return {
    calls,
    authenticate: async (c: XuiCredentials) => {
      calls.push(`${name}:authenticate:${c.username}`);
      return {
        authenticated: true,
        status: 'Active',
        username: c.username,
        displayName: c.username,
        expiresAt: null,
        maxConnections: 1,
        activeConnections: 0,
        isTrial: false,
      };
    },
    getLineStatus: mark('getLineStatus'),
    getLiveCategories: mark('getLiveCategories'),
    getLiveStreams: mark('getLiveStreams'),
    getVodCategories: mark('getVodCategories'),
    getVodStreams: mark('getVodStreams'),
    getVodInfo: mark('getVodInfo'),
    getSeriesCategories: mark('getSeriesCategories'),
    getSeries: mark('getSeries'),
    getSeriesInfo: mark('getSeriesInfo'),
    getShortEpg: mark('getShortEpg'),
    getServerInfo: mark('getServerInfo'),
  };
}

describe('RoutingXuiClient', () => {
  it('usa el XUI demo solo cuando el username de la línea es el demo', async () => {
    const primary = fakeClient('primary');
    const demo = fakeClient('demo');
    const router = new RoutingXuiClient(primary, demo, 'demo123');

    await router.authenticate({ username: 'demo123', password: 'demo123' });
    await router.getLiveCategories({ username: 'demo123', password: 'demo123' });
    await router.getLiveCategories({ username: 'viewer.real', password: 'x' });
    await router.getLiveCategories();

    expect(demo.calls).toEqual(['demo:authenticate:demo123', 'demo:getLiveCategories']);
    expect(primary.calls).toEqual(['primary:getLiveCategories', 'primary:getLiveCategories']);
  });

  it('sin cliente demo, todo va al primario', async () => {
    const primary = fakeClient('primary');
    const router = new RoutingXuiClient(primary, null, 'demo123');
    await router.authenticate({ username: 'demo123', password: 'x' });
    expect(primary.calls).toEqual(['primary:authenticate:demo123']);
  });
});
