import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';
import type { AccessTokenClaims, TokenService } from '../../domain/ports/identity.ports';

@Injectable()
export class JoseTokenService implements TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.jwtAccessSecret);
  }

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.sign(
      { sid: claims.sid, role: claims.role },
      claims.sub,
      this.config.jwtAudience,
      this.config.accessTokenTtlSeconds,
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.verify(token, this.config.jwtAudience);
    const sid = payload.sid;
    const role = payload.role;
    if (
      typeof payload.sub !== 'string' ||
      typeof sid !== 'string' ||
      (role !== 'CUSTOMER' && role !== 'OPERATOR' && role !== 'ADMIN')
    ) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    return { sub: payload.sub, sid, role };
  }

  signEnrollmentToken(userId: string): Promise<string> {
    return this.sign(
      { purpose: 'mfa-enroll' },
      userId,
      `${this.config.jwtAudience}:mfa-enroll`,
      this.config.enrollmentTokenTtlSeconds,
    );
  }

  async verifyEnrollmentToken(token: string): Promise<{ sub: string }> {
    const payload = await this.verify(token, `${this.config.jwtAudience}:mfa-enroll`);
    if (payload.purpose !== 'mfa-enroll' || typeof payload.sub !== 'string') {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    return { sub: payload.sub };
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async sign(
    claims: Record<string, string>,
    subject: string,
    audience: string,
    ttlSeconds: number,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setIssuer(this.config.jwtIssuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(this.key);
  }

  private async verify(token: string, audience: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience,
        clockTolerance: 5,
      });
      return payload;
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
  }
}
