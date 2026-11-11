# Auditoría técnica consolidada

## Addendum de continuación del levantamiento — 11 de noviembre de 2026

El cuerpo de este informe documenta la auditoría histórica contra `8fa5549`. Desde entonces, el árbol de trabajo local contiene cambios sin confirmar. No representan un despliegue ni una nueva validación de la API pública.

### Verificación local nueva

| Verificación | Resultado |
|---|---|
| Unit tests | PASS — 69 tests / 23 suites |
| E2E | PASS — 12 tests / 1 suite |
| Build TypeScript | PASS |
| ESLint | PASS |
| Prettier check | PASS |

Las pruebas unitarias/E2E son locales y usan dobles. No se ejecutaron integración PostgreSQL, FCM real, API remota, HLS/VOD real, cuentas IPTV, concurrencia ni caos. El sandbox inicialmente bloqueó servidores loopback (`EACCES`); las corridas finales se realizaron con autorización fuera del sandbox.

### Estado de levantamiento

- MFA staff, CORS PUT/PATCH, parseo del límite XUI, validación de redirects por allowlist/puerto y límites de concurrencia del proxy tienen cambios locales.
- Tickets usan Redis y TTL de 900 s si Redis está habilitado; aún existe fallback de memoria y no hay retest de multiinstancia/sesión en despliegue.
- El límite fail-safe de dispositivos depende de `DEVICE_LIMIT_FAILSAFE` (ejemplo: 3). La equivalencia entre `max_connections` XUI y dispositivos COTAS requiere confirmación funcional.
- La concurrencia del proxy queda limitada a 10 por defecto. Es contención conservadora derivada de datos históricos, no capacidad nuevamente medida ni solución demostrada del 503.
- La notificación de catálogo no está conectada extremo a extremo con el Flutter inspeccionado: no registra token FCM ni maneja mensajes. El backend solo puede enviar si el worker está activo, existe un anuncio nuevo tras el snapshot inicial, `FCM_ENABLED=true`, credenciales válidas y un token activo registrado. No se envió push real.

### Estado de preparación

**NO APTO PARA DECLARAR PRODUCCIÓN ENDURECIDA con la evidencia actual.** Las pruebas locales pasan, pero faltan staging, FCM/dispositivo, semántica de cupos, prueba de media con carga y verificación de configuración/dependencias. No se modificó ni sometió a carga el entorno productivo.

- **Organización:** COTAS PERU S.A.C.
- **Rol del ejecutor:** Principal Backend QA Engineer & Software Auditor (mandato documental)
- **Fecha de cierre documental:** 2026-11-11 (America/Lima)
- **Commit auditado:** `8fa5549a7cd15e4204edfbd944a5328596c12d84`
- **Base URL:** `https://api.cotasperu.com/api/v1`
- **Entregables:** exclusivamente bajo `backend/docs/AUDITORIA/` (estructura 00–07)

---

## 1. Alcance completo

Inventario, calidad de código, pruebas funcionales, seguridad no destructiva, **carga gradual / spike / soak**, resiliencia (sondas remotas + caos PG local), regresión de suites.  
**Fuera:** corrección de defectos, cambios de infra productiva, estrés 1000+ VU, tumbar XUI/PG de producción.

---

## 2. Arquitectura auditada

Ver `00-inventario-proyecto/arquitectura.md`. Resumen: NestJS BFF → PostgreSQL/Prisma + XUI LAN + proxy `/playback/media/{ticket}`.

---

## 3. Metodología y herramientas

| Fase | Actividad | Herramientas |
| --- | --- | --- |
| 0 | Inventario | Lectura repo, Mermaid, health |
| 1 | Estática | Código, npm audit, test:cov |
| 2 | Funcional | PowerShell/curl, Cuentas A/B |
| 3 | Seguridad | Revisión + pruebas 401/404/ticket |
| 4 | Rendimiento | Runner Node concurrente (baseline/load/spike/soak/media) |
| 5 | Resiliencia | Sondas API + `docker pause` Postgres local |
| 6 | Regresión | npm test / e2e (también post-carga) |
| 7 | Consolidación | Este documento + resumen ejecutivo |

---

## 4. Resultados por fase

| Fase | Estado |
| --- | --- |
| 0 Inventario | Completada |
| 1 Código | Completada |
| 2 Funcional | Completada (cupo B confirmado) |
| 3 Seguridad | Completada (sin ZAP/Trivy) |
| 4 Rendimiento | **Completada** — métricas en `04-rendimiento/` |
| 5 Resiliencia | **Completada** con lab local PG; XUI prod no tumbar |
| 6 Regresión | Completada — verde pre y post carga |
| 7 Cierre | Completada |

---

## 5. Hallazgos consolidados — prioridad desarrollo

1. Tickets media (persistencia, TTL, revocación) — HIGH  
2. Fail-safe cupo si XUI omite max — HIGH  
3. MFA login enforcement — HIGH  
4. SSRF redirects media/playback — HIGH  
5. **Proxy media 503 @ 25 VU (PERF-001)** — HIGH  
6. Rate limit distribuido / calibración; ready timeout PG; CORS; race QR — MEDIUM  
7. Cobertura / OpenAPI — LOW–MEDIUM  

Detalle: `01-auditoria-codigo/hallazgos.md`, `03-seguridad/vulnerabilidades.md`, `04-rendimiento/*`, `05-resiliencia/informe-resiliencia.md`.

---

## 6. Evidencias clave (sin secretos)

- Health live/ready 200; post-carga ready OK.  
- Baseline p95: health ~211 ms, catalog ~335 ms, media ~283 ms.  
- Catalog c=20: 80×200, p95 ~1.2 s; c=40: 25 % 429.  
- Media c=10: 50×200; c=25: **49×503**.  
- Spike health 80: 80×429.  
- B: used/limit **15/15**; QR approve **403 DEVICE_LIMIT**.  
- A: limit **null**, used ≥16.  
- Lab local: PG pause → live 200, ready timeout ~8 s; unpause → ready 200.  
- Unit 63 PASS; e2e 12 PASS; coverage statements 72.48% (reconfirmado post-carga).

---

## 7. Riesgos residuales

- Capacidad multi-IP / multi-nodo no medida.  
- Tickets multi-réplica.  
- IDOR cross-user no agotado con dos usuarios.  
- Panel XUI Never Expire no contrastado visualmente.  
- FCM `device_inactive` no E2E.  
- Caos XUI producción no inducido.

---

## 8. Pruebas no ejecutadas y motivos

| Prueba | Motivo |
| --- | --- |
| 1000–10 000 VU | Saturación ya observada a ≤40 VU; riesgo injustificado |
| Tumbar XUI/PG producción | Prohibido — impacto clientes |
| Trivy/ZAP/Gitleaks | Herramientas no disponibles en estación |
| Acceso directo `10.10.0.31:3100` | Red no alcanzable |
| CPU/RAM/pool PG del host prod | Sin SSH/métricas |

---

## 9. Respuestas explícitas (cierre §12 del mandato)

### ¿El backend funciona correctamente en los flujos críticos?
**Sí** en el entorno de pruebas: login → me/devices/subscription → catálogo → authorize → proxy HLS → logout. Reservas HIGH (tickets, cupo A, 503 media bajo carga).

### ¿Qué defectos confirmados existen?
CODE-001/003/008/009/010, PERF-001, RES-001/002/003, más MEDIUM/LOW en hallazgos.

### ¿Qué vulnerabilidades fueron confirmadas?
SEC-001 (ticket público longevo), SEC-002 (cupo A), SEC-005/006/007 (SSRF/MFA/redirects). Ver `vulnerabilidades.md`.

### ¿Qué riesgos de seguridad siguen abiertos?
Rate limit no distribuido; advisory Prisma; IDOR no agotado; binding de ticket; secretos en logs de servidor no inspeccionados.

### ¿Qué capacidad estable se midió para API?
**~10–20 VU concurrentes por IP** sin errores en `/catalog/home`; p95 0.4–1.2 s. Techo por **429** global ~25–40 VU.

### ¿Qué capacidad estable se midió para reproducción?
**~10 VU** sobre el mismo ticket HLS sin errores; a **25 VU** predomina **503** (errorRate 0.65).

### ¿Qué ocurre con la Cuenta A (100000 configurado)?
Login OK; API expone **maxConnections/maxDevices = null**; devices used ≥16. El “100000” **no es enforceable** vía backend observado.

### ¿Qué ocurre con la Cuenta B (15)?
API refleja **15**; devices **15/15**. Login adicional **desplaza** (200). QR approve con cupo lleno → **403 DEVICE_LIMIT** (used=15, limit=15).

### ¿Se respetan los límites de conexiones de XUI?
**Dispositivos COTAS:** sí para B (approve); no para A (null). Unidad = dispositivos ACTIVE, no streams HTTP. Contador de streams XUI no saturado en esta campaña.

### ¿Dónde están los cuellos de botella?
1) `GLOBAL_RATE_LIMIT` / SensitiveRateLimit → 429.  
2) Proxy media → **503 @ 25 VU**.  
3) Candidato upstream XUI (no instrumentado en host).

### ¿Cómo responde ante fallos de PostgreSQL y XUI?
PG (lab local): live sigue OK; ready **cuelga ~timeout**; recupera tras unpause. XUI prod: no tumbar; timeouts tipados cubiertos en tests. Tickets no sobreviven restart API.

### ¿Qué pruebas no pudieron ejecutarse y por qué?
Ver §8.

### ¿Nivel de preparación para producción?
**Apto condicional** para piloto/pruebas controladas.  
**No apto** como producción endurecida con capacidad/seguridad de media y cupos demostrados hasta cerrar HIGH.

---

## 10. Recomendaciones priorizadas

| Prioridad | Acción |
| --- | --- |
| P0 | Ticket store Redis, TTL corto, revocación |
| P0 | Fail-safe maxDevices si XUI omite max |
| P0 | Investigar/mitigar 503 del proxy media bajo concurrencia |
| P0 | MFA + cerrar SSRF redirects |
| P1 | Rate limiting distribuido / calibración QA |
| P1 | Ready con timeout estricto ante PG down |
| P2 | Cobertura; chaos XUI en staging; OpenAPI completo |

---

## 11. Conclusión técnica

El BFF IPTV **cumple el camino feliz** y ahora cuenta con **evidencia cuantitativa de carga y resiliencia**. Los impedimentos principales para producción robusta son **diseño de sesión de media**, **cupo inconsistente con XUI (Cuenta A)**, **saturación del proxy a 25 VU** y controles MFA/SSRF.  

El auditor **no aplicó correcciones**. Siguiente paso: desarrollo/infra según `backend/docs/AUDITORIA/`.
