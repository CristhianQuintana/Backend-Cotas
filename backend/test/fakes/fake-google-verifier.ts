import { DomainError, ErrorCodes, PublicMessages } from '../../src/common/exceptions/domain-error';
import type { VerifiedGoogleIdentity } from '../../src/modules/identity/infrastructure/google/google-id-token.verifier';

/**
 * Verificador de ID tokens de Google para pruebas. Formato del token: `fake|<sub>|<email>|<nombre>`.
 * Cualquier otro valor se rechaza igual que un token real inválido.
 */
export class FakeGoogleVerifier {
  async verify(idToken: string): Promise<VerifiedGoogleIdentity> {
    const [prefix, subject, email, name] = idToken.split('|');
    if (prefix !== 'fake' || !subject || !email) {
      throw new DomainError(ErrorCodes.googleTokenInvalid, 401, PublicMessages.googleTokenInvalid);
    }
    return {
      subject,
      email,
      emailVerified: true,
      name: name ?? null,
      audience: 'test-tv-client.apps.googleusercontent.com',
    };
  }
}

export function fakeIdToken(subject: string, email: string, name = 'Usuario Demo'): string {
  return `fake|${subject}|${email}|${name}`;
}
