# Cuenta XUI, perfil y notificaciones push

Contrato para apps (Android TV, móvil, Tizen, web) sobre el abono IPTV y el aviso de novedades de catálogo.

## Autenticación

```http
Authorization: Bearer <accessToken>
```

Token de `POST /api/v1/auth/login` (línea XUI) o personal del panel. Sin token → `401`.

Base URL de pruebas típica: `http://10.10.0.31:3100/api/v1`.

## Perfil (`/auth/me`)

```http
GET /api/v1/auth/me
```

Incluye `displayName` (nombre visible COTAS, rellenado desde XUI al verificar la línea). El correo queda fuera de esta entrega.

## Suscripción / línea IPTV

```http
GET /api/v1/account/subscription
```

Al responder, el backend intenta refrescar el estado en XUI (`player_api` / `user_info`) y guarda un snapshot en PostgreSQL. Si XUI falla, devuelve el último snapshot (`source: "cache"`).

**Respuesta 200**

```json
{
  "displayName": "Cliente Demo",
  "username": "viewer.demo",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "maxConnections": 3,
  "activeConnections": 1,
  "status": "Active",
  "lastVerifiedAt": "2026-11-02T19:00:00.000Z",
  "source": "live"
}
```

| Campo | Significado |
| --- | --- |
| `maxConnections` / `activeConnections` | Conexiones concurrentes de **streaming** en XUI (no dispositivos de sesión de la app) |
| `expiresAt` | Vencimiento de la línea (`exp_date`); `null` si XUI no informa |
| `source` | `live` = recién consultado a XUI; `cache` = degradación |

En el login IPTV también se persiste el snapshot (nombre, vencimiento, conexiones).

La contraseña de la línea **nunca** se expone en estas respuestas.

## Token FCM (buzón del teléfono)

```http
PUT /api/v1/devices/push-token
Content-Type: application/json

{ "token": "<fcm_registration_token>", "platform": "android" }
```

Respuesta `204`. `platform`: `android` | `fcm` | `ios` (APNs dedicado queda fuera de alcance; el campo es extensible).

El token se asocia al **dispositivo de sesión** actual (tabla `devices`), distinto de las conexiones XUI.

## Historial de novedades

```http
GET /api/v1/catalog/announcements?page=1&limit=20
```

Anuncios creados por el worker cuando aparecen IDs nuevos de VOD o series respecto al snapshot anterior.

```json
{
  "page": 1,
  "limit": 20,
  "total": 1,
  "items": [
    {
      "id": "...",
      "kind": "vod",
      "title": "Película nueva",
      "contentId": "2002",
      "createdAt": "2026-11-02T19:05:00.000Z"
    }
  ]
}
```

## Push FCM (servidor)

Tras sincronizar `vod-streams` / `series`, el worker:

1. Diff de IDs vs `catalog_content_snapshots`.
2. Inserta filas en `catalog_announcements` (salvo la primera sincronización, que solo siembra el snapshot).
3. Si `FCM_ENABLED=true` y hay credenciales, envía notificación HTTP v1 a tokens activos.

Variables (ver `.env.example`): `FCM_ENABLED`, `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`.

Con FCM deshabilitado, la API de anuncios sigue siendo útil para la UI.

## Recordatorios EPG (sincronización entre celulares)

Persistidos en PostgreSQL ligados al **usuario JWT** (misma cuenta/línea), no al dispositivo. La app programa la notificación local tras el `GET`.

Base: `/api/v1/account/reminders`  
Auth: `Authorization: Bearer <accessToken>`

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/v1/account/reminders` | Lista `scheduled` activos |
| `POST` | `/api/v1/account/reminders` | Crear / idempotente |
| `PATCH` | `/api/v1/account/reminders/:id` | Cambiar `leadMinutes` |
| `DELETE` | `/api/v1/account/reminders/:id` | Soft-delete → `cancelled` (`204`) |

**POST body**

```json
{
  "channelId": "12345",
  "channelName": "Canal X",
  "programTitle": "Noticiero",
  "leadMinutes": 5,
  "epgProgramId": "abc",
  "startAt": "2026-11-02T20:00:00.000Z",
  "endAt": "2026-11-02T21:00:00.000Z"
}
```

**Item (POST / PATCH / GET.items[])**

```json
{
  "id": "uuid-del-servidor",
  "channelId": "12345",
  "channelName": "Canal X",
  "programTitle": "Noticiero",
  "leadMinutes": 5,
  "state": "scheduled",
  "epgProgramId": "abc",
  "startAt": "2026-11-02T20:00:00.000Z",
  "endAt": "2026-11-02T21:00:00.000Z",
  "notifyAt": "2026-11-02T19:55:00.000Z"
}
```

- `leadMinutes`: `5 | 10 | 15 | 30 | 60`
- `state`: `scheduled | cancelled | unverifiable`
- Fechas UTC ISO-8601; `notifyAt = startAt - leadMinutes`
- `id` es UUID de BD (nunca `local-…`)
- Duplicado mismo canal/programa/inicio → se reutiliza el existente
- En `GET`, los que ya terminaron (`endAt < now`) pasan a `cancelled` y no se listan

## Fuera de alcance

- Relación correo ↔ cuenta XUI.
- APNs iOS nativo.
- Push automático a la hora `notifyAt` (la app programa local tras el GET).
- Réplica PostgreSQL.
