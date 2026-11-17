import type { AppConfig } from '../../../../config/app-config';
import { DomainError } from '../../../../common/exceptions/domain-error';
import { AuthorizePlaybackUseCase } from '../../application/authorize-playback.use-case';
import type { PlaybackMediaTicketStore } from '../../infrastructure/playback-media-ticket.store';

const meta = {
  correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

describe('AuthorizePlaybackUseCase', () => {
  const config = {
    nodeEnv: 'test',
    xuiBaseUrl: 'http://xui.test.local:25461',
    xuiAllowedStreamHosts: ['xui.test.local', 'stream.test.local'],
  } as AppConfig;

  function harness(overrides?: {
    live?: Array<{ id: string; name: string }>;
    vod?: Array<{ id: string; name: string; containerExtension?: string | null }>;
  }) {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const lines = {
      credentialsFor: jest.fn().mockResolvedValue({ username: 'u', password: 'p' }),
    };
    const tickets = {
      issue: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
    };
    const xui = {
      getLiveStreams: jest.fn().mockResolvedValue(overrides?.live ?? [{ id: '10', name: 'Canal' }]),
      getVodStreams: jest
        .fn()
        .mockResolvedValue(
          overrides?.vod ?? [{ id: '20', name: 'Pelicula', containerExtension: 'mp4' }],
        ),
      getSeriesInfo: jest.fn().mockResolvedValue({
        id: '30',
        episodes: [{ id: '31', name: 'Ep1', seasonNumber: 1, extension: 'mp4' }],
      }),
      getServerInfo: jest.fn().mockResolvedValue({
        host: 'stream.test.local',
        port: '8080',
        protocol: 'http',
      }),
    };
    const useCase = new AuthorizePlaybackUseCase(
      xui as never,
      config,
      audit as never,
      lines as never,
      tickets as unknown as PlaybackMediaTicketStore,
    );
    return { useCase, audit, tickets, xui };
  }

  const user = {
    id: 'user-1',
    username: 'linea',
    sessionId: 'sess',
    role: 'CUSTOMER' as const,
    deviceId: 'dev-1',
  };

  it('autoriza live y emite ticket proxy', async () => {
    const { useCase, tickets, audit } = harness();
    const result = await useCase.execute(
      user,
      { contentType: 'live', streamId: '10', publicApiBase: 'https://api.test/api/v1' },
      meta,
    );
    expect(result.streamUrl).toContain('/playback/media/ticket-1');
    expect(tickets.issue).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ result: 'success' }));
  });

  it('autoriza vod y series', async () => {
    const { useCase } = harness();
    await expect(
      useCase.execute(
        user,
        { contentType: 'vod', streamId: '20', publicApiBase: 'https://api.test/api/v1' },
        meta,
      ),
    ).resolves.toMatchObject({ contentType: 'vod' });
    await expect(
      useCase.execute(
        user,
        {
          contentType: 'series',
          streamId: '31',
          seriesId: '30',
          seasonNumber: 1,
          publicApiBase: 'https://api.test/api/v1',
        },
        meta,
      ),
    ).resolves.toMatchObject({ contentType: 'series' });
  });

  it('404 si el contenido no existe', async () => {
    const { useCase, audit } = harness({ live: [] });
    await expect(
      useCase.execute(
        user,
        { contentType: 'live', streamId: '999', publicApiBase: 'https://api.test/api/v1' },
        meta,
      ),
    ).rejects.toBeInstanceOf(DomainError);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ result: 'failure' }));
  });

  it('valida seriesId obligatorio', async () => {
    const { useCase } = harness();
    await expect(
      useCase.execute(
        user,
        { contentType: 'series', streamId: '31', publicApiBase: 'https://api.test/api/v1' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
