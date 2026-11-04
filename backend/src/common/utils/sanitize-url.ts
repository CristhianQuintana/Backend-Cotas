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
 * XUI guarda a veces `s:1:/images/archivo.jpg` (servidor de almacenamiento N).
 * La foto real está en `{panel}/images/archivo.jpg`, no en resize?url=s:1:...
 */
export function resolveXuiStoredImage(
  value: unknown,
  preferredBaseUrl: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) {
    return null;
  }
  const stored = /^s:\d+:(\/images\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp|gif))$/iu.exec(trimmed);
  if (stored) {
    if (!preferredBaseUrl) {
      return null;
    }
    try {
      const base = new URL(preferredBaseUrl);
      return `${base.protocol}//${base.host}${stored[1]}`;
    } catch {
      return null;
    }
  }
  return sanitizePublicUrl(trimmed);
}

/** Primer URL usable de string, array XUI (`backdrop_path`) o valor inválido → null. */
export function firstXuiImageUrl(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry.trim().slice(0, 500);
      }
    }
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 500);
  }
  return null;
}

export function sameImagePath(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }
  try {
    return new URL(left).pathname === new URL(right).pathname;
  } catch {
    return left === right;
  }
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
