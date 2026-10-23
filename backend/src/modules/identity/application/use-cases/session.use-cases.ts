import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../../common/logging/request-meta';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import {
  SESSION_REPOSITORY,
  USER_REPOSITORY,
  type SessionRepository,
  type UserRepository,
} from '../../domain/ports/identity.ports';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(user: AuthenticatedUser, meta: RequestMeta): Promise<void> {
    const result = await this.sessions.revokeOwned(
      user.sessionId,
      user.id,
      'LOGOUT',
      {
        action: 'auth.logout',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      },
      this.clock.now(),
    );
    if (result === 'not_found') {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
  }
}

@Injectable()
export class GetProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(user: AuthenticatedUser) {
    const record = await this.users.findById(user.id);
    if (!record || record.status !== 'ACTIVE') {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    return {
      id: record.id,
      username: record.username,
      role: record.role,
      roles: record.roles,
      status: record.status,
      mfaEnabled: record.mfaEnabled,
    };
  }
}

@Injectable()
export class ListSessionsUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(user: AuthenticatedUser) {
    const sessions = await this.sessions.listActiveByUser(user.id, this.clock.now());
    return {
      items: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === user.sessionId,
      })),
    };
  }
}

@Injectable()
export class RevokeSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(user: AuthenticatedUser, sessionId: string, meta: RequestMeta): Promise<void> {
    const result = await this.sessions.revokeOwned(
      sessionId,
      user.id,
      'LOGOUT',
      {
        action: 'auth.session_revoke',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      },
      this.clock.now(),
    );
    if (result === 'not_found') {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.sessionNotFound);
    }
  }
}
