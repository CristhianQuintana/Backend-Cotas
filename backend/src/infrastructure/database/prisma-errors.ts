import { Logger } from '@nestjs/common';
import { DomainError, ErrorCodes, PublicMessages } from '../../common/exceptions/domain-error';
import { errorName } from '../../common/logging/redact';

const logger = new Logger('Database');

export function rethrowAsDomain(error: unknown): never {
  const name = errorName(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  logger.error(`Error de base de datos ${name} ${code}`);
  if (
    name === 'PrismaClientInitializationError' ||
    name === 'PrismaClientRustPanicError' ||
    /^P100|^P101/u.test(code) ||
    code === 'P2024'
  ) {
    throw new DomainError(
      ErrorCodes.dependencyUnavailable,
      503,
      PublicMessages.databaseUnavailable,
    );
  }
  if (code === 'P2002') {
    throw new DomainError(ErrorCodes.conflict, 409, PublicMessages.conflict);
  }
  throw new DomainError(ErrorCodes.internal, 500, PublicMessages.internal);
}
