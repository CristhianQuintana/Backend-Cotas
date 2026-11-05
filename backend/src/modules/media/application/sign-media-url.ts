import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function signMedia(url: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${exp}.${url}`).digest('base64url');
}

/** TTL por defecto 24 h: permite caché de TV/CDN sin regenerar `sig` en cada listado. */
export const DEFAULT_MEDIA_ASSET_TTL_SECONDS = 86_400;

/**
 * Firma estable dentro de una ventana de TTL: todos los listados en la misma
 * ventana comparten `exp`/`sig` → el cliente puede reutilizar disco/CDN.
 */
export function mediaExpiryUnix(
  ttlSeconds = DEFAULT_MEDIA_ASSET_TTL_SECONDS,
  nowMs = Date.now(),
): number {
  const ttl = Math.max(60, Math.min(ttlSeconds, 7 * 86_400));
  const now = Math.floor(nowMs / 1000);
  const windowStart = Math.floor(now / ttl) * ttl;
  return windowStart + ttl;
}

export function buildSignedMediaUrl(input: {
  apiOrigin: string;
  apiPrefix: string;
  upstreamUrl: string;
  secret: string;
  ttlSeconds?: number;
}): string {
  const exp = mediaExpiryUnix(input.ttlSeconds ?? DEFAULT_MEDIA_ASSET_TTL_SECONDS);
  const sig = signMedia(input.upstreamUrl, exp, input.secret);
  const u = encodeURIComponent(input.upstreamUrl);
  return `${input.apiOrigin}/${input.apiPrefix}/media/asset?u=${u}&exp=${exp}&sig=${sig}`;
}

export function signaturesEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
