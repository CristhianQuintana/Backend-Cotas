# Plan de pruebas de carga

- **Fecha:** 2026-11-11
- **Commit:** `8fa5549`
- **Herramienta:** runner Node.js (`fetch` + pool concurrente) — equivalente operativo a k6 smoke/load/spike/soak controlados
- **Entorno:** `https://api.cotasperu.com/api/v1` (entorno de pruebas autorizado del informe)
- **Cuentas:** Cuenta A (alta capacidad configurada), Cuenta B (límite 15)

---

## 1. Objetivos

1. Medir capacidad estable de API JSON (health, me, catálogo).
2. Medir capacidad de proxy HLS (`GET /playback/media/{ticket}`) separada de authorize.
3. Comparar Cuenta A vs Cuenta B bajo límites de línea/dispositivos.
4. Identificar el primer limitador observable (rate limit, 503 proxy, latencia).

---

## 2. Escenarios ejecutados

| Escenario | Descripción | Estado |
| --- | --- | --- |
| Baseline | 30 muestras secuenciales health/me/catalog; 15 media | **EJECUTADO** |
| API-JSON load | Concurrencia 5→40 sobre `/catalog/home` con token reutilizado | **EJECUTADO** |
| Health load | Concurrencia 5→100 sobre `/health/live` | **EJECUTADO** (parada en c=25 por 429) |
| Playback media | Concurrencia 5→50 sobre ticket HLS válido | **EJECUTADO** (parada en c=25 por 503) |
| Spike | 80 VU simultáneos en health | **EJECUTADO** |
| Soak | 180 s @ 5 concurrentes catalog | **EJECUTADO** |
| Cupo B | Login paced + QR approve con used=15 | **EJECUTADO** |

---

## 3. Etapas VU y criterios de parada

| Etapa | Objetivo VU | Resultado |
| --- | --- | --- |
| Smoke 1 | Baseline | PASS |
| 5–10 | Carga baja | PASS (health/catalog/media) |
| 20–25 | Carga media | Health/catalog: 429; media: **503** |
| 40–80 | Alta / spike | Dominado por rate limit 429 |
| 1000+ | Estrés extremo | **NO EJECUTADO** — riesgo a clientes y sin métricas de host; el sistema ya satura por throttling/503 antes |

**Criterios de parada aplicados:** errorRate ≥ 15% en la etapa, o ráfaga de 5xx, o impacto evidente de 429 masivo.

**SLO del proyecto:** no definidos oficialmente. Valores de referencia usados solo para interpretar (no como aceptación contractual): p95 API &lt; 1 s en carga baja; errorRate &lt; 5% estable.

---

## 4. Métricas capturadas

RPS, latencia p50/p90/p95/p99, status HTTP, errorRate, duración de etapa.  
**No disponibles desde estación auditor:** CPU/RAM contenedor producción, pool PG producción, latencia XUI interna, ancho de banda host `10.10.0.31`.

---

## 5. Restricciones respetadas

- Sin 100 000 conexiones.
- Ramp-up gradual con cool-down entre etapas.
- Credenciales solo en variables de entorno de la sesión; no publicadas en reportes.
- Sin modificación de cuentas XUI ni de infraestructura.
