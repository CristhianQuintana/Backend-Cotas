import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../../common/logging/request-meta';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { CLOCK, type Clock } from '../../../../common/utils/clock';
import type { AuthenticatedUser } from '../../domain/models/authenticated-user';
import {
  LINE_ACCESS,
  SESSION_REPOSITORY,
  USER_REPOSITORY,
  type LineAccess,
  type SessionRepository,
  type UserRepository,
} from '../../domain/ports/identity.ports';
import { PlaybackMediaTicketStore } from '../../../playback/infrastructure/playback-media-ticket.store';
import { DevicePresenceNotifier } from './device-presence-notifier';

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(DevicePresenceNotifier) private readonly presence: DevicePresenceNotifier,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PlaybackMediaTicketStore) private readonly tickets: PlaybackMediaTicketStore,
  ) {}

  async execute(user: AuthenticatedUser, meta: RequestMeta): Promise<void> {
    const now = this.clock.now();
    const closedDeviceId = user.deviceId;
    let deviceName: string | null = null;
    if (closedDeviceId) {
      const devices = await this.lines.listDevices(user.id, closedDeviceId);
      deviceName = devices.items.find((item) => item.id === closedDeviceId)?.deviceName ?? null;
    }

    const result = await this.sessions.revokeOwned(
      user.sessionId,
      user.id,
      'LOGOUT',
      {
        action: 'auth.logout',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      },
      now,
    );
    if (result === 'not_found') {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }

    await this.tickets.revokeForUser(user.id);
    // El dispositivo queda REVOKED (si no hay más sesiones vivas) → avisar al celular.
    await this.presence.notifySessionClosed(user.id, closedDeviceId, deviceName);
  }
}

@Injectable()
export class GetProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
  ) {}

  async execute(user: AuthenticatedUser) {
    const record = await this.users.findById(user.id);
    if (!record || record.status !== 'ACTIVE') {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }

    const [snapshot, devices] = await Promise.all([
      this.lines.getSubscriptionSnapshot(user.id),
      this.lines.listDevices(user.id, user.deviceId),
    ]);

    const connectedSessions = devices.used;
    const maxDevices =
      devices.limit ??
      (snapshot?.maxConnections !== null && snapshot?.maxConnections !== undefined
        ? Number(snapshot.maxConnections)
        : null);

    return {
      id: record.id,
      username: record.username,
      displayName: record.displayName,
      role: record.role,
      roles: record.roles,
      status: record.status,
      accountStatus: record.status,
      mfaEnabled: record.mfaEnabled,
      expiresAt: snapshot?.expiresAt ?? null,
      maxDevices: maxDevices === null ? null : Number(maxDevices),
      connectedSessions: Number(connectedSessions),
    };
  }
}

@Injectable()
export class ListSessionsUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(user: AuthenticatedUser) {
    const sessions = await this.sessions.listActiveByUser(user.id, this.clock.now());
    return {
      items: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === user.sessionId,
      })),
    };
  }
}

@Injectable()
export class RevokeSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(LINE_ACCESS) private readonly lines: LineAccess,
    @Inject(DevicePresenceNotifier) private readonly presence: DevicePresenceNotifier,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(user: AuthenticatedUser, sessionId: string, meta: RequestMeta): Promise<void> {
    const now = this.clock.now();
    const target = await this.sessions.findSessionById(sessionId);
    const closedDeviceId = target?.userId === user.id ? (target.deviceId ?? null) : null;
    let deviceName: string | null = null;
    if (closedDeviceId) {
      const devices = await this.lines.listDevices(user.id, user.deviceId);
      deviceName = devices.items.find((item) => item.id === closedDeviceId)?.deviceName ?? null;
    }

    const result = await this.sessions.revokeOwned(
      sessionId,
      user.id,
      'LOGOUT',
      {
        action: 'auth.session_revoke',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      },
      now,
    );
    if (result === 'not_found') {
      throw new DomainError(ErrorCodes.notFound, 404, PublicMessages.sessionNotFound);
    }

    await this.presence.notifySessionClosed(user.id, closedDeviceId, deviceName);
  }
}
