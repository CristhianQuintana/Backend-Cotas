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
  catalogSyncIntervalMs: number;
  catalogSyncConcurrency: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
