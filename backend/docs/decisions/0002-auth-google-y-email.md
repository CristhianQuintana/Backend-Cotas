# 0002. Autenticación correo COTAS y Google Sign-In

Estado: vigente desde 2026-11-17.

## Decisión

- La cuenta COTAS puede autenticarse con **correo + contraseña** (Argon2id) o con **Google ID token** verificado en el backend.
- Ambos métodos emiten únicamente tokens de sesión COTAS (access JWT + refresh opaco rotativo).
- La identidad Google estable es `sub` (`auth_identities.provider_subject`). El correo no es clave primaria del proveedor.
- Si el correo Google coincide con una cuenta local existente, **no** se vincula automáticamente: se exige `POST /auth/google/link` con la contraseña de la cuenta.
- Correo Google no verificado → rechazo (`GOOGLE_EMAIL_UNVERIFIED`).
- El login por username de línea XUI se mantiene sin cambios para compatibilidad (“login normal”).
- Credenciales Xtream / IPTV de terceros **no** se almacenan en la BD principal; viven en el cliente.

## Consecuencias

- Variables `GOOGLE_SIGNIN_ENABLED` y `GOOGLE_OAUTH_CLIENT_IDS` obligatorias cuando el flujo Google está activo.
- Apps deben implementar GIS nativo y enviar solo el ID token a `/auth/google`.
- Documentación: `docs/integraciones/INFORME_AUTH_GOOGLE_PLATAFORMAS.md`, `GOOGLE_CLOUD_SIGNIN.md`.
