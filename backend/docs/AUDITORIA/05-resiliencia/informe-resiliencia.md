# Informe de resiliencia

- **Fecha base:** 2026-11-11
- **Addendum:** 2026-11-16
- **Commit referencia:** `113a538` (API pública) / histórico lab `8fa5549`
- **Métodos:** sondas no destructivas en `api.cotasperu.com`; caos PG en Docker local; re-medición de media/tickets

---

## 1. Matriz de fallos

| Fallo | Resultado | Estado |
| --- | --- | --- |
| Ticket media inválido | 404 controlado | PASS |
| JWT inválido | 401 | PASS |
| Abort cliente media | API sigue ready | PASS |
| PG pause (Docker local) | live 200; ready timeout ~8 s; recupera | EJECUTADO |
| Restart API | proceso OK; tickets memoria se pierden si no hay Redis | CONFIRMADO diseño |
| Media fan-out | 503 desde 10 VU (16-nov, tickets independientes) | CONFIRMADO |
| Tickets tras authorize escalonado | 404 intermitentes (16-nov) | ABIERTO PERF-003 |
| XUI down producción | No inducido | BLOCKED |

---

## 2. Addendum capacidad/resiliencia media (2026-11-16)

| Prueba | Resultado |
| --- | --- |
| 5 tickets vivos, c=5 | 40/40 × 200 |
| 5 tickets, c=10 | 32% 503 |
| 12 authorize + pool inmediato | 75% 404 (inconsistencia) |
| Retest 5 tickets | 100% 200 |
| Authorize → GET inmediato | 200 HLS |

---

## 3. Hallazgos

### RES-001 — Tickets frágiles sin store compartido
HIGH. Mitigado parcialmente con Redis en código; PERF-003 sugiere validar réplicas en despliegue.

### RES-002 — ready lento si PG cae
MEDIUM. Timeout ~8 s en lab.

### RES-003 — 503 proxy media
HIGH. Re-medido: techo útil ~5 VU con streams independientes.

### RES-004 — 404 intermitente de tickets
HIGH. Sospecha multi-instancia / fallback memoria.

---

## 4. Conclusión

Resiliencia de proceso/API básica: aceptable.  
Resiliencia de reproducción bajo concurrencia: **limitada**.  
Para cierre comercial: Redis compartido verificado + staging multi-IP + métricas XUI.
