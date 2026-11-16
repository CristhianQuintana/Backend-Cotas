import { DomainError } from '../../../../common/exceptions/domain-error';
import type { AppConfig } from '../../../../config/app-config';
import { PlaybackMediaTicketStore } from '../../infrastructure/playback-media-ticket.store';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    redisEnabled: false,
    playbackTicketTtlSeconds: 300,
    nodeEnv: 'test',
    ...overrides,
  } as AppConfig;
}

describe('PlaybackMediaTicketStore', () => {
  it('usa memoria cuando Redis está deshabilitado', async () => {
    const store = new PlaybackMediaTicketStore(baseConfig(), null);
    await store.onModuleInit();
    const ticket = await store.issue({
      upstreamUrl: 'http://stream.test.local/live/1',
      protocolHint: 'hls',
      userId: 'u1',
      deviceId: 'd1',
    });
    await expect(store.get(ticket.id)).resolves.toMatchObject({ userId: 'u1' });
    await expect(store.revokeForUser('u1')).resolves.toBe(1);
    await expect(store.get(ticket.id)).resolves.toBeNull();
  });

  it('falla en emisión si Redis está habilitado pero no disponible (fail-closed)', async () => {
    const store = new PlaybackMediaTicketStore(
      baseConfig({ redisEnabled: true } as Partial<AppConfig>),
      null,
    );
    await store.onModuleInit();
    await expect(
      store.issue({
        upstreamUrl: 'http://stream.test.local/live/1',
        protocolHint: 'hls',
        userId: 'u1',
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('no lee memoria local cuando Redis está habilitado y caído', async () => {
    const store = new PlaybackMediaTicketStore(
      baseConfig({ redisEnabled: true } as Partial<AppConfig>),
      null,
    );
    await store.onModuleInit();
    await expect(store.get('any-id')).resolves.toBeNull();
  });
});
