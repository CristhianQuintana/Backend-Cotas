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
  type CreateLocalUserInput,
  type LineAccess,
  type LineCredentials,
  type MfaSecretCipher,
  type RecoveryCodeRepository,
  type SessionRepository,
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
  implements UserRepository, SessionRepository, RecoveryCodeRepository, LineAccess
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

  async create(session: SessionRecord, audit: AuditDraft): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const deviceId = await touchDevice(
          tx,
          session.userId,
          session.userAgent,
          session.createdAt,
        );
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
        const updated = await tx.userSession.updateMany({
          where: { id, userId, revokedAt: null },
          data: { revokedAt: now, revokeReason: reason },
        });
        if (updated.count !== 1) {
          return 'not_found';
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
      if (!existing) {
        const role = await tx.role.findUnique({ where: { code: 'CUSTOMER' } });
        if (!role) {
          throw new DomainError(ErrorCodes.internal, 500, PublicMessages.internal);
        }
        await tx.user.create({
          data: {
            id: userId,
            username,
            status: 'ACTIVE',
            lastLoginAt: input.now,
            userRoles: { create: { roleId: role.id } },
          },
        });
      } else {
        await tx.user.update({
          where: { id: userId },
          data: { lastLoginAt: input.now },
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
      if (account) {
        await tx.iptvAccount.update({
          where: { id: account.id },
          data: {
            username,
            externalAccountRef: username,
            passwordEncrypted: encrypted,
            lastVerifiedAt: input.now,
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
            lastVerifiedAt: input.now,
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
