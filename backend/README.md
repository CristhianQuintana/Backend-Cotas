# Backend COTAS

API de identidad, catálogo y autorización de reproducción para la plataforma IPTV de COTAS PERU S.A.C. El vídeo lo entrega XUI. Esta API no lo retransmite.

El ingreso es la línea IPTV de XUI. La decisión vigente está en `docs/decisions/0001-identidad-y-sesion.md`.

## Requisitos

- Docker Engine y Docker Compose, para el arranque que se sube al servidor
- Node.js 24 solo si va a desarrollar o ejecutar las pruebas en el host
- Credenciales de la línea XUI solo en el entorno del servidor

## Puesta en marcha

El camino de despliegue es:

```text
copy .env.example .env
docker compose up -d --build
```

Siga `docs/local-development.md` y, para el servidor, `docs/operacion/despliegue-y-reversion.md`. Sustituya los secretos de `.env`. Defina `POSTGRES_PASSWORD` antes del primer arranque en un servidor nuevo y `PUBLIC_CORS_ORIGINS` con un origen `https`.

La API del contenedor escucha en el puerto 3000 interno. En este equipo se publica en `127.0.0.1:3100` salvo que cambie `BACKEND_PORT`. PostgreSQL se publica solo en `127.0.0.1:5436`.

Para desarrollar con recarga, levante únicamente la base y arranque Node en el host:

```text
docker compose up -d postgres
npm run start:dev
```

## Comandos

| Comando | Uso |
| --- | --- |
| `docker compose up -d --build` | Construye y levanta backend y PostgreSQL |
| `docker compose stop` / `docker compose start` | Detiene o reanuda sin borrar el volumen |
| `npm run start:dev` | Compila con `tsc` y reinicia `dist/main.js` al cambiar |
| `npm run build` y `npm run start:prod` | Compila con `tsc` y ejecuta `dist/main.js` en el host |
| `npm test` | Pruebas unitarias |
| `npm run test:e2e` | Pruebas HTTP con dobles |
| `npm run test:integration` | PostgreSQL, si `RUN_DB_INTEGRATION=true` |
| `npm run lint` / `npm run format:check` | ESLint y Prettier |
| `npm run openapi:export` | Escribe `openapi/openapi.json` |
| `npm run scan:secrets` | Busca secretos evidentes en el árbol |
| `node scripts/smoke-deploy.mjs` | Prueba de humo contra la API ya levantada, sin imprimir referencias |

## Cómo probar la API

1. `GET /api/v1/health/live` responde `{ "status": "ok" }` sin autenticación.
2. `GET /api/v1/health/ready` responde 200 si PostgreSQL acepta `SELECT 1` y 503 si no. No llama a XUI.
3. `POST /api/v1/auth/login` con `{ "username", "password" }` de la línea XUI. Un espectador recibe `accessToken` y `refreshToken`. Un operador sin TOTP recibe `enrollmentToken`.
4. Envíe ese token en `Authorization: Bearer ...`.
5. `GET /api/v1/catalog/live/categories`, `GET /api/v1/catalog/vod/streams` y `GET /api/v1/catalog/series` leen XUI con la línea de quien inició sesión.
6. `POST /api/v1/playback/authorizations` con `{ "contentType": "live", "streamId": "175" }` devuelve la referencia directa. No la registre: contiene material de acceso de la línea. Película usa `vod`. Episodio usa `series` y exige `seriesId`.
7. `POST /api/v1/auth/refresh` rota el refresh token. Reutilizar el anterior revoca la familia completa.
8. `POST /api/v1/auth/logout` responde 204 e invalida el access token.
9. `GET /api/v1/audit/events` y `GET /api/v1/health/dependencies` exigen rol `OPERATOR`.

La UI de OpenAPI, en desarrollo en el host, está en `/api/docs`. El archivo versionado es `openapi/openapi.json`. La prueba visual de canales, películas y series está en `/dev/player` y no se publica en el contenedor de producción.

## Problemas frecuentes

- `Configuración inválida: CAMPO`: el valor falta, incluye `CHANGE_ME` o está fuera de rango. En el contenedor, un origen CORS `http` también falla porque el proceso va en `production`.
- Ready en 503: PostgreSQL no está accesible o la migración no terminó.
- Catálogo en 502: la línea XUI no autentica. No es un catálogo vacío legítimo.
- Login siempre 401: la línea fue rechazada o la cuenta local está deshabilitada. El mensaje es el mismo.
- El contenedor no arranca y el puerto 3100 está ocupado: hay una API de host en ese puerto. Deténgala o cambie `BACKEND_PORT`.
- Las pruebas fallan al cargar `@nestjs/common`: ejecute los scripts npm. Jest necesita `--experimental-vm-modules`, ya incluido en `npm test` y `npm run test:e2e`.

## Límites

Compose no termina TLS. Antes de exponer la API fuera de la red de pruebas, publíquela detrás del Nginx de `deploy/nginx/api.conf.example`. El límite de intentos de login es por proceso. La referencia de reproducción incluye la credencial de la línea; el tratamiento está en `docs/integraciones/autorizacion-reproduccion.md`.
