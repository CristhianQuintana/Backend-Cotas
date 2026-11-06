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

export type DevicePlatformCode = 'WEB' | 'ANDROID' | 'IOS' | 'TV' | 'OTHER';

export interface DeviceRegistrationInput {
  userId: string;
  /** Identificador estable que envía la app (UUID). */
  clientDeviceId: string;
  platform: DevicePlatformCode;
  deviceName?: string | null;
  /** Cupo desde XUI `max_connections`. null = sin tope de dispositivos. */
  maxDevices: number | null;
  now: Date;
  /**
   * Cupo lleno + aparato nuevo:
   * - `displace` (default, login clave): libera hueco cerrando un aparato más nuevo (los antiguos se priorizan).
   * - `reject` (QR approve): 403 DEVICE_LIMIT para que el móvil elija qué revocar.
   */
  onLimit?: 'displace' | 'reject';
}

export type DeviceLinkStatusCode = 'PENDING' | 'APPROVED' | 'EXPIRED' | 'DENIED' | 'CONSUMED';

export interface DeviceLinkChallengeRecord {
  id: string;
  codeHash: string;
  tvClientDeviceId: string;
  tvClientDeviceIdHash: string;
  platform: DevicePlatformCode;
  deviceName: string | null;
  status: DeviceLinkStatusCode;
  expiresAt: Date;
  approvedAt: Date | null;
  consumedAt: Date | null;
  approverUserId: string | null;
  deviceId: string | null;
  createdAt: Date;
}

export interface CreateDeviceLinkChallengeInput {
  codeHash: string;
  tvClientDeviceId: string;
  tvClientDeviceIdHash: string;
  platform: DevicePlatformCode;
  deviceName?: string | null;
  expiresAt: Date;
  now: Date;
}

export interface ApproveDeviceLinkChallengeInput {
  codeHash: string;
  approverUserId: string;
  deviceId: string;
  deviceName?: string | null;
  now: Date;
}

export const DEVICE_LINK_REPOSITORY = Symbol('DEVICE_LINK_REPOSITORY');

export interface DeviceLinkRepository {
  createChallenge(input: CreateDeviceLinkChallengeInput): Promise<DeviceLinkChallengeRecord>;
  findByCodeHash(codeHash: string): Promise<DeviceLinkChallengeRecord | null>;
  markApproved(input: ApproveDeviceLinkChallengeInput): Promise<DeviceLinkChallengeRecord>;
  markConsumed(id: string, now: Date): Promise<DeviceLinkChallengeRecord | null>;
  markExpiredIfNeeded(id: string, now: Date): Promise<DeviceLinkChallengeRecord | null>;
}

export interface DeviceView {
  id: string;
  platform: DevicePlatformCode;
  deviceName: string | null;
  status: 'ACTIVE' | 'REVOKED';
  lastSeenAt: string | null;
  createdAt: string;
  current: boolean;
}

/** Resumen para pantallas de configuración (`used`/`limit` → "3/5 dispositivos"). */
export interface DeviceQuotaView {
  used: number;
  /** Cupo desde snapshot XUI (`maxConnections`). null = sin tope conocido. */
  limit: number | null;
  items: DeviceView[];
}

export interface SessionRepository {
  create(
    session: SessionRecord,
    audit: AuditDraft,
    options?: { deviceId?: string | null },
  ): Promise<void>;
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

export interface LineSnapshotInput {
  displayName: string | null;
  expiresAt: string | null;
  maxConnections: number | null;
  activeConnections: number | null;
  status: string | null;
}

export interface AcceptLineInput {
  username: string;
  password: string;
  now: Date;
  snapshot?: LineSnapshotInput;
}

export type AcceptLineResult = { ok: true; user: UserRecord } | { ok: false; reason: 'blocked' };

export interface LineCredentials {
  username: string;
  password: string;
}

export interface SubscriptionSnapshot {
  displayName: string | null;
  username: string | null;
  expiresAt: string | null;
  maxConnections: number | null;
  /** Conexiones de reproducción en XUI (no es el cupo de apps COTAS). */
  activeConnections: number | null;
  /**
   * Cupo de aparatos con sesión (Flutter: `maxDevices` / `activeDevices`).
   * Alias de devicesLimit / devicesUsed.
   */
  maxDevices?: number | null;
  activeDevices?: number;
  /** @deprecated Preferir activeDevices / connectedSessions en /auth/me. */
  devicesUsed?: number;
  /** @deprecated Preferir maxDevices. */
  devicesLimit?: number | null;
  status: string | null;
  lastVerifiedAt: string | null;
  source: 'live' | 'cache';
}

export interface LineAccess {
  acceptLine(input: AcceptLineInput): Promise<AcceptLineResult>;
  credentialsFor(userId: string): Promise<LineCredentials>;
  saveLineSnapshot(userId: string, snapshot: LineSnapshotInput, now: Date): Promise<void>;
  getSubscriptionSnapshot(userId: string): Promise<SubscriptionSnapshot | null>;
  setPushToken(
    userId: string,
    sessionId: string,
    token: string,
    platform: string,
    now: Date,
  ): Promise<void>;
  /** Tokens FCM de aparatos ACTIVE del usuario (opcionalmente excluye uno). */
  listPushTokens(userId: string, excludeDeviceId?: string | null): Promise<string[]>;
  /**
   * Registra o reutiliza un dispositivo.
   * Si el cupo bajó, se conservan los más antiguos (`createdAt`); los más nuevos reciben DEVICE_LIMIT.
   */
  claimDeviceSlot(input: DeviceRegistrationInput): Promise<string>;
  listDevices(userId: string, currentDeviceId: string | null): Promise<DeviceQuotaView>;
  revokeDevice(deviceId: string, userId: string, now: Date): Promise<'revoked' | 'not_found'>;
  /** Ajusta ACTIVE al cupo actual (p. ej. tras bajar max_connections en XUI). */
  enforceDeviceQuota(
    userId: string,
    maxDevices: number | null,
    now: Date,
    keepDeviceId?: string | null,
  ): Promise<number>;
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
