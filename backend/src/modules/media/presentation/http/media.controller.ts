import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../../../common/decorators/public.decorator';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import {
  isAllowedUpstreamHost,
  isAllowedUpstreamUrl,
} from '../../../../common/utils/allowed-upstream-host';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';
import { shouldProxyMediaHost } from '../../application/public-media-url';
import { buildSignedMediaUrl, signMedia, signaturesEqual } from '../../application/sign-media-url';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Proxy firmado de iconos/pósters XUI. Cada redirect se revalida contra allowlist.
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
    if (!isAllowedMediaUpstream(url.hostname, this.config.xuiAllowedStreamHosts)) {
      throw new DomainError(ErrorCodes.playbackRejected, 502, PublicMessages.playbackRejected);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.xuiTimeoutMs);
    try {
      const upstreamRes = await fetchAllowed(
        url,
        this.config.xuiAllowedStreamHosts,
        controller.signal,
      );
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
      const remainingSec = Math.max(60, Math.floor(exp - Date.now() / 1000));
      res.setHeader(
        'Cache-Control',
        `public, max-age=${Math.min(remainingSec, 86_400)}, stale-while-revalidate=604800`,
      );
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

async function fetchAllowed(
  start: URL,
  allowedHosts: readonly string[],
  signal: AbortSignal,
): Promise<globalThis.Response> {
  let current = start;
  // The initial private XUI image host is trusted only for this exact origin.
  // Redirects to other private addresses require an explicit allowlist entry.
  const trustedPrivateOrigin =
    shouldProxyMediaHost(start.hostname, allowedHosts) &&
    !isAllowedUpstreamHost(start.hostname, allowedHosts) &&
    !isAllowedUpstreamUrl(start, allowedHosts)
      ? start.origin
      : null;
  for (let hop = 0; hop < 5; hop += 1) {
    if (!isAllowedUpstreamUrl(current, allowedHosts) && current.origin !== trustedPrivateOrigin) {
      throw new DomainError(ErrorCodes.playbackRejected, 502, PublicMessages.playbackRejected);
    }
    const response = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
      }
      await response.body?.cancel();
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new DomainError(ErrorCodes.upstreamInvalid, 502, PublicMessages.upstreamInvalid);
}

function isAllowedMediaUpstream(hostname: string, allowedHosts: readonly string[]): boolean {
  return shouldProxyMediaHost(hostname, allowedHosts);
}

export { buildSignedMediaUrl, signMedia };
