import { createHash } from 'node:crypto';
import { DomainError, ErrorCodes } from '../../../../common/exceptions/domain-error';
import type { Clock } from '../../../../common/utils/clock';
import type { AppConfig } from '../../../../config/app-config';
import type { TokenService } from '../../../identity/domain/ports/identity.ports';
import { InMemoryIdentity, addUser } from '../../../../../test/fakes/in-memory-identity';
import { InMemoryTvQr } from '../../../../../test/fakes/in-memory-tv-qr';
import { FakeGoogleVerifier, fakeIdToken } from '../../../../../test/fakes/fake-google-verifier';
import type { GoogleIdTokenVerifier } from '../../../identity/infrastructure/google/google-id-token.verifier';
import { TvAuthUseCase } from '../../application/tv-auth.use-case';

const meta = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  ipAddress: '203.0.113.77',
  userAgent: 'tv-jest',
};

const TV_A = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TV_B = '2b1f6f0a-4f0c-4a52-9f4e-5d7d2f6f1c11';
const TV_C = '9d4b3a57-1f6c-4c7e-8e1a-0a8f6d2c7b33';

async function expectDomain(promise: Promise<unknown>, code: string, status: number) {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code, statusCode: status });
}

describe('tv-auth: login TV por QR', () => {
  let now = new Date('2026-11-18T15:00:00.000Z');
  const clock: Clock = { now: () => now };
  const config = {
    accessTokenTtlSeconds: 120,
    refreshTokenTtlSeconds: 3600,
    deviceLimitFailsafe: 3,
    apiPrefix: 'api/v1',
    tvQrTtlSeconds: 180,
    tvQrMaxAttempts: 3,
    tvQrPublicBaseUrl: 'https://tv.test.local',
    tvQrGoogleClientId: 'x',
  } as unknown as AppConfig;

  let counter = 0;
  const tokens: TokenService = {
    async signAccessToken(claims) {
      return `access:${claims.sub}:${claims.sid}`;
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
    generateRefreshToken: () => `refresh-${(counter += 1)}`,
    hashToken: (token) => `hashed:${token}`,
  };

  function setup(overrides: Partial<AppConfig> = {}) {
    now = new Date('2026-11-18T15:00:00.000Z');
    const identity = new InMemoryIdentity();
    identity.nowProvider = () => clock.now();
    const store = new InMemoryTvQr();
    const useCase = new TvAuthUseCase(
      store,
      new FakeGoogleVerifier() as unknown as GoogleIdTokenVerifier,
      identity,
      identity,
      identity,
      identity,
      tokens,
      identity,
      { ...config, ...overrides } as AppConfig,
      clock,
    );
    const makeUser = async (
      username: string,
      opts: { role?: 'CUSTOMER' | 'ADMIN'; maxConnections?: number; google?: boolean } = {},
    ) => {
      const email = `${username}@example.com`;
      const user = addUser(identity, {
        username,
        email,
        displayName: `Nombre ${username}`,
        role: opts.role ?? 'CUSTOMER',
        status: 'ACTIVE',
        mfaEnabled: false,
        mfaSecretCiphertext: null,
      });
      identity.setSubscriptionSnapshot(user.id, {
        displayName: username,
        username,
        expiresAt: '2026-12-31T23:59:59.000Z',
        maxConnections: opts.maxConnections ?? 3,
        activeConnections: 0,
        status: 'Active',
        lastVerifiedAt: now.toISOString(),
        source: 'cache',
      });
      if (opts.google !== false) {
        await identity.linkGoogleIdentity({
          userId: user.id,
          subject: `sub-${username}`,
          email,
          emailVerified: true,
          now,
        });
      }
      return { user, idToken: fakeIdToken(`sub-${username}`, email) };
    };
    const create = (deviceId = TV_A, deviceName = 'Sala Sony') =>
      useCase.createSession({ deviceId, platform: 'android-tv', deviceName }, meta);
    return { identity, store, useCase, makeUser, create };
  }

  it('crea la sesión: PENDING, expiración configurable, URL sin tokens y hashes en reposo', async () => {
    const { useCase, store } = setup({ tvQrTtlSeconds: 90 });
    const session = await useCase.createSession(
      { deviceId: TV_A, platform: 'android-tv', deviceName: 'Sala' },
      meta,
    );
    expect(session.status).toBe('PENDING');
    expect(session.expiresIn).toBe(90);
    expect(session.expiresAt).toBe('2026-11-18T15:01:30.000Z');
    expect(session.authorizationUrl).toBe(
      `https://tv.test.local/api/v1/auth/tv/qr/authorize/${session.sessionId}#c=${session.code}`,
    );
    expect(session.authorizationUrl).not.toContain(session.pollSecret);
    expect(session.authorizationUrl).not.toMatch(/token|access/iu);
    expect(session.code.length).toBeGreaterThanOrEqual(32);
    expect(session.pollSecret.length).toBeGreaterThanOrEqual(43);
    const row = store.rows.get(session.sessionId)!;
    expect(row.codeHash).toBe(createHash('sha256').update(session.code).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(session.code);
    expect(JSON.stringify(row)).not.toContain(session.pollSecret);
    expect(row.requestIpMasked).toBe('203.0.x.x');
  });

  it('no se puede crear sin URL pública configurada', async () => {
    const { useCase } = setup({ tvQrPublicBaseUrl: null });
    await expectDomain(
      useCase.createSession({ deviceId: TV_A }, meta),
      ErrorCodes.dependencyUnavailable,
      503,
    );
  });

  it('flujo completo: info → identify → authorize → TV recibe credenciales una sola vez', async () => {
    const { useCase, makeUser, create, identity } = setup();
    const { user, idToken } = await makeUser('ana');
    const s = await create();

    const info = await useCase.getInfo({ sessionId: s.sessionId, code: s.code });
    expect(info.device).toMatchObject({ deviceName: 'Sala Sony', platform: 'TV' });

    const who = await useCase.identify({ sessionId: s.sessionId, code: s.code, idToken }, meta);
    expect(who.account).toEqual({ displayName: 'Nombre ana', email: 'ana@example.com' });

    const pending = await useCase.getStatus(
      { sessionId: s.sessionId, pollSecret: s.pollSecret },
      meta,
    );
    expect(pending.status).toBe('PENDING');

    const authorized = await useCase.authorize(
      { sessionId: s.sessionId, code: s.code, idToken },
      meta,
    );
    expect(authorized.status).toBe('AUTHORIZED');

    const delivered = await useCase.getStatus(
      { sessionId: s.sessionId, pollSecret: s.pollSecret },
      meta,
    );
    expect(delivered).toMatchObject({
      status: 'AUTHORIZED',
      credentialsDelivered: false,
      tokenType: 'Bearer',
      expiresIn: 120,
      device: { deviceName: 'Sala Sony', platform: 'TV' },
    });
    if (delivered.status !== 'AUTHORIZED' || delivered.credentialsDelivered) {
      throw new Error('se esperaban credenciales');
    }
    expect(delivered.accessToken).toContain(user.id);
    expect(delivered.refreshToken).toMatch(/^refresh-/u);

    const again = await useCase.getStatus(
      { sessionId: s.sessionId, pollSecret: s.pollSecret },
      meta,
    );
    expect(again).toEqual({ status: 'AUTHORIZED', credentialsDelivered: true });
    expect(JSON.stringify(again)).not.toContain('refresh-');

    const devices = await identity.listDevices(user.id, null);
    expect(devices.items.filter((d) => d.platform === 'TV')).toHaveLength(1);
  });

  it('el secreto de sondeo aísla la sesión: sin secreto o con otro secreto → 404', async () => {
    const { useCase, create } = setup();
    const a = await create(TV_A);
    const b = await create(TV_B);
    await expectDomain(
      useCase.getStatus({ sessionId: a.sessionId, pollSecret: b.pollSecret }, meta),
      ErrorCodes.tvQrInvalid,
      404,
    );
    await expectDomain(
      useCase.getStatus({ sessionId: a.sessionId, pollSecret: a.code }, meta),
      ErrorCodes.tvQrInvalid,
      404,
    );
    await expectDomain(
      useCase.cancel({ sessionId: a.sessionId, pollSecret: b.pollSecret }, meta),
      ErrorCodes.tvQrInvalid,
      404,
    );
  });

  it('código de un solo uso: no se puede autorizar dos veces ni reusar tras entregar', async () => {
    const { useCase, makeUser, create } = setup();
    const ana = await makeUser('ana');
    const luis = await makeUser('luis');
    const s = await create();
    await useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: ana.idToken }, meta);
    await expectDomain(
      useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: luis.idToken }, meta),
      ErrorCodes.tvQrClosed,
      409,
    );
    await useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta);
    await expectDomain(
      useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: luis.idToken }, meta),
      ErrorCodes.tvQrClosed,
      409,
    );
    // Sigue entregada a Ana, nunca a Luis.
    const row = await useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta);
    expect(row).toEqual({ status: 'AUTHORIZED', credentialsDelivered: true });
  });

  it('autorizaciones concurrentes de la misma sesión: solo una gana', async () => {
    const { useCase, makeUser, create, store } = setup();
    const ana = await makeUser('ana');
    const luis = await makeUser('luis');
    const s = await create();
    const results = await Promise.allSettled([
      useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: ana.idToken }, meta),
      useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: luis.idToken }, meta),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(store.rows.get(s.sessionId)!.status).toBe('AUTHORIZED');
  });

  it('sondeos simultáneos: solo uno recibe las credenciales', async () => {
    const { useCase, makeUser, create } = setup();
    const ana = await makeUser('ana');
    const s = await create();
    await useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: ana.idToken }, meta);
    const polls = await Promise.all(
      Array.from({ length: 5 }, () =>
        useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta),
      ),
    );
    const withTokens = polls.filter(
      (p) => p.status === 'AUTHORIZED' && p.credentialsDelivered === false,
    );
    expect(withTokens).toHaveLength(1);
  });

  it('expiración: tras el TTL la sesión pasa a EXPIRED y no se puede autorizar', async () => {
    const { useCase, makeUser, create } = setup();
    const ana = await makeUser('ana');
    const s = await create();
    now = new Date(now.getTime() + 179_000);
    expect(
      (await useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta)).status,
    ).toBe('PENDING');
    now = new Date(now.getTime() + 1_000);
    await expectDomain(
      useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: ana.idToken }, meta),
      ErrorCodes.tvQrExpired,
      410,
    );
    expect(
      await useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta),
    ).toEqual({ status: 'EXPIRED', reason: 'expired' });
    await expectDomain(
      useCase.getInfo({ sessionId: s.sessionId, code: s.code }),
      ErrorCodes.tvQrExpired,
      410,
    );
  });

  it('tras autorizar, el televisor tiene una ventana corta (120 s) para retirar sus credenciales', async () => {
    const { useCase, makeUser, create } = setup();
    const ana = await makeUser('ana');
    const s = await create();
    await useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: ana.idToken }, meta);
    now = new Date(now.getTime() + 60_000);
    expect(
      await useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta),
    ).toMatchObject({ status: 'AUTHORIZED', credentialsDelivered: false });

    const late = await create(TV_B);
    await useCase.authorize(
      { sessionId: late.sessionId, code: late.code, idToken: ana.idToken },
      meta,
    );
    now = new Date(now.getTime() + 121_000);
    expect(
      await useCase.getStatus({ sessionId: late.sessionId, pollSecret: late.pollSecret }, meta),
    ).toEqual({ status: 'EXPIRED', reason: 'delivery_expired' });
  });

  it('limitación de intentos: códigos erróneos bloquean la sesión (REJECTED) incluso con el código correcto', async () => {
    const { useCase, create } = setup();
    const s = await create();
    const wrong = 'A'.repeat(32);
    await expectDomain(
      useCase.getInfo({ sessionId: s.sessionId, code: wrong }),
      ErrorCodes.tvQrInvalid,
      404,
    );
    await expectDomain(
      useCase.getInfo({ sessionId: s.sessionId, code: wrong }),
      ErrorCodes.tvQrInvalid,
      404,
    );
    await expectDomain(
      useCase.getInfo({ sessionId: s.sessionId, code: wrong }),
      ErrorCodes.tvQrLocked,
      429,
    );
    await expectDomain(
      useCase.getInfo({ sessionId: s.sessionId, code: s.code }),
      ErrorCodes.tvQrClosed,
      409,
    );
    expect(
      await useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta),
    ).toEqual({ status: 'REJECTED', reason: 'too_many_attempts' });
  });

  it('el usuario puede rechazar desde el teléfono (REJECTED)', async () => {
    const { useCase, create } = setup();
    const s = await create();
    expect(await useCase.reject({ sessionId: s.sessionId, code: s.code }, meta)).toEqual({
      status: 'REJECTED',
    });
    expect(
      await useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta),
    ).toEqual({ status: 'REJECTED', reason: 'user_rejected' });
  });

  it('el televisor puede cancelar (CANCELLED) y es idempotente', async () => {
    const { useCase, makeUser, create } = setup();
    const ana = await makeUser('ana');
    const s = await create();
    expect(
      await useCase.cancel({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta),
    ).toEqual({
      status: 'CANCELLED',
    });
    expect(
      await useCase.cancel({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta),
    ).toEqual({
      status: 'CANCELLED',
    });
    await expectDomain(
      useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: ana.idToken }, meta),
      ErrorCodes.tvQrClosed,
      409,
    );
  });

  it('crear otra sesión para el mismo televisor invalida la anterior', async () => {
    const { useCase, create } = setup();
    const first = await create(TV_A);
    const second = await create(TV_A);
    expect(
      await useCase.getStatus({ sessionId: first.sessionId, pollSecret: first.pollSecret }, meta),
    ).toEqual({ status: 'CANCELLED', reason: 'superseded' });
    expect(
      (
        await useCase.getStatus(
          { sessionId: second.sessionId, pollSecret: second.pollSecret },
          meta,
        )
      ).status,
    ).toBe('PENDING');
  });

  it('varios televisores autorizados a la vez quedan aislados (sesión, dispositivo y tokens propios)', async () => {
    const { useCase, makeUser, create, identity } = setup();
    const ana = await makeUser('ana');
    const luis = await makeUser('luis');
    const a = await create(TV_A, 'TV Sala');
    const b = await create(TV_B, 'TV Cuarto');
    const c = await create(TV_C, 'TV Cocina');

    await Promise.all([
      useCase.authorize({ sessionId: a.sessionId, code: a.code, idToken: ana.idToken }, meta),
      useCase.authorize({ sessionId: b.sessionId, code: b.code, idToken: ana.idToken }, meta),
      useCase.authorize({ sessionId: c.sessionId, code: c.code, idToken: luis.idToken }, meta),
    ]);

    // El código de una sesión no sirve en otra.
    await expectDomain(
      useCase.getInfo({ sessionId: a.sessionId, code: b.code }),
      ErrorCodes.tvQrClosed,
      409,
    );

    const [ra, rb, rc] = await Promise.all(
      [a, b, c].map((s) =>
        useCase.getStatus({ sessionId: s.sessionId, pollSecret: s.pollSecret }, meta),
      ),
    );
    for (const r of [ra, rb, rc]) {
      expect(r).toMatchObject({ status: 'AUTHORIZED', credentialsDelivered: false });
    }
    const creds = [ra, rb, rc].map((r) => {
      if (r!.status !== 'AUTHORIZED' || r!.credentialsDelivered) {
        throw new Error('sin credenciales');
      }
      return r!;
    });
    expect(new Set(creds.map((c2) => c2.refreshToken)).size).toBe(3);
    expect(new Set(creds.map((c2) => c2.accessToken)).size).toBe(3);
    expect(new Set(creds.map((c2) => c2.device.id)).size).toBe(3);
    expect(creds[0]!.account.displayName).toBe('Nombre ana');
    expect(creds[1]!.account.displayName).toBe('Nombre ana');
    expect(creds[2]!.account.displayName).toBe('Nombre luis');
    expect(creds[0]!.accessToken).toContain(ana.user.id);
    expect(creds[2]!.accessToken).toContain(luis.user.id);
    const anaDevices = await identity.listDevices(ana.user.id, null);
    expect(anaDevices.items.map((d) => d.deviceName).sort()).toEqual(['TV Cuarto', 'TV Sala']);
  });

  it('cupo de dispositivos lleno: DEVICE_LIMIT y la sesión sigue PENDING (reintentable)', async () => {
    const { useCase, makeUser, create } = setup();
    const ana = await makeUser('ana', { maxConnections: 1 });
    const first = await create(TV_A, 'TV Sala');
    await useCase.authorize(
      { sessionId: first.sessionId, code: first.code, idToken: ana.idToken },
      meta,
    );
    await useCase.getStatus({ sessionId: first.sessionId, pollSecret: first.pollSecret }, meta);
    const second = await create(TV_B, 'TV Cuarto');
    await expectDomain(
      useCase.authorize(
        { sessionId: second.sessionId, code: second.code, idToken: ana.idToken },
        meta,
      ),
      ErrorCodes.deviceLimit,
      403,
    );
    expect(
      (
        await useCase.getStatus(
          { sessionId: second.sessionId, pollSecret: second.pollSecret },
          meta,
        )
      ).status,
    ).toBe('PENDING');
  });

  it('identidad Google: token inválido, cuenta inexistente, correo sin vincular y personal', async () => {
    const { useCase, makeUser, create } = setup();
    await makeUser('ana');
    await makeUser('sin-google', { google: false });
    const admin = await makeUser('admin1', { role: 'ADMIN' });
    const s = await create();

    await expectDomain(
      useCase.authorize(
        { sessionId: s.sessionId, code: s.code, idToken: 'basura-sin-formato-valido' },
        meta,
      ),
      ErrorCodes.googleTokenInvalid,
      401,
    );
    await expectDomain(
      useCase.authorize(
        {
          sessionId: s.sessionId,
          code: s.code,
          idToken: fakeIdToken('sub-nuevo', 'nuevo@example.com'),
        },
        meta,
      ),
      ErrorCodes.tvQrAccountNotFound,
      404,
    );
    await expectDomain(
      useCase.authorize(
        {
          sessionId: s.sessionId,
          code: s.code,
          idToken: fakeIdToken('sub-otro', 'sin-google@example.com'),
        },
        meta,
      ),
      ErrorCodes.accountLinkRequired,
      409,
    );
    await expectDomain(
      useCase.authorize({ sessionId: s.sessionId, code: s.code, idToken: admin.idToken }, meta),
      ErrorCodes.forbidden,
      403,
    );
    // Ninguno de esos fallos cerró la sesión ni consumió intentos del código.
    expect((await useCase.getInfo({ sessionId: s.sessionId, code: s.code })).status).toBe(
      'PENDING',
    );
  });
});
