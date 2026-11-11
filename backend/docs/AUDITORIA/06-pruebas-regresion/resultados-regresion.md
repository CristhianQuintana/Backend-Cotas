# Resultados de regresión

- **Fecha:** 2026-11-11 (UTC-5)
- **Commit:** `8fa5549`
- **Estación:** Windows, Node 24.13.0
- **Nota:** Suite **existente** sin modificar código ni tests (mandato de auditoría).

---

## 1. Suites ejecutadas

| Momento | Suite | Comando | Resultado |
| --- | --- | --- | --- |
| Pre-carga (mañana) | Unitaria | `npm test -- --coverage=false` | **PASS** — 21 suites, 63 tests |
| Pre-carga | E2E | `npm run test:e2e -- --coverage=false` | **PASS** — 1 suite, 12 tests |
| Pre-carga | Cobertura | `npm run test:cov` | **PASS**; statements **72.48%** |
| **Post-carga / post-resiliencia** | Unitaria | `npm test -- --coverage=false` | **PASS** — 21/21, 63/63 (~11.2 s) |
| **Post-carga / post-resiliencia** | E2E | `npm run test:e2e -- --coverage=false` | **PASS** — 1/1, 12/12 (~6.2 s) |

Durante e2e aparece log esperado `DEPENDENCY_TIMEOUT` (no falla la suite).

---

## 2. Fallos preexistentes vs nuevos

| Tipo | Observación |
| --- | --- |
| Fallos de suite | Ninguno |
| Regresión introducida por auditoría | N/A — sin cambios de producto |
| Impacto de carga remota en suites locales | Ninguno observado |

---

## 3. Pruebas bloqueadas / no ejecutadas

| Ítem | Motivo |
| --- | --- |
| `test:integration` contra XUI real | No requerido tras e2e verde; XUI prod no forzado |
| Trivy/ZAP | Herramientas ausentes |

---

## 4. Evidencias (post-carga)

```text
Test Suites: 21 passed, 21 total
Tests:       63 passed, 63 total
(e2e) Test Suites: 1 passed / Tests: 12 passed
```

**Conclusión:** La batería automatizada permanece **verde** después de las campañas de rendimiento y resiliencia. Cobertura de referencia sigue ~72% (&lt;80%).
