# Autorización de reproducción

`POST /api/v1/playback/authorizations` comprueba que el canal, la película o el episodio existan para la línea que inició sesión. En series, el episodio tiene que pertenecer a `seriesId` y, si se envió, a `seasonNumber`.

## Respuesta a las apps

La API responde con `delivery: "direct"` y una `streamUrl` bajo el **mismo origen de la API** (p. ej. `https://api.cotasperu.com/api/v1/playback/media/{ticket}`).

El backend resuelve el origen XUI (panel LAN / redirects) y sirve playlist y segmentos mediante proxy de ticket de corta vida. Las apps **no** deben llamar a XUI ni reescribir el host de `streamUrl`.

Campos relevantes: `streamUrl`, `protocolHint` (`hls` | `progressive`), `accessMaterialEmbedded: true`, `expiresAt: null` (caducidad práctica = vigencia de la línea).

## Seguridad

- Solo un cliente autenticado obtiene la referencia.
- El host anunciado por XUI debe estar en `XUI_ALLOWED_STREAM_HOSTS` (el host de `XUI_BASE_URL` se incluye automáticamente).
- El cliente no pide a la API descargar URLs arbitrarias.
- Logs y auditoría no guardan la ruta con credenciales embebidas de XUI.
- Segmentos HLS: `GET /playback/media/{ticket}/seg?p=<path>` (sin JWT; el ticket es el secreto).

## Nginx

Para playlists y TS largos use timeouts altos y `proxy_buffering off` en `/api/v1/playback/media/` (ver `deploy/nginx/api.conf.example`).

## Guía para plataformas

`docs/integraciones/guia-plataformas-api-publica.md`
