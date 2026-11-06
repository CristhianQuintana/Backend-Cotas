-- Presencia: evita reenviar push "dispositivo inactivo" en cada chequeo.
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "inactive_notified_at" TIMESTAMPTZ(3);
