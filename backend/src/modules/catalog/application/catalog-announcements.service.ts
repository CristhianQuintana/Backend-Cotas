import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { newId } from '../../../common/utils/ids';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  type CatalogAnnouncementDraft,
  type CatalogAnnouncementKind,
  type CatalogContentItem,
  catalogDedupeKey,
  diffNewCatalogItems,
} from './catalog-announcement.diff';

export interface CatalogAnnouncementSnapshot {
  movies: readonly CatalogContentItem[];
  series: readonly CatalogContentItem[];
  episodes: readonly CatalogContentItem[];
}

@Injectable()
export class CatalogAnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Persists all resource snapshots and their announcements in one transaction. */
  async detectAndPersist(snapshot: CatalogAnnouncementSnapshot): Promise<number> {
    const kinds: readonly [CatalogAnnouncementKind, readonly CatalogContentItem[]][] = [
      ['vod', snapshot.movies],
      ['series', snapshot.series],
      ['episode', snapshot.episodes],
    ];
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "catalog_announcement_cursors" ("id", "value") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING`;
      const [cursor] = await tx.$queryRaw<
        { value: bigint }[]
      >`SELECT "value" FROM "catalog_announcement_cursors" WHERE "id" = 1 FOR UPDATE`;
      let sequence = cursor?.value ?? 0n;
      const all: CatalogAnnouncementDraft[] = [];
      const snapshots: {
        kind: CatalogAnnouncementKind;
        resource: string;
        ids: string[];
        keys: string[];
      }[] = [];
      for (const [kind, items] of kinds) {
        const resource = kind === 'vod' ? 'vod' : kind;
        const existing = await tx.catalogContentSnapshot.findUnique({
          where: { provider_resource: { provider: 'XUI', resource } },
        });
        const diff = diffNewCatalogItems(kind, items, readIds(existing?.contentIds));
        snapshots.push({
          kind,
          resource,
          ids: diff.nextIds,
          keys: items.map((item) => catalogDedupeKey(kind, item)),
        });
        // The first complete inventory seeds the baseline without announcing the whole catalog.
        if (existing) all.push(...diff.announcements);
      }

      if (all.length > 0) {
        await tx.catalogAnnouncement.createMany({
          data: all.map((item) => ({
            id: newId(),
            sequence: ++sequence,
            dedupeKey: item.dedupeKey,
            kind: item.kind,
            title: item.title,
            contentId: item.contentId,
            seriesId: item.seriesId ?? null,
            seasonNumber: item.seasonNumber ?? null,
            episodeNumber: item.episodeNumber ?? null,
            description: item.description ?? null,
            posterUrl: item.posterUrl ?? null,
            publishedAt: item.publishedAt ?? null,
            available: true,
          })),
          skipDuplicates: true,
        });
        // Advance by the number of attempted announcements; gaps are safe and cursor is monotonic.
        await tx.$executeRaw`UPDATE "catalog_announcement_cursors" SET "value" = ${sequence} WHERE "id" = 1`;
      }

      for (const { kind, resource, ids, keys } of snapshots) {
        await tx.catalogContentSnapshot.upsert({
          where: { provider_resource: { provider: 'XUI', resource } },
          create: { id: newId(), provider: 'XUI', resource, contentIds: ids },
          update: { contentIds: ids },
        });
        await tx.catalogAnnouncement.updateMany({
          where: { kind, available: true, ...(keys.length ? { dedupeKey: { notIn: keys } } : {}) },
          data: { available: false },
        });
        if (keys.length) {
          await tx.catalogAnnouncement.updateMany({
            where: { kind, dedupeKey: { in: keys }, available: false },
            data: { available: true },
          });
        }
      }
      return all.length;
    });
  }

  async list(options: {
    limit: number;
    type?: string;
    since?: string;
    cursor?: string;
    page?: number;
  }) {
    const since = decodeCursor(options.since) ?? 0n;
    const pageCursor = options.cursor ? decodePageCursor(options.cursor) : undefined;
    const [head] = await this.prisma.$queryRaw<
      { value: bigint }[]
    >`SELECT "value" FROM "catalog_announcement_cursors" WHERE "id" = 1`;
    const snapshot = pageCursor?.snapshot ?? head?.value ?? 0n;
    const sequence = pageCursor
      ? { gt: since, lt: pageCursor.last, lte: snapshot }
      : { gt: since, lte: snapshot };
    const where = {
      available: true,
      sequence,
      ...(options.type
        ? { kind: options.type === 'MOVIE' ? 'vod' : options.type.toLowerCase() }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.catalogAnnouncement.findMany({
        where,
        orderBy: { sequence: 'desc' },
        ...(options.page && !options.since && !options.cursor
          ? { skip: (options.page - 1) * options.limit }
          : {}),
        take: options.limit + 1,
      }),
      this.prisma.catalogAnnouncement.count({ where }),
    ]);
    const hasMore = rows.length > options.limit;
    const items = rows.slice(0, options.limit);
    const nextCursor =
      hasMore && items.length > 0
        ? encodePageCursor(items[items.length - 1]!.sequence, snapshot)
        : null;
    return {
      items: items.map((row) => ({
        id: row.id,
        type: row.kind === 'vod' ? 'MOVIE' : row.kind.toUpperCase(),
        kind: row.kind,
        contentId: row.contentId,
        title: row.title,
        posterUrl: row.posterUrl,
        description: row.description,
        detectedAt: row.createdAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        publishedAt: row.publishedAt?.toISOString() ?? null,
        seriesId: row.seriesId,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        available: row.available,
        detailPath:
          row.kind === 'vod'
            ? `/api/v1/catalog/vod/streams/${row.contentId}`
            : row.kind === 'series'
              ? `/api/v1/catalog/series/${row.contentId}`
              : `/api/v1/catalog/series/${row.seriesId}`,
      })),
      page: options.page ?? 1,
      limit: options.limit,
      total,
      hasMore,
      nextCursor,
      syncCursor: encodeCursor(snapshot),
    };
  }
}

function readIds(value: Prisma.JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function encodeCursor(value: bigint): string {
  return Buffer.from(value.toString()).toString('base64url');
}

function decodeCursor(value?: string): bigint | undefined {
  if (!value) return undefined;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (!/^\d{1,30}$/u.test(decoded)) throw new Error('invalid');
    return BigInt(decoded);
  } catch {
    throw new BadRequestException('El cursor since no es válido.');
  }
}

function encodePageCursor(last: bigint, snapshot: bigint): string {
  return Buffer.from(`${last}:${snapshot}`).toString('base64url');
}

function decodePageCursor(value: string): { last: bigint; snapshot: bigint } | undefined {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const match = /^(\d{1,30}):(\d{1,30})$/u.exec(decoded);
    if (!match) throw new Error('invalid');
    return { last: BigInt(match[1]!), snapshot: BigInt(match[2]!) };
  } catch {
    throw new BadRequestException('El cursor de paginación no es válido.');
  }
}
