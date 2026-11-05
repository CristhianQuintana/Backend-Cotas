import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import {
  XUI_CLIENT,
  type XuiClient,
  type XuiCredentials,
  type XuiSeriesSummary,
  type XuiVodStream,
} from '../../integrations/xui/domain/models';
import { FcmPushService } from '../../notifications/fcm-push.service';
import { CATALOG_CACHE, catalogCacheKey, type CatalogCache } from '../domain/catalog-cache';
import { CatalogAnnouncementsService } from './catalog-announcements.service';

const LIST_RESOURCES = [
  'live-categories',
  'live-streams',
  'vod-categories',
  'vod-streams',
  'series-categories',
  'series',
] as const;

export type CatalogSyncResource = (typeof LIST_RESOURCES)[number];

@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    @Inject(XUI_CLIENT) private readonly xui: XuiClient,
    @Inject(CATALOG_CACHE) private readonly cache: CatalogCache,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly announcements?: CatalogAnnouncementsService,
    @Optional() private readonly push?: FcmPushService,
  ) {}

  async syncProbeCatalog(): Promise<{
    scope: string;
    resources: Record<string, number>;
    durationMs: number;
    announcements: number;
  }> {
    const credentials: XuiCredentials = {
      username: this.config.xuiUsername,
      password: this.config.xuiPassword,
    };
    const started = Date.now();
    const resources: Record<string, number> = {};
    const scope = `user:${credentials.username}`;

    const line = await this.xui.getLineStatus(credentials);
    if (!line.authenticated) {
      throw new Error('La línea de sonda XUI no autenticó durante la sincronización.');
    }

    let announcementCount = 0;
    for (const resource of LIST_RESOURCES) {
      const items = await this.fetchResource(resource, credentials);
      await this.cache.setJson(
        catalogCacheKey(scope, resource),
        items,
        this.config.catalogCacheTtlSeconds,
      );
      resources[resource] = Array.isArray(items) ? items.length : 0;
      if (resource === 'vod-streams' || resource === 'series') {
        announcementCount += await this.publishNewContent(resource, items);
      }
    }
    // Invalida bootstrap Home para que el próximo GET lo reconstruya con datos frescos.
    await this.cache.del(catalogCacheKey(scope, 'home:v1'));

    const durationMs = Date.now() - started;
    this.logger.log(
      `Catálogo XUI sincronizado en ${durationMs}ms (${Object.values(resources).join('/')}; anuncios=${announcementCount}).`,
    );
    return { scope, resources, durationMs, announcements: announcementCount };
  }

  private async publishNewContent(
    resource: 'vod-streams' | 'series',
    items: unknown,
  ): Promise<number> {
    if (!this.announcements || !Array.isArray(items)) {
      return 0;
    }
    const kind = resource === 'vod-streams' ? 'vod' : 'series';
    const mapped =
      kind === 'vod'
        ? (items as XuiVodStream[]).map((item) => ({ id: item.id, name: item.name }))
        : (items as XuiSeriesSummary[]).map((item) => ({ id: item.id, name: item.name }));
    const created = await this.announcements.detectAndPersist(kind, mapped);
    if (created.length === 0 || !this.push) {
      return created.length;
    }
    const tokens = await this.announcements.listActivePushTokens();
    await this.push.notifyNewContent(created, tokens);
    return created.length;
  }

  private fetchResource(resource: CatalogSyncResource, credentials: XuiCredentials) {
    switch (resource) {
      case 'live-categories':
        return this.xui.getLiveCategories(credentials);
      case 'live-streams':
        return this.xui.getLiveStreams(credentials);
      case 'vod-categories':
        return this.xui.getVodCategories(credentials);
      case 'vod-streams':
        return this.xui.getVodStreams(credentials);
      case 'series-categories':
        return this.xui.getSeriesCategories(credentials);
      case 'series':
        return this.xui.getSeries(credentials);
      default: {
        const _exhaustive: never = resource;
        return _exhaustive;
      }
    }
  }
}
