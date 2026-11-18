# Login por QR en Android TV (módulo `tv-auth`)

Contrato para las apps de televisión (Android TV, Tizen, webOS, Fire TV). El usuario escanea un QR con su
celular, inicia sesión con Google en una página web de COTAS, confirma y el televisor recibe credenciales
**propias** (sesión + dispositivo independientes del celular).

- Base de la API: `https://api.cotasperu.com/api/v1`
- Todas las rutas del televisor son HTTPS, JSON, sin cabecera `Authorization` de usuario.
- El QR **nunca** contiene tokens de acceso.
- No sustituye a LOGIN COTAS, STREAM CODE ni al login por código `auth/device-link`.

## Resumen del flujo

```
TV                                   Backend                         Celular
 │ POST /auth/tv/qr/session ───────────►│ crea sesión (PENDING)
 │◄─ sessionId, authorizationUrl,       │
 │   pollSecret, expiresIn, ...         │
 │ muestra QR(authorizationUrl)         │                                  │ escanea el QR
 │                                      │◄──── GET página /authorize/:id ──│
 │                                      │      (Google Sign-In + confirmar)│
 │ GET .../status (Bearer pollSecret) ─►│ PENDING … cada 2 s               │ Autorizar
 │◄─ AUTHORIZED + tokens (UNA vez) ─────│◄──── POST .../authorize ─────────│
```

## 1. Crear la sesión

`POST /auth/tv/qr/session` — público, limitado por IP (10/min por ruta).

```json
{ "deviceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "platform": "android-tv", "deviceName": "Sala - Sony Bravia" }
```

| Campo        | Reglas                                                                                 |
| ------------ | -------------------------------------------------------------------------------------- |
| `deviceId`   | 8–128 caracteres `[0-9A-Za-z._:-]`. UUID estable de instalación (guárdalo localmente). |
| `platform`   | Opcional. `android-tv`, `tizen`, `webos`, `fire-tv`… (se normaliza a `TV`).            |
| `deviceName` | Opcional, ≤ 80. Es lo que el usuario ve en el celular al confirmar: pon algo reconocible. |

Respuesta `200`:

```json
{
  "sessionId": "0f0a6c0e-6e0c-4c7b-9a54-3d1f2f0a9b11",
  "status": "PENDING",
  "code": "x7Qe...43 caracteres...",
  "authorizationUrl": "https://api.cotasperu.com/api/v1/auth/tv/qr/authorize/0f0a6c0e-...#c=x7Qe...",
  "pollSecret": "Zk3w...43 caracteres...",
  "expiresAt": "2026-11-18T15:03:00.000Z",
  "expiresIn": 180,
  "pollIntervalMs": 2000
}
```

- **Dibuja `authorizationUrl` como QR.** El código viaja en el fragmento (`#c=`) y el navegador no lo envía al servidor.
- **`pollSecret` solo lo conoce el televisor.** Nunca lo muestres ni lo pongas en el QR. Autentica el sondeo y la cancelación.
- `expiresIn` (por defecto 180 s) es configurable en el servidor: léelo siempre de la respuesta.
- Crear una sesión nueva con el mismo `deviceId` **cancela** la anterior (`CANCELLED`, motivo `superseded`).
- Cuando falten pocos segundos, o al recibir `EXPIRED`, crea una sesión nueva y redibuja el QR.

## 2. Consultar el estado (sondeo)

`GET /auth/tv/qr/session/:sessionId/status` con `Authorization: Bearer <pollSecret>`. Sondea cada `pollIntervalMs`
(2 s). Sin cabecera → `401`; secreto equivocado o sesión inexistente → `404 TV_QR_INVALID`.

| `status`     | Significado                                | Respuesta                                                        |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| `PENDING`    | Esperando al usuario                       | `{ status, expiresAt, expiresIn }`                               |
| `AUTHORIZED` | Usuario confirmó                           | credenciales **una sola vez** (ver abajo)                        |
| `EXPIRED`    | Venció el tiempo (o no se retiraron las credenciales en 120 s) | `{ status, reason }` (`expired` / `delivery_expired`) |
| `CANCELLED`  | Cancelada (TV o reemplazada)               | `{ status, reason }` (`user_cancelled` / `superseded`)           |
| `REJECTED`   | El usuario rechazó o se bloqueó por intentos | `{ status, reason }` (`user_rejected` / `too_many_attempts`)   |

Primera respuesta con `AUTHORIZED` (guárdala de inmediato):

```json
{
  "status": "AUTHORIZED",
  "credentialsDelivered": false,
  "tokenType": "Bearer",
  "accessToken": "eyJ...",
  "refreshToken": "…",
  "expiresIn": 900,
  "device": { "id": "uuid", "deviceName": "Sala - Sony Bravia", "platform": "TV" },
  "account": { "displayName": "Ana Pérez" }
}
```

Los sondeos siguientes devuelven `{ "status": "AUTHORIZED", "credentialsDelivered": true }` **sin tokens**: si no guardaste
las primeras credenciales, inicia una sesión QR nueva. Con sondeos simultáneos solo uno recibe los tokens.

A partir de aquí el televisor usa la API como cualquier app: `Authorization: Bearer <accessToken>`, `POST /auth/refresh`
con `refreshToken` (rotación), `POST /auth/logout`. El televisor aparece en `GET /devices` con su `deviceName` y cuenta
para el límite de dispositivos de la línea.

## 3. Cancelar (opcional)

`POST /auth/tv/qr/session/:sessionId/cancel` con `Authorization: Bearer <pollSecret>` → `200 { "status": "CANCELLED" }`.
Idempotente. Úsalo al salir de la pantalla del QR.

## Endpoints del celular (los usa la página web; documentados por completitud)

Públicos, con límite por IP, y siempre exigen el `code` del QR.

| Endpoint                                   | Cuerpo                | Función                                                      |
| ------------------------------------------ | --------------------- | ------------------------------------------------------------ |
| `GET /auth/tv/qr/authorize/:sessionId`     | —                     | Página HTML (CSP con nonce). El código va en `#c=`.          |
| `POST /auth/tv/qr/session/:id/info`        | `{ code }`            | Datos del TV (nombre, tipo, red enmascarada, tiempo restante) |
| `POST /auth/tv/qr/session/:id/identify`    | `{ code, idToken }`   | Valida el ID token de Google y muestra la cuenta (no autoriza) |
| `POST /auth/tv/qr/session/:id/authorize`   | `{ code, idToken }`   | **Confirmación explícita**: vincula la cuenta con ese TV     |
| `POST /auth/tv/qr/session/:id/reject`      | `{ code }`            | El usuario rechaza → `REJECTED`                              |

### Validación de identidad Google

La página obtiene un ID token con Google Identity Services y el backend lo valida con **el mismo verificador y la misma
lista de audiencias que `POST /auth/google`**, y la misma tabla de identidades. Diferencias deliberadas, para no tocar
`/auth/google` ni la gestión de dispositivos:

- No crea una sesión de navegador ni consume/desplaza cupo de dispositivos del usuario por abrir la página.
- **No crea cuentas.** Si la cuenta de Google no está vinculada a una cuenta COTAS → `404 TV_QR_ACCOUNT_NOT_FOUND`
  (el usuario debe iniciar sesión una vez con Google en la app COTAS). Si el correo existe sin vincular → `409 ACCOUNT_LINK_REQUIRED`.
- Cuentas de personal (`OPERATOR`/`ADMIN`) no pueden autorizar televisores por esta vía (`403`): exigen MFA.

## Seguridad

| Control                | Implementación                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Expiración automática  | `TV_QR_TTL_SECONDS` (180). Estados `EXPIRED` al consultar/usar; ventana de 120 s para retirar credenciales. |
| Código de un solo uso  | 192 bits aleatorios, guardado como SHA-256. Autorizar es compare-and-set: solo una petición gana.        |
| Anti-reutilización     | Una vez `AUTHORIZED/REJECTED/CANCELLED/EXPIRED` el código ya no sirve (`409 TV_QR_CLOSED`).              |
| Entrega única          | Credenciales emitidas al sondeo autenticado con `pollSecret`; marca de entrega atómica.                  |
| Aislamiento entre TVs  | Cada sesión tiene su `pollSecret`, `code`, `deviceId`, sesión y tokens propios; el QR de un TV no sirve en otro. |
| Intentos               | `TV_QR_MAX_ATTEMPTS` (5) códigos erróneos → sesión `REJECTED` (`429 TV_QR_LOCKED`) + limitador por IP.   |
| Secretos en reposo     | `code` y `pollSecret` solo como hash; el fragmento `#c=` no llega a logs del servidor.                   |

Riesgo conocido (inherente a este tipo de flujo): alguien podría pedir a una víctima que escanee **su** QR. Por eso la
página muestra el nombre del televisor y exige confirmación; usa un `deviceName` claro en la app.

## Errores

Formato estándar `{ statusCode, code, message, correlationId }`.

| HTTP | `code`                    | Cuándo                                                              |
| ---- | ------------------------- | ------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`        | Cuerpo/parámetros inválidos                                         |
| 401  | `UNAUTHORIZED`            | Falta `Authorization: Bearer <pollSecret>`                          |
| 401  | `GOOGLE_TOKEN_INVALID`    | ID token de Google inválido o de otra audiencia                     |
| 403  | `DEVICE_LIMIT`            | Cupo de dispositivos lleno (la sesión sigue `PENDING`, reintentable) |
| 404  | `TV_QR_INVALID`           | Sesión inexistente, secreto o código incorrecto                     |
| 404  | `TV_QR_ACCOUNT_NOT_FOUND` | Cuenta Google sin cuenta COTAS vinculada                            |
| 409  | `TV_QR_CLOSED`            | La sesión ya no está pendiente (código ya usado, cancelada…)        |
| 409  | `ACCOUNT_LINK_REQUIRED`   | El correo existe pero sin vincular a Google                         |
| 410  | `TV_QR_EXPIRED`           | La sesión venció                                                    |
| 429  | `TV_QR_LOCKED`            | Demasiados códigos erróneos                                         |
| 503  | `DEPENDENCY_UNAVAILABLE`  | Google Sign-In o la URL pública no están configurados               |

## Ejemplo (Kotlin, esquema)

```kotlin
val s = api.createQrSession(CreateQr(deviceId, "android-tv", "Sala - Sony Bravia"))
showQr(s.authorizationUrl)
while (now() < s.expiresAtMillis) {
    delay(s.pollIntervalMs)
    val r = api.qrStatus(s.sessionId, "Bearer ${s.pollSecret}")
    when (r.status) {
        "AUTHORIZED" -> if (!r.credentialsDelivered) { saveSession(r); goHome(); return }
        "EXPIRED", "CANCELLED", "REJECTED" -> break   // mostrar mensaje y crear otra sesión
    }
}
```

## Operación

Variables (entorno del servidor): `TV_QR_PUBLIC_BASE_URL` (HTTPS público), `TV_QR_GOOGLE_CLIENT_ID` (Client ID **web**,
debe estar en `GOOGLE_OAUTH_CLIENT_IDS`), `TV_QR_TTL_SECONDS`, `TV_QR_MAX_ATTEMPTS`.

**Requisito en Google Cloud (manual):** en el Client ID web, añade `https://api.cotasperu.com` a *Authorized JavaScript
origins*. Sin eso el botón de Google de la página muestra error de origen no autorizado.

Tabla `tv_qr_sessions` (migración `20261118120000_tv_qr_sessions`): las filas cerradas se conservan como historial
(solo hashes, sin tokens).
