import type { Clock } from '../../../../common/utils/clock';
import { DEVICE_INACTIVE_AFTER_SECONDS } from '../../domain/ports/identity.ports';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';

describe('presencia de dispositivos', () => {
  it('marca inactive tras el umbral y vuelve a online con heartbeat', async () => {
    let now = new Date('2026-11-06T22:00:00.000Z');
    const clock: Clock = { now: () => now };
    const identity = new InMemoryIdentity();
    identity.nowProvider = () => clock.now();
    const user = addUser(identity, {
      username: 'presencia.demo',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });

    const tvId = await identity.claimDeviceSlot({
      userId: user.id,
      clientDeviceId: 'tv-1',
      platform: 'TV',
      deviceName: 'Sala',
      maxDevices: 3,
      now,
    });

    const online = await identity.listDevices(user.id, tvId);
    expect(online.inactiveAfterSeconds).toBe(DEVICE_INACTIVE_AFTER_SECONDS);
    expect(online.items[0]?.presence).toBe('online');

    now = new Date(now.getTime() + (DEVICE_INACTIVE_AFTER_SECONDS + 1) * 1000);
    const inactive = await identity.listDevices(user.id, tvId);
    expect(inactive.items[0]?.presence).toBe('inactive');

    const claimed = await identity.claimNewlyInactiveDevices(now, 10);
    expect(claimed).toEqual([{ userId: user.id, deviceId: tvId, deviceName: 'Sala' }]);
    expect(await identity.claimNewlyInactiveDevices(now, 10)).toEqual([]);

    now = new Date(now.getTime() + 5_000);
    expect(await identity.touchDevicePresence(user.id, tvId, now)).toBe('ok');
    const back = await identity.listDevices(user.id, tvId);
    expect(back.items[0]?.presence).toBe('online');
  });
});
