import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { CLOCK, SystemClock } from './common/utils/clock';
import { PrismaService } from './infrastructure/database/prisma/prisma.service';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuditController } from './modules/audit/presentation/http/audit.controller';
import { ListAuditUseCase } from './modules/audit/application/list-audit.use-case';
import { PrismaAuditRepository } from './modules/audit/infrastructure/prisma-audit.repository';
import { AUDIT_REPOSITORY } from './modules/audit/domain/audit-repository';
import { CatalogController } from './modules/catalog/presentation/http/catalog.controller';
import { CatalogUseCase } from './modules/catalog/application/catalog.use-case';
import { CatalogSyncService } from './modules/catalog/application/catalog-sync.service';
import { CatalogAnnouncementsService } from './modules/catalog/application/catalog-announcements.service';
import { CATALOG_CACHE } from './modules/catalog/domain/catalog-cache';
import {
  MemoryCatalogCache,
  RedisCatalogCache,
} from './modules/catalog/infrastructure/redis-catalog.cache';
import { CatalogPushNotifier } from './modules/notifications/catalog-push.notifier';
import { FcmPushService } from './modules/notifications/fcm-push.service';
import { HealthController } from './modules/health/health.controller';
import { HealthService } from './modules/health/health.service';
import { XuiHttpClient } from './modules/integrations/xui/infrastructure/http/xui-http.client';
import { RoutingXuiClient } from './modules/integrations/xui/infrastructure/http/routing-xui.client';
import { XUI_CLIENT } from './modules/integrations/xui/domain/models';
import { SensitiveRateLimitGuard } from './common/guards/sensitive-rate-limit.guard';
import { AccessTokenGuard } from './modules/identity/presentation/guards/access-token.guard';
import { RolesGuard } from './modules/identity/presentation/guards/roles.guard';
import { IdentityController } from './modules/identity/presentation/http/identity.controller';
import { SessionsController } from './modules/identity/presentation/http/sessions.controller';
import { AdminUsersController } from './modules/identity/presentation/http/admin-users.controller';
import { AccountController } from './modules/identity/presentation/http/account.controller';
import { AccountRemindersController } from './modules/identity/presentation/http/account-reminders.controller';
import { DevicesController } from './modules/identity/presentation/http/devices.controller';
import { DeviceLinkController } from './modules/identity/presentation/http/device-link.controller';
import { LoginUseCase } from './modules/identity/application/use-cases/login.use-case';
import { DeviceLinkUseCase } from './modules/identity/application/use-cases/device-link.use-case';
import { RefreshSessionUseCase } from './modules/identity/application/use-cases/refresh-session.use-case';
import { AdminUsersUseCase } from './modules/identity/application/use-cases/admin-users.use-case';
import { GetSubscriptionUseCase } from './modules/identity/application/use-cases/subscription.use-case';
import { RegisterPushTokenUseCase } from './modules/identity/application/use-cases/register-push-token.use-case';
import { AccountRemindersService } from './modules/identity/application/use-cases/account-reminders.service';
import { DevicePresenceNotifier } from './modules/identity/application/use-cases/device-presence-notifier';
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
  AUTH_IDENTITY_REPOSITORY,
  DEVICE_LINK_REPOSITORY,
  LINE_ACCESS,
  MFA_CIPHER,
  MFA_SERVICE,
  PASSWORD_HASHER,
  RECOVERY_CODE_REPOSITORY,
  SESSION_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
} from './modules/identity/domain/ports/identity.ports';
import { GoogleIdTokenVerifier } from './modules/identity/infrastructure/google/google-id-token.verifier';
import { GoogleLoginUseCase } from './modules/identity/application/use-cases/google-login.use-case';
import { RegisterEmailUseCase } from './modules/identity/application/use-cases/register-email.use-case';
import { PlaybackController } from './modules/playback/presentation/http/playback.controller';
import { AuthorizePlaybackUseCase } from './modules/playback/application/authorize-playback.use-case';
import { PlaybackMediaTicketStore } from './modules/playback/infrastructure/playback-media-ticket.store';
import { MediaController } from './modules/media/presentation/http/media.controller';
import { TvAuthController } from './modules/tv-auth/presentation/http/tv-auth.controller';
import { TvAuthUseCase } from './modules/tv-auth/application/tv-auth.use-case';
import { PrismaTvQrRepository } from './modules/tv-auth/infrastructure/prisma-tv-qr.repository';
import { TV_QR_REPOSITORY } from './modules/tv-auth/domain/tv-qr.ports';

@Module({
  imports: [
    AppConfigModule,
    RedisModule,
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
    AccountController,
    AccountRemindersController,
    DevicesController,
    DeviceLinkController,
    TvAuthController,
    AdminUsersController,
    CatalogController,
    PlaybackController,
    MediaController,
    AuditController,
  ],
  providers: [
    PrismaService,
    PrismaIdentityStore,
    { provide: USER_REPOSITORY, useExisting: PrismaIdentityStore },
    { provide: SESSION_REPOSITORY, useExisting: PrismaIdentityStore },
    { provide: RECOVERY_CODE_REPOSITORY, useExisting: PrismaIdentityStore },
    { provide: LINE_ACCESS, useExisting: PrismaIdentityStore },
    { provide: DEVICE_LINK_REPOSITORY, useExisting: PrismaIdentityStore },
    { provide: AUTH_IDENTITY_REPOSITORY, useExisting: PrismaIdentityStore },
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
      useFactory: (config: AppConfig) => {
        const primary = new XuiHttpClient({
          baseUrl: config.xuiBaseUrl,
          username: config.xuiUsername,
          password: config.xuiPassword,
          timeoutMs: config.xuiTimeoutMs,
          maxResponseBytes: config.xuiMaxResponseBytes,
          allowedStreamHosts: config.xuiAllowedStreamHosts,
        });
        if (!config.demoLoginEnabled || !config.demoXuiBaseUrl || !config.demoLoginUsername) {
          return primary;
        }
        const demo = new XuiHttpClient({
          baseUrl: config.demoXuiBaseUrl,
          // El XUI demo autentica con la línea del abonado; estas credenciales solo se usan
          // si alguna llamada interna omite credentials (no aplica al flujo demo).
          username: config.demoLoginUsername,
          password: config.demoLoginPassword ?? config.demoLoginUsername,
          timeoutMs: config.xuiTimeoutMs,
          maxResponseBytes: config.xuiMaxResponseBytes,
          allowedStreamHosts: config.demoXuiAllowedStreamHosts,
        });
        return new RoutingXuiClient(primary, demo, config.demoLoginUsername);
      },
    },
    LoginUseCase,
    GoogleIdTokenVerifier,
    GoogleLoginUseCase,
    RegisterEmailUseCase,
    DeviceLinkUseCase,
    PrismaTvQrRepository,
    { provide: TV_QR_REPOSITORY, useExisting: PrismaTvQrRepository },
    TvAuthUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    GetProfileUseCase,
    GetSubscriptionUseCase,
    AccountRemindersService,
    DevicePresenceNotifier,
    RegisterPushTokenUseCase,
    ListSessionsUseCase,
    RevokeSessionUseCase,
    BeginMfaEnrollmentUseCase,
    ConfirmMfaEnrollmentUseCase,
    AdminUsersUseCase,
    RedisCatalogCache,
    MemoryCatalogCache,
    {
      provide: CATALOG_CACHE,
      inject: [APP_CONFIG, RedisCatalogCache, MemoryCatalogCache],
      useFactory: (
        config: AppConfig,
        redisCache: RedisCatalogCache,
        memoryCache: MemoryCatalogCache,
      ) => (config.redisEnabled ? redisCache : memoryCache),
    },
    CatalogUseCase,
    CatalogAnnouncementsService,
    FcmPushService,
    CatalogPushNotifier,
    CatalogSyncService,
    PlaybackMediaTicketStore,
    AuthorizePlaybackUseCase,
    ListAuditUseCase,
    HealthService,
    // Debe estar en providers para que REDIS_CLIENT se inyecte (si no, rate-limit queda null).
    SensitiveRateLimitGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
