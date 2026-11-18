# LOGIN COTAS solo desde la red corporativa

**Alcance exclusivo:** el login normal por línea XUI (`POST /auth/login` con usuario **sin** `@`).  
**No cambia:** emisión de tokens, refresh, logout, sesiones, dispositivos, correo/Google, panel staff (contraseña local), catálogo ni playback.  
**STREAM CODE (Xtream):** sigue siendo cliente → XUI directo, con su configuración actual y desde cualquier red. El backend no participa.

## Qué se implementó

| Capa | Detalle |
| --- | --- |
| Backend | `LOGIN_COTAS_ALLOWED_CIDRS` (CSV de CIDR). Si el **peer TCP** de la petición no está en esos rangos, `POST /auth/login` por línea XUI responde `403 LOGIN_NETWORK_RESTRICTED` **antes** de consultar XUI. Vacío = sin restricción. |
| Por qué el peer TCP | No se usa `X-Forwarded-For` (falsificable). El tráfico público entra por Nginx (loopback) / gateway Docker y queda fuera del rango corporativo; los equipos LAN que llaman directo a la IP privada conservan su IP real. |
| Despliegue | `deploy.yml` inyecta `LOGIN_COTAS_ALLOWED_CIDRS` en `/opt/cotas/env/.env` (variable de entorno `LOGIN_COTAS_ALLOWED_CIDRS` del environment `pruebas`; por defecto `10.10.0.0/16`). |
| Firewall (opcional) | `deploy/firewall/login-cotas-docker-user.sh` (simulación por defecto). Filtra el **puerto completo**; léase la advertencia del script. |

## Destino de conexión de las apps

LOGIN COTAS debe apuntar a la IP privada del servidor (red corporativa):

```text
LOGIN_COTAS_BASE_URL = http://10.10.0.31:3100/api/v1     # solo red corporativa
```

Las apps pueden seguir usando `https://api.cotasperu.com/api/v1` para el resto de endpoints (refresh, catálogo, playback) con los tokens ya emitidos. Desde fuera de la red corporativa el login normal responde 403; correo/Google siguen disponibles.

## Verificación

| Prueba | Resultado esperado |
| --- | --- |
| Login línea XUI desde `10.10.x.x` → `http://10.10.0.31:3100/api/v1/auth/login` | 200 con tokens COTAS |
| Login línea XUI desde Internet → `https://api.cotasperu.com/api/v1/auth/login` | 403 `LOGIN_NETWORK_RESTRICTED` |
| Login por correo / Google desde Internet | Sin cambio |
| Xtream Codes (app → proveedor/XUI) desde cualquier red | Sin cambio |

## Ajustes y reversión

- Cambiar rangos: variable `LOGIN_COTAS_ALLOWED_CIDRS` del environment `pruebas` y redesplegar (o editar el `.env` del servidor y reiniciar el backend).
- Desactivar la restricción: poner la variable a un valor vacío en `.env` del servidor (el workflow usa `10.10.0.0/16` si la variable de GitHub no existe) y reiniciar.
- Firewall: `ACTION=remove APPLY=true` en el script revierte la regla.
- Si el rango corporativo real no es `10.10.0.0/16`, corrija el CIDR antes de que los usuarios internos intenten iniciar sesión.
