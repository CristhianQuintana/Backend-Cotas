-- Cupo de dispositivos: un identificador estable por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS "devices_user_id_device_identifier_hash_key"
ON "devices"("user_id", "device_identifier_hash");
