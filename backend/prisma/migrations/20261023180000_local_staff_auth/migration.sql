-- Autenticación local del personal (ADMIN / OPERATOR) y metadato de cambio de contraseña.
-- Compatible con usuarios IPTV existentes: password_hash permanece NULL en clientes XUI.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMPTZ(3);
