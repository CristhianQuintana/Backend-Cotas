import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { newId } from '../src/common/utils/ids';
import { assertPasswordAllowed } from '../src/modules/identity/domain/policies/password.policy';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error(
      'Seed rechazado en production. Defina SEED_ALLOW_PRODUCTION=true solo si COTAS lo autoriza.',
    );
  }
  const prisma = new PrismaClient();
  try {
    const customer = await prisma.role.findUnique({ where: { code: 'CUSTOMER' } });
    if (!customer) {
      throw new Error('Faltan los roles. Ejecute npx prisma migrate deploy.');
    }

    const operatorUsername = process.env.SEED_OPERATOR_USERNAME?.trim();
    const operatorPassword = process.env.SEED_OPERATOR_PASSWORD;
    if (operatorUsername) {
      if (!operatorPassword) {
        throw new Error(
          'SEED_OPERATOR_PASSWORD es obligatorio cuando define SEED_OPERATOR_USERNAME.',
        );
      }
      await ensureLocalStaff(prisma, {
        username: operatorUsername,
        password: operatorPassword,
        roleCode: 'OPERATOR',
      });
    }

    const adminUsername = process.env.SEED_ADMIN_USERNAME?.trim();
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (adminUsername) {
      if (!adminPassword) {
        throw new Error('SEED_ADMIN_PASSWORD es obligatorio cuando define SEED_ADMIN_USERNAME.');
      }
      await ensureLocalStaff(prisma, {
        username: adminUsername,
        password: adminPassword,
        roleCode: 'ADMIN',
      });
    }

    console.log(
      'Seed listo. Clientes IPTV siguen creándose al iniciar sesión con una línea XUI válida.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureLocalStaff(
  prisma: PrismaClient,
  input: { username: string; password: string; roleCode: 'OPERATOR' | 'ADMIN' },
): Promise<void> {
  assertPasswordAllowed(input.password, input.username);
  const role = await prisma.role.findUnique({ where: { code: input.roleCode } });
  if (!role) {
    throw new Error(`Falta el rol ${input.roleCode}.`);
  }
  const memoryCost = Number(process.env.ARGON2_MEMORY_COST ?? '19456');
  const timeCost = Number(process.env.ARGON2_TIME_COST ?? '2');
  const parallelism = Number(process.env.ARGON2_PARALLELISM ?? '1');
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost,
    timeCost,
    parallelism,
  });
  const existing = await prisma.user.findFirst({
    where: { username: input.username, deletedAt: null },
  });
  const userId = existing?.id ?? newId();
  const now = new Date();
  if (!existing) {
    await prisma.user.create({
      data: {
        id: userId,
        username: input.username,
        passwordHash,
        passwordChangedAt: now,
        status: 'ACTIVE',
      },
    });
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        status: 'ACTIVE',
      },
    });
  }
  await prisma.userRoleLink.deleteMany({ where: { userId } });
  await prisma.userRoleLink.create({
    data: { userId, roleId: role.id },
  });
  console.log(`Usuario local ${input.roleCode} listo: ${input.username}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Seed fallido';
  console.error(message);
  process.exit(1);
});
