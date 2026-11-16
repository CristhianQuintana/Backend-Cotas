import { Global, Module } from '@nestjs/common';
import { REDIS_CLIENT } from '../../modules/catalog/infrastructure/redis-catalog.cache';
import { redisClientProvider } from './redis.provider';

@Global()
@Module({
  providers: [redisClientProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
