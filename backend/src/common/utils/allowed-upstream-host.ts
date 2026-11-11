/**
 * Valida hosts de media/playback.
 * Solo permite hostnames/IPs presentes en la allowlist de XUI (LAN autorizada).
 * No abre Internet arbitrario; permite únicamente destinos internos
 * explícitamente autorizados mediante configuración.
 */
export function isAllowedUpstreamHost(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '');
  if (!host) {
    return false;
  }
  const allowed = new Set(allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean));
  if (allowed.has(host)) {
    return true;
  }
  // Permitir coincidencia hostname:port en allowlist reducida a hostname.
  for (const entry of allowed) {
    if (entry.includes(':') && entry.split(':')[0] === host) {
      return true;
    }
  }
  return false;
}

export function assertAllowedUpstreamUrl(rawUrl: string, allowedHosts: readonly string[]): URL {
  const url = new URL(rawUrl);
  if (!isAllowedUpstreamUrl(url, allowedHosts)) {
    throw new Error('upstream_denied');
  }
  return url;
}

export function isAllowedUpstreamUrl(
  value: URL | string,
  allowedHosts: readonly string[],
): boolean {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return false;
  }
  const hostname = normalizeHostname(url.hostname);
  const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80');
  return allowedHosts.some((entry) => {
    const allowed = parseAllowedHost(entry);
    if (!allowed || allowed.hostname !== hostname) {
      return false;
    }
    // A bare hostname grants standard HTTP(S) only. Any other port, including
    // a port explicitly listed for this host, must match exactly.
    if (allowed.port === null) {
      return effectivePort === (url.protocol === 'https:' ? '443' : '80');
    }
    return allowed.port === effectivePort;
  });
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '');
}

function parseAllowedHost(value: string): { hostname: string; port: string | null } | null {
  const entry = value.trim().toLowerCase();
  if (!entry || entry.includes('/') || entry.includes('@')) {
    return null;
  }
  if (entry.startsWith('[')) {
    const end = entry.indexOf(']');
    if (end < 0) {
      return null;
    }
    const suffix = entry.slice(end + 1);
    const port = suffix.startsWith(':') ? suffix.slice(1) : null;
    if (port !== null && !/^\d{1,5}$/u.test(port)) {
      return null;
    }
    return { hostname: normalizeHostname(entry.slice(1, end)), port };
  }
  const firstColon = entry.indexOf(':');
  const lastColon = entry.lastIndexOf(':');
  if (firstColon !== lastColon) {
    return { hostname: normalizeHostname(entry), port: null };
  }
  if (lastColon >= 0) {
    const port = entry.slice(lastColon + 1);
    if (!/^\d{1,5}$/u.test(port)) {
      return null;
    }
    return { hostname: entry.slice(0, lastColon), port };
  }
  return { hostname: entry, port: null };
}
