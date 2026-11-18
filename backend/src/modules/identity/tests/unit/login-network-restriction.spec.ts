import { ErrorCodes, PublicMessages } from '../../../../common/exceptions/domain-error';
import type { Clock } from '../../../../common/utils/clock';
import type { AppConfig } from '../../../../config/app-config';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import type { PasswordHasher, TokenService } from '../../domain/ports/identity.ports';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';
import { FakeXui } from '../../../../../test/fakes/fake-xui';

const device = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const password = 'correct-horse-battery';

function metaFor(peerAddress: string | null) {
  return {
    correlationId: '33333333-3333-4333-8333-333333333333',
    ipAddress: peerAddress,
    peerAddress,
    userAgent: 'jest-network',
  };
}

describe('LOGIN COTAS restringido a red corporativa', () => {
  const clock: Clock = { now: () => new Date('2026-11-18T15:00:00.000Z') };
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
    async hash(value) {
      return `hash:${value}`;
    },
    async verify(value, hash) {
      return hash === `hash:${value}`;
    },
    async dummyHash() {
      return 'dummy';
    },
  };
  const mfa = {
    generateSecret: () => ({ base32: 'SECRET', otpauthUrl: 'otpauth://test' }),
    verify: () => false,
  };
  const cipher = {
    encrypt: (plain: string) => `enc:${plain}`,
    decrypt: (payload: string) => payload.replace(/^enc:/u, ''),
  };

  function setup(cidrs: string[]) {
    const config = {
      accessTokenTtlSeconds: 120,
      refreshTokenTtlSeconds: 3600,
      enrollmentTokenTtlSeconds: 600,
      deviceLimitFailsafe: 3,
      loginCotasAllowedCidrs: cidrs,
    } as AppConfig;
    const identity = new InMemoryIdentity();
    const xui = new FakeXui();
    xui.lines.set('viewer.demo', password);
    let xuiCalls = 0;
    const originalAuthenticate = xui.authenticate.bind(xui);
    xui.authenticate = async (input) => {
      xuiCalls += 1;
      return originalAuthenticate(input);
    };
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
      mfa,
      cipher,
      identity,
    );
    return { identity, login, xuiCalls: () => xuiCalls };
  }

  it('permite el login por línea XUI desde la red corporativa', async () => {
    const { login, xuiCalls } = setup(['10.10.0.0/16']);
    const result = await login.execute({
      username: 'viewer.demo',
      password,
      deviceId: device,
      platform: 'android',
      meta: metaFor('10.10.0.55'),
    });
    expect(result.type).toBe('authenticated');
    expect(xuiCalls()).toBe(1);
  });

  it('rechaza con 403 desde una red externa y no consulta XUI', async () => {
    const { login, identity, xuiCalls } = setup(['10.10.0.0/16']);
    await expect(
      login.execute({
        username: 'viewer.demo',
        password,
        deviceId: device,
        platform: 'android',
        meta: metaFor('203.0.113.9'),
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: ErrorCodes.loginNetworkRestricted,
      message: PublicMessages.loginNetworkRestricted,
    });
    expect(xuiCalls()).toBe(0);
    expect(identity.sessions).toHaveLength(0);
    expect(
      identity.audits.some(
        (audit) =>
          audit.action === 'auth.login' &&
          (audit.metadata as { reason?: string } | undefined)?.reason === 'network_restricted',
      ),
    ).toBe(true);
  });

  it('rechaza el tráfico que llega vía proxy local (loopback / gateway Docker)', async () => {
    const { login } = setup(['10.10.0.0/16']);
    for (const peer of ['127.0.0.1', '172.18.0.1', null]) {
      await expect(
        login.execute({
          username: 'viewer.demo',
          password,
          deviceId: device,
          platform: 'android',
          meta: metaFor(peer),
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: ErrorCodes.loginNetworkRestricted });
    }
  });

  it('sin CIDR configurados no restringe (comportamiento anterior)', async () => {
    const { login } = setup([]);
    const result = await login.execute({
      username: 'viewer.demo',
      password,
      deviceId: device,
      platform: 'android',
      meta: metaFor('203.0.113.9'),
    });
    expect(result.type).toBe('authenticated');
  });

  it('no afecta el login por correo ni el personal con contraseña local desde fuera', async () => {
    const { login, identity } = setup(['10.10.0.0/16']);
    addUser(identity, {
      username: 'cuenta.email',
      email: 'cuenta@cotas.pe',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: `hash:${password}`,
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    const byEmail = await login.execute({
      username: 'cuenta@cotas.pe',
      password,
      deviceId: device,
      platform: 'android',
      meta: metaFor('203.0.113.9'),
    });
    expect(byEmail.type).toBe('authenticated');

    addUser(identity, {
      username: 'operador.local',
      role: 'OPERATOR',
      status: 'ACTIVE',
      passwordHash: `hash:${password}`,
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    const staff = await login.execute({
      username: 'operador.local',
      password,
      meta: metaFor('203.0.113.9'),
    });
    expect(staff.type).toBe('mfa_enrollment_required');
  });
});
