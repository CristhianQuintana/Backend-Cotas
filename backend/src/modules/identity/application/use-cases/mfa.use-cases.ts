import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../../common/logging/request-meta';
import {
  DomainError,
  ErrorCodes,
  PublicMessages,
} from '../../../../common/exceptions/domain-error';
import { AUDIT_REPOSITORY, type AuditRepository } from '../../../audit/domain/audit-repository';
import {
  MFA_CIPHER,
  MFA_SERVICE,
  RECOVERY_CODE_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
  type MfaSecretCipher,
  type MfaService,
  type RecoveryCodeRepository,
  type TokenService,
  type UserRepository,
} from '../../domain/ports/identity.ports';

@Injectable()
export class BeginMfaEnrollmentUseCase {
  constructor(
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MFA_SERVICE) private readonly mfa: MfaService,
    @Inject(MFA_CIPHER) private readonly cipher: MfaSecretCipher,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(enrollmentToken: string, meta: RequestMeta) {
    const { sub } = await this.tokens.verifyEnrollmentToken(enrollmentToken);
    const user = await this.users.findById(sub);
    if (!user || user.status !== 'ACTIVE' || (user.role !== 'OPERATOR' && user.role !== 'ADMIN')) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    if (user.mfaEnabled) {
      throw new DomainError(ErrorCodes.mfaAlreadyEnabled, 409, PublicMessages.mfaAlreadyEnabled);
    }
    const secret = this.mfa.generateSecret(user.username);
    await this.users.saveMfaSecret(user.id, this.cipher.encrypt(secret.base32));
    await this.audit.record({
      action: 'auth.mfa_setup',
      result: 'pending',
      actorUserId: user.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
    });
    return { secret: secret.base32, otpauthUrl: secret.otpauthUrl };
  }
}

@Injectable()
export class ConfirmMfaEnrollmentUseCase {
  constructor(
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MFA_SERVICE) private readonly mfa: MfaService,
    @Inject(MFA_CIPHER) private readonly cipher: MfaSecretCipher,
    @Inject(RECOVERY_CODE_REPOSITORY) private readonly recoveryCodes: RecoveryCodeRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(enrollmentToken: string, totpCode: string, meta: RequestMeta) {
    const { sub } = await this.tokens.verifyEnrollmentToken(enrollmentToken);
    const user = await this.users.findById(sub);
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      (user.role !== 'OPERATOR' && user.role !== 'ADMIN') ||
      !user.mfaSecretCiphertext
    ) {
      throw new DomainError(ErrorCodes.unauthorized, 401, PublicMessages.unauthorized);
    }
    if (user.mfaEnabled) {
      throw new DomainError(ErrorCodes.mfaAlreadyEnabled, 409, PublicMessages.mfaAlreadyEnabled);
    }
    const secret = this.cipher.decrypt(user.mfaSecretCiphertext);
    if (!this.mfa.verify(secret, totpCode)) {
      await this.audit.record({
        action: 'auth.mfa_confirm',
        result: 'failure',
        actorUserId: user.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      throw new DomainError(ErrorCodes.invalidCredentials, 401, PublicMessages.invalidCredentials);
    }
    const recoveryCodes = Array.from({ length: 8 }, () => createRecoveryCode());
    await this.recoveryCodes.replaceAndEnable(
      user.id,
      recoveryCodes.map((code) => this.tokens.hashToken(code)),
    );
    await this.audit.record({
      action: 'auth.mfa_confirm',
      result: 'success',
      actorUserId: user.id,
      correlationId: meta.correlationId,
      ipAddress: meta.ipAddress,
    });
    return { recoveryCodes };
  }
}

function createRecoveryCode(): string {
  const raw = randomBytes(5).toString('hex');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}
