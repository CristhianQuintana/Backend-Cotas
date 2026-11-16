# Guía de despliegue y rollback — Backend COTAS

## Staging / servidor (compose)

1. Respaldo previo: `server-deploy.sh` ejecuta `pg_dump` antes del deploy.
2. Imagen: `ghcr.io/<owner>/backend-cotas:<sha40>`.
3. Variables: archivo de entorno del servidor (no versionar). Debe incluir `REDIS_PASSWORD` real.
4. Deploy: `IMAGE=... ENV_FILE=... COMPOSE_DIR=... ./scripts/server-deploy.sh deploy`
5. Smoke: `SMOKE_BASE_URL=https://staging... npm run smoke:deploy`
6. Validaciones:
   - `API_A=... API_B=... npm run validate:tickets-multi`
   - `SMOKE_BASE_URL=... npm run validate:load-playback`
   - `SMOKE_BASE_URL=... npm run validate:resilience`

## Multi-réplica local

```bash
BACKEND_PORT=3200 BACKEND_B_PORT=3201 docker compose --profile multi up -d --build
API_A=http://127.0.0.1:3200 API_B=http://127.0.0.1:3201 npm run validate:tickets-multi
```

## Rollback

```bash
IMAGE=ghcr.io/<owner>/backend-cotas:<sha_anterior> \
ENV_FILE=... COMPOSE_DIR=... ./scripts/server-deploy.sh rollback
```

Restaurar dump PostgreSQL desde `/opt/cotas/backups` si la migración no es compatible hacia atrás.

## Requisitos de red

El contenedor API debe alcanzar XUI/Astra (LAN). Si `XUI_BASE_URL` no es ruteable desde Docker, login/playback fallarán con `DEPENDENCY_UNAVAILABLE` aunque Redis/PG estén sanos.
