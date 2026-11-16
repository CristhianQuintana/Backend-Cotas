import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { AppConfig } from '../../config/app-config';

const logger = new Logger('RedisClient');

export function createRedisClient(config: AppConfig): Redis | null {
  if (!config.redisEnabled) {
    return null;
  }
  const client = new Redis(buildRedisUrl(config), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5_000,
    // Evita HELLO/AUTH inconsistente cuando la contraseña ya va en la URL.
    retryStrategy(times) {
      if (times > 8) {
        return null;
      }
      return Math.min(times * 200, 2_000);
    },
  });
  client.on('error', (error) => {
    logger.warn(`Redis: ${error instanceof Error ? error.message : 'error'}`);
  });
  return client;
}

export function buildRedisUrl(config: AppConfig): string {
  try {
    const url = new URL(config.redisUrl);
    if (config.redisPassword && !url.password) {
      url.password = config.redisPassword;
    }
    return url.toString();
  } catch {
    return config.redisUrl;
  }
}

export async function connectRedis(client: Redis | null): Promise<boolean> {
  if (!client) {
    return false;
  }
  try {
    if (client.status === 'wait' || client.status === 'end') {
      await client.connect();
    }
    const pong = await client.ping();
    return pong === 'PONG';
  } catch (error) {
    logger.warn(
      `Redis no disponible al conectar: ${error instanceof Error ? error.message : 'error'}`,
    );
    return false;
  }
}
