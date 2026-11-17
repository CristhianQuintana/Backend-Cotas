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
import {
  AUTH_IDENTITY_REPOSITORY,
  LINE_ACCESS,
  PASSWORD_HASHER,
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
  type AuthIdentityRepository,
  type DevicePlatformCode,
  type LineAccess,
  type PasswordHasher,
  type SessionRepository,
  type TokenService,
  type UserRepository,
} from '../../domain/ports/identity.ports';
import { GoogleIdTokenVerifier } from '../../infrastructure/google/google-id-token.verifier';
import type { LoginResult } from './login.use-case';

export interface GoogleLoginCommand {
  idToken: string;
  password?: string;
  deviceId?: string;
  platform?: string;
  deviceName?: string;
  meta: RequestMeta;
  /** Si true, exige password para vincular cuenta existente (endpoint /auth/google/link). */
  linking?: boolean;
}

@Injectable()
export class GoogleLoginUseCase {
  constructor(
    @Inject(GoogleIdTokenVerifier) private readonly google: GoogleIdTokenVerifier,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUTH_IDENTITY_REPOSITORY) private readonly identities: AuthIdentityRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: GoogleLoginCommand): Promise<LoginResult> {
    const identity = await this.google.verify(command.idToken);
    const existingLink = await this.identities.findByProviderSubject('google', identity.subject);
    if (existingLink) {
      const user = await this.users.findById(existingLink.userId);
      if (!user || user.status !== 'ACTIVE') {
        throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
      }
      return this.issueSession(user, command, 'google');
    }

    const byEmail = await this.users.findByEmail(identity.email);
    if (byEmail) {
      if (!command.linking) {
        await this.audit.record({
          action: 'auth.google',
          result: 'failure',
          actorUserId: byEmail.id,
          correlationId: command.meta.correlationId,
          ipAddress: command.meta.ipAddress,
          metadata: { reason: 'account_link_required' },
        });
        throw new DomainError(
          ErrorCodes.accountLinkRequired,
          409,
          PublicMessages.accountLinkRequired,
        );
      }
      if (!byEmail.passwordHash) {
        throw new DomainError(
          ErrorCodes.accountLinkRequired,
          409,
          PublicMessages.accountLinkRequired,
        );
      }
      const password = command.password?.trim() ?? '';
      const valid = await this.passwords.verify(password, byEmail.passwordHash);
      if (!valid) {
        throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
      }
      if (byEmail.status !== 'ACTIVE') {
        throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
      }
      await this.identities.linkGoogleIdentity({
        userId: byEmail.id,
        subject: identity.subject,
        email: identity.email,
        emailVerified: identity.emailVerified,
        now: this.clock.now(),
      });
      return this.issueSession(byEmail, command, 'google_link');
    }

    if (command.linking) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }

    const username = await this.allocateUsername(identity.email);
    const user = await this.users.createLocalUser({
      username,
      passwordHash: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      now: this.clock.now(),
      email: identity.email,
      displayName: identity.name,
      emailVerifiedAt: this.clock.now(),
    });
    await this.identities.linkGoogleIdentity({
      userId: user.id,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      now: this.clock.now(),
    });
    return this.issueSession(user, command, 'google_signup');
  }

  private async allocateUsername(email: string): Promise<string> {
    const base = email
      .split('@')[0]!
      .toLowerCase()
      .replace(/[^a-z0-9._-]/gu, '')
      .slice(0, 40);
    const seed = base.length >= 3 ? base : `user${Date.now().toString(36)}`;
    for (let i = 0; i < 8; i += 1) {
      const candidate = i === 0 ? seed : `${seed}${i}`;
      const existing = await this.users.findByUsername(candidate);
      if (!existing) {
        return candidate;
      }
    }
    return `g${newId().replace(/-/gu, '').slice(0, 16)}`;
  }

  private async issueSession(
    user: UserRecord,
    command: GoogleLoginCommand,
    auth: string,
  ): Promise<Extract<LoginResult, { type: 'authenticated' }>> {
    const now = this.clock.now();
    const clientDeviceId =
      command.deviceId?.trim() || `ua:${(command.meta.userAgent ?? 'web').slice(0, 80)}`;
    let deviceId: string | undefined;
    try {
      deviceId = await this.lines.claimDeviceSlot({
        userId: user.id,
        clientDeviceId,
        platform: mapPlatform(command.platform),
        deviceName: command.deviceName ?? null,
        maxDevices: this.config.deviceLimitFailsafe,
        now,
        onLimit: 'displace',
      });
    } catch {
      deviceId = undefined;
    }

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
      userAgent: command.meta.userAgent,
    };
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      sid: session.id,
      role: user.role,
    });
    await this.sessions.create(
      session,
      {
        action: 'auth.google',
        result: 'success',
        actorUserId: user.id,
        correlationId: command.meta.correlationId,
        ipAddress: command.meta.ipAddress,
        metadata: { auth, audience: 'google' },
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
}

function mapPlatform(platform?: string): DevicePlatformCode {
  const value = (platform ?? '').trim().toLowerCase();
  if (value.includes('android')) return 'ANDROID';
  if (value.includes('ios')) return 'IOS';
  if (value.includes('tv') || value.includes('tizen') || value.includes('samsung')) return 'TV';
  if (value.includes('web')) return 'WEB';
  return 'OTHER';
}
