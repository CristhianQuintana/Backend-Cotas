# Redis, BullMQ y worker de catálogo

Objetivo: reducir consultas repetidas a XUI y acelerar canales, películas, series y metadatos. La reproducción sigue yendo directa al servidor de medios.

## Servicios Compose

| Servicio | Rol |
| --- | --- |
| `postgres` | Datos propios (sin cambios de volumen) |
| `redis` | Caché y backend de colas BullMQ. Sin puerto publicado |
| `backend` | API NestJS (`APP_ROLE=api`) |
| `worker` | Misma imagen; sincroniza catálogo XUI → Redis (`APP_ROLE=worker`) |

No ejecute `docker compose down -v`. El volumen `cotas_pg` conserva PostgreSQL; `cotas_redis` es independiente.

## Variables

| Variable | Uso |
| --- | --- |
| `REDIS_ENABLED` | `true` en Compose. En pruebas unitarias suele ser `false` |
| `REDIS_URL` | En Compose: `redis://redis:6379/0` |
| `REDIS_PASSWORD` | Obligatorio en `production`. No versionar |
| `CATALOG_CACHE_TTL_SECONDS` | TTL listas/fichas (por defecto 300) |
| `CATALOG_EPG_CACHE_TTL_SECONDS` | TTL EPG corto (por defecto 120) |
| `CATALOG_SYNC_INTERVAL_MS` | Periodo del job BullMQ (por defecto 300000) |

Si Redis no responde, la API sigue: memoria de proceso + XUI. `GET /api/v1/health/dependencies` marca `redis: down` y estado `degraded`.

## Despliegue

1. Añada `REDIS_PASSWORD` (y opcionalmente los TTL) a `/opt/cotas/env/.env` en el servidor.
2. Publique la imagen como hasta ahora (`ci` → `publish` → `deploy`).
3. El script espera `postgres`, `redis`, `backend` y `worker` saludables.

## Reversión

1. Workflow `deploy` con acción `rollback` y el SHA anterior.
2. Si debe quitar Redis temporalmente: no borre volúmenes; puede dejar `REDIS_ENABLED=false` en el `.env` del API (el worker no arrancará sin Redis).
3. PostgreSQL no se toca.

## Comprobaciones

```text
docker compose ps
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping
docker compose logs --tail=50 worker
curl -sS http://127.0.0.1:3100/api/v1/health/live
```

Como operador autenticado, `GET /api/v1/health/dependencies` debe mostrar `redis: up` cuando Redis responde.

## Medición (antes / después)

| Métrica | Antes (sin Redis) | Después (caché caliente) |
| --- | --- | --- |
| Listas de catálogo | Cada navegación o cada 60 s en memoria de un solo proceso | Lectura Redis compartida entre API y workers; TTL configurable |
| Worker | No existía | Refresco periódico con reintentos BullMQ (3 intentos, backoff) |
| Fallo Redis | N/A | API degradada pero operativa vía XUI |

Una prueba manual típica: dos `GET` seguidos a `/api/v1/catalog/live/streams` con la misma línea; el segundo no debe volver a esperar ~7–10 s de XUI si la caché está caliente.
