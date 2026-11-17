# Informe para plataformas — Auth COTAS (correo + Google) e IPTV multi-servidor

**Fecha:** 2026-11-17  
**Destinatarios:** Android TV, Samsung Smart TV, tercera aplicación  
**Base producción:** `https://api.cotasperu.com/api/v1`  
**OpenAPI:** `/api/docs` (fuera de production o con `SWAGGER_ENABLED=true`)  
**Colección:** `docs/integraciones/postman/cotas-auth-google.postman_collection.json`

---

## 1. Contrato de autenticación COTAS

Ambos métodos terminan en **sesión COTAS** (JWT access + refresh opaco).  
**Prohibido** usar el Google ID token como Bearer en endpoints protegidos.

### 1.1 Login correo / contraseña

```http
POST /auth/login
Content-Type: application/json

{
  "username": "usuario@correo.com",
  "password": "<clave>",
  "deviceId": "<uuid-estable>",
  "platform": "android"
}
```

- Si `username` contiene `@`, el backend autentica contra cuenta local (Argon2).
- Sin `@`, se conserva el **login normal XUI** (línea IPTV COTAS) — no modificar ese flujo en apps legacy.

Registro de cuenta email (opcional, si el producto lo habilita):

```http
POST /auth/register
{
  "email": "usuario@correo.com",
  "password": "<min 12 chars>",
  "displayName": "Nombre",
  "deviceId": "...",
  "platform": "android"
}
```

### 1.2 Login Google

```http
POST /auth/google
{
  "idToken": "<GOOGLE_ID_TOKEN>",
  "deviceId": "<uuid-estable>",
  "platform": "android"
}
```

Respuesta exitosa (mismo formato que login):

```json
{
  "type": "authenticated",
  "accessToken": "<COTAS_JWT>",
  "refreshToken": "<COTAS_REFRESH>",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

Vinculación cuando el correo ya existe:

```http
POST /auth/google/link
{
  "idToken": "<GOOGLE_ID_TOKEN>",
  "password": "<clave-cuenta-cotas>",
  "deviceId": "...",
  "platform": "android"
}
```

### 1.3 Sesión

| Método | Ruta | Uso |
| --- | --- | --- |
| POST | `/auth/refresh` | Renovar con `refreshToken` |
| POST | `/auth/logout` | Revocar sesión (Bearer) |
| GET | `/auth/me` | Perfil |
| GET | `/auth/session` | Perfil + abono (si hay línea XUI) |

---

## 2. Códigos de error relevantes

| Código | HTTP | Significado |
| --- | --- | --- |
| `INVALID_CREDENTIALS` | 401 | Login fallido (mensaje genérico) |
| `GOOGLE_TOKEN_INVALID` | 401 | ID token inválido, expirado, firma/aud/iss incorrectos |
| `GOOGLE_EMAIL_UNVERIFIED` | 401 | Correo Google no verificado |
| `ACCOUNT_LINK_REQUIRED` | 409 | Usar `/auth/google/link` con contraseña |
| `IDENTITY_CONFLICT` | 409 | Identidad Google ya ligada a otra cuenta |
| `UNAUTHORIZED` | 401 | Sin Bearer / sesión inválida |

---

## 3. Reglas de alta / vinculación Google

| Escenario | Comportamiento |
| --- | --- |
| Usuario nuevo (sin `sub`, sin email local) | Crea cuenta COTAS + `auth_identities` + sesión |
| Mismo `sub` de nuevo | Reutiliza cuenta; no duplica |
| Email local existente, sin link | `409 ACCOUNT_LINK_REQUIRED` |
| Link con password correcto | Vincula `sub` y emite sesión |
| `sub` ya en otra cuenta | `409 IDENTITY_CONFLICT` |
| `email_verified !== true` | Rechazo |

Identificador estable = Google `sub`, no el correo.

---

## 4. Persistencia en la app (matriz)

| Acción | Cuenta COTAS | Conexión IPTV (local) |
| --- | --- | --- |
| Cerrar app / reiniciar TV | Conservar tokens COTAS | Conservar |
| Servidor IPTV caído | Conservar | Conservar |
| Cambiar servidor | Conservar | Actualizar local |
| Desvincular servidor | Conservar | Borrar local |
| Logout COTAS | Borrar tokens COTAS | **Borrar también** credenciales IPTV de esa cuenta |

---

## 5. IPTV multi-servidor (fuera del backend principal)

El backend **no** es proxy de Xtream ni de catálogo externo.

1. Tras login COTAS, si no hay servidor vinculado → UI de contenido vacía.
2. Selector:
   - **Xtream Codes:** URL + usuario + clave → app llama `player_api.php` del proveedor.
   - **Login normal COTAS:** usuario/clave línea XUI vía `POST /auth/login` (sin `@`) como hoy.
3. Credenciales Xtream: solo almacenamiento local seguro (Keystore / Secure Storage).

---

## 6. Google Cloud / Client IDs

Ver `docs/integraciones/GOOGLE_CLOUD_SIGNIN.md`.  
Cada plataforma usa su Client ID; el backend acepta la lista en `GOOGLE_OAUTH_CLIENT_IDS`.

**Pruebas (activos en el servidor):**

- Móvil/TV: `652893487449-he614hftcqj3cspvsa5md846fp0vac95.apps.googleusercontent.com`
- Web: `652893487449-jcgsi4g4eao15vjgp2vq91npfjqo4r4p.apps.googleusercontent.com`

El backend debe tener `GOOGLE_SIGNIN_ENABLED=true` y ambos IDs en `GOOGLE_OAUTH_CLIENT_IDS`.

---

## 7. Checklist de integración por app

- [ ] Pantalla login: correo/contraseña + Continuar con Google  
- [ ] Enviar solo ID token a `/auth/google`  
- [ ] Guardar access/refresh COTAS; renovar con `/auth/refresh`  
- [ ] Manejar `ACCOUNT_LINK_REQUIRED` → `/auth/google/link`  
- [ ] Home vacío sin IPTV vinculado  
- [ ] Xtream en cliente; no pedir proxy al backend  
- [ ] Logout borra tokens COTAS + credenciales IPTV locales  
- [ ] `deviceId` estable + `platform` en login/register/google  
