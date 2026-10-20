export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    readonly details?: readonly { field: string; rules: string[] }[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export const ErrorCodes = {
  validation: 'VALIDATION_ERROR',
  unauthorized: 'UNAUTHORIZED',
  invalidCredentials: 'INVALID_CREDENTIALS',
  forbidden: 'FORBIDDEN',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  rateLimited: 'RATE_LIMITED',
  unsupportedMedia: 'UNSUPPORTED_MEDIA_TYPE',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  dependencyUnavailable: 'DEPENDENCY_UNAVAILABLE',
  dependencyTimeout: 'DEPENDENCY_TIMEOUT',
  upstreamAuth: 'UPSTREAM_AUTHENTICATION_FAILED',
  upstreamInvalid: 'UPSTREAM_INVALID_RESPONSE',
  playbackRejected: 'PLAYBACK_REFERENCE_REJECTED',
  internal: 'INTERNAL_ERROR',
  mfaAlreadyEnabled: 'MFA_ALREADY_ENABLED',
} as const;

export const PublicMessages = {
  validation: 'La solicitud no es válida.',
  unauthorized: 'Autenticación requerida.',
  invalidCredentials: 'Credenciales inválidas.',
  forbidden: 'No tiene permiso para esta operación.',
  notFound: 'El recurso no existe.',
  sessionNotFound: 'La sesión no existe.',
  contentNotFound: 'El contenido no existe o no está disponible.',
  conflict: 'El recurso ya existe.',
  rateLimited: 'Demasiadas solicitudes. Inténtelo más tarde.',
  unsupportedMedia: 'El contenido debe ser application/json.',
  payloadTooLarge: 'El cuerpo de la solicitud excede el tamaño permitido.',
  invalidJson: 'El cuerpo de la solicitud no es JSON válido.',
  dependencyUnavailable: 'Una dependencia necesaria no está disponible.',
  dependencyTimeout: 'La fuente de contenido no respondió a tiempo.',
  upstreamAuth: 'No se pudo consultar la fuente de contenido.',
  upstreamInvalid: 'La fuente de contenido devolvió una respuesta no utilizable.',
  playbackRejected: 'No se pudo preparar una referencia de reproducción segura.',
  internal: 'No se pudo completar la operación.',
  mfaAlreadyEnabled: 'La verificación en dos pasos ya está activa.',
  databaseUnavailable: 'La base de datos no está disponible.',
} as const;
