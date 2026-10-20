import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';
import type { MfaSecretCipher, MfaService } from '../../domain/ports/identity.ports';

@Injectable()
export class TotpMfaService implements MfaService {
  generateSecret(username: string): { base32: string; otpauthUrl: string } {
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({
      issuer: 'COTAS',
      label: username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    return { base32: secret.base32, otpauthUrl: totp.toString() };
  }

  verify(base32: string, code: string): boolean {
    try {
      const totp = new TOTP({
        issuer: 'COTAS',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(base32),
      });
      return totp.validate({ token: code, window: 1 }) !== null;
    } catch {
      return false;
    }
  }
}

@Injectable()
export class AesMfaSecretCipher implements MfaSecretCipher {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = createHash('sha256').update(config.mfaEncryptionKey).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
  }

  decrypt(payload: string): string {
    try {
      const data = Buffer.from(payload, 'base64url');
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const encrypted = data.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      throw new DomainError(ErrorCodes.internal, 500, PublicMessages.internal);
    }
  }
}
