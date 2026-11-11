import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { validateEnv } from '../../src/config/env.validation';
import { AesMfaSecretCipher } from '../../src/modules/identity/infrastructure/mfa/totp.service';
import { PrismaIdentityStore } from '../../src/modules/identity/infrastructure/persistence/prisma-identity.store';
import type { PrismaService } from '../../src/infrastructure/database/prisma/prisma.service';
import { CatalogAnnouncementsService } from '../../src/modules/catalog/application/catalog-announcements.service';

const enabled = process.env.RUN_DB_INTEGRATION === 'true';

(enabled ? describe : describe.skip)('PostgreSQL', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('responde a una consulta de disponibilidad', async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    expect(Number(rows[0]?.ok)).toBe(1);
  });

  it('rechaza un username duplicado entre cuentas activas', async () => {
    const username = `it-${randomUUID()}`;
    const first = await prisma.user.create({
      data: { id: randomUUID(), username, status: 'ACTIVE' },
    });
    await expect(
      prisma.user.create({
        data: { id: randomUUID(), username, status: 'ACTIVE' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.user.delete({ where: { id: first.id } });
  });

  it('revierte la transacción cuando el caso de uso falla', async () => {
    const username = `tx-${randomUUID()}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: { id: randomUUID(), username, status: 'ACTIVE' },
        });
        throw new Error('rollback-intencional');
      }),
    ).rejects.toThrow('rollback-intencional');
    expect(await prisma.user.findFirst({ where: { username } })).toBeNull();
  });

  it('guarda la contraseña de la línea cifrada y revoca las sesiones del dispositivo', async () => {
    const config = validateEnv(process.env);
    const store = new PrismaIdentityStore(
      prisma as unknown as PrismaService,
      new AesMfaSecretCipher(config),
    );
    const username = `line-${randomUUID()}`;
    const accepted = await store.acceptLine({
      username,
      password: 'not-stored-plain',
      now: new Date(),
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    const account = await prisma.iptvAccount.findFirst({ where: { userId: accepted.user.id } });
    expect(account?.passwordEncrypted).toBeTruthy();
    expect(account?.passwordEncrypted).not.toContain('not-stored-plain');

    const device = await prisma.device.create({
      data: {
        id: randomUUID(),
        userId: accepted.user.id,
        platform: 'WEB',
        deviceIdentifierHash: randomUUID().replaceAll('-', ''),
        status: 'ACTIVE',
      },
    });
    const session = await prisma.userSession.create({
      data: {
        id: randomUUID(),
        userId: accepted.user.id,
        deviceId: device.id,
        familyId: randomUUID(),
        refreshTokenHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(store.revokeDevice(device.id, accepted.user.id, new Date())).resolves.toBe(
      'revoked',
    );
    const fresh = await prisma.userSession.findUnique({ where: { id: session.id } });
    expect(fresh?.revokedAt).not.toBeNull();
    expect(fresh?.revokeReason).toBe('SECURITY');
    await prisma.user.delete({ where: { id: accepted.user.id } });
  });

  it('tiene aplicadas la migración inicial y el modelo de identidad', async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE migration_name IN ('20261019160000_init', '20261019220000_identity_model')
      ORDER BY migration_name
    `;
    expect(rows.map((row) => row.migration_name)).toEqual([
      '20261019160000_init',
      '20261019220000_identity_model',
    ]);
  });

  it('persiste y expone un anuncio de catálogo con cursor incremental', async () => {
    const id = randomUUID();
    const contentId = `it-${randomUUID()}`;
    let sequence = 0n;
    try {
      sequence = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "catalog_announcement_cursors" ("id", "value") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING`;
        const [cursor] = await tx.$queryRaw<
          Array<{ value: bigint }>
        >`SELECT "value" FROM "catalog_announcement_cursors" WHERE "id" = 1 FOR UPDATE`;
        const next = (cursor?.value ?? 0n) + 1n;
        await tx.catalogAnnouncementCursor.update({ where: { id: 1 }, data: { value: next } });
        await tx.catalogAnnouncement.create({
          data: {
            id,
            sequence: next,
            dedupeKey: `vod::${contentId}`,
            kind: 'vod',
            title: 'Integration movie',
            contentId,
            available: true,
          },
        });
        return next;
      });
      const service = new CatalogAnnouncementsService(prisma as unknown as PrismaService);
      const result = await service.list({
        limit: 10,
        since: Buffer.from((sequence - 1n).toString()).toString('base64url'),
      });
      expect(result.items).toContainEqual(
        expect.objectContaining({
          id,
          type: 'MOVIE',
          contentId,
          available: true,
        }),
      );
      expect(result.syncCursor).toBe(Buffer.from(sequence.toString()).toString('base64url'));
    } finally {
      await prisma.catalogAnnouncement.deleteMany({ where: { id } });
    }
  });
});
