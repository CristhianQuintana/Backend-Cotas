# Informe: LOGIN DEMO para aplicaciones móvil y TV

| Campo | Valor |
| --- | --- |
| Versión | 1.0 |
| Fecha | 2026-11-24 |
| Backend | cotas-backend ≥ commit de LOGIN DEMO |
| Empresa | COTAS PERU S.A.C. |
| Endpoint | `POST /api/v1/auth/login` |
| Alcance | Solo el modo **LOGIN** (línea XUI). **No** cambia STREAM CODE. |

## 1. Qué se implementó

En cada plataforma siguen existiendo dos formas de ingreso:

| Modo | Quién autentica | Red |
| --- | --- | --- |
| **STREAM CODE** | La app habla **directo** con el panel Xtream/XUI del abonado | La que configure la app; el backend COTAS **no participa** |
| **LOGIN** (COTAS) | La app habla con `api.cotasperu.com` → backend → XUI | Por defecto solo red corporativa (`LOGIN_COTAS_ALLOWED_CIDRS`) |

Se añadió una **cuenta demo** en el modo LOGIN:

- Usuario: `demo123`
- Contraseña: `demo123`
- Acceso: **desde cualquier red** (dentro o fuera de la empresa)
- Panel XUI demo (servidor de pruebas): `http://10.10.0.29` (`player_api.php`)
- El panel web de administración (`/cotasapp/dashboard`) es solo operación interna; **las apps no lo usan**

El resto de líneas LOGIN COTAS **sigue restringido** a la red corporativa.

## 2. Contrato API (sin cambios de forma)

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "demo123",
  "password": "demo123",
  "deviceId": "<uuid-estable-del-aparato>",
  "platform": "android",
  "deviceName": "Demo Phone"
}
```

Respuesta exitosa (igual que cualquier LOGIN COTAS):

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaco>",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

Errores relevantes:

| HTTP | Código | Cuándo |
| --- | --- | --- |
| 200 | — | Login demo u otra línea válida |
| 401 | `INVALID_CREDENTIALS` | Usuario/contraseña demo incorrectos, o línea XUI rechazada |
| 403 | `LOGIN_NETWORK_RESTRICTED` | Línea **no demo** desde fuera de la red corporativa |
| 429 | `RATE_LIMITED` | Demasiados intentos en rutas sensibles |

Tras el login, el resto del contrato es el de siempre:

- `Authorization: Bearer <accessToken>`
- `POST /api/v1/auth/refresh` con el `refreshToken`
- Catálogo: `GET /api/v1/catalog/...`
- Reproducción: `POST /api/v1/playback/authorizations` (usar la URL/ticket que devuelve el backend; **no** abrir `10.10.0.29` desde la app si el usuario está fuera de la LAN)

## 3. Qué deben hacer las apps (móvil y TV)

### 3.1. Sin pantalla nueva obligatoria

No hace falta un tercer botón. En la pantalla de **LOGIN** (no STREAM CODE):

1. El usuario escribe usuario y contraseña.
2. La app llama a `POST /api/v1/auth/login` contra la **URL pública** del backend (`https://api.cotasperu.com/api/v1`), igual que hoy.
3. Si las credenciales son `demo123` / `demo123`, el backend **omite** la comprobación de red y autentica contra el XUI demo.
4. Si son otra línea XUI y el dispositivo está fuera de la red corporativa, seguirá el `403 LOGIN_NETWORK_RESTRICTED` actual.

### 3.2. UX recomendada (opcional)

- Mostrar un texto de ayuda: «Cuenta demo: demo123 / demo123 (disponible desde cualquier red)».
- Ante `403 LOGIN_NETWORK_RESTRICTED`, el mensaje actual sigue válido para líneas reales; **no** aplicarlo a la cuenta demo (esa no debe devolver 403 de red).
- Ante catálogo vacío en demo: el servidor demo puede no tener contenido cargado; la app debe mostrar «sin contenido» sin tratarlo como error de sesión.

### 3.3. `deviceId`

Sigue siendo obligatorio un identificador **estable** por aparato (UUID). Si cambia en cada arranque, el usuario agotará el cupo de dispositivos.

### 3.4. STREAM CODE

No modificar. STREAM CODE no usa este flujo ni la cuenta demo del backend.

### 3.5. Google / TV QR

No cambian. El LOGIN DEMO es solo usuario/contraseña en `/auth/login`.

## 4. Comportamiento del backend (referencia)

1. `POST /auth/login` con username **sin** `@`.
2. Si `DEMO_LOGIN_ENABLED=true` y username = `DEMO_LOGIN_USERNAME`:
   - No se aplica `LOGIN_COTAS_ALLOWED_CIDRS`.
   - Si hay `DEMO_LOGIN_PASSWORD` y no coincide → `401` sin llamar a XUI.
   - Si coincide → autentica en `DEMO_XUI_BASE_URL`.
3. Cualquier otro username de línea → restricción CIDR + XUI productivo.
4. Catálogo y playback de la sesión demo se enrutan al XUI demo por el username de la línea (no mezclan el catálogo productivo).

## 5. Pruebas que deben pasar en las apps

| # | Escenario | Resultado esperado |
| --- | --- | --- |
| 1 | LOGIN `demo123`/`demo123` en WiFi corporativo | 200 + tokens |
| 2 | LOGIN `demo123`/`demo123` en datos móviles / red externa | 200 + tokens |
| 3 | LOGIN línea real fuera de la red | 403 `LOGIN_NETWORK_RESTRICTED` |
| 4 | LOGIN `demo123` con contraseña mala | 401 `INVALID_CREDENTIALS` |
| 5 | Tras login demo, `GET /auth/me` y refresh | OK |
| 6 | STREAM CODE (sin backend) | Sin cambios |

## 6. Configuración de servidor (informativo)

Variables (ya previstas en despliegue de pruebas):

| Variable | Valor típico pruebas |
| --- | --- |
| `DEMO_LOGIN_ENABLED` | `true` |
| `DEMO_XUI_BASE_URL` | `http://10.10.0.29` |
| `DEMO_LOGIN_USERNAME` | `demo123` |
| `DEMO_LOGIN_PASSWORD` | `demo123` |
| `DEMO_XUI_ALLOW_INSECURE_HTTP` | `true` |
| `DEMO_XUI_ALLOWED_STREAM_HOSTS` | `10.10.0.29` |

## 7. Limitaciones conocidas

- El XUI demo en `10.10.0.29` está en la LAN de la empresa: el **backend** (que sí está en esa red) es quien lo consulta. Las apps externas no deben llamar a `10.10.0.29` directamente.
- El catálogo del usuario demo puede venir vacío si el panel demo aún no tiene paquetes asignados; eso es dato del panel, no un fallo del login.
- La cuenta demo es de **pruebas**; no usar credenciales de administración del panel (`cotasadmin`) en las apps.

## 8. Checklist de integración

- [ ] Móvil: LOGIN con `demo123`/`demo123` desde fuera de la red corporativa
- [ ] TV: mismo flujo en la pantalla de LOGIN
- [ ] Verificar que STREAM CODE no se alteró
- [ ] Verificar que una línea real fuera de red sigue recibiendo 403
- [ ] Usar siempre la API pública COTAS para LOGIN (no la IP del panel demo)
