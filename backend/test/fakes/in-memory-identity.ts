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
  LineAccess,
  LineCredentials,
  RecoveryCodeRepository,
  SessionRepository,
  UpdateLocalUserInput,
  UserRepository,
} from '../../src/modules/identity/domain/ports/identity.ports';
import type { AuditRepository } from '../../src/modules/audit/domain/audit-repository';
import { DomainError, ErrorCodes, PublicMessages } from '../../src/common/exceptions/domain-error';
import { newId } from '../../src/common/utils/ids';
import { isStaffRole } from '../../src/modules/identity/domain/models/authenticated-user';

export class InMemoryIdentity
  implements UserRepository, SessionRepository, RecoveryCodeRepository, AuditRepository, LineAccess
{
  readonly users: UserRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  readonly recovery = new Map<string, { userId: string; usedAt: Date | null }>();
  readonly audits: Array<AuditEventView & { metadata?: AuditDraft['metadata'] }> = [];
  private readonly lines = new Map<string, LineCredentials>();

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
        role: 'CUSTOMER',
        roles: ['CUSTOMER'],
        status: 'ACTIVE',
        passwordHash: null,
        mfaEnabled: false,
        mfaSecretCiphertext: null,
      });
    this.lines.set(user.id, { username, password: input.password });
    return { ok: true, user };
  }

  async credentialsFor(userId: string): Promise<LineCredentials> {
    const line = this.lines.get(userId);
    if (!line) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    return line;
  }

  async revokeDevice(
    deviceId: string,
    userId: string,
    now: Date,
  ): Promise<'revoked' | 'not_found'> {
    const owned = this.sessions.filter(
      (session) => session.userId === userId && session.id === deviceId,
    );
    if (owned.length === 0) {
      return 'not_found';
    }
    for (const session of owned) {
      session.revokedAt = now;
      session.revocationReason = 'SECURITY';
    }
    return 'revoked';
  }

  async enableMfa(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.notFound);
    }
    user.mfaEnabled = true;
  }

  async create(session: SessionRecord, audit: AuditDraft): Promise<void> {
    this.sessions.push({ ...session });
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
    this.sessions.push({ ...next, userId: current.userId, familyId: current.familyId });
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
  user: Omit<UserRecord, 'id' | 'roles' | 'passwordHash' | 'lastLoginAt' | 'createdAt'> & {
    id?: string;
    roles?: UserRecord['roles'];
    passwordHash?: string | null;
    lastLoginAt?: Date | null;
    createdAt?: Date;
  },
): UserRecord {
  const record: UserRecord = {
    id: user.id ?? newId(),
    username: user.username,
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
