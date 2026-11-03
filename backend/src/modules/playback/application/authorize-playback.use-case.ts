import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RequestMeta } from '../../../common/logging/request-meta';
import { DomainError, ErrorCodes, PublicMessages } from '../../../common/exceptions/domain-error';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { AUDIT_REPOSITORY, type AuditRepository } from '../../audit/domain/audit-repository';
import { XUI_CLIENT, type XuiClient } from '../../integrations/xui/domain/models';
import type { AuthenticatedUser } from '../../identity/domain/models/authenticated-user';
import { LINE_ACCESS, type LineAccess } from '../../identity/domain/ports/identity.ports';
import {
  buildPlaybackReference,
  playbackLogFields,
  type PlaybackReference,
} from '../domain/playback-reference';
import { PlaybackMediaTicketStore } from '../infrastructure/playback-media-ticket.store';
import { resolveStreamUpstream } from '../infrastructure/resolve-stream-upstream';

@Injectable()
export class AuthorizePlaybackUseCase {
  private readonly logger = new Logger(AuthorizePlaybackUseCase.name);

  constructor(
    @Inject(XUI_CLIENT) private readonly xui: XuiClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(PlaybackMediaTicketStore) private readonly tickets: PlaybackMediaTicketStore,
  ) {}

  async execute(
    user: AuthenticatedUser,
    input: {
      contentType: 'live' | 'vod' | 'series';
      streamId: string;
      seriesId?: string;
      seasonNumber?: number;
      publicApiBase: string;
    },
    meta: RequestMeta,
  ): Promise<PlaybackReference> {
    const credentials = await this.lines.credentialsFor(user.id);
    const selected = await this.select(input, credentials);
    if (!selected) {
      await this.audit.record({
        action: 'playback.authorize',
        result: 'failure',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
        metadata: {
          contentType: input.contentType,
          streamId: input.streamId,
          reason: 'not_found',
        },
      });
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.contentNotFound);
    }
    const server = await this.xui.getServerInfo(credentials);
    const reference = buildPlaybackReference({
      contentType: input.contentType,
      streamId: selected.id,
      title: selected.name,
      server,
      allowedHosts: this.config.xuiAllowedStreamHosts,
      username: credentials.username,
      password: credentials.password,
      containerExtension: selected.containerExtension,
    });

    let proxied: PlaybackReference = reference;
    try {
      const lanHost = lanHostFromBase(this.config.xuiBaseUrl);
      // En test no hay XUI real: el ticket apunta a la URL construida.
      const upstream =
        this.config.nodeEnv === 'test'
          ? reference.streamUrl
          : await resolveStreamUpstream(reference.streamUrl, lanHost);
      const ticket = this.tickets.issue({
        upstreamUrl: upstream,
        protocolHint: reference.protocolHint,
      });
      proxied = {
        ...reference,
        // Los clientes de la LAN no alcanzan el IP público de XUI; el API sí.
        // Se mantiene delivery=direct porque las apps lo validan así.
        streamUrl: `${trimSlash(input.publicApiBase)}/playback/media/${ticket.id}`,
      };
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          action: 'playback.authorize_proxy',
          outcome: 'upstream_resolve_failed',
          contentType: reference.contentType,
          streamId: reference.streamId,
          message: error instanceof Error ? error.message : 'unknown',
        }),
      );
      throw new DomainError(ErrorCodes.playbackRejected, 502, PublicMessages.playbackRejected);
    }

    this.logger.log(
      JSON.stringify({
        action: 'playback.authorize',
        ...playbackLogFields(proxied),
        actorUserId: user.id,
        deliveryMode: 'lan_proxy',
      }),
    );
    await this.audit.record({
      action: 'playback.authorize',
      result: 'success',
      actorUserId: user.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: {
        ...playbackLogFields(proxied),
        deliveryMode: 'lan_proxy',
      },
    });
    return proxied;
  }

  private async select(
    input: {
      contentType: 'live' | 'vod' | 'series';
      streamId: string;
      seriesId?: string;
      seasonNumber?: number;
    },
    credentials: { username: string; password: string },
  ): Promise<{ id: string; name: string; containerExtension: string | null } | null> {
    if (input.contentType === 'live') {
      const stream = (await this.xui.getLiveStreams(credentials)).find(
        (item) => item.id === input.streamId,
      );
      return stream ? { id: stream.id, name: stream.name, containerExtension: null } : null;
    }
    if (input.contentType === 'vod') {
      const stream = (await this.xui.getVodStreams(credentials)).find(
        (item) => item.id === input.streamId,
      );
      return stream
        ? { id: stream.id, name: stream.name, containerExtension: stream.containerExtension }
        : null;
    }
    if (!input.seriesId) {
      throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
    }
    const series = await this.xui.getSeriesInfo(input.seriesId, credentials);
    const episode = series.episodes.find(
      (item) =>
        item.id === input.streamId &&
        (input.seasonNumber === undefined || item.seasonNumber === input.seasonNumber),
    );
    return episode
      ? { id: episode.id, name: episode.name, containerExtension: episode.extension }
      : null;
  }
}

function lanHostFromBase(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname || null;
  } catch {
    return null;
  }
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
