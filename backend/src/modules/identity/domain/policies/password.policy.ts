import { DomainError, ErrorCodes } from '../../../../common/exceptions/domain-error';

const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  '123456789012',
  'qwerty123456',
  'admin1234567',
  'cotasperu123',
  'changeme1234',
]);

export function assertPasswordAllowed(password: string, username: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new DomainError(
      ErrorCodes.validation,
      400,
      'La contraseña debe tener entre 12 y 128 caracteres.',
    );
  }
  if (
    COMMON_PASSWORDS.has(password.toLowerCase()) ||
    password.toLowerCase().includes(username.toLowerCase())
  ) {
    throw new DomainError(
      ErrorCodes.validation,
      400,
      'La contraseña no cumple la política de seguridad.',
    );
  }
}
