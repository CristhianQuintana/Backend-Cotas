const QUERY_SECRET =
  /([?&](?:username|password|token|access_token|refresh_token|secret|authorization)=)[^&\s]*/gi;
const PATH_SECRET = /\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi;
const CONNECTION_URL = /(postgres(?:ql)?:\/\/)[^:\s]+:[^@\s]+@/gi;

export function redactSensitive(value: string): string {
  return value
    .replace(QUERY_SECRET, '$1[REDACTED]')
    .replace(PATH_SECRET, '/$1/[REDACTED]/[REDACTED]/')
    .replace(BEARER, '$1[REDACTED]')
    .replace(CONNECTION_URL, '$1[REDACTED]:[REDACTED]@');
}

export function sanitizeLogValue(value: string, maxLength = 200): string {
  return value.replace(/[\r\n\t]/g, ' ').slice(0, maxLength);
}

export function sanitizeIp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const clean = sanitizeLogValue(value, 64);
  return /^[0-9a-fA-F:.]+$/.test(clean) ? clean : null;
}

export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : 'unknown';
  }
  return 'unknown';
}

export function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return 'UnknownError';
}
