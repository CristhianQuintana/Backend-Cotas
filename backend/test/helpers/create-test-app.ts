import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/configure-http';
import { PrismaService } from '../../src/infrastructure/database/prisma/prisma.service';
import { AUDIT_REPOSITORY } from '../../src/modules/audit/domain/audit-repository';
import {
  LINE_ACCESS,
  RECOVERY_CODE_REPOSITORY,
  SESSION_REPOSITORY,
  USER_REPOSITORY,
} from '../../src/modules/identity/domain/ports/identity.ports';
import { XUI_CLIENT } from '../../src/modules/integrations/xui/domain/models';
import { FakeXui } from '../fakes/fake-xui';
import { InMemoryIdentity } from '../fakes/in-memory-identity';

export async function createTestApp(options?: { xui?: FakeXui; databaseUp?: boolean }) {
  const identity = new InMemoryIdentity();
  const xui = options?.xui ?? new FakeXui();
  const databaseUp = options?.databaseUp ?? true;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({
      async onModuleInit() {},
      async onModuleDestroy() {},
      async $connect() {},
      async $disconnect() {},
      async isDatabaseReachable() {
        return databaseUp;
      },
    })
    .overrideProvider(USER_REPOSITORY)
    .useValue(identity)
    .overrideProvider(SESSION_REPOSITORY)
    .useValue(identity)
    .overrideProvider(RECOVERY_CODE_REPOSITORY)
    .useValue(identity)
    .overrideProvider(LINE_ACCESS)
    .useValue(identity)
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(identity)
    .overrideProvider(XUI_CLIENT)
    .useValue(xui)
    .compile();

  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureHttp(app);
  await app.init();
  return { app: app as INestApplication, identity, xui };
}
