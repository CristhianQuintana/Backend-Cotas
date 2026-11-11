# Implementación backend: novedades del catálogo

**Estado:** implementación local en el árbol de trabajo. No se aplicó la migración a una base desplegada ni se comprobó XUI real.  
**Alcance:** backend NestJS/PostgreSQL/Prisma; la app Flutter genera notificaciones locales. No se envía FCM por anuncios de catálogo.

## Arquitectura y flujo

1. `CatalogSyncService` valida la línea de sonda y obtiene las seis listas XUI ya utilizadas por el worker.
2. Para cada serie obtiene `getSeriesInfo`, con concurrencia limitada a un máximo de cuatro (o el valor menor de `catalogSyncConcurrency`). Esto aporta descripciones y episodios; cada episodio queda asociado a su serie, temporada y número.
3. El worker no modifica caché ni snapshots de anuncios hasta terminar todas las llamadas XUI requeridas. Si una consulta falla, lanza el error para que BullMQ reintente; no registra un inventario incompleto.
4. `CatalogAnnouncementsService.detectAndPersist` compara los inventarios completos con `catalog_content_snapshots` y persiste novedades y snapshots en una transacción PostgreSQL.
5. Flutter consulta `GET /api/v1/catalog/announcements` con su access token y presenta avisos mediante notificaciones locales. El backend no envía FCM en esta ruta.

La primera sincronización completa siembra el baseline sin anunciar todo el catálogo existente. En sincronizaciones siguientes se avisan altas. Un recurso que desaparece del inventario vigente marca sus anuncios anteriores `available: false`; los anuncios no disponibles se excluyen del endpoint. Si reaparece, vuelve a estar disponible sin crear un anuncio duplicado.

## Detección y deduplicación

- Película: `kind=vod`, ID de stream XUI.
- Serie: `kind=series`, ID de serie XUI.
- Episodio: `kind=episode`, ID de episodio más ID de serie. La clave estable es `kind:seriesId:contentId`, dado que el ID de episodio puede repetirse en otra serie.
- La clave `dedupe_key` tiene restricción `UNIQUE`; los snapshots conservan claves conocidas y la escritura usa `skipDuplicates` como defensa adicional.
- Una fila contiene hora de detección (`created_at`), tipo, título, poster, descripción, fecha de publicación si se conoce, disponibilidad y datos de serie/episodio.
- XUI no entrega fecha de publicación en los modelos usados actualmente; `publishedAt` queda `null`. Las listas de películas no incluyen descripción, por lo que queda `null`. La descripción de serie y episodio procede de `getSeriesInfo`.

## Cursor y atomicidad de lectura

`catalog_announcement_cursors` contiene un contador transaccional. El sincronizador toma un `FOR UPDATE` antes de leer snapshots, inserta las novedades y actualiza el contador dentro de la misma transacción. Así los anuncios quedan ordenados respecto del high-watermark incluso con workers concurrentes. El endpoint fija un `syncCursor` al iniciar una consulta y `nextCursor` pagina hacia atrás dentro de ese límite. Los anuncios agregados durante la paginación tienen una secuencia superior y aparecen en la siguiente sincronización.

Para evitar omisiones, Flutter conserva el mismo `since` mientras consume todas las páginas, pasa `nextCursor` y recién al terminar reemplaza `since` por el `syncCursor` final. Debe guardar cursores por filtro `type` si consulta cada tipo por separado; lo más simple es consultar todos los tipos juntos.

## Modelos y cambios

- `CatalogContentSnapshot`: snapshot por proveedor y recurso existente.
- `CatalogAnnouncement`: ampliado con secuencia, clave única, serie/temporada/episodio, poster, descripción, fecha de publicación y disponibilidad.
- `CatalogAnnouncementCursor`: contador de sincronización transaccional.
- Migración nueva: `prisma/migrations/20261111120000_catalog_local_announcements/migration.sql`. Es aditiva y deduplica datos históricos antes de crear el índice único.
- `CatalogSyncService`: consulta episodios, limita concurrencia y solo persiste tras una sincronización íntegra. Se quitó el envío de FCM de esta funcionalidad.
- `CatalogAnnouncementsService`: diff, persistencia atómica, actualización de disponibilidad y consulta incremental.
- `CatalogAnnouncementsQueryDto` y `CatalogController`: validación de límite, tipo y cursores. La ruta queda protegida por los guards globales `AccessTokenGuard` y `RolesGuard`.
- FCM permanece disponible para eventos de dispositivos, fuera del flujo de anuncios del catálogo.

## API

Contrato completo, errores, navegación y ejemplos: [`CONTRATO_API_NOTIFICACIONES_FLUTTER.md`](CONTRATO_API_NOTIFICACIONES_FLUTTER.md). Instrucciones Flutter: [`INSTRUCCIONES_DEV_FLUTTER_NOTIFICACIONES.md`](INSTRUCCIONES_DEV_FLUTTER_NOTIFICACIONES.md).

## Evidencia de pruebas locales

- `npx prisma validate --schema prisma/schema.prisma`: correcto.
- `npx prisma generate --schema prisma/schema.prisma`: correcto.
- `npm run build`: correcto después de estos cambios.
- `npm run lint`: correcto.
- Pruebas unitarias focalizadas de diff, paginación/consulta y sincronización: 3 suites, 8 pruebas aprobadas. Incluyen nuevas películas/series/episodios, episodio repetido en distintas series, filtro, continuidad de cursor y fallo XUI sin persistencia/caché parcial.
- Suite unitaria completa (`npm test`): 24 suites, 72 pruebas aprobadas.
- Suite E2E (`npm run test:e2e`): 1 suite, 12 pruebas aprobadas; incluye autorización del endpoint de anuncios.
- `npm run test:integration`: 1 suite, 6 pruebas omitidas porque `RUN_DB_INTEGRATION` no está habilitado. El test de persistencia de anuncios está implementado para una base PostgreSQL de pruebas migrada.
- La prueba usa dobles; no demuestra conexión a una instancia XUI ni escritura en PostgreSQL.
- La migración no se aplicó aquí a ninguna base.

## Limitaciones / puesta en operación

1. Debe desplegarse primero la migración nueva y luego el worker/API con esta versión. No ejecutar la migración desde esta auditoría contra producción.
2. Cada ciclo solicita detalle de todas las series. La concurrencia está limitada, pero el tiempo y cuota real de XUI deben medirse en staging; un timeout deja snapshots intactos y BullMQ reintenta.
3. El primer inventario posterior al despliegue es baseline y no notifica episodios que ya existían. Solo altas posteriores se consideran nuevas.
4. No se ejecutó una prueba de extremo a extremo contra XUI real → PostgreSQL real → API autenticada con contenido de prueba. Por eso no se declara validado en entorno desplegado.
5. Las preferencias por tipo y la generación de notificaciones locales son responsabilidad de Flutter; el backend expone filtros pero no recibe preferencias.
