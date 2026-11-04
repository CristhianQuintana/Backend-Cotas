import { Logger } from '@nestjs/common';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../../common/exceptions/domain-error';
import { redactSensitive } from '../../../../../common/logging/redact';
import {
  resolveXuiStoredImage,
  rewriteClientFacingXuiUrl,
  sameImagePath,
} from '../../../../../common/utils/sanitize-url';
import type {
  XuiClient,
  XuiCredentials,
  XuiLiveStream,
  XuiSeriesDetails,
  XuiSeriesSummary,
  XuiVodDetails,
  XuiVodStream,
} from '../../domain/models';
import {
  mapCategories,
  mapLineStatus,
  mapLiveStreams,
  mapSeries,
  mapSeriesInfo,
  mapServerInfo,
  mapShortEpg,
  mapVodInfo,
  mapVodStreams,
} from '../mappers/xui-mappers';

export interface XuiClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  maxResponseBytes: number;
  allowedStreamHosts: readonly string[];
}

type XuiAction =
  | 'line'
  | 'get_live_categories'
  | 'get_live_streams'
  | 'get_vod_categories'
  | 'get_vod_streams'
  | 'get_vod_info'
  | 'get_series_categories'
  | 'get_series'
  | 'get_series_info'
  | 'get_short_epg';

export class XuiHttpClient implements XuiClient {
  private readonly logger = new Logger(XuiHttpClient.name);

  constructor(private readonly options: XuiClientOptions) {}

  authenticate(credentials: XuiCredentials) {
    return this.request('line', {}, (payload) => mapLineStatus(payload), credentials, {
      notFoundMeansRejected: true,
    });
  }

  getLineStatus(credentials?: XuiCredentials) {
    return this.request('line', {}, (payload) => mapLineStatus(payload), credentials);
  }

  getLiveCategories(credentials?: XuiCredentials) {
    return this.request(
      'get_live_categories',
      {},
      (payload) => mapCategories(payload),
      credentials,
    );
  }

  getLiveStreams(credentials?: XuiCredentials) {
    return this.request(
      'get_live_streams',
      {},
      (payload) => mapLiveStreams(payload).map((item) => this.rewriteLive(item)),
      credentials,
    );
  }

  getVodCategories(credentials?: XuiCredentials) {
    return this.request('get_vod_categories', {}, (payload) => mapCategories(payload), credentials);
  }

  getVodStreams(credentials?: XuiCredentials) {
    return this.request(
      'get_vod_streams',
      {},
      (payload) => mapVodStreams(payload).map((item) => this.rewriteVod(item)),
      credentials,
    );
  }

  getVodInfo(vodId: string, credentials?: XuiCredentials) {
    return this.requestContent(
      'get_vod_info',
      { vod_id: vodId },
      (payload) => {
        const mapped = mapVodInfo(payload);
        return mapped ? this.rewriteVodDetails(mapped) : null;
      },
      credentials,
    );
  }

  getSeriesCategories(credentials?: XuiCredentials) {
    return this.request(
      'get_series_categories',
      {},
      (payload) => mapCategories(payload),
      credentials,
    );
  }

  getSeries(credentials?: XuiCredentials) {
    return this.request(
      'get_series',
      {},
      (payload) => mapSeries(payload).map((item) => this.rewriteSeries(item)),
      credentials,
    );
  }

  getSeriesInfo(seriesId: string, credentials?: XuiCredentials) {
    return this.requestContent(
      'get_series_info',
      { series_id: seriesId },
      (payload) => {
        const mapped = mapSeriesInfo(payload, seriesId);
        return mapped ? this.rewriteSeriesDetails(mapped) : null;
      },
      credentials,
    );
  }

  getShortEpg(streamId: string, credentials?: XuiCredentials, options?: { limit?: number }) {
    if (!/^[0-9]{1,12}$/u.test(streamId)) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
    }
    const params: Record<string, string> = { stream_id: streamId };
    const limit = options?.limit;
    if (limit !== undefined) {
      const safe = Math.max(1, Math.min(Math.trunc(limit), 50));
      params.limit = String(safe);
    }
    return this.request('get_short_epg', params, (payload) => mapShortEpg(payload), credentials);
  }

  getServerInfo(credentials?: XuiCredentials) {
    return this.request(
      'line',
      {},
      (payload) => {
        // Host/puerto anunciados por XUI (server_info). No reescribir al host de
        // XUI_BASE_URL: el panel LAN responde 302 hacia la IP pública y varios
        // players fallan al seguir ese redirect. Los iconos sí se reescriben aparte.
        return mapServerInfo(payload, this.options.allowedStreamHosts);
      },
      credentials,
    );
  }

  private rewriteUrl(url: string | null): string | null {
    if (!url) {
      return null;
    }
    const resolved = resolveXuiStoredImage(url, this.options.baseUrl);
    if (!resolved) {
      return null;
    }
    return rewriteClientFacingXuiUrl(
      resolved,
      this.options.baseUrl,
      this.options.allowedStreamHosts,
    );
  }

  private rewriteLive(item: XuiLiveStream): XuiLiveStream {
    const iconUrl = this.rewriteUrl(item.iconUrl);
    return { ...item, iconUrl, posterUrl: iconUrl, backdropUrl: null };
  }

  private rewriteVod(item: XuiVodStream): XuiVodStream {
    const iconUrl = this.rewriteUrl(item.iconUrl);
    return { ...item, iconUrl, posterUrl: iconUrl, backdropUrl: null };
  }

  private rewriteVodDetails(item: XuiVodDetails): XuiVodDetails {
    const posterUrl = this.rewriteUrl(item.posterUrl);
    const backdropUrl = this.rewriteUrl(item.backdropUrl);
    return {
      ...item,
      posterUrl,
      backdropUrl: backdropUrl && !sameImagePath(posterUrl, backdropUrl) ? backdropUrl : null,
    };
  }

  private rewriteSeries(item: XuiSeriesSummary): XuiSeriesSummary {
    return { ...item, posterUrl: this.rewriteUrl(item.posterUrl), backdropUrl: null };
  }

  private rewriteSeriesDetails(item: XuiSeriesDetails): XuiSeriesDetails {
    const posterUrl = this.rewriteUrl(item.posterUrl);
    const backdropUrl = this.rewriteUrl(item.backdropUrl);
    return {
      ...item,
      posterUrl,
      backdropUrl: backdropUrl && !sameImagePath(posterUrl, backdropUrl) ? backdropUrl : null,
      seasons: item.seasons.map((season) => ({
        ...season,
        posterUrl: this.rewriteUrl(season.posterUrl),
      })),
      episodes: item.episodes.map((episode) => ({
        ...episode,
        posterUrl: this.rewriteUrl(episode.posterUrl),
      })),
    };
  }

  private requestContent<T>(
    action: XuiAction,
    params: Record<string, string>,
    map: (payload: unknown) => T | null,
    credentials?: XuiCredentials,
  ): Promise<T> {
    const id = params.vod_id ?? params.series_id ?? '';
    if (!/^[0-9]{1,12}$/u.test(id)) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
    }
    return this.request(
      action,
      params,
      (payload) => {
        const mapped = map(payload);
        if (!mapped) {
          throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
        }
        return mapped;
      },
      credentials,
    );
  }

  private async request<T>(
    action: XuiAction,
    params: Record<string, string>,
    map: (payload: unknown) => T,
    credentials?: XuiCredentials,
    options?: { notFoundMeansRejected?: boolean },
  ): Promise<T> {
    const started = Date.now();
    const url = new URL('player_api.php', ensureSlash(this.options.baseUrl));
    const username = credentials?.username ?? this.options.username;
    const password = credentials?.password ?? this.options.password;
    url.searchParams.set('username', username);
    url.searchParams.set('password', password);
    if (action !== 'line') {
      url.searchParams.set('action', action);
    }
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: { accept: 'application/json' },
      });
      if (response.status >= 300 && response.status < 400) {
        this.log(action, 'redirect_rejected', started);
        throw new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
      }
      if (response.status === 404 && options?.notFoundMeansRejected) {
        this.log(action, 'line_rejected', started);
        return map({ user_info: { auth: 0, status: null } });
      }
      if (response.status === 401 || response.status === 403) {
        this.log(action, 'upstream_auth', started);
        throw new DomainError(ErrorCodes.upstreamAuth, 502, PublicMessages.upstreamAuth);
      }
      if (!response.ok) {
        this.log(action, `http_${response.status}`, started);
        throw new DomainError(
          ErrorCodes.dependencyUnavailable,
          503,
          PublicMessages.dependencyUnavailable,
        );
      }
      const body = await readLimited(response, this.options.maxResponseBytes);
      let payload: unknown;
      try {
        payload = JSON.parse(body) as unknown;
      } catch {
        this.log(action, 'invalid_json', started);
        throw new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
      }
      const mapped = map(payload);
      this.log(action, 'ok', started);
      return mapped;
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      const timeout = isTimeoutError(error);
      this.log(action, timeout ? 'timeout' : 'unavailable', started);
      if (timeout) {
        throw new DomainError(ErrorCodes.dependencyTimeout, 504, PublicMessages.dependencyTimeout);
      }
      throw new DomainError(
        ErrorCodes.dependencyUnavailable,
        503,
        PublicMessages.dependencyUnavailable,
      );
    }
  }

  private log(action: string, outcome: string, started: number): void {
    this.logger.log(
      redactSensitive(
        JSON.stringify({
          integration: 'xui',
          action,
          outcome,
          durationMs: Date.now() - started,
        }),
      ),
    );
  }
}

function isTimeoutError(error: unknown): boolean {
  const name = readErrorName(error);
  if (name === 'TimeoutError' || name === 'AbortError') {
    return true;
  }
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    const causeName = readErrorName(error.cause);
    return causeName === 'TimeoutError' || causeName === 'AbortError';
  }
  return false;
}

function readErrorName(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
  ) {
    return error.name;
  }
  return undefined;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
    }
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    if (!next.value) {
      continue;
    }
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function ensureSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}
