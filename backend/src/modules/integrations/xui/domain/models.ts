export interface XuiCategory {
  id: string;
  name: string;
  parentId: string | null;
}

export interface XuiLiveStream {
  id: string;
  name: string;
  categoryId: string | null;
  iconUrl: string | null;
  epgChannelId: string | null;
}

export interface XuiVodStream {
  id: string;
  name: string;
  categoryId: string | null;
  categoryIds: string[];
  iconUrl: string | null;
  containerExtension: string | null;
  rating: string | null;
  year: string | null;
}

export interface XuiVodDetails {
  id: string;
  name: string;
  categoryIds: string[];
  posterUrl: string | null;
  plot: string | null;
  year: string | null;
  duration: string | null;
  genre: string | null;
  cast: string | null;
  director: string | null;
  rating: string | null;
  extension: string | null;
}

export interface XuiSeriesSummary {
  id: string;
  name: string;
  categoryId: string | null;
  categoryIds: string[];
  posterUrl: string | null;
  rating: string | null;
  year: string | null;
}

export interface XuiSeason {
  number: number;
  name: string;
  episodeCount: number;
  posterUrl: string | null;
}

export interface XuiEpisode {
  id: string;
  seasonNumber: number;
  episodeNumber: number | null;
  name: string;
  plot: string | null;
  duration: string | null;
  posterUrl: string | null;
  extension: string | null;
}

export interface XuiSeriesDetails {
  id: string;
  name: string;
  categoryIds: string[];
  posterUrl: string | null;
  plot: string | null;
  year: string | null;
  rating: string | null;
  genre: string | null;
  cast: string | null;
  director: string | null;
  seasons: XuiSeason[];
  episodes: XuiEpisode[];
}

export interface XuiEpgEntry {
  id: string;
  title: string;
  description: string | null;
  start: string | null;
  end: string | null;
}

export interface XuiLineStatus {
  authenticated: boolean;
  status: string | null;
}

export interface XuiServerInfo {
  protocol: 'http' | 'https';
  host: string;
  port: string;
}

export interface XuiCredentials {
  username: string;
  password: string;
}

export const XUI_CLIENT = Symbol('XUI_CLIENT');

export interface XuiClient {
  authenticate(credentials: XuiCredentials): Promise<XuiLineStatus>;
  getLineStatus(credentials?: XuiCredentials): Promise<XuiLineStatus>;
  getLiveCategories(credentials?: XuiCredentials): Promise<XuiCategory[]>;
  getLiveStreams(credentials?: XuiCredentials): Promise<XuiLiveStream[]>;
  getVodCategories(credentials?: XuiCredentials): Promise<XuiCategory[]>;
  getVodStreams(credentials?: XuiCredentials): Promise<XuiVodStream[]>;
  getVodInfo(vodId: string, credentials?: XuiCredentials): Promise<XuiVodDetails>;
  getSeriesCategories(credentials?: XuiCredentials): Promise<XuiCategory[]>;
  getSeries(credentials?: XuiCredentials): Promise<XuiSeriesSummary[]>;
  getSeriesInfo(seriesId: string, credentials?: XuiCredentials): Promise<XuiSeriesDetails>;
  getShortEpg(streamId: string, credentials?: XuiCredentials): Promise<XuiEpgEntry[]>;
  getServerInfo(credentials?: XuiCredentials): Promise<XuiServerInfo>;
}
