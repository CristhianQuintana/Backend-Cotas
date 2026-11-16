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
    // Reintentos cortos: evita null silencioso si Redis aún no acepta AUTH al arrancar.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const ready = await connectRedis(client);
      if (ready) {
        return client;
      }
      await new Promise((r) => setTimeout(r, attempt * 400));
    }
    if (config.nodeEnv === 'production' && config.redisEnabled) {
      throw new Error('REDIS_ENABLED=true pero Redis no está disponible al iniciar.');
    }
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  },
};
