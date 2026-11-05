import type { AuditDraft, AuditEventView } from '../../src/modules/audit/domain/audit-draft';
import { auditCreateData } from '../../src/modules/audit/infrastructure/audit-record';
import type { UserRecord } from '../../src/modules/identity/domain/models/authenticated-user';
import type {
  RevocationReason,
  RotateResult,
  SessionRecord,
} from '../../src/modules/identity/domain/models/session';
import type {
  AcceptLineInput,
  AcceptLineResult,
  CreateLocalUserInput,
  DeviceQuotaView,
  DeviceRegistrationInput,
  LineAccess,
  LineCredentials,
  LineSnapshotInput,
  RecoveryCodeRepository,
  SessionRepository,
  SubscriptionSnapshot,
  UpdateLocalUserInput,
  UserRepository,
} from '../../src/modules/identity/domain/ports/identity.ports';
import type { AuditRepository } from '../../src/modules/audit/domain/audit-repository';
import { DomainError, ErrorCodes, PublicMessages } from '../../src/common/exceptions/domain-error';
import { newId } from '../../src/common/utils/ids';
import { isStaffRole } from '../../src/modules/identity/domain/models/authenticated-user';
import { createHash } from 'node:crypto';

type MemoryDevice = {
  id: string;
  userId: string;
  platform: DeviceRegistrationInput['platform'];
  deviceName: string | null;
  deviceIdentifierHash: string;
  status: 'ACTIVE' | 'REVOKED';
  lastSeenAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};

export class InMemoryIdentity
  implements UserRepository, SessionRepository, RecoveryCodeRepository, AuditRepository, LineAccess
{
  readonly users: UserRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  readonly devices: MemoryDevice[] = [];
  readonly recovery = new Map<string, { userId: string; usedAt: Date | null }>();
  readonly audits: Array<AuditEventView & { metadata?: AuditDraft['metadata'] }> = [];
  readonly pushTokens = new Map<string, { token: string; platform: string }>();
  private readonly lines = new Map<string, LineCredentials>();
  private readonly snapshots = new Map<string, SubscriptionSnapshot>();

  async findByUsername(username: string): Promise<UserRecord | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async listUsers(page: number, limit: number): Promise<{ total: number; items: UserRecord[] }> {
    const start = (page - 1) * limit;
    return {
      total: this.users.length,
      items: this.users.slice(start, start + limit),
    };
  }

  async createLocalUser(input: CreateLocalUserInput): Promise<UserRecord> {
    if (this.users.some((user) => user.username === input.username)) {
      throw new DomainError(ErrorCodes.conflict, 409, PublicMessages.conflict);
    }
    return addUser(this, {
      username: input.username,
      role: input.role,
      roles: [input.role],
      status: input.status,
      passwordHash: input.passwordHash,
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      lastLoginAt: null,
      createdAt: input.now,
    });
  }

  async updateLocalUser(input: UpdateLocalUserInput): Promise<UserRecord> {
    const user = await this.findById(input.id);
    if (!user) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    if (input.status) {
      user.status = input.status;
    }
    if (input.role) {
      user.role = input.role;
      user.roles = [input.role];
    }
    return user;
  }

  async setPasswordHash(id: string, passwordHash: string, _now: Date): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    user.passwordHash = passwordHash;
  }

  async touchLastLogin(id: string, now: Date): Promise<void> {
    const user = await this.findById(id);
    if (user) {
      user.lastLoginAt = now;
    }
  }

  async saveMfaSecret(id: string, secretCiphertext: string): Promise<void> {
    const user = await this.findById(id);
    if (!user || user.mfaEnabled) {
      throw new DomainError(ErrorCodes.mfaAlreadyEnabled, 409, PublicMessages.mfaAlreadyEnabled);
    }
    user.mfaSecretCiphertext = secretCiphertext;
  }

  async acceptLine(input: AcceptLineInput): Promise<AcceptLineResult> {
    const username = input.username.trim();
    const existing = this.users.find((user) => user.username === username);
    if (existing && existing.status !== 'ACTIVE') {
      return { ok: false, reason: 'blocked' };
    }
    if (existing && (isStaffRole(existing.role) || existing.passwordHash)) {
      return { ok: false, reason: 'blocked' };
    }
    const user =
      existing ??
      addUser(this, {
        username,
        displayName: input.snapshot?.displayName ?? username,
        role: 'CUSTOMER',
        roles: ['CUSTOMER'],
        status: 'ACTIVE',
        passwordHash: null,
        mfaEnabled: false,
        mfaSecretCiphertext: null,
      });
    if (input.snapshot?.displayName) {
      user.displayName = input.snapshot.displayName;
    }
    this.lines.set(user.id, { username, password: input.password });
    if (input.snapshot) {
      await this.saveLineSnapshot(user.id, input.snapshot, input.now);
    }
    return { ok: true, user };
  }

  async credentialsFor(userId: string): Promise<LineCredentials> {
    const line = this.lines.get(userId);
    if (!line) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    return line;
  }

  async saveLineSnapshot(userId: string, snapshot: LineSnapshotInput, now: Date): Promise<void> {
    const user = await this.findById(userId);
    if (user && snapshot.displayName) {
      user.displayName = snapshot.displayName;
    }
    const line = this.lines.get(userId);
    this.snapshots.set(userId, {
      displayName: snapshot.displayName ?? user?.displayName ?? line?.username ?? null,
      username: line?.username ?? null,
      expiresAt: snapshot.expiresAt,
      maxConnections: snapshot.maxConnections,
      activeConnections: snapshot.activeConnections,
      status: snapshot.status,
      lastVerifiedAt: now.toISOString(),
      source: 'cache',
    });
  }

  async getSubscriptionSnapshot(userId: string): Promise<SubscriptionSnapshot | null> {
    return this.snapshots.get(userId) ?? null;
  }

  async setPushToken(
    userId: string,
    sessionId: string,
    token: string,
    platform: string,
    _now: Date,
  ): Promise<void> {
    const session = this.sessions.find((item) => item.id === sessionId && item.userId === userId);
    if (!session || session.revokedAt) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    this.pushTokens.set(sessionId, { token, platform });
  }

  async claimDeviceSlot(input: DeviceRegistrationInput): Promise<string> {
    const hash = createHash('sha256')
      .update(input.clientDeviceId.trim().toLowerCase())
      .digest('hex');
    const existing = this.devices.find(
      (device) => device.userId === input.userId && device.deviceIdentifierHash === hash,
    );
    if (existing) {
      if (existing.status !== 'ACTIVE') {
        this.enforceInMemory(input.userId, input.maxDevices, input.now, null);
        if (
          input.maxDevices !== null &&
          this.devices.filter((d) => d.userId === input.userId && d.status === 'ACTIVE').length >=
            input.maxDevices
        ) {
          throw new DomainError(ErrorCodes.deviceLimit, 403, PublicMessages.deviceLimit);
        }
      }
      existing.status = 'ACTIVE';
      existing.revokedAt = null;
      existing.lastSeenAt = input.now;
      existing.platform = input.platform;
      existing.deviceName = input.deviceName?.trim().slice(0, 80) || existing.deviceName;
      this.enforceInMemory(input.userId, input.maxDevices, input.now, existing.id);
      return existing.id;
    }
    this.enforceInMemory(input.userId, input.maxDevices, input.now, null);
    if (
      input.maxDevices !== null &&
      this.devices.filter((d) => d.userId === input.userId && d.status === 'ACTIVE').length >=
        input.maxDevices
    ) {
      throw new DomainError(ErrorCodes.deviceLimit, 403, PublicMessages.deviceLimit);
    }
    const created: MemoryDevice = {
      id: newId(),
      userId: input.userId,
      platform: input.platform,
      deviceName: input.deviceName?.trim().slice(0, 80) || null,
      deviceIdentifierHash: hash,
      status: 'ACTIVE',
      lastSeenAt: input.now,
      createdAt: input.now,
      revokedAt: null,
    };
    this.devices.push(created);
    return created.id;
  }

  async listDevices(userId: string, currentDeviceId: string | null): Promise<DeviceQuotaView> {
    const items = this.devices
      .filter((device) => device.userId === userId && device.status === 'ACTIVE')
      .sort(
        (a, b) =>
          (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      )
      .map((device) => ({
        id: device.id,
        platform: device.platform,
        deviceName: device.deviceName,
        status: device.status,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        createdAt: device.createdAt.toISOString(),
        current: currentDeviceId !== null && device.id === currentDeviceId,
      }));
    const snapshot = this.snapshots.get(userId);
    return {
      used: items.length,
      limit: snapshot?.maxConnections ?? null,
      items,
    };
  }

  async revokeDevice(
    deviceId: string,
    userId: string,
    now: Date,
  ): Promise<'revoked' | 'not_found'> {
    const device = this.devices.find(
      (item) => item.id === deviceId && item.userId === userId && item.status === 'ACTIVE',
    );
    if (!device) {
      return 'not_found';
    }
    device.status = 'REVOKED';
    device.revokedAt = now;
    for (const session of this.sessions) {
      if (session.deviceId === deviceId && session.userId === userId && !session.revokedAt) {
        session.revokedAt = now;
        session.revocationReason = 'SECURITY';
      }
    }
    return 'revoked';
  }

  async enforceDeviceQuota(
    userId: string,
    maxDevices: number | null,
    now: Date,
    keepDeviceId?: string | null,
  ): Promise<number> {
    return this.enforceInMemory(userId, maxDevices, now, keepDeviceId ?? null);
  }

  async enableMfa(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    user.mfaEnabled = true;
  }

  async create(
    session: SessionRecord,
    audit: AuditDraft,
    options?: { deviceId?: string | null },
  ): Promise<void> {
    this.sessions.push({ ...session, deviceId: options?.deviceId ?? session.deviceId ?? null });
    this.pushAudit(audit, session.userId);
  }

  async findSessionById(id: string): Promise<SessionRecord | null> {
    return this.sessions.find((session) => session.id === id) ?? null;
  }

  async listActiveByUser(userId: string, now: Date): Promise<SessionRecord[]> {
    return this.sessions.filter(
      (session) => session.userId === userId && !session.revokedAt && session.expiresAt > now,
    );
  }

  async rotate(
    currentHash: string,
    next: SessionRecord,
    successAudit: AuditDraft,
    reuseAudit: AuditDraft,
    now: Date,
  ): Promise<RotateResult> {
    const current = this.sessions.find((session) => session.refreshTokenHash === currentHash);
    if (!current) {
      return { type: 'not_found' };
    }
    const reused =
      current.revocationReason === 'ROTATED' ||
      current.revocationReason === 'REUSE' ||
      current.replacedById !== null;
    if (reused) {
      this.revokeFamily(current.familyId, now);
      this.pushAudit(reuseAudit, current.userId);
      return { type: 'reuse' };
    }
    if (current.revokedAt) {
      return { type: 'not_found' };
    }
    if (current.expiresAt <= now) {
      return { type: 'expired' };
    }
    current.revokedAt = now;
    current.revocationReason = 'ROTATED';
    current.replacedById = next.id;
    this.sessions.push({
      ...next,
      userId: current.userId,
      familyId: current.familyId,
      deviceId: current.deviceId ?? null,
    });
    this.pushAudit(successAudit, current.userId);
    return { type: 'rotated', userId: current.userId, sessionId: next.id };
  }

  async revokeOwned(
    id: string,
    userId: string,
    reason: RevocationReason,
    audit: AuditDraft,
    now: Date,
  ): Promise<'revoked' | 'not_found'> {
    const session = this.sessions.find(
      (item) => item.id === id && item.userId === userId && !item.revokedAt,
    );
    if (!session) {
      return 'not_found';
    }
    session.revokedAt = now;
    session.revocationReason = reason;
    this.pushAudit(audit, userId);
    return 'revoked';
  }

  async replaceAndEnable(userId: string, codeHashes: readonly string[]): Promise<void> {
    const user = await this.findById(userId);
    if (!user || user.mfaEnabled || !user.mfaSecretCiphertext) {
      throw new DomainError(ErrorCodes.mfaAlreadyEnabled, 409, PublicMessages.mfaAlreadyEnabled);
    }
    for (const [hash, code] of this.recovery) {
      if (code.userId === userId) {
        this.recovery.delete(hash);
      }
    }
    for (const hash of codeHashes) {
      this.recovery.set(hash, { userId, usedAt: null });
    }
    user.mfaEnabled = true;
  }

  async consume(userId: string, codeHash: string, now: Date): Promise<boolean> {
    const code = this.recovery.get(codeHash);
    if (!code || code.userId !== userId || code.usedAt) {
      return false;
    }
    code.usedAt = now;
    return true;
  }

  async record(draft: AuditDraft): Promise<void> {
    this.pushAudit(draft, draft.actorUserId);
  }

  async list(page: number, limit: number): Promise<{ total: number; items: AuditEventView[] }> {
    const sorted = [...this.audits].sort(
      (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
    );
    const start = (page - 1) * limit;
    return {
      total: sorted.length,
      items: sorted.slice(start, start + limit).map(({ metadata: _metadata, ...event }) => event),
    };
  }

  private revokeFamily(familyId: string, now: Date): void {
    for (const session of this.sessions) {
      if (session.familyId === familyId && !session.revokedAt) {
        session.revokedAt = now;
        session.revocationReason = 'REUSE';
      }
    }
  }

  private enforceInMemory(
    userId: string,
    maxDevices: number | null,
    now: Date,
    keepDeviceId: string | null,
  ): number {
    if (maxDevices === null || maxDevices < 1) {
      return 0;
    }
    const active = this.devices
      .filter((device) => device.userId === userId && device.status === 'ACTIVE')
      .sort(
        (a, b) =>
          (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    if (active.length <= maxDevices) {
      return 0;
    }
    const keep = new Set<string>();
    if (keepDeviceId) {
      keep.add(keepDeviceId);
    }
    for (const row of active) {
      if (keep.size >= maxDevices) {
        break;
      }
      keep.add(row.id);
    }
    let revoked = 0;
    for (const row of active) {
      if (keep.has(row.id)) {
        continue;
      }
      row.status = 'REVOKED';
      row.revokedAt = now;
      for (const session of this.sessions) {
        if (session.deviceId === row.id && session.userId === userId && !session.revokedAt) {
          session.revokedAt = now;
          session.revocationReason = 'SECURITY';
        }
      }
      revoked += 1;
    }
    return revoked;
  }

  private pushAudit(draft: AuditDraft, actorUserId: string | null): void {
    const data = auditCreateData({ ...draft, actorUserId: draft.actorUserId ?? actorUserId });
    this.audits.push({
      id: data.id,
      occurredAt: new Date(),
      action: data.action,
      result: data.result,
      actorUserId: data.actorUserId,
      correlationId: data.correlationId,
      metadata: data.metadata,
    });
  }
}

export function addUser(
  store: InMemoryIdentity,
  user: Omit<
    UserRecord,
    'id' | 'roles' | 'passwordHash' | 'lastLoginAt' | 'createdAt' | 'displayName'
  > & {
    id?: string;
    roles?: UserRecord['roles'];
    passwordHash?: string | null;
    displayName?: string | null;
    lastLoginAt?: Date | null;
    createdAt?: Date;
  },
): UserRecord {
  const record: UserRecord = {
    id: user.id ?? newId(),
    username: user.username,
    displayName: user.displayName ?? null,
    role: user.role,
    roles: user.roles ?? [user.role],
    status: user.status,
    passwordHash: user.passwordHash ?? null,
    mfaEnabled: user.mfaEnabled,
    mfaSecretCiphertext: user.mfaSecretCiphertext,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt ?? new Date('2026-10-19T15:00:00.000Z'),
  };
  store.users.push(record);
  return record;
}
