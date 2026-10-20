import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { rethrowAsDomain } from '../../../infrastructure/database/prisma-errors';
import type { AuditEventView } from '../domain/audit-draft';
import type { AuditDraft } from '../domain/audit-draft';
import type { AuditRepository } from '../domain/audit-repository';
import { auditCreateData } from './audit-record';

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(draft: AuditDraft): Promise<void> {
    try {
      const data = auditCreateData(draft);
      await this.prisma.auditLog.create({
        data: {
          id: data.id,
          action: data.action,
          result: data.result,
          actorUserId: data.actorUserId,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          correlationId: data.correlationId,
          ipAddress: data.ipAddress,
          createdAt: data.createdAt,
          metadata:
            data.metadata === undefined ? undefined : (data.metadata as Prisma.InputJsonValue),
        },
      });
    } catch (error) {
      rethrowAsDomain(error);
    }
  }

  async list(page: number, limit: number): Promise<{ total: number; items: AuditEventView[] }> {
    try {
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.auditLog.count(),
        this.prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            createdAt: true,
            action: true,
            result: true,
            actorUserId: true,
            correlationId: true,
          },
        }),
      ]);
      return {
        total,
        items: rows.map((row) => ({
          id: row.id,
          occurredAt: row.createdAt,
          action: row.action,
          result: row.result,
          actorUserId: row.actorUserId,
          correlationId: row.correlationId,
        })),
      };
    } catch (error) {
      rethrowAsDomain(error);
    }
  }
}
