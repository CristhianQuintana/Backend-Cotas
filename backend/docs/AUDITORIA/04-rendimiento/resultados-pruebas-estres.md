# Resultados de pruebas de estrés / carga

- **Fecha campaña actual:** 2026-11-16 (UTC-5)
- **Commit código local alineado:** `113a538` (API pública de pruebas)
- **Entorno:** `https://api.cotasperu.com/api/v1`
- **Generador:** Node.js pool concurrente + verificación curl
- **Cuentas:** Cuenta A (`10200000`), Cuenta B (`userprueba`) — sin credenciales en este documento
- **Histórico comparable:** campaña 2026-11-11 sobre `8fa5549`

---

## 1. Baseline (secuencial) — 2026-11-16

| Endpoint | N | p95 (ms) | Errores |
| --- | ---: | ---: | --- |
| `/health/live` | 30 | 123 | 0 |
| `/health/ready` | 30 | 93 | 0 |
| `/catalog/home` | 30 | 240 | 0 |
| `/auth/me` | 20 | 134 | 0 |
| `/catalog/announcements?limit=20` | 15 | 195 | 0 |

**Conclusión baseline:** latencias mejores o equivalentes vs 2026-11-11; anuncios de catálogo responden 200.

---

## 2. Carga API JSON (`GET /catalog/home`, token Cuenta A)

| Concurrencia | Requests | RPS | p95 (ms) | errorRate | Status |
| ---: | ---: | ---: | ---: | ---: | --- |
| 5 | 40 | 32.5 | 272 | 0 | 200×40 |
| 10 | 50 | 45.9 | 426 | 0 | 200×50 |
| 15 | 60 | 47.9 | 385 | 0 | 200×60 |
| **20** | **80** | **56.2** | **583** | **0** | **200×80** |
| 30 | 90 | 90.2 | 727 | **0.56** | 200×40, **429×50** |

**Capacidad estable API JSON (1 IP):** **20 VU** (errorRate 0).  
**Techo:** 30 VU → rate limit global (~300/min) domina.

Comparación 11-nov: estable ~20 VU; saturación similar por 429 (antes c=40).

---

## 3. Playback con tickets independientes (streams distintos)

Metodología corregida respecto a 11-nov: **no** martillar un único ticket; se autorizaron streams live distintos y se reutilizó un set de tickets válidos.

### 3.1 Emisión de tickets

12 authorize Cuenta A (paced ~7 s) → **12×200** con `streamUrl` `/playback/media/{id}`.  
Verificación posterior de 5 tickets: concurrente y secuencial **5×200**.

### 3.2 Carga media sobre 5 tickets vivos

| Concurrencia | Requests | RPS | p95 (ms) | errorRate | Status |
| ---: | ---: | ---: | ---: | ---: | --- |
| **5** | **40** | **15.8** | **533** | **0** | **200×40** |
| 10 | 50 | 28.8 | 527 | **0.32** | 200×34, **503×16** |
| 15 | 60 | 58.3 | 581 | **0.67** | 200×20, 503×36, 500×4 |
| 20 | 80 | 87.3 | 602 | **0.78** | 200×18, 503×59, 500×3 |

**Capacidad estable playlist HLS (1 IP, tickets distintos):** **5 VU** concurrentes.  
**Techo:** desde **10 VU** aparecen **503** (proxy/upstream), peor que el experimento histórico de 1 ticket (@25 VU) porque ahora hay fan-out real a varios streams.

### 3.3 Anomalía observada (tickets 404)

En la corrida inicial con 12 tickets escalonados + pool inmediato c=3: **6×200 + 18×404**.  
Reprueba controlada (5 tickets) → 100 % 200.  

**Interpretación:** inconsistencia de visibilidad de tickets bajo emisión prolongada/concurrencia (sospechoso de multi-instancia con store no compartido o fallback memoria). Clasificado como hallazgo **PERF-003 / RES-004** — no inventar causa de infra sin logs de host.

---

## 4. Soak controlado (bajo rate limit)

| Parámetro | Valor |
| --- | --- |
| Escenario | home + me + health, pacing ~3.5 RPS, 120 s |
| Requests | 423 |
| errorRate | **0** |
| p95 | 222 ms |

**Conclusión:** sostenido **sin 429** si se respeta el techo global (~5 RPS/IP). El soak agresivo del 11-nov (errorRate 0.74) era auto-inducción de rate limit, no caída del proceso.

---

## 5. Cuentas A / B (estado 2026-11-16)

| Aspecto | Cuenta A | Cuenta B |
| --- | --- | --- |
| Login | 200 | 200 |
| `maxConnections` / `maxDevices` | **10000** | **15** |
| devices used/limit | 8 / 10000 | 15 / 15 |
| Expiración API | vacía / Active (Never Expire aparente) | vigente según snapshot previo |

**Nota:** el límite configurado en el informe de auditoría para A figura ahora como **10000** (no 100000). La API **ya expone** el tope (antes `null` en `8fa5549`).

---

## 6. Anuncios de catálogo (funcional bajo carga ligera)

| Prueba | Resultado |
| --- | --- |
| `GET /catalog/announcements?limit=5` | 200, items>0, `type=MOVIE`, `syncCursor` presente |
| `since=MA` (cursor 0) | 200 |
| `since=` vacío | 400 VALIDATION_ERROR (esperado) |
| Baseline 15 muestras | errorRate 0, p95 ~195 ms |

---

## 7. Estimación de capacidad (metodología explícita)

| Definición | Valor medido 2026-11-16 |
| --- | --- |
| VU | conexiones HTTP concurrentes **desde 1 IP** |
| API JSON estable | **20 VU**, ~56 RPS pico de etapa, p95 ~583 ms |
| Media playlist estable | **5 VU** con tickets independientes, ~16 RPS, p95 ~533 ms |
| Techo API | 30 VU → mayoría 429 |
| Techo media | 10 VU → 503 frecuentes |
| RPS sostenible / IP | **~3.5–5** (por `GLOBAL_RATE_LIMIT` ≈300/min) |

**Equivalencia a televisores (tentativa, no certificada multi-nodo):**  
Si 1 TV activa ≈ 1 sesión de playlist concurrente estable, la cota inferior medida es **≈5 TVs concurrentes por edge/IP** en el path de media.  
**No** se afirma “N usuarios de producción” ni se multiplica por nodos sin prueba multi-IP + métricas de host/XUI.

---

## 8. Comparativa 11-nov vs 16-nov

| Métrica | 11-nov (`8fa5549`) | 16-nov (`113a538`) |
| --- | --- | --- |
| Cuenta A maxConnections | null | **10000** |
| Catalog estable | ~20 VU | **20 VU** |
| Media (1 ticket) | estable 10 / 503@25 | no repetido |
| Media (tickets independientes) | no medido | **estable 5 / 503@10** |
| Soak | 429 masivo sin pacing | **0 errores** con pacing 3.5 RPS |
| Announcements | N/A | **operativo** |

---

## 9. Conclusión de rendimiento

1. API JSON: capacidad estable demostrada **20 VU / IP**.  
2. Media: con streams independientes el techo útil baja a **5 VU** antes de 503.  
3. Rate limit global sigue siendo el fusible de API; el proxy/upstream el de reproducción.  
4. Tickets: funcionan en camino feliz; hay evidencia de **404 intermitentes** bajo emisión masiva escalonada → riesgo multi-instancia.  
5. Estimación TV: **~5 playlists concurrentes / IP** como cota inferior medible; cerrar proyecto comercial requiere staging multi-IP + CPU/RAM/XUI.
