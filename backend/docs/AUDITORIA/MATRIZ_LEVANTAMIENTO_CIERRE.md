# Matriz de levantamiento — cierre backend COTAS

- **Fecha:** 2026-11-16
- **Rama:** `fix/cierre-backend-auditoria-final`
- **Base código:** trabajo sobre `113a538` + correcciones de esta rama

| ID | Prioridad | Estado final | Evidencia | Bloqueo externo |
| --- | --- | --- | --- | --- |
| PERF-001 | P0 | CORREGIDO EN CÓDIGO | Cola+retry+default 128; falta retest carga staging | Sí — staging/carga |
| PERF-003 | P0 | CORREGIDO EN CÓDIGO | Fail-closed Redis; provider compartido; unit Redis mock | Sí — multi-réplica staging |
| SEC-001 | P0 | CORREGIDO EN CÓDIGO | TTL default 300s; revoke logout; ticket opaco | Retest staging |
| SEC-002 | P1 | CERRADO (API) | Parser + failsafe; unit `device-limit.policy` 100% | No modificar cupos A/B |
| SEC-005/007 | P0 | CÓDIGO OK | Allowlist + tests ampliados | Retest staging |
| SEC-006 | P0 | CÓDIGO OK | MFA staff; e2e local PASS histórico | Staff staging |
| SEC-004 | P0 | CORREGIDO EN CÓDIGO | REDIS_CLIENT + fail-closed; unit guard | Redis staging multi-réplica |
| SEC-003 | P1 | TRATADO | override `deepmerge-ts@8`; audit prod 0 | — |
| RES-002 | P1 | CÓDIGO OK | ready timeout 2s; unit HealthService | Chaos PG staging |
| NOTIF/FCM | P0 | PARCIAL BACKEND | Push al sync vod/series | Flutter + dispositivo real |
| COV | P1 | NO CUMPLE 80% | Unit app layer ~63% stmt; críticos mayormente ≥80% | Más tests / integración |
| OpenAPI | P2 | ACTUALIZADO | `openapi/openapi.json` regenerado | — |

**Bloqueantes para APTO:** staging post-deploy (PERF/tickets/SSRF/MFA/RL), FCM E2E dispositivo, cobertura global ≥80%, capacidad multi-IP medida.
