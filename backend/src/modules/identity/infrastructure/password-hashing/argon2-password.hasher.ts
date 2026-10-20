import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';
import type { PasswordHasher } from '../../domain/ports/identity.ports';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  private dummy: Promise<string> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.argon2MemoryCost,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism,
    });
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  dummyHash(): Promise<string> {
    this.dummy ??= this.hash(randomBytes(32).toString('base64url'));
    return this.dummy;
  }
}
