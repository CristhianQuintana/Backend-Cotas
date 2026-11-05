-- Login TV por QR: desafíos de enlace de un solo uso.
CREATE TYPE "DeviceLinkStatus" AS ENUM ('PENDING', 'APPROVED', 'EXPIRED', 'DENIED', 'CONSUMED');

CREATE TABLE "device_link_challenges" (
    "id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "tv_client_device_id" VARCHAR(128) NOT NULL,
    "tv_client_device_id_hash" VARCHAR(64) NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "device_name" VARCHAR(80),
    "status" "DeviceLinkStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "consumed_at" TIMESTAMPTZ(3),
    "approver_user_id" UUID,
    "device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_link_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_link_challenges_code_hash_key" ON "device_link_challenges"("code_hash");
CREATE INDEX "device_link_challenges_status_expires_at_idx" ON "device_link_challenges"("status", "expires_at");
CREATE INDEX "device_link_challenges_tv_client_device_id_hash_status_idx" ON "device_link_challenges"("tv_client_device_id_hash", "status");

ALTER TABLE "device_link_challenges"
  ADD CONSTRAINT "device_link_challenges_approver_user_id_fkey"
  FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
