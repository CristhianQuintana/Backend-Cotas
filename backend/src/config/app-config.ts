export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  apiPrefix: string;
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  enrollmentTokenTtlSeconds: number;
  mfaEncryptionKey: string;
  xuiBaseUrl: string;
  xuiUsername: string;
  xuiPassword: string;
  xuiTimeoutMs: number;
  xuiMaxResponseBytes: number;
  xuiAllowedStreamHosts: string[];
  logLevel: LogLevel;
  corsOrigins: string[];
  trustProxy: boolean;
  swaggerEnabled: boolean;
  bodyLimit: string;
  sensitiveRateLimit: number;
  sensitiveRateTtlMs: number;
  globalRateLimit: number;
  argon2MemoryCost: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  redisEnabled: boolean;
  redisUrl: string;
  redisPassword: string | null;
  catalogCacheTtlSeconds: number;
  catalogEpgCacheTtlSeconds: number;
  /** TTL de firma de `/media/asset` (ventana estable para caché de TV/CDN). */
  mediaAssetTtlSeconds: number;
  /** TTL de tickets `/playback/media` (segundos). Default corto frente al histórico 6h. */
  playbackTicketTtlSeconds: number;
  /** Cupo de dispositivos si XUI no reporta max_connections (nunca ilimitado). */
  deviceLimitFailsafe: number;
  /** Máximo de proxies de media concurrentes por proceso (anti-503 por fan-out). */
  playbackProxyMaxConcurrent: number;
  catalogSyncIntervalMs: number;
  catalogSyncConcurrency: number;
  fcmEnabled: boolean;
  fcmProjectId: string | null;
  fcmClientEmail: string | null;
  fcmPrivateKey: string | null;
  /** Client IDs OAuth de Google autorizados (aud del ID token). */
  googleOAuthClientIds: string[];
  /** Si true, exige GOOGLE_OAUTH_CLIENT_IDS no vacío (producción). */
  googleSignInEnabled: boolean;
  /**
   * LOGIN COTAS (línea XUI por `/auth/login`): rangos CIDR desde los que se acepta el peer TCP.
   * Vacío = sin restricción. No afecta correo/Google, panel staff ni STREAM CODE (cliente → XUI).
   */
  loginCotasAllowedCidrs: string[];
  /**
   * Si true y el peer es un proxy de confianza, LOGIN COTAS usa la última entrada de
   * `X-Forwarded-For`. Activar solo si Nginx SOBRESCRIBE la cabecera (`$remote_addr`).
   */
  loginCotasTrustForwardedFor: boolean;
  /** Proxies adicionales de confianza (CIDR) además de loopback y Docker 172.16.0.0/12. */
  loginCotasTrustedProxyCidrs: string[];
}

export const APP_CONFIG = Symbol('APP_CONFIG');
