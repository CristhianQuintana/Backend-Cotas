# 0001. Identidad y sesión

Estado: reglas vigentes de esta entrega. El ingreso por línea XUI es el mecanismo con el que se despliega. Los puntos marcados como ajustables pueden cambiar más adelante sin otro modelo de datos.

## Decisión

- El identificador de ingreso es el usuario de la línea XUI. La contraseña se verifica en `player_api.php` (`user_info.auth = 1`) antes de crear o actualizar la cuenta local.
- Una línea nueva de XUI puede entrar sin alta manual. El primer ingreso válido crea un usuario `ACTIVE` con rol `CUSTOMER` y una fila `ACTIVE` en `iptv_accounts`.
- Una cuenta local `SUSPENDED` o `DISABLED` no entra, aunque XUI acepte la línea. El mensaje sigue siendo genérico.
- Catálogo y reproducción usan la línea de quien inició sesión, no una credencial compartida del proceso.
- La contraseña de la línea se guarda cifrada con AES-256-GCM en `iptv_accounts.password_encrypted` porque la URL de reproducción la necesita después del login. No se guarda la URL.
- El refresh token es opaco. Solo se guarda su SHA-256. Se rota en cada uso y, si se reutiliza uno ya rotado, se revoca toda la familia.
- `OPERATOR` y `ADMIN` entran con usuario y contraseña local (Argon2id). En esta fase el panel no exige TOTP. El cliente IPTV no usa MFA.
- El guard de acceso vuelve a consultar sesión y usuario en PostgreSQL.

## Reglas ajustables, ya aplicadas así en el código

Coinciden con `Documentación/Base de datos.md` y no bloquean el despliegue de pruebas:

- DEC-02: una línea XUI activa por usuario de la aplicación.
- DEC-03: sin máximo de dispositivos.
- DEC-04: sin máximo de sesiones simultáneas.
- DEC-05: MFA del personal desactivado en el login del panel (fase actual). El cliente no lo usa.

- DEC-06: códigos de recuperación de un solo uso, con vencimiento de un año.
- DEC-07: sin historial de reproducción.
- DEC-08: sin caché persistente de catálogo ni EPG. Hay memoria de proceso de 60 segundos.
- DEC-09: sin borrado automático de auditoría.

## Consecuencias

Las variables `XUI_USERNAME` y `XUI_PASSWORD` quedan como sonda de disponibilidad del panel, no como la cuenta con la que entra el cliente. En la prueba de humo se usa esa misma línea porque es la línea de desarrollo.
