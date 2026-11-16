import type { AppConfig } from '../../config/app-config';
import { connectRedis, createRedisClient } from './redis.client';

describe('redis.client', () => {
  it('devuelve null si Redis está deshabilitado', () => {
    expect(createRedisClient({ redisEnabled: false } as AppConfig)).toBeNull();
  });

  it('connectRedis false con cliente null', async () => {
    await expect(connectRedis(null)).resolves.toBe(false);
  });

  it('crea cliente lazy cuando Redis está habilitado', () => {
    const client = createRedisClient({
      redisEnabled: true,
      redisUrl: 'redis://127.0.0.1:6399/15',
      redisPassword: null,
    } as AppConfig);
    expect(client).not.toBeNull();
    client?.disconnect();
  });
});
