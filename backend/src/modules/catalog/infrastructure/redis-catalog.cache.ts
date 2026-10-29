import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { connectRedis, createRedisClient } from '../../../infrastructure/redis/redis.client';
import type { CatalogCache } from '../domain/catalog-cache';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
export class RedisCatalogCache implements CatalogCache, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCatalogCache.name);
  private readonly client: Redis | null;
  private ready = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(REDIS_CLIENT) injected?: Redis | null,
  ) {
    this.client = injected === undefined ? createRedisClient(config) : injected;
  }

  async onModuleInit(): Promise<void> {
    this.ready = await connectRedis(this.client);
    if (this.config.redisEnabled && !this.ready) {
      this.logger.warn(
        'Redis habilitado pero no alcanzable. El catálogo seguirá con memoria local y XUI.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  isEnabled(): boolean {
    return Boolean(this.client) && this.ready;
  }

  async ping(): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      if (!this.ready) {
        this.ready = await connectRedis(this.client);
      }
      if (!this.ready) {
        return false;
      }
      return (await this.client.ping()) === 'PONG';
    } catch {
      this.ready = false;
      return false;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.isEnabled() || !this.client) {
      return null;
    }
    try {
      const raw = await this.client.get(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(
        `Lectura de caché fallida: ${error instanceof Error ? error.message : 'error'}`,
      );
      this.ready = false;
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.isEnabled() || !this.client) {
      return;
    }
    try {
      const ttl = Math.max(1, Math.min(ttlSeconds, 86_400));
      await this.client.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logger.warn(
        `Escritura de caché fallida: ${error instanceof Error ? error.message : 'error'}`,
      );
      this.ready = false;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isEnabled() || !this.client) {
      return;
    }
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(
        `Borrado de caché fallido: ${error instanceof Error ? error.message : 'error'}`,
      );
      this.ready = false;
    }
  }
}

@Injectable()
export class MemoryCatalogCache implements CatalogCache {
  private readonly store = new Map<string, { expiresAt: number; value: string }>();

  isEnabled(): boolean {
    return true;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const found = this.store.get(key);
    if (!found) {
      return null;
    }
    if (Date.now() > found.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return JSON.parse(found.value) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
      value: JSON.stringify(value),
    });
    if (this.store.size > 80) {
      const oldest = [...this.store.entries()].sort(
        (left, right) => left[1].expiresAt - right[1].expiresAt,
      )[0];
      if (oldest) {
        this.store.delete(oldest[0]);
      }
    }
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}
