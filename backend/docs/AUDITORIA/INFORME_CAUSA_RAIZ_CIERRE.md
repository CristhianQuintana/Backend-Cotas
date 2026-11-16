# Informe de causa raíz — cierre backend COTAS

**Fecha:** 2026-11-16  
**Rama:** `fix/cierre-backend-auditoria-final`

## PERF-001 — HTTP 503 en proxy multimedia

**Causa raíz:**
1. Tope local `PLAYBACK_PROXY_MAX_CONCURRENT` por defecto en **10**, insuficiente para HLS (1 playlist + N segmentos concurrentes por VU).
2. Rechazo inmediato sin cola al saturar el tope.
3. Propagación directa de 503/502 upstream hacia el cliente sin retry controlado en playlists.
4. Agentes HTTP con `maxSockets` modestos frente al fan-out HLS.

**Solución aplicada:**
- Default concurrente **128** (configurable).
- Cola con espera acotada (2 s) antes de 503 `PLAYBACK_PROXY_SATURATED`.
- Retry único con jitter ante 502/503/504 en playlists.
- Keep-alive agents con `maxSockets: 256`.
- Transferencia de slot a waiters (sin doble conteo).

**Validación pendiente:** campaña de carga en staging post-despliegue (no ejecutada contra producción).

## PERF-003 / tickets Redis

**Causa raíz:** fallback silencioso a `Map` en memoria cuando Redis fallaba o no se inyectaba `REDIS_CLIENT`, generando 404 entre réplicas.

**Solución aplicada:**
- Provider compartido `redisClientProvider` en `AppModule`.
- Tickets **fail-closed** si `REDIS_ENABLED=true` y Redis no está listo (sin memoria compartida falsa).
- Memoria solo con `REDIS_ENABLED=false` (test/single-node).
- TTL default **300 s**; revocación en logout vía `revokeForUser`.

## SEC-004 — rate limit distribuido

**Causa raíz:**
1. `REDIS_CLIENT` no estaba registrado como provider global.
2. `SensitiveRateLimitGuard` usaba `@UseGuards` **sin estar en `providers`**, por lo que Nest no inyectaba Redis (`redis === null`) y el fail-closed devolvía 503 falsos en login.

**Solución:** `RedisModule` global + guard registrado en providers + reintentos de conexión al arranque. Evidencia: clave `ratelimit:sensitive:*` en Redis tras POST login y IT rate-limit A/B.

## SEC-003 — deepmerge-ts / Prisma

**Causa raíz:** advisory en `deepmerge-ts@7` vía `prisma` CLI (`@prisma/config`), no en `@prisma/client` runtime.

**Solución:** `overrides.deepmerge-ts: ^8.0.1` → `npm audit --omit=dev` = **0 vulnerabilidades**.

## NOTIF/FCM catálogo

**Causa raíz:** sync generaba anuncios BD + API poll; FCM solo cubría eventos de dispositivo.

**Solución:** `CatalogPushNotifier` + `notifyCatalogAnnouncements` (vod/series, no episodios/canales) tras `detectAndPersist`.

**Validación pendiente:** recepción en dispositivo real Android (bloqueante externo).
