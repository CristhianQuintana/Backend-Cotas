import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/exceptions/domain-error';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { rethrowAsDomain } from '../../../infrastructure/database/prisma-errors';
import type {
  CreateTvQrSessionInput,
  TvQrClosedStatus,
  TvQrRepository,
  TvQrSessionRecord,
} from '../domain/tv-qr.ports';

type Row = Awaited<ReturnType<PrismaService['tvQrSession']['findUniqueOrThrow']>>;

@Injectable()
export class PrismaTvQrRepository implements TvQrRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateTvQrSessionInput): Promise<TvQrSessionRecord> {
    try {
      const row = await this.prisma.tvQrSession.create({
        data: {
          id: input.id,
          codeHash: input.codeHash,
          pollSecretHash: input.pollSecretHash,
          tvClientDeviceId: input.tvClientDeviceId.slice(0, 128),
          tvClientDeviceIdHash: input.tvClientDeviceIdHash,
          platform: input.platform,
          deviceName: input.deviceName,
          requestIpMasked: input.requestIpMasked,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        },
      });
      return toRecord(row);
    } catch (error) {
      bubble(error);
    }
  }

  async findById(id: string): Promise<TvQrSessionRecord | null> {
    try {
      const row = await this.prisma.tvQrSession.findUnique({ where: { id } });
      return row ? toRecord(row) : null;
    } catch (error) {
      bubble(error);
    }
  }

  async cancelPendingByDevice(tvClientDeviceIdHash: string, now: Date): Promise<number> {
    try {
      const result = await this.prisma.tvQrSession.updateMany({
        where: { tvClientDeviceIdHash, status: 'PENDING' },
        data: { status: 'CANCELLED', statusReason: 'superseded', closedAt: now },
      });
      return result.count;
    } catch (error) {
      bubble(error);
    }
  }

  async markExpiredIfNeeded(id: string, now: Date): Promise<TvQrSessionRecord | null> {
    try {
      await this.prisma.tvQrSession.updateMany({
        where: { id, status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'EXPIRED', statusReason: 'expired', closedAt: now },
      });
      return await this.findById(id);
    } catch (error) {
      bubble(error);
    }
  }

  async markAuthorized(input: {
    id: string;
    userId: string;
    deviceId: string;
    now: Date;
  }): Promise<TvQrSessionRecord | null> {
    try {
      const result = await this.prisma.tvQrSession.updateMany({
        where: { id: input.id, status: 'PENDING', expiresAt: { gt: input.now } },
        data: {
          status: 'AUTHORIZED',
          userId: input.userId,
          deviceId: input.deviceId,
          authorizedAt: input.now,
        },
      });
      return result.count === 1 ? await this.findById(input.id) : null;
    } catch (error) {
      bubble(error);
    }
  }

  async markClosed(input: {
    id: string;
    status: TvQrClosedStatus;
    reason: string;
    now: Date;
  }): Promise<TvQrSessionRecord | null> {
    try {
      const result = await this.prisma.tvQrSession.updateMany({
        where: { id: input.id, status: 'PENDING' },
        data: { status: input.status, statusReason: input.reason, closedAt: input.now },
      });
      return result.count === 1 ? await this.findById(input.id) : null;
    } catch (error) {
      bubble(error);
    }
  }

  async registerFailedAttempt(id: string): Promise<number> {
    try {
      await this.prisma.tvQrSession.updateMany({
        where: { id, status: 'PENDING' },
        data: { failedAttempts: { increment: 1 } },
      });
      const row = await this.prisma.tvQrSession.findUnique({
        where: { id },
        select: { failedAttempts: true },
      });
      return row?.failedAttempts ?? 0;
    } catch (error) {
      bubble(error);
    }
  }

  async markDelivered(id: string, now: Date): Promise<TvQrSessionRecord | null> {
    try {
      const result = await this.prisma.tvQrSession.updateMany({
        where: { id, status: 'AUTHORIZED', deliveredAt: null },
        data: { deliveredAt: now },
      });
      return result.count === 1 ? await this.findById(id) : null;
    } catch (error) {
      bubble(error);
    }
  }
}

function toRecord(row: Row): TvQrSessionRecord {
  return {
    id: row.id,
    codeHash: row.codeHash,
    pollSecretHash: row.pollSecretHash,
    tvClientDeviceId: row.tvClientDeviceId,
    tvClientDeviceIdHash: row.tvClientDeviceIdHash,
    platform: row.platform,
    deviceName: row.deviceName,
    requestIpMasked: row.requestIpMasked,
    status: row.status,
    statusReason: row.statusReason,
    failedAttempts: row.failedAttempts,
    expiresAt: row.expiresAt,
    authorizedAt: row.authorizedAt,
    deliveredAt: row.deliveredAt,
    closedAt: row.closedAt,
    userId: row.userId,
    deviceId: row.deviceId,
    createdAt: row.createdAt,
  };
}

function bubble(error: unknown): never {
  if (error instanceof DomainError) {
    throw error;
  }
  rethrowAsDomain(error);
}
