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
