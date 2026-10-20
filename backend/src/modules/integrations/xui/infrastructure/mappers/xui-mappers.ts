import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../../common/exceptions/domain-error';
import { decodePossibleBase64, sanitizePublicUrl } from '../../../../../common/utils/sanitize-url';
import type {
  XuiCategory,
  XuiEpgEntry,
  XuiEpisode,
  XuiLineStatus,
  XuiLiveStream,
  XuiSeason,
  XuiSeriesDetails,
  XuiSeriesSummary,
  XuiServerInfo,
  XuiVodDetails,
  XuiVodStream,
} from '../../domain/models';

export function mapCategories(payload: unknown): XuiCategory[] {
  return uniqueById(readArray(payload), mapCategory);
}

export function mapLiveStreams(payload: unknown): XuiLiveStream[] {
  return uniqueById(readArray(payload), mapLiveStream);
}

export function mapVodStreams(payload: unknown): XuiVodStream[] {
  return uniqueById(readArray(payload), mapVodStream);
}

export function mapSeries(payload: unknown): XuiSeriesSummary[] {
  return uniqueById(readArray(payload), mapSeriesSummary);
}

export function mapVodInfo(payload: unknown): XuiVodDetails | null {
  assertNotAuthFailure(payload);
  if (!isRecord(payload)) {
    return null;
  }
  const info = isRecord(payload.info) ? payload.info : {};
  const movie = isRecord(payload.movie_data) ? payload.movie_data : {};
  const id = asId(movie.stream_id);
  const name = asName(info.name) ?? asName(movie.name) ?? asName(movie.title);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    categoryIds: readCategoryIds(movie),
    posterUrl: sanitizePublicUrl(info.movie_image) ?? sanitizePublicUrl(info.cover_big),
    plot: asText(info.description, 4000) ?? asText(info.plot, 4000),
    year: asYear(movie.year) ?? asYear(info.release_date) ?? asYear(info.releasedate),
    duration: asDuration(info.duration, info.duration_secs),
    genre: asText(info.genre, 300),
    cast: asText(info.cast, 500) ?? asText(info.actors, 500),
    director: asText(info.director, 300),
    rating: asRating(info.rating),
    extension: asExtension(movie.container_extension),
  };
}

export function mapSeriesInfo(payload: unknown, seriesId: string): XuiSeriesDetails | null {
  assertNotAuthFailure(payload);
  if (!isRecord(payload) || !/^[0-9]{1,12}$/u.test(seriesId)) {
    return null;
  }
  const info = isRecord(payload.info) ? payload.info : {};
  const name = asName(info.name) ?? asName(info.title);
  const episodes = readEpisodes(payload.episodes);
  if (!name && episodes.length === 0) {
    return null;
  }
  return {
    id: seriesId,
    name: name ?? `Serie ${seriesId}`,
    categoryIds: readCategoryIds(info),
    posterUrl: sanitizePublicUrl(info.cover),
    plot: asText(info.plot, 4000),
    year: asYear(info.year) ?? asYear(info.release_date) ?? asYear(info.releaseDate),
    rating: asRating(info.rating),
    genre: asText(info.genre, 300),
    cast: asText(info.cast, 500),
    director: asText(info.director, 300),
    seasons: readSeasons(payload.seasons, episodes),
    episodes,
  };
}

export function mapShortEpg(payload: unknown): XuiEpgEntry[] {
  assertNotAuthFailure(payload);
  const source = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.epg_listings)
      ? payload.epg_listings
      : null;
  if (!source) {
    throw invalid();
  }
  const items: XuiEpgEntry[] = [];
  for (const entry of source) {
    const mapped = mapEpg(entry);
    if (mapped) {
      items.push(mapped);
    }
  }
  return items;
}

export function mapLineStatus(payload: unknown): XuiLineStatus {
  const info = userInfo(payload);
  const status = typeof info.status === 'string' ? info.status.slice(0, 32) : null;
  return { authenticated: Number(info.auth) === 1, status };
}

export function mapServerInfo(payload: unknown, allowedHosts: readonly string[]): XuiServerInfo {
  assertNotAuthFailure(payload);
  if (!isRecord(payload) || !isRecord(payload.server_info)) {
    throw invalid();
  }
  const server = payload.server_info;
  const host = extractHost(server.url);
  if (!host || !allowedHosts.includes(host)) {
    throw new DomainError(ErrorCodes.playbackRejected, 502, PublicMessages.playbackRejected);
  }
  const protocol =
    server.server_protocol === 'https'
      ? 'https'
      : server.server_protocol === 'http'
        ? 'http'
        : null;
  if (!protocol) {
    throw invalid();
  }
  const portValue = protocol === 'https' ? server.https_port : server.port;
  const port =
    typeof portValue === 'number'
      ? String(portValue)
      : typeof portValue === 'string'
        ? portValue
        : '';
  if (!/^[0-9]{1,5}$/u.test(port)) {
    throw invalid();
  }
  const portNumber = Number(port);
  if (portNumber < 1 || portNumber > 65535) {
    throw invalid();
  }
  return { protocol, host, port };
}

function mapCategory(value: unknown): XuiCategory | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asId(value.category_id);
  const name = asName(value.category_name);
  if (!id || !name) {
    return null;
  }
  const parent = asId(value.parent_id);
  return { id, name, parentId: parent && parent !== '0' ? parent : null };
}

function mapLiveStream(value: unknown): XuiLiveStream | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asId(value.stream_id);
  const name = asName(value.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    categoryId: asId(value.category_id),
    iconUrl: sanitizePublicUrl(value.stream_icon),
    epgChannelId: asName(value.epg_channel_id),
  };
}

function mapVodStream(value: unknown): XuiVodStream | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asId(value.stream_id);
  const name = asName(value.name);
  if (!id || !name) {
    return null;
  }
  const extension = asExtension(value.container_extension);
  return {
    id,
    name,
    categoryId: asId(value.category_id),
    categoryIds: readCategoryIds(value),
    iconUrl: sanitizePublicUrl(value.stream_icon),
    containerExtension: extension,
    rating: asRating(value.rating),
    year: asYear(value.year) ?? asYear(value.release_date),
  };
}

function mapSeriesSummary(value: unknown): XuiSeriesSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asId(value.series_id);
  const name = asName(value.name) ?? asName(value.title);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    categoryId: asId(value.category_id),
    categoryIds: readCategoryIds(value),
    posterUrl: sanitizePublicUrl(value.cover),
    rating: asRating(value.rating),
    year: asYear(value.year) ?? asYear(value.release_date) ?? asYear(value.releaseDate),
  };
}

function mapEpg(value: unknown): XuiEpgEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = decodePossibleBase64(value.title);
  if (!title) {
    return null;
  }
  const id = asId(value.id) ?? asName(value.id) ?? title.slice(0, 40);
  return {
    id: id.slice(0, 64),
    title: title.slice(0, 200),
    description: decodePossibleBase64(value.description)?.slice(0, 500) ?? null,
    start: asName(value.start),
    end: asName(value.end),
  };
}

function readArray(payload: unknown): unknown[] {
  assertNotAuthFailure(payload);
  if (!Array.isArray(payload)) {
    throw invalid();
  }
  return payload;
}

function assertNotAuthFailure(payload: unknown): void {
  if (!isRecord(payload) || !('user_info' in payload)) {
    return;
  }
  const info = payload.user_info;
  if (isRecord(info) && Number(info.auth) !== 1) {
    throw new DomainError(ErrorCodes.upstreamAuth, 502, PublicMessages.upstreamAuth);
  }
}

function userInfo(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || !isRecord(payload.user_info)) {
    throw invalid();
  }
  return payload.user_info;
}

function uniqueById<T extends { id: string }>(
  values: unknown[],
  map: (value: unknown) => T | null,
): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const value of values) {
    const mapped = map(value);
    if (!mapped || seen.has(mapped.id)) {
      continue;
    }
    seen.add(mapped.id);
    items.push(mapped);
  }
  return items;
}

function extractHost(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) {
    return null;
  }
  if (value.includes('://')) {
    try {
      const url = new URL(value);
      if (url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        return null;
      }
      return url.hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  if (value.includes('/') || value.includes('@') || value.includes(' ')) {
    return null;
  }
  return value.toLowerCase();
}

function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^[0-9]{1,12}$/u.test(value)) {
    return value;
  }
  return null;
}

function asYear(value: unknown): string | null {
  if (typeof value === 'number' && value >= 1900 && value <= 2100) {
    return String(value);
  }
  if (typeof value === 'string') {
    const match = value.match(/\b(?:19|20)\d{2}\b/u);
    return match ? match[0] : null;
  }
  return null;
}

function asRating(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).slice(0, 16);
  }
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 16) : null;
}

function asExtension(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const extension = value.toLowerCase();
  return /^[a-z0-9]{2,5}$/u.test(extension) ? extension : null;
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.replace(/[\r\n\t]/gu, ' ').trim();
  if (text.length === 0) {
    return null;
  }
  return text.slice(0, max);
}

function asDuration(label: unknown, seconds: unknown): string | null {
  const text = asText(label, 32);
  if (text) {
    return text;
  }
  const numeric = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 86_400) {
    return null;
  }
  const total = Math.floor(numeric);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const clock = [minutes, rest].map((part) => String(part).padStart(2, '0')).join(':');
  return hours > 0 ? `${hours}:${clock}` : clock;
}

function readCategoryIds(value: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const primary = asId(value.category_id);
  if (primary) {
    ids.push(primary);
  }
  const extra = Array.isArray(value.category_ids)
    ? value.category_ids
    : typeof value.category_ids === 'string' && value.category_ids.startsWith('[')
      ? parseIdList(value.category_ids)
      : [];
  for (const item of extra) {
    const id = asId(item);
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

function parseIdList(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readEpisodes(value: unknown): XuiEpisode[] {
  if (!isRecord(value)) {
    return [];
  }
  const episodes: XuiEpisode[] = [];
  for (const [key, season] of Object.entries(value)) {
    if (!Array.isArray(season)) {
      continue;
    }
    const seasonNumber = asSeasonNumber(key);
    for (const entry of season) {
      const mapped = mapEpisode(entry, seasonNumber);
      if (mapped && !episodes.some((item) => item.id === mapped.id)) {
        episodes.push(mapped);
      }
    }
  }
  return episodes.sort(
    (left, right) =>
      left.seasonNumber - right.seasonNumber ||
      (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0),
  );
}

function mapEpisode(value: unknown, seasonFromKey: number | null): XuiEpisode | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asId(value.id) ?? asId(value.stream_id);
  const name = asName(value.title) ?? asName(value.name);
  const seasonNumber = asSeasonNumber(value.season) ?? seasonFromKey;
  if (!id || !name || seasonNumber === null) {
    return null;
  }
  const info = isRecord(value.info) ? value.info : {};
  const episodeNumber = asSeasonNumber(value.episode_num);
  return {
    id,
    seasonNumber,
    episodeNumber,
    name,
    plot: asText(info.plot, 2000),
    duration: asDuration(info.duration, info.duration_secs),
    posterUrl: sanitizePublicUrl(info.movie_image) ?? sanitizePublicUrl(info.cover_big),
    extension: asExtension(value.container_extension),
  };
}

function readSeasons(value: unknown, episodes: readonly XuiEpisode[]): XuiSeason[] {
  const seasons = new Map<number, XuiSeason>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isRecord(entry)) {
        continue;
      }
      const number = asSeasonNumber(entry.season_number);
      if (number === null || seasons.has(number)) {
        continue;
      }
      const counted = episodes.filter((episode) => episode.seasonNumber === number).length;
      seasons.set(number, {
        number,
        name: asName(entry.name) ?? seasonLabel(number),
        episodeCount:
          typeof entry.episode_count === 'number' && entry.episode_count >= 0
            ? entry.episode_count
            : counted,
        posterUrl: sanitizePublicUrl(entry.cover) ?? sanitizePublicUrl(entry.cover_big),
      });
    }
  }
  for (const episode of episodes) {
    if (seasons.has(episode.seasonNumber)) {
      continue;
    }
    seasons.set(episode.seasonNumber, {
      number: episode.seasonNumber,
      name: seasonLabel(episode.seasonNumber),
      episodeCount: episodes.filter((item) => item.seasonNumber === episode.seasonNumber).length,
      posterUrl: null,
    });
  }
  return [...seasons.values()].sort((left, right) => left.number - right.number);
}

function seasonLabel(number: number): string {
  return number === 0 ? 'Especiales' : `Temporada ${number}`;
}

function asSeasonNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 999) {
    return null;
  }
  return numeric;
}

function asName(value: unknown): string | null {
  return asText(value, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): DomainError {
  return new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
}
