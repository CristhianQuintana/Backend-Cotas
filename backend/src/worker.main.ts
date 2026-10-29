import 'reflect-metadata';
import { createServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { validateEnv } from './config/env.validation';
import { XuiHttpClient } from './modules/integrations/xui/infrastructure/http/xui-http.client';
import { CatalogSyncService } from './modules/catalog/application/catalog-sync.service';
import { RedisCatalogCache } from './modules/catalog/infrastructure/redis-catalog.cache';
import {
  createCatalogSyncWorker,
  scheduleCatalogSync,
  toBullConnection,
} from './modules/catalog/infrastructure/catalog-sync.queue';
import { createRedisClient, connectRedis } from './infrastructure/redis/redis.client';

async function bootstrap(): Promise<void> {
  const logger = new Logger('CatalogWorker');
  const config = validateEnv(process.env);

  if (!config.redisEnabled) {
    throw new Error('El worker de catálogo requiere REDIS_ENABLED=true.');
  }

  const redis = createRedisClient(config);
  const ready = await connectRedis(redis);
  if (!ready || !redis) {
    throw new Error('Redis no está disponible para el worker de catálogo.');
  }

  const cache = new RedisCatalogCache(config, redis);
  await cache.onModuleInit();

  const xui = new XuiHttpClient({
    baseUrl: config.xuiBaseUrl,
    username: config.xuiUsername,
    password: config.xuiPassword,
    timeoutMs: config.xuiTimeoutMs,
    maxResponseBytes: config.xuiMaxResponseBytes,
    allowedStreamHosts: config.xuiAllowedStreamHosts,
  });
  const sync = new CatalogSyncService(xui, cache, config);
  const connection = toBullConnection(config);
  const queue = await scheduleCatalogSync(config, connection);
  const worker = createCatalogSyncWorker(config, connection, sync);

  worker.on('failed', (job, error) => {
    logger.warn(`Fallo job ${job?.id ?? '?'}: ${error.message}`);
  });
  worker.on('completed', (job) => {
    logger.log(`Job ${job.id ?? job.name} completado.`);
  });

  const server = createServer((req, res) => {
    if (req.url === '/api/v1/health/live' || req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', role: 'worker' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(config.port, '0.0.0.0', resolve);
  });
  logger.log(`Worker de catálogo escuchando salud en :${config.port}`);

  const shutdown = async (signal: string) => {
    logger.log(`Apagando worker (${signal})`);
    server.close();
    await worker.close();
    await queue.close();
    await cache.onModuleDestroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Worker fallido';
  console.error(message);
  process.exit(1);
});
