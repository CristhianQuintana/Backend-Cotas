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
import { resolveDeviceLimit } from '../../domain/device-limit.policy';
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
  type DevicePlatformCode,
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
  deviceId?: string;
  platform?: string;
  deviceName?: string;
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
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(XUI_CLIENT) private readonly xui: XuiClient,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(MFA_SERVICE) private readonly mfa: MfaService,
    @Inject(MFA_CIPHER) private readonly cipher: MfaSecretCipher,
    @Inject(RECOVERY_CODE_REPOSITORY) private readonly recoveryCodes: RecoveryCodeRepository,
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
      if (!user.mfaEnabled) {
        const enrollmentToken = await this.tokens.signEnrollmentToken(user.id);
        await this.audit.record({
          action: 'auth.login',
          result: 'pending',
          actorUserId: user.id,
          correlationId: command.meta.correlationId,
          ipAddress: command.meta.ipAddress,
          metadata: { reason: 'mfa_enrollment_required', role: user.role },
        });
        return {
          type: 'mfa_enrollment_required',
          enrollmentToken,
          expiresIn: this.config.enrollmentTokenTtlSeconds,
        };
      }
      await this.assertStaffMfa(user, command);
    }

    return this.issueSession(user, command.meta);
  }

  private async assertStaffMfa(user: UserRecord, command: LoginCommand): Promise<void> {
    if (command.recoveryCode?.trim()) {
      const ok = await this.recoveryCodes.consume(
        user.id,
        this.tokens.hashToken(command.recoveryCode.trim()),
        this.clock.now(),
      );
      if (!ok) {
        await this.failLogin(command.meta, user.id, 'mfa_recovery');
      }
      await this.audit.record({
        action: 'auth.mfa_recovery',
        result: 'success',
        actorUserId: user.id,
        correlationId: command.meta.correlationId,
        ipAddress: command.meta.ipAddress,
      });
      return;
    }
    if (!command.totpCode?.trim()) {
      await this.audit.record({
        action: 'auth.login',
        result: 'failure',
        actorUserId: user.id,
        correlationId: command.meta.correlationId,
        ipAddress: command.meta.ipAddress,
        metadata: { reason: 'mfa_required' },
      });
      throw new DomainError(ErrorCodes.mfaRequired, 401, PublicMessages.mfaRequired);
    }
    if (!user.mfaSecretCiphertext) {
      await this.failLogin(command.meta, user.id, 'mfa_secret_missing');
    }
    const secret = this.cipher.decrypt(user.mfaSecretCiphertext!);
    if (!this.mfa.verify(secret, command.totpCode.trim())) {
      await this.failLogin(command.meta, user.id, 'mfa_totp');
    }
  }

  private async loginCustomerLine(username: string, command: LoginCommand): Promise<LoginResult> {
    const line = await this.xui.authenticate({ username, password: command.password });
    if (!line.authenticated) {
      await this.failLogin(command.meta, null, 'line');
    }

    const maxDevices = resolveDeviceLimit(line.maxConnections, this.config.deviceLimitFailsafe);

    const accepted = await this.lines.acceptLine({
      username,
      password: command.password,
      now: this.clock.now(),
      snapshot: {
        displayName: line.displayName ?? username,
        expiresAt: line.expiresAt,
        maxConnections: maxDevices,
        activeConnections: line.activeConnections,
        status: line.status,
      },
    });
    if (!accepted.ok) {
      return this.failLogin(command.meta, null, 'blocked');
    }
    if (isStaffRole(accepted.user.role)) {
      return this.failLogin(command.meta, accepted.user.id, 'staff_via_xui');
    }

    const clientDeviceId =
      command.deviceId?.trim() || fingerprintFromUserAgent(command.meta.userAgent);

    const deviceId = await this.lines.claimDeviceSlot({
      userId: accepted.user.id,
      clientDeviceId,
      platform: mapPlatform(command.platform, command.meta.userAgent),
      deviceName: command.deviceName ?? null,
      maxDevices,
      now: this.clock.now(),
    });

    return this.issueSession(accepted.user, command.meta, deviceId);
  }

  private async issueSession(
    user: UserRecord,
    meta: RequestMeta,
    deviceId?: string,
  ): Promise<Extract<LoginResult, { type: 'authenticated' }>> {
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
    await this.sessions.create(
      session,
      {
        action: 'auth.login',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
        metadata: { role: user.role, auth: user.passwordHash ? 'local' : 'xui' },
      },
      { deviceId: deviceId ?? null },
    );
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

function fingerprintFromUserAgent(userAgent: string | null | undefined): string {
  const raw = (userAgent ?? 'web').trim().toLowerCase();
  const normalized = raw
    .replace(/\d+(\.\d+)+/gu, 'x')
    .replace(/\s+/gu, ' ')
    .slice(0, 120)
    .trim();
  return `ua:${normalized || 'web'}`;
}

function mapPlatform(value: string | undefined, userAgent?: string | null): DevicePlatformCode {
  const raw = (value ?? userAgent ?? '').toLowerCase();
  if (raw.includes('android')) {
    return 'ANDROID';
  }
  if (raw.includes('iphone') || raw.includes('ipad') || raw === 'ios') {
    return 'IOS';
  }
  if (
    raw.includes('tv') ||
    raw.includes('tizen') ||
    raw.includes('webos') ||
    raw.includes('bravia')
  ) {
    return 'TV';
  }
  if (
    raw.includes('mozilla') ||
    raw === 'web' ||
    raw.includes('chrome') ||
    raw.includes('safari')
  ) {
    return 'WEB';
  }
  return 'OTHER';
}
