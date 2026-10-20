# Validación de integraciones

- Un solo cliente XUI, configurado por entorno.
- Tiempo de espera, tope de bytes, redirecciones rechazadas y JSON validado.
- 401 y 403 de XUI no se reintentan. El 404 de una línea incorrecta no se presenta como caída del panel.
- Los errores públicos no incluyen la URL ni la contraseña.
- El catálogo de canales, películas y series sale de ese cliente. No hay caché en PostgreSQL.
- La autorización rechaza identificadores ajenos a la serie pedida y hosts que no están en la lista.
- La prueba automática usa dobles. La prueba con el panel real es el script de humo, después de levantar Compose.
- Astra no tiene conector. La justificación está en `docs/integraciones/astra-vod.md`.
