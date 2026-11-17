import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config';

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  audience: string;
}

@Injectable()
export class GoogleIdTokenVerifier {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async verify(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (!this.config.googleSignInEnabled || this.config.googleOAuthClientIds.length === 0) {
      throw new DomainError(
        ErrorCodes.dependencyUnavailable,
        503,
        PublicMessages.dependencyUnavailable,
      );
    }
    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(idToken, googleJwks, {
        audience: this.config.googleOAuthClientIds,
        clockTolerance: 30,
      });
      payload = verified.payload;
    } catch {
      throw new DomainError(
        ErrorCodes.googleTokenInvalid,
        401,
        PublicMessages.googleTokenInvalid,
      );
    }
    const issuer = typeof payload.iss === 'string' ? payload.iss : '';
    if (!GOOGLE_ISSUERS.has(issuer)) {
      throw new DomainError(
        ErrorCodes.googleTokenInvalid,
        401,
        PublicMessages.googleTokenInvalid,
      );
    }
    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    const audience = Array.isArray(payload.aud)
      ? String(payload.aud[0] ?? '')
      : String(payload.aud ?? '');
    if (!subject || !email) {
      throw new DomainError(
        ErrorCodes.googleTokenInvalid,
        401,
        PublicMessages.googleTokenInvalid,
      );
    }
    if (!this.config.googleOAuthClientIds.includes(audience)) {
      throw new DomainError(
        ErrorCodes.googleTokenInvalid,
        401,
        PublicMessages.googleTokenInvalid,
      );
    }
    if (!emailVerified) {
      throw new DomainError(
        ErrorCodes.googleEmailUnverified,
        401,
        PublicMessages.googleEmailUnverified,
      );
    }
    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 120) : null;
    return { subject, email, emailVerified, name, audience };
  }
}
