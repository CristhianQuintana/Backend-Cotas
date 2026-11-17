import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../../common/logging/request-meta';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import { AUDIT_REPOSITORY, type AuditRepository } from '../../../audit/domain/audit-repository';
import { assertPasswordAllowed } from '../../domain/policies/password.policy';
import {
  PASSWORD_HASHER,
  USER_REPOSITORY,
  type PasswordHasher,
  type UserRepository,
} from '../../domain/ports/identity.ports';
import { LoginUseCase, type LoginResult } from './login.use-case';

export interface RegisterEmailCommand {
  email: string;
  password: string;
  displayName?: string;
  deviceId?: string;
  platform?: string;
  deviceName?: string;
  meta: RequestMeta;
}

@Injectable()
export class RegisterEmailUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LoginUseCase) private readonly login: LoginUseCase,
  ) {}

  async execute(command: RegisterEmailCommand): Promise<LoginResult> {
    const email = command.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new DomainError(ErrorCodes.validation, 400, PublicMessages.validation);
    }
    assertPasswordAllowed(command.password, email);
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new DomainError(ErrorCodes.conflict, 409, PublicMessages.conflict);
    }
    const username = await uniqueUsername(this.users, email);
    const passwordHash = await this.passwords.hash(command.password);
    const user = await this.users.createLocalUser({
      username,
      passwordHash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      now: this.clock.now(),
      email,
      displayName: command.displayName?.trim() || null,
      emailVerifiedAt: null,
    });
    await this.audit.record({
      action: 'auth.register',
      result: 'success',
      actorUserId: user.id,
      correlationId: command.meta.correlationId,
      ipAddress: command.meta.ipAddress,
      metadata: { auth: 'email' },
    });
    return this.login.execute({
      username: email,
      password: command.password,
      deviceId: command.deviceId,
      platform: command.platform,
      deviceName: command.deviceName,
      meta: command.meta,
    });
  }
}

async function uniqueUsername(users: UserRepository, email: string): Promise<string> {
  const base = email
    .split('@')[0]!
    .toLowerCase()
    .replace(/[^a-z0-9._-]/gu, '')
    .slice(0, 40);
  const seed = base.length >= 3 ? base : `user${Date.now().toString(36)}`;
  for (let i = 0; i < 12; i += 1) {
    const candidate = i === 0 ? seed : `${seed}${i}`;
    if (!(await users.findByUsername(candidate))) {
      return candidate;
    }
  }
  return `u${Date.now().toString(36)}`;
}
