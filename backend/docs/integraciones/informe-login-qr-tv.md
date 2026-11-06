# Informe TV — Pantalla de login (tradicional + QR) y conexión con el móvil

**API base:** `https://api.cotasperu.com/api/v1`  
**Fecha:** 2026-11-06  
**Audiencia:** Samsung Tizen, LG webOS, Android / Google TV, Flutter TV  
**Contrato hermano:** `informe-login-qr-movil.md`  
**Verificación backend:** flujo unitario `device-link` (crear → pending → approve → approved+tokens → consumed) + `DEVICE_LIMIT` en approve.

---

## 1. Qué debe verse en el TV (layout obligatorio)

Pantalla de acceso en **dos columnas** (en móvil TV / 10-foot UI puede apilarse, pero el concepto es el mismo):

```text
┌─────────────────────────────┬─────────────────────────────┐
│  IZQUIERDA                  │  DERECHA                    │
│  Login tradicional          │  Código QR                  │
│                             │                             │
│  Usuario: [________]        │     ┌───────────┐           │
│  Clave:   [________]        │     │   QR      │           │
│  [ Iniciar sesión ]         │     │  imagen   │           │
│                             │     └───────────┘           │
│                             │  Código: AB3K7N2P           │
│                             │  “Escanea con la app        │
│                             │   COTAS en tu celular”      │
│                             │  (expira en ~2 min)         │
└─────────────────────────────┴─────────────────────────────┘
```

| Zona | Contenido | Backend |
| --- | --- | --- |
| **Izquierda** | Usuario + clave + botón “Iniciar sesión” | `POST /auth/login` (igual que hoy) |
| **Derecha** | QR + código de 8 caracteres + texto de ayuda | `POST /auth/device-link/session` + poll |

Ambos caminos terminan con la **misma** sesión de app: `accessToken` + `refreshToken` del **TV** (nunca tokens del móvil).

---

## 2. Cómo se comunican TV ↔ API ↔ móvil (flujo completo)

```text
 TV (derecha)                         API COTAS                         Móvil (logueado)
 ────────────                         ─────────                         ────────────────
 1. deviceId estable (UUID)
 2. POST /auth/device-link/session ──► crea challenge PENDING
    ◄── linkCode, qrPayload, expiresIn, pollIntervalMs
 3. Dibuja QR + código en pantalla
 4. Cada ~1 s:
    GET .../session/{code}?deviceId= ─► status: pending
                                                              5. Usuario abre “Vincular TV”
                                                              6. Escanea QR / escribe código
                                                              7. Confirma nombre (ej. cuarto02)
                                                              8. POST /auth/device-link/approve
                                                                 (Bearer del móvil)
                                                            ◄── 200 + device en lista
    9. Poll recibe status: approved
       + accessToken + refreshToken
 10. Guarda tokens → Home
 11. Siguiente poll → consumed
                                                              12. GET /devices ve el TV
                                                              13. DELETE /devices/{id}
                                                                  cierra sesión del TV
```

**Reglas de seguridad (no negociables)**

- El QR solo lleva el **código** (`cotas://device-link?code=XXXXXXXX`).
- **Prohibido** meter usuario, clave, `accessToken` o `refreshToken` en el QR.
- El móvil **no** “empuja” su sesión al TV: solo **aprueba** el código.
- El TV obtiene tokens **propios** al canjear (poll `approved`).

---

## 3. Columna izquierda — login tradicional

Igual que el contrato actual de apps IPTV:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "<linea>",
  "password": "<clave>",
  "deviceId": "<uuid-estable-del-tv>",
  "platform": "tv",
  "deviceName": "Sala LG"
}
```

- Enviar siempre el mismo `deviceId` del televisor.
- Respuesta: `accessToken`, `refreshToken`, `expiresIn`, `tokenType`.
- Guardar tokens y entrar al Home.
- Ante `403` `DEVICE_LIMIT`: mensaje para que el usuario revoque un aparato desde el móvil (o reintente tras liberar cupo).

---

## 4. Columna derecha — código QR (detalle de implementación)

### 4.1 Al mostrar la pantalla (o al enfocar la columna QR)

1. Asegurar `deviceId` persistido (SharedPreferences / localStorage / Keychain TV).
2. Llamar:

```http
POST /api/v1/auth/device-link/session
Content-Type: application/json

{
  "deviceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "platform": "tv",
  "deviceName": "LG Living"
}
```

**Respuesta 200**

```json
{
  "linkCode": "AB3K7N2P",
  "qrPayload": "cotas://device-link?code=AB3K7N2P",
  "expiresIn": 120,
  "pollIntervalMs": 1000,
  "deviceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

3. Generar la imagen QR con el string **exacto** `qrPayload`.
4. Mostrar debajo el `linkCode` en tipografía grande (por si no pueden escanear).
5. Arrancar poll cada `pollIntervalMs` (**1000 ms**; no cachear el código).

### 4.2 Poll mientras el usuario está en la pantalla

```http
GET /api/v1/auth/device-link/session/AB3K7N2P?deviceId=7c9e6679-7425-40de-944b-e07fc1f90ae7
```

`deviceId` **debe** ser el mismo del `POST /session`.

| `status` | UI TV | Acción |
| --- | --- | --- |
| `pending` | “Esperando confirmación en el celular…” | Seguir poll; usar `expiresIn` para countdown |
| `approved` | “¡Conectado!” | Guardar tokens → **Home** (una sola vez llegan tokens) |
| `expired` | “Código vencido” | `POST /session` de nuevo y refrescar QR |
| `denied` | “Rechazado” | Regenerar QR |
| `consumed` | — | Ya se entregaron tokens; si no los tienes, regenerar QR |

**Respuesta `approved` (única entrega de tokens)**

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

A partir de aquí el TV usa el mismo contrato que el login tradicional: Bearer, catálogo, playback, `POST /auth/refresh`.

### 4.3 Si el móvil cierra el TV a distancia

`DELETE /devices/{id}` desde el móvil revoca el dispositivo y sus sesiones.  
El TV empezará a recibir `401` → limpiar tokens y volver a esta pantalla (login | QR).

---

## 5. Ciclo de vida del código (TTL)

| Evento | Tiempo |
| --- | --- |
| Código válido | **120 s** desde `POST /session` |
| Intervalo de poll recomendado | **1000 ms** (`pollIntervalMs`) — no cachear; regenerar si `expired`/`consumed` |
| Tras `approved` | El siguiente poll responde `consumed` (sin tokens) |
| Latencia tras approve en móvil | **≤ 1 s** en el siguiente poll (sin rate-limit en el GET poll) |

---

## 6. Errores

| HTTP / code | Significado | UI |
| --- | --- | --- |
| `404` `DEVICE_LINK_INVALID` | Código malo o `deviceId` distinto | Regenerar QR |
| `410` `DEVICE_LINK_EXPIRED` | Venció (suele verse como `status: expired` en poll) | Regenerar QR |
| `429` | Rate limit | Respetar `pollIntervalMs` |
| `403` `DEVICE_LIMIT` | Solo en login tradicional o si el móvil no pudo aprobar | Mensaje: liberar dispositivo en la app móvil |

---

## 7. Checklist QA TV

- [ ] Layout: **izquierda** login usuario/clave; **derecha** QR + código.
- [ ] Login tradicional con `deviceId` estable funciona.
- [ ] QR se crea al entrar a la pantalla / al regenerar.
- [ ] Tras aprobar en el móvil (&lt; 2 min), el TV entra al Home **sin** teclear clave.
- [ ] Segundo poll del mismo código → `consumed`.
- [ ] Código vencido regenera QR nuevo.
- [ ] Cierre remoto desde móvil → TV a login/QR con 401.
- [ ] QR **no** contiene user/clave/tokens (solo `cotas://device-link?code=…`).

---

## 8. Mensaje corto al equipo TV

> En la pantalla de acceso: login clásico a la izquierda; QR a la derecha. El QR es un código de un solo uso que el móvil aprueba. El TV hace poll y recibe **su** sesión. Luego todo es igual al login normal.
