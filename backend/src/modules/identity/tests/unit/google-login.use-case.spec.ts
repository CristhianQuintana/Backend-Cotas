import { DomainError, ErrorCodes, PublicMessages } from '../../../../common/exceptions/domain-error';
import type { Clock } from '../../../../common/utils/clock';
import type { AppConfig } from '../../../../config/app-config';
import { GoogleLoginUseCase } from '../../application/use-cases/google-login.use-case';
import { RegisterEmailUseCase } from '../../application/use-cases/register-email.use-case';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import type {
  PasswordHasher,
  TokenService,
} from '../../domain/ports/identity.ports';
import type { VerifiedGoogleIdentity } from '../../infrastructure/google/google-id-token.verifier';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';
import { FakeXui } from '../../../../../test/fakes/fake-xui';

const meta = {
  correlationId: '22222222-2222-4222-8222-222222222222',
  ipAddress: '127.0.0.1',
  userAgent: 'jest-google',
};

describe('Google Sign-In y registro email', () => {
  const clock: Clock = { now: () => new Date('2026-11-17T18:00:00.000Z') };
  const config = {
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 3600,
    enrollmentTokenTtlSeconds: 600,
    deviceLimitFailsafe: 3,
    googleSignInEnabled: true,
    googleOAuthClientIds: ['test-android-client.apps.googleusercontent.com'],
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
    generateRefreshToken: () => 'refresh-google-token',
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

  const mfa = {
    generateSecret: () => ({ base32: 'SECRET', otpauthUrl: 'otpauth://test' }),
    verify: () => false,
  };
  const cipher = {
    encrypt: (plain: string) => `enc:${plain}`,
    decrypt: (payload: string) => payload.replace(/^enc:/u, ''),
  };

  function setup(verifyImpl?: (idToken: string) => Promise<VerifiedGoogleIdentity>) {
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
      mfa,
      cipher,
      identity,
    );
    const google = {
      verify:
        verifyImpl ??
        (async () => ({
          subject: 'google-sub-001',
          email: 'nuevo@gmail.com',
          emailVerified: true,
          name: 'Nuevo Usuario',
          audience: 'test-android-client.apps.googleusercontent.com',
        })),
    };
    const googleLogin = new GoogleLoginUseCase(
      google as never,
      identity,
      identity,
      identity,
      tokens,
      passwords,
      identity,
      identity,
      config,
      clock,
    );
    const register = new RegisterEmailUseCase(identity, passwords, identity, clock, login);
    return { identity, login, googleLogin, register, google };
  }

  it('G-01/G-07 crea cuenta COTAS y emite sesión propia con ID token válido', async () => {
    const { googleLogin, identity } = setup();
    const result = await googleLogin.execute({
      idToken: 'valid-token',
      deviceId: 'device-google-1',
      platform: 'android',
      meta,
    });
    expect(result.type).toBe('authenticated');
    if (result.type !== 'authenticated') return;
    expect(result.accessToken.startsWith('access:')).toBe(true);
    expect(result.refreshToken).toBe('refresh-google-token');
    expect(result.tokenType).toBe('Bearer');
    expect(identity.users).toHaveLength(1);
    expect(identity.users[0]!.email).toBe('nuevo@gmail.com');
    expect(identity.users[0]!.passwordHash).toBeNull();
    expect(identity.identities).toHaveLength(1);
    expect(identity.identities[0]!.providerSubject).toBe('google-sub-001');
    expect(identity.sessions).toHaveLength(1);
  });

  it('G-10 reautenticación Google reutiliza la misma cuenta sin duplicar identidades', async () => {
    const { googleLogin, identity } = setup();
    await googleLogin.execute({ idToken: 't1', deviceId: 'd1', platform: 'android', meta });
    await googleLogin.execute({ idToken: 't2', deviceId: 'd1', platform: 'android', meta });
    expect(identity.users).toHaveLength(1);
    expect(identity.identities).toHaveLength(1);
    expect(identity.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('G-08 exige vinculación segura cuando el correo ya existe (ACCOUNT_LINK_REQUIRED)', async () => {
    const { googleLogin, identity, register } = setup();
    await register.execute({
      email: 'nuevo@gmail.com',
      password: 'correct-horse-battery',
      deviceId: 'd-email',
      platform: 'android',
      meta,
    });
    await expect(
      googleLogin.execute({ idToken: 't', deviceId: 'd2', platform: 'android', meta }),
    ).rejects.toMatchObject({
      code: ErrorCodes.accountLinkRequired,
      statusCode: 409,
      message: PublicMessages.accountLinkRequired,
    });
    expect(identity.identities).toHaveLength(0);
  });

  it('G-08 link con contraseña correcta vincula Google a la cuenta existente', async () => {
    const { googleLogin, identity, register } = setup();
    await register.execute({
      email: 'nuevo@gmail.com',
      password: 'correct-horse-battery',
      deviceId: 'd-email',
      platform: 'android',
      meta,
    });
    const linked = await googleLogin.execute({
      idToken: 't',
      password: 'correct-horse-battery',
      linking: true,
      deviceId: 'd2',
      platform: 'android',
      meta,
    });
    expect(linked.type).toBe('authenticated');
    expect(identity.identities).toHaveLength(1);
    expect(identity.identities[0]!.userId).toBe(identity.users[0]!.id);
  });

  it('G-09 rechaza identidad Google ya vinculada a otra cuenta', async () => {
    const { googleLogin, identity } = setup();
    await googleLogin.execute({ idToken: 't1', deviceId: 'd1', platform: 'android', meta });
    const other = addUser(identity, {
      username: 'other.local',
      email: 'otro@correo.com',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: 'hash:correct-horse-battery',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    await expect(
      identity.linkGoogleIdentity({
        userId: other.id,
        subject: 'google-sub-001',
        email: 'otro@correo.com',
        emailVerified: true,
        now: clock.now(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.identityConflict, statusCode: 409 });
  });

  it('G-06 rechaza correo Google no verificado (vía verifier)', async () => {
    const { googleLogin } = setup(async () => {
      throw new DomainError(
        ErrorCodes.googleEmailUnverified,
        401,
        PublicMessages.googleEmailUnverified,
      );
    });
    await expect(
      googleLogin.execute({ idToken: 'bad', deviceId: 'd1', platform: 'android', meta }),
    ).rejects.toMatchObject({ code: ErrorCodes.googleEmailUnverified });
  });

  it('G-02/G-03/G-04/G-05 rechaza token inválido/expirado/audiencia/emisor', async () => {
    const { googleLogin } = setup(async () => {
      throw new DomainError(
        ErrorCodes.googleTokenInvalid,
        401,
        PublicMessages.googleTokenInvalid,
      );
    });
    await expect(
      googleLogin.execute({ idToken: 'expired', deviceId: 'd1', platform: 'android', meta }),
    ).rejects.toMatchObject({ code: ErrorCodes.googleTokenInvalid });
  });

  it('B-01/B-02/B-03 login correo: correcto, contraseña incorrecta y correo inexistente', async () => {
    const { register, login } = setup();
    await register.execute({
      email: 'cuenta@cotas.pe',
      password: 'correct-horse-battery',
      deviceId: 'dev-email',
      platform: 'android',
      meta,
    });
    const ok = await login.execute({
      username: 'cuenta@cotas.pe',
      password: 'correct-horse-battery',
      deviceId: 'dev-email',
      platform: 'android',
      meta,
    });
    expect(ok.type).toBe('authenticated');

    await expect(
      login.execute({
        username: 'cuenta@cotas.pe',
        password: 'wrong-password-xx',
        deviceId: 'dev-email',
        platform: 'android',
        meta,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.invalidCredentials,
      message: PublicMessages.invalidCredentials,
    });

    await expect(
      login.execute({
        username: 'noexiste@cotas.pe',
        password: 'correct-horse-battery',
        deviceId: 'dev-email',
        platform: 'android',
        meta,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.invalidCredentials,
      message: PublicMessages.invalidCredentials,
    });
  });
});
