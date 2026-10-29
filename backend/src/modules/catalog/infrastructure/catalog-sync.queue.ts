import { Logger } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { AppConfig } from '../../../config/app-config';
import type { CatalogSyncService } from '../application/catalog-sync.service';

export const CATALOG_SYNC_QUEUE = 'catalog-sync';
export const CATALOG_SYNC_JOB = 'sync-xui-catalog';
export const CATALOG_SYNC_SCHEDULER_ID = 'catalog-sync-repeatable';

const logger = new Logger('CatalogSyncQueue');

export function toBullConnection(config: AppConfig): ConnectionOptions {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: config.redisPassword || url.password || undefined,
    db: Number(url.pathname.replace(/^\//u, '') || 0),
    maxRetriesPerRequest: null,
  };
}

export async function scheduleCatalogSync(
  config: AppConfig,
  connection: ConnectionOptions,
): Promise<Queue> {
  const queue = new Queue(CATALOG_SYNC_QUEUE, { connection });

  // BullMQ 6: schedulers vía upsertJobScheduler (idempotente; evita jobs duplicados).
  await queue.upsertJobScheduler(
    CATALOG_SYNC_SCHEDULER_ID,
    { every: config.catalogSyncIntervalMs },
    {
      name: CATALOG_SYNC_JOB,
      data: { reason: 'schedule' },
      opts: {
        removeOnComplete: 20,
        removeOnFail: 40,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    },
  );

  // Primera corrida inmediata sin colisionar con el scheduler.
  await queue.add(
    CATALOG_SYNC_JOB,
    { reason: 'startup' },
    {
      jobId: `catalog-sync-startup-${Date.now()}`,
      removeOnComplete: 5,
      removeOnFail: 10,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    },
  );
  logger.log(`Cola ${CATALOG_SYNC_QUEUE} programada cada ${config.catalogSyncIntervalMs}ms.`);
  return queue;
}

export function createCatalogSyncWorker(
  config: AppConfig,
  connection: ConnectionOptions,
  sync: CatalogSyncService,
): Worker {
  return new Worker(
    CATALOG_SYNC_QUEUE,
    async (job: Job) => {
      logger.log(`Job ${job.id ?? job.name} (${String(job.data?.reason ?? 'n/a')})`);
      return sync.syncProbeCatalog();
    },
    {
      connection,
      concurrency: Math.max(1, config.catalogSyncConcurrency),
      lockDuration: 120_000,
    },
  );
}
