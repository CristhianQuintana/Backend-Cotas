# Matriz final de levantamiento — cierre backend COTAS

- **Fecha:** 2026-11-16
- **Rama:** `fix/cierre-backend-auditoria-final`
- **Entornos:** local Docker (PG+Redis+2×API), unit/e2e; XUI LAN no ruteable desde este host

| ID | Prioridad | Estado final | Evidencia | Bloqueo externo restante |
| --- | --- | --- | --- | --- |
| PERF-001 | P0 | CORREGIDO EN CÓDIGO | Cola/retry/agents/default 128; scripts `load-playback-proxy.mjs` | Carga HLS con XUI alcanzable |
| PERF-003 | P0 | CERRADO (Redis real) | IT `redis-tickets`: issue/get/revoke cross-store PASS | Retest HTTP multi-réplica con XUI |
| SEC-001 | P0 | CERRADO EN CÓDIGO+IT | TTL 300s; revoke logout; Redis fail-closed | Retest HTTP logout+ticket |
| SEC-002 | P1 | CERRADO | Failsafe + tests 100% | — |
| SEC-004 | P0 | CERRADO (Redis real) | IT rate-limit A/B; clave Redis tras login | — |
| SEC-005/007 | P0 | CÓDIGO+UNIT | Allowlist tests | Retest staging HTTP |
| SEC-006 | P0 | CÓDIGO+E2E | MFA staff suites | Staff staging |
| SEC-003 | P1 | CERRADO | override deepmerge-ts; audit omit=dev 0 | — |
| RES-002 | P0 | CERRADO (local) | `validate-resilience.mjs` PG down→ready 503 en 8ms, recover | — |
| NOTIF/FCM | P0 | BACKEND LISTO | Push+invalidación tokens; sin dispositivo | Flutter + Android + FCM creds |
| COV | P1 | NO CUMPLE | ~68.6% stmt / ~59% branches ámbito unit | Más tests |
| OpenAPI | P2 | ACTUALIZADO | `openapi/openapi.json` | — |

**Bloqueantes reales para APTO:** (1) XUI/Astra alcanzable para smoke/carga/regresión A/B, (2) FCM E2E en dispositivo, (3) cobertura ≥80%, (4) staging dedicado post-deploy del commit.
