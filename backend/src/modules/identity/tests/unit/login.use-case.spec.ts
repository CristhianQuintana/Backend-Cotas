import { createHash } from 'node:crypto';
import { DomainError, PublicMessages } from '../../../../common/exceptions/domain-error';
import type { Clock } from '../../../../common/utils/clock';
import type { AppConfig } from '../../../../config/app-config';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import type { TokenService, PasswordHasher } from '../../domain/ports/identity.ports';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';
import { FakeXui } from '../../../../../test/fakes/fake-xui';

const meta = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

const deviceA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const deviceB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const deviceC = '550e8400-e29b-41d4-a716-446655440000';

describe('identidad', () => {
  const clock: Clock = { now: () => new Date('2026-10-19T15:00:00.000Z') };
  const config = {
    accessTokenTtlSeconds: 120,
    refreshTokenTtlSeconds: 3600,
    enrollmentTokenTtlSeconds: 600,
  } as AppConfig;
  const tokens: TokenService = {
    async signAccessToken(claims) {
      return `access:${claims.sub}:${claims.sid}:${claims.role}`;
    },
    async verifyAccessToken() {
      throw new Error('no usado');
    },
    async signEnrollmentToken(userId) {
      return `enroll:${userId}`;
    },
    async verifyEnrollmentToken() {
      throw new Error('no usado');
    },
    generateRefreshToken: () => 'refresh-token-value',
    hashToken: (token) => `hashed:${token}`,
  };
  const passwords: PasswordHasher = {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify(password, passwordHash) {
      return passwordHash === `hash:${password}`;
    },
    async dummyHash() {
      return 'dummy';
    },
  };

  function setup() {
    const identity = new InMemoryIdentity();
    const xui = new FakeXui();
    const login = new LoginUseCase(
      identity,
      identity,
      tokens,
      passwords,
      identity,
      config,
      clock,
      xui,
      identity,
    );
    const refresh = new RefreshSessionUseCase(identity, identity, tokens, identity, config, clock);
    return { identity, login, refresh, xui };
  }

  it('autentica un cliente de XUI y rechaza con el mismo mensaje a línea inexistente, clave incorrecta y cuenta bloqueada', async () => {
    const { identity, login, xui } = setup();
    xui.lines.set('viewer.demo', 'correct-horse-battery');
    xui.lines.set('disabled.demo', 'correct-horse-battery');
    xui.lines.set('linea.nueva', 'correct-horse-battery');
    addUser(identity, {
      username: 'viewer.demo',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    addUser(identity, {
      username: 'disabled.demo',
      role: 'CUSTOMER',
      status: 'DISABLED',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });

    const result = await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceA,
      platform: 'android',
      meta,
    });
    expect(result.type).toBe('authenticated');

    await expect(
      login.execute({
        username: 'missing.demo',
        password: 'correct-horse-battery',
        deviceId: deviceA,
        meta,
      }),
    ).rejects.toThrow(PublicMessages.invalidCredentials);
    await expect(
      login.execute({
        username: 'viewer.demo',
        password: 'wrong-password-1',
        deviceId: deviceA,
        meta,
      }),
    ).rejects.toThrow(PublicMessages.invalidCredentials);
    await expect(
      login.execute({
        username: 'disabled.demo',
        password: 'correct-horse-battery',
        deviceId: deviceA,
        meta,
      }),
    ).rejects.toThrow(PublicMessages.invalidCredentials);

    const created = await login.execute({
      username: 'linea.nueva',
      password: 'correct-horse-battery',
      deviceId: deviceB,
      platform: 'tv',
      meta,
    });
    expect(created.type).toBe('authenticated');
    expect(identity.users.find((user) => user.username === 'linea.nueva')?.role).toBe('CUSTOMER');
  });

  it('exige deviceId en login de línea IPTV y respeta el cupo maxConnections', async () => {
    const { identity, login, xui } = setup();
    xui.line.maxConnections = 2;
    xui.lines.set('viewer.demo', 'correct-horse-battery');
    addUser(identity, {
      username: 'viewer.demo',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });

    await expect(
      login.execute({ username: 'viewer.demo', password: 'correct-horse-battery', meta }),
    ).rejects.toBeInstanceOf(DomainError);

    await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceA,
      platform: 'android',
      meta,
    });
    await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceB,
      platform: 'tv',
      meta,
    });
    await expect(
      login.execute({
        username: 'viewer.demo',
        password: 'correct-horse-battery',
        deviceId: deviceC,
        platform: 'ios',
        meta,
      }),
    ).rejects.toThrow(PublicMessages.deviceLimit);

    // Re-login del mismo aparato no consume un slot extra.
    const again = await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceA,
      platform: 'android',
      meta,
    });
    expect(again.type).toBe('authenticated');
    expect(identity.devices.filter((d) => d.status === 'ACTIVE')).toHaveLength(2);
  });

  it('si baja maxConnections, al re-login cierra los dispositivos más viejos y conserva el actual', async () => {
    const { identity, login, xui } = setup();
    xui.line.maxConnections = 3;
    xui.lines.set('viewer.demo', 'correct-horse-battery');
    addUser(identity, {
      username: 'viewer.demo',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });

    const t0 = new Date('2026-10-19T12:00:00.000Z');
    const t1 = new Date('2026-10-19T13:00:00.000Z');
    const t2 = new Date('2026-10-19T14:00:00.000Z');
    clock.now = () => t0;
    await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceA,
      meta,
    });
    clock.now = () => t1;
    await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceB,
      meta,
    });
    clock.now = () => t2;
    await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceC,
      meta,
    });
    expect(identity.devices.filter((d) => d.status === 'ACTIVE')).toHaveLength(3);

    xui.line.maxConnections = 1;
    clock.now = () => new Date('2026-10-19T15:00:00.000Z');
    await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceA,
      meta,
    });

    const active = identity.devices.filter((d) => d.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0]?.deviceIdentifierHash).toBe(
      createHash('sha256').update(deviceA).digest('hex'),
    );
  });

  it('autentica personal con contraseña local Argon2 sin MFA', async () => {
    const { identity, login, xui } = setup();
    xui.lines.set('operador', 'should-not-use-xui');
    addUser(identity, {
      username: 'operador',
      role: 'OPERATOR',
      status: 'ACTIVE',
      passwordHash: 'hash:local-operator-password',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });

    const session = await login.execute({
      username: 'operador',
      password: 'local-operator-password',
      meta,
    });
    expect(session.type).toBe('authenticated');
    expect(session.accessToken).toContain(':OPERATOR');
  });

  it('no usa XUI para operadores y rota el refresh token de clientes', async () => {
    const { identity, login, refresh, xui } = setup();
    xui.lines.set('viewer.demo', 'correct-horse-battery');
    addUser(identity, {
      username: 'operador',
      role: 'OPERATOR',
      status: 'ACTIVE',
      passwordHash: null,
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    await expect(
      login.execute({ username: 'operador', password: 'anything-long', meta }),
    ).rejects.toThrow(PublicMessages.invalidCredentials);

    const viewer = addUser(identity, {
      username: 'viewer.demo',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    const session = await login.execute({
      username: 'viewer.demo',
      password: 'correct-horse-battery',
      deviceId: deviceA,
      meta,
    });
    if (session.type !== 'authenticated') {
      throw new Error('se esperaba sesión');
    }
    const rotated = await refresh.execute(session.refreshToken, meta);
    expect(rotated.refreshToken).toBe('refresh-token-value');
    await expect(refresh.execute(session.refreshToken, meta)).rejects.toBeInstanceOf(DomainError);
    expect(
      identity.sessions.filter(
        (item) => item.userId === viewer.id && item.revocationReason === 'REUSE',
      ).length,
    ).toBeGreaterThan(0);
  });
});
