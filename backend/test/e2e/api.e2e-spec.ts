import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import { createSwaggerDocument } from '../../src/configure-http';
import { PublicMessages } from '../../src/common/exceptions/domain-error';
import { addUser, type InMemoryIdentity } from '../fakes/in-memory-identity';
import { type FakeXui } from '../fakes/fake-xui';
import { createTestApp } from '../helpers/create-test-app';

const password = 'correct-horse-battery';

describe('API COTAS', () => {
  let app: INestApplication;
  let identity: InMemoryIdentity;
  let xui: FakeXui;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    identity = created.identity;
    xui = created.xui;
    const operatorPasswordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 1,
      parallelism: 1,
    });
    xui.liveCategories = [{ id: '1', name: 'Noticias', parentId: null }];
    xui.liveStreams = [
      { id: '1001', name: 'Canal Demo', categoryId: '1', iconUrl: null, epgChannelId: 'demo' },
    ];
    xui.vodCategories = [{ id: '9', name: 'Cine', parentId: null }];
    xui.vodStreams = [
      {
        id: '2001',
        name: 'Pelicula Demo',
        categoryId: '9',
        iconUrl: null,
        containerExtension: 'mp4',
        rating: '7',
        categoryIds: ['9'],
        year: null,
      },
    ];
    xui.epg.set('1001', []);
    for (const username of ['viewer.demo', 'other.demo', 'disabled.demo', 'operator.demo']) {
      xui.lines.set(username, password);
    }
    addUser(identity, {
      username: 'viewer.demo',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
    addUser(identity, {
      username: 'other.demo',
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
    addUser(identity, {
      username: 'operator.demo',
      role: 'OPERATOR',
      status: 'ACTIVE',
      passwordHash: operatorPasswordHash,
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  function http() {
    return request(app.getHttpServer());
  }

  async function login(username: string, extra: Record<string, string> = {}) {
    return http()
      .post('/api/v1/auth/login')
      .send({ username, password, ...extra });
  }

  it('responde liveness sin secretos y readiness con la base simulada', async () => {
    const live = await http().get('/api/v1/health/live').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    expect(JSON.stringify(live.body)).not.toContain('test_only_password');
    await http().get('/api/v1/health/ready').expect(200);
    await http().get('/api/v1/health/dependencies').expect(401);
  });

  it('rechaza rutas protegidas, tokens inválidos y campos no permitidos', async () => {
    const anonymous = await http().get('/api/v1/catalog/live/streams').expect(401);
    expect(anonymous.body.code).toBe('UNAUTHORIZED');
    expect(anonymous.body.stack).toBeUndefined();

    await http()
      .get('/api/v1/catalog/live/streams')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    const extra = await http()
      .post('/api/v1/auth/login')
      .send({ username: 'viewer.demo', password, role: 'OPERATOR' });
    expect(extra.status).toBe(400);
    expect(JSON.stringify(extra.body)).not.toContain(password);

    await http().post('/api/v1/auth/login').send({ username: 'no' }).expect(400);
    await http().get('/api/v1/no-existe').expect(404);
  });

  it('inicia sesión, entrega catálogo paginado y una referencia directa', async () => {
    const logged = await login('viewer.demo');
    expect(logged.status).toBe(200);
    expect(logged.body.type).toBe('authenticated');
    const token = logged.body.accessToken as string;

    const streams = await http()
      .get('/api/v1/catalog/live/streams?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(streams.body.total).toBe(1);
    expect(streams.body.items[0].name).toBe('Canal Demo');
    expect(JSON.stringify(streams.body)).not.toContain('xui_test_password_not_real');

    await http()
      .get('/api/v1/catalog/live/streams/1001/epg')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({ streamId: '1001', items: [] });

    const playback = await http()
      .post('/api/v1/playback/authorizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ contentType: 'live', streamId: '1001' })
      .expect(200);
    expect(playback.body.delivery).toBe('direct');
    expect(playback.body.accessMaterialEmbedded).toBe(true);
    expect(playback.body.streamUrl).toContain('stream.test.local');
    expect(
      identity.audits.some(
        (event) => event.action === 'playback.authorize' && event.result === 'success',
      ),
    ).toBe(true);
    expect(JSON.stringify(identity.audits)).not.toContain('xui_test_password_not_real');

    await http()
      .post('/api/v1/playback/authorizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ contentType: 'live', streamId: '1001', streamUrl: 'http://evil.test/a' })
      .expect(400);
    await http()
      .post('/api/v1/playback/authorizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ contentType: 'live', streamId: '404' })
      .expect(404);
  });

  it('separa autenticación de autorización y evita IDOR de sesiones', async () => {
    const viewer = await login('viewer.demo');
    const other = await login('other.demo');
    await http()
      .get('/api/v1/audit/events')
      .set('Authorization', `Bearer ${viewer.body.accessToken}`)
      .expect(403);
    const otherSessions = await http()
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${other.body.accessToken}`)
      .expect(200);
    await http()
      .delete(`/api/v1/sessions/${otherSessions.body.items[0].id}`)
      .set('Authorization', `Bearer ${viewer.body.accessToken}`)
      .expect(404);

    const ownSessions = await http()
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${viewer.body.accessToken}`)
      .expect(200);
    const current = ownSessions.body.items.find(
      (item: { current: boolean; id: string }) => item.current,
    );
    await http()
      .delete(`/api/v1/sessions/${current.id}`)
      .set('Authorization', `Bearer ${other.body.accessToken}`)
      .expect(404);
    await http()
      .get('/api/v1/catalog/live/categories')
      .set('Authorization', `Bearer ${viewer.body.accessToken}`)
      .expect(200);
  });

  it('autentica al operador solo con usuario y contraseña, consulta dependencias y revoca la sesión', async () => {
    const logged = await login('operator.demo');
    expect(logged.body.type).toBe('authenticated');
    const token = logged.body.accessToken as string;
    const dependencies = await http()
      .get('/api/v1/health/dependencies')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(dependencies.body.checks).toEqual({
      database: 'up',
      xui: 'up',
      redis: 'skipped',
    });
    expect(JSON.stringify(dependencies.body)).not.toContain('xui.test.local');

    await http().post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);

    const viewer = await login('viewer.demo');
    const disabled = identity.users.find((user) => user.username === 'viewer.demo');
    if (!disabled) {
      throw new Error('usuario no encontrado');
    }
    disabled.status = 'DISABLED';
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${viewer.body.accessToken}`)
      .expect(401);
    disabled.status = 'ACTIVE';
  });

  it('rota el refresh token y revoca la familia si se reutiliza el anterior', async () => {
    const logged = await login('viewer.demo');
    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: logged.body.refreshToken })
      .expect(200);
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(200);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: logged.body.refreshToken })
      .expect(401);
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it('usa mensajes genéricos y no publica OpenAPI con secretos', async () => {
    const missing = await login('missing.demo');
    const wrong = await http()
      .post('/api/v1/auth/login')
      .send({ username: 'viewer.demo', password: 'otra-clave-larga' });
    expect(missing.body.message).toBe(PublicMessages.invalidCredentials);
    expect(wrong.body.message).toBe(PublicMessages.invalidCredentials);

    const document = createSwaggerDocument(app) as unknown as { paths: Record<string, unknown> };
    const serialized = JSON.stringify(document);
    expect(serialized).toContain('/api/v1/auth/login');
    expect(serialized).not.toContain('xui_test_password_not_real');
    expect(serialized).not.toContain('test-only-jwt-access-secret');
    expect(createHash('sha256').update(serialized).digest('hex')).toHaveLength(64);
  });

  it('aplica CORS restringido, cabeceras y límite de cuerpo', async () => {
    const allowed = await http().get('/api/v1/health/live').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['x-powered-by']).toBeUndefined();
    const denied = await http().get('/api/v1/health/live').set('Origin', 'http://evil.test');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    await http()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'text/plain')
      .send('username=viewer')
      .expect(415);
    await http()
      .post('/api/v1/auth/login')
      .send({ username: 'viewer.demo', password: 'x'.repeat(20_000) })
      .expect(413);
  });

  it('convierte un fallo de XUI en un error controlado', async () => {
    const logged = await login('viewer.demo');
    const {
      DomainError,
      ErrorCodes,
      PublicMessages: messages,
    } = await import('../../src/common/exceptions/domain-error');
    xui.error = new DomainError(ErrorCodes.dependencyTimeout, 504, messages.dependencyTimeout);
    const failed = await http()
      .get('/api/v1/catalog/vod/streams')
      .set('Authorization', `Bearer ${logged.body.accessToken}`)
      .expect(504);
    expect(failed.body.message).toBe(messages.dependencyTimeout);
    expect(failed.body.stack).toBeUndefined();
    xui.error = null;
  });

  it('entrega series, una temporada vacía y la reproducción del episodio', async () => {
    xui.series = [
      {
        id: '7',
        name: 'Serie Demo',
        categoryId: '3',
        categoryIds: ['3'],
        posterUrl: null,
        rating: null,
        year: '2024',
      },
    ];
    xui.seriesDetails.set('7', {
      id: '7',
      name: 'Serie Demo',
      categoryIds: ['3'],
      posterUrl: null,
      plot: 'Historia',
      year: '2024',
      rating: null,
      genre: null,
      cast: null,
      director: null,
      seasons: [
        { number: 1, name: 'Temporada 1', episodeCount: 1, posterUrl: null },
        { number: 2, name: 'Temporada 2', episodeCount: 0, posterUrl: null },
      ],
      episodes: [
        {
          id: '70',
          seasonNumber: 1,
          episodeNumber: 1,
          name: 'Piloto',
          plot: null,
          duration: '40:00',
          posterUrl: null,
          extension: 'mp4',
        },
      ],
    });
    const logged = await login('viewer.demo');
    const token = logged.body.accessToken as string;
    const listed = await http()
      .get('/api/v1/catalog/series?search=demo')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listed.body.total).toBe(1);
    const empty = await http()
      .get('/api/v1/catalog/series/7/seasons/2/episodes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(empty.body.items).toEqual([]);
    const playback = await http()
      .post('/api/v1/playback/authorizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ contentType: 'series', streamId: '70', seriesId: '7', seasonNumber: 1 })
      .expect(200);
    expect(playback.body.protocolHint).toBe('progressive');
    expect(playback.body.streamUrl).toContain('/series/');
    expect(playback.body.streamUrl).toContain('/70.mp4');
    expect(JSON.stringify(identity.audits)).not.toContain(password);
    await http()
      .post('/api/v1/playback/authorizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ contentType: 'series', streamId: '70', seriesId: '7', seasonNumber: 2 })
      .expect(404);
    await http()
      .get('/api/v1/catalog/series/404')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
