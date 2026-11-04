export interface XuiCategory {
  id: string;
  name: string;
  parentId: string | null;
}

export interface XuiLiveStream {
  id: string;
  name: string;
  categoryId: string | null;
  /** Logo del canal (compat). */
  iconUrl: string | null;
  /** Mismo archivo que iconUrl; contrato unificado póster/logo. */
  posterUrl: string | null;
  /** Los canales no tienen backdrop en XUI. */
  backdropUrl: null;
  epgChannelId: string | null;
}

export interface XuiVodStream {
  id: string;
  name: string;
  categoryId: string | null;
  categoryIds: string[];
  iconUrl: string | null;
  posterUrl: string | null;
  /** El listado XUI no trae fondo; solo el detalle. */
  backdropUrl: null;
  containerExtension: string | null;
  rating: string | null;
  year: string | null;
}

export interface XuiVodDetails {
  id: string;
  name: string;
  categoryIds: string[];
  posterUrl: string | null;
  /** Fondo ancho; null si XUI no lo tiene o coincide con el póster. */
  backdropUrl: string | null;
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
  backdropUrl: null;
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
  backdropUrl: string | null;
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
  /** Hora de inicio tal como la entrega XUI (texto o vacío). */
  start: string | null;
  /** Hora de fin tal como la entrega XUI (texto o vacío). */
  end: string | null;
  /** Inicio en ISO-8601 UTC cuando se puede derivar; si no, null. */
  startAt: string | null;
  /** Fin en ISO-8601 UTC cuando se puede derivar; si no, null. */
  endAt: string | null;
}

export interface XuiLineStatus {
  authenticated: boolean;
  status: string | null;
  username: string | null;
  /** Nombre visible del abonado (XUI); si no hay otro campo, suele ser el username. */
  displayName: string | null;
  expiresAt: string | null;
  maxConnections: number | null;
  activeConnections: number | null;
  isTrial: boolean | null;
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
  getShortEpg(
    streamId: string,
    credentials?: XuiCredentials,
    options?: { limit?: number },
  ): Promise<XuiEpgEntry[]>;
  getServerInfo(credentials?: XuiCredentials): Promise<XuiServerInfo>;
}
