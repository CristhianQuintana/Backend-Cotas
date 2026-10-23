import { DomainError, PublicMessages } from '../../../../common/exceptions/domain-error';
import type { Clock } from '../../../../common/utils/clock';
import type { AppConfig } from '../../../../config/app-config';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import type {
  TokenService,
  MfaService,
  MfaSecretCipher,
  PasswordHasher,
} from '../../domain/ports/identity.ports';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';
import { FakeXui } from '../../../../../test/fakes/fake-xui';

const meta = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

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
  const mfa: MfaService = {
    generateSecret: () => ({ base32: 'SECRET', otpauthUrl: 'otpauth://totp/demo' }),
    verify: (_secret, code) => code === '123456',
  };
  const cipher: MfaSecretCipher = {
    encrypt: (plain) => `enc:${plain}`,
    decrypt: (payload) => payload.replace(/^enc:/u, ''),
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
      identity,
      tokens,
      mfa,
      cipher,
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
      meta,
    });
    expect(result.type).toBe('authenticated');

    await expect(
      login.execute({ username: 'missing.demo', password: 'correct-horse-battery', meta }),
    ).rejects.toThrow(PublicMessages.invalidCredentials);
    await expect(
      login.execute({ username: 'viewer.demo', password: 'wrong-password-1', meta }),
    ).rejects.toThrow(PublicMessages.invalidCredentials);
    await expect(
      login.execute({ username: 'disabled.demo', password: 'correct-horse-battery', meta }),
    ).rejects.toThrow(PublicMessages.invalidCredentials);

    const created = await login.execute({
      username: 'linea.nueva',
      password: 'correct-horse-battery',
      meta,
    });
    expect(created.type).toBe('authenticated');
    expect(identity.users.find((user) => user.username === 'linea.nueva')?.role).toBe('CUSTOMER');
  });

  it('autentica personal con contraseña local Argon2 y exige MFA', async () => {
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

    const enrollment = await login.execute({
      username: 'operador',
      password: 'local-operator-password',
      meta,
    });
    expect(enrollment.type).toBe('mfa_enrollment_required');

    addUser(identity, {
      username: 'operador.mfa',
      role: 'OPERATOR',
      status: 'ACTIVE',
      passwordHash: 'hash:local-operator-password',
      mfaEnabled: true,
      mfaSecretCiphertext: 'enc:SECRET',
    });
    await expect(
      login.execute({
        username: 'operador.mfa',
        password: 'local-operator-password',
        meta,
      }),
    ).rejects.toThrow(PublicMessages.invalidCredentials);

    const session = await login.execute({
      username: 'operador.mfa',
      password: 'local-operator-password',
      totpCode: '123456',
      meta,
    });
    expect(session.type).toBe('authenticated');
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
