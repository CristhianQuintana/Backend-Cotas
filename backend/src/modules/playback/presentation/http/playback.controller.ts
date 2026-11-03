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
import type { AuthenticatedUser } from '../../../identity/domain/models/authenticated-user';
import { AuthorizePlaybackUseCase } from '../../application/authorize-playback.use-case';
import { PlaybackMediaTicketStore } from '../../infrastructure/playback-media-ticket.store';
import { rewritePlaylistForProxy } from '../../infrastructure/resolve-stream-upstream';
import { AuthorizePlaybackDto } from './dto/authorize-playback.dto';

@ApiTags('playback')
@Controller('playback')
export class PlaybackController {
  constructor(
    @Inject(AuthorizePlaybackUseCase) private readonly authorizePlayback: AuthorizePlaybackUseCase,
    @Inject(PlaybackMediaTicketStore) private readonly tickets: PlaybackMediaTicketStore,
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
   * Proxy de media para clientes en la misma LAN.
   * El ticket es opaco y de corta vida; el player no envía JWT en segmentos HLS.
   */
  @Public()
  @Get('media/:ticketId')
  proxyPlaylist(@Param('ticketId') ticketId: string, @Req() req: Request, @Res() res: Response) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new NotFoundException();
    }
    return pipeUpstream({
      ticketId,
      upstreamUrl: ticket.upstreamUrl,
      req,
      res,
      publicApiBase: publicApiBaseFromRequest(req),
      rewritePlaylist: ticket.protocolHint === 'hls',
    });
  }

  @Public()
  @Get('media/:ticketId/u/{*path}')
  proxySegment(@Param('ticketId') ticketId: string, @Req() req: Request, @Res() res: Response) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new NotFoundException();
    }
    // No confiar solo en @Param('path'): con tokens HLS largos el wildcard
    // a veces llega incompleto y el upstream responde 404.
    const relative = segmentPathFromRequest(req, ticketId);
    if (!relative) {
      throw new NotFoundException();
    }
    const upstreamUrl = `${ticket.upstreamOrigin}/${relative}`;
    return pipeUpstream({
      ticketId,
      upstreamUrl,
      req,
      res,
      publicApiBase: publicApiBaseFromRequest(req),
      rewritePlaylist: false,
    });
  }
}

function segmentPathFromRequest(req: Request, ticketId: string): string | null {
  const marker = `/playback/media/${ticketId}/u/`;
  const full = req.originalUrl || req.url || '';
  const at = full.indexOf(marker);
  if (at < 0) {
    return null;
  }
  const rest = full.slice(at + marker.length);
  const pathOnly = rest.split('?')[0] || '';
  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    decoded = pathOnly;
  }
  const relative = decoded.replace(/^\/+/u, '');
  return relative || null;
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
}): void {
  let upstream: URL;
  try {
    upstream = new URL(input.upstreamUrl);
  } catch {
    input.res.status(502).end();
    return;
  }
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    input.res.status(502).end();
    return;
  }
  const lib = upstream.protocol === 'https:' ? https : http;
  const headers: Record<string, string> = {
    'User-Agent': 'COTAS-Playback-Proxy/1.0',
    Accept: input.req.headers.accept || '*/*',
    Connection: 'close',
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
      timeout: 30000,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode ?? 502;
      if (status >= 300 && status < 400 && proxyRes.headers.location) {
        // Seguir un redirect adicional del origen
        proxyRes.resume();
        pipeUpstream({
          ...input,
          upstreamUrl: new URL(proxyRes.headers.location, upstream).toString(),
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
    },
  );
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!input.res.headersSent) {
      input.res.status(504).end();
    }
  });
  proxyReq.on('error', () => {
    if (!input.res.headersSent) {
      input.res.status(502).end();
    }
  });
  proxyReq.end();
}
