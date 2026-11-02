-- Recordatorios EPG ligados a la cuenta (usuario JWT), no al dispositivo.

CREATE TYPE "AccountReminderState" AS ENUM ('scheduled', 'cancelled', 'unverifiable');

CREATE TABLE IF NOT EXISTS "account_reminders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel_id" VARCHAR(64) NOT NULL,
    "channel_name" VARCHAR(160) NOT NULL,
    "program_title" VARCHAR(240) NOT NULL,
    "epg_program_id" VARCHAR(64),
    "program_key" VARCHAR(240) NOT NULL,
    "lead_minutes" INTEGER NOT NULL,
    "state" "AccountReminderState" NOT NULL DEFAULT 'scheduled',
    "start_at" TIMESTAMPTZ(3),
    "end_at" TIMESTAMPTZ(3),
    "notify_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_reminders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_reminders_lead_minutes_check"
      CHECK ("lead_minutes" IN (5, 10, 15, 30, 60)),
    CONSTRAINT "account_reminders_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "account_reminders_user_id_state_idx"
  ON "account_reminders"("user_id", "state");

CREATE INDEX IF NOT EXISTS "account_reminders_user_id_notify_at_idx"
  ON "account_reminders"("user_id", "notify_at");

-- Un solo reminder scheduled por cuenta/canal/programa/inicio.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_account_reminder_active"
  ON "account_reminders" ("user_id", "channel_id", "program_key", "start_at")
  WHERE "state" = 'scheduled';
