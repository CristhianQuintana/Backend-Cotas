# Reporte de seguridad — cierre 2026-11-16

## Dependencias
- `npm audit --omit=dev` → **0** vulnerabilidades (override `deepmerge-ts@^8`).
- Tratamiento SEC-003 documentado en `tratamiento-deps-sec003.md`.

## Controles retesteados (local)
| Control | Resultado |
| --- | --- |
| Rate-limit Redis (SEC-004) | PASS — IT + clave Redis en API |
| Tickets fail-closed / TTL (SEC-001) | PASS — IT Redis |
| Allowlist SSRF unit (SEC-005/007) | PASS — unit |
| MFA staff (SEC-006) | PASS — e2e/unit histórico; sin staff staging |
| Device limit failsafe (SEC-002) | PASS — unit 100% |
| Secretos en repo | PASS — sin `.env` committed |

## Pendiente dinámico staging
SSRF HTTP redirects maliciosos, MFA admin en cuenta staff, fuzzing de tickets públicos tras despliegue.
