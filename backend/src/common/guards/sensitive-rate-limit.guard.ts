import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { DomainError, ErrorCodes, PublicMessages } from '../exceptions/domain-error';
import { sanitizeIp } from '../logging/redact';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { REDIS_CLIENT } from '../../modules/catalog/infrastructure/redis-catalog.cache';

@Injectable()
export class SensitiveRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private fallbackRequests = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null = null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = sanitizeIp(request.ip) ?? 'unknown';
    const key = `${ip}:${request.method}:${request.path}`;
    const now = Date.now();
    const limit = this.config.sensitiveRateLimit;
    const ttlMs = this.config.sensitiveRateTtlMs;

    if (this.config.redisEnabled && this.redis) {
      try {
        const redisKey = `ratelimit:sensitive:${key}`;
        const count = await this.redis.incr(redisKey);
        if (count === 1) {
          await this.redis.pexpire(redisKey, ttlMs);
        }
        if (count > limit) {
          throw new DomainError(ErrorCodes.rateLimited, 429, PublicMessages.rateLimited);
        }
        return true;
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        // Fallback memoria si Redis falla.
      }
    }

    const recent = (this.hits.get(key) ?? []).filter((hit) => now - hit < ttlMs);
    if (recent.length >= limit) {
      throw new DomainError(ErrorCodes.rateLimited, 429, PublicMessages.rateLimited);
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.fallbackRequests += 1;
    if (this.fallbackRequests >= 256) {
      this.fallbackRequests = 0;
      for (const [entryKey, timestamps] of this.hits) {
        const active = timestamps.filter((hit) => now - hit < ttlMs);
        if (active.length === 0) {
          this.hits.delete(entryKey);
        } else {
          this.hits.set(entryKey, active);
        }
      }
    }
    return true;
  }
}
