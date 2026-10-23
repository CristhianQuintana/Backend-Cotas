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
import { isStaffRole, type UserRecord } from '../../domain/models/authenticated-user';
import type { SessionRecord } from '../../domain/models/session';
import { XUI_CLIENT, type XuiClient } from '../../../integrations/xui/domain/models';
import {
  LINE_ACCESS,
  MFA_CIPHER,
  MFA_SERVICE,
  PASSWORD_HASHER,
  RECOVERY_CODE_REPOSITORY,
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
  type LineAccess,
  type MfaSecretCipher,
  type MfaService,
  type PasswordHasher,
  type RecoveryCodeRepository,
  type SessionRepository,
  type TokenService,
  type UserRepository,
} from '../../domain/ports/identity.ports';

export interface LoginCommand {
  username: string;
  password: string;
  totpCode?: string;
  recoveryCode?: string;
  meta: RequestMeta;
}

export type LoginResult =
  | {
      type: 'authenticated';
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType: 'Bearer';
    }
  | {
      type: 'mfa_enrollment_required';
      enrollmentToken: string;
      expiresIn: number;
    };

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(RECOVERY_CODE_REPOSITORY) private readonly recoveryCodes: RecoveryCodeRepository,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(MFA_SERVICE) private readonly mfa: MfaService,
    @Inject(MFA_CIPHER) private readonly cipher: MfaSecretCipher,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(XUI_CLIENT) private readonly xui: XuiClient,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const username = command.username.trim();
    const local = await this.users.findByUsername(username);

    if (local?.passwordHash) {
      return this.loginLocal(local, command);
    }

    if (local && isStaffRole(local.role)) {
      await this.passwords.verify(command.password, await this.passwords.dummyHash());
      await this.failLogin(command.meta, null, 'staff_without_password');
    }

    return this.loginCustomerLine(username, command);
  }

  private async loginLocal(user: UserRecord, command: LoginCommand): Promise<LoginResult> {
    const hash = user.passwordHash ?? (await this.passwords.dummyHash());
    const valid = await this.passwords.verify(command.password, hash);
    if (!user.passwordHash || !valid) {
      await this.failLogin(command.meta, user.id, 'password');
    }
    if (user.status !== 'ACTIVE') {
      await this.failLogin(command.meta, user.id, 'blocked');
    }

    if (isStaffRole(user.role)) {
      return this.loginStaff(user, command);
    }

    return this.issueSession(user, command.meta);
  }

  private async loginCustomerLine(username: string, command: LoginCommand): Promise<LoginResult> {
    const line = await this.xui.authenticate({ username, password: command.password });
    if (!line.authenticated) {
      await this.failLogin(command.meta, null, 'line');
    }

    const accepted = await this.lines.acceptLine({
      username,
      password: command.password,
      now: this.clock.now(),
    });
    if (!accepted.ok) {
      return this.failLogin(command.meta, null, 'blocked');
    }
    if (isStaffRole(accepted.user.role)) {
      return this.failLogin(command.meta, accepted.user.id, 'staff_via_xui');
    }

    return this.issueSession(accepted.user, command.meta);
  }

  private async loginStaff(user: UserRecord, command: LoginCommand): Promise<LoginResult> {
    if (!user.mfaEnabled || !user.mfaSecretCiphertext) {
      const enrollmentToken = await this.tokens.signEnrollmentToken(user.id);
      await this.audit.record({
        action: 'auth.mfa_enrollment_challenge',
        result: 'pending',
        actorUserId: user.id,
        correlationId: command.meta.correlationId,
        ipAddress: command.meta.ipAddress,
      });
      return {
        type: 'mfa_enrollment_required',
        enrollmentToken,
        expiresIn: this.config.enrollmentTokenTtlSeconds,
      };
    }

    const secret = this.cipher.decrypt(user.mfaSecretCiphertext);
    const secondFactor = command.recoveryCode
      ? await this.recoveryCodes.consume(
          user.id,
          this.tokens.hashToken(command.recoveryCode.trim().toLowerCase()),
          this.clock.now(),
        )
      : Boolean(command.totpCode) && this.mfa.verify(secret, command.totpCode ?? '');
    if (!secondFactor) {
      await this.failLogin(command.meta, user.id, 'second_factor');
    }

    return this.issueSession(user, command.meta);
  }

  private async issueSession(user: UserRecord, meta: RequestMeta): Promise<LoginResult> {
    const now = this.clock.now();
    const refreshToken = this.tokens.generateRefreshToken();
    const session: SessionRecord = {
      id: newId(),
      userId: user.id,
      familyId: newId(),
      refreshTokenHash: this.tokens.hashToken(refreshToken),
      expiresAt: new Date(now.getTime() + this.config.refreshTokenTtlSeconds * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedById: null,
      createdAt: now,
      userAgent: meta.userAgent,
    };
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      sid: session.id,
      role: user.role,
    });
    await this.sessions.create(session, {
      action: 'auth.login',
      result: 'success',
      actorUserId: user.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: { role: user.role, auth: user.passwordHash ? 'local' : 'xui' },
    });
    await this.users.touchLastLogin(user.id, now);
    return {
      type: 'authenticated',
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
      tokenType: 'Bearer',
    };
  }

  private async failLogin(
    meta: RequestMeta,
    actorUserId: string | null,
    reason: string,
  ): Promise<never> {
    await this.audit.record({
      action: 'auth.login',
      result: 'failure',
      actorUserId,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: { reason },
    });
    throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
  }
}
