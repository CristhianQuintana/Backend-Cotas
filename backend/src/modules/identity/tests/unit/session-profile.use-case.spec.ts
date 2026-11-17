import type { Clock } from '../../../../common/utils/clock';
import {
  GetProfileUseCase,
  ListSessionsUseCase,
  RevokeSessionUseCase,
} from '../../application/use-cases/session.use-cases';
import { DevicePresenceNotifier } from '../../application/use-cases/device-presence-notifier';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';
import { newId } from '../../../../common/utils/ids';

describe('session profile/list/revoke', () => {
  const clock: Clock = { now: () => new Date('2026-11-16T12:00:00.000Z') };

  it('GetProfileUseCase expone cupo y sesiones conectadas', async () => {
    const identity = new InMemoryIdentity();
    const user = addUser(identity, {
      username: 'linea.a',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    await identity.claimDeviceSlot({
      userId: user.id,
      clientDeviceId: 'tv-1',
      platform: 'TV',
      deviceName: 'TV',
      maxDevices: 15,
      now: clock.now(),
    });
    await identity.saveLineSnapshot(
      user.id,
      {
        displayName: 'Linea A',
        expiresAt: '2027-01-01T00:00:00.000Z',
        maxConnections: 15,
        activeConnections: 1,
        status: 'Active',
      },
      clock.now(),
    );
    const profile = await new GetProfileUseCase(identity, identity).execute({
      id: user.id,
      username: user.username,
      sessionId: newId(),
      role: 'CUSTOMER',
      deviceId: null,
    });
    expect(profile.maxDevices).toBe(15);
    expect(typeof profile.connectedSessions).toBe('number');
    expect(profile.username).toBe('linea.a');
  });

  it('ListSessionsUseCase y RevokeSessionUseCase operan sobre la sesión propia', async () => {
    const identity = new InMemoryIdentity();
    const user = addUser(identity, {
      username: 'linea.b',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    const sessionId = newId();
    await identity.create(
      {
        id: sessionId,
        userId: user.id,
        familyId: newId(),
        refreshTokenHash: 'hash',
        expiresAt: new Date('2026-11-17T12:00:00.000Z'),
        revokedAt: null,
        revocationReason: null,
        replacedById: null,
        createdAt: clock.now(),
        userAgent: 'test',
      },
      {
        action: 'auth.login',
        result: 'success',
        actorUserId: user.id,
        correlationId: '33333333-3333-4333-8333-333333333333',
        ipAddress: '127.0.0.1',
      },
    );
    const listed = await new ListSessionsUseCase(identity, clock).execute({
      id: user.id,
      username: user.username,
      sessionId,
      role: 'CUSTOMER',
      deviceId: null,
    });
    expect(listed.items.some((s) => s.id === sessionId && s.current)).toBe(true);

    const presence = new DevicePresenceNotifier(identity, clock, {
      notifyDeviceSessionClosed: jest.fn(),
    } as never);
    await new RevokeSessionUseCase(identity, identity, presence, clock).execute(
      {
        id: user.id,
        username: user.username,
        sessionId,
        role: 'CUSTOMER',
        deviceId: null,
      },
      sessionId,
      {
        correlationId: '33333333-3333-4333-8333-333333333333',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      },
    );
  });
});
