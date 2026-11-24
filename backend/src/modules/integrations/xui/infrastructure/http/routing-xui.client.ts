import type {
  XuiClient,
  XuiCredentials,
  XuiCategory,
  XuiLiveStream,
  XuiVodStream,
  XuiVodDetails,
  XuiSeriesSummary,
  XuiSeriesDetails,
  XuiLineStatus,
  XuiEpgEntry,
  XuiServerInfo,
} from '../../domain/models';

/**
 * Enruta cada llamada al XUI primario o al XUI demo según el username de la línea.
 * Sin credenciales de abonado (sync/admin) siempre usa el primario.
 */
export class RoutingXuiClient implements XuiClient {
  constructor(
    private readonly primary: XuiClient,
    private readonly demo: XuiClient | null,
    private readonly demoUsername: string | null,
  ) {}

  private pick(credentials?: XuiCredentials): XuiClient {
    if (
      this.demo &&
      this.demoUsername &&
      credentials &&
      credentials.username === this.demoUsername
    ) {
      return this.demo;
    }
    return this.primary;
  }

  authenticate(credentials: XuiCredentials): Promise<XuiLineStatus> {
    return this.pick(credentials).authenticate(credentials);
  }

  getLineStatus(credentials?: XuiCredentials): Promise<XuiLineStatus> {
    return this.pick(credentials).getLineStatus(credentials);
  }

  getLiveCategories(credentials?: XuiCredentials): Promise<XuiCategory[]> {
    return this.pick(credentials).getLiveCategories(credentials);
  }

  getLiveStreams(credentials?: XuiCredentials): Promise<XuiLiveStream[]> {
    return this.pick(credentials).getLiveStreams(credentials);
  }

  getVodCategories(credentials?: XuiCredentials): Promise<XuiCategory[]> {
    return this.pick(credentials).getVodCategories(credentials);
  }

  getVodStreams(credentials?: XuiCredentials): Promise<XuiVodStream[]> {
    return this.pick(credentials).getVodStreams(credentials);
  }

  getVodInfo(vodId: string, credentials?: XuiCredentials): Promise<XuiVodDetails> {
    return this.pick(credentials).getVodInfo(vodId, credentials);
  }

  getSeriesCategories(credentials?: XuiCredentials): Promise<XuiCategory[]> {
    return this.pick(credentials).getSeriesCategories(credentials);
  }

  getSeries(credentials?: XuiCredentials): Promise<XuiSeriesSummary[]> {
    return this.pick(credentials).getSeries(credentials);
  }

  getSeriesInfo(seriesId: string, credentials?: XuiCredentials): Promise<XuiSeriesDetails> {
    return this.pick(credentials).getSeriesInfo(seriesId, credentials);
  }

  getShortEpg(
    streamId: string,
    credentials?: XuiCredentials,
    options?: { limit?: number },
  ): Promise<XuiEpgEntry[]> {
    return this.pick(credentials).getShortEpg(streamId, credentials, options);
  }

  getServerInfo(credentials?: XuiCredentials): Promise<XuiServerInfo> {
    return this.pick(credentials).getServerInfo(credentials);
  }
}
