import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type UserMfaMethod } from '@prisma/client';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { newId } from '../../../../common/utils/ids';
import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';
import { rethrowAsDomain } from '../../../../infrastructure/database/prisma-errors';
import { auditCreateData } from '../../../audit/infrastructure/audit-record';
import type { AuditDraft } from '../../../audit/domain/audit-draft';
import {
  isStaffRole,
  isUserRole,
  primaryRole,
  type UserRecord,
  type UserRole,
  type UserStatus,
} from '../../domain/models/authenticated-user';
import type { RevocationReason, RotateResult, SessionRecord } from '../../domain/models/session';
import {
  MFA_CIPHER,
  type AcceptLineInput,
  type AcceptLineResult,
  type ApproveDeviceLinkChallengeInput,
  type CreateDeviceLinkChallengeInput,
  type CreateLocalUserInput,
  DEVICE_INACTIVE_AFTER_SECONDS,
  type DeviceLinkChallengeRecord,
  type DeviceLinkRepository,
  type DeviceLinkStatusCode,
  type DevicePresenceCode,
  type DeviceQuotaView,
  type DeviceRegistrationInput,
  type LineAccess,
  type LineCredentials,
  type LineSnapshotInput,
  type MfaSecretCipher,
  type RecoveryCodeRepository,
  type SessionRepository,
  type SubscriptionSnapshot,
  type UpdateLocalUserInput,
  type UserRepository,
} from '../../domain/ports/identity.ports';

const userGraph = {
  userRoles: { include: { role: true } },
  mfaMethods: true,
} satisfies Prisma.UserInclude;

type UserGraph = Prisma.UserGetPayload<{ include: typeof userGraph }>;

const RECOVERY_TTL_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class PrismaIdentityStore
  implements
    UserRepository,
    SessionRepository,
    RecoveryCodeRepository,
    LineAccess,
    DeviceLinkRepository
{
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MFA_CIPHER) private readonly cipher: MfaSecretCipher,
  ) {}

  async findByUsername(username: string): Promise<UserRecord | null> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { username, deletedAt: null },
        include: userGraph,
      });
      return user ? toUser(user) : null;
    } catch (error) {
      bubble(error);
    }
  }

  async findById(id: string): Promise<UserRecord | null> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { id, deletedAt: null },
        include: userGraph,
      });
      return user ? toUser(user) : null;
    } catch (error) {
      bubble(error);
    }
  }

  async listUsers(page: number, limit: number): Promise<{ total: number; items: UserRecord[] }> {
    try {
      const where = { deletedAt: null };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.user.count({ where }),
        this.prisma.user.findMany({
          where,
          include: userGraph,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);
      return { total, items: rows.map(toUser) };
    } catch (error) {
      bubble(error);
    }
  }

  async createLocalUser(input: CreateLocalUserInput): Promise<UserRecord> {
    try {
      const role = await this.prisma.role.findUnique({ where: { code: input.role } });
      if (!role) {
        throw new DomainError(ErrorCodes.internal, 500, PublicMessages.internal);
      }
      const id = newId();
      await this.prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id,
            username: input.username,
            passwordHash: input.passwordHash,
            passwordChangedAt: input.now,
            status: input.status,
          },
        });
        await tx.userRoleLink.create({
          data: { userId: id, roleId: role.id },
        });
      });
      const user = await this.findById(id);
      if (!user) {
        throw new DomainError(ErrorCodes.internal, 500, PublicMessages.internal);
      }
      return user;
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new DomainError(ErrorCodes.conflict, 409, PublicMessages.conflict);
      }
      bubble(error);
    }
  }

  async updateLocalUser(input: UpdateLocalUserInput): Promise<UserRecord> {
    try {
      await this.prisma.$transaction(async (tx) => {
        if (input.status) {
          await tx.user.update({
            where: { id: input.id },
            data: { status: input.status },
          });
        }
        if (input.role) {
          const role = await tx.role.findUnique({ where: { code: input.role } });
          if (!role) {
            throw new DomainError(ErrorCodes.internal, 500, PublicMessages.internal);
          }
          await tx.userRoleLink.deleteMany({ where: { userId: input.id } });
          await tx.userRoleLink.create({
            data: { userId: input.id, roleId: role.id },
          });
        }
      });
      const user = await this.findById(input.id);
      if (!user) {
        throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
      }
      return user;
    } catch (error) {
      bubble(error);
    }
  }

  async setPasswordHash(id: string, passwordHash: string, now: Date): Promise<void> {
    try {
      const updated = await this.prisma.user.updateMany({
        where: { id, deletedAt: null },
        data: { passwordHash, passwordChangedAt: now },
      });
      if (updated.count !== 1) {
        throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
      }
    } catch (error) {
      bubble(error);
    }
  }

  async touchLastLogin(id: string, now: Date): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { id, deletedAt: null },
        data: { lastLoginAt: now },
      });
    } catch (error) {
      bubble(error);
    }
  }

  async saveMfaSecret(id: string, secretCiphertext: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const active = await tx.userMfaMethod.findFirst({
          where: { userId: id, method: 'TOTP', status: 'ACTIVE' },
        });
        if (active) {
          throw new DomainError(
            ErrorCodes.mfaAlreadyEnabled,
            409,
            PublicMessages.mfaAlreadyEnabled,
          );
        }
        const pending = await tx.userMfaMethod.findFirst({
          where: { userId: id, method: 'TOTP', status: 'PENDING' },
        });
        if (pending) {
          await tx.userMfaMethod.update({
            where: { id: pending.id },
            data: { secretEncrypted: secretCiphertext },
          });
          return;
        }
        await tx.userMfaMethod.create({
          data: {
            id: newId(),
            userId: id,
            method: 'TOTP',
            secretEncrypted: secretCiphertext,
            status: 'PENDING',
          },
        });
      });
    } catch (error) {
      bubble(error);
    }
  }

  async enableMfa(id: string): Promise<void> {
    try {
      const updated = await this.prisma.userMfaMethod.updateMany({
        where: { userId: id, method: 'TOTP', status: 'PENDING', secretEncrypted: { not: null } },
        data: { status: 'ACTIVE', confirmedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new DomainError(ErrorCodes.mfaAlreadyEnabled, 409, PublicMessages.mfaAlreadyEnabled);
      }
    } catch (error) {
      bubble(error);
    }
  }

  async acceptLine(input: AcceptLineInput): Promise<AcceptLineResult> {
    try {
      return await this.writeLine(input);
    } catch (error) {
      if (isUniqueConflict(error)) {
        try {
          return await this.writeLine(input);
        } catch (retryError) {
          bubble(retryError);
        }
      }
      bubble(error);
    }
  }

  async credentialsFor(userId: string): Promise<LineCredentials> {
    try {
      const account = await this.prisma.iptvAccount.findFirst({
        where: { userId, provider: 'XUI', status: 'ACTIVE' },
      });
      if (!account?.username || !account.passwordEncrypted) {
        throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
      }
      return {
        username: account.username,
        password: this.cipher.decrypt(account.passwordEncrypted),
      };
    } catch (error) {
      bubble(error);
    }
  }

  async revokeDevice(
    deviceId: string,
    userId: string,
    now: Date,
  ): Promise<'revoked' | 'not_found'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.device.updateMany({
          where: { id: deviceId, userId, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: now },
        });
        if (updated.count !== 1) {
          return 'not_found';
        }
        await tx.userSession.updateMany({
          where: { deviceId, userId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'SECURITY' },
        });
        return 'revoked';
      });
    } catch (error) {
      bubble(error);
    }
  }

  async claimDeviceSlot(input: DeviceRegistrationInput): Promise<string> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const hash = hashClientDeviceId(input.clientDeviceId);
        const existing = await tx.device.findFirst({
          where: { userId: input.userId, deviceIdentifierHash: hash },
        });
        // Libera slots “fantasma”: ACTIVE sin sesión viva (logout/expiración sin liberar el cupo).
        await revokeOrphanDevicesInTx(tx, input.userId, input.now, existing?.id ?? null);
        if (existing) {
          if (existing.status !== 'ACTIVE' && input.maxDevices !== null && input.maxDevices >= 1) {
            const active = await tx.device.count({
              where: { userId: input.userId, status: 'ACTIVE' },
            });
            if (active >= input.maxDevices && input.onLimit === 'reject') {
              throw new DomainError(ErrorCodes.deviceLimit, 403, PublicMessages.deviceLimit, [
                { field: 'used', rules: [String(active)] },
                { field: 'limit', rules: [String(input.maxDevices)] },
              ]);
            }
            // No liberar hueco por adelantado: al reactivar se aplica oldest-win.
            // Si este aparato es de los más nuevos, abajo queda REVOKED → DEVICE_LIMIT.
          }
          await tx.device.update({
            where: { id: existing.id },
            data: {
              status: 'ACTIVE',
              revokedAt: null,
              lastSeenAt: input.now,
              inactiveNotifiedAt: null,
              platform: input.platform,
              deviceName: input.deviceName?.trim().slice(0, 80) || existing.deviceName,
            },
          });
          await enforceDeviceQuotaInTx(tx, input.userId, input.maxDevices, input.now, null);
          const stillActive = await tx.device.findFirst({
            where: { id: existing.id, userId: input.userId, status: 'ACTIVE' },
          });
          if (!stillActive) {
            // Cupo reducido / cupo lleno: este aparato es de los más nuevos → mensaje claro.
            const used = await tx.device.count({
              where: { userId: input.userId, status: 'ACTIVE' },
            });
            throw new DomainError(ErrorCodes.deviceLimit, 403, PublicMessages.deviceLimit, [
              { field: 'used', rules: [String(used)] },
              { field: 'limit', rules: [String(input.maxDevices ?? 0)] },
            ]);
          }
          return existing.id;
        }

        if (input.maxDevices !== null && input.maxDevices >= 1) {
          const active = await tx.device.count({
            where: { userId: input.userId, status: 'ACTIVE' },
          });
          if (active >= input.maxDevices) {
            if (input.onLimit === 'reject') {
              throw new DomainError(ErrorCodes.deviceLimit, 403, PublicMessages.deviceLimit, [
                { field: 'used', rules: [String(active)] },
                { field: 'limit', rules: [String(input.maxDevices)] },
              ]);
            }
            // Login clave: libera hueco cerrando un aparato más nuevo (antiguos se priorizan).
            await enforceDeviceQuotaInTx(
              tx,
              input.userId,
              Math.max(input.maxDevices - 1, 0),
              input.now,
              null,
            );
          }
        }

        const created = await tx.device.create({
          data: {
            id: newId(),
            userId: input.userId,
            platform: input.platform,
            deviceName: input.deviceName?.trim().slice(0, 80) || null,
            deviceIdentifierHash: hash,
            status: 'ACTIVE',
            lastSeenAt: input.now,
          },
        });
        return created.id;
      });
    } catch (error) {
      bubble(error);
    }
  }

  async listDevices(userId: string, currentDeviceId: string | null): Promise<DeviceQuotaView> {
    try {
      const now = new Date();
      await this.prisma.$transaction(async (tx) =>
        revokeOrphanDevicesInTx(tx, userId, now, currentDeviceId),
      );
      const [rows, snapshot] = await Promise.all([
        this.prisma.device.findMany({
          where: { userId, status: 'ACTIVE' },
          orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
        }),
        this.getSubscriptionSnapshot(userId),
      ]);
      const inactiveAfterMs = DEVICE_INACTIVE_AFTER_SECONDS * 1000;
      const items = rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        deviceName: row.deviceName,
        status: row.status as 'ACTIVE' | 'REVOKED',
        presence: presenceOf(row.lastSeenAt, now, inactiveAfterMs),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        current: currentDeviceId !== null && row.id === currentDeviceId,
      }));
      return {
        used: items.length,
        limit: snapshot?.maxConnections ?? null,
        inactiveAfterSeconds: DEVICE_INACTIVE_AFTER_SECONDS,
        items,
      };
    } catch (error) {
      bubble(error);
    }
  }

  async touchDevicePresence(
    userId: string,
    deviceId: string,
    now: Date,
  ): Promise<'ok' | 'not_found'> {
    try {
      const updated = await this.prisma.device.updateMany({
        where: { id: deviceId, userId, status: 'ACTIVE' },
        data: { lastSeenAt: now, inactiveNotifiedAt: null },
      });
      return updated.count === 1 ? 'ok' : 'not_found';
    } catch (error) {
      bubble(error);
    }
  }

  async claimNewlyInactiveDevices(
    now: Date,
    limit = 50,
  ): Promise<Array<{ userId: string; deviceId: string; deviceName: string | null }>> {
    try {
      const threshold = new Date(now.getTime() - DEVICE_INACTIVE_AFTER_SECONDS * 1000);
      const candidates = await this.prisma.device.findMany({
        where: {
          status: 'ACTIVE',
          inactiveNotifiedAt: null,
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }],
        },
        select: { id: true, userId: true, deviceName: true },
        take: Math.max(1, Math.min(limit, 200)),
        orderBy: { lastSeenAt: 'asc' },
      });
      const claimed: Array<{ userId: string; deviceId: string; deviceName: string | null }> = [];
      for (const row of candidates) {
        const marked = await this.prisma.device.updateMany({
          where: { id: row.id, status: 'ACTIVE', inactiveNotifiedAt: null },
          data: { inactiveNotifiedAt: now },
        });
        if (marked.count === 1) {
          claimed.push({
            userId: row.userId,
            deviceId: row.id,
            deviceName: row.deviceName,
          });
        }
      }
      return claimed;
    } catch (error) {
      bubble(error);
    }
  }

  async enforceDeviceQuota(
    userId: string,
    maxDevices: number | null,
    now: Date,
    keepDeviceId?: string | null,
  ): Promise<number> {
    try {
      return await this.prisma.$transaction(async (tx) =>
        enforceDeviceQuotaInTx(tx, userId, maxDevices, now, keepDeviceId ?? null),
      );
    } catch (error) {
      bubble(error);
    }
  }

  async create(
    session: SessionRecord,
    audit: AuditDraft,
    options?: { deviceId?: string | null },
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const deviceId =
          options?.deviceId ??
          (await touchDevice(tx, session.userId, session.userAgent, session.createdAt));
        // Mismo deviceId → una sola sesión viva (re-login reemplaza tokens).
        if (deviceId) {
          await tx.userSession.updateMany({
            where: { deviceId, userId: session.userId, revokedAt: null },
            data: { revokedAt: session.createdAt, revokeReason: 'SECURITY' },
          });
        }
        await tx.userSession.create({
          data: toSessionData(session, { deviceId, ipAddress: audit.ipAddress }),
        });
        await tx.auditLog.create({ data: auditData(audit, session.userId) });
      });
    } catch (error) {
      bubble(error);
    }
  }

  async findSessionById(id: string): Promise<SessionRecord | null> {
    try {
      const session = await this.prisma.userSession.findUnique({ where: { id } });
      return session ? toSession(session) : null;
    } catch (error) {
      bubble(error);
    }
  }

  async listActiveByUser(userId: string, now: Date): Promise<SessionRecord[]> {
    try {
      const sessions = await this.prisma.userSession.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      });
      return sessions.map(toSession);
    } catch (error) {
      bubble(error);
    }
  }

  async rotate(
    currentHash: string,
    next: SessionRecord,
    successAudit: AuditDraft,
    reuseAudit: AuditDraft,
    now: Date,
  ): Promise<RotateResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.userSession.findUnique({
          where: { refreshTokenHash: currentHash },
        });
        if (!current) {
          return { type: 'not_found' };
        }
        const reused =
          current.revokeReason === 'ROTATED' ||
          current.revokeReason === 'REUSE' ||
          current.replacedById !== null;
        if (reused) {
          await tx.userSession.updateMany({
            where: { familyId: current.familyId, revokedAt: null },
            data: { revokedAt: now, revokeReason: 'REUSE' },
          });
          await tx.auditLog.create({ data: auditData(reuseAudit, current.userId) });
          return { type: 'reuse' };
        }
        if (current.revokedAt) {
          return { type: 'not_found' };
        }
        if (current.expiresAt <= now) {
          return { type: 'expired' };
        }
        const updated = await tx.userSession.updateMany({
          where: { id: current.id, revokedAt: null, replacedById: null },
          data: { revokedAt: now, revokeReason: 'ROTATED', replacedById: next.id },
        });
        if (updated.count !== 1) {
          await tx.userSession.updateMany({
            where: { familyId: current.familyId, revokedAt: null },
            data: { revokedAt: now, revokeReason: 'REUSE' },
          });
          await tx.auditLog.create({ data: auditData(reuseAudit, current.userId) });
          return { type: 'reuse' };
        }
        await tx.userSession.create({
          data: toSessionData(
            { ...next, userId: current.userId, familyId: current.familyId },
            { deviceId: current.deviceId, ipAddress: successAudit.ipAddress },
          ),
        });
        await tx.auditLog.create({ data: auditData(successAudit, current.userId) });
        return { type: 'rotated', userId: current.userId, sessionId: next.id };
      });
    } catch (error) {
      bubble(error);
    }
  }

  async revokeOwned(
    id: string,
    userId: string,
    reason: RevocationReason,
    audit: AuditDraft,
    now: Date,
  ): Promise<'revoked' | 'not_found'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.userSession.findFirst({
          where: { id, userId, revokedAt: null },
          select: { id: true, deviceId: true },
        });
        if (!current) {
          return 'not_found';
        }
        await tx.userSession.update({
          where: { id: current.id },
          data: { revokedAt: now, revokeReason: reason },
        });
        // Logout libera el cupo: sin más sesiones vivas en ese aparato → REVOKED.
        if (current.deviceId) {
          const liveOnDevice = await tx.userSession.count({
            where: {
              deviceId: current.deviceId,
              userId,
              revokedAt: null,
              expiresAt: { gt: now },
            },
          });
          if (liveOnDevice === 0) {
            await tx.device.updateMany({
              where: { id: current.deviceId, userId, status: 'ACTIVE' },
              data: { status: 'REVOKED', revokedAt: now },
            });
          }
        }
        await tx.auditLog.create({ data: auditData(audit, userId) });
        return 'revoked';
      });
    } catch (error) {
      bubble(error);
    }
  }

  async replaceAndEnable(userId: string, codeHashes: readonly string[]): Promise<void> {
    try {
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        const pending = await tx.userMfaMethod.findFirst({
          where: { userId, method: 'TOTP', status: 'PENDING', secretEncrypted: { not: null } },
        });
        const active = await tx.userMfaMethod.findFirst({
          where: { userId, method: 'TOTP', status: 'ACTIVE' },
        });
        if (!pending || active) {
          throw new DomainError(
            ErrorCodes.mfaAlreadyEnabled,
            409,
            PublicMessages.mfaAlreadyEnabled,
          );
        }
        await tx.userMfaMethod.update({
          where: { id: pending.id },
          data: { status: 'ACTIVE', confirmedAt: now },
        });
        await tx.authChallenge.deleteMany({
          where: { userId, purpose: 'MFA_RECOVERY', consumedAt: null },
        });
        await tx.authChallenge.createMany({
          data: codeHashes.map((tokenHash) => ({
            id: newId(),
            userId,
            purpose: 'MFA_RECOVERY' as const,
            tokenHash,
            expiresAt: new Date(now.getTime() + RECOVERY_TTL_MS),
          })),
        });
      });
    } catch (error) {
      bubble(error);
    }
  }

  async consume(userId: string, codeHash: string, now: Date): Promise<boolean> {
    try {
      const updated = await this.prisma.authChallenge.updateMany({
        where: {
          userId,
          tokenHash: codeHash,
          purpose: 'MFA_RECOVERY',
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      return updated.count === 1;
    } catch (error) {
      bubble(error);
    }
  }

  async saveLineSnapshot(userId: string, snapshot: LineSnapshotInput, now: Date): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await applyLineSnapshot(tx, userId, snapshot, now);
      });
    } catch (error) {
      bubble(error);
    }
  }

  async getSubscriptionSnapshot(userId: string): Promise<SubscriptionSnapshot | null> {
    try {
      const [user, account] = await Promise.all([
        this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } }),
        this.prisma.iptvAccount.findFirst({
          where: { userId, provider: 'XUI', status: 'ACTIVE' },
        }),
      ]);
      if (!user || !account) {
        return null;
      }
      return {
        displayName: user.displayName ?? account.displayNameSnapshot ?? account.username,
        username: account.username,
        expiresAt: account.expiresAt?.toISOString() ?? null,
        maxConnections: account.maxConnections,
        activeConnections: account.activeConnections,
        status: account.status,
        lastVerifiedAt: account.lastVerifiedAt?.toISOString() ?? null,
        source: 'cache',
      };
    } catch (error) {
      bubble(error);
    }
  }

  async setPushToken(
    userId: string,
    sessionId: string,
    token: string,
    platform: string,
    now: Date,
  ): Promise<void> {
    try {
      const session = await this.prisma.userSession.findFirst({
        where: { id: sessionId, userId, revokedAt: null },
      });
      if (!session?.deviceId) {
        throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
      }
      const updated = await this.prisma.device.updateMany({
        where: { id: session.deviceId, userId, status: 'ACTIVE' },
        data: { pushToken: token, pushPlatform: platform, lastSeenAt: now },
      });
      if (updated.count !== 1) {
        throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
      }
    } catch (error) {
      bubble(error);
    }
  }

  async listPushTokens(userId: string, excludeDeviceId?: string | null): Promise<string[]> {
    try {
      const rows = await this.prisma.device.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          pushToken: { not: null },
          ...(excludeDeviceId ? { id: { not: excludeDeviceId } } : {}),
        },
        select: { pushToken: true },
      });
      const unique = new Set<string>();
      for (const row of rows) {
        if (row.pushToken) {
          unique.add(row.pushToken);
        }
      }
      return [...unique];
    } catch (error) {
      bubble(error);
    }
  }

  private async writeLine(input: AcceptLineInput): Promise<AcceptLineResult> {
    const username = input.username.trim();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { username, deletedAt: null },
        include: userGraph,
      });
      if (existing && existing.status !== 'ACTIVE') {
        return { ok: false, reason: 'blocked' };
      }
      if (existing) {
        const roles = existing.userRoles.map((link) => link.role.code).filter(isUserRole);
        if (isStaffRole(primaryRole(roles)) || existing.passwordHash) {
          return { ok: false, reason: 'blocked' };
        }
      }
      const userId = existing?.id ?? newId();
      const displayName = input.snapshot?.displayName ?? null;
      if (!existing) {
        const role = await tx.role.findUnique({ where: { code: 'CUSTOMER' } });
        if (!role) {
          throw new DomainError(ErrorCodes.internal, 500, PublicMessages.internal);
        }
        await tx.user.create({
          data: {
            id: userId,
            username,
            displayName,
            status: 'ACTIVE',
            lastLoginAt: input.now,
            userRoles: { create: { roleId: role.id } },
          },
        });
      } else {
        await tx.user.update({
          where: { id: userId },
          data: {
            lastLoginAt: input.now,
            ...(displayName ? { displayName } : {}),
          },
        });
        if (existing.userRoles.length === 0) {
          const role = await tx.role.findUnique({ where: { code: 'CUSTOMER' } });
          if (role) {
            await tx.userRoleLink.create({ data: { userId, roleId: role.id } });
          }
        }
      }
      const encrypted = this.cipher.encrypt(input.password);
      const account = await tx.iptvAccount.findFirst({
        where: { userId, provider: 'XUI', status: 'ACTIVE' },
      });
      const snapshotFields = lineAccountFields(input.snapshot, input.now);
      if (account) {
        await tx.iptvAccount.update({
          where: { id: account.id },
          data: {
            username,
            externalAccountRef: username,
            passwordEncrypted: encrypted,
            ...snapshotFields,
          },
        });
      } else {
        await tx.iptvAccount.create({
          data: {
            id: newId(),
            userId,
            provider: 'XUI',
            externalAccountRef: username,
            username,
            passwordEncrypted: encrypted,
            status: 'ACTIVE',
            ...snapshotFields,
          },
        });
      }
      const fresh = await tx.user.findFirst({ where: { id: userId }, include: userGraph });
      if (!fresh) {
        throw new DomainError(ErrorCodes.internal, 500, PublicMessages.internal);
      }
      return { ok: true, user: toUser(fresh) };
    });
  }

  async createChallenge(input: CreateDeviceLinkChallengeInput): Promise<DeviceLinkChallengeRecord> {
    try {
      const row = await this.prisma.deviceLinkChallenge.create({
        data: {
          id: newId(),
          codeHash: input.codeHash,
          tvClientDeviceId: input.tvClientDeviceId.trim().slice(0, 128),
          tvClientDeviceIdHash: input.tvClientDeviceIdHash,
          platform: input.platform,
          deviceName: input.deviceName?.trim().slice(0, 80) || null,
          status: 'PENDING',
          expiresAt: input.expiresAt,
          createdAt: input.now,
        },
      });
      return toDeviceLink(row);
    } catch (error) {
      bubble(error);
    }
  }

  async findByCodeHash(codeHash: string): Promise<DeviceLinkChallengeRecord | null> {
    try {
      const row = await this.prisma.deviceLinkChallenge.findUnique({ where: { codeHash } });
      return row ? toDeviceLink(row) : null;
    } catch (error) {
      bubble(error);
    }
  }

  async markApproved(input: ApproveDeviceLinkChallengeInput): Promise<DeviceLinkChallengeRecord> {
    try {
      const updated = await this.prisma.deviceLinkChallenge.updateMany({
        where: { codeHash: input.codeHash, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedAt: input.now,
          approverUserId: input.approverUserId,
          deviceId: input.deviceId,
          deviceName: input.deviceName?.trim().slice(0, 80) || undefined,
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(ErrorCodes.deviceLinkInvalid, 409, PublicMessages.deviceLinkInvalid);
      }
      const row = await this.prisma.deviceLinkChallenge.findUnique({
        where: { codeHash: input.codeHash },
      });
      if (!row) {
        throw new DomainError(ErrorCodes.deviceLinkInvalid, 409, PublicMessages.deviceLinkInvalid);
      }
      return toDeviceLink(row);
    } catch (error) {
      bubble(error);
    }
  }

  async markConsumed(id: string, now: Date): Promise<DeviceLinkChallengeRecord | null> {
    try {
      const updated = await this.prisma.deviceLinkChallenge.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'CONSUMED', consumedAt: now },
      });
      if (updated.count !== 1) {
        return null;
      }
      const row = await this.prisma.deviceLinkChallenge.findUnique({ where: { id } });
      return row ? toDeviceLink(row) : null;
    } catch (error) {
      bubble(error);
    }
  }

  async markExpiredIfNeeded(id: string, now: Date): Promise<DeviceLinkChallengeRecord | null> {
    try {
      await this.prisma.deviceLinkChallenge.updateMany({
        where: { id, status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      const row = await this.prisma.deviceLinkChallenge.findUnique({ where: { id } });
      return row ? toDeviceLink(row) : null;
    } catch (error) {
      bubble(error);
    }
  }
}

function toDeviceLink(row: {
  id: string;
  codeHash: string;
  tvClientDeviceId: string;
  tvClientDeviceIdHash: string;
  platform: string;
  deviceName: string | null;
  status: string;
  expiresAt: Date;
  approvedAt: Date | null;
  consumedAt: Date | null;
  approverUserId: string | null;
  deviceId: string | null;
  createdAt: Date;
}): DeviceLinkChallengeRecord {
  return {
    id: row.id,
    codeHash: row.codeHash,
    tvClientDeviceId: row.tvClientDeviceId,
    tvClientDeviceIdHash: row.tvClientDeviceIdHash,
    platform: row.platform as DeviceLinkChallengeRecord['platform'],
    deviceName: row.deviceName,
    status: row.status as DeviceLinkStatusCode,
    expiresAt: row.expiresAt,
    approvedAt: row.approvedAt,
    consumedAt: row.consumedAt,
    approverUserId: row.approverUserId,
    deviceId: row.deviceId,
    createdAt: row.createdAt,
  };
}

async function applyLineSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  snapshot: LineSnapshotInput,
  now: Date,
): Promise<void> {
  if (snapshot.displayName) {
    await tx.user.update({
      where: { id: userId },
      data: { displayName: snapshot.displayName },
    });
  }
  const account = await tx.iptvAccount.findFirst({
    where: { userId, provider: 'XUI', status: 'ACTIVE' },
  });
  if (!account) {
    return;
  }
  await tx.iptvAccount.update({
    where: { id: account.id },
    data: lineAccountFields(snapshot, now),
  });
}

function lineAccountFields(snapshot: LineSnapshotInput | undefined, now: Date) {
  if (!snapshot) {
    return { lastVerifiedAt: now };
  }
  return {
    lastVerifiedAt: now,
    expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt) : null,
    maxConnections: snapshot.maxConnections,
    activeConnections: snapshot.activeConnections,
    displayNameSnapshot: snapshot.displayName,
  };
}

function toUser(user: UserGraph): UserRecord {
  const roles = user.userRoles.map((link) => link.role.code).filter(isUserRole);
  const active = pickMethod(user.mfaMethods, 'ACTIVE');
  const pending = pickMethod(user.mfaMethods, 'PENDING');
  const current = active ?? pending;
  const status = isStatus(user.status) ? user.status : 'DISABLED';
  return {
    id: user.id,
    username: user.username ?? '',
    displayName: user.displayName,
    role: primaryRole(roles),
    roles: roles.length > 0 ? roles : (['CUSTOMER'] as UserRole[]),
    status,
    passwordHash: user.passwordHash,
    mfaEnabled: Boolean(active),
    mfaSecretCiphertext: current?.secretEncrypted ?? null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function pickMethod(
  methods: UserMfaMethod[],
  status: 'ACTIVE' | 'PENDING',
): UserMfaMethod | undefined {
  return methods.find((method) => method.method === 'TOTP' && method.status === status);
}

function isStatus(value: string): value is UserStatus {
  return value === 'PENDING' || value === 'ACTIVE' || value === 'SUSPENDED' || value === 'DISABLED';
}

function toSession(session: {
  id: string;
  userId: string;
  deviceId: string | null;
  familyId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokeReason: RevocationReason | null;
  replacedById: string | null;
  createdAt: Date;
  userAgent: string | null;
}): SessionRecord {
  return {
    id: session.id,
    userId: session.userId,
    deviceId: session.deviceId,
    familyId: session.familyId,
    refreshTokenHash: session.refreshTokenHash,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    revocationReason: session.revokeReason,
    replacedById: session.replacedById,
    createdAt: session.createdAt,
    userAgent: session.userAgent,
  };
}

function toSessionData(
  session: SessionRecord,
  extra: { deviceId: string | null; ipAddress: string | null },
) {
  return {
    id: session.id,
    userId: session.userId,
    deviceId: extra.deviceId,
    familyId: session.familyId,
    refreshTokenHash: session.refreshTokenHash,
    ipAddress: extra.ipAddress,
    userAgent: session.userAgent?.slice(0, 256) ?? null,
    createdAt: session.createdAt,
    lastUsedAt: session.createdAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    revokeReason: session.revocationReason,
    replacedById: session.replacedById,
  };
}

function hashClientDeviceId(clientDeviceId: string): string {
  return createHash('sha256').update(clientDeviceId.trim().toLowerCase()).digest('hex');
}

/** Gracia tras claim/approve QR: el TV aún no canjeó tokens (poll). */
const ORPHAN_GRACE_MS = 3 * 60 * 1000;

/** Revoca dispositivos ACTIVE sin sesión viva (fantasmas), con gracia corta. */
async function revokeOrphanDevicesInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  keepDeviceId: string | null,
): Promise<number> {
  const active = await tx.device.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { id: true, lastSeenAt: true },
  });
  let revoked = 0;
  for (const row of active) {
    if (keepDeviceId && row.id === keepDeviceId) {
      continue;
    }
    const live = await tx.userSession.count({
      where: {
        deviceId: row.id,
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (live > 0) {
      continue;
    }
    // No tocar aparatos recién reclamados (p. ej. approve QR pendiente de poll).
    if (row.lastSeenAt && now.getTime() - row.lastSeenAt.getTime() < ORPHAN_GRACE_MS) {
      continue;
    }
    await tx.device.update({
      where: { id: row.id },
      data: { status: 'REVOKED', revokedAt: now },
    });
    revoked += 1;
  }
  return revoked;
}

async function enforceDeviceQuotaInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  maxDevices: number | null,
  now: Date,
  _keepDeviceId: string | null,
): Promise<number> {
  if (maxDevices === null) {
    return 0;
  }
  const limit = Math.max(0, Math.trunc(maxDevices));
  // Conservar los más antiguos (createdAt); los más nuevos salen del cupo.
  const active = await tx.device.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: [{ createdAt: 'asc' }, { lastSeenAt: 'asc' }],
  });
  if (active.length <= limit) {
    return 0;
  }
  const keep = new Set<string>();
  for (const row of active) {
    if (keep.size >= limit) {
      break;
    }
    keep.add(row.id);
  }
  const toRevoke = active.filter((row) => !keep.has(row.id));
  for (const row of toRevoke) {
    await tx.device.update({
      where: { id: row.id },
      data: { status: 'REVOKED', revokedAt: now },
    });
    await tx.userSession.updateMany({
      where: { deviceId: row.id, userId, revokedAt: null },
      data: { revokedAt: now, revokeReason: 'SECURITY' },
    });
  }
  return toRevoke.length;
}

function presenceOf(
  lastSeenAt: Date | null,
  now: Date,
  inactiveAfterMs: number,
): DevicePresenceCode {
  if (!lastSeenAt) {
    return 'inactive';
  }
  return now.getTime() - lastSeenAt.getTime() >= inactiveAfterMs ? 'inactive' : 'online';
}

async function touchDevice(
  tx: Prisma.TransactionClient,
  userId: string,
  userAgent: string | null,
  now: Date,
): Promise<string> {
  const hash = createHash('sha256')
    .update(`${userId}|${userAgent ?? 'web'}`)
    .digest('hex');
  const existing = await tx.device.findFirst({
    where: { userId, deviceIdentifierHash: hash, status: 'ACTIVE' },
  });
  if (existing) {
    await tx.device.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
    return existing.id;
  }
  const created = await tx.device.create({
    data: {
      id: newId(),
      userId,
      platform: 'WEB',
      deviceName: 'Navegador',
      deviceIdentifierHash: hash,
      status: 'ACTIVE',
      lastSeenAt: now,
    },
  });
  return created.id;
}

function auditData(draft: AuditDraft, actorUserId: string) {
  const data = auditCreateData({ ...draft, actorUserId: draft.actorUserId ?? actorUserId });
  return {
    id: data.id,
    action: data.action,
    result: data.result,
    actorUserId: data.actorUserId,
    resourceType: data.resourceType,
    resourceId: data.resourceId,
    correlationId: data.correlationId,
    ipAddress: data.ipAddress,
    metadata: data.metadata === undefined ? undefined : (data.metadata as Prisma.InputJsonValue),
    createdAt: data.createdAt,
  };
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function bubble(error: unknown): never {
  if (error instanceof DomainError) {
    throw error;
  }
  rethrowAsDomain(error);
}
