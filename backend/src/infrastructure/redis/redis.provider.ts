import type { Provider } from '@nestjs/common';
import type Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { REDIS_CLIENT } from '../../modules/catalog/infrastructure/redis-catalog.cache';
import { connectRedis, createRedisClient } from './redis.client';

/**
 * Cliente Redis compartido para tickets, rate-limit y caché.
 * Un solo provider evita conexiones duplicadas y garantiza inyección en guards.
 */
export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [APP_CONFIG],
  useFactory: async (config: AppConfig): Promise<Redis | null> => {
    const client = createRedisClient(config);
    if (!client) {
      return null;
    }
    const ready = await connectRedis(client);
    if (!ready) {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
      return null;
    }
    return client;
  },
};
