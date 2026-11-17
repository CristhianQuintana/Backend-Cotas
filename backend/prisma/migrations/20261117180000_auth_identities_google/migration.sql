-- Identidades externas (Google) y unicidad de email activo.
CREATE TABLE IF NOT EXISTS "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_subject" VARCHAR(128) NOT NULL,
    "provider_email" VARCHAR(254),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_provider_provider_subject_key"
  ON "auth_identities"("provider", "provider_subject");

CREATE INDEX IF NOT EXISTS "auth_identities_user_id_idx" ON "auth_identities"("user_id");
CREATE INDEX IF NOT EXISTS "auth_identities_provider_provider_email_idx"
  ON "auth_identities"("provider", "provider_email");

ALTER TABLE "auth_identities"
  ADD CONSTRAINT "auth_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");

-- Un correo activo no puede pertenecer a dos cuentas.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_active_unique"
  ON "users"("email")
  WHERE "email" IS NOT NULL AND "deleted_at" IS NULL;
