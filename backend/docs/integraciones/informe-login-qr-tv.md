# Informe para apps TV — Login por QR (device link)

**API base:** `https://api.cotasperu.com/api/v1`  
**Fecha:** 2026-11-05  
**Audiencia:** Samsung Tizen, LG webOS, Android / Google TV, Flutter TV  

---

## Objetivo

El televisor inicia sesión **sin teclear usuario/clave**: muestra un QR, el abonado lo aprueba en el móvil ya logueado, y el TV recibe **su propia** sesión (tokens + cupo de dispositivos).

El QR **nunca** lleva usuario, contraseña ni tokens.

---

## Flujo (TV)

```text
1. TV genera/persiste deviceId estable (UUID de instalación)
2. POST /auth/device-link/session
3. Muestra QR (qrPayload) + código corto (linkCode) en pantalla
4. Cada pollIntervalMs → GET /auth/device-link/session/{linkCode}?deviceId=…
5. status=approved → guardar accessToken + refreshToken → entrar al Home
6. Si expired → volver a crear sesión QR
```

---

## Endpoints

### 1) Crear sesión QR (público)

```http
POST /api/v1/auth/device-link/session
Content-Type: application/json

{
  "deviceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "platform": "tv",
  "deviceName": "LG Living"
}
```

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| `deviceId` | **Sí** | UUID estable del TV; **no** regenerar en cada arranque |
| `platform` | No | `tv`, `tizen`, `webos`, `android`, etc. |
| `deviceName` | No | Sugerencia; el móvil puede sobrescribir al aprobar |

**Respuesta 200**

```json
{
  "linkCode": "AB3K7N2P",
  "qrPayload": "cotas://device-link?code=AB3K7N2P",
  "expiresIn": 120,
  "pollIntervalMs": 2500,
  "deviceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

- Generar QR con el string exacto `qrPayload` (o URL equivalente documentada).
- Mostrar también `linkCode` por si el usuario escribe el código a mano en el móvil.
- TTL típico: **120 s**. Pasado ese tiempo → `expired` → crear otra sesión.

### 2) Poll / canje (público)

```http
GET /api/v1/auth/device-link/session/AB3K7N2P?deviceId=7c9e6679-7425-40de-944b-e07fc1f90ae7
```

`deviceId` **debe** ser el mismo enviado al crear la sesión.

| `status` | Acción en TV |
| --- | --- |
| `pending` | Seguir haciendo poll (`expiresIn` restante) |
| `approved` | **Una sola vez** incluye tokens → guardar y navegar a Home |
| `expired` | Mostrar “código vencido” → `POST …/session` de nuevo |
| `denied` | Mostrar rechazo (poco frecuente) |
| `consumed` | Ya se entregaron tokens; si no los tiene, pedir nuevo QR |

**Respuesta aprobada (ejemplo)**

```json
{
  "status": "approved",
  "accessToken": "…",
  "refreshToken": "…",
  "expiresIn": 900,
  "tokenType": "Bearer",
  "device": {
    "id": "uuid-interno-cotas",
    "deviceName": "cuarto02",
    "platform": "TV"
  }
}
```

A partir de aquí el TV usa el mismo contrato que login normal:  
`Authorization: Bearer <accessToken>`, catálogo, playback, `POST /auth/refresh`, etc.

---

## Reglas importantes

1. **No** copiar tokens del móvil al TV.
2. **No** poner credenciales en el QR.
3. Poll cada `pollIntervalMs` (≈ 2,5 s); no saturar (&lt; 1 s).
4. Tras `approved`, **no** volver a esperar tokens del mismo código (`consumed`).
5. Cierre remoto desde el móvil (`DELETE /devices/{id}`) invalida la sesión del TV → al fallar APIs con 401, volver a pantalla QR/login.

---

## Errores frecuentes

| HTTP / code | Significado |
| --- | --- |
| `404` `DEVICE_LINK_INVALID` | Código inexistente o `deviceId` no coincide |
| `410` `DEVICE_LINK_EXPIRED` | Código vencido (en approve; en poll suele venir `status: expired`) |
| `429` | Rate limit — respetar `pollIntervalMs` |

---

## Checklist QA TV

- [ ] `deviceId` estable entre reinicios de la app.
- [ ] QR escaneable; código legible a 3 m.
- [ ] Tras aprobar en móvil (&lt; 2 min), TV entra sin teclear clave.
- [ ] Segundo poll del mismo código → `consumed` (sin tokens duplicados).
- [ ] Código vencido regenera QR nuevo.
- [ ] Tras cerrar el TV desde el móvil, el TV pierde sesión (401) y muestra login/QR.

---

## Contacto contrato

Detalle compartido: `docs/integraciones/cuenta-y-notificaciones.md` (sección device-link).  
Informe móvil hermano: `docs/integraciones/informe-login-qr-movil.md`.
