import type { CatalogAnnouncementDraft } from '../../../catalog/application/catalog-announcement.diff';
import type { LineAccess } from '../../../identity/domain/ports/identity.ports';
import { CatalogPushNotifier } from '../../catalog-push.notifier';
import type { FcmPushService } from '../../fcm-push.service';

describe('CatalogPushNotifier', () => {
  it('envía solo vod/series y omite episodios', async () => {
    const fcm = {
      notifyCatalogAnnouncements: jest.fn().mockResolvedValue(undefined),
    };
    const lines = {
      listAllActivePushTokens: jest.fn().mockResolvedValue(['t1', 't2']),
    };
    const notifier = new CatalogPushNotifier(
      fcm as unknown as FcmPushService,
      lines as unknown as LineAccess,
    );
    const created: CatalogAnnouncementDraft[] = [
      {
        id: '1',
        name: 'Movie',
        kind: 'vod',
        contentId: '1',
        title: 'Movie',
        dedupeKey: 'vod::1',
      },
      {
        id: 'e1',
        name: 'Ep',
        kind: 'episode',
        contentId: 'e1',
        title: 'Ep',
        dedupeKey: 'episode:s:e1',
      },
    ];
    const n = await notifier.notifyNewCatalogItems(created);
    expect(n).toBe(2);
    expect(fcm.notifyCatalogAnnouncements).toHaveBeenCalledWith(
      ['t1', 't2'],
      expect.objectContaining({ count: 1, kinds: ['vod'] }),
    );
  });

  it('no envía si no hay tokens', async () => {
    const fcm = { notifyCatalogAnnouncements: jest.fn() };
    const lines = { listAllActivePushTokens: jest.fn().mockResolvedValue([]) };
    const notifier = new CatalogPushNotifier(
      fcm as unknown as FcmPushService,
      lines as unknown as LineAccess,
    );
    await expect(
      notifier.notifyNewCatalogItems([
        {
          id: '1',
          name: 'Movie',
          kind: 'vod',
          contentId: '1',
          title: 'Movie',
          dedupeKey: 'vod::1',
        },
      ]),
    ).resolves.toBe(0);
    expect(fcm.notifyCatalogAnnouncements).not.toHaveBeenCalled();
  });
});
