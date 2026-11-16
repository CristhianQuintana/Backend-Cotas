# Resultados de regresión

- **Fecha:** 2026-11-16 (UTC-5)
- **Commit local:** `113a538`
- **Estación:** Windows, Node (suite del repo)
- **Nota:** suites existentes + cobertura; sin modificar producto en esta pasada de medición

---

## 1. Suites

| Suite | Resultado |
| --- | --- |
| Unitaria `npm test` | **PASS** — 24 suites, **72** tests |
| E2E `npm run test:e2e` | **PASS** — 1 suite, **12** tests |
| Cobertura `npm run test:cov` | **PASS** tests; statements **≈69.98%** (&lt;80% objetivo) |

---

## 2. Post-campaña de carga

La batería local se ejecutó en la misma jornada que la campaña de capacidad remota. **Verde**. No se observó regresión de suite atribuible a la carga remota.

---

## 3. Pendientes de herramienta

| Ítem | Motivo |
| --- | --- |
| Trivy / ZAP / Gitleaks en CI local auditor | No instalados en estación |
| `test:integration` XUI real | No requerido tras e2e + smoke API |

**Conclusión:** regresión automatizada **aprobada**; cobertura aún bajo 80%.
