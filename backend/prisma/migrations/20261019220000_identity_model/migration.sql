-- Reemplaza el esquema provisional (users.role, sessions, recovery_codes, audit_events).
-- Esas tablas solo tenían cuentas locales de prueba creadas por el desarrollo, no datos de clientes.
-- La migración 20261019160000_init no se edita: este cambio es incremental.

DROP TABLE IF EXISTS "recovery_codes";
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "audit_events";
DROP TABLE IF EXISTS "users";
DROP TYPE IF EXISTS "UserRole";
DROP TYPE IF EXISTS "UserStatus";
DROP TYPE IF EXISTS "SessionRevocationReason";

CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED');
CREATE TYPE "IptvAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'ERROR');
CREATE TYPE "MfaMethodType" AS ENUM ('TOTP');
CREATE TYPE "MfaMethodStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');
CREATE TYPE "DevicePlatform" AS ENUM ('WEB', 'ANDROID', 'IOS', 'TV', 'OTHER');
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "SessionRevocationReason" AS ENUM ('LOGOUT', 'ROTATED', 'REUSE', 'ADMIN', 'SECURITY');
CREATE TYPE "AuditResult" AS ENUM ('success', 'failure', 'pending');
CREATE TYPE "AuthChallengePurpose" AS ENUM ('MFA_RECOVERY');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "username" VARCHAR(64),
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "email_verified_at" TIMESTAMPTZ(3),
    "phone_verified_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_active_key" ON "users" ("username") WHERE "deleted_at" IS NULL AND "username" IS NOT NULL;
CREATE UNIQUE INDEX "users_email_active_key" ON "users" ("email") WHERE "deleted_at" IS NULL AND "email" IS NOT NULL;
CREATE UNIQUE INDEX "users_phone_active_key" ON "users" ("phone") WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL;
CREATE INDEX "users_status_idx" ON "users" ("status");
CREATE INDEX "users_deleted_at_idx" ON "users" ("deleted_at");

CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240),
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_code_key" ON "roles" ("code");

CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" VARCHAR(240),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permissions_code_key" ON "permissions" ("code");

CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

CREATE INDEX "user_roles_role_id_idx" ON "user_roles" ("role_id");

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions" ("permission_id");

CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "device_name" VARCHAR(80),
    "device_identifier_hash" VARCHAR(64) NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "devices_user_id_status_idx" ON "devices" ("user_id", "status");
CREATE UNIQUE INDEX "devices_user_hash_active_key" ON "devices" ("user_id", "device_identifier_hash") WHERE "status" = 'ACTIVE';

CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(64) NOT NULL,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(256),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" "SessionRevocationReason",
    "replaced_by_id" UUID,
    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions" ("refresh_token_hash");
CREATE INDEX "user_sessions_user_id_revoked_at_expires_at_idx" ON "user_sessions" ("user_id", "revoked_at", "expires_at");
CREATE INDEX "user_sessions_family_id_idx" ON "user_sessions" ("family_id");

CREATE TABLE "user_mfa_methods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "MfaMethodType" NOT NULL,
    "secret_encrypted" TEXT,
    "status" "MfaMethodStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "user_mfa_methods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_mfa_methods_user_id_status_idx" ON "user_mfa_methods" ("user_id", "status");
CREATE UNIQUE INDEX "user_mfa_methods_one_active_totp_key" ON "user_mfa_methods" ("user_id", "method") WHERE "status" = 'ACTIVE';

CREATE TABLE "iptv_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'XUI',
    "external_account_ref" VARCHAR(128),
    "username" VARCHAR(64),
    "password_encrypted" TEXT,
    "status" "IptvAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3),
    "last_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "iptv_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "iptv_accounts_user_id_status_idx" ON "iptv_accounts" ("user_id", "status");
CREATE UNIQUE INDEX "iptv_accounts_provider_ref_active_key" ON "iptv_accounts" ("provider", "external_account_ref") WHERE "status" = 'ACTIVE' AND "external_account_ref" IS NOT NULL;
CREATE UNIQUE INDEX "iptv_accounts_one_active_per_user_key" ON "iptv_accounts" ("user_id") WHERE "status" = 'ACTIVE';

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" VARCHAR(64),
    "result" "AuditResult" NOT NULL,
    "ip_address" VARCHAR(64),
    "correlation_id" VARCHAR(64),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs" ("actor_user_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs" ("action", "created_at");

CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "AuthChallengePurpose" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_challenges_token_hash_key" ON "auth_challenges" ("token_hash");
CREATE INDEX "auth_challenges_user_id_purpose_idx" ON "auth_challenges" ("user_id", "purpose");

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_mfa_methods" ADD CONSTRAINT "user_mfa_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "iptv_accounts" ADD CONSTRAINT "iptv_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "roles" ("id", "code", "name", "description", "is_system", "created_at", "updated_at") VALUES
    ('11111111-1111-4111-8111-111111111111', 'CUSTOMER', 'Cliente', 'Consulta el catálogo y autoriza reproducción de su línea.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('22222222-2222-4222-8222-222222222222', 'OPERATOR', 'Operador', 'Opera auditoría, usuarios y dispositivos. Requiere MFA.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('33333333-3333-4333-8333-333333333333', 'ADMIN', 'Administrador', 'Incluye los permisos de operador y la gestión de usuarios.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "permissions" ("id", "code", "description", "created_at", "updated_at") VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'catalog.read', 'Leer categorías y canales.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'playback.authorize', 'Autorizar una referencia de reproducción.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'audit.read', 'Consultar auditoría.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'users.read', 'Consultar usuarios de la aplicación.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'devices.manage', 'Revocar dispositivos y sus sesiones.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'users.manage', 'Administrar cuentas de la aplicación.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at") VALUES
    ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', CURRENT_TIMESTAMP),
    ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', CURRENT_TIMESTAMP),
    ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', CURRENT_TIMESTAMP),
    ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', CURRENT_TIMESTAMP),
    ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', CURRENT_TIMESTAMP),
    ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', CURRENT_TIMESTAMP),
    ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', CURRENT_TIMESTAMP),
    ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', CURRENT_TIMESTAMP),
    ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', CURRENT_TIMESTAMP),
    ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', CURRENT_TIMESTAMP),
    ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', CURRENT_TIMESTAMP),
    ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', CURRENT_TIMESTAMP),
    ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', CURRENT_TIMESTAMP);
