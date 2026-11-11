import type { Clock } from '../../../../common/utils/clock';
import { LogoutUseCase } from '../../application/use-cases/session.use-cases';
import { DevicePresenceNotifier } from '../../application/use-cases/device-presence-notifier';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';
import { newId } from '../../../../common/utils/ids';

const meta = {
  correlationId: '22222222-2222-4222-8222-222222222222',
  ipAddress: '127.0.0.1',
  userAgent: 'tv-logout-jest',
};

describe('logout libera dispositivo y notifica', () => {
  const clock: Clock = { now: () => new Date('2026-11-06T21:00:00.000Z') };

  it('al cerrar sesión en el TV el aparato deja de listarse para el móvil', async () => {
    const identity = new InMemoryIdentity();
    identity.nowProvider = () => clock.now();
    const user = addUser(identity, {
      username: 'linea.demo',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });

    const tvSlot = await identity.claimDeviceSlot({
      userId: user.id,
      clientDeviceId: 'tv-sala-001',
      platform: 'TV',
      deviceName: 'TV Sala',
      maxDevices: 3,
      now: clock.now(),
    });
    const phoneSlot = await identity.claimDeviceSlot({
      userId: user.id,
      clientDeviceId: 'phone-001',
      platform: 'ANDROID',
      deviceName: 'Celular',
      maxDevices: 3,
      now: clock.now(),
    });

    const tvSessionId = newId();
    await identity.create(
      {
        id: tvSessionId,
        userId: user.id,
        familyId: newId(),
        refreshTokenHash: 'hash-tv',
        expiresAt: new Date('2026-11-07T21:00:00.000Z'),
        revokedAt: null,
        revocationReason: null,
        replacedById: null,
        createdAt: clock.now(),
        userAgent: 'tv',
      },
      {
        action: 'auth.login',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      },
      { deviceId: tvSlot },
    );
    await identity.create(
      {
        id: newId(),
        userId: user.id,
        familyId: newId(),
        refreshTokenHash: 'hash-phone',
        expiresAt: new Date('2026-11-07T21:00:00.000Z'),
        revokedAt: null,
        revocationReason: null,
        replacedById: null,
        createdAt: clock.now(),
        userAgent: 'phone',
      },
      {
        action: 'auth.login',
        result: 'success',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      },
      { deviceId: phoneSlot },
    );

    const phoneSessionId = identity.sessions.find((item) => item.deviceId === phoneSlot)?.id;
    expect(phoneSessionId).toBeTruthy();
    await identity.setPushToken(
      user.id,
      phoneSessionId!,
      'fcm-phone-token',
      'android',
      clock.now(),
    );

    const notified: Array<{ deviceId: string; deviceName: string | null }> = [];
    const push = {
      async notifyDeviceSessionClosed(
        _tokens: readonly string[],
        input: { deviceId: string; deviceName: string | null },
      ) {
        notified.push(input);
      },
    };

    const presence = new DevicePresenceNotifier(identity, clock, push as never);
    const tickets = {
      async revokeForUser() {
        return 0;
      },
    };
    const logout = new LogoutUseCase(identity, identity, presence, clock, tickets as never);

    const before = await identity.listDevices(user.id, phoneSlot);
    expect(before.used).toBe(2);

    await logout.execute(
      {
        id: user.id,
        username: user.username,
        sessionId: tvSessionId,
        role: 'CUSTOMER',
        deviceId: tvSlot,
      },
      meta,
    );

    const after = await identity.listDevices(user.id, phoneSlot);
    expect(after.used).toBe(1);
    expect(after.items.map((item) => item.id)).toEqual([phoneSlot]);
    expect(notified).toEqual([{ deviceId: tvSlot, deviceName: 'TV Sala' }]);
  });
});
