import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { CLOCK, SystemClock } from './common/utils/clock';
import { PrismaService } from './infrastructure/database/prisma/prisma.service';
import { AuditController } from './modules/audit/presentation/http/audit.controller';
import { ListAuditUseCase } from './modules/audit/application/list-audit.use-case';
import { PrismaAuditRepository } from './modules/audit/infrastructure/prisma-audit.repository';
import { AUDIT_REPOSITORY } from './modules/audit/domain/audit-repository';
import { CatalogController } from './modules/catalog/presentation/http/catalog.controller';
import { CatalogUseCase } from './modules/catalog/application/catalog.use-case';
import { HealthController } from './modules/health/health.controller';
import { HealthService } from './modules/health/health.service';
import { XuiHttpClient } from './modules/integrations/xui/infrastructure/http/xui-http.client';
import { XUI_CLIENT } from './modules/integrations/xui/domain/models';
import { AccessTokenGuard } from './modules/identity/presentation/guards/access-token.guard';
import { RolesGuard } from './modules/identity/presentation/guards/roles.guard';
import { IdentityController } from './modules/identity/presentation/http/identity.controller';
import { SessionsController } from './modules/identity/presentation/http/sessions.controller';
import { AdminUsersController } from './modules/identity/presentation/http/admin-users.controller';
import { LoginUseCase } from './modules/identity/application/use-cases/login.use-case';
import { RefreshSessionUseCase } from './modules/identity/application/use-cases/refresh-session.use-case';
import { AdminUsersUseCase } from './modules/identity/application/use-cases/admin-users.use-case';
import {
  GetProfileUseCase,
  ListSessionsUseCase,
  LogoutUseCase,
  RevokeSessionUseCase,
} from './modules/identity/application/use-cases/session.use-cases';
import {
  BeginMfaEnrollmentUseCase,
  ConfirmMfaEnrollmentUseCase,
} from './modules/identity/application/use-cases/mfa.use-cases';
import { PrismaIdentityStore } from './modules/identity/infrastructure/persistence/prisma-identity.store';
import { Argon2PasswordHasher } from './modules/identity/infrastructure/password-hashing/argon2-password.hasher';
import { JoseTokenService } from './modules/identity/infrastructure/tokens/jose-token.service';
import {
  AesMfaSecretCipher,
  TotpMfaService,
} from './modules/identity/infrastructure/mfa/totp.service';
import {
  LINE_ACCESS,
  MFA_CIPHER,
  MFA_SERVICE,
  PASSWORD_HASHER,
  RECOVERY_CODE_REPOSITORY,
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
} from './modules/identity/domain/ports/identity.ports';
import { PlaybackController } from './modules/playback/presentation/http/playback.controller';
import { AuthorizePlaybackUseCase } from './modules/playback/application/authorize-playback.use-case';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: config.globalRateLimit }],
        errorMessage: 'Demasiadas solicitudes. Inténtelo más tarde.',
      }),
    }),
  ],
  controllers: [
    HealthController,
    IdentityController,
    SessionsController,
    AdminUsersController,
    CatalogController,
    PlaybackController,
    AuditController,
  ],
  providers: [
    PrismaService,
    PrismaIdentityStore,
    { provide: USER_REPOSITORY, useExisting: PrismaIdentityStore },
    { provide: SESSION_REPOSITORY, useExisting: PrismaIdentityStore },
    { provide: RECOVERY_CODE_REPOSITORY, useExisting: PrismaIdentityStore },
    { provide: LINE_ACCESS, useExisting: PrismaIdentityStore },
    PrismaAuditRepository,
    { provide: AUDIT_REPOSITORY, useExisting: PrismaAuditRepository },
    Argon2PasswordHasher,
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    JoseTokenService,
    { provide: TOKEN_SERVICE, useExisting: JoseTokenService },
    TotpMfaService,
    { provide: MFA_SERVICE, useExisting: TotpMfaService },
    AesMfaSecretCipher,
    { provide: MFA_CIPHER, useExisting: AesMfaSecretCipher },
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: XUI_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new XuiHttpClient({
          baseUrl: config.xuiBaseUrl,
          username: config.xuiUsername,
          password: config.xuiPassword,
          timeoutMs: config.xuiTimeoutMs,
          maxResponseBytes: config.xuiMaxResponseBytes,
          allowedStreamHosts: config.xuiAllowedStreamHosts,
        }),
    },
    LoginUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    GetProfileUseCase,
    ListSessionsUseCase,
    RevokeSessionUseCase,
    BeginMfaEnrollmentUseCase,
    ConfirmMfaEnrollmentUseCase,
    AdminUsersUseCase,
    CatalogUseCase,
    AuthorizePlaybackUseCase,
    ListAuditUseCase,
    HealthService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
