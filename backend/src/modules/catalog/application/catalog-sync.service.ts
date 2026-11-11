import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import {
  XUI_CLIENT,
  type XuiClient,
  type XuiCredentials,
  type XuiSeriesSummary,
  type XuiVodStream,
} from '../../integrations/xui/domain/models';
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

    const fetched: Partial<Record<CatalogSyncResource, unknown>> = {};
    for (const resource of LIST_RESOURCES) {
      const items = await this.fetchResource(resource, credentials);
      fetched[resource] = items;
      resources[resource] = Array.isArray(items) ? items.length : 0;
    }

    const series = fetched.series as XuiSeriesSummary[];
    const details = await mapConcurrent(
      series,
      Math.min(4, Math.max(1, this.config.catalogSyncConcurrency)),
      (item) => this.xui.getSeriesInfo(item.id, credentials),
    );
    const seriesDetails = new Map(details.map((item) => [item.id, item]));
    const episodes = details.flatMap((detail) =>
      detail.episodes.map((episode) => ({
        id: episode.id,
        seriesId: detail.id,
        name: episode.name,
        description: episode.plot,
        posterUrl: episode.posterUrl ?? detail.posterUrl,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        publishedAt: null,
      })),
    );
    resources.episodes = episodes.length;

    // Commit cache and announcement snapshots only after every required XUI call succeeded.
    for (const resource of LIST_RESOURCES) {
      await this.cache.setJson(
        catalogCacheKey(scope, resource),
        fetched[resource],
        this.config.catalogCacheTtlSeconds,
      );
    }
    const announcementCount = this.announcements
      ? await this.announcements.detectAndPersist({
          movies: (fetched['vod-streams'] as XuiVodStream[]).map((item) => ({
            id: item.id,
            name: item.name,
            posterUrl: item.posterUrl,
          })),
          series: series.map((item) => ({
            id: item.id,
            name: item.name,
            posterUrl: item.posterUrl,
            description: seriesDetails.get(item.id)?.plot,
          })),
          episodes,
        })
      : 0;
    // Invalida bootstrap Home para que el próximo GET lo reconstruya con datos frescos.
    await this.cache.del(catalogCacheKey(scope, 'home:v1'));

    const durationMs = Date.now() - started;
    this.logger.log(
      `Catálogo XUI sincronizado en ${durationMs}ms (${Object.values(resources).join('/')}; anuncios=${announcementCount}).`,
    );
    return { scope, resources, durationMs, announcements: announcementCount };
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

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
) {
  const result = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        result[index] = await fn(items[index]!);
      }
    }),
  );
  return result;
}
