import { DomainError, PublicMessages } from '../../../../common/exceptions/domain-error';
import type { Clock } from '../../../../common/utils/clock';
import type { AppConfig } from '../../../../config/app-config';
import { DeviceLinkUseCase } from '../../application/use-cases/device-link.use-case';
import type { TokenService } from '../../domain/ports/identity.ports';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';

const meta = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  ipAddress: '127.0.0.1',
  userAgent: 'tv-jest',
};

const tvDeviceId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('device-link QR', () => {
  const clock: Clock = { now: () => new Date('2026-11-05T18:00:00.000Z') };
  const config = {
    accessTokenTtlSeconds: 120,
    refreshTokenTtlSeconds: 3600,
  } as AppConfig;
  const tokens: TokenService = {
    async signAccessToken(claims) {
      return `access:${claims.sub}:${claims.sid}:${claims.role}`;
    },
    async verifyAccessToken() {
      throw new Error('no usado');
    },
    async signEnrollmentToken() {
      throw new Error('no usado');
    },
    async verifyEnrollmentToken() {
      throw new Error('no usado');
    },
    generateRefreshToken: () => 'refresh-token-qr',
    hashToken: (token) => `hashed:${token}`,
  };

  function setup() {
    const identity = new InMemoryIdentity();
    identity.nowProvider = () => clock.now();
    const useCase = new DeviceLinkUseCase(
      identity,
      identity,
      identity,
      identity,
      tokens,
      identity,
      config,
      clock,
    );
    const user = addUser(identity, {
      username: 'viewer.demo',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    identity.setSubscriptionSnapshot(user.id, {
      displayName: 'Demo',
      username: 'viewer.demo',
      expiresAt: '2026-12-31T23:59:59.000Z',
      maxConnections: 3,
      activeConnections: 0,
      status: 'Active',
      lastVerifiedAt: clock.now().toISOString(),
      source: 'cache',
    });
    const mobile = {
      id: user.id,
      username: user.username!,
      role: user.role,
      sessionId: '11111111-1111-4111-8111-111111111111',
      deviceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    };
    return { identity, useCase, user, mobile };
  }

  it('TV crea código, móvil aprueba y TV canjea tokens propios', async () => {
    const { identity, useCase, mobile } = setup();

    const created = await useCase.createSession({
      deviceId: tvDeviceId,
      platform: 'tv',
      deviceName: 'LG Living',
    });
    expect(created.linkCode).toHaveLength(8);
    expect(created.qrPayload).toContain(created.linkCode);
    expect(created.expiresIn).toBe(120);

    const pending = await useCase.poll({ linkCode: created.linkCode, deviceId: tvDeviceId }, meta);
    expect(pending.status).toBe('pending');

    const approved = await useCase.approve(
      mobile,
      { linkCode: created.linkCode, deviceName: 'cuarto02' },
      meta,
    );
    expect(approved.status).toBe('approved');
    expect(approved.device.deviceName).toBe('cuarto02');
    expect(approved.used).toBe(1);
    expect(approved.limit).toBe(3);

    const redeemed = await useCase.poll({ linkCode: created.linkCode, deviceId: tvDeviceId }, meta);
    expect(redeemed.status).toBe('approved');
    if (redeemed.status !== 'approved') {
      throw new Error('esperado approved');
    }
    expect(redeemed.accessToken).toContain(mobile.id);
    expect(redeemed.refreshToken).toBe('refresh-token-qr');
    expect(identity.sessions.filter((s) => !s.revokedAt)).toHaveLength(1);

    const again = await useCase.poll({ linkCode: created.linkCode, deviceId: tvDeviceId }, meta);
    expect(again.status).toBe('consumed');

    const devices = await identity.listDevices(mobile.id, mobile.deviceId);
    expect(devices.used).toBe(1);
    expect(devices.items[0]?.deviceName).toBe('cuarto02');

    // Gestión remota: cerrar el TV desde el móvil invalida su sesión.
    const tvInternalId = redeemed.device.id;
    const revoked = await identity.revokeDevice(tvInternalId, mobile.id, clock.now());
    expect(revoked).toBe('revoked');
    expect(identity.sessions.every((s) => s.revokedAt !== null)).toBe(true);
    const after = await identity.listDevices(mobile.id, mobile.deviceId);
    expect(after.used).toBe(0);
  });

  it('rechaza approve si el cupo está lleno (DEVICE_LIMIT)', async () => {
    const { identity, useCase, mobile } = setup();
    identity.setSubscriptionSnapshot(mobile.id, {
      displayName: 'Demo',
      username: 'viewer.demo',
      expiresAt: null,
      maxConnections: 1,
      activeConnections: 0,
      status: 'Active',
      lastVerifiedAt: clock.now().toISOString(),
      source: 'cache',
    });

    // Ocupa el único slot con otro aparato + sesión viva.
    const occupiedId = await identity.claimDeviceSlot({
      userId: mobile.id,
      clientDeviceId: 'phone-stable-001',
      platform: 'ANDROID',
      deviceName: 'Movil',
      maxDevices: 1,
      now: clock.now(),
      onLimit: 'reject',
    });
    identity.sessions.push({
      id: '22222222-2222-4222-8222-222222222222',
      userId: mobile.id,
      deviceId: occupiedId,
      familyId: '33333333-3333-4333-8333-333333333333',
      refreshTokenHash: 'hashed:other',
      expiresAt: new Date('2026-11-06T18:00:00.000Z'),
      revokedAt: null,
      revocationReason: null,
      replacedById: null,
      createdAt: clock.now(),
      userAgent: 'phone',
    });

    const created = await useCase.createSession({ deviceId: tvDeviceId, platform: 'tv' });
    await expect(
      useCase.approve(mobile, { linkCode: created.linkCode, deviceName: 'TV extra' }, meta),
    ).rejects.toThrow(PublicMessages.deviceLimit);
  });

  it('poll con deviceId distinto al del TV falla', async () => {
    const { useCase } = setup();
    const created = await useCase.createSession({ deviceId: tvDeviceId, platform: 'tv' });
    await expect(
      useCase.poll({ linkCode: created.linkCode, deviceId: 'otro-device-id-xx' }, meta),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
