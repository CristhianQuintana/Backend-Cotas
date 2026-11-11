import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import http from 'node:http';
import https from 'node:https';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Public } from '../../../../common/decorators/public.decorator';
import { SensitiveRateLimitGuard } from '../../../../common/guards/sensitive-rate-limit.guard';
import { requestMeta } from '../../../../common/logging/request-meta';
import { isAllowedUpstreamUrl } from '../../../../common/utils/allowed-upstream-host';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';
import type { AuthenticatedUser } from '../../../identity/domain/models/authenticated-user';
import { AuthorizePlaybackUseCase } from '../../application/authorize-playback.use-case';
import { PlaybackMediaTicketStore } from '../../infrastructure/playback-media-ticket.store';
import { rewritePlaylistForProxy } from '../../infrastructure/resolve-stream-upstream';
import { AuthorizePlaybackDto } from './dto/authorize-playback.dto';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });

@ApiTags('playback')
@Controller('playback')
export class PlaybackController {
  private activeProxies = 0;

  constructor(
    @Inject(AuthorizePlaybackUseCase) private readonly authorizePlayback: AuthorizePlaybackUseCase,
    @Inject(PlaybackMediaTicketStore) private readonly tickets: PlaybackMediaTicketStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @ApiBearerAuth()
  @UseGuards(SensitiveRateLimitGuard)
  @HttpCode(200)
  @Post('authorizations')
  authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AuthorizePlaybackDto,
    @Req() req: Request,
  ) {
    return this.authorizePlayback.execute(
      user,
      {
        contentType: body.contentType,
        streamId: body.streamId,
        seriesId: body.seriesId,
        seasonNumber: body.seasonNumber,
        publicApiBase: publicApiBaseFromRequest(req),
      },
      requestMeta(req),
    );
  }

  /**
   * Proxy de media: ticket opaco de corta vida (Redis cuando está habilitado).
   */
  @Public()
  @Get('media/:ticketId')
  async proxyPlaylist(
    @Param('ticketId') ticketId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ticket = await this.tickets.get(ticketId);
    if (!ticket) {
      throw new NotFoundException();
    }
    this.acquireProxySlot();
    return pipeUpstream({
      ticketId,
      upstreamUrl: ticket.upstreamUrl,
      req,
      res,
      publicApiBase: publicApiBaseFromRequest(req),
      rewritePlaylist: ticket.protocolHint === 'hls',
      allowedHosts: this.config.xuiAllowedStreamHosts,
      onDone: () => this.releaseProxySlot(),
    });
  }

  @Public()
  @Get('media/:ticketId/seg')
  async proxySegment(
    @Param('ticketId') ticketId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ticket = await this.tickets.get(ticketId);
    if (!ticket) {
      throw new NotFoundException();
    }
    const raw = typeof req.query.p === 'string' ? req.query.p : '';
    let path = raw;
    try {
      path = decodeURIComponent(raw);
    } catch {
      path = raw;
    }
    if (
      !path.startsWith('/') ||
      path.includes('://') ||
      path.includes('\\') ||
      path.includes('..')
    ) {
      throw new NotFoundException();
    }
    const upstreamUrl = `${ticket.upstreamOrigin}${path}`;
    this.acquireProxySlot();
    return pipeUpstream({
      ticketId,
      upstreamUrl,
      req,
      res,
      publicApiBase: publicApiBaseFromRequest(req),
      rewritePlaylist: false,
      allowedHosts: this.config.xuiAllowedStreamHosts,
      onDone: () => this.releaseProxySlot(),
    });
  }

  private acquireProxySlot(): void {
    if (this.activeProxies >= this.config.playbackProxyMaxConcurrent) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'PLAYBACK_PROXY_SATURATED',
        message: 'El proxy de reproducción está saturado. Reintente en unos segundos.',
      });
    }
    this.activeProxies += 1;
  }

  private releaseProxySlot(): void {
    this.activeProxies = Math.max(0, this.activeProxies - 1);
  }
}

function publicApiBaseFromRequest(req: Request): string {
  const host = req.get('host') || '127.0.0.1';
  const protoHeader = req.get('x-forwarded-proto');
  const protocol =
    protoHeader === 'https' || protoHeader === 'http'
      ? protoHeader
      : req.protocol === 'https'
        ? 'https'
        : 'http';
  const prefix = (req.baseUrl || '').split('/playback')[0] || '/api/v1';
  return `${protocol}://${host}${prefix}`;
}

function pipeUpstream(input: {
  ticketId: string;
  upstreamUrl: string;
  req: Request;
  res: Response;
  publicApiBase: string;
  rewritePlaylist: boolean;
  allowedHosts: readonly string[];
  onDone: () => void;
  hop?: number;
}): void {
  const hop = input.hop ?? 0;
  let finished = false;
  const done = () => {
    if (finished) {
      return;
    }
    finished = true;
    input.onDone();
  };
  input.res.on('close', done);

  let upstream: URL;
  try {
    upstream = new URL(input.upstreamUrl);
  } catch {
    done();
    input.res.status(502).end();
    return;
  }
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    done();
    input.res.status(502).end();
    return;
  }
  if (!isAllowedUpstreamUrl(upstream, input.allowedHosts)) {
    done();
    input.res.status(502).end();
    return;
  }
  if (hop > 5) {
    done();
    input.res.status(502).end();
    return;
  }

  const lib = upstream.protocol === 'https:' ? https : http;
  const agent = upstream.protocol === 'https:' ? httpsAgent : httpAgent;
  const headers: Record<string, string> = {
    'User-Agent': 'COTAS-Playback-Proxy/1.0',
    Accept: input.req.headers.accept || '*/*',
  };
  if (typeof input.req.headers.range === 'string') {
    headers.Range = input.req.headers.range;
  }
  const proxyReq = lib.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      path: `${upstream.pathname}${upstream.search}`,
      method: 'GET',
      headers,
      agent,
      timeout: 30000,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode ?? 502;
      if (status >= 300 && status < 400 && proxyRes.headers.location) {
        proxyRes.resume();
        const next = new URL(proxyRes.headers.location, upstream);
        // Solo seguir si el destino sigue en allowlist; si no, reescribir al host del ticket.
        if (!isAllowedUpstreamUrl(next, input.allowedHosts)) {
          next.protocol = upstream.protocol;
          next.host = upstream.host;
        }
        if (!isAllowedUpstreamUrl(next, input.allowedHosts)) {
          done();
          if (!input.res.headersSent) {
            input.res.status(502).end();
          }
          return;
        }
        pipeUpstream({
          ...input,
          upstreamUrl: next.toString(),
          hop: hop + 1,
          onDone: done,
        });
        return;
      }
      const contentType = String(proxyRes.headers['content-type'] || '');
      const isPlaylist =
        input.rewritePlaylist ||
        contentType.includes('mpegurl') ||
        contentType.includes('m3u8') ||
        upstream.pathname.endsWith('.m3u8');
      if (isPlaylist && status >= 200 && status < 300) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        proxyRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const rewritten = rewritePlaylistForProxy({
            body: raw,
            playlistUrl: upstream.toString(),
            ticketId: input.ticketId,
            publicApiBase: input.publicApiBase,
          });
          input.res.status(status);
          input.res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          input.res.setHeader('Cache-Control', 'no-store');
          input.res.send(rewritten);
          done();
        });
        proxyRes.on('error', () => {
          done();
          if (!input.res.headersSent) {
            input.res.status(502).end();
          }
        });
        return;
      }
      input.res.status(status);
      const passHeaders = [
        'content-type',
        'content-length',
        'accept-ranges',
        'content-range',
        'cache-control',
      ];
      for (const name of passHeaders) {
        const value = proxyRes.headers[name];
        if (typeof value === 'string') {
          input.res.setHeader(name, value);
        }
      }
      input.res.setHeader('Cache-Control', 'no-store');
      proxyRes.pipe(input.res);
      proxyRes.on('end', done);
      proxyRes.on('error', done);
    },
  );
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    done();
    if (!input.res.headersSent) {
      input.res.status(504).end();
    }
  });
  proxyReq.on('error', () => {
    done();
    if (!input.res.headersSent) {
      input.res.status(502).end();
    }
  });
  proxyReq.end();
}
