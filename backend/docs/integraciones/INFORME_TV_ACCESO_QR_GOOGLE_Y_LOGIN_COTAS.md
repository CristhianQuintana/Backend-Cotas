# Informe para desarrolladores de TV — Acceso por QR con Google y LOGIN COTAS

**Destinatarios:** Android TV / Google TV (Kotlin), Samsung Tizen, LG webOS, Fire TV y cualquier otra app de televisor  
**Base de producción:** `https://api.cotasperu.com/api/v1`  
**Fecha:** 2026-11-18  
**Estado backend:** desplegado y verificado en el entorno de pruebas  
**Documentos relacionados:** `tv-qr-auth-android-tv.md` (contrato detallado del QR), `guia-plataformas-api-publica.md` (catálogo, reproducción, errores), `INFORME_AUTH_GOOGLE_PLATAFORMAS.md` (Google en apps móviles)

> Usen este documento como fuente única. No inventen rutas ni campos. Si algo no está aquí o en OpenAPI (`npm run openapi:export` → `backend/openapi/openapi.json`), pregunten antes de asumir.

---

## 1. Qué hay que implementar (resumen)

| # | Función | Estado | Acción en la app de TV |
| --- | --- | --- | --- |
| 1 | **Login por QR con Google** (escanear con el celular, iniciar sesión con Google, confirmar) | **Nuevo** | Implementar completo (secciones 4 y 5) |
| 2 | **LOGIN COTAS** (usuario + clave de la línea IPTV) | Existente, ahora **solo desde la red corporativa** | Mantener; manejar el `403 LOGIN_NETWORK_RESTRICTED` (sección 3) |
| 3 | Login por correo + contraseña COTAS | Existente | Sin cambios |
| 4 | Login por código QR desde la app móvil COTAS (`device-link`) | Existente | Sin cambios; coexiste con el nuevo QR |
| 5 | **STREAM CODE** (Xtream directo al proveedor) | Existente | **No tocar**: funciona desde cualquier red |

Todas las vías de COTAS terminan igual: el TV tiene **su propia sesión** (`accessToken` + `refreshToken`) y **su propio registro de dispositivo**. Nunca se comparten tokens con el celular.

### Pantalla de acceso recomendada

```
┌───────────────────────────────┬───────────────────────────────┐
│ Iniciar sesión                │ Inicia sesión con tu celular   │
│  Usuario  [____________]      │        ┌─────────────┐         │
│  Clave    [____________]      │        │     QR      │         │
│  [ Entrar ]                   │        └─────────────┘         │
│  (LOGIN COTAS / correo)       │  Escanéalo y entra con Google  │
│  [ STREAM CODE ]              │  Vence en 2:59   [ Renovar ]   │
└───────────────────────────────┴───────────────────────────────┘
```

---

## 2. Configuración obligatoria

```text
API_BASE_URL = https://api.cotasperu.com/api/v1
```

- **Una sola URL**, solo HTTPS, con validación de certificado del sistema (sin TrustManager permisivo ni `usesCleartextTraffic` en release).
- **Prohibido** en producción: IPs privadas (`10.10.0.31`, `192.168.x.x`), `localhost`, `:3100`.
- **No enviar ni modificar `X-Forwarded-For` / `X-Real-IP`.** El servidor determina la red de origen; la app no debe intentar “ayudar”.
- Centralicen la URL en una constante/BuildConfig.
- Tizen/webOS: permitir `https://api.cotasperu.com` en `access`/CSP. El backend ya configura CORS para las apps web.
- Cuerpos JSON con `Content-Type: application/json` (cualquier otro tipo recibe `415`). En POST sin datos envíen `{}`.
- Identificar la app con un `User-Agent` propio y estable (ej. `CotasTV/1.4.0 (AndroidTV 12; Sony BRAVIA)`).

### `deviceId` e identidad del televisor

- Generen un **UUID v4 la primera vez** que se ejecuta la app y guárdenlo en almacenamiento persistente. Debe ser **estable** entre reinicios y actualizaciones.
- Es el identificador del aparato en el cupo de dispositivos (`GET /devices`). Si cambia en cada arranque, el usuario agotará su cupo.
- Formato permitido: 8–128 caracteres `[0-9A-Za-z._:-]`. No usen datos personales ni el serial de fábrica en claro.
- `platform` recomendado: `android-tv`, `tizen`, `webos`, `fire-tv` (el backend lo normaliza a `TV`).
- `deviceName`: nombre **reconocible por una persona** (marca + modelo + ubicación si existe, p. ej. `Sala - Sony Bravia`). Es lo que el usuario ve en el celular al confirmar y en su lista de dispositivos. No pongan nombres genéricos.

---

## 3. LOGIN COTAS y restricción de red

### 3.1 Comportamiento

`POST /auth/login` con un usuario **sin `@`** (línea IPTV COTAS) solo se acepta desde la **red corporativa de COTAS**. La app **sigue usando la URL pública**; el servidor decide por la red de origen:

| Origen del TV | Resultado de `POST /auth/login` (usuario de línea) |
| --- | --- |
| Red corporativa de COTAS | Se procesa normal (200 / 401 según credenciales) |
| Cualquier otra red (casa del cliente, datos móviles) | `403` `LOGIN_NETWORK_RESTRICTED` |

No cambia para: login por correo (`username` con `@`), Google, login por QR (ambos), STREAM CODE, refresh, catálogo, reproducción.

### 3.2 Qué debe hacer la app

1. Enviar el login **siempre** contra `API_BASE_URL`. **No** intentar IP privada, reintentar con otra URL, ni “saltarse” el 403.
2. Ante `403 LOGIN_NETWORK_RESTRICTED`: mostrar un mensaje claro y ofrecer las alternativas disponibles:

   > “Este acceso solo está disponible desde la red de COTAS. Inicia sesión con el código QR (Google) o con tu correo, o usa STREAM CODE.”

3. No tratar el 403 como credenciales incorrectas: **no** contar el intento, **no** borrar el usuario escrito, **no** reintentar en bucle.
4. Credenciales incorrectas siguen siendo `401 INVALID_CREDENTIALS`.

### 3.3 Cómo probar en la red corporativa

- El tráfico de la oficina sale a Internet con una IP pública de la empresa; el backend la tiene autorizada. Desde un TV conectado a esa red, `POST /auth/login` con una línea válida debe responder `200`.
- Si en una red corporativa responde `403`, **no cambien la app**: avisen a backend con la hora aproximada y el `correlationId` de la respuesta (viene en el cuerpo de error y en la cabecera `x-correlation-id`). Backend puede ver qué origen vio el servidor y ampliar el rango.

---

## 4. Login por QR con Google (nuevo)

### 4.1 Idea

El TV muestra un QR. El usuario lo escanea con la cámara del celular → se abre una página web de COTAS → inicia sesión con Google → ve **qué televisor** pide acceso y **qué cuenta** se vinculará → pulsa **Autorizar**. El TV, que consulta el estado cada 2 s, recibe sus credenciales una única vez.

```
 TV                                  API COTAS                          Celular
 ──                                  ─────────                          ───────
 1 POST /auth/tv/qr/session ────────► crea sesión PENDING
   ◄── sessionId, authorizationUrl, pollSecret, expiresIn
 2 dibuja QR(authorizationUrl)
 3 GET .../status (Bearer pollSecret) ► PENDING        (cada 2 s)
                                                          4 escanea QR → abre la página
                                                          5 Google Sign-In
                                                          6 ve TV + cuenta → Autorizar
 7 GET .../status ───────────────────► AUTHORIZED + tokens (UNA vez)
 8 guarda tokens → Home
```

**Reglas de seguridad (no negociables)**

- El QR codifica **exactamente** `authorizationUrl`. Nada más. **Nunca** tokens, usuario, clave ni `pollSecret`.
- `pollSecret` solo existe en la memoria del TV: no se muestra, no se loguea, no se guarda en disco, no va en el QR.
- El TV nunca ve ni maneja el ID token de Google; eso ocurre solo en el celular.

### 4.2 Crear la sesión

```http
POST /auth/tv/qr/session
Content-Type: application/json

{
  "deviceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "platform": "android-tv",
  "deviceName": "Sala - Sony Bravia"
}
```

`200`:

```json
{
  "sessionId": "0f0a6c0e-6e0c-4c7b-9a54-3d1f2f0a9b11",
  "status": "PENDING",
  "code": "x7Qe…",
  "authorizationUrl": "https://api.cotasperu.com/api/v1/auth/tv/qr/authorize/0f0a6c0e-…#c=x7Qe…",
  "pollSecret": "Zk3w…",
  "expiresAt": "2026-11-18T15:03:00.000Z",
  "expiresIn": 180,
  "pollIntervalMs": 2000
}
```

- Dibujen `authorizationUrl` como QR (nivel de corrección M o superior, tamaño mínimo recomendado 300×300 px en pantalla de TV, margen blanco de 4 módulos, alto contraste).
- Respeten `expiresIn` y `pollIntervalMs` **de la respuesta** (hoy 180 s y 2000 ms; pueden cambiar sin aviso).
- Crear una sesión nueva con el mismo `deviceId` **invalida la anterior** automáticamente (`CANCELLED` / `superseded`).
- Límite por IP: unas 10 creaciones por minuto. No creen sesiones en bucle; usen un botón “Renovar” y renueven solo al expirar.

### 4.3 Consultar el estado (sondeo)

```http
GET /auth/tv/qr/session/{sessionId}/status
Authorization: Bearer <pollSecret>
```

(Aquí `Authorization` lleva el `pollSecret`, no un token de usuario.)

| `status` | Significado | Qué hacer en la UI |
| --- | --- | --- |
| `PENDING` | Esperando al usuario. `{ status, expiresAt, expiresIn }` | Mantener el QR y mostrar cuenta atrás |
| `AUTHORIZED` | El usuario confirmó | Ver 4.4 |
| `EXPIRED` | Venció (`reason`: `expired` o `delivery_expired`) | “El código expiró” → crear sesión nueva |
| `CANCELLED` | Cancelada (`user_cancelled` o `superseded`) | Si fue por otra sesión del mismo TV, ignorar; si no, renovar |
| `REJECTED` | El usuario rechazó (`user_rejected`) o se bloqueó (`too_many_attempts`) | “Solicitud rechazada” → ofrecer renovar |

Sondeo: usar un **temporizador fijo** (`pollIntervalMs`), una sola petición en vuelo a la vez, parar al llegar a un estado terminal o al salir de la pantalla. No acelerar el ritmo.

### 4.4 Recibir las credenciales (una sola vez)

Primera respuesta con `AUTHORIZED`:

```json
{
  "status": "AUTHORIZED",
  "credentialsDelivered": false,
  "tokenType": "Bearer",
  "accessToken": "eyJ…",
  "refreshToken": "…",
  "expiresIn": 900,
  "device": { "id": "uuid", "deviceName": "Sala - Sony Bravia", "platform": "TV" },
  "account": { "displayName": "Ana Pérez" }
}
```

- **Guarden `accessToken` y `refreshToken` de inmediato**, antes de dibujar nada.
- Cualquier sondeo posterior devuelve `{ "status": "AUTHORIZED", "credentialsDelivered": true }` **sin tokens**. Si el TV no pudo guardar la primera respuesta (corte de red, cierre de la app), debe **iniciar una sesión QR nueva**; no hay forma de recuperar los tokens de la anterior.
- Si el TV no consulta en los **120 s** posteriores a la autorización, el estado pasa a `EXPIRED` (`delivery_expired`) y se debe repetir el flujo.
- Con la sesión creada, vayan al Home y usen la API como cualquier otro login.

### 4.5 Cancelar (opcional pero recomendado)

```http
POST /auth/tv/qr/session/{sessionId}/cancel
Authorization: Bearer <pollSecret>
Content-Type: application/json

{}
```

`200 { "status": "CANCELLED" }`. Idempotente. Llámenlo al salir de la pantalla del QR sin haber entrado.

### 4.6 Lo que ve el usuario en el celular (para soporte y diseño)

1. Abre la URL; la página muestra el **nombre del TV**, tipo y la red de origen aproximada, con tiempo restante.
2. Botón de Google. Al elegir cuenta se muestra **la cuenta COTAS** que se vinculará (nombre y correo).
3. Botones **Autorizar este televisor** / **Rechazar**.
4. Mensaje final: “Listo. Tu televisor iniciará sesión en unos segundos.”

Consecuencias para la app de TV:

- Pongan texto de ayuda como: “Escanea el código con la cámara de tu celular. No necesitas instalar nada.”
- El `deviceName` que envíen es lo único que el usuario tiene para reconocer su TV: que sea claro.
- **La cuenta de Google debe estar ya vinculada a una cuenta COTAS** (haber iniciado sesión con Google al menos una vez en la app móvil de COTAS, o haber vinculado Google desde `/auth/google/link`). Este flujo **no crea cuentas nuevas**. Si no lo está, la página muestra: *“No existe una cuenta COTAS vinculada a esta cuenta de Google. Inicie sesión una vez con Google en la app COTAS.”* Añadan ese consejo a la pantalla de ayuda del TV.
- Las cuentas de personal (operador/administrador) no pueden autorizar televisores por esta vía.

### 4.7 Errores relevantes para el TV

Formato estándar de error: `{ "statusCode": 404, "code": "TV_QR_INVALID", "message": "…", "correlationId": "…" }`.

| HTTP | `code` | Cuándo | Acción del TV |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `deviceId`/`platform`/`deviceName` con formato inválido | Corregir; es un bug de la app |
| 401 | `UNAUTHORIZED` | Falta `Authorization: Bearer <pollSecret>` | Bug de la app |
| 404 | `TV_QR_INVALID` | `sessionId` desconocido o `pollSecret` incorrecto | Crear sesión nueva |
| 429 | (límite) | Demasiadas peticiones desde la misma red | Esperar y reintentar con espera creciente (backoff) |
| 503 | `DEPENDENCY_UNAVAILABLE` | Google Sign-In / URL pública no configurados | “Servicio no disponible”, reintento manual |
| red / timeout | — | Sin conexión | Mantener el QR si aún no expira y seguir sondeando; mostrar aviso discreto |

Los errores `TV_QR_EXPIRED`, `TV_QR_CLOSED`, `TV_QR_LOCKED`, `TV_QR_ACCOUNT_NOT_FOUND`, `ACCOUNT_LINK_REQUIRED`, `GOOGLE_TOKEN_INVALID` y `DEVICE_LIMIT` ocurren en el **celular** (página web); el TV solo ve el resultado como estado (`REJECTED`, `EXPIRED`…) o como que la sesión sigue `PENDING`. Detalle completo en `tv-qr-auth-android-tv.md`.

---

## 5. Después de iniciar sesión (todas las vías)

### 5.1 Uso de tokens

```http
Authorization: Bearer <accessToken>
```

- `accessToken` dura `expiresIn` segundos (hoy 900). Renueven **antes** de expirar o al primer `401`.
- Renovación:

  ```http
  POST /auth/refresh
  Content-Type: application/json

  { "refreshToken": "<refreshToken>" }
  ```

  Responde `{ accessToken, refreshToken, expiresIn }`. **El refresh token rota**: guarden **el nuevo** y descarten el anterior. Reusar uno viejo revoca toda la sesión por seguridad.
- Serialicen los refresh: una sola renovación en vuelo; las demás peticiones esperan su resultado (si dos renuevan a la vez, una invalida a la otra).
- Si el refresh falla con `401`: sesión terminada → volver a la pantalla de acceso.
- Cierre de sesión: `POST /auth/logout` (Bearer, `204`) y borrar los tokens locales.

### 5.2 Cupo de dispositivos

- Cada TV autorizado ocupa **un dispositivo** de la cuenta. El cupo es `maxConnections` de la línea.
- `GET /auth/me` → `connectedSessions` / `maxDevices` (mostrar “x/y”). `GET /devices` → `used`, `limit`, `items`. `DELETE /devices/{id}` cierra un dispositivo.
- **El acceso con Google/QR no se bloquea por cupo.** Si el cupo está lleno al autorizar, el TV nuevo entra y el servidor cierra el dispositivo visto hace más tiempo (con sus sesiones; ese aparato recibirá `401`/`403` en su siguiente llamada). `DEVICE_LIMIT` ya no se devuelve en este flujo.
- Si el TV ya autenticado es expulsado (otro dispositivo lo desplazó o el usuario lo cerró), sus llamadas darán `401`/`403`: volver al acceso con un mensaje claro.

### 5.3 Catálogo y reproducción

Sin cambios: ver `guia-plataformas-api-publica.md` (`/catalog/*`, `POST /playback/authorizations`, usar exactamente `streamUrl`).

Una cuenta recién vinculada puede no tener aún línea IPTV asociada: `GET /auth/session` puede devolver `subscription: null`. Manejen ese caso con un mensaje (“Tu cuenta no tiene una suscripción activa”) en vez de un error genérico.

---

## 6. Almacenamiento y seguridad en el TV

| Dato | Dónde | Reglas |
| --- | --- | --- |
| `accessToken` | Memoria | Nunca a disco ni a logs |
| `refreshToken` | Almacenamiento seguro del sistema (Android: EncryptedSharedPreferences/Keystore; Tizen/webOS: almacenamiento seguro de la plataforma) | Rotar en cada refresh; borrar al cerrar sesión |
| `pollSecret` | Solo memoria, mientras dure la pantalla del QR | Nunca loguear, nunca en el QR |
| `deviceId` | Persistente | Estable; no es secreto |

- No registren en logs: tokens, `pollSecret`, `code`, `authorizationUrl` completa (lleva el código en `#c=`), contraseñas.
- No capturen ni almacenen en caché las respuestas de `/auth/*`. El servidor ya responde con `Cache-Control: no-store`.
- No abran `authorizationUrl` dentro del propio TV con un WebView: el flujo está pensado para el **celular**.
- TLS: validación estándar del sistema. Si hacen *certificate pinning*, fijen la clave pública (no el certificado) y prevean rotación.

---

## 7. Código de referencia

### 7.1 Kotlin (Android TV, esquema)

```kotlin
class TvQrLogin(
    private val api: CotasAuthApi,       // Retrofit: createQrSession, qrStatus, cancelQr
    private val store: SecureSessionStore,
    private val deviceId: String,
) {
    suspend fun run(onQr: (String, Int) -> Unit): LoginResult {
        while (true) {
            val s = api.createQrSession(CreateQr(deviceId, "android-tv", deviceName()))
            onQr(s.authorizationUrl, s.expiresIn)                      // dibuja/renueva el QR
            val deadline = SystemClock.elapsedRealtime() + s.expiresIn * 1000L
            try {
                while (SystemClock.elapsedRealtime() < deadline + 5_000) {
                    delay(s.pollIntervalMs.toLong())
                    val r = runCatching { api.qrStatus(s.sessionId, "Bearer ${s.pollSecret}") }
                        .getOrNull() ?: continue                       // sin red: seguir intentando
                    when (r.status) {
                        "AUTHORIZED" -> {
                            if (r.credentialsDelivered) break          // perdimos los tokens: nueva sesión
                            store.save(r.accessToken!!, r.refreshToken!!, r.device!!.id)
                            return LoginResult.Success(r.account?.displayName)
                        }
                        "REJECTED" -> return LoginResult.Rejected      // mostrar mensaje; botón Renovar
                        "EXPIRED", "CANCELLED" -> break                // crear otra sesión
                        else -> Unit                                   // PENDING
                    }
                }
            } finally {
                runCatching { api.cancelQr(s.sessionId, "Bearer ${s.pollSecret}", emptyMap<String, String>()) }
            }
        }
    }
}
```

Notas: la corrutina debe cancelarse al salir de la pantalla (el `finally` cancela la sesión); no creen un `while(true)` sin respetar el ciclo de vida.

### 7.2 JavaScript (Tizen / webOS, esquema)

```js
async function tvQrLogin(api, deviceId, onQr) {
  for (;;) {
    const s = await api.post('/auth/tv/qr/session', { deviceId, platform: 'tizen', deviceName: deviceLabel() });
    onQr(s.authorizationUrl, s.expiresIn);
    const deadline = Date.now() + s.expiresIn * 1000 + 5000;
    while (Date.now() < deadline) {
      await sleep(s.pollIntervalMs);
      let r;
      try { r = await api.get(`/auth/tv/qr/session/${s.sessionId}/status`, { Authorization: `Bearer ${s.pollSecret}` }); }
      catch { continue; }                                   // sin red: seguir
      if (r.status === 'AUTHORIZED') {
        if (r.credentialsDelivered) break;                  // tokens perdidos: nueva sesión
        await secureStore.save(r);                          // guardar ANTES de cambiar de pantalla
        return { ok: true, name: r.account && r.account.displayName };
      }
      if (r.status === 'REJECTED') return { ok: false, reason: 'rejected' };
      if (r.status === 'EXPIRED' || r.status === 'CANCELLED') break;
    }
  }
}
```

### 7.3 Prueba rápida con `curl`

```bash
BASE=https://api.cotasperu.com/api/v1
curl -s -X POST $BASE/auth/tv/qr/session -H 'Content-Type: application/json' \
  -d '{"deviceId":"test-tv-0001","platform":"android-tv","deviceName":"TV de prueba"}'
# → copiar sessionId y pollSecret
curl -s $BASE/auth/tv/qr/session/<sessionId>/status -H "Authorization: Bearer <pollSecret>"
```

---

## 8. Casos de prueba obligatorios antes de publicar

| # | Caso | Resultado esperado |
| --- | --- | --- |
| 1 | Crear sesión y mostrar QR | QR legible desde 3 m; cuenta atrás visible |
| 2 | Escanear, Google, Autorizar | El TV entra al Home en ≤ 3 s tras pulsar Autorizar |
| 3 | Sondeos tras la entrega | Solo la primera respuesta trae tokens; la app no depende de recibirlos de nuevo |
| 4 | Dejar vencer el QR | La app crea uno nuevo sola o con botón “Renovar”, sin errores |
| 5 | Rechazar desde el celular | El TV muestra “Solicitud rechazada” y permite renovar |
| 6 | Salir de la pantalla del QR | Se llama a `/cancel`; no queda sondeo en segundo plano |
| 7 | Apagar la red 20 s con el QR visible | La app sigue sondeando al volver la red; no se rompe |
| 8 | Dos TV a la vez con la misma cuenta | Cada uno recibe sus propios tokens; ambos aparecen en `GET /devices` |
| 9 | Reiniciar la app tras iniciar sesión | Mantiene la sesión con el refresh token guardado |
| 10 | Refresh con rotación | Se guarda el token nuevo; dos refresh simultáneos no ocurren |
| 11 | Cuenta Google sin cuenta COTAS | El celular muestra el mensaje; el TV sigue `PENDING` hasta expirar |
| 12 | LOGIN COTAS desde fuera de la red corporativa | `403 LOGIN_NETWORK_RESTRICTED` con mensaje y alternativas (no “clave incorrecta”) |
| 13 | LOGIN COTAS desde la red corporativa | Entra con normalidad |
| 14 | STREAM CODE | Sigue funcionando desde cualquier red (no se tocó) |
| 15 | Cupo de dispositivos lleno | El TV no entra hasta liberar uno; mensaje claro |

---

## 9. Qué no hacer

- No meter tokens, usuario, clave ni `pollSecret` en el QR ni en la URL.
- No volver a pedir las credenciales de una sesión ya entregada (no se puede).
- No usar IPs privadas ni cambiar de URL para “probar suerte” con LOGIN COTAS.
- No falsificar ni enviar `X-Forwarded-For`.
- No sondear más rápido que `pollIntervalMs` ni crear sesiones QR en bucle.
- No abrir la página de autorización dentro del propio TV.
- No usar el ID token de Google como Bearer de COTAS.
- No tocar STREAM CODE ni el flujo `device-link` existente salvo para coexistir con el nuevo QR.

---

## 10. Dependencias y pendientes fuera del código de la app

| Tema | Responsable | Estado |
| --- | --- | --- |
| Backend `tv-auth` desplegado | Backend | Hecho (pruebas) |
| Origen `https://api.cotasperu.com` en *Authorized JavaScript origins* del Client ID **web** de Google | Administrador de Google Cloud | **Pendiente de confirmar**: sin esto el botón de Google de la página muestra error de origen no autorizado |
| Prueba extremo a extremo con celular y TV reales | Equipo TV + QA | Pendiente (el backend se verificó por HTTP y con pruebas automáticas) |
| Cuentas de prueba con Google vinculado a COTAS | QA | Pendiente |

## 11. Referencias

- Contrato detallado del QR: `docs/integraciones/tv-qr-auth-android-tv.md`
- Guía general de plataformas: `docs/integraciones/guia-plataformas-api-publica.md`
- Auth Google en móviles: `docs/integraciones/INFORME_AUTH_GOOGLE_PLATAFORMAS.md`
- Cuenta/dispositivos: `docs/integraciones/cuenta-y-notificaciones.md`
- Restricción de red de LOGIN COTAS (operación): `docs/operacion/login-cotas-red-corporativa.md`
- OpenAPI: `backend/openapi/openapi.json`
