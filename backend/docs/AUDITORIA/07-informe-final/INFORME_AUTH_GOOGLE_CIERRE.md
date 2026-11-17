# Informe de cierre — Auth correo + Google Sign-In

**Fecha:** 2026-11-17  
**Alcance:** Backend principal + BD (sin proxy Xtream)

## Criterios de aceptación

| Criterio | Estado |
| --- | --- |
| Auditoría auth/BD | Cumplido — `AUTH_GOOGLE_AUDITORIA_DIFERENCIAS.md` |
| Login correo/contraseña | Cumplido — `POST /auth/login` (email) + `POST /auth/register` |
| Google Sign-In en backend | Cumplido — `POST /auth/google` + JWKS |
| Client IDs / audiencias documentados | Cumplido — `GOOGLE_CLOUD_SIGNIN.md` + `.env.example` |
| Reglas de alta/vinculación | Cumplido — link con password; `sub` estable |
| Sesiones COTAS para ambos métodos | Cumplido |
| Refresh / logout | Reutilizado |
| `auth_identities` + migración | Cumplido — `20261117180000_auth_identities_google` |
| Dispositivos | Reutilizado (`devices` / cupo existente) |
| Sin credenciales IPTV externas en BD | Cumplido (decisión) |
| OpenAPI / Postman / informe apps | Cumplido |
| Xtream en backend | Fuera de alcance (correcto) |

## Artefactos para plataformas

1. `docs/integraciones/INFORME_AUTH_GOOGLE_PLATAFORMAS.md`  
2. `docs/integraciones/GOOGLE_CLOUD_SIGNIN.md`  
3. `docs/integraciones/guia-plataformas-api-publica.md` (actualizada)  
4. `docs/integraciones/postman/cotas-auth-google.postman_collection.json`  
5. `docs/decisions/0002-auth-google-y-email.md`

## Pruebas

- Unitarias G-01…G-10 (subset) y B-01…B-03 en `google-login.use-case.spec.ts`.
- Regresión identidad: `login.use-case.spec.ts`.
- E2E: OpenAPI incluye `/auth/google` y `/auth/register`.

## Despliegue

1. Configurar `GOOGLE_OAUTH_CLIENT_IDS` y `GOOGLE_SIGNIN_ENABLED` en el `.env` del servidor (sin versionar).  
2. `prisma migrate deploy` (vía `RUN_MIGRATIONS=true`).  
3. Health `live`/`ready` + smoke login correo; Google con Client IDs reales de release.
