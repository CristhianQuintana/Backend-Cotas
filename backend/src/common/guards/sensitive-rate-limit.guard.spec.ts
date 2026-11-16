import { DomainError } from '../exceptions/domain-error';
import type { AppConfig } from '../../config/app-config';
import { SensitiveRateLimitGuard } from './sensitive-rate-limit.guard';

function ctx(path = '/api/v1/auth/login') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip: '203.0.113.10', method: 'POST', path }),
    }),
  } as never;
}

describe('SensitiveRateLimitGuard', () => {
  it('aplica límite en memoria cuando Redis está deshabilitado', async () => {
    const config = {
      redisEnabled: false,
      sensitiveRateLimit: 2,
      sensitiveRateTtlMs: 60_000,
    } as AppConfig;
    const guard = new SensitiveRateLimitGuard(config, null);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(DomainError);
  });

  it('falla cerrado si Redis está habilitado pero no hay cliente', async () => {
    const config = {
      redisEnabled: true,
      sensitiveRateLimit: 10,
      sensitiveRateTtlMs: 60_000,
    } as AppConfig;
    const guard = new SensitiveRateLimitGuard(config, null);
    await expect(guard.canActivate(ctx())).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });

  it('usa contador Redis cuando hay cliente', async () => {
    const redis = {
      incr: jest.fn().mockResolvedValue(1),
      pexpire: jest.fn().mockResolvedValue(1),
    };
    const config = {
      redisEnabled: true,
      sensitiveRateLimit: 5,
      sensitiveRateTtlMs: 60_000,
    } as AppConfig;
    const guard = new SensitiveRateLimitGuard(config, redis as never);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(redis.incr).toHaveBeenCalled();
    expect(redis.pexpire).toHaveBeenCalled();
  });
});
