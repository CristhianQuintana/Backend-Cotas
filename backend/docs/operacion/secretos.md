# Secretos y variables

Ningún valor real se pide por chat ni se guarda en Git. `.env` del servidor vive en `/opt/cotas/env/.env`, modo `600`, dueño `cotas-runner`.

## Dónde va cada dato

| Dato | Dónde | Para qué |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Solo `/opt/cotas/env/.env` | Contraseña nueva de PostgreSQL. No vale `local_only_dev_password` |
| `REDIS_PASSWORD` | Mismo archivo | Obligatoria en production con Redis. No versionar ni reutilizar marcadores `CHANGE_ME` |
| `POSTGRES_USER`, `POSTGRES_DB` | Mismo archivo | Deben coincidir con el volumen ya creado. Por defecto `cotas` y `cotas_dev` |
| `DATABASE_URL` | Mismo archivo, apuntando a `127.0.0.1` solo si la API corre en el host | Dentro de Compose el entrypoint reescribe `localhost` hacia el servicio `postgres` |
| `JWT_ACCESS_SECRET`, `MFA_ENCRYPTION_KEY` | Mismo archivo, distintas, 32 caracteres o más, sin `CHANGE_ME` | Firma y cifrado |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Mismo archivo | Emisor y audiencia |
| `XUI_BASE_URL`, `XUI_USERNAME`, `XUI_PASSWORD`, `XUI_ALLOWED_STREAM_HOSTS` | Mismo archivo | Panel y línea de sonda. La URL incluye el esquema y el puerto que responda desde el servidor |
| `XUI_ALLOW_INSECURE_HTTP` | `true` solo si el panel interno es HTTP | No sirve para exponer la API a Internet |
| `PUBLIC_CORS_ORIGINS` | Origen `https` autorizado | Compose lo copia a `CORS_ORIGINS`. Un origen `http` impide arrancar en producción |
| `BACKEND_PORT` | Por defecto `3100`, solo en `127.0.0.1` | Publicación local de la API |
| `GITHUB_TOKEN` | Lo emite GitHub en el workflow | Publica y descarga la imagen. No se crea un token personal |
| Token de registro del runner | Pantalla de GitHub, un solo uso | No es un secreto del archivo `.env` |

`npm run check:env`, ejecutado en el servidor con ese archivo y sin imprimir valores, confirma los nombres. El script de despliegue rechaza el archivo si todavía contiene `CHANGE_ME` o la contraseña local de desarrollo.

## GHCR

La publicación usa `packages: write` sobre `GITHUB_TOKEN`. La descarga del runner usa `packages: read` y `docker/login-action` contra `ghcr.io`. No hace falta un usuario robot.

En el paquete publicado, el acceso de lectura debe limitarse a este repositorio. Si la organización exige un ajuste de visibilidad, déjelo privado y vinculado al repositorio. No marque el paquete como público.

La imagen que debe desplegarse lleva el SHA completo. No despliegue por una etiqueta móvil.

## Lo que el CI sí tiene

El workflow de pruebas y la comprobación de la imagen usan PostgreSQL efímero y la contraseña local de desarrollo. Esos valores no son los del servidor. Las pruebas no leen credenciales de XUI ni el `.env` real.
