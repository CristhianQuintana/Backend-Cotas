# Catálogo Home y rendimiento percibido

**Base:** `https://api.cotasperu.com/api/v1`  
**Auth:** Bearer (salvo `/media/asset`, que va firmado).

## Estado (backend)

| Pedido plataformas | Backend |
| --- | --- |
| `GET /catalog/home` agregado | **Sí** — heroes + rails livianos, caché Redis/memoria |
| Cache-Control + ETag en listados | **Sí** — `private, max-age=60` (home/listas); `304` si `If-None-Match` |
| Gzip/Brotli | **Nginx / edge** (no en Nest). Activar en el proxy delante de la API |
| Listados con campos de grilla | **Sí** — `id`, `name`, `posterUrl`/`iconUrl`, `categoryId`, `year`, `rating` |
| Firma media TTL ≥ 24 h + estable | **Sí** — ventana `MEDIA_ASSET_TTL_SECONDS` (default 86400) |
| `Cache-Control` en `/media/asset` | **Sí** — `public, max-age=…, stale-while-revalidate` |
| CDN + thumbs ≤ 80 KB / WebP | **Ops / pipeline** — no hay object storage de derivados aún |
| EPG batch 50 canales | **Sí** |
| `GET /auth/session` (perfil + suscripción) | **Sí** |

## `GET /catalog/home`

```http
GET /api/v1/catalog/home
Authorization: Bearer <accessToken>
```

```json
{
  "generatedAt": "2026-11-05T16:00:00.000Z",
  "heroes": [{ "id": "100", "name": "Film", "section": "vod", "posterUrl": "https://api…/media/asset?…" }],
  "rails": [
    { "id": "live-featured", "title": "Canales en vivo", "section": "live", "items": [ /* ≤16 */ ] },
    { "id": "vod-featured", "title": "Películas", "section": "vod", "items": [ /* ≤16 */ ] },
    { "id": "series-featured", "title": "Series", "section": "series", "items": [ /* ≤16 */ ] },
    { "id": "genre-20", "title": "Acción", "section": "vod", "items": [ /* ≤12 */ ] }
  ]
}
```

- Tras el sync del worker se invalida la clave `home:v1` para reconstruir con datos frescos.
- Recomendación app: **un** round-trip al home al arrancar; completar resto en background.

## `GET /auth/session`

```json
{ "profile": { "id": "…", "username": "…", "displayName": "…" }, "subscription": { "maxConnections": 3, "…": "…" } }
```

`subscription` puede ser `null` si XUI/caché no responden.

## Imágenes — qué falta fuera del código API

1. CDN delante de `/media/asset` o host `media.*` (Cloudflare/CloudFront).
2. Job al sync XUI: generar `posterThumb` WebP ~300–400 px ≤ 80 KB en object storage.
3. Exponer `posterThumbUrl` / `backdropThumbUrl` cuando existan derivados.

Hasta entonces las apps deben seguir usando `posterUrl` firmado (ahora con TTL 24 h estable para aprovechar caché de TV).

## EPG

`GET /catalog/live/epg?streamIds=id1,id2,…` admite **hasta 50** IDs (antes 20).
