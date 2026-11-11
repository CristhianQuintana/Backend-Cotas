# Contrato API de novedades del catálogo para Flutter

## Endpoint

- **Método:** `GET`
- **URL completa del ambiente evaluado:** `https://api.cotasperu.com/api/v1/catalog/announcements`. Para desarrollo/staging, usar el host configurado para ese ambiente y conservar el path `/api/v1/catalog/announcements`.
- **Autenticación:** `Authorization: Bearer <accessToken>` válido. La ruta está bajo los guards globales de acceso y roles; sin token responde `401`.
- **Content-Type:** `application/json`.
- **No usa FCM.** La app consulta la API y crea notificaciones locales.

Ejemplo:

```http
GET /api/v1/catalog/announcements?limit=40&since=MA
Authorization: Bearer eyJ...
```

`MA` es el ejemplo base64url para el cursor numérico `0`; los cursores reales deben guardarse y reenviarse literalmente.

## Parámetros de consulta

| Parámetro | Tipo | Opcional | Regla |
| --- | --- | --- | --- |
| `limit` | entero | Sí | Por defecto `20`; entre `1` y `100`. |
| `type` | string | Sí | `MOVIE`, `SERIES` o `EPISODE`. Sin filtro devuelve todos. |
| `since` | string | Sí | Cursor de sincronización `syncCursor` guardado por el cliente; exclusivo (solo secuencias posteriores). Si se omite, inicia desde el historial disponible. |
| `cursor` | string | Sí | Cursor de página `nextCursor`, reenviado junto con el mismo `since` y filtro. |
| `page` | entero | Sí | Compatibilidad con clientes anteriores, desde `1`, máximo `10000`. En nuevas integraciones usar `since`/`cursor`; `page` es offset y no ofrece estabilidad ante altas concurrentes. |

Las páginas salen en orden cronológico descendente. Cada consulta fija un high-watermark. Durante el recorrido, pasar `nextCursor` hasta que sea `null`; al terminar guardar `syncCursor` como el próximo `since`. No actualizar `since` a mitad del recorrido. Si se mantienen cursores separados por tipo, también separar el valor local de `since` para cada tipo.

## Respuesta exacta

HTTP `200`:

```json
{
  "items": [
    {
      "id": "c93c9b7e-7a4c-4f9d-8c0e-42fc7c2f3ec0",
      "type": "MOVIE",
      "kind": "vod",
      "contentId": "2002",
      "title": "Película de prueba",
      "posterUrl": "https://media.example/poster.jpg",
      "description": null,
      "detectedAt": "2026-11-11T17:30:00.000Z",
      "createdAt": "2026-11-11T17:30:00.000Z",
      "publishedAt": null,
      "seriesId": null,
      "seasonNumber": null,
      "episodeNumber": null,
      "available": true,
      "detailPath": "/api/v1/catalog/vod/streams/2002"
    }
  ],
  "page": 1,
  "limit": 40,
  "total": 1,
  "hasMore": false,
  "nextCursor": null,
  "syncCursor": "MTc="
}
```

El ejemplo es un fixture de contrato; las pruebas unitarias verifican el mapeo, pero no es una respuesta extraída de XUI o producción. Para no exponer URLs XUI sin firmar, las URLs de imágenes de la API se procesan con el firmador público de medios antes de retornar. Un poster ausente es `null`.

### Campos por anuncio

| Campo | Tipo | Significado |
| --- | --- | --- |
| `id` | UUID string | Identificador estable del anuncio; clave recomendada para deduplicación local. |
| `type` | string | Tipo canónico: `MOVIE`, `SERIES`, `EPISODE`. |
| `kind` | string | Valor legado (`vod`, `series`, `episode`) para mantener compatibilidad con el cliente actual. |
| `contentId` | string | ID de película/serie/episodio en XUI/COTAS. |
| `title` | string | Nombre de contenido entregado por XUI. |
| `posterUrl` | string o `null` | Imagen disponible en XUI, firmada para acceso público del cliente. |
| `description` | string o `null` | Descripción si XUI la expone; puede ser `null`. |
| `detectedAt`, `createdAt` | ISO-8601 UTC string | Fecha de detección por COTAS. `createdAt` es alias legado. |
| `publishedAt` | ISO-8601 UTC string o `null` | Fecha de incorporación/publicación si XUI la informa; actualmente los modelos XUI no la entregan, por eso será `null`. |
| `seriesId` | string o `null` | ID de serie para el anuncio de episodio; `null` para películas/series. |
| `seasonNumber`, `episodeNumber` | entero o `null` | Ubicación del episodio si XUI la informa. |
| `available` | boolean | Disponibilidad observada en la sincronización completa más reciente. Los `false` se omiten del endpoint. |
| `detailPath` | string | Ruta relativa para resolver el detalle; añadirla al host API. En episodios abre el detalle de la serie y el cliente selecciona por `contentId`. |

### Formas por tipo

Los tres ejemplos comparten exactamente el mismo esquema anterior; estos son los campos que cambian en cada forma, con valores de fixtures de prueba:

```json
{"type":"MOVIE","kind":"vod","contentId":"2002","seriesId":null,"seasonNumber":null,"episodeNumber":null,"detailPath":"/api/v1/catalog/vod/streams/2002"}
```

```json
{"type":"SERIES","kind":"series","contentId":"77","seriesId":null,"seasonNumber":null,"episodeNumber":null,"detailPath":"/api/v1/catalog/series/77"}
```

```json
{"type":"EPISODE","kind":"episode","contentId":"9001","seriesId":"77","seasonNumber":2,"episodeNumber":3,"detailPath":"/api/v1/catalog/series/77"}
```

## Sincronización incremental y paginación

1. Primera instalación: llamar sin `since` para leer el historial actualmente disponible (se recomienda persistir el estado y paginar todas las páginas). La respuesta incluye `syncCursor`, el límite superior estable de ese lote.
2. Mientras `hasMore=true`, reenviar el mismo `since`, el filtro y el `nextCursor` de la respuesta previa. El cursor de página es opaco; no construirlo ni editarlo.
3. En la última página (`hasMore=false`, `nextCursor=null`), persistir `syncCursor` como nuevo `since`. Procesar/guardar anuncios localmente antes de avanzar el cursor.
4. En la siguiente consulta enviar ese `since` sin `cursor`; el backend devuelve solo secuencias superiores al cursor guardado. El dispositivo no necesita mandar su hora ni ajustar relojes.
5. Si la app se cierra a mitad de la paginación, conservar el `since` anterior y reiniciar ese lote, deduplicando por `id`.

`syncCursor` es un valor base64url que representa un contador PostgreSQL transaccional, no una fecha del móvil. `nextCursor` conserva el último elemento de página y el high-watermark del lote. El contador serializa las transacciones de sincronización para que anuncios concurrentes no queden detrás de un cursor ya confirmado.

### Sin novedades

HTTP `200`, `items: []`, `hasMore: false`, `nextCursor: null`. Guardar el `syncCursor` recibido: puede haber avanzado aunque el filtro elegido no devolviera anuncios.

## Abrir el contenido

- Película: `GET {API_BASE}/api/v1/catalog/vod/streams/{contentId}`.
- Serie: `GET {API_BASE}/api/v1/catalog/series/{contentId}`.
- Episodio: `GET {API_BASE}/api/v1/catalog/series/{seriesId}`, luego seleccionar el episodio cuyo `id == contentId` (usar `seasonNumber`/`episodeNumber` como apoyo).

Las tres rutas requieren el mismo Bearer token. Son endpoints existentes del catálogo. `detailPath` es relativo al host API, no una URL externa de XUI.

## Errores y operación

| HTTP | Manejo recomendado |
| --- | --- |
| `400` | Parámetros inválidos o cursor malformado; conservar el cursor previo y reportar error de cliente. |
| `401` | Renovar sesión por el flujo común de autenticación y repetir una sola vez. |
| `403` | La cuenta no está autorizada; no repetir automáticamente. |
| `429` | Respetar `Retry-After` si está presente y aplicar backoff. |
| `5xx` / error de red | Conservar el cursor; reintentar con backoff al recuperar conectividad. |

El endpoint no solicita detalles a XUI; lee anuncios persistidos. El worker realiza la sincronización en segundo plano. Como pauta inicial, consultar al iniciar/volver a foreground y luego cada 15–30 minutos mientras la app esté activa, con jitter y backoff. El sistema móvil limita las tareas en background; Flutter debe usar su mecanismo de trabajo programado, no esperar ejecución continua.

El endpoint acepta `limit` máximo 100 para controlar tamaño. Debe autenticarse; nunca consultar con credenciales XUI ni usar URLs directas XUI desde la app.
