# Resumen ejecutivo — Auditoría backend COTAS

## Addendum de seguimiento — 11 de noviembre de 2026

Se revisó el avance local de levantamiento sin sobrescribir los resultados históricos de `8fa5549`. En este árbol local hay cambios sobre tickets, MFA, límites, allowlists de redirect, CORS y capacidad. Las suites locales pasan (69 unitarias, 12 E2E; build/lint/formato PASS). Los cambios están sin commit y **no se verificaron en staging ni producción**.

| Observación | Estado local |
|---|---|
| Tickets bearer y TTL | Mitigación parcial: Redis/900 s/revocación en logout; falta validar fallback, binding a sesión y despliegue. |
| MFA staff | Corregido en código y probado E2E local; staging pendiente. |
| SSRF redirects media/playback | Guardas de allowlist/puerto y unit tests PASS; retest dinámico pendiente. |
| Cuenta A sin máximo | Parser acepta 100 000 y aplica fallback configurable; confirmar semántica de `max_connections`. |
| Saturación media | Límite por defecto 10, conservador según línea base histórica; no hubo nueva carga, capacidad no certificada. |
| Novedades de catálogo | La evaluación histórica describía el flujo FCM anterior. En el seguimiento local se cambió a consulta autenticada e incremental para películas, series y episodios; Flutter debe generar avisos locales. La migración y flujo XUI/PostgreSQL desplegado siguen sin verificarse. Ver entregables en `AUDITORIA/NOTIFICACIONES_CATALOGO_BACKEND.md`. |

**Veredicto actualizado de notificaciones de catálogo:** la ruta FCM ya no forma parte del diseño. El código local detecta películas, series y episodios, y la app inspeccionada cuenta con un servicio de notificaciones locales que aún debe conectarse a la consulta incremental. La prueba XUI real → PostgreSQL → API, aplicación de migración en ambiente controlado y verificación en dispositivo permanecen pendientes; no afirmar entrega móvil completa.

- **Fecha:** 2026-11-11
- **Sistema:** Backend NestJS IPTV — COTAS PERU S.A.C.
- **API evaluada:** `https://api.cotasperu.com/api/v1`
- **Commit:** `8fa5549`
- **Mandato:** inspeccionar, probar, medir y documentar — **sin corregir**

---

## Estado general

El backend **opera los flujos críticos** (login, dispositivos, catálogo, autorización + proxy HLS, logout) de forma correcta.  
La suite automatizada permanece **verde** tras la campaña de carga (63 unit + 12 e2e).  

Se **completó** la fase de rendimiento con carga gradual, spike y soak, y resiliencia con sondas remotas más caos PostgreSQL en Docker local.  
**No está listo** para declararse producción endurecida mientras persistan hallazgos HIGH de tickets, cupo Cuenta A, MFA/SSRF y saturación del proxy media (503 @ 25 VU).

---

## Hallazgos críticos y altos

| ID | Severidad | Tema |
| --- | --- | --- |
| — | CRITICAL | Ninguno confirmado |
| CODE-001 / SEC-001 / RES-001 | HIGH | Tickets media in-memory, TTL 6h, URL pública |
| CODE-003 / SEC-002 | HIGH | Cuenta A sin `maxConnections`/`maxDevices` → cupo API ilimitado |
| CODE-008 / SEC-006 | HIGH | MFA staff no enforced en login |
| CODE-009 / SEC-005 | HIGH | SSRF `/media/asset` con redirects |
| CODE-010 / SEC-007 | HIGH | Playback redirect fuera de allowlist |
| PERF-001 / RES-003 | HIGH | Proxy media **503** a 25 VU concurrentes |
| SEC-003/004, CODE-002, PERF-002, RES-002 | MEDIUM | npm Prisma; rate limits; ready lento si PG cae; CORS/QR race |

---

## Capacidad (medida)

| Dominio | Estable observado | Saturación |
| --- | --- | --- |
| API JSON | ~10–20 VU / IP (errorRate 0) | 429 desde ~25–40 VU (`GLOBAL_RATE_LIMIT`) |
| Health | ~10 VU OK | Spike 80 → 100 % 429 |
| Playback media | ~10 VU OK (p95 ~0.7 s) | **503 @ 25 VU** |
| Authorize | ~10/min/IP (SensitiveRateLimit) | 429 en ráfaga |

No se publica “usuarios concurrentes de producción” más allá de estos techos desde **una IP**.

---

## Cuenta A vs B

| | Cuenta A | Cuenta B |
| --- | --- | --- |
| Tope API | **null** (used≥16) | **15/15** |
| Al superar | Sin rechazo por cupo | Login **displace**; QR approve **403 DEVICE_LIMIT** |

---

## Seguridad

JWT + sesiones OK; XUI no filtrado en muestras. Riesgos: ticket público, cupo A, MFA, SSRF redirects.

---

## Resiliencia

- Ticket inválido → 404; JWT malo → 401; abort media → OK.  
- PG pause (Docker local): `live` 200; `ready` **timeout ~8 s**; recuperación tras unpause.  
- Restart API: proceso OK; tickets en memoria se pierden (diseño).

---

## Calidad

Cobertura ~**72%**. Suites verdes post-carga.

---

## Recomendación de preparación

| Veredicto | Condición |
| --- | --- |
| **NO APTO** “producción endurecida / capacidad demostrada” | Cerrar HIGH + mejorar proxy media y cupo A |
| **APTO condicional** piloto/pruebas | Flujos críticos PASS; monitorear 429/503 y tickets |

Prioridad desarrollo: tickets Redis/TTL, fail-safe maxConnections, MFA, SSRF redirects, capacidad proxy media, rate limits.
