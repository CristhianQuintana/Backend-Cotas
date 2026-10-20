import { DomainError, ErrorCodes, PublicMessages } from '../../../common/exceptions/domain-error';
import type { XuiServerInfo } from '../../integrations/xui/domain/models';

export interface PlaybackReference {
  contentType: 'live' | 'vod' | 'series';
  streamId: string;
  title: string;
  delivery: 'direct';
  protocolHint: 'hls' | 'progressive';
  streamUrl: string;
  expiresAt: null;
  accessMaterialEmbedded: true;
}

export function buildPlaybackReference(input: {
  contentType: 'live' | 'vod' | 'series';
  streamId: string;
  title: string;
  server: XuiServerInfo;
  allowedHosts: readonly string[];
  username: string;
  password: string;
  containerExtension?: string | null;
}): PlaybackReference {
  if (!input.allowedHosts.includes(input.server.host)) {
    throw new DomainError(ErrorCodes.playbackRejected, 502, PublicMessages.playbackRejected);
  }
  if (!/^[0-9]{1,12}$/u.test(input.streamId)) {
    throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
  }
  const user = encodeURIComponent(input.username);
  const password = encodeURIComponent(input.password);
  const base = `${input.server.protocol}://${input.server.host}:${input.server.port}`;
  if (input.contentType === 'live') {
    return {
      contentType: 'live',
      streamId: input.streamId,
      title: input.title,
      delivery: 'direct',
      protocolHint: 'hls',
      streamUrl: `${base}/live/${user}/${password}/${input.streamId}.m3u8`,
      expiresAt: null,
      accessMaterialEmbedded: true,
    };
  }
  const extension = input.containerExtension ?? '';
  if (!/^[a-z0-9]{2,5}$/u.test(extension)) {
    throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
  }
  const folder = input.contentType === 'series' ? 'series' : 'movie';
  return {
    contentType: input.contentType,
    streamId: input.streamId,
    title: input.title,
    delivery: 'direct',
    protocolHint: extension === 'm3u8' ? 'hls' : 'progressive',
    streamUrl: `${base}/${folder}/${user}/${password}/${input.streamId}.${extension}`,
    expiresAt: null,
    accessMaterialEmbedded: true,
  };
}

export function playbackLogFields(reference: Pick<PlaybackReference, 'contentType' | 'streamId'>): {
  contentType: string;
  streamId: string;
} {
  return { contentType: reference.contentType, streamId: reference.streamId };
}
