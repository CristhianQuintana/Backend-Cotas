import type { AuditDraft } from '../../../audit/domain/audit-draft';
import type { UserRecord, UserRole, UserStatus } from '../models/authenticated-user';
import type { RevocationReason, RotateResult, SessionRecord } from '../models/session';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
export const RECOVERY_CODE_REPOSITORY = Symbol('RECOVERY_CODE_REPOSITORY');
export const LINE_ACCESS = Symbol('LINE_ACCESS');
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');
export const MFA_SERVICE = Symbol('MFA_SERVICE');
export const MFA_CIPHER = Symbol('MFA_CIPHER');

export interface CreateLocalUserInput {
  username: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  now: Date;
}

export interface UpdateLocalUserInput {
  id: string;
  status?: UserStatus;
  role?: UserRole;
  now: Date;
}

export interface UserRepository {
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  listUsers(page: number, limit: number): Promise<{ total: number; items: UserRecord[] }>;
  createLocalUser(input: CreateLocalUserInput): Promise<UserRecord>;
  updateLocalUser(input: UpdateLocalUserInput): Promise<UserRecord>;
  setPasswordHash(id: string, passwordHash: string, now: Date): Promise<void>;
  touchLastLogin(id: string, now: Date): Promise<void>;
  saveMfaSecret(id: string, secretCiphertext: string): Promise<void>;
  enableMfa(id: string): Promise<void>;
}

export interface SessionRepository {
  create(session: SessionRecord, audit: AuditDraft): Promise<void>;
  findSessionById(id: string): Promise<SessionRecord | null>;
  listActiveByUser(userId: string, now: Date): Promise<SessionRecord[]>;
  rotate(
    currentHash: string,
    next: SessionRecord,
    successAudit: AuditDraft,
    reuseAudit: AuditDraft,
    now: Date,
  ): Promise<RotateResult>;
  revokeOwned(
    id: string,
    userId: string,
    reason: RevocationReason,
    audit: AuditDraft,
    now: Date,
  ): Promise<'revoked' | 'not_found'>;
}

export interface RecoveryCodeRepository {
  replaceAndEnable(userId: string, codeHashes: readonly string[]): Promise<void>;
  consume(userId: string, codeHash: string, now: Date): Promise<boolean>;
}

export interface AcceptLineInput {
  username: string;
  password: string;
  now: Date;
}

export type AcceptLineResult = { ok: true; user: UserRecord } | { ok: false; reason: 'blocked' };

export interface LineCredentials {
  username: string;
  password: string;
}

export interface LineAccess {
  acceptLine(input: AcceptLineInput): Promise<AcceptLineResult>;
  credentialsFor(userId: string): Promise<LineCredentials>;
  revokeDevice(deviceId: string, userId: string, now: Date): Promise<'revoked' | 'not_found'>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
  dummyHash(): Promise<string>;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: UserRecord['role'];
}

export interface TokenService {
  signAccessToken(claims: AccessTokenClaims): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
  signEnrollmentToken(userId: string): Promise<string>;
  verifyEnrollmentToken(token: string): Promise<{ sub: string }>;
  generateRefreshToken(): string;
  hashToken(token: string): string;
}

export interface MfaService {
  generateSecret(username: string): { base32: string; otpauthUrl: string };
  verify(base32: string, code: string): boolean;
}

export interface MfaSecretCipher {
  encrypt(plain: string): string;
  decrypt(payload: string): string;
}
