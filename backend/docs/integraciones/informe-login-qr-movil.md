# Informe para app móvil — Login TV por QR + registro de dispositivos

**API base:** `https://api.cotasperu.com/api/v1`  
**Fecha:** 2026-11-05  
**Audiencia:** Flutter COTAS IPTV (`appcotasiptv`) y clientes móviles equivalentes  

---

## Objetivo UX

1. Usuario ya logueado en el móvil.
2. Escanea el QR del televisor (o escribe el código de 8 caracteres).
3. Confirma un **registro** (nombre, tipo de aparato, fecha).
4. El TV inicia sesión solo.
5. Ese TV aparece en un apartado del móvil; desde ahí se puede **cerrar sesión** remota.

---

## Flujo (móvil)

```text
1. Usuario autenticado (Bearer accessToken válido)
2. Escáner QR → parsear cotas://device-link?code=XXXXXXXX
   (o input manual del linkCode)
3. Pantalla de confirmación:
   - nombre: editable (ej. "cuarto02")
   - dispositivo: Televisor / plataforma (informativo)
   - fecha: ahora (autocompletada en UI; el servidor guarda createdAt)
4. POST /auth/device-link/approve
5. Éxito → navegar al apartado Dispositivos (GET /devices)
6. Cerrar TV → DELETE /devices/{id}
```

---

## Endpoints

### 1) Aprobar enlace (Bearer obligatorio)

```http
POST /api/v1/auth/device-link/approve
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "linkCode": "AB3K7N2P",
  "deviceName": "cuarto02"
}
```

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| `linkCode` | **Sí** | 8 chars del QR (alfabeto sin 0/O/1/I) |
| `deviceName` | No | Nombre visible en la lista; si falta usa el del TV o “Televisor” |

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

Guardar en UI local si quieren caché, pero la **fuente de verdad** es `GET /devices`.

**Errores**

| HTTP | code | UI sugerida |
| --- | --- | --- |
| 403 | `DEVICE_LIMIT` | “Límite de dispositivos. Cierra uno en Dispositivos y reintenta.” (`details.used` / `details.limit`) |
| 404/409 | `DEVICE_LINK_INVALID` | “Código inválido o ya usado.” |
| 410 | `DEVICE_LINK_EXPIRED` | “El QR venció; genera uno nuevo en el TV.” |
| 401 | `UNAUTHORIZED` | Renovar token / re-login |

Al aprobar con cupo lleno el backend **no** desplaza otro aparato: el usuario debe revocar uno a propósito.

### 2) Listar dispositivos (apartado “Mis dispositivos”)

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

| Campo UI | Origen |
| --- | --- |
| Nombre | `deviceName` |
| Dispositivo / tipo | `platform` (`TV`, `ANDROID`, …) |
| Fecha de registro | `createdAt` |
| Última conexión | `lastSeenAt` |
| Contador `x / y` | `used` / `limit` **o** `GET /auth/me` → `connectedSessions` / `maxDevices` |
| Este aparato | `current === true` |

**401 en `/devices`:** token ausente/expirado — no es “ruta rota”. Renovar con refresh o re-login.

### 3) Cerrar sesión del TV (remoto)

```http
DELETE /api/v1/devices/{id}
Authorization: Bearer <accessToken>
```

→ `204`. Revoca el dispositivo y **todas** sus sesiones. El TV dejará de autorizar APIs.

No borrar el ítem solo en disco local: refrescar `GET /devices`.

### 4) Contador del perfil (ya disponible)

```http
GET /api/v1/auth/me
```

Usar `connectedSessions` / `maxDevices` (enteros).  
**No** usar `activeConnections` de suscripción (eso es streaming XUI).

Opcional: `GET /account/subscription` → `activeDevices` / `maxDevices`.

---

## Parseo del QR

Payload canónico:

```text
cotas://device-link?code=AB3K7N2P
```

1. Si el esquema es `cotas` y path/host indica `device-link`, leer query `code`.
2. Validar 8 caracteres `[2-9A-HJ-NP-Z]`.
3. Normalizar a mayúsculas antes del approve.
4. Si el usuario pega solo el código, aceptar input manual.

---

## Pantalla de confirmación (sugerida)

| Campo | Origen | Editable |
| --- | --- | --- |
| Nombre | default `Televisor` o vacío | Sí → `deviceName` |
| Dispositivo | “Televisor” / marca si la conocen | No (informativo) |
| Fecha | `DateTime.now()` en UI | No (servidor guarda `createdAt`) |
| Cupo | `used/limit` tras approve o desde `/me` | No |

Tras confirmar con éxito: toast “TV conectado” + ir a lista de dispositivos.

---

## Checklist QA móvil

- [ ] Escaneo QR con app logueada aprueba en &lt; 3 s.
- [ ] TV aparece en `GET /devices` con el nombre elegido.
- [ ] Perfil muestra `connectedSessions / maxDevices` coherente (ej. `2 / 3`).
- [ ] Con cupo lleno, approve muestra `DEVICE_LIMIT` y lista permite `DELETE`.
- [ ] Tras `DELETE` del TV, ese ítem desaparece y el contador baja.
- [ ] Código vencido / inválido muestra mensaje claro.
- [ ] Sin Bearer, `/devices` y `/approve` → 401 (renovar sesión).

---

## Seguridad (resumen para el equipo)

- El móvil **autoriza** el código; no envía su refresh token al TV.
- El TV obtiene tokens propios al hacer poll.
- Cerrar desde el móvil es `DELETE /devices/{id}`.

---

## Contacto contrato

- Este informe + `informe-login-qr-tv.md`
- Cupo / perfil: `docs/integraciones/cuenta-y-notificaciones.md`
