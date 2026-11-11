# Informe de resiliencia

- **Fecha:** 2026-11-11 (UTC-5)
- **Commit:** `8fa5549`
- **MÃ©todos:** (1) sondas no destructivas contra `api.cotasperu.com`; (2) caos controlado en **stack Docker local** (`backend-backend-1` + `backend-postgres-1` en estaciÃ³n auditor); (3) revisiÃ³n de cÃ³digo/diseÃ±o

---

## 1. Matriz de fallos

| Fallo | Entorno | Procedimiento | Resultado | Estado |
| --- | --- | --- | --- | --- |
| Ticket media invÃ¡lido | Remoto | `GET /playback/media/does-not-existâ€¦` | **404** `NOT_FOUND`, mensaje genÃ©rico, ~466 ms | **PASS** |
| JWT invÃ¡lido | Remoto | `GET /auth/me` Bearer basura | **401** | **PASS** |
| Authorize stream invÃ¡lido | Remoto | `streamId` no string / inexistente | **400** `VALIDATION_ERROR` | **PASS** |
| RÃ¡faga authorize | Remoto | 12 POST seguidos | 400Ã—9 luego **429Ã—3** (SensitiveRateLimit) | **PASS** (degradaciÃ³n controlada) |
| Abort cliente media | Remoto | `fetch` + `AbortController` mid-body | AbortError cliente; API sigue `ready=ok` | **PASS** |
| Ready tras carga | Remoto | Tras soak/spike | **200** `database:up` | **PASS** |
| CaÃ­da PostgreSQL | **Local Docker** | `docker pause backend-postgres-1` | `/health/live` **200**; `/health/ready` **timeout** (HTTP 000 / &gt;8 s) | **EJECUTADO** |
| RecuperaciÃ³n PG | Local | `docker unpause` + 4 s | `/health/ready` **200** `database:up` | **PASS** |
| Restart backend | Local | `docker restart backend-backend-1` | Proceso vuelve; health **200** | **PASS** (disponibilidad proceso) |
| PÃ©rdida tickets tras restart | CÃ³digo + diseÃ±o | Store in-memory | Tickets no sobreviven al proceso | **CONFIRMADO por diseÃ±o** (RES-001) |
| XUI down en producciÃ³n | Remoto | Inducir fallo XUI real | **NO EJECUTADO** â€” afectarÃ­a clientes/compartido | BLOCKED (prod) |
| Latencia XUI | Unitario + timeout client | Tests `DEPENDENCY_TIMEOUT` | Cubierto en suite; e2e registra timeout tipado | Parcial (test) |
| Agotar pool PG | â€” | â€” | No forzado (riesgo) | NOT RUN |
| 4xx/5xx XUI mapeados | CÃ³digo/tests | Mappers | Errores tipados sin stack interno en respuestas muestreadas | Parcial |

---

## 2. Evidencia local â€” PostgreSQL pausado

```text
Antes:  live=200  ready=200 checks.database=up
Durante pause PG:
  live_http=200  (~10 ms)
  ready_http=000  timeâ‰ˆ8.0s (timeout cliente; no degrada limpio a 503 inmediato)
DespuÃ©s unpause:
  ready_http=200  database=up
```

**Hallazgo RES-002:** `live` no refleja dependencia DB (esperado liveness); `ready` **no falla rÃ¡pido** ante PG pausado â€” puede colgar hasta timeout del probe/cliente. Riesgo de orquestaciÃ³n: readiness gates lentos / falsos â€œhealthyâ€ prolongados segÃºn timeout del probe.

---

## 3. Controles observados

| Control | Evidencia |
| --- | --- |
| Timeouts XUI | `XUI_TIMEOUT_MS` + DomainError `DEPENDENCY_TIMEOUT` |
| Errores tipados | `NOT_FOUND`, `DEVICE_LIMIT`, `RATE_LIMITED`, `VALIDATION_ERROR` |
| Circuit breaker | **No encontrado** |
| Rate limit como backpressure | 429 bajo spike/soak â€” actÃºa como fusible |
| LiberaciÃ³n recursos proxy | Abort cliente no dejÃ³ API caÃ­da (ready OK) |
| DegradaciÃ³n catÃ¡logo | DiseÃ±o `source=cache` si live falla (no inducido en prod) |
| Cupo dispositivos | QR approve **403 DEVICE_LIMIT** con used/limit=15 |

---

## 4. Hallazgos de resiliencia

### [RES-001] PÃ©rdida de tickets de media ante reinicio del proceso

- ClasificaciÃ³n: CONFIRMED DEFECT (diseÃ±o)
- Severidad: HIGH
- Evidencia: `PlaybackMediaTicketStore` in-memory; restart local recupera proceso pero no el store
- Impacto: players con URL activa â†’ 404 tras deploy/restart
- RecomendaciÃ³n: Redis/store compartido + TTL corto + sticky innecesaria si store externo

### [RES-002] `/health/ready` cuelga ante PostgreSQL no disponible

- ClasificaciÃ³n: CONFIRMED (lab local)
- Severidad: MEDIUM
- Evidencia: timeout ~8 s sin HTTP de error limpio durante `docker pause` de Postgres
- Impacto: probes de orquestaciÃ³n lentos; posible trÃ¡fico en Instantes intermedios
- RecomendaciÃ³n: timeout estricto en check Prisma + respuesta 503 rÃ¡pida

### [RES-003] Proxy media retorna 503 bajo fan-out concurrente

- ClasificaciÃ³n: CONFIRMED (carga remota)
- Severidad: HIGH (capacidad/resiliencia de streaming)
- Evidencia: 25 VU â†’ 49Ã—503 / 75 requests
- Impacto: reproducciÃ³n falla antes que el rate limit en ese path
- RecomendaciÃ³n: colas/lÃ­mites de proxy, mÃ©tricas upstream, prueba aislada XUI

---

## 5. ConclusiÃ³n

Se **ejecutaron** sondas de resiliencia remotas y un experimento controlado de caÃ­da/recuperaciÃ³n de PostgreSQL en Docker local.  

- RecuperaciÃ³n tras unpause PG: **sÃ­**.  
- DegradaciÃ³n limpia inmediata de ready: **parcial / lenta** (RES-002).  
- Fragilidad de tickets a restart: **sÃ­** (RES-001).  
- Caos XUI en producciÃ³n compartida: **no** (bloqueo justificado); cobertura vÃ­a tests de timeout.

No se afirma resiliencia completa multi-AZ ni chaos de red LAN XUI (`<XUI_INTERNAL_HOST>`) desde esta estaciÃ³n.
