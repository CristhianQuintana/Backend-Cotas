import { exportPKCS8, generateKeyPair } from 'jose';
import type { AppConfig } from '../../../../config/app-config';
import { FcmPushService } from '../../fcm-push.service';

describe('FcmPushService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('no envía si FCM está deshabilitado', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    const service = new FcmPushService({ fcmEnabled: false } as AppConfig);
    await service.notifyCatalogAnnouncements(['tok'], {
      title: 't',
      body: 'b',
      count: 1,
      kinds: ['vod'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omite envío sin credenciales completas', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    const service = new FcmPushService({
      fcmEnabled: true,
      fcmProjectId: null,
      fcmClientEmail: null,
      fcmPrivateKey: null,
    } as AppConfig);
    await service.notifyDeviceInactive(['tok'], { deviceId: 'd1', deviceName: 'TV' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('obtiene OAuth, envía push y limpia tokens UNREGISTERED', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const pkcs8 = await exportPKCS8(privateKey);
    const lines = { clearPushTokenByValue: jest.fn().mockResolvedValue(1) };
    const service = new FcmPushService(
      {
        fcmEnabled: true,
        fcmProjectId: 'demo',
        fcmClientEmail: 'svc@demo.iam.gserviceaccount.com',
        fcmPrivateKey: pkcs8,
      } as AppConfig,
      lines as never,
    );

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'UNREGISTERED' } }), {
        status: 404,
      });
    }) as never;

    await service.notifyCatalogAnnouncements(['bad-token'], {
      title: 'Nueva película',
      body: 'Demo',
      count: 1,
      kinds: ['vod'],
    });
    expect(lines.clearPushTokenByValue).toHaveBeenCalledWith('bad-token');

    // Segundo envío con token válido reutiliza access token cacheado.
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as never;
    await service.notifyDeviceSessionClosed(['good-token'], {
      deviceId: 'd2',
      deviceName: 'Phone',
    });
    expect(global.fetch).toHaveBeenCalled();
  });
});
