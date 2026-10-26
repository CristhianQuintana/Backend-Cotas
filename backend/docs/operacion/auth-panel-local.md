# Autenticación local del panel administrativo

Desde la migración `20261023180000_local_staff_auth`, el personal (`ADMIN` / `OPERATOR`) inicia sesión con usuario y contraseña almacenados en PostgreSQL (Argon2id). **No** usa XUI.

Los clientes IPTV (`CUSTOMER`) siguen autenticándose con la línea XUI.

## Login

`POST /api/v1/auth/login` con `{ "username", "password" }`.

1. Si el usuario tiene `password_hash` → verificación local y sesión (`type: "authenticated"`).
2. Si es `ADMIN`/`OPERATOR` sin hash → rechazo genérico (hay que seed/reset).
3. En caso contrario → flujo XUI de cliente.

En esta fase el panel administrativo **no** exige MFA/TOTP: basta usuario y contraseña local. Los endpoints `/auth/mfa/*` pueden permanecer, pero el login del personal no los usa.

## Gestión de usuarios (solo `ADMIN`)

| Método | Ruta |
| --- | --- |
| `GET` | `/api/v1/admin/users` |
| `GET` | `/api/v1/admin/users/:id` |
| `POST` | `/api/v1/admin/users` |
| `PATCH` | `/api/v1/admin/users/:id` |
| `POST` | `/api/v1/admin/users/:id/password` |

Las respuestas públicas nunca incluyen `passwordHash` ni secretos MFA.

## Seed del personal local

En el servidor (o local), con migraciones aplicadas. El seed **crea** usuarios; si el nombre ya existe, no modifica hash ni roles.

```text
SEED_ALLOW_PRODUCTION=true
SEED_ADMIN_USERNAME=operador
SEED_ADMIN_PASSWORD=<contraseña de 12+ caracteres>
# Opcional: OPERATOR adicional
# SEED_OPERATOR_USERNAME=...
# SEED_OPERATOR_PASSWORD=...
npm run seed
```

En el servidor de pruebas también puede usarse el workflow `bootstrap-admin` (entorno `pruebas`, secreto `BOOTSTRAP_ADMIN_PASSWORD`). No versionar esas contraseñas. La política exige mínimo 12 caracteres; no se aceptan valores cortos como `0p3r4d0r`. Tras el seed, el login debe devolver tokens de acceso.

## Despliegue

1. Copia de seguridad de PostgreSQL.
2. Publicar imagen / `docker compose up -d --no-build`.
3. Migraciones: el entrypoint ejecuta `prisma migrate deploy` si `RUN_MIGRATIONS` ≠ `false`.
4. Ejecutar seed una vez (o `bootstrap-admin`) con las variables anteriores.
5. Comprobar `GET /api/v1/health/live` y login local con `type: "authenticated"`.
