import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import {
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
  type SessionRepository,
  type TokenService,
  type UserRepository,
} from '../../domain/ports/identity.ports';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token || /\s/u.test(token)) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    const claims = await this.tokens.verifyAccessToken(token);
    const [user, session] = await Promise.all([
      this.users.findById(claims.sub),
      this.sessions.findSessionById(claims.sid),
    ]);
    const now = this.clock.now();
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.id !== claims.sub ||
      !session ||
      session.userId !== user.id ||
      session.revokedAt ||
      session.expiresAt <= now
    ) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    request.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      sessionId: session.id,
    };
    return true;
  }
}
