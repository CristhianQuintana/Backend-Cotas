export const TV_QR_REPOSITORY = Symbol('TV_QR_REPOSITORY');

export type TvQrStatusCode = 'PENDING' | 'AUTHORIZED' | 'EXPIRED' | 'CANCELLED' | 'REJECTED';
export type TvQrPlatformCode = 'WEB' | 'ANDROID' | 'IOS' | 'TV' | 'OTHER';
export type TvQrClosedStatus = 'CANCELLED' | 'REJECTED';

export interface TvQrSessionRecord {
  id: string;
  codeHash: string;
  pollSecretHash: string;
  tvClientDeviceId: string;
  tvClientDeviceIdHash: string;
  platform: TvQrPlatformCode;
  deviceName: string | null;
  requestIpMasked: string | null;
  status: TvQrStatusCode;
  statusReason: string | null;
  failedAttempts: number;
  expiresAt: Date;
  authorizedAt: Date | null;
  deliveredAt: Date | null;
  closedAt: Date | null;
  userId: string | null;
  deviceId: string | null;
  createdAt: Date;
}

export interface CreateTvQrSessionInput {
  id: string;
  codeHash: string;
  pollSecretHash: string;
  tvClientDeviceId: string;
  tvClientDeviceIdHash: string;
  platform: TvQrPlatformCode;
  deviceName: string | null;
  requestIpMasked: string | null;
  expiresAt: Date;
  now: Date;
}

/**
 * Persistencia de sesiones QR. Todas las transiciones son atómicas (compare-and-set sobre el
 * estado) y devuelven `null` si otra petición ganó la carrera: así un código es de un solo uso
 * y las credenciales se entregan una sola vez aunque haya peticiones simultáneas.
 */
export interface TvQrRepository {
  create(input: CreateTvQrSessionInput): Promise<TvQrSessionRecord>;
  findById(id: string): Promise<TvQrSessionRecord | null>;
  /** Cierra como CANCELLED (`superseded`) las sesiones PENDING previas del mismo televisor. */
  cancelPendingByDevice(tvClientDeviceIdHash: string, now: Date): Promise<number>;
  /** PENDING vencida → EXPIRED. Devuelve el registro resultante. */
  markExpiredIfNeeded(id: string, now: Date): Promise<TvQrSessionRecord | null>;
  /** PENDING vigente → AUTHORIZED (una sola vez). */
  markAuthorized(input: {
    id: string;
    userId: string;
    deviceId: string;
    now: Date;
  }): Promise<TvQrSessionRecord | null>;
  /** PENDING → CANCELLED | REJECTED. */
  markClosed(input: {
    id: string;
    status: TvQrClosedStatus;
    reason: string;
    now: Date;
  }): Promise<TvQrSessionRecord | null>;
  /** Suma un intento fallido (solo PENDING) y devuelve el total. */
  registerFailedAttempt(id: string): Promise<number>;
  /** AUTHORIZED sin entregar → entregada (una sola vez). */
  markDelivered(id: string, now: Date): Promise<TvQrSessionRecord | null>;
}
