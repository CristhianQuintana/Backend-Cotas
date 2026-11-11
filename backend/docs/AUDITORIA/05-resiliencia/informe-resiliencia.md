# Informe de resiliencia

- **Fecha:** 2026-11-11 (UTC-5)
- **Commit:** `8fa5549`
- **Métodos:** (1) sondas no destructivas contra `api.cotasperu.com`; (2) caos controlado en **stack Docker local** (`backend-backend-1` + `backend-postgres-1` en estación auditor); (3) revisión de código/diseño

---

## 1. Matriz de fallos

| Fallo | Entorno | Procedimiento | Resultado | Estado |
| --- | --- | --- | --- | --- |
| Ticket media inválido | Remoto | `GET /playback/media/does-not-exist…` | **404** `NOT_FOUND`, mensaje genérico, ~466 ms | **PASS** |
| JWT inválido | Remoto | `GET /auth/me` Bearer basura | **401** | **PASS** |
| Authorize stream inválido | Remoto | `streamId` no string / inexistente | **400** `VALIDATION_ERROR` | **PASS** |
| Ráfaga authorize | Remoto | 12 POST seguidos | 400×9 luego **429×3** (SensitiveRateLimit) | **PASS** (degradación controlada) |
| Abort cliente media | Remoto | `fetch` + `AbortController` mid-body | AbortError cliente; API sigue `ready=ok` | **PASS** |
| Ready tras carga | Remoto | Tras soak/spike | **200** `database:up` | **PASS** |
| Caída PostgreSQL | **Local Docker** | `docker pause backend-postgres-1` | `/health/live` **200**; `/health/ready` **timeout** (HTTP 000 / &gt;8 s) | **EJECUTADO** |
| Recuperación PG | Local | `docker unpause` + 4 s | `/health/ready` **200** `database:up` | **PASS** |
| Restart backend | Local | `docker restart backend-backend-1` | Proceso vuelve; health **200** | **PASS** (disponibilidad proceso) |
| Pérdida tickets tras restart | Código + diseño | Store in-memory | Tickets no sobreviven al proceso | **CONFIRMADO por diseño** (RES-001) |
| XUI down en producción | Remoto | Inducir fallo XUI real | **NO EJECUTADO** — afectaría clientes/compartido | BLOCKED (prod) |
| Latencia XUI | Unitario + timeout client | Tests `DEPENDENCY_TIMEOUT` | Cubierto en suite; e2e registra timeout tipado | Parcial (test) |
| Agotar pool PG | — | — | No forzado (riesgo) | NOT RUN |
| 4xx/5xx XUI mapeados | Código/tests | Mappers | Errores tipados sin stack interno en respuestas muestreadas | Parcial |

---

## 2. Evidencia local — PostgreSQL pausado

```text
Antes:  live=200  ready=200 checks.database=up
Durante pause PG:
  live_http=200  (~10 ms)
  ready_http=000  time≈8.0s (timeout cliente; no degrada limpio a 503 inmediato)
Después unpause:
  ready_http=200  database=up
```

**Hallazgo RES-002:** `live` no refleja dependencia DB (esperado liveness); `ready` **no falla rápido** ante PG pausado — puede colgar hasta timeout del probe/cliente. Riesgo de orquestación: readiness gates lentos / falsos “healthy” prolongados según timeout del probe.

---

## 3. Controles observados

| Control | Evidencia |
| --- | --- |
| Timeouts XUI | `XUI_TIMEOUT_MS` + DomainError `DEPENDENCY_TIMEOUT` |
| Errores tipados | `NOT_FOUND`, `DEVICE_LIMIT`, `RATE_LIMITED`, `VALIDATION_ERROR` |
| Circuit breaker | **No encontrado** |
| Rate limit como backpressure | 429 bajo spike/soak — actúa como fusible |
| Liberación recursos proxy | Abort cliente no dejó API caída (ready OK) |
| Degradación catálogo | Diseño `source=cache` si live falla (no inducido en prod) |
| Cupo dispositivos | QR approve **403 DEVICE_LIMIT** con used/limit=15 |

---

## 4. Hallazgos de resiliencia

### [RES-001] Pérdida de tickets de media ante reinicio del proceso

- Clasificación: CONFIRMED DEFECT (diseño)
- Severidad: HIGH
- Evidencia: `PlaybackMediaTicketStore` in-memory; restart local recupera proceso pero no el store
- Impacto: players con URL activa → 404 tras deploy/restart
- Recomendación: Redis/store compartido + TTL corto + sticky innecesaria si store externo

### [RES-002] `/health/ready` cuelga ante PostgreSQL no disponible

- Clasificación: CONFIRMED (lab local)
- Severidad: MEDIUM
- Evidencia: timeout ~8 s sin HTTP de error limpio durante `docker pause` de Postgres
- Impacto: probes de orquestación lentos; posible tráfico en Instantes intermedios
- Recomendación: timeout estricto en check Prisma + respuesta 503 rápida

### [RES-003] Proxy media retorna 503 bajo fan-out concurrente

- Clasificación: CONFIRMED (carga remota)
- Severidad: HIGH (capacidad/resiliencia de streaming)
- Evidencia: 25 VU → 49×503 / 75 requests
- Impacto: reproducción falla antes que el rate limit en ese path
- Recomendación: colas/límites de proxy, métricas upstream, prueba aislada XUI

---

## 5. Conclusión

Se **ejecutaron** sondas de resiliencia remotas y un experimento controlado de caída/recuperación de PostgreSQL en Docker local.  

- Recuperación tras unpause PG: **sí**.  
- Degradación limpia inmediata de ready: **parcial / lenta** (RES-002).  
- Fragilidad de tickets a restart: **sí** (RES-001).  
- Caos XUI en producción compartida: **no** (bloqueo justificado); cobertura vía tests de timeout.

No se afirma resiliencia completa multi-AZ ni chaos de red LAN XUI (`10.10.0.100`) desde esta estación.
