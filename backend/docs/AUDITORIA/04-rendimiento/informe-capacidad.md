# Informe de capacidad

- **Fecha:** 2026-11-11
- **Commit:** `8fa5549`
- **Fuente:** campañas de carga documentadas en `resultados-pruebas-estres.md`

---

## 1. Capacidad estable medida (desde 1 IP / 1 estación)

| Dominio | Capacidad estable observada | Techo / saturación |
| --- | --- | --- |
| Health | ~10 VU sin errores; RPS pico útil ~57 | 429 desde ~25 VU / spike 80 |
| API JSON (catalog) | **~10–20 VU** con errorRate 0; p95 0.4–1.2 s | 429 ~25 % a 40 VU |
| Playback media (HLS ticket) | **~10 VU** errorRate 0; p95 ~0.7 s | **503 dominante a 25 VU** (errorRate 0.65) |
| Authorize | Limitado por SensitiveRateLimit (~10/min/IP/ruta) | 429 bajo ráfaga (confirmado) |
| Concurrencia masiva 1000+ | No alcanzada | Bloqueada por throttling/503 previos |

**Lectura operativa:** la capacidad “útil estable” medida para un cliente/IP está en el orden de **decenas de requests concurrentes**, no cientos, bajo la configuración actual de rate limits y el proxy de media.

---

## 2. Cuellos de botella (con evidencia)

| Componente | Evidencia | Clasificación |
| --- | --- | --- |
| Global rate limit (≈300/min) | 429 en health c=25, catalog c=40, soak, spike | **CONFIRMADO** |
| Sensitive rate limit (login/authorize ≈10/min) | 429 en ráfagas authorize; login B previo | **CONFIRMADO** |
| Proxy `/playback/media` | 503×49 de 75 a 25 VU | **CONFIRMADO** (saturación proxy/upstream) |
| XUI / upstream | Media 503 bajo fan-out; authorize depende de XUI | **PROBABLE** (no instrumentado en host) |
| PostgreSQL claimDevice | Transaccional; no saturado en estas etapas | No observado como primer fallo |
| Ticket Map in-memory | Diseño; riesgo multi-instancia / restart | **CONFIRMADO por diseño** |

---

## 3. Cuenta A vs Cuenta B

| Aspecto | Cuenta A | Cuenta B |
| --- | --- | --- |
| Login bajo prueba | OK | OK (displace) |
| maxConnections API | **null** | **15** |
| devices.used / limit | 16 / **null** | **15 / 15** |
| Rechazo al superar límite | No aplicable (sin tope API) | Login: desplaza; **QR approve: 403 DEVICE_LIMIT** |
| Límite 100 000 | No ejercible vía API | N/A |
| Reproducción | Authorize + media OK | No requerida para cupo |

---

## 4. Propuesta de SLO (para aprobación — no oficiales)

| Indicador | Propuesta |
| --- | --- |
| API p95 carga baja (≤10 VU) | ≤ 500 ms |
| Media playlist p95 (≤10 VU) | ≤ 800 ms |
| errorRate estable | &lt; 1 % (excluyendo 429 de abuso) |
| Disponibilidad ready | 99.9 % mensual |

Diferenciar de resultados medidos: hoy el sistema **cumple** p95 bajos a ≤10 VU; **no cumple** errorRate bajo soak agresivo por diseño de rate limit.

---

## 5. Recomendaciones técnicas (no implementadas)

1. Separar límites de rate para QA / health vs login sensible.
2. Escalar y aislar el path de media; medir 503 con métricas XUI/Astra.
3. Fail-safe `maxConnections` cuando XUI omite el valor (Cuenta A).
4. Externalizar tickets; campaña k6 multi-IP en staging con dashboards de host.
5. Documentar explícitamente: login = displace, QR approve = reject.
