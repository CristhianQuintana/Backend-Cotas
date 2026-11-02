export function sanitizePublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }
  return url.toString();
}

/**
 * XUI a menudo anuncia un host público (p. ej. IP remota) que el móvil no alcanza,
 * mientras el panel usable en LAN es XUI_BASE_URL. Reescribe iconos/pósters a ese origen.
 */
export function rewriteClientFacingXuiUrl(
  value: string | null | undefined,
  preferredBaseUrl: string,
  allowedHosts: readonly string[],
): string | null {
  if (value == null || value.length === 0) {
    return null;
  }
  let url: URL;
  let preferred: URL;
  try {
    url = new URL(value);
    preferred = new URL(preferredBaseUrl);
  } catch {
    return value;
  }
  if (!allowedHosts.includes(url.hostname)) {
    return value;
  }
  if (!allowedHosts.includes(preferred.hostname)) {
    return value;
  }
  if (url.hostname === preferred.hostname && url.port === preferredPort(preferred)) {
    return value;
  }
  url.protocol = preferred.protocol;
  url.hostname = preferred.hostname;
  url.port = preferredPort(preferred);
  return url.toString();
}

export function clientFacingStreamServer(
  preferredBaseUrl: string,
  allowedHosts: readonly string[],
): { protocol: 'http' | 'https'; host: string; port: string } | null {
  let preferred: URL;
  try {
    preferred = new URL(preferredBaseUrl);
  } catch {
    return null;
  }
  if (!allowedHosts.includes(preferred.hostname)) {
    return null;
  }
  const protocol = preferred.protocol === 'https:' ? 'https' : 'http';
  return {
    protocol,
    host: preferred.hostname,
    port: preferredPort(preferred) || (protocol === 'https' ? '443' : '80'),
  };
}

function preferredPort(url: URL): string {
  return url.port;
}

export function decodePossibleBase64(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const compact = trimmed.replace(/\s/g, '');
  if (compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    const recoded = Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/u, '');
    const original = compact.replace(/=+$/u, '');
    if (recoded === original && !decoded.includes('\uFFFD') && decoded.trim().length > 0) {
      return decoded;
    }
  }
  return trimmed;
}
