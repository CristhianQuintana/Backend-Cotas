# Reporte de pruebas — cierre 2026-11-16 (actualizado)

## Local — unitarias
- **105** tests / **36** suites PASS (`npm test`)

## Local — E2E
- **12/12** PASS (`npm run test:e2e`)

## Local — integración real
| Suite | Resultado |
| --- | --- |
| PostgreSQL `persistence.integration-spec` | **6/6 PASS** (`RUN_DB_INTEGRATION=true`) |
| Redis tickets + rate-limit `redis-tickets.integration-spec` | **2/2 PASS** (`RUN_REDIS_INTEGRATION=true`, Redis Docker) |

## Local — resiliencia Docker
`SMOKE_BASE_URL=http://127.0.0.1:3200 node scripts/validate-resilience.mjs` → **ok: true**
- ready con PG down: **503** en **8 ms**
- recuperación ready: **200**
- ready con Redis down: **200** (ready solo exige PG; correcto)

## Local — Redis rate-limit en API viva
Tras POST `/auth/login` (falla XUI): clave Redis
`ratelimit:sensitive:…:POST:/api/v1/auth/login` presente → inyección `REDIS_CLIENT` operativa.

## Cobertura unitaria (`npm run test:cov`)
| Métrica | Valor |
| --- | --- |
| Statements | **68.59%** |
| Branches | **59.30%** |
| Functions | **71.35%** |
| Lines | **68.82%** |

Objetivo 80%: **no cumplido**.

## Seguridad deps
`npm audit --omit=dev` → **0 vulnerabilidades**

## No ejecutado (bloqueado por red/recursos)
- Smoke/regresión A/B y carga HLS: **XUI `10.10.0.100` timeout** desde host y contenedor
- FCM recepción Android real
- Staging remoto dedicado distinto de producción

## Scripts listos
- `npm run validate:tickets-multi`
- `npm run validate:load-playback`
- `npm run validate:resilience`
- `npm run smoke:deploy`
