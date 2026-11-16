# Plan de pruebas de carga

- **Actualizado:** 2026-11-16
- **Commit:** `113a538`
- **Herramienta:** runner Node.js (pool concurrente) + curl de verificación
- **Entorno:** `https://api.cotasperu.com/api/v1`
- **Cuentas:** A (tope 10000), B (tope 15)

---

## 1. Objetivos

1. Medir capacidad estable API JSON y anuncios.
2. Medir reproducción con **tickets/streams independientes**.
3. Obtener estimación documentada (VU/RPS) sin fingir equivalencia TV sin metodología.
4. Comparar con línea base 2026-11-11.

---

## 2. Escenarios y estado de ejecución

| Escenario | Estado 2026-11-16 |
| --- | --- |
| Baseline health/me/catalog/announcements | **EJECUTADO** |
| Load catalog 5→30 VU | **EJECUTADO** |
| Authorize multi-stream + media independiente | **EJECUTADO** |
| Media load 5→20 VU sobre 5 tickets | **EJECUTADO** |
| Soak paced 120 s @ ~3.5 RPS | **EJECUTADO** |
| Spike health | Cubierto históricamente (11-nov); no repetido (riesgo 429 masivo) |
| 1000+ VU | **NO** — saturación antes; riesgo a entorno compartido |
| Multi-IP / métricas host | **PENDIENTE** (sin SSH/staging dedicado) |

---

## 3. Criterios de parada aplicados

errorRate ≥ 15 %, ráfaga 5xx, o 429 dominante.

---

## 4. Restricciones

Sin 10000/100000 conexiones de golpe. Sin tumbar XUI/PG producción. Credenciales solo en env de sesión.
