import { createHash, randomInt } from 'node:crypto';
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
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import type { SessionRecord } from '../../domain/models/session';
import {
  DEVICE_LINK_REPOSITORY,
  LINE_ACCESS,
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
  type DeviceLinkRepository,
  type DevicePlatformCode,
  type LineAccess,
  type SessionRepository,
  type TokenService,
  type UserRepository,
} from '../../domain/ports/identity.ports';

const LINK_TTL_SECONDS = 120;
/** Intervalo recomendado al TV: lo bastante corto para entrar al Home en ≤1 s tras approve. */
const POLL_INTERVAL_MS = 1_000;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

export type CreateDeviceLinkResult = {
  linkCode: string;
  qrPayload: string;
  expiresIn: number;
  pollIntervalMs: number;
  deviceId: string;
};

export type PollDeviceLinkResult =
  | { status: 'pending'; expiresIn: number }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'consumed' }
  | {
      status: 'approved';
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType: 'Bearer';
      device: { id: string; deviceName: string | null; platform: DevicePlatformCode };
    };

export type ApproveDeviceLinkResult = {
  status: 'approved';
  device: {
    id: string;
    deviceName: string | null;
    platform: DevicePlatformCode;
    createdAt: string;
  };
  used: number;
  limit: number | null;
};

@Injectable()
export class DeviceLinkUseCase {
  constructor(
    @Inject(DEVICE_LINK_REPOSITORY) private readonly links: DeviceLinkRepository,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createSession(input: {
    deviceId: string;
    platform?: string;
    deviceName?: string;
  }): Promise<CreateDeviceLinkResult> {
    const clientDeviceId = input.deviceId.trim();
    const now = this.clock.now();
    const linkCode = generateLinkCode();
    const expiresAt = new Date(now.getTime() + LINK_TTL_SECONDS * 1000);
    await this.links.createChallenge({
      codeHash: hashLinkCode(linkCode),
      tvClientDeviceId: clientDeviceId,
      tvClientDeviceIdHash: hashClientDeviceId(clientDeviceId),
      platform: mapPlatform(input.platform),
      deviceName: input.deviceName ?? null,
      expiresAt,
      now,
    });
    return {
      linkCode,
      qrPayload: buildQrPayload(linkCode),
      expiresIn: LINK_TTL_SECONDS,
      pollIntervalMs: POLL_INTERVAL_MS,
      deviceId: clientDeviceId,
    };
  }

  async approve(
    user: AuthenticatedUser,
    input: { linkCode: string; deviceName?: string },
    meta: RequestMeta,
  ): Promise<ApproveDeviceLinkResult> {
    const now = this.clock.now();
    const codeHash = hashLinkCode(input.linkCode);
    let challenge = await this.links.findByCodeHash(codeHash);
    if (!challenge) {
      throw new DomainError(ErrorCodes.deviceLinkInvalid, 404, PublicMessages.deviceLinkInvalid);
    }
    if (challenge.status === 'PENDING' && challenge.expiresAt <= now) {
      challenge = (await this.links.markExpiredIfNeeded(challenge.id, now)) ?? challenge;
    }
    if (challenge.status === 'EXPIRED') {
      throw new DomainError(ErrorCodes.deviceLinkExpired, 410, PublicMessages.deviceLinkExpired);
    }
    if (challenge.status === 'CONSUMED') {
      throw new DomainError(ErrorCodes.deviceLinkConsumed, 409, PublicMessages.deviceLinkConsumed);
    }
    if (challenge.status !== 'PENDING') {
      throw new DomainError(ErrorCodes.deviceLinkInvalid, 409, PublicMessages.deviceLinkInvalid);
    }

    const snapshot = await this.lines.getSubscriptionSnapshot(user.id);
    const maxDevices = snapshot?.maxConnections ?? null;
    const deviceName =
      input.deviceName?.trim() || challenge.deviceName || defaultTvName(challenge.platform);

    const deviceId = await this.lines.claimDeviceSlot({
      userId: user.id,
      clientDeviceId: challenge.tvClientDeviceId,
      platform: challenge.platform,
      deviceName,
      maxDevices,
      now,
      onLimit: 'reject',
    });

    await this.links.markApproved({
      codeHash,
      approverUserId: user.id,
      deviceId,
      deviceName,
      now,
    });

    await this.audit.record({
      action: 'auth.device_link_approve',
      result: 'success',
      actorUserId: user.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: { deviceId, linkId: challenge.id },
    });

    const devices = await this.lines.listDevices(user.id, user.deviceId);
    const device = devices.items.find((item) => item.id === deviceId);
    return {
      status: 'approved',
      device: {
        id: deviceId,
        deviceName: device?.deviceName ?? deviceName,
        platform: challenge.platform,
        createdAt: device?.createdAt ?? now.toISOString(),
      },
      used: devices.used,
      limit: devices.limit,
    };
  }

  async poll(
    input: { linkCode: string; deviceId: string },
    meta: RequestMeta,
  ): Promise<PollDeviceLinkResult> {
    const now = this.clock.now();
    const codeHash = hashLinkCode(input.linkCode);
    const clientHash = hashClientDeviceId(input.deviceId);
    let challenge = await this.links.findByCodeHash(codeHash);
    if (!challenge || challenge.tvClientDeviceIdHash !== clientHash) {
      throw new DomainError(ErrorCodes.deviceLinkInvalid, 404, PublicMessages.deviceLinkInvalid);
    }

    if (challenge.status === 'PENDING' && challenge.expiresAt <= now) {
      challenge = (await this.links.markExpiredIfNeeded(challenge.id, now)) ?? challenge;
    }

    if (challenge.status === 'PENDING') {
      const expiresIn = Math.max(
        0,
        Math.ceil((challenge.expiresAt.getTime() - now.getTime()) / 1000),
      );
      return { status: 'pending', expiresIn };
    }
    if (challenge.status === 'EXPIRED') {
      return { status: 'expired' };
    }
    if (challenge.status === 'DENIED') {
      return { status: 'denied' };
    }
    if (challenge.status === 'CONSUMED') {
      return { status: 'consumed' };
    }
    if (challenge.status !== 'APPROVED' || !challenge.approverUserId || !challenge.deviceId) {
      throw new DomainError(ErrorCodes.deviceLinkInvalid, 409, PublicMessages.deviceLinkInvalid);
    }

    const consumed = await this.links.markConsumed(challenge.id, now);
    if (!consumed) {
      return { status: 'consumed' };
    }

    const user = await this.users.findById(challenge.approverUserId);
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
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
        action: 'auth.device_link_redeem',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
        metadata: { deviceId: challenge.deviceId, linkId: challenge.id },
      },
      { deviceId: challenge.deviceId },
    );
    await this.users.touchLastLogin(user.id, now);

    return {
      status: 'approved',
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
      tokenType: 'Bearer',
      device: {
        id: challenge.deviceId,
        deviceName: challenge.deviceName,
        platform: challenge.platform,
      },
    };
  }
}

export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export function hashClientDeviceId(clientDeviceId: string): string {
  return createHash('sha256').update(clientDeviceId.trim().toLowerCase()).digest('hex');
}

function generateLinkCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

function buildQrPayload(linkCode: string): string {
  return `cotas://device-link?code=${encodeURIComponent(linkCode)}`;
}

function mapPlatform(value: string | undefined): DevicePlatformCode {
  const raw = (value ?? 'tv').toLowerCase();
  if (raw.includes('android')) {
    return 'ANDROID';
  }
  if (raw.includes('ios') || raw.includes('iphone') || raw.includes('ipad')) {
    return 'IOS';
  }
  if (
    raw.includes('tv') ||
    raw.includes('tizen') ||
    raw.includes('webos') ||
    raw.includes('bravia') ||
    raw.includes('samsung') ||
    raw.includes('lg')
  ) {
    return 'TV';
  }
  if (raw.includes('web') || raw.includes('chrome')) {
    return 'WEB';
  }
  return 'OTHER';
}

function defaultTvName(platform: DevicePlatformCode): string {
  return platform === 'TV' ? 'Televisor' : 'Dispositivo TV';
}
