-- Perfil XUI, snapshot IPTV, tokens FCM y anuncios de catálogo (aditivo).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" VARCHAR(120);

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "push_token" VARCHAR(512);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "push_platform" VARCHAR(32);

CREATE INDEX IF NOT EXISTS "devices_push_token_idx" ON "devices"("push_token");

ALTER TABLE "iptv_accounts" ADD COLUMN IF NOT EXISTS "max_connections" INTEGER;
ALTER TABLE "iptv_accounts" ADD COLUMN IF NOT EXISTS "active_connections" INTEGER;
ALTER TABLE "iptv_accounts" ADD COLUMN IF NOT EXISTS "display_name_snapshot" VARCHAR(120);

CREATE TABLE IF NOT EXISTS "catalog_content_snapshots" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'XUI',
    "resource" VARCHAR(16) NOT NULL,
    "content_ids" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_content_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "catalog_content_snapshots_provider_resource_key"
  ON "catalog_content_snapshots"("provider", "resource");

CREATE TABLE IF NOT EXISTS "catalog_announcements" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "content_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "catalog_announcements_created_at_idx"
  ON "catalog_announcements"("created_at");

CREATE INDEX IF NOT EXISTS "catalog_announcements_kind_created_at_idx"
  ON "catalog_announcements"("kind", "created_at");
