# Instrucciones Flutter: notificaciones locales de contenido nuevo

Estas instrucciones describen la integración con el backend, sin cambios al backend desde la app y sin FCM para anuncios de catálogo. La app Flutter ya incluye `flutter_local_notifications` y `LocalNotificationService`, usado hoy para recordatorios; se recomienda extenderlo para soportar avisos inmediatos de catálogo y no reutilizar la programación de recordatorios como si fuera un aviso de novedad.

## 1. Cliente API

Añadir al cliente/repository autenticado de catálogo una consulta a:

```http
GET {API_BASE}/api/v1/catalog/announcements?limit=50&since={savedCursor}[&cursor={nextCursor}][&type=MOVIE]
Authorization: Bearer {accessToken}
```

Usar el mismo transporte que `CatalogApi` para renovación/reintento de access token. El DTO/documentación definitiva está en [`CONTRATO_API_NOTIFICACIONES_FLUTTER.md`](CONTRATO_API_NOTIFICACIONES_FLUTTER.md). Parsear `id`, `type`, `contentId`, `title`, `posterUrl`, `description`, `detectedAt`, `available`, `seriesId`, `seasonNumber`, `episodeNumber` y `detailPath`; aceptar valores opcionales nulos.

## 2. Estado local y cursores

Persistir con `SharedPreferences` o el store persistente ya usado por la app:

- `catalogAnnouncements.syncCursor`: último `syncCursor` **completamente procesado**.
- `catalogAnnouncements.pageCursor` y `catalogAnnouncements.pendingSyncCursor`: estado opcional para reanudar paginación interrumpida.
- `catalogAnnouncements.processedIds`: conjunto/LRU de IDs procesados y/o notificados. Poner retención acotada (por ejemplo, últimos 2.000 IDs) y deduplicar por `id`, nunca solo por `contentId` (el ID XUI puede repetirse entre series).
- Preferencias locales separadas para película, serie y episodio. El backend no tiene actualmente un endpoint para preferencias de notificación; respetar las preferencias locales existentes/ajustes de app. No enviar preferencia al backend porque no forma parte del contrato.

Al comenzar una consulta incremental conserva el `since` actual. Mientras `hasMore` sea verdadero, acumula/procesa `items` y envía el mismo `since` junto con `nextCursor`. Tras la última página, persiste el `syncCursor` recibido como el nuevo `since`. Si falla una página, no avances el cursor y reintenta luego; los IDs locales previenen una segunda notificación si la página anterior sí se procesó. `syncCursor` no es hora local, no analizarlo ni generarlo.

En primera instalación puedes recorrer el historial desde el cursor inicial. Para evitar notificaciones locales masivas de títulos antiguos, acuerda el comportamiento de onboarding: una opción usual es marcar el primer lote como leído (actualizar cursor después de guardar los items, sin mostrar notificaciones), y notificar solo anuncios que lleguen en consultas posteriores. Esta decisión es de UX; conservar el listado/badge aunque se silencien notificaciones iniciales.

## 3. Cuándo consultar

- Al iniciar sesión/abrir catálogo, después de tener access token.
- Al volver a foreground (`AppLifecycleState.resumed`).
- Cuando el monitor de conectividad reporte reconexión.
- Periódicamente mientras esté activa: pauta inicial 15–30 minutos con jitter, backoff para errores y sin consultas paralelas.
- Para background, usar mecanismo programado compatible con plataforma (Android WorkManager mediante plugin existente si aplica). Android no garantiza ejecución exacta ni periódica frecuente; la siguiente apertura/foreground debe recuperar todos los avisos pendientes usando el cursor.

No crear un timer continuo en background. No consultar más rápido que cada 15 minutos sin acuerdo operativo.

## 4. Crear notificación local

Reutiliza/incrementa `LocalNotificationService` (`lib/features/notifications/local_notification_service.dart`): inicialización única, canal Android dedicado `cotas_catalog_v1`, importancia alta, sonido/vibración según los ajustes de usuario y comprobación de permisos. No reuses el canal de recordatorios: su categoría, audio y alarmas exactas son distintos.

Antes de presentar un aviso:

1. Validar `available == true`.
2. Comprobar si `id` ya está procesado.
3. Comprobar la preferencia local para `type`.
4. Solicitar permiso de notificaciones en un contexto de UX apropiado; si fue denegado, guardar/avanzar el cursor igualmente y conservar la novedad en el inbox/badge para que no se reprograme indefinidamente.
5. Elegir texto: `MOVIE` → “Nueva película”; `SERIES` → “Nueva serie”; `EPISODE` → “Nuevo episodio”. `title` del aviso es el nombre XUI; usar un fallback si está vacío.
6. Usar un ID entero determinista derivado de UUID `id` (hash estable de 32 bits positivo) para que el plugin reemplace/deduzca el mismo aviso; guardar el UUID completo en payload JSON del tap.
7. Persistir `id` como procesado solo después de que la app haya aceptado la operación local o registrar el resultado según la semántica del plugin. Un fallo de almacenamiento/presentación debe permitir reintento.

Si hay muchos anuncios acumulados, evitar un toast por ítem: agrupar por tipo o limitar presentación (por ejemplo, aviso resumen) y mantener todos en el inbox/badge. No descartar filas del lote ni avanzar cursor antes de persistir su estado local.

## 5. Abrir el contenido desde el tap

Registrar callback de respuesta de notificación local y guardar `type`, `contentId`, `seriesId`, `seasonNumber`, `episodeNumber` y `announcementId` como payload. Esperar a que el router y la sesión estén listos; luego:

- Película: `GET {API_BASE}/api/v1/catalog/vod/streams/{contentId}` y abrir detalle/reproductor según navegación actual.
- Serie: `GET {API_BASE}/api/v1/catalog/series/{contentId}`.
- Episodio: abrir `GET {API_BASE}/api/v1/catalog/series/{seriesId}`, localizar episodio por `contentId` y usar sus datos/temporada para continuar al reproductor.

Usar Bearer token y rutas del catálogo existentes, no concatenar `posterUrl` en rutas ni pedir datos a XUI directamente. Si el endpoint de detalle devuelve 404/no disponible, informar con UX normal y marcar la novedad como no vigente.

## 6. Foreground, permisos y pruebas Flutter

- Foreground: emitir notificación local o aviso in-app según configuración, sin duplicar ambos si el diseño no lo requiere.
- Background: una notificación local solo puede generarse si la tarea de consulta logra ejecutarse y tiene sesión/red; no prometer entrega inmediata.
- Permiso denegado: seguir actualizando inbox/cursor, conservar badge y permitir activarlo desde Ajustes; no bloquear el catálogo.
- Logout/cambio de cuenta: borrar cursores, IDs procesados o namespacing por `userId` para que no se mezclen cuentas.

Pruebas recomendadas en el cliente: lote vacío; una película/serie/episodio; más de una página; cierre durante paginación; offline y reconexión; reinicio de app; preferencia desactivada por tipo; permiso denegado; IDs duplicados; tap en proceso de inicio de sesión; contenido que ya no está disponible; switching/logout de usuario.

## 7. Estado encontrado en la app inspeccionada

Se encontró `CatalogApi.fetchAnnouncements(page, limit)` y un `LocalNotificationService` basado en `flutter_local_notifications`, actualmente orientado a recordatorios. No se encontró un poller incremental con cursores ni el puente de anuncios de catálogo a notificaciones locales. El desarrollador Flutter debe adaptar el cliente actual del endpoint al contrato con cursores y extender el servicio local; este trabajo no cambia la app Flutter.
