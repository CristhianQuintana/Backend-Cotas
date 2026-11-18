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

Las apps usan la URL pública (`https://api.cotasperu.com/api/v1`): el backend decide por la red de origen real (ver la sección de Nginx más abajo) y las IPs privadas ya no son necesarias. La IP privada sigue funcionando como alternativa para quien esté dentro de la red corporativa:

```text
LOGIN_COTAS_BASE_URL = http://10.10.0.31:3100/api/v1     # solo red corporativa
```

Las apps pueden seguir usando `https://api.cotasperu.com/api/v1` para el resto de endpoints (refresh, catálogo, playback) con los tokens ya emitidos. Desde fuera de la red corporativa el login normal responde 403; correo/Google siguen disponibles.

## Conexión a través de Nginx (dominio público o `server_name 10.10.0.31`)

El backend ve como peer TCP a Nginx (loopback / gateway Docker `172.16.0.0/12`), nunca al usuario. Por eso, si la app
entra por `https://api.cotasperu.com` (o por `http://10.10.0.31/`, puerto 80 de Nginx), la comprobación usa la
**última** entrada de `X-Forwarded-For`: Nginx usa `$proxy_add_x_forwarded_for`, que añade el `remote_addr` real al
final; las entradas anteriores las pone el cliente y se ignoran.

- Solo se confía en la cabecera si el peer es loopback/Docker (`LOGIN_COTAS_TRUSTED_PROXY_CIDRS` añade proxies) y
  `LOGIN_COTAS_TRUST_FORWARDED_FOR=true` (por defecto en el despliegue).
- Un cliente externo que envíe `X-Forwarded-For: 10.10.x.x` sigue recibiendo 403 (su IP real queda de última entrada).
- Si los equipos de la red corporativa llegan al dominio **con la IP pública de salida de la empresa** (NAT sin
  hairpin/DNS interno), esa IP aparece como cliente y se rechaza: añada su CIDR a `LOGIN_COTAS_ALLOWED_CIDRS`
  (p. ej. `10.10.0.0/16,<IP_publica_empresa>/32`) o use la IP privada en la app.
- Diagnóstico de solo lectura: workflow `diag-login-network` (clasifica rechazos por tipo de origen sin imprimir IPs).

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
