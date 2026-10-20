# Desarrollo local y arranque en contenedores

Requisito del host para las pruebas y el modo desarrollo: Node.js 24. El arranque de la API en el host usa la salida de `tsc`. El despliegue no necesita Node en el host: usa la imagen.

## Modo desarrollo, API en el host

1. Copie `.env.example` a `.env` y sustituya cada valor que contenga `CHANGE_ME`.
2. `docker compose up -d postgres` publica `127.0.0.1:5436`. Usuario `cotas`, base `cotas_dev`. La contraseña local por defecto es `local_only_dev_password` solo si no define `POSTGRES_PASSWORD`. El puerto del equipo es 5436 porque 5432 ya lo usa otro proyecto. Dentro del contenedor PostgreSQL sigue en 5432.
3. En `.env`, `DATABASE_URL` debe apuntar a `127.0.0.1:5436` y no debe contener `CHANGE_ME`.
4. `npm ci`
5. `npx prisma generate`
6. `npx prisma migrate deploy`
7. `npm run seed` comprueba que existan los roles. No crea clientes. `SEED_OPERATOR_USERNAME` es opcional.
8. `npm run start:dev`

No levante a la vez el servicio `backend` de Compose si la API del host ya usa `BACKEND_PORT` (3100 en este equipo, 3000 si no se define).

## Modo contenedor, el que se sube al servidor

Hace falta Docker y un `.env` completo. No hace falta Node en el host.

```text
docker compose up -d --build
```

Eso levanta `postgres` y `backend`. El backend espera a que PostgreSQL esté sano, aplica las migraciones y escucha en el puerto 3000 del contenedor. En el host queda publicado solo en `127.0.0.1`, puerto `BACKEND_PORT` o 3100.

Dentro del contenedor la base se llama `postgres`, no `localhost`. Compose reescribe `DATABASE_URL`. También fuerza `NODE_ENV=production`, `PORT=3000` y `SWAGGER_ENABLED=false`. El origen CORS del contenedor sale de `PUBLIC_CORS_ORIGINS` y tiene que ser `https`. Si no lo define, usa `https://localhost` para poder arrancar la prueba local.

Comprobaciones:

```text
docker compose ps
docker compose logs --tail=100 backend
```

`GET http://127.0.0.1:3100/api/v1/health/live` responde `{"status":"ok"}`. `GET /api/v1/health/ready` responde 200 cuando PostgreSQL acepta la consulta.

Para detener: `docker compose stop`. Para volver a arrancar: `docker compose start`. Los datos siguen en el volumen `cotas_pg`.

La imagen no incluye la página `/dev/player`. Esa página solo existe con `npm run start:dev`.

## Otras comprobaciones en el host

- `npm run check:env`
- `npm run lint`
- `npm run format:check`
- `npm test`
- `npm run test:e2e`
- `npm run build`
- `npm run scan:secrets`
- `npm run openapi:export`

La integración con PostgreSQL no forma parte de `npm test`. Con la migración aplicada:

```text
RUN_DB_INTEGRATION=true npm run test:integration
```

En PowerShell: `$env:RUN_DB_INTEGRATION='true'` y después el comando. Sin esa variable la suite se omite y el código de salida 0 no demuestra la base.

`npm run test:integration` usa `DATABASE_URL` del entorno. Apunte al puerto publicado `127.0.0.1:5436`, no al nombre `postgres`, porque el proceso de Node corre en el host.
