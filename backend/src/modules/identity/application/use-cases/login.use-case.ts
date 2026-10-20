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
import type { UserRecord } from '../../domain/models/authenticated-user';
import type { SessionRecord } from '../../domain/models/session';
import { XUI_CLIENT, type XuiClient } from '../../../integrations/xui/domain/models';
import {
  LINE_ACCESS,
  MFA_CIPHER,
  MFA_SERVICE,
  RECOVERY_CODE_REPOSITORY,
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  type LineAccess,
  type MfaSecretCipher,
  type MfaService,
  type RecoveryCodeRepository,
  type SessionRepository,
  type TokenService,
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
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(RECOVERY_CODE_REPOSITORY) private readonly recoveryCodes: RecoveryCodeRepository,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(MFA_SERVICE) private readonly mfa: MfaService,
    @Inject(MFA_CIPHER) private readonly cipher: MfaSecretCipher,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(XUI_CLIENT) private readonly xui: XuiClient,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const username = command.username.trim();
    const line = await this.xui.authenticate({ username, password: command.password });
    if (!line.authenticated) {
      await this.audit.record({
        action: 'auth.login',
        result: 'failure',
        actorUserId: null,
        correlationId: command.meta.correlationId,
        ipAddress: command.meta.ipAddress,
        metadata: { reason: 'line' },
      });
      throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
    }

    const accepted = await this.lines.acceptLine({
      username,
      password: command.password,
      now: this.clock.now(),
    });
    if (!accepted.ok) {
      await this.audit.record({
        action: 'auth.login',
        result: 'failure',
        actorUserId: null,
        correlationId: command.meta.correlationId,
        ipAddress: command.meta.ipAddress,
        metadata: { reason: 'blocked' },
      });
      throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
    }

    const user = accepted.user;
    if (user.role === 'OPERATOR' || user.role === 'ADMIN') {
      return this.loginOperator(user, command);
    }

    return this.issueSession(user, command.meta);
  }

  private async loginOperator(user: UserRecord, command: LoginCommand): Promise<LoginResult> {
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
      await this.audit.record({
        action: 'auth.login',
        result: 'failure',
        actorUserId: user.id,
        correlationId: command.meta.correlationId,
        ipAddress: command.meta.ipAddress,
        metadata: { reason: 'second_factor' },
      });
      throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
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
      metadata: { role: user.role },
    });
    return {
      type: 'authenticated',
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
      tokenType: 'Bearer',
    };
  }
}
