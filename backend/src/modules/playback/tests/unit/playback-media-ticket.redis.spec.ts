import type { AppConfig } from '../../../../config/app-config';
import { PlaybackMediaTicketStore } from '../../infrastructure/playback-media-ticket.store';

describe('PlaybackMediaTicketStore con Redis mock', () => {
  function redisMock() {
    const kv = new Map<string, string>();
    const sets = new Map<string, Set<string>>();
    return {
      get: jest.fn(async (key: string) => kv.get(key) ?? null),
      del: jest.fn(async (key: string) => {
        kv.delete(key);
        return 1;
      }),
      sadd: jest.fn(async (key: string, member: string) => {
        const set = sets.get(key) ?? new Set();
        set.add(member);
        sets.set(key, set);
        return 1;
      }),
      srem: jest.fn(async (key: string, member: string) => {
        sets.get(key)?.delete(member);
        return 1;
      }),
      smembers: jest.fn(async (key: string) => [...(sets.get(key) ?? [])]),
      expire: jest.fn(async () => 1),
      multi() {
        const ops: Array<() => Promise<unknown>> = [];
        const pipe = {
          set(key: string, value: string, _ex: string, _ttl: number) {
            ops.push(async () => {
              kv.set(key, value);
              return 'OK';
            });
            return pipe;
          },
          sadd(key: string, member: string) {
            ops.push(async () => {
              const set = sets.get(key) ?? new Set();
              set.add(member);
              sets.set(key, set);
              return 1;
            });
            return pipe;
          },
          expire() {
            ops.push(async () => 1);
            return pipe;
          },
          del(key: string) {
            ops.push(async () => {
              kv.delete(key);
              sets.delete(key);
              return 1;
            });
            return pipe;
          },
          async exec() {
            const out = [];
            for (const op of ops) {
              out.push([null, await op()]);
            }
            return out;
          },
        };
        return pipe;
      },
    };
  }

  it('emite, lee y revoca tickets en Redis', async () => {
    const redis = redisMock();
    const store = new PlaybackMediaTicketStore(
      {
        redisEnabled: true,
        playbackTicketTtlSeconds: 120,
        nodeEnv: 'test',
      } as AppConfig,
      redis as never,
    );
    await store.onModuleInit();
    const ticket = await store.issue({
      upstreamUrl: 'http://stream.test.local/a.m3u8',
      protocolHint: 'hls',
      userId: 'user-1',
      deviceId: 'dev-1',
      streamId: '42',
      contentType: 'live',
    });
    await expect(store.get(ticket.id)).resolves.toMatchObject({
      userId: 'user-1',
      streamId: '42',
    });
    await expect(store.revokeForUser('user-1')).resolves.toBe(1);
    await expect(store.get(ticket.id)).resolves.toBeNull();
  });
});
