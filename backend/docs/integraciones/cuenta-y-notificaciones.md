# Cuenta XUI, perfil y notificaciones push

Contrato para apps (Android TV, móvil, Tizen, web) sobre el abono IPTV y el aviso de novedades de catálogo.

## Autenticación

```http
Authorization: Bearer <accessToken>
```

Token de `POST /api/v1/auth/login` (línea XUI) o personal del panel. Sin token → `401`.

Base URL de producción: `https://api.cotasperu.com/api/v1`.

### Login de apps IPTV (cupo de dispositivos)

Las apps **deberían** enviar un `deviceId` estable (UUID o id de instalación persistido). Si aún no lo envían, el backend usa el `User-Agent` como huella temporal (compatibilidad).

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "<linea>",
  "password": "<clave>",
  "deviceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "platform": "android",
  "deviceName": "Living TV"
}
```

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| `deviceId` | Recomendado | 8–128 chars (`A-Za-z0-9._:-`); no regenerar en cada arranque |
| `platform` | No | Texto libre corto; se normaliza a ANDROID/IOS/TV/WEB/OTHER |
| `deviceName` | No | Etiqueta visible (máx. 80) |

El cupo es `maxConnections` de XUI, aplicado sobre la tabla `devices` de COTAS (no sobre `active_cons` / `activeConnections` de XUI):

- Aparato ya registrado → reutiliza el slot y actualiza `lastSeenAt`.
- Cupo lleno y aparato **nuevo** → `403` / `DEVICE_LIMIT` (en `details` vienen `used` y `limit`).
- Si el cupo **baja** (p. ej. de 5 a 3) → se **conservan los dispositivos más antiguos** (`createdAt`) y se revocan los más nuevos (cierran sesión). Un aparato nuevo que intente entrar recibe `403` `DEVICE_LIMIT` con mensaje claro.
- **Logout** o sesión expirada → el dispositivo queda libre (ya no cuenta en el cupo).
- En login / `GET /devices` se revocan “fantasmas” (`ACTIVE` sin sesión viva).
- En TV/móvil conviene enviar siempre el mismo `deviceId` estable.

Personal del panel (admin/operador con contraseña local) **no** usa cupo ni exige `deviceId`.

**UI (Flutter / TV):** el contador `x/y` del perfil debe leer:

| Endpoint | Campos |
| --- | --- |
| `GET /auth/me` | `connectedSessions` / `maxDevices` (**obligatorio** para la app) |
| `GET /account/subscription` | `activeDevices` / `maxDevices` |
| `GET /devices` | `used` / `limit` + listado para cerrar remotos |

**No** usar `activeConnections` / `maxConnections` de XUI (streams) para ese texto.

Si el cupo está lleno y entra un **nuevo** `deviceId` por login con clave, el backend libera hueco cerrando un aparato **más nuevo** entre los existentes (los antiguos se priorizan). En approve QR el cupo lleno sigue siendo `DEVICE_LIMIT` sin desplazar.

### Login TV por QR (device link)

El TV crea un código de un solo uso; el móvil (Bearer) lo aprueba; el TV hace poll y recibe **tokens propios**.

| Actor | Método |
| --- | --- |
| TV | `POST /auth/device-link/session` → `linkCode`, `qrPayload`, `expiresIn`, `pollIntervalMs` |
| TV | `GET /auth/device-link/session/{code}?deviceId=` → `pending` \| `approved`+tokens \| `expired` \| `consumed` |
| Móvil | `POST /auth/device-link/approve` `{ linkCode, deviceName? }` → registra en `devices` (cupo con `DEVICE_LIMIT` si está lleno) |

QR payload: `cotas://device-link?code=XXXXXXXX` (sin credenciales).  
Informes: `informe-login-qr-tv.md` y `informe-login-qr-movil.md`.

### Listar / revocar dispositivos

```http
GET /api/v1/devices
DELETE /api/v1/devices/{id}
```


**Respuesta 200** (pantalla de configuración → “3/5 dispositivos”):

```json
{
  "used": 3,
  "limit": 5,
  "inactiveAfterSeconds": 300,
  "items": [
    {
      "id": "...",
      "platform": "ANDROID",
      "deviceName": "Living TV",
      "status": "ACTIVE",
      "presence": "online",
      "lastSeenAt": "2026-11-05T14:00:00.000Z",
      "createdAt": "2026-11-01T10:00:00.000Z",
      "current": true
    }
  ]
}
```

| Campo | Uso en UI |
| --- | --- |
| `used` / `limit` | Texto `used/limit` (p. ej. `3/5`). Si `limit` es `null`, mostrar solo `used` o “sin cupo” |
| `items[].current` | Marcar “este aparato” |
| `items[].presence` | `online` / `inactive` (sigue vinculado; no es logout) |
| `inactiveAfterSeconds` | Umbral servidor (300 s) |
| `DELETE` | Revocar otro aparato (`204`); cierra sus sesiones |
| `POST /devices/heartbeat` | App en uso: mantener `online` (cada ~60 s) |

Solo aparecen dispositivos `ACTIVE`. `limit` sale del snapshot de suscripción (`maxConnections`).

## Perfil (`/auth/me`)

```http
GET /api/v1/auth/me
```

```json
{
  "id": "…",
  "username": "prueba.linea",
  "displayName": "Cliente Prueba",
  "role": "CUSTOMER",
  "status": "ACTIVE",
  "accountStatus": "ACTIVE",
  "mfaEnabled": false,
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "maxDevices": 3,
  "connectedSessions": 1
}
```

| Campo | Uso |
| --- | --- |
| `maxDevices` | Máximo de aparatos con sesión (entero; puede ser `null` si aún no hay snapshot) |
| `connectedSessions` | Aparatos ACTIVE con sesión viva ahora → pintar `connectedSessions / maxDevices` |

`GET /devices` requiere Bearer válido (401 sin token o sesión revocada).

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
  "maxDevices": 3,
  "activeDevices": 1,
  "status": "Active",
  "lastVerifiedAt": "2026-11-02T19:00:00.000Z",
  "source": "live"
}
```

| Campo | Significado |
| --- | --- |
| `maxDevices` / `activeDevices` | Contador de **aparatos con sesión** (usar en perfil si no se lee `/auth/me`) |
| `maxConnections` | Tope XUI (mismo número que `maxDevices` en la práctica) |
| `activeConnections` | Streams abiertos en XUI (**no** usar para `x/y` del perfil) |
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

La app debe obtener el token con Firebase Messaging y enviar esta petición después del login (con el access token vigente). Si el token no está disponible, la app actual no registra nada. Los campos opcionales `appVersion` y `deviceModel` también son aceptados por el backend para compatibilidad con el cliente Flutter; no se usan para decidir la entrega.

## Novedades de catálogo (notificaciones locales Flutter)

`GET /api/v1/catalog/announcements` requiere el access token Bearer. El worker registra nuevas películas, series y episodios al terminar correctamente todo el inventario XUI. Esta funcionalidad **no envía FCM**; Flutter consulta este endpoint y crea notificaciones locales según preferencias del usuario. Contrato, paginación y cursores: `backend/docs/AUDITORIA/CONTRATO_API_NOTIFICACIONES_FLUTTER.md`.

Parámetros: `limit` (20 por defecto, máximo 100), `type` (`MOVIE`, `SERIES`, `EPISODE`), `since` (cursor de sincronización completada) y `cursor` (continuación de una página). Para recorrer todas las páginas, conservar `since` y pasar `nextCursor` hasta que sea `null`; solo después guardar `syncCursor` como nuevo `since`. `page` sigue aceptado para clientes anteriores, pero las nuevas integraciones deben usar cursores.

La respuesta contiene `id`, `type`, `kind` (compatibilidad anterior), `contentId`, título, poster, descripción, fechas, disponibilidad, datos de temporada/episodio, `detailPath`, `hasMore`, `nextCursor` y `syncCursor`. No se debe presentar una notificación de un elemento con `available: false`.

### Push FCM de eventos de dispositivo

FCM se conserva solo para eventos de dispositivo como `device_session_closed` y `device_inactive`. Las variables FCM y el registro de token no forman parte de las novedades de catálogo.

### Push de sesión cerrada / dispositivo inactivo

| Evento | `data.type` | Lista | Texto sugerido |
| --- | --- | --- | --- |
| Logout / `DELETE /devices/{id}` | `device_session_closed` | **Quitar** ítem | “Se cerró la sesión en &lt;nombre&gt;.” |
| Sin heartbeat ≥ 5 min | `device_inactive` | Mantener; `presence: inactive` | “&lt;nombre&gt; está inactivo.” |

Ambos incluyen `data.deviceId` y `data.deviceName`. Refrescar `GET /devices` al recibir push y en `onResume`.

TV y móvil en foreground: `POST /devices/heartbeat` cada ~60 s.

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
