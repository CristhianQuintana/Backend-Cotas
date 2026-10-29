import type {
  XuiCategory,
  XuiClient,
  XuiCredentials,
  XuiEpgEntry,
  XuiLineStatus,
  XuiLiveStream,
  XuiSeriesDetails,
  XuiSeriesSummary,
  XuiServerInfo,
  XuiVodDetails,
  XuiVodStream,
} from '../../src/modules/integrations/xui/domain/models';
import { DomainError, ErrorCodes, PublicMessages } from '../../src/common/exceptions/domain-error';

export class FakeXui implements XuiClient {
  line: XuiLineStatus = { authenticated: true, status: 'Active' };
  readonly lines = new Map<string, string>();
  liveCategories: XuiCategory[] = [];
  liveStreams: XuiLiveStream[] = [];
  vodCategories: XuiCategory[] = [];
  vodStreams: XuiVodStream[] = [];
  vodDetails = new Map<string, XuiVodDetails>();
  seriesCategories: XuiCategory[] = [];
  series: XuiSeriesSummary[] = [];
  seriesDetails = new Map<string, XuiSeriesDetails>();
  epg = new Map<string, XuiEpgEntry[]>();
  server: XuiServerInfo = { protocol: 'http', host: 'stream.test.local', port: '80' };
  error: Error | null = null;

  authenticate(credentials: XuiCredentials): Promise<XuiLineStatus> {
    const expected = this.lines.get(credentials.username);
    const ok = expected !== undefined && expected === credentials.password;
    return this.answer({ authenticated: ok, status: ok ? 'Active' : 'Disabled' });
  }

  getLineStatus(): Promise<XuiLineStatus> {
    return this.answer(this.line);
  }

  getLiveCategories(): Promise<XuiCategory[]> {
    return this.answer(this.liveCategories);
  }

  getLiveStreams(): Promise<XuiLiveStream[]> {
    return this.answer(this.liveStreams);
  }

  getVodCategories(): Promise<XuiCategory[]> {
    return this.answer(this.vodCategories);
  }

  getVodStreams(): Promise<XuiVodStream[]> {
    return this.answer(this.vodStreams);
  }

  getVodInfo(vodId: string): Promise<XuiVodDetails> {
    const details = this.vodDetails.get(vodId);
    if (!details) {
      return Promise.reject(
        new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound),
      );
    }
    return this.answer(details);
  }

  getSeriesCategories(): Promise<XuiCategory[]> {
    return this.answer(this.seriesCategories);
  }

  getSeries(): Promise<XuiSeriesSummary[]> {
    return this.answer(this.series);
  }

  getSeriesInfo(seriesId: string): Promise<XuiSeriesDetails> {
    const details = this.seriesDetails.get(seriesId);
    if (!details) {
      return Promise.reject(
        new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound),
      );
    }
    return this.answer(details);
  }

  getShortEpg(
    streamId: string,
    _credentials?: XuiCredentials,
    options?: { limit?: number },
  ): Promise<XuiEpgEntry[]> {
    const items = this.epg.get(streamId) ?? [];
    const limit = options?.limit;
    if (limit === undefined) {
      return this.answer(items);
    }
    return this.answer(items.slice(0, Math.max(1, Math.min(limit, 50))));
  }

  getServerInfo(): Promise<XuiServerInfo> {
    return this.answer(this.server);
  }

  private async answer<T>(value: T): Promise<T> {
    if (this.error) {
      throw this.error;
    }
    return value;
  }
}
