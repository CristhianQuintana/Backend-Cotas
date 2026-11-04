import { buildSignedMediaUrl } from './sign-media-url';

/**
 * Convierte iconos/pósters XUI (HTTP/LAN) en URL firmada del proxy público
 * `GET /api/v1/media/asset?...` para que el móvil solo hable con la API.
 */
export function toPublicMediaUrl(input: {
  raw: string | null | undefined;
  publicApiBase: string;
  secret: string;
  allowedHosts: readonly string[];
  ttlSeconds?: number;
}): string | null {
  const raw = input.raw?.trim();
  if (!raw) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.pathname.includes('/media/asset')) {
    return raw;
  }
  // Solo proxificar hosts XUI/LAN. CDN externos (p. ej. TMDB) van directos.
  if (!shouldProxyMediaHost(url.hostname, input.allowedHosts)) {
    return raw;
  }
  const { origin, prefix } = splitApiBase(input.publicApiBase);
  return buildSignedMediaUrl({
    apiOrigin: origin,
    apiPrefix: prefix,
    upstreamUrl: raw,
    secret: input.secret,
    ttlSeconds: input.ttlSeconds,
  });
}

export function mapPublicMediaFields<T extends Record<string, unknown>>(
  item: T,
  keys: readonly string[],
  ctx: {
    publicApiBase: string;
    secret: string;
    allowedHosts: readonly string[];
  },
): T {
  const next: Record<string, unknown> = { ...item };
  for (const key of keys) {
    if (!(key in next)) {
      continue;
    }
    const value = next[key];
    if (typeof value === 'string' || value === null || value === undefined) {
      next[key] = toPublicMediaUrl({
        raw: value as string | null | undefined,
        publicApiBase: ctx.publicApiBase,
        secret: ctx.secret,
        allowedHosts: ctx.allowedHosts,
      });
    }
  }
  return next as T;
}

export function shouldProxyMediaHost(hostname: string, allowedHosts: readonly string[]): boolean {
  if (allowedHosts.includes(hostname)) {
    return true;
  }
  // Iconos del panel suelen vivir en LAN aunque el allowlist de stream sea la IP pública.
  return isPrivateIpv4(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname)) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/u.test(hostname)) {
    return true;
  }
  const m = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(hostname);
  if (!m) {
    return false;
  }
  const second = Number(m[1]);
  return second >= 16 && second <= 31;
}

function splitApiBase(publicApiBase: string): { origin: string; prefix: string } {
  const trimmed = publicApiBase.replace(/\/+$/u, '');
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/^\/+|\/+$/gu, '');
    return {
      origin: `${parsed.protocol}//${parsed.host}`,
      prefix: path.length > 0 ? path : 'api/v1',
    };
  } catch {
    return { origin: trimmed, prefix: 'api/v1' };
  }
}
