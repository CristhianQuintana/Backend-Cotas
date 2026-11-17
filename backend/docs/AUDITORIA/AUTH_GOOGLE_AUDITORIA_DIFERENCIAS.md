# Auditoría de autenticación y diferencias — Google / correo COTAS

**Fecha:** 2026-11-17  
**Rama base:** `fix/cierre-backend-auditoria-final`

## Estado actual (reutilizable)

| Componente | Estado | Acción |
| --- | --- | --- |
| `POST /auth/login` | Username + password; staff local (Argon2) o línea XUI | Ampliar: email local; **conservar** XUI |
| `POST /auth/refresh` / `logout` / `GET /auth/me` | Operativos con JWT COTAS | Reutilizar |
| `users.email`, `password_hash` | Existen; email no único | Índice único parcial |
| `devices` / `user_sessions` | Completos | Reutilizar |
| Identidades externas | **No existen** | Crear `auth_identities` |
| Google Sign-In | **No existe** | `POST /auth/google` (+ link) |
| Credenciales IPTV externas | No en BD principal | Sin cambio (local en apps) |
| Proxy catálogo/streaming | Existe hoy para apps legacy | **No usar** en nuevas apps; no eliminar aún |

## Decisiones de diseño

1. Tokens de sesión = solo JWT/refresh COTAS (nunca Google ID token).
2. `sub` de Google = identidad estable; email solo auxiliar.
3. Vinculación email existente + Google: **no automática**; exige `POST /auth/google/link` con contraseña.
4. Correo Google no verificado: rechazo.
5. Login XUI por username se mantiene para compatibilidad / “login normal” vía backend legacy.
6. Xtream Codes: **fuera de backend** (cliente → proveedor).
