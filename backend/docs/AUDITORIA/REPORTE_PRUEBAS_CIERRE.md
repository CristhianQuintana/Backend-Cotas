# Reporte de pruebas — cierre 2026-11-16

## Unitarias
- **Resultado:** 34 suites / ~95 tests PASS (`npm test`)
- Incluye: tickets fail-closed/Redis mock, rate-limit Redis, device-limit, health ready, catalog push, SSRF allowlist, sync anuncios, login MFA (suite existente)

## E2E
- **Resultado:** 12/12 PASS (`npm run test:e2e`)

## Lint / build
- `npm run build` PASS
- `npm run lint` PASS
- `npm run openapi:export` → `openapi/openapi.json`

## Cobertura (`npm run test:cov`)
Ámbito: capa application/domain/infrastructure/common/config/health/notifications (excluye Prisma store, XUI HTTP client, controllers HTTP).

| Métrica | Valor |
| --- | --- |
| Statements | **63.44%** |
| Branches | **55.14%** |
| Functions | **65.67%** |
| Lines | **63.51%** |

Módulos críticos (muestra): device-limit 100%, catalog-diff 100%, health ~96%, login ~88%, catalog-push ~85%, tickets Redis path ~72%, rate-limit ~77%.

**Objetivo 80% global: NO cumplido** (bloqueante de cierre).

## Seguridad deps
- `npm audit --omit=dev` → **0 vulnerabilidades** (post override deepmerge-ts)

## Smoke producción (no destructivo)
- `GET https://api.cotasperu.com/api/v1/health/live` → 200
- `GET .../health/ready` → `database: up`

## No ejecutado en este ciclo (bloqueantes)
- Carga/estrés media post-fix en staging
- Multi-instancia tickets
- FCM en dispositivo real
- Chaos PG/Redis en staging
- Regresión funcional cuentas A/B contra build nuevo desplegado
