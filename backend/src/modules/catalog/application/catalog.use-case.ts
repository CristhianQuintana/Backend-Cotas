import { Inject, Injectable } from '@nestjs/common';
import { DomainError, ErrorCodes, PublicMessages } from '../../../common/exceptions/domain-error';
import { paginate, type Page } from '../../../common/utils/pagination';
import {
  XUI_CLIENT,
  type XuiCategory,
  type XuiClient,
  type XuiCredentials,
  type XuiEpgEntry,
  type XuiEpisode,
  type XuiLiveStream,
  type XuiSeason,
  type XuiSeriesDetails,
  type XuiSeriesSummary,
  type XuiVodDetails,
  type XuiVodStream,
} from '../../integrations/xui/domain/models';

export interface CatalogQuery {
  page: number;
  limit: number;
  categoryId?: string;
  search?: string;
}

const CACHE_MS = 60_000;

@Injectable()
export class CatalogUseCase {
  private readonly memory = new Map<string, { at: number; value: unknown }>();

  constructor(@Inject(XUI_CLIENT) private readonly xui: XuiClient) {}

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
  ): Promise<{ streamId: string; items: XuiEpgEntry[] }> {
    const streams = await this.xui.getLiveStreams(credentials);
    if (!streams.some((stream) => stream.id === streamId)) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
    }
    const items = await this.xui.getShortEpg(streamId, credentials);
    return { streamId, items };
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
  ): Promise<T> {
    const key = `${credentials?.username ?? 'server'}:${name}`;
    const found = this.memory.get(key);
    if (found && Date.now() - found.at < CACHE_MS) {
      return found.value as T;
    }
    const value = await read();
    this.memory.set(key, { at: Date.now(), value });
    if (this.memory.size > 40) {
      const oldest = [...this.memory.entries()].sort((left, right) => left[1].at - right[1].at)[0];
      if (oldest) {
        this.memory.delete(oldest[0]);
      }
    }
    return value;
  }
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
