import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/configure-http';
import { PrismaService } from '../../src/infrastructure/database/prisma/prisma.service';
import { AUDIT_REPOSITORY } from '../../src/modules/audit/domain/audit-repository';
import {
  AUTH_IDENTITY_REPOSITORY,
  DEVICE_LINK_REPOSITORY,
  LINE_ACCESS,
  RECOVERY_CODE_REPOSITORY,
  SESSION_REPOSITORY,
  USER_REPOSITORY,
} from '../../src/modules/identity/domain/ports/identity.ports';
import { CatalogAnnouncementsService } from '../../src/modules/catalog/application/catalog-announcements.service';
import { AccountRemindersService } from '../../src/modules/identity/application/use-cases/account-reminders.service';
import { XUI_CLIENT } from '../../src/modules/integrations/xui/domain/models';
import { FakeXui } from '../fakes/fake-xui';
import { InMemoryAccountRemindersService } from '../fakes/in-memory-account-reminders';
import { InMemoryIdentity } from '../fakes/in-memory-identity';
import { InMemoryTvQr } from '../fakes/in-memory-tv-qr';
import { FakeGoogleVerifier } from '../fakes/fake-google-verifier';
import { GoogleIdTokenVerifier } from '../../src/modules/identity/infrastructure/google/google-id-token.verifier';
import { TV_QR_REPOSITORY } from '../../src/modules/tv-auth/domain/tv-qr.ports';

export async function createTestApp(options?: { xui?: FakeXui; databaseUp?: boolean }) {
  const identity = new InMemoryIdentity();
  const tvQr = new InMemoryTvQr();
  const googleVerifier = new FakeGoogleVerifier();
  const xui = options?.xui ?? new FakeXui();
  const reminders = new InMemoryAccountRemindersService();
  const databaseUp = options?.databaseUp ?? true;
  const announcements = {
    async list({ page = 1, limit }: { page?: number; limit: number }) {
      return {
        page,
        limit,
        total: 0,
        items: [],
        hasMore: false,
        nextCursor: null,
        syncCursor: 'MA',
      };
    },
    async detectAndPersist() {
      return { count: 0, created: [] };
    },
  };
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
    .overrideProvider(AUTH_IDENTITY_REPOSITORY)
    .useValue(identity)
    .overrideProvider(DEVICE_LINK_REPOSITORY)
    .useValue(identity)
    .overrideProvider(TV_QR_REPOSITORY)
    .useValue(tvQr)
    .overrideProvider(GoogleIdTokenVerifier)
    .useValue(googleVerifier)
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(identity)
    .overrideProvider(XUI_CLIENT)
    .useValue(xui)
    .overrideProvider(CatalogAnnouncementsService)
    .useValue(announcements)
    .overrideProvider(AccountRemindersService)
    .useValue(reminders)
    .compile();

  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureHttp(app);
  await app.init();
  return { app: app as INestApplication, identity, xui, reminders, tvQr };
}
