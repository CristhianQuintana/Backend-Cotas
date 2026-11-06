# Informe móvil — Escaneo QR + gestión de dispositivos vinculados

**API base:** `https://api.cotasperu.com/api/v1`  
**Fecha:** 2026-11-06  
**Audiencia:** Flutter COTAS IPTV (`appcotasiptv`) y clientes móviles equivalentes  
**Contrato hermano:** `informe-login-qr-tv.md`  
**Verificación backend:** flujo unitario `device-link` (crear → approve → redeem tokens TV → consumed) + rechazo `DEVICE_LIMIT` con cupo lleno.

---

## 1. Módulos que debe tener la app móvil

Además del login normal del celular, se requieren **dos módulos** conectados:

| Módulo | Dónde en la app | Para qué |
| --- | --- | --- |
| **A. Vincular TV (escaneo QR)** | Entrada clara: Perfil / Ajustes / “Vincular televisor” | Escanea el QR de la columna derecha del TV y confirma el registro |
| **B. Dispositivos vinculados** | Apartado “Mis dispositivos” / “Sesiones” | Lista aparatos con sesión, contador `x / y`, cerrar sesión remota del TV |

```text
Perfil / Ajustes
├── Contador: connectedSessions / maxDevices   ← GET /auth/me
├── [ Vincular televisor ]                     ← Módulo A (cámara + confirmación)
└── Mis dispositivos                           ← Módulo B (GET /devices)
      ├── Este celular (current)
      ├── cuarto02 · TV · conectado
      └── …  [ Cerrar sesión ]
```

---

## 2. Cómo se comunican móvil ↔ API ↔ TV (flujo completo)

El usuario **ya está logueado** en el móvil (`Bearer accessToken` válido).

```text
 TV (pantalla login, columna derecha)     API                         Móvil
 ────────────────────────────────────     ───                         ─────
 Muestra QR + código AB3K7N2P
 (POST /auth/device-link/session)         challenge PENDING
 Poll cada 2,5 s → pending
                                                                  Usuario abre “Vincular TV”
                                                                  Cámara / pegar código
                                                                  Parse: cotas://device-link?code=…
                                                                  Pantalla confirmar:
                                                                    nombre: cuarto02
                                                                    tipo: Televisor
                                                                    fecha: ahora (UI)
                                                                  POST /auth/device-link/approve
                                                                    Authorization: Bearer <móvil>
                                                                  ◄── 200 { device, used, limit }
                                                                  Ir a “Mis dispositivos”
                                                                  GET /devices → aparece el TV
 Poll → approved + tokens del TV
 TV entra al Home
                                                                  (Opcional) DELETE /devices/{idTV}
                                                                  TV pierde sesión (401)
```

**Importante:** el móvil **autoriza** el código; **no** envía su `refreshToken` al TV. El TV canjea solo y recibe tokens propios.

---

## 3. Módulo A — Escaneo y registro del TV

### 3.1 Entrada

- Botón / tile: **“Vincular televisor”** o **“Escanear código del TV”**.
- Requiere sesión móvil activa. Si el token expiró → refresh o re-login antes de escanear.

### 3.2 Captura del código

1. Abrir cámara (escáner QR).
2. Payload canónico del TV:

```text
cotas://device-link?code=AB3K7N2P
```

3. Extraer query `code` (8 caracteres `[2-9A-HJ-NP-Z]`), pasar a **mayúsculas**.
4. Alternativa: campo “Ingresar código” si no puede escanear (el TV muestra el mismo `linkCode` bajo el QR).

### 3.3 Pantalla de confirmación del registro

Antes del approve, mostrar un formulario de registro del aparato:

| Campo en UI | Origen | Editable | Qué se envía al API |
| --- | --- | --- | --- |
| Nombre | default vacío o “Televisor” | **Sí** (ej. `cuarto02`) | `deviceName` |
| Dispositivo | “Televisor” / TV | No (informativo) | — |
| Fecha | `DateTime.now()` en UI | No | El servidor guarda `createdAt` |
| Cupo actual | `GET /auth/me` o último `GET /devices` | No | — |

Botones: **Confirmar** / **Cancelar**.

### 3.4 Llamada de approve

```http
POST /api/v1/auth/device-link/approve
Authorization: Bearer <accessToken_del_móvil>
Content-Type: application/json

{
  "linkCode": "AB3K7N2P",
  "deviceName": "cuarto02"
}
```

**Respuesta 200**

```json
{
  "status": "approved",
  "device": {
    "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "deviceName": "cuarto02",
    "platform": "TV",
    "createdAt": "2026-11-05T18:00:00.000Z"
  },
  "used": 2,
  "limit": 3
}
```

- Toast: “Televisor vinculado”.
- Navegar al **Módulo B** y refrescar lista.
- En el TV (columna derecha), el poll pasará a `approved` y el televisor entrará solo.

### 3.5 Errores del escaneo / approve

| HTTP | code | Mensaje UI sugerido |
| --- | --- | --- |
| 403 | `DEVICE_LIMIT` | “Límite de dispositivos (`used`/`limit`). Cierra uno en Mis dispositivos y reintenta.” |
| 404 / 409 | `DEVICE_LINK_INVALID` | “Código inválido o ya usado. Genera un QR nuevo en el TV.” |
| 410 | `DEVICE_LINK_EXPIRED` | “El QR venció (~2 min). Pide un código nuevo en el televisor.” |
| 401 | `UNAUTHORIZED` | Renovar sesión del móvil y volver a escanear |

Con cupo lleno el backend **no** expulsa otro aparato automáticamente en el approve QR: el usuario debe elegir cuál cerrar en el Módulo B.

---

## 4. Módulo B — Dispositivos vinculados (control de sesiones)

### 4.1 Listar

```http
GET /api/v1/devices
Authorization: Bearer <accessToken>
```

```json
{
  "used": 2,
  "limit": 3,
  "items": [
    {
      "id": "…",
      "platform": "ANDROID",
      "deviceName": "Mi celular",
      "status": "ACTIVE",
      "lastSeenAt": "2026-11-05T17:55:00.000Z",
      "createdAt": "2026-11-01T10:00:00.000Z",
      "current": true
    },
    {
      "id": "…",
      "platform": "TV",
      "deviceName": "cuarto02",
      "status": "ACTIVE",
      "lastSeenAt": "2026-11-05T18:00:00.000Z",
      "createdAt": "2026-11-05T18:00:00.000Z",
      "current": false
    }
  ]
}
```

| UI del listado | Campo API |
| --- | --- |
| Título `x / y` | `used` / `limit` |
| Nombre | `deviceName` |
| Tipo | `platform` (`TV`, `ANDROID`, `IOS`, …) |
| Registrado | `createdAt` |
| Última conexión | `lastSeenAt` |
| “Este dispositivo” | `current === true` |
| Acción “Cerrar sesión” | visible si `current === false` (o también en el actual con confirmación) |

**401:** token inválido/expirado — no es “falta el endpoint”. Renovar Bearer.

### 4.2 Contador del perfil (obligatorio para “No disponible”)

```http
GET /api/v1/auth/me
```

Pintar: **`connectedSessions / maxDevices`** (enteros).  
Opcional: `GET /account/subscription` → `activeDevices` / `maxDevices`.

**No** usar `activeConnections` / `maxConnections` de XUI para este texto (son streams, no aparatos).

### 4.3 Cerrar sesión de un TV (o de otro aparato)

```http
DELETE /api/v1/devices/{id}
Authorization: Bearer <accessToken>
```

→ `204`.

Efecto:

1. El dispositivo pasa a no listarse como ACTIVE.
2. Se revocan sus sesiones en el servidor.
3. El TV deja de poder llamar APIs con ese token (`401`) y vuelve a la pantalla login | QR.
4. Refrescar `GET /devices` y el contador del perfil.

### 4.4 Si el TV (u otro aparato) cierra sesión solo

Cuando un televisor hace `POST /auth/logout` (o se revoca su sesión):

1. Ese aparato **deja de aparecer** en el próximo `GET /devices` (queda `REVOKED` en servidor).
2. Si el celular registró FCM (`PUT /devices/push-token`) y FCM está activo, recibe push:
   - `data.type` = `device_session_closed`
   - `data.deviceId` / `data.deviceName`
   - notificación: “Sesión cerrada” / “Se cerró la sesión en &lt;nombre&gt;.”
3. Al recibir el push (o al volver la app al primer plano): **refrescar** `GET /devices` y el contador `GET /auth/me`.

Sin push, la lista solo se actualiza al refrescar (pull-to-refresh / onResume). No hay WebSocket de presencia.

---

## 5. Conexión extremo a extremo (checklist de comunicación)

| Paso | Quién | Endpoint | Resultado esperado |
| --- | --- | --- | --- |
| 1 | TV | `POST /auth/device-link/session` | QR + `linkCode` en columna derecha |
| 2 | TV | `GET .../session/{code}?deviceId=` | `pending` mientras espera |
| 3 | Móvil | Escaneo + confirmación nombre | UI Módulo A |
| 4 | Móvil | `POST /auth/device-link/approve` | TV registrado; `used` aumenta |
| 5 | TV | mismo GET poll | `approved` + tokens → Home |
| 6 | Móvil | `GET /devices` | Ve el TV en Módulo B |
| 7 | Móvil | `DELETE /devices/{id}` | TV desconectado |
| 8 | TV | cualquier API con Bearer viejo | `401` → pantalla login \| QR |

---

## 6. Checklist QA móvil

- [ ] Existe entrada “Vincular televisor” (Módulo A) con cámara + código manual.
- [ ] Confirmación pide nombre (ej. `cuarto02`) antes del approve.
- [ ] Tras approve, el TV aparece en **Mis dispositivos** con ese nombre.
- [ ] Perfil muestra `connectedSessions / maxDevices` (no “No disponible”).
- [ ] Cupo lleno → `DEVICE_LIMIT` y se puede liberar con DELETE.
- [ ] Cerrar sesión del TV desde el móvil deja el televisor en login/QR.
- [ ] Si el TV hace logout local, desaparece de Mis dispositivos al refrescar (y push `device_session_closed` si FCM).
- [ ] QR vencido / inválido muestra mensaje claro.
- [ ] Sin Bearer, `/approve` y `/devices` → 401 (renovar sesión).

---

## 7. Seguridad (resumen)

- El móvil solo envía `linkCode` + `deviceName` con su Bearer.
- No reenviar al TV la sesión del celular.
- Cierre remoto = `DELETE /devices/{id}`.

---

## 8. Mensaje corto al equipo móvil

> Implementar dos piezas: (A) escanear el QR del TV y confirmar el registro; (B) listar y cerrar dispositivos vinculados. El TV y el móvil se coordinan solo por la API: el móvil aprueba el código; el TV hace poll y recibe su propia sesión.
