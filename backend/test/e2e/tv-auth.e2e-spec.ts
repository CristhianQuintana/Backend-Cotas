import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addUser, type InMemoryIdentity } from '../fakes/in-memory-identity';
import { fakeIdToken } from '../fakes/fake-google-verifier';
import { createTestApp } from '../helpers/create-test-app';

const BASE = '/api/v1/auth/tv/qr';
const TV_A = 'e2e-tv-sala-0001';
const TV_B = 'e2e-tv-cuarto-0002';

describe('tv-auth (e2e HTTP)', () => {
  let app: INestApplication;
  let identity: InMemoryIdentity;
  let idToken: string;
  let userId: string;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    identity = created.identity;
    const user = addUser(identity, {
      username: 'tv.user',
      email: 'tv.user@example.com',
      displayName: 'Usuario TV',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    userId = user.id;
    identity.setSubscriptionSnapshot(user.id, {
      displayName: 'Usuario TV',
      username: 'tv.user',
      expiresAt: '2026-12-31T23:59:59.000Z',
      maxConnections: 10,
      activeConnections: 0,
      status: 'Active',
      lastVerifiedAt: new Date().toISOString(),
      source: 'cache',
    });
    await identity.linkGoogleIdentity({
      userId: user.id,
      subject: 'sub-tv-user',
      email: 'tv.user@example.com',
      emailVerified: true,
      now: new Date(),
    });
    idToken = fakeIdToken('sub-tv-user', 'tv.user@example.com', 'Usuario TV');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSession(deviceId = TV_A, deviceName = 'TV Sala') {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/session`)
      .send({ deviceId, platform: 'android-tv', deviceName })
      .expect(200);
    return res.body as {
      sessionId: string;
      code: string;
      pollSecret: string;
      authorizationUrl: string;
      status: string;
      expiresIn: number;
    };
  }

  it('POST /session devuelve el contrato esperado y no incluye tokens de acceso', async () => {
    const s = await createSession();
    expect(s).toMatchObject({ status: 'PENDING', expiresIn: 180 });
    expect(s.authorizationUrl).toBe(
      `https://tv.test.local/api/v1/auth/tv/qr/authorize/${s.sessionId}#c=${s.code}`,
    );
    expect(JSON.stringify(s)).not.toMatch(/accessToken|refreshToken/u);
  });

  it('valida el cuerpo de creación', async () => {
    await request(app.getHttpServer()).post(`${BASE}/session`).send({}).expect(400);
    await request(app.getHttpServer())
      .post(`${BASE}/session`)
      .send({ deviceId: 'corto' })
      .expect(400);
  });

  it('flujo completo por HTTP: Google en el teléfono → credenciales en el televisor una sola vez', async () => {
    const s = await createSession(TV_B, 'TV Cuarto');
    const api = request(app.getHttpServer());

    const pending = await api
      .get(`${BASE}/session/${s.sessionId}/status`)
      .set('Authorization', `Bearer ${s.pollSecret}`)
      .expect(200);
    expect(pending.body.status).toBe('PENDING');

    const info = await api
      .post(`${BASE}/session/${s.sessionId}/info`)
      .send({ code: s.code })
      .expect(200);
    expect(info.body.device.deviceName).toBe('TV Cuarto');

    const who = await api
      .post(`${BASE}/session/${s.sessionId}/identify`)
      .send({ code: s.code, idToken })
      .expect(200);
    expect(who.body.account.email).toBe('tv.user@example.com');

    await api
      .post(`${BASE}/session/${s.sessionId}/authorize`)
      .send({ code: s.code, idToken })
      .expect(200);

    const delivered = await api
      .get(`${BASE}/session/${s.sessionId}/status`)
      .set('Authorization', `Bearer ${s.pollSecret}`)
      .expect(200);
    expect(delivered.body).toMatchObject({
      status: 'AUTHORIZED',
      credentialsDelivered: false,
      tokenType: 'Bearer',
    });
    expect(typeof delivered.body.accessToken).toBe('string');
    expect(typeof delivered.body.refreshToken).toBe('string');

    const me = await api
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${delivered.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(userId);

    const again = await api
      .get(`${BASE}/session/${s.sessionId}/status`)
      .set('Authorization', `Bearer ${s.pollSecret}`)
      .expect(200);
    expect(again.body).toEqual({ status: 'AUTHORIZED', credentialsDelivered: true });

    // Reutilizar el código ya consumido falla.
    await api
      .post(`${BASE}/session/${s.sessionId}/authorize`)
      .send({ code: s.code, idToken })
      .expect(409);
  });

  it('el sondeo exige el secreto de la sesión', async () => {
    const a = await createSession(TV_A);
    const b = await createSession(TV_B);
    const api = request(app.getHttpServer());
    await api.get(`${BASE}/session/${a.sessionId}/status`).expect(401);
    await api
      .get(`${BASE}/session/${a.sessionId}/status`)
      .set('Authorization', `Bearer ${b.pollSecret}`)
      .expect(404);
    await api
      .get(`${BASE}/session/${a.sessionId}/status`)
      .set('Authorization', `Bearer ${a.code}`)
      .expect(404);
  });

  it('cancelar desde el televisor y rechazar desde el teléfono', async () => {
    const api = request(app.getHttpServer());
    const a = await createSession(TV_A);
    const cancelled = await api
      .post(`${BASE}/session/${a.sessionId}/cancel`)
      .set('Authorization', `Bearer ${a.pollSecret}`)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const b = await createSession(TV_B);
    const rejected = await api
      .post(`${BASE}/session/${b.sessionId}/reject`)
      .send({ code: b.code })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');
    const status = await api
      .get(`${BASE}/session/${b.sessionId}/status`)
      .set('Authorization', `Bearer ${b.pollSecret}`)
      .expect(200);
    expect(status.body).toEqual({ status: 'REJECTED', reason: 'user_rejected' });
  });

  it('identidad Google inválida → 401 y la sesión sigue pendiente', async () => {
    const s = await createSession();
    const api = request(app.getHttpServer());
    const res = await api
      .post(`${BASE}/session/${s.sessionId}/authorize`)
      .send({ code: s.code, idToken: 'token-que-no-es-de-google-123' })
      .expect(401);
    expect(res.body.code).toBe('GOOGLE_TOKEN_INVALID');
    await api.post(`${BASE}/session/${s.sessionId}/info`).send({ code: s.code }).expect(200);
  });

  it('bloquea la sesión tras demasiados códigos incorrectos (429)', async () => {
    const s = await createSession();
    const api = request(app.getHttpServer());
    const wrong = 'B'.repeat(32);
    await api.post(`${BASE}/session/${s.sessionId}/info`).send({ code: wrong }).expect(404);
    await api.post(`${BASE}/session/${s.sessionId}/info`).send({ code: wrong }).expect(404);
    const locked = await api
      .post(`${BASE}/session/${s.sessionId}/info`)
      .send({ code: wrong })
      .expect(429);
    expect(locked.body.code).toBe('TV_QR_LOCKED');
  });

  it('televisores simultáneos obtienen credenciales independientes', async () => {
    const api = request(app.getHttpServer());
    const sessions = await Promise.all(
      ['e2e-tv-par-0001', 'e2e-tv-par-0002', 'e2e-tv-par-0003'].map((d) =>
        createSession(d, `TV ${d}`),
      ),
    );
    await Promise.all(
      sessions.map((s) =>
        api
          .post(`${BASE}/session/${s.sessionId}/authorize`)
          .send({ code: s.code, idToken })
          .expect(200),
      ),
    );
    const results = await Promise.all(
      sessions.map((s) =>
        api
          .get(`${BASE}/session/${s.sessionId}/status`)
          .set('Authorization', `Bearer ${s.pollSecret}`)
          .expect(200),
      ),
    );
    const refresh = results.map((r) => r.body.refreshToken as string);
    const devices = results.map((r) => r.body.device.id as string);
    expect(new Set(refresh).size).toBe(3);
    expect(new Set(devices).size).toBe(3);
  });

  it('página de autorización: HTML con CSP por nonce, sin caché y sin tokens', async () => {
    const s = await createSession();
    const res = await request(app.getHttpServer())
      .get(`${BASE}/authorize/${s.sessionId}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    const csp = res.headers['content-security-policy'] as string;
    const nonce = /script-src 'nonce-([^']+)'/u.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain('https://accounts.google.com/gsi/client');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.text).toContain(`nonce="${nonce}"`);
    expect(res.text).toContain('test-tv-client.apps.googleusercontent.com');
    expect(res.text).toContain(s.sessionId);
    expect(res.text).not.toContain(s.code);
    expect(res.text).not.toContain(s.pollSecret);
    // Todos los <script> y <style> inline llevan el nonce.
    for (const tag of res.text.match(/<(script|style)\b[^>]*>/gu) ?? []) {
      if (!tag.includes('src=')) {
        expect(tag).toContain('nonce=');
      }
    }
    await request(app.getHttpServer()).get(`${BASE}/authorize/no-es-uuid`).expect(400);
  });
});
