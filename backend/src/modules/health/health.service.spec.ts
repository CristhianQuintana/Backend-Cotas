import { DomainError } from '../../common/exceptions/domain-error';
import type { AppConfig } from '../../config/app-config';
import type { CatalogCache } from '../catalog/domain/catalog-cache';
import type { XuiClient } from '../integrations/xui/domain/models';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const config = { redisEnabled: true } as AppConfig;

  it('live siempre ok', () => {
    const service = new HealthService({} as never, {} as never, {} as never, config);
    expect(service.live()).toEqual({ status: 'ok' });
  });

  it('ready falla con 503 si PostgreSQL no responde', async () => {
    const prisma = { isDatabaseReachable: jest.fn().mockResolvedValue(false) };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      {} as XuiClient,
      {} as CatalogCache,
      config,
    );
    await expect(service.ready()).rejects.toBeInstanceOf(DomainError);
  });

  it('ready ok cuando la base responde', async () => {
    const prisma = { isDatabaseReachable: jest.fn().mockResolvedValue(true) };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      {} as XuiClient,
      {} as CatalogCache,
      config,
    );
    await expect(service.ready()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('dependencies reporta degradado si Redis está down', async () => {
    const prisma = { isDatabaseReachable: jest.fn().mockResolvedValue(true) };
    const xui = { getLineStatus: jest.fn().mockResolvedValue({ authenticated: true }) };
    const cache = { ping: jest.fn().mockResolvedValue(false) };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      xui as unknown as XuiClient,
      cache as unknown as CatalogCache,
      config,
    );
    await expect(service.dependencies()).resolves.toMatchObject({
      status: 'degraded',
      checks: { database: 'up', xui: 'up', redis: 'down' },
    });
  });
});
