import { Inject, Injectable, Optional } from '@nestjs/common';
import { DomainError, ErrorCodes, PublicMessages } from '../../../common/exceptions/domain-error';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { paginate, type Page } from '../../../common/utils/pagination';
import {
  XUI_CLIENT,
  type XuiCategory,
  type XuiClient,
  type XuiCredentials,
  type XuiEpisode,
  type XuiLiveStream,
  type XuiSeason,
  type XuiSeriesDetails,
  type XuiSeriesSummary,
  type XuiVodDetails,
  type XuiVodStream,
} from '../../integrations/xui/domain/models';
import { CATALOG_CACHE, catalogCacheKey, type CatalogCache } from '../domain/catalog-cache';
import { MemoryCatalogCache } from '../infrastructure/redis-catalog.cache';
import { presentChannelEpg, sortSearchHits, toSearchHit, type EpgSearchHit } from './epg.presenter';

/** Tope de canales a sondear en una búsqueda global (evita saturar XUI). */
const EPG_SEARCH_MAX_CHANNELS = 80;
/** Programas por canal al indexar la búsqueda. */
const EPG_SEARCH_PROGRAMS_PER_CHANNEL = 12;
const EPG_SEARCH_CONCURRENCY = 4;

export interface CatalogQuery {
  page: number;
  limit: number;
  categoryId?: string;
  search?: string;
}

@Injectable()
export class CatalogUseCase {
  private readonly shared: CatalogCache;
  private readonly memory = new MemoryCatalogCache();

  constructor(
    @Inject(XUI_CLIENT) private readonly xui: XuiClient,
    @Optional() @Inject(CATALOG_CACHE) cache?: CatalogCache,
    @Optional() @Inject(APP_CONFIG) config?: AppConfig,
  ) {
    this.shared = cache ?? this.memory;
    this.config = config;
  }

  private readonly config?: AppConfig;

  async liveCategories(
    query: CatalogQuery,
    credentials?: XuiCredentials,
  ): Promise<Page<XuiCategory>> {
    const items = await this.whenAuthenticated(
      sortByName(
        await this.remember('live-categories', credentials, () =>
          this.xui.getLiveCategories(credentials),
        ),
      ),
      credentials,
    );
    return paginate(filterCategory(items, query.categoryId), query.page, query.limit);
  }

  async liveStreams(
    query: CatalogQuery,
    credentials?: XuiCredentials,
  ): Promise<Page<XuiLiveStream>> {
    const items = await this.whenAuthenticated(
      sortByName(
        await this.remember('live-streams', credentials, () =>
          this.xui.getLiveStreams(credentials),
        ),
      ),
      credentials,
    );
    return paginate(filterListed(items, query.categoryId, query.search), query.page, query.limit);
  }

  async vodCategories(
    query: CatalogQuery,
    credentials?: XuiCredentials,
  ): Promise<Page<XuiCategory>> {
    const items = await this.whenAuthenticated(
      sortByName(
        await this.remember('vod-categories', credentials, () =>
          this.xui.getVodCategories(credentials),
        ),
      ),
      credentials,
    );
    return paginate(filterCategory(items, query.categoryId), query.page, query.limit);
  }

  async vodStreams(query: CatalogQuery, credentials?: XuiCredentials): Promise<Page<XuiVodStream>> {
    const items = await this.whenAuthenticated(
      sortByName(
        await this.remember('vod-streams', credentials, () => this.xui.getVodStreams(credentials)),
      ),
      credentials,
    );
    return paginate(filterListed(items, query.categoryId, query.search), query.page, query.limit);
  }

  async vodDetails(vodId: string, credentials?: XuiCredentials): Promise<XuiVodDetails> {
    const details = await this.remember(`vod:${vodId}`, credentials, () =>
      this.xui.getVodInfo(vodId, credentials),
    );
    if (details.id !== vodId) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
    }
    return details;
  }

  async seriesCategories(
    query: CatalogQuery,
    credentials?: XuiCredentials,
  ): Promise<Page<XuiCategory>> {
    const items = await this.whenAuthenticated(
      sortByName(
        await this.remember('series-categories', credentials, () =>
          this.xui.getSeriesCategories(credentials),
        ),
      ),
      credentials,
    );
    return paginate(filterCategory(items, query.categoryId), query.page, query.limit);
  }

  async series(query: CatalogQuery, credentials?: XuiCredentials): Promise<Page<XuiSeriesSummary>> {
    const items = await this.whenAuthenticated(
      sortByName(await this.remember('series', credentials, () => this.xui.getSeries(credentials))),
      credentials,
    );
    return paginate(filterListed(items, query.categoryId, query.search), query.page, query.limit);
  }

  async seriesDetails(seriesId: string, credentials?: XuiCredentials): Promise<XuiSeriesDetails> {
    const details = await this.remember(`series:${seriesId}`, credentials, () =>
      this.xui.getSeriesInfo(seriesId, credentials),
    );
    if (details.id !== seriesId) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
    }
    return details;
  }

  async seasons(
    seriesId: string,
    credentials?: XuiCredentials,
  ): Promise<{ seriesId: string; items: XuiSeason[] }> {
    const details = await this.seriesDetails(seriesId, credentials);
    return { seriesId, items: details.seasons };
  }

  async episodes(
    seriesId: string,
    seasonNumber: number,
    credentials?: XuiCredentials,
  ): Promise<{ seriesId: string; seasonNumber: number; items: XuiEpisode[] }> {
    const details = await this.seriesDetails(seriesId, credentials);
    if (!details.seasons.some((season) => season.number === seasonNumber)) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
    }
    return {
      seriesId,
      seasonNumber,
      items: details.episodes.filter((episode) => episode.seasonNumber === seasonNumber),
    };
  }

  async shortEpg(
    streamId: string,
    credentials?: XuiCredentials,
    limit = 12,
  ): Promise<ReturnType<typeof presentChannelEpg>> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
    await this.requireLiveStream(streamId, credentials);
    const items = await this.remember(
      `epg:${streamId}:l${safeLimit}`,
      credentials,
      () => this.xui.getShortEpg(streamId, credentials, { limit: safeLimit }),
      this.config?.catalogEpgCacheTtlSeconds ?? 120,
    );
    return presentChannelEpg(streamId, items);
  }

  /**
   * Bootstrap del Home: una sola respuesta con heroes + carriles livianos.
   * Usa las mismas cachés Redis/memoria que los listados (sin fan-out extra a XUI si ya están calientes).
   */
  async home(credentials?: XuiCredentials): Promise<CatalogHomeView> {
    const scope = `user:${credentials?.username ?? 'server'}`;
    const cacheKey = catalogCacheKey(scope, 'home:v1');
    const ttl = this.config?.catalogCacheTtlSeconds ?? 300;
    const cached = await this.memory.getJson<CatalogHomeView>(cacheKey);
    if (cached) {
      return cached;
    }
    const fromShared = await this.shared.getJson<CatalogHomeView>(cacheKey);
    if (fromShared) {
      await this.memory.setJson(cacheKey, fromShared, Math.min(ttl, 60));
      return fromShared;
    }

    const [livePage, vodPage, seriesPage, vodCategories] = await Promise.all([
      this.liveStreams({ page: 1, limit: 16 }, credentials),
      this.vodStreams({ page: 1, limit: 48 }, credentials),
      this.series({ page: 1, limit: 16 }, credentials),
      this.vodCategories({ page: 1, limit: 8 }, credentials),
    ]);

    const liveItems = livePage.items.map((item) => toHomeItem(item, 'live'));
    const vodItems = vodPage.items.map((item) => toHomeItem(item, 'vod'));
    const seriesItems = seriesPage.items.map((item) => toHomeItem(item, 'series'));

    const rails: CatalogHomeRail[] = [
      {
        id: 'live-featured',
        title: 'Canales en vivo',
        section: 'live',
        items: liveItems.slice(0, 16),
      },
      {
        id: 'vod-featured',
        title: 'Películas',
        section: 'vod',
        items: vodItems.slice(0, 16),
      },
      {
        id: 'series-featured',
        title: 'Series',
        section: 'series',
        items: seriesItems.slice(0, 16),
      },
    ];

    for (const category of vodCategories.items.slice(0, 4)) {
      const railItems = vodPage.items
        .filter(
          (item) =>
            item.categoryId === category.id || (item.categoryIds?.includes(category.id) ?? false),
        )
        .slice(0, 12)
        .map((item) => toHomeItem(item, 'vod'));
      if (railItems.length === 0) {
        continue;
      }
      rails.push({
        id: `genre-${category.id}`,
        title: category.name,
        section: 'vod',
        items: railItems,
      });
    }

    const heroes = [...vodItems, ...seriesItems]
      .filter((item) => Boolean(item.posterUrl))
      .slice(0, 8);

    const view: CatalogHomeView = {
      generatedAt: new Date().toISOString(),
      heroes,
      rails,
    };
    await this.memory.setJson(cacheKey, view, Math.min(ttl, 60));
    await this.shared.setJson(cacheKey, view, ttl);
    return view;
  }

  async shortEpgBatch(
    streamIds: string[],
    credentials?: XuiCredentials,
    limit = 12,
  ): Promise<{ generatedAt: string; channels: ReturnType<typeof presentChannelEpg>[] }> {
    const unique = [...new Set(streamIds)].slice(0, 50);
    if (unique.length === 0) {
      return { generatedAt: new Date().toISOString(), channels: [] };
    }
    const streams = await this.remember('live-streams', credentials, () =>
      this.xui.getLiveStreams(credentials),
    );
    const allowed = new Set(streams.map((stream) => stream.id));
    const channels: ReturnType<typeof presentChannelEpg>[] = [];
    // Concurrencia baja para no saturar XUI cuando la guía pide varios canales.
    const queue = [...unique];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) {
        const streamId = queue.shift();
        if (!streamId) {
          return;
        }
        if (!allowed.has(streamId)) {
          continue;
        }
        channels.push(await this.shortEpg(streamId, credentials, limit));
      }
    });
    await Promise.all(workers);
    channels.sort((left, right) => left.streamId.localeCompare(right.streamId, 'en'));
    return { generatedAt: new Date().toISOString(), channels };
  }

  async searchEpg(
    query: { q: string; page: number; limit: number },
    credentials?: XuiCredentials,
  ): Promise<Page<EpgSearchHit> & { query: string; timezone: string; generatedAt: string }> {
    const needle = query.q.trim().toLocaleLowerCase('es');
    const page = Math.max(1, query.page);
    const limit = Math.max(1, Math.min(query.limit, 50));
    const generatedAt = new Date().toISOString();
    const empty = {
      ...paginate<EpgSearchHit>([], page, limit),
      query: query.q.trim(),
      timezone: 'America/Lima',
      generatedAt,
    };
    if (needle.length < 2) {
      return empty;
    }

    const streams = await this.remember('live-streams', credentials, () =>
      this.xui.getLiveStreams(credentials),
    );
    await this.whenAuthenticated(streams, credentials);

    // Prioriza canales con EPG asignado en XUI; completa con el resto hasta el tope.
    const withEpg = streams.filter((stream) => Boolean(stream.epgChannelId));
    const withoutEpg = streams.filter((stream) => !stream.epgChannelId);
    const candidates = [...withEpg, ...withoutEpg].slice(0, EPG_SEARCH_MAX_CHANNELS);

    const hits: EpgSearchHit[] = [];
    const at = new Date();
    const queue = [...candidates];
    const workers = Array.from(
      { length: Math.min(EPG_SEARCH_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          const stream = queue.shift();
          if (!stream) {
            return;
          }
          try {
            const items = await this.remember(
              `epg:${stream.id}:l${EPG_SEARCH_PROGRAMS_PER_CHANNEL}`,
              credentials,
              () =>
                this.xui.getShortEpg(stream.id, credentials, {
                  limit: EPG_SEARCH_PROGRAMS_PER_CHANNEL,
                }),
              this.config?.catalogEpgCacheTtlSeconds ?? 120,
            );
            for (const entry of items) {
              const haystack = `${entry.title} ${entry.description ?? ''}`.toLocaleLowerCase('es');
              if (!haystack.includes(needle)) {
                continue;
              }
              hits.push(
                toSearchHit(
                  entry,
                  { id: stream.id, name: stream.name, iconUrl: stream.iconUrl },
                  at,
                ),
              );
            }
          } catch {
            // Un canal sin EPG o con fallo puntual no tumba la búsqueda global.
          }
        }
      },
    );
    await Promise.all(workers);

    const pageResult = paginate(sortSearchHits(hits), page, limit);
    return {
      ...pageResult,
      query: query.q.trim(),
      timezone: 'America/Lima',
      generatedAt,
    };
  }

  private async requireLiveStream(streamId: string, credentials?: XuiCredentials): Promise<void> {
    const streams = await this.remember('live-streams', credentials, () =>
      this.xui.getLiveStreams(credentials),
    );
    if (!streams.some((stream) => stream.id === streamId)) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
    }
  }

  private async whenAuthenticated<T>(items: T[], credentials?: XuiCredentials): Promise<T[]> {
    if (items.length > 0) {
      return items;
    }
    const line = await this.xui.getLineStatus(credentials);
    if (!line.authenticated) {
      throw new DomainError(ErrorCodes.upstreamAuth, 502, PublicMessages.upstreamAuth);
    }
    return items;
  }

  private async remember<T>(
    name: string,
    credentials: XuiCredentials | undefined,
    read: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const scope = `user:${credentials?.username ?? 'server'}`;
    const key = catalogCacheKey(scope, name);
    const ttl = ttlSeconds ?? this.config?.catalogCacheTtlSeconds ?? 300;

    const fromMemory = await this.memory.getJson<T>(key);
    if (fromMemory !== null) {
      return fromMemory;
    }

    const fromShared = await this.shared.getJson<T>(key);
    if (fromShared !== null) {
      await this.memory.setJson(key, fromShared, Math.min(ttl, 60));
      return fromShared;
    }

    const value = await read();
    await this.memory.setJson(key, value, Math.min(ttl, 60));
    await this.shared.setJson(key, value, ttl);
    return value;
  }
}

export type CatalogHomeSection = 'live' | 'vod' | 'series';

export interface CatalogHomeItem {
  id: string;
  name: string;
  section: CatalogHomeSection;
  posterUrl: string | null;
  categoryId: string | null;
  year: string | null;
  rating: string | null;
}

export interface CatalogHomeRail {
  id: string;
  title: string;
  section: CatalogHomeSection;
  items: CatalogHomeItem[];
}

export interface CatalogHomeView {
  generatedAt: string;
  heroes: CatalogHomeItem[];
  rails: CatalogHomeRail[];
}

function toHomeItem(
  item: {
    id: string;
    name: string;
    posterUrl?: string | null;
    iconUrl?: string | null;
    categoryId?: string | null;
    year?: string | null;
    rating?: string | null;
  },
  section: CatalogHomeSection,
): CatalogHomeItem {
  return {
    id: item.id,
    name: item.name,
    section,
    posterUrl: item.posterUrl ?? item.iconUrl ?? null,
    categoryId: item.categoryId ?? null,
    year: item.year ?? null,
    rating: item.rating ?? null,
  };
}

/** Campos mínimos para grillas (menos payload que el objeto XUI completo). */
export function toCatalogGridItem<T extends Record<string, unknown>>(
  item: T,
): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId ?? null,
    categoryIds: item.categoryIds,
    posterUrl: item.posterUrl ?? item.iconUrl ?? null,
    iconUrl: item.iconUrl ?? item.posterUrl ?? null,
    backdropUrl: item.backdropUrl ?? null,
    year: item.year ?? null,
    rating: item.rating ?? null,
    epgChannelId: item.epgChannelId,
  };
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    left.name.localeCompare(right.name, 'es', { numeric: true, sensitivity: 'base' }),
  );
}

function filterCategory<T extends { id: string }>(items: T[], categoryId: string | undefined): T[] {
  if (!categoryId) {
    return items;
  }
  return items.filter((item) => item.id === categoryId);
}

function filterListed<
  T extends { name: string; categoryId?: string | null; categoryIds?: string[] },
>(items: T[], categoryId: string | undefined, search: string | undefined): T[] {
  const needle = search?.trim().toLocaleLowerCase('es');
  return items.filter((item) => {
    const categoryOk = !categoryId
      ? true
      : item.categoryIds
        ? item.categoryIds.includes(categoryId)
        : item.categoryId === categoryId;
    const searchOk = !needle || item.name.toLocaleLowerCase('es').includes(needle);
    return categoryOk && searchOk;
  });
}
