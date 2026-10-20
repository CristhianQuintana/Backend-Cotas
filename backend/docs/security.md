# Seguridad

Esta matriz describe el código de esta versión y el contenedor local. No certifica el servidor de pruebas hasta que se ejecute allí.

| Control | Estado |
| --- | --- |
| Validación de entorno al arrancar, sin imprimir valores | Implementado. Cubierto por prueba unitaria. |
| Contraseñas Argon2id y política mínima de 12 caracteres | Implementado. En producción el coste mínimo es memoria 19456 y tiempo 2. |
| Ingreso por línea XUI | Implementado. La contraseña se comprueba en XUI. La cuenta local se crea en el primer ingreso válido. |
| Mensaje genérico de login | Implementado y cubierto por prueba E2E. |
| JWT de acceso corto, refresh opaco hasheado, rotación y revocación de familia | Implementado. La reutilización está cubierta por prueba E2E con almacén en memoria. |
| Logout y usuario deshabilitado invalidan el access token vigente | Implementado y cubierto por prueba E2E. |
| TOTP y códigos de recuperación para operador y administrador | Implementado para el alta. El cliente no usa MFA. Cubierto por prueba E2E. |
| Secreto TOTP y contraseña de línea cifrados con AES-256-GCM | Implementado. |
| Autorización por rol e imposibilidad de borrar la sesión de otro usuario | Implementado y cubierto por prueba E2E. |
| Límite de intentos en login, refresh y MFA | Implementado por proceso. No es un límite de clúster. |
| Helmet, CORS por lista, cuerpo máximo, rechazo de content-type no JSON | Implementado. En producción el origen tiene que ser https. |
| Errores públicos sin traza ni SQL | Implementado. |
| Redacción de logs: query secrets, rutas `/live|movie|series/usuario/clave/` y Bearer | Implementado y cubierto por prueba unitaria. |
| Host de reproducción en lista permitida; el cliente no envía la URL | Implementado y cubierto por prueba unitaria. |
| Swagger desactivado en production salvo bandera explícita | Implementado. Compose fuerza `SWAGGER_ENABLED=false`. |
| HTTP hacia XUI rechazado en production salvo `XUI_ALLOW_INSECURE_HTTP=true` | Implementado. En la red privada de pruebas la bandera puede quedar en true. No vale para Internet. |
| Página `/dev/player` y preparador local | Solo `NODE_ENV=development`. No están en la imagen de producción. |
| TLS en el borde | Referencia en `deploy/nginx/api.conf.example`. No forma parte de Compose. Hay que activarlo antes de publicar la API fuera de la red de pruebas. |
| Copias | Procedimiento en `docs/operacion/despliegue-y-reversion.md`. |
| Credencial dentro de la referencia de reproducción | Riesgo vigente, mitigado y limitado a la red de pruebas. Ver `docs/integraciones/autorizacion-reproduccion.md`. |

No hay cookies de sesión, así que CSRF no aplica a este contrato Bearer. `TRUST_PROXY` queda en `false` hasta que el proxy real esté definido: no se confía en `X-Forwarded-For` por defecto.

Las reglas de identidad que están en vigor en esta entrega se listan en `docs/decisions/0001-identidad-y-sesion.md`.
