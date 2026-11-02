import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { newId } from '../../../common/utils/ids';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  type CatalogAnnouncementDraft,
  type CatalogAnnouncementKind,
  type CatalogContentItem,
  diffNewCatalogItems,
} from './catalog-announcement.diff';

@Injectable()
export class CatalogAnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async detectAndPersist(
    kind: CatalogAnnouncementKind,
    items: readonly CatalogContentItem[],
  ): Promise<CatalogAnnouncementDraft[]> {
    const resource = kind;
    const existing = await this.prisma.catalogContentSnapshot.findUnique({
      where: { provider_resource: { provider: 'XUI', resource } },
    });
    const previousIds = readIds(existing?.contentIds);
    const { nextIds, announcements: detected } = diffNewCatalogItems(kind, items, previousIds);
    // Primera sincronización: solo sembrar snapshot para no inundar push con todo el catálogo.
    const announcements = existing ? detected : [];

    await this.prisma.$transaction(async (tx) => {
      if (announcements.length > 0) {
        await tx.catalogAnnouncement.createMany({
          data: announcements.map((item) => ({
            id: newId(),
            kind: item.kind,
            title: item.title,
            contentId: item.contentId,
          })),
        });
      }
      await tx.catalogContentSnapshot.upsert({
        where: { provider_resource: { provider: 'XUI', resource } },
        create: {
          id: newId(),
          provider: 'XUI',
          resource,
          contentIds: nextIds,
        },
        update: {
          contentIds: nextIds,
        },
      });
    });

    return announcements;
  }

  async list(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [total, rows] = await Promise.all([
      this.prisma.catalogAnnouncement.count(),
      this.prisma.catalogAnnouncement.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return {
      page,
      limit,
      total,
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        contentId: row.contentId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async listActivePushTokens(): Promise<string[]> {
    const devices = await this.prisma.device.findMany({
      where: { status: 'ACTIVE', pushToken: { not: null } },
      select: { pushToken: true },
    });
    return [
      ...new Set(
        devices
          .map((device) => device.pushToken)
          .filter((token): token is string => typeof token === 'string' && token.length > 0),
      ),
    ];
  }
}

function readIds(value: Prisma.JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}
