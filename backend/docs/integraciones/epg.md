# EPG para plataformas (Android TV, Tizen, web, móvil)

El backend de COTAS expone la guía electrónica de programación (EPG) a partir de XUI. Las apps **no** deben llamar a `player_api.php` de XUI para EPG: usan solo la API COTAS con el token de sesión.

## Qué hace el backend

1. Autentica al usuario (Bearer).
2. Resuelve la línea IPTV del abonado.
3. Consulta XUI `get_short_epg` (con `limit`).
4. Normaliza títulos (Base64), marcas de tiempo a ISO-8601 UTC y calcula `now` / `next`.
5. Cachea en memoria + Redis (`CATALOG_EPG_CACHE_TTL_SECONDS`, por defecto 120 s) para no repetir la misma consulta a XUI.

La reproducción del vídeo **no** pasa por estos endpoints; sigue el flujo de autorización de playback.

## Autenticación

```http
Authorization: Bearer <accessToken>
```

Obtenga el token con `POST /api/v1/auth/login` (cliente IPTV) o el flujo de personal del panel. Sin token → `401`.

Base URL de pruebas típica: `http://10.10.0.31:3100/api/v1` (ajustar host/puerto según entorno).

## Endpoints

### 1. EPG de un canal (detalle / barra “ahora”)

```http
GET /api/v1/catalog/live/streams/{streamId}/epg?limit=12
```

| Parámetro | Obligatorio | Descripción |
| --- | --- | --- |
| `streamId` | Sí | Identificador del canal en vivo (mismo `id` de `GET .../live/streams`) |
| `limit` | No | 1–50 programas (por defecto 12) |

**Respuesta 200**

```json
{
  "streamId": "101",
  "generatedAt": "2026-10-29T14:30:00.000Z",
  "now": {
    "id": "9",
    "title": "Noticias mediodía",
    "description": "Resumen",
    "start": "2026-10-29 14:00:00",
    "end": "2026-10-29 15:00:00",
    "startAt": "2026-10-29T14:00:00.000Z",
    "endAt": "2026-10-29T15:00:00.000Z"
  },
  "next": { "...": "..." },
  "items": [ { "...": "..." } ]
}
```

| Campo | Uso en la UI |
| --- | --- |
| `now` | Programa en emisión (o el primero si XUI no envía tiempos fiables) |
| `next` | Siguiente programa |
| `items` | Lista ordenada para scroll de guía del canal |
| `start` / `end` | Texto original de XUI (opcional mostrar tal cual) |
| `startAt` / `endAt` | ISO-8601 UTC para barras de progreso y locales del dispositivo |
| `generatedAt` | Momento del cálculo en el servidor |

`now` o `next` pueden ser `null`. Lista vacía con canal válido → `200` (sin inventar programas). Canal inexistente → `404`.

### 2. EPG por lotes (rejilla de guía)

```http
GET /api/v1/catalog/live/epg?streamIds=101,102,103&limit=8
```

| Parámetro | Obligatorio | Descripción |
| --- | --- | --- |
| `streamIds` | Sí | Hasta **20** ids separados por coma |
| `limit` | No | Programas por canal (1–50, por defecto 12) |

**Respuesta 200**

```json
{
  "generatedAt": "2026-10-29T14:30:00.000Z",
  "channels": [
    {
      "streamId": "101",
      "generatedAt": "2026-10-29T14:30:00.000Z",
      "now": { "...": "..." },
      "next": { "...": "..." },
      "items": []
    }
  ]
}
```

Los ids que el abonado no tiene en su lista de canales se omiten (no fallan el lote). El backend limita la concurrencia hacia XUI.

### 3. Cómo armar la guía completa

Flujo recomendado en todas las plataformas:

1. `GET /api/v1/catalog/live/categories` → pestañas.
2. `GET /api/v1/catalog/live/streams?categoryId=...&page=1&limit=50` → filas de canales (`id`, `name`, `iconUrl`, `epgChannelId`).
3. Para la rejilla visible: `GET /api/v1/catalog/live/epg?streamIds=<ids visibles>&limit=8`.
4. Al enfocar un canal: `GET /api/v1/catalog/live/streams/{id}/epg?limit=24` para más detalle.
5. Refresco: cada 1–2 minutos o al cambiar de categoría; respetar caché del servidor (TTL ~2 min).

No descargue EPG de **todos** los canales de una vez: pagine por categoría y solo pida los ids en pantalla (+ margen).

## Ejemplo (TypeScript / fetch)

```ts
async function loadGuide(baseUrl: string, token: string, streamIds: string[]) {
  const qs = new URLSearchParams({
    streamIds: streamIds.join(','),
    limit: '8',
  });
  const response = await fetch(`${baseUrl}/catalog/live/epg?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`EPG HTTP ${response.status}`);
  }
  return response.json() as Promise<{
    generatedAt: string;
    channels: Array<{
      streamId: string;
      now: { title: string; startAt: string | null; endAt: string | null } | null;
      next: { title: string } | null;
      items: unknown[];
    }>;
  }>;
}
```

Progreso “en emisión” en cliente:

```ts
function progressPercent(now: { startAt: string | null; endAt: string | null }, at = Date.now()) {
  if (!now.startAt || !now.endAt) return null;
  const start = Date.parse(now.startAt);
  const end = Date.parse(now.endAt);
  if (!(end > start) || at < start) return 0;
  if (at >= end) return 100;
  return Math.round(((at - start) / (end - start)) * 100);
}
```

## Errores habituales

| HTTP | Código típico | Qué hacer en la app |
| --- | --- | --- |
| 401 | — | Renovar sesión / login |
| 404 | `NOT_FOUND` | Canal no disponible para la línea |
| 502 | `UPSTREAM_AUTH` | Línea XUI inválida; no reintentar en bucle |
| 503 / 504 | dependencia / timeout | Reintentar con backoff; mostrar “guía no disponible” |

## Qué no hacer

- No llamar a XUI desde la app (credenciales, CORS, formato crudo).
- No cachear EPG en el cliente más de unos minutos sin contrastar con `generatedAt`.
- No usar EPG para autorizar reproducción: use `POST /api/v1/playback/authorizations`.
- No asumir que todos los canales tienen EPG (`epgChannelId` puede ser null y `items` vacío).

## OpenAPI

El contrato se regenera con `npm run openapi:export` en `backend/`. Rutas bajo el tag `catalog`.
