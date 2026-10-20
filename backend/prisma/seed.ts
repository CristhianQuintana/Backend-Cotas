import { PrismaClient } from '@prisma/client';
import { newId } from '../src/common/utils/ids';

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
    if (operatorUsername) {
      await ensureOperator(prisma, operatorUsername);
    }
    console.log('Las cuentas de cliente se crean al iniciar sesión con una línea XUI válida.');
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureOperator(prisma: PrismaClient, username: string): Promise<void> {
  const operator = await prisma.role.findUnique({ where: { code: 'OPERATOR' } });
  if (!operator) {
    throw new Error('Falta el rol OPERATOR.');
  }
  const existing = await prisma.user.findFirst({ where: { username, deletedAt: null } });
  const userId = existing?.id ?? newId();
  if (!existing) {
    await prisma.user.create({
      data: { id: userId, username, status: 'ACTIVE' },
    });
  }
  await prisma.userRoleLink.upsert({
    where: { userId_roleId: { userId, roleId: operator.id } },
    update: {},
    create: { userId, roleId: operator.id },
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Seed fallido';
  console.error(message);
  process.exit(1);
});
