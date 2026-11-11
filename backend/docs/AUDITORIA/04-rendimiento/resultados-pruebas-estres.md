# Resultados de pruebas de estrés / carga

- **Fecha:** 2026-11-11 (UTC-5 / corridas ~08:40–08:48 y follow-up media ~08:45–08:48)
- **Commit:** `8fa5549`
- **Entorno:** `https://api.cotasperu.com/api/v1`
- **Generador:** Node.js pool concurrente (estación Windows auditor)
- **Cuentas:** Cuenta A / Cuenta B (sin credenciales en este documento)

---

## 1. Baseline (secuencial)

| Endpoint | N | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
| --- | ---: | ---: | ---: | ---: | --- |
| `/health/live` | 30 | 147 | 211 | 325 | 0 |
| `/health/ready` | 30 | 132 | 210 | 212 | 0 |
| `/catalog/home` | 30 | 206 | 335 | 521 | 0 |
| `/auth/me` | 30 | 219 | 275 | 312 | 0 |
| `/playback/media/{ticket}` | 15 | 173 | 283 | 283 | 0 |

**Conclusión baseline:** latencias de línea base en cientos de ms; flujo crítico estable a 1 VU.

---

## 2. Carga health (público)

| Concurrencia | Requests | RPS | p95 (ms) | errorRate | Status |
| ---: | ---: | ---: | ---: | ---: | --- |
| 5 | 50 | 25.0 | 556 | 0 | 200×50 |
| 10 | 100 | 56.8 | 395 | 0 | 200×100 |
| 25 | 150 | 112.4 | 568 | **0.20** | 200×120, **429×30** |
| 80 spike | 80 | 138.6 | — | **1.00** | **429×80** |

**Parada:** en c=25 aparece `GLOBAL_RATE_LIMIT` (≈300/min). Spike 80 = 100 % 429.

---

## 3. Carga API JSON (`GET /catalog/home`, token Cuenta A reutilizado)

| Concurrencia | Requests | RPS | p50 | p95 | p99 | errorRate | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 5 | 40 | 22.3 | 180 | 424 | 487 | 0 | 200×40 |
| 10 | 60 | 24.9 | 309 | 726 | 894 | 0 | 200×60 |
| 20 | 80 | 32.7 | 455 | 1243 | 1640 | 0 | 200×80 |
| 40 | 120 | 42.4 | 908 | 1608 | 2188 | **0.25** | 200×90, **429×30** |

**Observación:** hasta ~20 concurrentes sin error HTTP; p95 ya &gt; 1.2 s. A 40 VU el limitador global corta (~25 % 429).

---

## 4. Carga playback media (ticket válido, sin JWT)

| Concurrencia | Requests | RPS | p50 | p95 | p99 | errorRate | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 5 | 30 | 15.2 | 258 | 633 | 692 | 0 | 200×30 |
| 10 | 50 | 18.9 | 495 | 691 | 812 | 0 | 200×50 |
| 25 | 75 | 52.6 | 514 | 828 | 829 | **0.65** | 200×26, **503×49** |

**Parada:** a 25 VU el proxy multimedia responde **503** (saturación/upstream), no solo 429.  
Este es el **primer cuello de botella de reproducción medido** bajo esta campaña.

---

## 5. Soak (endurance)

| Parámetro | Valor |
| --- | --- |
| Escenario | `/catalog/home` @ 5 concurrentes, 180 s |
| Requests | ~2290 |
| RPS medio | 12.7 |
| p50 / p95 / p99 (solo OK) | 217 / 436 / 735 ms |
| Status | 200×600, **429×1690** (errorRate ≈ 0.74) |

**Interpretación:** el soak a 5 VU sostenidos **supera el cupo global ~300 req/min** (5 workers con poco sleep ≈ &gt;5 RPS sostenido). La API no “cae” (ready sigue OK después), pero el **throttling domina** la experiencia bajo carga sostenida desde una sola IP.

---

## 6. Spike

80 requests concurrentes a `/health/live` → **80×429**, p95 no aplicable (0 OK). Recuperación posterior: `/health/ready` = 200 tras las pruebas.

---

## 7. Cuenta B — límite 15 dispositivos

| Prueba | Resultado |
| --- | --- |
| 18 logins paced (~7 s) con `deviceId` únicos | Todos **200** — login usa política **displace** (libera aparatos más nuevos; no 403) |
| Estado final `/devices` | **used=15 / limit=15**; subscription `maxConnections=15` |
| QR `POST /auth/device-link/approve` con cupo lleno | **403 `DEVICE_LIMIT`** (`used=15`,`limit=15`) — mensaje controlado, sin leak interno |

**Unidad controlada:** dispositivos ACTIVE en PostgreSQL alineados a `maxConnections` de snapshot XUI (no “streams HTTP”).

---

## 8. Cuenta A — alta capacidad

| Métrica | Valor observado |
| --- | --- |
| Login / catálogo / authorize / media | OK en pruebas de carga asociadas |
| `/devices` tras campaña | **used=16, limit=null** |
| Límite 100 000 ejercido | **No** — API no expone tope; cupo efectivo ilimitado en backend (CODE-003) |

---

## 9. Campos de capacidad medidos vs no medidos

| Campo | Estado |
| --- | --- |
| RPS / p50–p99 por etapa | **Medido** |
| Punto de saturación observable | **Medido:** rate limit (~25–40 VU API); media **503 @ 25 VU** |
| Soak | **Medido** (limitado por 429) |
| Spike | **Medido** |
| CPU/RAM/PG pool host prod | **No medido** (sin SSH/métricas host) |
| 1000–10 000 VU | **No ejecutado** — ya hay saturación funcional antes; riesgo injustificado |

---

## 10. Conclusión de rendimiento

1. **API JSON estable** en carga baja/media hasta ~20 VU desde una IP, con degradación de latencia.
2. **Primer limitador de API:** `GLOBAL_RATE_LIMIT` (~300/min) → 429.
3. **Primer limitador de streaming medido:** **503 en proxy media @ 25 concurrentes** sobre el mismo ticket.
4. **Cuenta B:** límite 15 **sí se aplica** en approve QR; login **desplaza** en lugar de rechazar.
5. No se afirma capacidad de “usuarios concurrentes de producción” más allá de estos techos medidos desde una estación/IP.
