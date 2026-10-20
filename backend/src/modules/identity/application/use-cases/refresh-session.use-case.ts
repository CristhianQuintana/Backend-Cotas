import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../../common/logging/request-meta';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import { newId } from '../../../../common/utils/ids';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';
import { AUDIT_REPOSITORY, type AuditRepository } from '../../../audit/domain/audit-repository';
import type { SessionRecord } from '../../domain/models/session';
import {
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
  type SessionRepository,
  type TokenService,
  type UserRepository,
} from '../../domain/ports/identity.ports';

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(refreshToken: string, meta: RequestMeta) {
    const now = this.clock.now();
    const currentHash = this.tokens.hashToken(refreshToken);
    const nextRefresh = this.tokens.generateRefreshToken();
    const next: SessionRecord = {
      id: newId(),
      userId: '',
      familyId: '',
      refreshTokenHash: this.tokens.hashToken(nextRefresh),
      expiresAt: new Date(now.getTime() + this.config.refreshTokenTtlSeconds * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedById: null,
      createdAt: now,
      userAgent: meta.userAgent,
    };
    const result = await this.sessions.rotate(
      currentHash,
      next,
      {
        action: 'auth.refresh',
        result: 'success',
        actorUserId: null,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      },
      {
        action: 'auth.refresh_reuse',
        result: 'failure',
        actorUserId: null,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      },
      now,
    );
    if (result.type !== 'rotated') {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    const user = await this.users.findById(result.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.audit.record({
        action: 'auth.refresh',
        result: 'failure',
        actorUserId: user?.id ?? null,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      sid: result.sessionId,
      role: user.role,
    });
    return {
      accessToken,
      refreshToken: nextRefresh,
      expiresIn: this.config.accessTokenTtlSeconds,
      tokenType: 'Bearer' as const,
    };
  }
}
