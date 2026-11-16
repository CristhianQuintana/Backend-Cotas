import type { AppConfig } from '../../src/config/app-config';
import { validateEnv } from '../../src/config/env.validation';
import { connectRedis, createRedisClient } from '../../src/infrastructure/redis/redis.client';
import { PlaybackMediaTicketStore } from '../../src/modules/playback/infrastructure/playback-media-ticket.store';
import { SensitiveRateLimitGuard } from '../../src/common/guards/sensitive-rate-limit.guard';

const enabled = process.env.RUN_REDIS_INTEGRATION === 'true';

(enabled ? describe : describe.skip)('Redis compartido (tickets + rate-limit)', () => {
  let config: AppConfig;
  let redis: ReturnType<typeof createRedisClient>;

  beforeAll(async () => {
    process.env.REDIS_ENABLED = 'true';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/15';
    config = validateEnv(process.env);
    redis = createRedisClient(config);
    const ok = await connectRedis(redis);
    if (!ok) {
      throw new Error('Redis de integración no disponible');
    }
  });

  afterAll(async () => {
    if (redis) {
      await redis.quit().catch(() => redis?.disconnect());
    }
  });

  it('emite en una instancia y lee/revoca desde otra (sin fallback memoria)', async () => {
    const issuer = new PlaybackMediaTicketStore(config, redis);
    const reader = new PlaybackMediaTicketStore(config, redis);
    await issuer.onModuleInit();
    await reader.onModuleInit();

    const ticket = await issuer.issue({
      upstreamUrl: 'http://stream.test.local/live/1.m3u8',
      protocolHint: 'hls',
      userId: 'user-it',
      deviceId: 'dev-it',
    });
    await expect(reader.get(ticket.id)).resolves.toMatchObject({ userId: 'user-it' });
    await expect(reader.revokeForUser('user-it')).resolves.toBeGreaterThanOrEqual(1);
    await expect(issuer.get(ticket.id)).resolves.toBeNull();
  });

  it('aplica rate-limit distribuido vía Redis', async () => {
    const guardA = new SensitiveRateLimitGuard(config, redis);
    const guardB = new SensitiveRateLimitGuard(config, redis);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          ip: '198.51.100.20',
          method: 'POST',
          path: '/api/v1/auth/login-it',
        }),
      }),
    } as never;

    const limit = config.sensitiveRateLimit;
    for (let i = 0; i < limit; i += 1) {
      // Alterna réplicas A/B
      const guard = i % 2 === 0 ? guardA : guardB;
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    await expect(guardB.canActivate(ctx)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
