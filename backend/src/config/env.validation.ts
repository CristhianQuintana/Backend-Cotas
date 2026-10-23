import type { AppConfig, LogLevel, NodeEnv } from './app-config';

const PLACEHOLDER = 'CHANGE_ME';

export function validateEnv(raw: NodeJS.ProcessEnv): AppConfig {
  const nodeEnv = oneOf(raw.NODE_ENV, ['development', 'test', 'production'], 'NODE_ENV') as NodeEnv;
  const port = integer(raw.PORT, 'PORT', 1, 65535);
  const apiPrefix = pattern(
    raw.API_PREFIX ?? 'api/v1',
    'API_PREFIX',
    /^[a-z0-9]+(?:\/[a-z0-9]+)*$/u,
  );
  const databaseUrl = requiredSecret(raw.DATABASE_URL, 'DATABASE_URL');
  if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    fail('DATABASE_URL');
  }

  const jwtAccessSecret = requiredSecret(raw.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET');
  const mfaEncryptionKey = requiredSecret(raw.MFA_ENCRYPTION_KEY, 'MFA_ENCRYPTION_KEY');
  if (jwtAccessSecret === mfaEncryptionKey) {
    fail('MFA_ENCRYPTION_KEY');
  }
  minLength(jwtAccessSecret, 'JWT_ACCESS_SECRET', 32);
  minLength(mfaEncryptionKey, 'MFA_ENCRYPTION_KEY', 32);

  const jwtIssuer = pattern(raw.JWT_ISSUER, 'JWT_ISSUER', /^[a-z0-9][a-z0-9.-]{2,62}$/u);
  const jwtAudience = pattern(raw.JWT_AUDIENCE, 'JWT_AUDIENCE', /^[a-z0-9][a-z0-9.-]{2,62}$/u);
  const accessMax = nodeEnv === 'production' ? 900 : 3600;
  const accessTokenTtlSeconds = integer(
    raw.ACCESS_TOKEN_TTL_SECONDS ?? '900',
    'ACCESS_TOKEN_TTL_SECONDS',
    60,
    accessMax,
  );
  const refreshTokenTtlSeconds = integer(
    raw.REFRESH_TOKEN_TTL_SECONDS ?? '604800',
    'REFRESH_TOKEN_TTL_SECONDS',
    300,
    2_592_000,
  );

  const xuiBaseUrl = parseXuiBaseUrl(
    required(raw.XUI_BASE_URL, 'XUI_BASE_URL'),
    nodeEnv,
    raw.XUI_ALLOW_INSECURE_HTTP === 'true',
  );
  const xuiUsername = xuiCredential(raw.XUI_USERNAME, 'XUI_USERNAME');
  const xuiPassword = xuiCredential(raw.XUI_PASSWORD, 'XUI_PASSWORD');
  const xuiTimeoutMs = integer(raw.XUI_TIMEOUT_MS ?? '5000', 'XUI_TIMEOUT_MS', 1000, 30_000);
  const xuiMaxResponseBytes = integer(
    raw.XUI_MAX_RESPONSE_BYTES ?? '2000000',
    'XUI_MAX_RESPONSE_BYTES',
    100_000,
    5_000_000,
  );
  const configuredHosts = splitList(raw.XUI_ALLOWED_STREAM_HOSTS);
  const xuiAllowedStreamHosts = (
    configuredHosts.length > 0 ? configuredHosts : [xuiBaseUrl.hostname]
  ).map((host) => normalizeHost(host, 'XUI_ALLOWED_STREAM_HOSTS'));

  const logLevel = oneOf(
    raw.LOG_LEVEL ?? 'info',
    ['debug', 'info', 'warn', 'error'],
    'LOG_LEVEL',
  ) as LogLevel;
  const corsAllowInsecureHttp = raw.CORS_ALLOW_INSECURE_HTTP === 'true';
  const corsOrigins = splitList(required(raw.CORS_ORIGINS, 'CORS_ORIGINS')).map((origin) =>
    parseCorsOrigin(origin, nodeEnv, corsAllowInsecureHttp),
  );
  const trustProxy = bool(raw.TRUST_PROXY ?? 'false', 'TRUST_PROXY');
  const swaggerEnabled =
    raw.SWAGGER_ENABLED === undefined
      ? nodeEnv !== 'production'
      : bool(raw.SWAGGER_ENABLED, 'SWAGGER_ENABLED');
  const bodyLimit = pattern(
    raw.BODY_LIMIT ?? '16kb',
    'BODY_LIMIT',
    /^(?:[1-9]|[1-9][0-9]|[1-9][0-9]{2}|1024)kb$/u,
  );
  const sensitiveRateLimit = integer(
    raw.SENSITIVE_RATE_LIMIT ?? '10',
    'SENSITIVE_RATE_LIMIT',
    1,
    100,
  );
  const sensitiveRateTtlMs = integer(
    raw.SENSITIVE_RATE_TTL_MS ?? '60000',
    'SENSITIVE_RATE_TTL_MS',
    1000,
    3_600_000,
  );
  const globalRateLimit = integer(raw.GLOBAL_RATE_LIMIT ?? '300', 'GLOBAL_RATE_LIMIT', 10, 5_000);

  const minMemory = nodeEnv === 'production' ? 19_456 : 4_096;
  const minTime = nodeEnv === 'production' ? 2 : 1;
  const argon2MemoryCost = integer(
    raw.ARGON2_MEMORY_COST ?? String(minMemory),
    'ARGON2_MEMORY_COST',
    minMemory,
    1_048_576,
  );
  const argon2TimeCost = integer(
    raw.ARGON2_TIME_COST ?? String(minTime),
    'ARGON2_TIME_COST',
    minTime,
    10,
  );
  const argon2Parallelism = integer(raw.ARGON2_PARALLELISM ?? '1', 'ARGON2_PARALLELISM', 1, 4);

  return {
    nodeEnv,
    port,
    apiPrefix,
    databaseUrl,
    jwtAccessSecret,
    jwtIssuer,
    jwtAudience,
    accessTokenTtlSeconds,
    refreshTokenTtlSeconds,
    enrollmentTokenTtlSeconds: 600,
    mfaEncryptionKey,
    xuiBaseUrl: xuiBaseUrl.origin,
    xuiUsername,
    xuiPassword,
    xuiTimeoutMs,
    xuiMaxResponseBytes,
    xuiAllowedStreamHosts,
    logLevel,
    corsOrigins,
    trustProxy,
    swaggerEnabled,
    bodyLimit,
    sensitiveRateLimit,
    sensitiveRateTtlMs,
    globalRateLimit,
    argon2MemoryCost,
    argon2TimeCost,
    argon2Parallelism,
  };
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    fail(name);
  }
  return value.trim();
}

function requiredSecret(value: string | undefined, name: string): string {
  const secret = required(value, name);
  if (secret.includes(PLACEHOLDER)) {
    fail(name);
  }
  return secret;
}

function minLength(value: string, name: string, min: number): void {
  if (value.length < min) {
    fail(name);
  }
}

function integer(value: string | undefined, name: string, min: number, max: number): number {
  const text = required(value, name);
  if (!/^[0-9]+$/u.test(text)) {
    fail(name);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail(name);
  }
  return parsed;
}

function pattern(value: string | undefined, name: string, expression: RegExp): string {
  const text = required(value, name);
  if (!expression.test(text)) {
    fail(name);
  }
  return text;
}

function oneOf(value: string | undefined, allowed: readonly string[], name: string): string {
  const text = required(value, name);
  if (!allowed.includes(text)) {
    fail(name);
  }
  return text;
}

function bool(value: string, name: string): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  fail(name);
}

function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseXuiBaseUrl(value: string, nodeEnv: NodeEnv, allowInsecureHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('XUI_BASE_URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    fail('XUI_BASE_URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    fail('XUI_BASE_URL');
  }
  if (url.protocol === 'http:' && nodeEnv === 'production' && !allowInsecureHttp) {
    fail('XUI_BASE_URL');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    fail('XUI_BASE_URL');
  }
  return url;
}

function parseCorsOrigin(value: string, nodeEnv: NodeEnv, allowInsecureHttp: boolean): string {
  if (value === '*') {
    fail('CORS_ORIGINS');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('CORS_ORIGINS');
  }
  if (url.username || url.password) {
    fail('CORS_ORIGINS');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    fail('CORS_ORIGINS');
  }
  if (nodeEnv === 'production' && url.protocol === 'http:' && !allowInsecureHttp) {
    fail('CORS_ORIGINS');
  }
  return url.origin;
}

function xuiCredential(value: string | undefined, name: string): string {
  const credential = requiredSecret(value, name);
  if (credential.length > 128 || /[\s/?#]/u.test(credential)) {
    fail(name);
  }
  return credential;
}

function normalizeHost(value: string, name: string): string {
  const host = value.trim().toLowerCase();
  if (
    host.includes('://') ||
    host.includes('/') ||
    host.includes('@') ||
    host.length === 0 ||
    host.length > 253
  ) {
    fail(name);
  }
  return host;
}

function fail(name: string): never {
  throw new Error(`Configuración inválida: ${name}`);
}
