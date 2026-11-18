import type {
  CreateTvQrSessionInput,
  TvQrClosedStatus,
  TvQrRepository,
  TvQrSessionRecord,
} from '../../src/modules/tv-auth/domain/tv-qr.ports';

/** Repositorio en memoria con las mismas transiciones atómicas (compare-and-set) que Prisma. */
export class InMemoryTvQr implements TvQrRepository {
  readonly rows = new Map<string, TvQrSessionRecord>();

  async create(input: CreateTvQrSessionInput): Promise<TvQrSessionRecord> {
    const row: TvQrSessionRecord = {
      id: input.id,
      codeHash: input.codeHash,
      pollSecretHash: input.pollSecretHash,
      tvClientDeviceId: input.tvClientDeviceId,
      tvClientDeviceIdHash: input.tvClientDeviceIdHash,
      platform: input.platform,
      deviceName: input.deviceName,
      requestIpMasked: input.requestIpMasked,
      status: 'PENDING',
      statusReason: null,
      failedAttempts: 0,
      expiresAt: input.expiresAt,
      authorizedAt: null,
      deliveredAt: null,
      closedAt: null,
      userId: null,
      deviceId: null,
      createdAt: input.now,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findById(id: string): Promise<TvQrSessionRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async cancelPendingByDevice(hash: string, now: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.tvClientDeviceIdHash === hash && row.status === 'PENDING') {
        row.status = 'CANCELLED';
        row.statusReason = 'superseded';
        row.closedAt = now;
        count += 1;
      }
    }
    return count;
  }

  async markExpiredIfNeeded(id: string, now: Date): Promise<TvQrSessionRecord | null> {
    const row = this.rows.get(id);
    if (row && row.status === 'PENDING' && row.expiresAt <= now) {
      row.status = 'EXPIRED';
      row.statusReason = 'expired';
      row.closedAt = now;
    }
    return row ? { ...row } : null;
  }

  async markAuthorized(input: {
    id: string;
    userId: string;
    deviceId: string;
    now: Date;
  }): Promise<TvQrSessionRecord | null> {
    const row = this.rows.get(input.id);
    if (!row || row.status !== 'PENDING' || row.expiresAt <= input.now) {
      return null;
    }
    row.status = 'AUTHORIZED';
    row.userId = input.userId;
    row.deviceId = input.deviceId;
    row.authorizedAt = input.now;
    return { ...row };
  }

  async markClosed(input: {
    id: string;
    status: TvQrClosedStatus;
    reason: string;
    now: Date;
  }): Promise<TvQrSessionRecord | null> {
    const row = this.rows.get(input.id);
    if (!row || row.status !== 'PENDING') {
      return null;
    }
    row.status = input.status;
    row.statusReason = input.reason;
    row.closedAt = input.now;
    return { ...row };
  }

  async registerFailedAttempt(id: string): Promise<number> {
    const row = this.rows.get(id);
    if (!row) {
      return 0;
    }
    if (row.status === 'PENDING') {
      row.failedAttempts += 1;
    }
    return row.failedAttempts;
  }

  async markDelivered(id: string, now: Date): Promise<TvQrSessionRecord | null> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'AUTHORIZED' || row.deliveredAt) {
      return null;
    }
    row.deliveredAt = now;
    return { ...row };
  }
}
