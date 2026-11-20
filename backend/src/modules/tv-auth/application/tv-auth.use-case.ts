import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/logging/request-meta';
import { DomainError, ErrorCodes, PublicMessages } from '../../../common/exceptions/domain-error';
import {
  DEFAULT_TRUSTED_PROXY_CIDRS,
  isAddressInCidrs,
  resolveClientAddress,
} from '../../../common/network/allowed-network';
import { CLOCK, type Clock } from '../../../common/utils/clock';
import { newId } from '../../../common/utils/ids';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { AUDIT_REPOSITORY, type AuditRepository } from '../../audit/domain/audit-repository';
import { hashClientDeviceId } from '../../identity/application/use-cases/device-link.use-case';
import { resolveDeviceLimit } from '../../identity/domain/device-limit.policy';
import { isStaffRole, type UserRecord } from '../../identity/domain/models/authenticated-user';
import type { SessionRecord } from '../../identity/domain/models/session';
import {
  AUTH_IDENTITY_REPOSITORY,
  LINE_ACCESS,
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
  type AuthIdentityRepository,
  type LineAccess,
  type SessionRepository,
  type TokenService,
  type UserRepository,
} from '../../identity/domain/ports/identity.ports';
import { GoogleIdTokenVerifier } from '../../identity/infrastructure/google/google-id-token.verifier';
import {
  TV_QR_REPOSITORY,
  type TvQrPlatformCode,
  type TvQrRepository,
  type TvQrSessionRecord,
  type TvQrStatusCode,
} from '../domain/tv-qr.ports';

/** Intervalo de sondeo sugerido al televisor. */
const POLL_INTERVAL_MS = 2_000;
/** Tiempo máximo para que el televisor retire sus credenciales tras la autorización. */
const DELIVERY_WINDOW_SECONDS = 120;

export interface CreateTvQrSessionResult {
  sessionId: string;
  status: 'PENDING';
  /** Código temporal de un solo uso (también va en el fragmento de `authorizationUrl`). */
  code: string;
  /** URL que se codifica en el QR. No contiene tokens de acceso. */
  authorizationUrl: string;
  /** Secreto que solo conoce el televisor; autentica el sondeo y la cancelación. */
  pollSecret: string;
  expiresAt: string;
  expiresIn: number;
  pollIntervalMs: number;
}

export type TvQrStatusResult =
  | { status: 'PENDING'; expiresAt: string; expiresIn: number }
  | { status: 'EXPIRED' | 'CANCELLED' | 'REJECTED'; reason: string | null }
  | { status: 'AUTHORIZED'; credentialsDelivered: true }
  | {
      status: 'AUTHORIZED';
      credentialsDelivered: false;
      tokenType: 'Bearer';
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      device: { id: string; deviceName: string | null; platform: TvQrPlatformCode };
      account: { displayName: string | null };
    };

export interface TvQrInfoResult {
  sessionId: string;
  status: TvQrStatusCode;
  device: {
    deviceName: string | null;
    platform: TvQrPlatformCode;
    requestedFrom: string | null;
    requestedAt: string;
  };
  expiresIn: number;
}

export interface TvQrIdentifyResult extends TvQrInfoResult {
  account: { displayName: string | null; email: string };
}

@Injectable()
export class TvAuthUseCase {
  constructor(
    @Inject(TV_QR_REPOSITORY) private readonly sessions: TvQrRepository,
    @Inject(GoogleIdTokenVerifier) private readonly google: GoogleIdTokenVerifier,
    @Inject(AUTH_IDENTITY_REPOSITORY) private readonly identities: AuthIdentityRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(SESSION_REPOSITORY) private readonly appSessions: SessionRepository,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ── Televisor ─────────────────────────────────────────────────────────────

  async createSession(
    input: { deviceId: string; platform?: string; deviceName?: string },
    meta: RequestMeta,
  ): Promise<CreateTvQrSessionResult> {
    const baseUrl = this.config.tvQrPublicBaseUrl;
    if (!baseUrl) {
      throw new DomainError(
        ErrorCodes.dependencyUnavailable,
        503,
        PublicMessages.dependencyUnavailable,
      );
    }
    const now = this.clock.now();
    const clientDeviceId = input.deviceId.trim();
    const clientHash = hashClientDeviceId(clientDeviceId);
    const code = randomSecret(24);
    const pollSecret = randomSecret(32);
    const id = newId();
    const expiresAt = new Date(now.getTime() + this.config.tvQrTtlSeconds * 1000);

    // Un televisor solo tiene una sesión QR vigente: las anteriores quedan inutilizables.
    await this.sessions.cancelPendingByDevice(clientHash, now);
    await this.sessions.create({
      id,
      codeHash: hashSecret(code),
      pollSecretHash: hashSecret(pollSecret),
      tvClientDeviceId: clientDeviceId,
      tvClientDeviceIdHash: clientHash,
      platform: mapPlatform(input.platform),
      deviceName: input.deviceName?.trim() || null,
      requestIpMasked: maskIp(
        resolveClientAddress({
          peerAddress: meta.peerAddress ?? meta.ipAddress,
          forwardedFor: meta.forwardedFor,
          // Solo informativo (pantalla de confirmación): se confía en el proxy local (Nginx).
          trustForwarded: true,
          trustedProxyCidrs: DEFAULT_TRUSTED_PROXY_CIDRS,
        }),
      ),
      expiresAt,
      now,
    });
    await this.audit.record({
      action: 'auth.tv_qr_create',
      result: 'success',
      actorUserId: null,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: { sessionId: id },
    });
    return {
      sessionId: id,
      status: 'PENDING',
      code,
      authorizationUrl: `${baseUrl}/${this.config.apiPrefix}/auth/tv/qr/authorize/${id}#c=${code}`,
      pollSecret,
      expiresAt: expiresAt.toISOString(),
      expiresIn: this.config.tvQrTtlSeconds,
      pollIntervalMs: POLL_INTERVAL_MS,
    };
  }

  /** Estado para el televisor. Entrega las credenciales una sola vez cuando AUTHORIZED. */
  async getStatus(
    input: { sessionId: string; pollSecret: string },
    meta: RequestMeta,
  ): Promise<TvQrStatusResult> {
    const now = this.clock.now();
    let session = await this.sessions.findById(input.sessionId);
    if (!session || !secretMatches(input.pollSecret, session.pollSecretHash)) {
      throw invalidSession();
    }
    session = await this.refreshExpiry(session, now);

    switch (session.status) {
      case 'PENDING':
        return {
          status: 'PENDING',
          expiresAt: session.expiresAt.toISOString(),
          expiresIn: secondsLeft(session, now),
        };
      case 'EXPIRED':
      case 'CANCELLED':
      case 'REJECTED':
        return { status: session.status, reason: session.statusReason };
      case 'AUTHORIZED':
        break;
    }

    if (session.deliveredAt || !session.userId || !session.deviceId) {
      return { status: 'AUTHORIZED', credentialsDelivered: true };
    }
    // Una autorización que el televisor no retira a tiempo caduca: no queda un acceso latente.
    if (
      session.authorizedAt &&
      now.getTime() - session.authorizedAt.getTime() > DELIVERY_WINDOW_SECONDS * 1000
    ) {
      return { status: 'EXPIRED', reason: 'delivery_expired' };
    }
    // Compare-and-set: con sondeos simultáneos solo uno recibe las credenciales.
    const claimed = await this.sessions.markDelivered(session.id, now);
    if (!claimed) {
      return { status: 'AUTHORIZED', credentialsDelivered: true };
    }
    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }

    const refreshToken = this.tokens.generateRefreshToken();
    const appSession: SessionRecord = {
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
      sid: appSession.id,
      role: user.role,
    });
    await this.appSessions.create(
      appSession,
      {
        action: 'auth.tv_qr_redeem',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
        metadata: { sessionId: session.id, deviceId: session.deviceId },
      },
      { deviceId: session.deviceId },
    );
    await this.users.touchLastLogin(user.id, now);

    return {
      status: 'AUTHORIZED',
      credentialsDelivered: false,
      tokenType: 'Bearer',
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
      device: {
        id: session.deviceId,
        deviceName: session.deviceName,
        platform: session.platform,
      },
      account: { displayName: user.displayName ?? user.username ?? null },
    };
  }

  /** El televisor cancela su propia sesión (p. ej. el usuario sale de la pantalla QR). */
  async cancel(
    input: { sessionId: string; pollSecret: string },
    meta: RequestMeta,
  ): Promise<{ status: TvQrStatusCode }> {
    const now = this.clock.now();
    let session = await this.sessions.findById(input.sessionId);
    if (!session || !secretMatches(input.pollSecret, session.pollSecretHash)) {
      throw invalidSession();
    }
    session = await this.refreshExpiry(session, now);
    if (session.status !== 'PENDING') {
      // Idempotente: cancelar una sesión ya cerrada devuelve su estado actual.
      return { status: session.status };
    }
    const closed = await this.sessions.markClosed({
      id: session.id,
      status: 'CANCELLED',
      reason: 'user_cancelled',
      now,
    });
    await this.recordFailure('auth.tv_qr_cancel', meta, session.id, 'tv_cancelled', 'success');
    return { status: (closed ?? session).status };
  }

  // ── Teléfono (página de autorización) ────────────────────────────────────

  /** Datos del televisor que pide acceso (sin cuenta). Requiere el código del QR. */
  async getInfo(input: { sessionId: string; code: string }): Promise<TvQrInfoResult> {
    const session = await this.openForCode(input.sessionId, input.code);
    return this.toInfo(session);
  }

  /** Valida la identidad Google y muestra la cuenta que se vinculará (sin autorizar aún). */
  async identify(
    input: { sessionId: string; code: string; idToken: string },
    meta: RequestMeta,
  ): Promise<TvQrIdentifyResult> {
    const session = await this.openForCode(input.sessionId, input.code);
    const user = await this.resolveGoogleUser(input.idToken, session.id, meta);
    return {
      ...this.toInfo(session),
      account: { displayName: user.displayName ?? null, email: user.email ?? '' },
    };
  }

  /** Confirmación explícita: vincula la cuenta con ESTA sesión de televisor. */
  async authorize(
    input: { sessionId: string; code: string; idToken: string },
    meta: RequestMeta,
  ): Promise<{
    status: 'AUTHORIZED';
    device: { deviceName: string | null; platform: TvQrPlatformCode };
  }> {
    const now = this.clock.now();
    const session = await this.openForCode(input.sessionId, input.code);
    const user = await this.resolveGoogleUser(input.idToken, session.id, meta);

    const snapshot = await this.lines.getSubscriptionSnapshot(user.id);
    const maxDevices = resolveDeviceLimit(
      snapshot?.maxConnections ?? null,
      this.config.deviceLimitFailsafe,
    );
    const deviceName =
      session.deviceName ?? (session.platform === 'TV' ? 'Televisor' : 'Dispositivo TV');
    // Iniciar sesión con Google nunca se bloquea por cupo: este televisor entra siempre y, si el
    // cupo está lleno, se cierra el aparato visto hace más tiempo.
    const deviceId = await this.lines.claimDeviceSlot({
      userId: user.id,
      clientDeviceId: session.tvClientDeviceId,
      platform: session.platform,
      deviceName,
      maxDevices,
      now,
      onLimit: 'replace',
    });

    // Un solo ganador: el código es de un solo uso. El perdedor no revoca el dispositivo (podría
    // ser el mismo del ganador); un cupo huérfano se libera solo al no tener sesión viva.
    const authorized = await this.sessions.markAuthorized({
      id: session.id,
      userId: user.id,
      deviceId,
      now,
    });
    if (!authorized) {
      const current = await this.sessions.findById(session.id);
      if (current?.status === 'EXPIRED' || (current && current.expiresAt <= now)) {
        throw new DomainError(ErrorCodes.tvQrExpired, 410, PublicMessages.tvQrExpired);
      }
      throw new DomainError(ErrorCodes.tvQrClosed, 409, PublicMessages.tvQrClosed);
    }
    await this.audit.record({
      action: 'auth.tv_qr_authorize',
      result: 'success',
      actorUserId: user.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: { sessionId: session.id, deviceId, method: 'google' },
    });
    return {
      status: 'AUTHORIZED',
      device: { deviceName: session.deviceName, platform: session.platform },
    };
  }

  /** El usuario del teléfono rechaza explícitamente la solicitud. */
  async reject(
    input: { sessionId: string; code: string },
    meta: RequestMeta,
  ): Promise<{ status: TvQrStatusCode }> {
    const session = await this.openForCode(input.sessionId, input.code);
    const closed = await this.sessions.markClosed({
      id: session.id,
      status: 'REJECTED',
      reason: 'user_rejected',
      now: this.clock.now(),
    });
    await this.recordFailure('auth.tv_qr_reject', meta, session.id, 'user_rejected', 'success');
    return { status: (closed ?? session).status };
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  /**
   * Carga la sesión y exige el código del QR. Códigos erróneos suman intentos y, al llegar al
   * máximo, bloquean la sesión (REJECTED). Falla si la sesión no está PENDING o ya expiró.
   */
  private async openForCode(sessionId: string, code: string): Promise<TvQrSessionRecord> {
    const now = this.clock.now();
    const found = await this.sessions.findById(sessionId);
    if (!found) {
      throw invalidSession();
    }
    const session = await this.refreshExpiry(found, now);
    if (session.status === 'EXPIRED') {
      throw new DomainError(ErrorCodes.tvQrExpired, 410, PublicMessages.tvQrExpired);
    }
    if (session.status !== 'PENDING') {
      throw new DomainError(ErrorCodes.tvQrClosed, 409, PublicMessages.tvQrClosed);
    }
    if (session.failedAttempts >= this.config.tvQrMaxAttempts) {
      await this.lock(session, now);
      throw new DomainError(ErrorCodes.tvQrLocked, 429, PublicMessages.tvQrLocked);
    }
    if (!secretMatches(code, session.codeHash)) {
      const attempts = await this.sessions.registerFailedAttempt(session.id);
      if (attempts >= this.config.tvQrMaxAttempts) {
        await this.lock(session, now);
        throw new DomainError(ErrorCodes.tvQrLocked, 429, PublicMessages.tvQrLocked);
      }
      throw invalidSession();
    }
    return session;
  }

  private async lock(session: TvQrSessionRecord, now: Date): Promise<void> {
    await this.sessions.markClosed({
      id: session.id,
      status: 'REJECTED',
      reason: 'too_many_attempts',
      now,
    });
  }

  private async refreshExpiry(session: TvQrSessionRecord, now: Date): Promise<TvQrSessionRecord> {
    if (session.status === 'PENDING' && session.expiresAt <= now) {
      return (await this.sessions.markExpiredIfNeeded(session.id, now)) ?? session;
    }
    return session;
  }

  /**
   * Misma validación que `POST /auth/google` (mismo verificador de ID tokens, mismo allowlist de
   * audiencias y misma tabla de identidades), pero sin crear sesión de navegador ni consumir
   * cupo de dispositivos. No crea cuentas: la cuenta debe existir y estar vinculada a Google.
   */
  private async resolveGoogleUser(
    idToken: string,
    sessionId: string,
    meta: RequestMeta,
  ): Promise<UserRecord> {
    let user: UserRecord | null = null;
    try {
      const identity = await this.google.verify(idToken);
      const link = await this.identities.findByProviderSubject('google', identity.subject);
      if (link) {
        user = await this.users.findById(link.userId);
      } else {
        const byEmail = await this.users.findByEmail(identity.email);
        if (byEmail) {
          throw new DomainError(
            ErrorCodes.accountLinkRequired,
            409,
            PublicMessages.accountLinkRequired,
          );
        }
        throw new DomainError(
          ErrorCodes.tvQrAccountNotFound,
          404,
          PublicMessages.tvQrAccountNotFound,
        );
      }
    } catch (error) {
      await this.recordFailure(
        'auth.tv_qr_authorize',
        meta,
        sessionId,
        error instanceof DomainError ? error.code : 'google_error',
        'failure',
      );
      throw error;
    }
    if (!user || user.status !== 'ACTIVE') {
      await this.recordFailure('auth.tv_qr_authorize', meta, sessionId, 'user_inactive', 'failure');
      throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
    }
    if (isStaffRole(user.role)) {
      // El personal exige MFA: no puede delegar su acceso a un televisor solo con Google.
      await this.recordFailure(
        'auth.tv_qr_authorize',
        meta,
        sessionId,
        'staff_not_allowed',
        'failure',
      );
      throw new DomainError(ErrorCodes.forbidden, 403, PublicMessages.forbidden);
    }
    return user;
  }

  private toInfo(session: TvQrSessionRecord): TvQrInfoResult {
    return {
      sessionId: session.id,
      status: session.status,
      device: {
        deviceName: session.deviceName,
        platform: session.platform,
        requestedFrom: session.requestIpMasked,
        requestedAt: session.createdAt.toISOString(),
      },
      expiresIn: secondsLeft(session, this.clock.now()),
    };
  }

  private async recordFailure(
    action: string,
    meta: RequestMeta,
    sessionId: string,
    reason: string,
    result: 'success' | 'failure',
  ): Promise<void> {
    await this.audit.record({
      action,
      result,
      actorUserId: null,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
      metadata: { sessionId, reason },
    });
  }
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

function secretMatches(provided: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(provided), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function randomSecret(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function secondsLeft(session: TvQrSessionRecord, now: Date): number {
  return Math.max(0, Math.ceil((session.expiresAt.getTime() - now.getTime()) / 1000));
}

function invalidSession(): DomainError {
  return new DomainError(ErrorCodes.tvQrInvalid, 404, PublicMessages.tvQrInvalid);
}

function maskIp(ip: string | null): string | null {
  // Sin IP útil (p. ej. gateway Docker o loopback cuando no hay proxy identificado).
  if (!ip || isAddressInCidrs(ip, DEFAULT_TRUSTED_PROXY_CIDRS)) {
    return null;
  }
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((group) => group.length > 0);
    return groups.length >= 2 ? `${groups[0]}:${groups[1]}:…` : null;
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : null;
}

function mapPlatform(value: string | undefined): TvQrPlatformCode {
  const raw = (value ?? 'tv').toLowerCase();
  if (raw.includes('android') && !raw.includes('tv')) {
    return 'ANDROID';
  }
  if (raw.includes('ios') || raw.includes('iphone') || raw.includes('ipad')) {
    return 'IOS';
  }
  if (raw.includes('web') || raw.includes('chrome')) {
    return 'WEB';
  }
  if (/tv|tizen|webos|bravia|samsung|lg|roku|fire|android/u.test(raw)) {
    return 'TV';
  }
  return 'OTHER';
}
