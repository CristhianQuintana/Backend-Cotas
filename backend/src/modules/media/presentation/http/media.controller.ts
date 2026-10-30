import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../../../../common/decorators/public.decorator';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';

function signaturesEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Proxy firmado de iconos/pósters XUI. El móvil solo habla con la API COTAS;
   * el backend descarga desde hosts permitidos (p. ej. panel LAN).
   */
  @Public()
  @Get('asset')
  async asset(
    @Query('u') upstream: string | undefined,
    @Query('exp') expRaw: string | undefined,
    @Query('sig') signature: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!upstream || !expRaw || !signature) {
      throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
    }
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    const expected = signMedia(upstream, exp, this.config.jwtAccessSecret);
    if (!signaturesEqual(signature, expected)) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    let url: URL;
    try {
      url = new URL(upstream);
    } catch {
      throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
    }
    if (!this.config.xuiAllowedStreamHosts.includes(url.hostname)) {
      throw new DomainError(ErrorCodes.playbackRejected, 502, PublicMessages.playbackRejected);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.xuiTimeoutMs);
    try {
      const upstreamRes = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      if (!upstreamRes.ok || !upstreamRes.body) {
        throw new DomainError(
          ErrorCodes.dependencyUnavailable,
          502,
          PublicMessages.dependencyUnavailable,
        );
      }
      const contentType = upstreamRes.headers.get('content-type') ?? 'application/octet-stream';
      if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
        throw new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
      }
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      const buf = Buffer.from(await upstreamRes.arrayBuffer());
      if (buf.byteLength > 2_000_000) {
        throw new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
      }
      res.end(buf);
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(
        ErrorCodes.dependencyUnavailable,
        502,
        PublicMessages.dependencyUnavailable,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function signMedia(url: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${exp}.${url}`).digest('base64url');
}

export function buildSignedMediaUrl(input: {
  apiOrigin: string;
  apiPrefix: string;
  upstreamUrl: string;
  secret: string;
  ttlSeconds?: number;
}): string {
  const exp = Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 6 * 3600);
  const sig = signMedia(input.upstreamUrl, exp, input.secret);
  const u = encodeURIComponent(input.upstreamUrl);
  return `${input.apiOrigin}/${input.apiPrefix}/media/asset?u=${u}&exp=${exp}&sig=${sig}`;
}
