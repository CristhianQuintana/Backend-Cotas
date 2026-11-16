# Informe de capacidad

- **Fecha:** 2026-11-16
- **Commit referencia API/código:** `113a538`
- **Fuente:** `resultados-pruebas-estres.md` (campaña 2026-11-16 + histórico 2026-11-11)

---

## 1. Capacidad estable medida (1 IP / 1 estación)

| Dominio | Estable | Techo / saturación |
| --- | --- | --- |
| API JSON (`/catalog/home`) | **20 VU**, p95 ≈ 583 ms, errorRate 0 | 30 VU → ~56 % 429 |
| Health | OK en baseline y soak paced | Spike histórico 80 → 100 % 429 |
| Playback playlist (tickets distintos) | **5 VU**, p95 ≈ 533 ms, errorRate 0 | **10 VU → 32 % 503** |
| Authorize | ~10/min/IP (SensitiveRateLimit) | 429 en ráfaga |
| Announcements | Baseline 15×200, p95 ≈ 195 ms | No estresado aparte |
| Soak paced 3.5 RPS / 120 s | errorRate **0** | — |

---

## 2. Estimación operativa (con metodología)

| Pregunta | Respuesta medible |
| --- | --- |
| ¿Cuántos VU JSON sostiene 1 IP? | **20** estables |
| ¿Cuántas playlists HLS concurrentes / IP? | **5** estables |
| ¿RPS sostenible / IP? | **≈3.5–5** (límite global ~300/min) |
| ¿Equivalencia TV? | Tentativa: **≈5 TVs** si 1 TV = 1 playlist concurrente en el mismo edge/IP. **No** extrapolar a granja completa. |
| ¿Usuarios totales de la plataforma? | **No demostrable** sin multi-IP, métricas de host y perfil de segmentos TS |

---

## 3. Cuellos de botella confirmados

| Componente | Evidencia 2026-11-16 | Severidad |
| --- | --- | --- |
| `GLOBAL_RATE_LIMIT` | catalog c=30 → 429 | MEDIUM (capacidad) |
| Proxy media / upstream | 503 desde 10 VU con tickets independientes | **HIGH** |
| Visibilidad de tickets | 404 intermitentes en lote de 12 tickets | **HIGH** (disponibilidad multi-instancia sospechada) |
| SensitiveRateLimit authorize | pacing obligatorio ~7 s | MEDIUM |

---

## 4. Cuenta A vs B

| | A | B |
| --- | --- | --- |
| maxConnections | **10000** | **15** |
| used/limit | 8/10000 | 15/15 |
| Cupo API | Aplicado | Aplicado |

---

## 5. SLO propuestos (no oficiales)

| Indicador | Propuesta | ¿Cumple hoy? |
| --- | --- | --- |
| API p95 ≤10 VU | ≤500 ms | Sí (baseline/carga) |
| Media p95 ≤5 VU | ≤800 ms | Sí (~533 ms) |
| errorRate estable | &lt;1 % | Sí bajo esos VU |
| Media ≤10 VU sin 503 | — | **No** |

---

## 6. Acciones para cerrar capacidad comercial

1. Confirmar Redis compartido en todas las réplicas API (tickets).  
2. Aislar/escalar proxy media; medir XUI/Astra bajo 10–50 playlists.  
3. Campaña multi-IP en staging con CPU/RAM/PG/Redis.  
4. Separar rate limits health/catalog vs auth.  
5. No usar un solo ticket para afirmar capacidad multi-TV.
