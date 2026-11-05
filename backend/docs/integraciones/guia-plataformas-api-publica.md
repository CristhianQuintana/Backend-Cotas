# Informe de implementación — API pública COTAS

**Destinatarios:** Android (Flutter), Android TV (Kotlin), Samsung Tizen  
**Base de producción:** `https://api.cotasperu.com/api/v1`  
**Fecha:** 2026-11-04  

Usen este documento (y los enlaces al final). No inventen rutas.

---

## 1. Objetivo

Que cada app funcione desde **cualquier red con Internet** (Wi‑Fi doméstico, datos móviles), sin VPN ni LAN de COTAS.

Flujo obligatorio a validar: **login → catálogo → autorización de reproducción → play** (canal, película y episodio).

---

## 2. Configuración obligatoria

```text
API_BASE_URL = https://api.cotasperu.com/api/v1
```

- Solo HTTPS. Validar certificado TLS del sistema (sin TrustManager permisivos).
- Centralizar la URL (env / BuildConfig / constante única).
- **Prohibido** en builds de producción: `10.10.0.31`, `192.141.98.18:3100`, `localhost`.

### Allowlists / CSP por plataforma

| Plataforma | Acción |
| --- | --- |
| Flutter / Android | Cleartext **off** en release; permitir solo HTTPS a `api.cotasperu.com` |
| Android TV | Igual; hosts de media = el host de `streamUrl` (mismo dominio API) |
| Samsung Tizen | `access` / CSP: `https://api.cotasperu.com` (y `wss` si aplica). CORS lo gestiona el backend |

---

## 3. Autenticación

```http
POST /auth/login
Content-Type: application/json

{
  "username": "<linea>",
  "password": "<clave>",
  "deviceId": "<uuid-estable-del-aparato>",
  "platform": "android"
}
```

Respuesta típica: `accessToken`, `refreshToken`, `expiresIn`, `tokenType`.  
`deviceId` estable es **recomendado** (UUID o id de instalación). Si falta, el login sigue funcionando con huella de User-Agent. Cupo = `maxConnections`; detalle en `docs/integraciones/cuenta-y-notificaciones.md`.

```http
Authorization: Bearer <accessToken>
```

También: `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` (`connectedSessions`/`maxDevices` → `x/y` del perfil), `GET /devices` (`used`/`limit`/`items`), `DELETE /devices/{id}`.  
Login TV por QR: `POST /auth/device-link/session` (TV), `GET /auth/device-link/session/{code}?deviceId=` (TV poll), `POST /auth/device-link/approve` (móvil Bearer). Informes: `informe-login-qr-tv.md` / `informe-login-qr-movil.md`.  
Ante `401` en `/devices` o `/me`: renovar token o re-login (Bearer obligatorio). Login con clave + cupo lleno desplaza el menos reciente; approve QR con cupo lleno → `DEVICE_LIMIT`. No loguear tokens ni contraseñas.

---

## 4. Catálogo (rutas reales)

Todas requieren Bearer salvo salud.

| Uso | Método y ruta |
| --- | --- |
| Salud | `GET /health/live` |
| Home (1 RTT) | `GET /catalog/home` |
| Sesión (perfil+abono) | `GET /auth/session` |
| Categorías live | `GET /catalog/live/categories` |
| Canales | `GET /catalog/live/streams?page=1&limit=50&categoryId=` |
| Categorías VOD | `GET /catalog/vod/categories` |
| Películas | `GET /catalog/vod/streams?page=1&limit=50` |
| Detalle película | `GET /catalog/vod/streams/{streamId}` |
| Categorías series | `GET /catalog/series/categories` |
| Series | `GET /catalog/series?page=1&limit=50` |
| Detalle serie | `GET /catalog/series/{seriesId}` |
| Temporadas | `GET /catalog/series/{seriesId}/seasons` |
| Episodios | `GET /catalog/series/{seriesId}/seasons/{seasonNumber}/episodes` |
| EPG canal | `GET /catalog/live/streams/{streamId}/epg?limit=12` |
| EPG rejilla | `GET /catalog/live/epg?streamIds=id1,id2&limit=8` |
| Buscar programas | `GET /catalog/live/epg/search?q=texto&page=1&limit=20` |

Paginación: `page`, `limit` (máx. 50). Detalle EPG: `docs/integraciones/epg.md`.

**Iconos / pósters / fondos:** el backend firma las URLs como  
`https://api.cotasperu.com/api/v1/media/asset?u=...&exp=...&sig=...`.  
En ficha de película/serie use **`posterUrl`** (afiche) y **`backdropUrl`** (fondo); no reutilizar el póster como fondo. Canales: `posterUrl`/`iconUrl` y `backdropUrl: null`. Detalle: `docs/integraciones/poster-y-backdrop.md`.

---

## 5. Reproducción (crítico)

Las apps **no** llaman a XUI ni a IPs de streaming.

```http
POST /playback/authorizations
Authorization: Bearer <accessToken>
Content-Type: application/json
```

| Contenido | Body |
| --- | --- |
| Canal | `{ "contentType": "live", "streamId": "<id>" }` |
| Película | `{ "contentType": "vod", "streamId": "<id>" }` |
| Episodio | `{ "contentType": "series", "streamId": "<episodeId>", "seriesId": "<id>", "seasonNumber": <n> }` |

Respuesta relevante:

| Campo | Uso |
| --- | --- |
| `streamUrl` | URL a abrir en el player (mismo host API, path `/playback/media/{ticket}`) |
| `protocolHint` | `hls` o `progressive` |
| `delivery` | `direct` (contrato de apps; el origen real lo resuelve el backend) |
| `accessMaterialEmbedded` | `true` |

Reglas del player:

1. Usar **exactamente** `streamUrl` (no reescribir host a LAN ni a XUI).
2. Si `protocolHint === 'hls'`, motor HLS; si `progressive`, progressive/MP4.
3. El player debe poder pedir segmentos en el **mismo origen** (`api.cotasperu.com`) sin JWT (ticket opaco en la URL).
4. Timeouts de lectura de media ≥ 30–60 s.

Detalle adicional: `docs/integraciones/autorizacion-reproduccion.md` (concepto). El proxy de media es el camino soportado en producción pública.

---

## 6. Cuenta / recordatorios (opcional)

Ver `docs/integraciones/cuenta-y-notificaciones.md` (`/account/subscription`, `/account/reminders`).

---

## 7. Errores

| HTTP | Acción en app |
| --- | --- |
| 401 | Refresh / login |
| 403 | Sin permiso |
| 404 | Contenido no disponible |
| 429 | Backoff |
| 502 / 503 | “Servicio no disponible”; no reintentar en bucle |
| Timeout / sin red | Mensaje claro + reintento manual |

---

## 8. Pruebas mínimas por plataforma (obligatorias)

Desde **datos móviles o Wi‑Fi externo** (no solo LAN COTAS):

1. `GET https://api.cotasperu.com/api/v1/health/live` → `{"status":"ok"}`
2. Login con línea de prueba
3. Listar canales / películas / series
4. `POST /playback/authorizations` live + play hasta imagen
5. Igual VOD y un episodio
6. Logout

Criterio de aceptación: la app usable fuera de la LAN sin VPN.

---

## 9. Qué no hacer

- No usar `player_api.php` ni hosts `10.x` / `192.168.x` para API o stream.
- No hardcodear usuario/clave de panel XUI.
- No desactivar TLS.
- No dar por terminado el trabajo solo con `/health/live`.

---

## 10. Referencias en el repo

- `docs/integraciones/epg.md`
- `docs/integraciones/catalogo-normalizado.md`
- `docs/integraciones/cuenta-y-notificaciones.md`
- OpenAPI: `npm run openapi:export` en `backend/`
