# Configuración Google Cloud — Sign-In COTAS

**Alcance:** backend principal + tres clientes (Android TV, Samsung Smart TV, tercera app).  
**Principio:** Google autentica; COTAS emite y valida sus propios tokens. Las apps **nunca** envían el Google ID token a endpoints distintos de `/auth/google` o `/auth/google/link`.

## 1. Proyecto Google Cloud

1. Crear o reutilizar un proyecto GCP dedicado a COTAS (separar `dev` / `staging` / `prod` si es posible).
2. Activar **Google Identity Services** / APIs de OAuth consent.
3. Configurar la **pantalla de consentimiento OAuth**:
   - Tipo de usuario: según política comercial (interno / externo).
   - Nombre de aplicación, logo, dominio de soporte, emails de contacto.
   - Scopes mínimos: `openid`, `email`, `profile`.

## 2. Clientes OAuth por plataforma

No reutilizar indiscriminadamente el mismo Client ID entre plataformas distintas.

| Plataforma | Tipo de cliente OAuth recomendado | Notas |
| --- | --- | --- |
| Android TV / Android | Android (o TV) | Package name + SHA-1 de firma release/debug |
| Samsung Tizen / web-like | Web application | Orígenes JS / redirect URI si el SDK lo exige |
| Tercera aplicación | Según stack (Android / iOS / Web) | Client ID propio |

Registrar **todos** los Client IDs autorizados en el backend:

```bash
GOOGLE_SIGNIN_ENABLED=true
GOOGLE_OAUTH_CLIENT_IDS=<android-client-id>,<samsung-client-id>,<tercera-client-id>
```

El backend valida que el claim `aud` del ID token esté en esa lista.

## 3. Secretos

- **No** embebidos en apps TV: solo Client IDs públicos de OAuth nativo.
- Secretos de clientes tipo “Web” (si existieran) viven solo en servidor / gestor de secretos.
- Variables de entorno por entorno; no versionar valores reales.

## 4. Flujo de la aplicación

1. SDK nativo de Google Sign-In → obtiene **ID token** (JWT).
2. `POST /api/v1/auth/google` con `{ "idToken": "...", "deviceId": "...", "platform": "..." }`.
3. Backend verifica firma (JWKS Google), `iss`, `aud`, `exp`, `sub`, `email_verified`.
4. Respuesta: tokens **COTAS** (`accessToken`, `refreshToken`, `expiresIn`, `tokenType`).
5. Todas las demás llamadas usan `Authorization: Bearer <accessToken>` COTAS.

### Vinculación con cuenta email/password existente

Si el correo del token ya pertenece a una cuenta COTAS con contraseña:

- `POST /auth/google` → `409 ACCOUNT_LINK_REQUIRED`.
- La app pide la contraseña COTAS y llama `POST /auth/google/link` con `idToken` + `password`.

## 5. Checklist por entorno

| Entorno | Client IDs | `GOOGLE_SIGNIN_ENABLED` |
| --- | --- | --- |
| development / test | IDs de prueba | `true` si se prueba el flujo |
| staging | IDs staging | `true` |
| production | Solo IDs de release | `true` |

Tras rotar un Client ID: actualizar secretos del servidor y redesplegar; invalidar builds que usen el ID antiguo.
