import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError, ErrorCodes, PublicMessages } from '../exceptions/domain-error';
import { sanitizeIp } from '../logging/redact';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

@Injectable()
export class SensitiveRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = sanitizeIp(request.ip) ?? 'unknown';
    const key = `${ip}:${request.method}:${request.path}`;
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (hit) => now - hit < this.config.sensitiveRateTtlMs,
    );
    if (recent.length >= this.config.sensitiveRateLimit) {
      throw new DomainError(ErrorCodes.rateLimited, 429, PublicMessages.rateLimited);
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
