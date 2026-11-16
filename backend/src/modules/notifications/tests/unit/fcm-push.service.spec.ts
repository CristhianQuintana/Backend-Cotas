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
});
