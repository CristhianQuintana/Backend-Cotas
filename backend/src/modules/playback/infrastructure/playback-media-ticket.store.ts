import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { connectRedis, createRedisClient } from '../../../infrastructure/redis/redis.client';
import { REDIS_CLIENT } from '../../catalog/infrastructure/redis-catalog.cache';

export interface PlaybackMediaTicket {
  id: string;
  upstreamUrl: string;
  upstreamOrigin: string;
  protocolHint: 'hls' | 'progressive';
  expiresAtMs: number;
  userId: string;
  deviceId: string | null;
  streamId: string | null;
  contentType: string | null;
}

@Injectable()
export class PlaybackMediaTicketStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaybackMediaTicketStore.name);
  private readonly memory = new Map<string, PlaybackMediaTicket>();
  private readonly client: Redis | null;
  private readonly ownsClient: boolean;
  private ready = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(REDIS_CLIENT) injected?: Redis | null,
  ) {
    if (injected) {
      this.client = injected;
      this.ownsClient = false;
    } else {
      this.client = createRedisClient(config);
      this.ownsClient = true;
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.redisEnabled) {
      this.logger.warn('Tickets de playback en memoria (REDIS_ENABLED=false).');
      return;
    }
    this.ready = await connectRedis(this.client);
    if (!this.ready) {
      this.logger.warn(
        'Redis no alcanzable: tickets de playback caen a memoria local (no multi-instancia).',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.ownsClient || !this.client) {
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  private ttlMs(explicit?: number): number {
    return explicit ?? this.config.playbackTicketTtlSeconds * 1000;
  }

  private key(id: string): string {
    return `playback:ticket:${id}`;
  }

  private userKey(userId: string): string {
    return `playback:user:${userId}`;
  }

  private useRedis(): boolean {
    return Boolean(this.client) && this.ready && this.config.redisEnabled;
  }

  async issue(input: {
    upstreamUrl: string;
    protocolHint: 'hls' | 'progressive';
    userId: string;
    deviceId?: string | null;
    streamId?: string | null;
    contentType?: string | null;
    ttlMs?: number;
  }): Promise<PlaybackMediaTicket> {
    const ttl = this.ttlMs(input.ttlMs);
    const upstream = new URL(input.upstreamUrl);
    const ticket: PlaybackMediaTicket = {
      id: randomUUID().replace(/-/gu, ''),
      upstreamUrl: input.upstreamUrl,
      upstreamOrigin: `${upstream.protocol}//${upstream.host}`,
      protocolHint: input.protocolHint,
      expiresAtMs: Date.now() + ttl,
      userId: input.userId,
      deviceId: input.deviceId ?? null,
      streamId: input.streamId ?? null,
      contentType: input.contentType ?? null,
    };

    if (this.useRedis() && this.client) {
      const ttlSec = Math.max(1, Math.ceil(ttl / 1000));
      const pipe = this.client.multi();
      pipe.set(this.key(ticket.id), JSON.stringify(ticket), 'EX', ttlSec);
      pipe.sadd(this.userKey(ticket.userId), ticket.id);
      pipe.expire(this.userKey(ticket.userId), ttlSec);
      await pipe.exec();
      return ticket;
    }

    this.purgeExpiredMemory();
    this.memory.set(ticket.id, ticket);
    return ticket;
  }

  async get(id: string): Promise<PlaybackMediaTicket | null> {
    if (this.useRedis() && this.client) {
      const raw = await this.client.get(this.key(id));
      if (!raw) {
        return null;
      }
      try {
        const ticket = JSON.parse(raw) as PlaybackMediaTicket;
        if (ticket.expiresAtMs <= Date.now()) {
          await this.revoke(id);
          return null;
        }
        return ticket;
      } catch {
        return null;
      }
    }
    const ticket = this.memory.get(id);
    if (!ticket) {
      return null;
    }
    if (ticket.expiresAtMs <= Date.now()) {
      this.memory.delete(id);
      return null;
    }
    return ticket;
  }

  async revoke(id: string): Promise<void> {
    if (this.useRedis() && this.client) {
      const raw = await this.client.get(this.key(id));
      await this.client.del(this.key(id));
      if (raw) {
        try {
          const ticket = JSON.parse(raw) as PlaybackMediaTicket;
          await this.client.srem(this.userKey(ticket.userId), id);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    this.memory.delete(id);
  }

  async revokeForUser(userId: string): Promise<number> {
    if (this.useRedis() && this.client) {
      const ids = await this.client.smembers(this.userKey(userId));
      if (ids.length === 0) {
        return 0;
      }
      const pipe = this.client.multi();
      for (const id of ids) {
        pipe.del(this.key(id));
      }
      pipe.del(this.userKey(userId));
      await pipe.exec();
      return ids.length;
    }
    let n = 0;
    for (const [id, ticket] of this.memory) {
      if (ticket.userId === userId) {
        this.memory.delete(id);
        n += 1;
      }
    }
    return n;
  }

  private purgeExpiredMemory(): void {
    const now = Date.now();
    for (const [id, ticket] of this.memory) {
      if (ticket.expiresAtMs <= now) {
        this.memory.delete(id);
      }
    }
  }
}
