# Hallazgos de código — auditoría estática y dinámica controlada

## Seguimiento de levantamiento — 11 de noviembre de 2026

Tabla histórica del árbol local de mitigaciones. Ver addendum 16-nov abajo para re-medición remota.

## Addendum verificación remota — 16 de noviembre de 2026

Campañas y smoke contra `https://api.cotasperu.com/api/v1`, commit local `113a538`. Suites: **72 unit + 12 e2e PASS**; cobertura statements **≈70%**.

| Hallazgo | Estado 16-nov | Evidencia |
|---|---|---|
| CODE-003 cupo A null | **RESUELTO en API pública** | Cuenta A: `maxConnections=10000`, `devices.limit=10000` |
| PERF-001 media 503 | **CONFIRMADO / empeorado con tickets independientes** | Estable **5 VU**; **503 desde 10 VU** |
| PERF-002 rate limit | **CONFIRMADO** | Catalog estable 20 VU; 30 VU → 56% 429; soak paced 3.5 RPS sin errores |
| PERF-003 tickets 404 intermitentes | **NUEVO / ABIERTO** | Lote 12 tickets → 75% 404; retest 5 tickets 100% 200 |
| NOTIF catálogo | **BACKEND LISTO; APP PENDIENTE** | `GET /catalog/announcements` 200 con `MOVIE` + `syncCursor`; Flutter debe poll + notificación local |
| CODE-006 cobertura | **RE-MEDIDO** | ~70% statements (&lt;80%) |

| Hallazgo original | Estado del árbol local (11-nov) | Evidencia/pendiente |
|---|---|---|
| CODE-001 / SEC-001: tickets en memoria, TTL 6 h y acceso bearer | **MITIGADO PARCIALMENTE** | Redis cuando está habilitado, TTL por defecto 900 s y revocación al logout del usuario. Fallback en memoria aún existe si Redis falla/deshabilitado; falta validar persistencia, multiinstancia y revocación de sesión/device en staging. |
| CODE-002 / SEC-004: rate limit por proceso | **MITIGADO PARCIALMENTE** | Usa Redis cuando está disponible; conserva fallback local. Barrido periódico de claves vencidas añadido. Falta ensayo con Redis down y más de una réplica. |
| CODE-003 / SEC-002: máximo XUI ausente produce cupo nulo | **CORREGIDO EN CÓDIGO + VALIDADO EN API 16-nov** | Parser/fail-safe en código; API pública expone 10000 para Cuenta A. |
| CODE-008 / SEC-006: login de staff no exigía MFA | **CORREGIDO EN CÓDIGO** | Login requiere TOTP/recovery y exige enrolamiento MFA al staff que aún no lo tiene; E2E local PASS. Falta validar con cuenta staff autorizada en staging. |
| CODE-009 / SEC-005: redirects de `/media/asset` | **CORREGIDO EN CÓDIGO, VALIDACIÓN DE RED PENDIENTE** | Redirect manual, límite de saltos y comprobación por host/origen; redirecciones a otra IP privada no allowlisted se rechazan. Se añadió validación de puerto no estándar. Falta prueba dinámica controlada. |
| CODE-010 / SEC-007: redirect de playback fuera de allowlist | **CORREGIDO EN CÓDIGO, VALIDACIÓN DE RED PENDIENTE** | Cada salto y puerto se valida antes de resolver/proxificar; hay límite de saltos. Unit tests locales PASS. |
| CODE-011: carrera de approve device-link | **MITIGADO PARCIALMENTE** | `markApproved` usa actualización condicional PENDING y revoca el slot si pierde la carrera. Claim de dispositivo y actualización del challenge no forman una sola transacción; falta prueba concurrente y confirmar rollback seguro para dispositivo existente. |
| CODE-012: CORS excluía PUT/PATCH | **CORREGIDO EN CÓDIGO** | Métodos PUT/PATCH añadidos; preflight de despliegue no probado. |
| PERF-001: 503 de proxy a 25 VU | **RE-MEDIDO 16-nov** | Con tickets independientes: estable 5 VU; 503 desde 10 VU. |
| CODE-013: OpenAPI diverge de controladores | **ABIERTO** | No se regeneró el documento OpenAPI. |
| CODE-006: cobertura | **≈70% (16-nov)** | Bajo objetivo 80%. |

### NOTIF-001 — Flutter no registra un token FCM ni maneja mensajes de catálogo

- Fecha: 2026-11-11
- Plataforma/módulo: Integración backend–Android móvil / catálogo–notificaciones
- Archivos revisados: backend `CatalogSyncService`, `CatalogAnnouncementsService`, `FcmPushService`, `DevicesController`; Flutter `lib/app/cotas_app.dart`, `lib/features/notifications/push_device_api.dart`, `pubspec.yaml`
- Clasificación: CONFIRMED DEFECT de integración (código cliente disponible); envío productivo requiere verificación
- Severidad: HIGH para la funcionalidad solicitada
- Estado: abierto en la app móvil; backend implementa generación/envío bajo configuración
- Entorno: revisión estática local; no se envió push real
- Evidencia: backend detecta IDs nuevos de `vod-streams` y `series`, persiste anuncios y llama FCM si `FCM_ENABLED` y credenciales están activos; existe `/devices/push-token`. En Flutter, `_onAuthenticated()` invoca `PushDeviceApi.register()` sin `pushToken`; `register()` retorna sin llamar al backend cuando el token es nulo. No se encontró `firebase_messaging`, lectura de token ni listeners `onMessage`/`onMessageOpenedApp`.

**Veredicto funcional:** la detección y el envío están implementados en backend, pero el flujo extremo a extremo **no está conectado en la app Flutter inspeccionada**. Eso explica la ausencia de notificación en ese teléfono, salvo que otro mecanismo cliente independiente no visible aquí la implemente.

**Condiciones adicionales:** `FCM_ENABLED` figura en `false` en `.env.example`; configuración efectiva no verificada. La primera sincronización siembra el snapshot sin avisar; luego el worker detecta altas por ID según la periodicidad configurada. Las preferencias no se persisten ni consultan en backend y se envía a todos los tokens activos. Episodios nuevos no se detectan individualmente por el sync actual.

**Cambio backend en este seguimiento:** FCM agrupa varias películas como “Nuevas películas” y conserva IDs en `data.contentIds`; una sola película usa “Nueva película”. El DTO de `PUT /devices/push-token` acepta ahora `appVersion` y `deviceModel` opcionales enviados por el wrapper Flutter. Pruebas locales validan contrato y payload, no entrega real a FCM.

**Recomendación:** integrar Firebase Messaging en Flutter, obtener y registrar el token por `PUT /api/v1/devices/push-token`, renovar cuando cambie, manejar mensajes foreground/background/tap y consultar `GET /api/v1/catalog/announcements` para datos del título. Acordar si las preferencias se envían al backend o si el cliente recibe data-only y decide localmente qué presentar.

**Limitaciones:** no se modificó el repo Flutter ni hubo dispositivo/configuración Firebase de prueba o autorización de push real.

- **Fecha:** 2026-11-11 (UTC-5)
- **Commit:** `8fa5549`
- **Entorno de código:** repositorio local
- **Entorno dinámico:** `https://api.cotasperu.com/api/v1` (pruebas)

---

### [CODE-001] Tickets de reproducción almacenados solo en memoria de proceso

- Fecha: 2026-11-11
- Plataforma/módulo: Playback
- Archivo, función o endpoint: `src/modules/playback/infrastructure/playback-media-ticket.store.ts` — `Map` en proceso; TTL por defecto **6 h**
- Clasificación: CONFIRMED DEFECT (diseño / disponibilidad)
- Severidad: HIGH
- Estado: open
- Entorno: código fuente
- Evidencia: `DEFAULT_TTL_MS = 6 * 60 * 60 * 1000`; store no usa Redis/PG; comentario del controller dice “corta vida” pero TTL es 6 h.

**Descripción:**  
Los tickets opacos viven en un `Map` local. Un reinicio del proceso o un segundo réplica invalida o no comparte tickets. Además el TTL es largo frente a la descripción de “corta vida”.

**Precondiciones:** Backend en ejecución; autorización de playback exitosa.

**Pasos de reproducción:**  
1. Revisar `PlaybackMediaTicketStore.issue`.  
2. Observar ausencia de persistencia compartida.  
3. Comparar con comentario en `playback.controller.ts`.

**Resultado esperado:** Ticket de corta vida, revocable y compartido entre instancias si hay horizontal scaling.

**Resultado obtenido:** Memoria de proceso, TTL 6 h, sin revocación explícita por logout.

**Impacto:** Interrupción de streams ante deploy/restart; inconsistencia multi-instancia; ventana amplia de reutilización del ticket (mitigada por entropía UUID).

**Causa raíz:** Store efímero sin backend compartido ni TTL alineado a la política documentada.

**Recomendación para desarrollo:** Persistir tickets (Redis) con TTL corto (p. ej. minutos), invalidar al logout del usuario y documentar el TTL real.

**Limitaciones o información pendiente:** No se midió comportamiento con N réplicas en el cluster real.

---

### [CODE-002] Rate limit sensible en memoria por proceso (no distribuido)

- Fecha: 2026-11-11
- Plataforma/módulo: Common / Identity / Playback
- Archivo, función o endpoint: `src/common/guards/sensitive-rate-limit.guard.ts`
- Clasificación: POTENTIAL RISK
- Severidad: MEDIUM
- Estado: open
- Entorno: código + prueba dinámica parcial
- Evidencia: `Map` local `hits`; ráfagas login/authorize producen **429**; carga catalog/health también choca con `GLOBAL_RATE_LIMIT` (~300/min).

**Descripción:**  
El límite sensible no se comparte entre instancias y puede bloquear pruebas/usuarios legítimos o ser eludido con muchas IPs/instancias.

**Impacto:** Falsos positivos 429; protección desigual en despliegue multi-nodo.

**Recomendación para desarrollo:** Rate limit distribuido (Redis) alineado con `ThrottlerGuard`.

**Limitaciones:** No se inspeccionó la configuración exacta de `SENSITIVE_RATE_*` en el servidor de pruebas (sin lectura de secretos).

---

### [CODE-003] Cupo de dispositivos nulo cuando XUI no reporta max_connections

- Fecha: 2026-11-11
- Plataforma/módulo: Identity / Subscription
- Archivo, función o endpoint: `GET /account/subscription`, `GET /auth/me`, `claimDeviceSlot`
- Clasificación: CONFIRMED DEFECT (comportamiento observable)
- Severidad: HIGH
- Estado: open
- Entorno: api.cotasperu.com — Cuenta A
- Evidencia: Tras login Cuenta A: `maxConnections`/`maxDevices` **null**; `activeDevices`/`used` = 14; `limit` en `/devices` vacío/null. Cuenta B sí reportó `maxConnections=15`.

**Descripción:**  
Si el snapshot XUI no trae tope, el backend trata el cupo como ilimitado (`maxDevices: null`), permitiendo acumulación de dispositivos ACTIVE.

**Impacto:** Crecimiento de aparatos “fantasma”/reales sin tope; contador de perfil incompleto; divergencia vs límite configurado en panel XUI (p. ej. 100000) no reflejado en API.

**Recomendación para desarrollo:** Mapear explícitamente el límite XUI; fallback seguro (rechazar o tope local) si el campo falta; alertar inconsistencia.

**Limitaciones:** No se verificó el valor exacto en el panel XUI de Cuenta A (sin acceso UI).

---

### [CODE-004] Proxy multimedia público con solo conocimiento del ticket

- Fecha: 2026-11-11
- Plataforma/módulo: Playback
- Archivo, función o endpoint: `GET /playback/media/:ticketId` (`@Public`)
- Clasificación: POTENTIAL RISK / diseño aceptado con reservas
- Severidad: MEDIUM
- Estado: open
- Entorno: código + prueba: media HTTP 200 **sin** header Authorization
- Evidencia: Respuesta HLS `#EXTM3U` con ticket obtenido vía authorize; endpoint marcado `@Public`.

**Descripción:**  
Cualquier cliente con la URL del ticket puede consumir el stream hasta expiración. La entropía del id mitiga fuerza bruta, pero no hay binding a IP/dispositivo ni revocación al logout.

**Impacto:** Reenvío de URL / filtrado en logs de cliente podría permitir visionado no autorizado durante la vida del ticket.

**Recomendación:** TTL corto, un solo uso opcional para progressive, binding opcional, revocación al logout, no loguear URLs completas en clientes.

---

### [CODE-005] SensitiveRateLimitGuard usa `request.path` (incluye parámetros)

- Fecha: 2026-11-11
- Plataforma/módulo: Common
- Archivo, función o endpoint: `sensitive-rate-limit.guard.ts` clave `${ip}:${method}:${path}`
- Clasificación: QUALITY OBSERVATION / residual de incidente QR
- Severidad: LOW
- Estado: open (poll QR ya sin este guard; otros endpoints sí)
- Evidencia: Histórico: poll QR se saturaba; actualmente `device-link` poll es `@Public` sin este guard. Authorize y login create session aún pueden verse afectados por path-specific buckets.

**Recomendación:** Clave por ruta de plantilla (`/playback/authorizations`) no por path concreto; monitoreo de 429.

---

### [CODE-006] Cobertura de pruebas unitarias por debajo de referencia 80%

- Fecha: 2026-11-11
- Plataforma/módulo: QA interno
- Archivo, función o endpoint: `npm run test:cov`
- Clasificación: QUALITY OBSERVATION
- Severidad: LOW
- Estado: open
- Evidencia: **All files Statements ~72.48%** (referencia del informe: 80%). Módulos bajos: `fcm-push.service.ts` ~11%, partes de `xui-http.client.ts` ~51%, `session.use-cases.ts` ~50%.

**Impacto:** Regresiones en notificaciones, XUI error paths y logout/presencia menos cubiertas.

**Recomendación:** Priorizar tests en playback ticket store multi-escenario, FCM, y logout/presence.

---

### [CODE-007] Heartbeat y presencia dependen de clientes disciplinados

- Fecha: 2026-11-11
- Plataforma/módulo: Identity devices
- Archivo, función o endpoint: `POST /devices/heartbeat`, scanner 60s en `DevicePresenceNotifier`
- Clasificación: QUALITY OBSERVATION
- Severidad: INFORMATIONAL
- Estado: open
- Evidencia: Heartbeat 204 verificado con token válido; umbral 300 s documentado.

**Descripción:** Sin heartbeat de TV/móvil, todos aparecen `inactive` y pueden generar push `device_inactive`. No es defecto de servidor si el contrato se cumple en apps.

---

### [CODE-008] MFA de staff incompleto: login no exige TOTP y no emite enrollment token

- Fecha: 2026-11-11
- Plataforma/módulo: Identity / auth / MFA
- Archivo, función o endpoint: `login.use-case.ts`; DTO `totpCode`/`recoveryCode`; `signEnrollmentToken` sin callers de producción
- Clasificación: CONFIRMED DEFECT
- Severidad: HIGH
- Estado: open
- Entorno: código fuente (verificado 2026-11-11)
- Evidencia: `loginLocal` emite sesión sin consultar `mfaEnabled`; búsqueda de `signEnrollmentToken(` solo en servicio JWT + specs.

**Descripción:** Endpoints MFA setup/confirm existen, pero el login staff no los integra. Los campos MFA del login son dead code.

**Impacto:** MFA no controla el acceso real de ADMIN/OPERATOR; falsa sensación de seguridad.

**Recomendación para desarrollo:** Si MFA ACTIVE exigir TOTP/recovery; si no enrolado, devolver enrollment token; cablear `signEnrollmentToken` desde login; tests de enforcement.

**Limitaciones:** No se validó con usuario staff MFA en API de pruebas (sin cuenta staff de auditoría).

---

### [CODE-009] SSRF potencial en `/media/asset` por `redirect: 'follow'`

- Fecha: 2026-11-11
- Plataforma/módulo: Media
- Archivo, función o endpoint: `media.controller.ts` — `fetch(..., { redirect: 'follow' })`
- Clasificación: CONFIRMED DEFECT
- Severidad: HIGH
- Estado: open
- Entorno: código fuente
- Evidencia: Allowlist/`shouldProxyMediaHost` solo sobre URL firmada inicial; no se revalida el host tras redirects.

**Impacto:** Si un origen allowlisted redirige a un host interno, el API puede alcanzar recursos no previstos.

**Recomendación:** `redirect: 'manual'` y validar cada hop; limitar hops; bloquear link-local/metadata.

---

### [CODE-010] `resolveStreamUpstream` sigue Location fuera de allowlist al emitir ticket

- Fecha: 2026-11-11
- Plataforma/módulo: Playback
- Archivo, función o endpoint: `resolve-stream-upstream.ts` (`current = next.toString()` sin filtrar hostname)
- Clasificación: CONFIRMED DEFECT
- Severidad: HIGH
- Estado: open
- Entorno: código fuente
- Evidencia: allowlist en construcción de referencia de playback; resolución de redirects no reaplica `xuiAllowedStreamHosts`.

**Impacto:** Ticket puede apuntar a host no previsto; el proxy público lo consume.

**Recomendación:** Validar hostname en cada hop; fallar si sale de allowlist/LAN preferida.

---

### [CODE-011] Race en approve device-link: claim y markApproved no atómicos

- Fecha: 2026-11-11
- Plataforma/módulo: Identity / device-link
- Archivo, función o endpoint: `device-link.use-case.ts` `approve`
- Clasificación: CONFIRMED DEFECT
- Severidad: MEDIUM
- Estado: open
- Entorno: código fuente
- Evidencia: `claimDeviceSlot` luego `markApproved` en pasos separados; doble approve concurrente puede dejar device ACTIVE huérfano.

**Recomendación:** Transacción única / CAS sobre status PENDING con rollback de cupo.

---

### [CODE-012] CORS no declara métodos PUT/PATCH usados por la API

- Fecha: 2026-11-11
- Plataforma/módulo: HTTP / configure-http
- Archivo, función o endpoint: `configure-http.ts` — `methods: ['GET','POST','DELETE','OPTIONS']`
- Clasificación: CONFIRMED DEFECT (interop clientes browser)
- Severidad: MEDIUM
- Estado: open
- Evidencia: Existen `PUT /devices/push-token`, `PATCH /account/reminders/:id`, `PATCH /admin/users/:id`.

**Impacto:** Clientes web/browser pueden fallar preflight en PUT/PATCH.

**Recomendación:** Incluir PUT y PATCH en CORS methods.

---

### [CODE-013] OpenAPI export incompleto respecto a controllers reales

- Fecha: 2026-11-11
- Plataforma/módulo: Documentación contractual
- Archivo, función o endpoint: `openapi/openapi.json` vs controllers
- Clasificación: QUALITY OBSERVATION
- Severidad: LOW
- Estado: open
- Evidencia: faltan device-link, devices, account, catalog/home, playback/media, etc. (inventario [Inventario arquitectura](30baddaa-fd4e-4319-ac26-eef2f7ba0d10)).

**Recomendación:** Regenerar OpenAPI en CI y fallar si diverge de controllers.

---

### [PERF-001] Proxy `/playback/media` satura bajo concurrencia

- Fecha: 2026-11-11; **re-medido 2026-11-16**
- Clasificación: CONFIRMED DEFECT (capacidad)
- Severidad: HIGH
- Estado: open
- Evidencia 16-nov (tickets independientes): c=5 → 40×200; c=10 → 32% **503**. Histórico 1-ticket: 503@25 VU.

**Recomendación:** Aislar proxy media, métricas XUI/Astra, staging multi-IP.

---

### [PERF-002] Rate limit global limita capacidad útil ~20 VU / IP

- Fecha: 2026-11-11; confirmado 2026-11-16
- Severidad: MEDIUM
- Evidencia 16-nov: catalog c=20 errorRate 0; c=30 → 56% 429; soak paced 3.5 RPS → 0 errores.

---

### [PERF-003] Tickets de media con 404 intermitentes tras emisión escalonada

- Fecha: 2026-11-16
- Severidad: HIGH
- Estado: open
- Evidencia: 12 authorize OK; pool media inmediato → 18×404 / 24. Retest 5 tickets → 100% 200. Sospecha multi-instancia / fallback memoria sin Redis compartido.

**Recomendación:** Verificar `REDIS_ENABLED` y store compartido en todas las réplicas; prueba sticky vs non-sticky.

---

## Resumen cuantitativo

### Actualización NOTIF catálogo — 16 de noviembre de 2026

Diseño vigente: **no FCM para novedades de catálogo**. El worker sincroniza XUI → detecta altas → persiste anuncios → la app consulta `GET /api/v1/catalog/announcements` y muestra **notificación local** (“Nueva película” / “Nueva serie” / “Nuevo episodio”).  
Verificado en API pública 16-nov: endpoint **200** con ítems `MOVIE` y `syncCursor`.  
Contrato móvil: `docs/qa/CONTRATO_API_NOTIFICACIONES_FLUTTER.md` e `INSTRUCCIONES_DEV_FLUTTER_NOTIFICACIONES.md`.  
FCM permanece para eventos de dispositivo (sesión/inactive), no para catálogo.

| Severidad | Cantidad (abiertos relevantes) |
| --- | --- |
| CRITICAL | 0 |
| HIGH | PERF-001, PERF-003, tickets/SSRF/MFA residuales según despliegue |
| MEDIUM | 5 (+ PERF-002) |
| LOW | 3 |
| INFORMATIONAL | 1 |
