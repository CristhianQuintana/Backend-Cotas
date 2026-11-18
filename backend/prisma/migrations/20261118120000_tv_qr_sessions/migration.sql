-- Login TV por QR (modulo tv-auth). Aditiva: no altera tablas existentes.
DO $$ BEGIN
  CREATE TYPE "TvQrStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'EXPIRED', 'CANCELLED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "tv_qr_sessions" (
    "id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "poll_secret_hash" VARCHAR(64) NOT NULL,
    "tv_client_device_id" VARCHAR(128) NOT NULL,
    "tv_client_device_id_hash" VARCHAR(64) NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "device_name" VARCHAR(80),
    "request_ip_masked" VARCHAR(64),
    "status" "TvQrStatus" NOT NULL DEFAULT 'PENDING',
    "status_reason" VARCHAR(32),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "authorized_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "user_id" UUID,
    "device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tv_qr_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tv_qr_sessions_code_hash_key" ON "tv_qr_sessions"("code_hash");
CREATE INDEX IF NOT EXISTS "tv_qr_sessions_status_expires_at_idx" ON "tv_qr_sessions"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "tv_qr_sessions_tv_client_device_id_hash_status_idx"
  ON "tv_qr_sessions"("tv_client_device_id_hash", "status");