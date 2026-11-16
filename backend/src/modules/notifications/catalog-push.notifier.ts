import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { CatalogAnnouncementDraft } from '../catalog/application/catalog-announcement.diff';
import { LINE_ACCESS, type LineAccess } from '../identity/domain/ports/identity.ports';
import { FcmPushService } from './fcm-push.service';

/**
 * Envía push FCM cuando el sync de catálogo detecta películas/series nuevas.
 * No notifica episodios ni canales en vivo.
 */
@Injectable()
export class CatalogPushNotifier {
  private readonly logger = new Logger(CatalogPushNotifier.name);

  constructor(
    @Inject(FcmPushService) private readonly fcm: FcmPushService,
    @Optional() @Inject(LINE_ACCESS) private readonly lines?: LineAccess,
  ) {}

  async notifyNewCatalogItems(created: readonly CatalogAnnouncementDraft[]): Promise<number> {
    const items = created.filter((item) => item.kind === 'vod' || item.kind === 'series');
    if (items.length === 0 || !this.lines) {
      return 0;
    }
    const tokens = await this.lines.listAllActivePushTokens();
    if (tokens.length === 0) {
      return 0;
    }
    const first = items[0]!;
    const sample = items.slice(0, 3);
    const title =
      items.length === 1
        ? first.kind === 'vod'
          ? 'Nueva película'
          : 'Nueva serie'
        : 'Novedades en el catálogo';
    const body =
      items.length === 1
        ? first.title
        : `${items.length} títulos nuevos: ${sample.map((i) => i.title).join(', ')}${
            items.length > sample.length ? '…' : ''
          }`;
    try {
      await this.fcm.notifyCatalogAnnouncements(tokens, {
        title,
        body,
        count: items.length,
        kinds: [...new Set(items.map((i) => i.kind))],
      });
      return tokens.length;
    } catch (error) {
      this.logger.warn(
        `Push de catálogo falló: ${error instanceof Error ? error.message : 'error'}`,
      );
      return 0;
    }
  }
}
