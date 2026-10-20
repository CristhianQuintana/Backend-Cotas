# Autorización de reproducción

`POST /api/v1/playback/authorizations` comprueba que el canal, la película o el episodio existan para la línea que inició sesión. En series, el episodio tiene que pertenecer a `seriesId` y, si se envió, a `seasonNumber`. Después construye la referencia directa.

## Material de acceso

XUI entrega el manifiesto y el archivo con el usuario y la contraseña de la línea dentro de la ruta. No se encontró en esta integración un token de un solo uso que sustituya esa ruta. La respuesta lo declara con `accessMaterialEmbedded: true` y `expiresAt: null`. La caducidad práctica es la de la línea en el panel, no un plazo que esta API pueda acortar.

Mitigaciones de esta entrega:

- La referencia solo se entrega a un cliente ya autenticado.
- El host tiene que estar en la lista permitida. Otro host se rechaza.
- El cliente no puede pedir a la API que descargue una URL arbitraria.
- Logs, auditoría y errores guardan el tipo de contenido y el identificador, no la ruta.
- La API de producción no retransmite el vídeo.
- El contenedor de despliegue no publica `/dev/player` ni el conversor local.

Alcance aceptado para subir la solución al servidor de pruebas interno: la referencia sigue llevando la credencial de la línea, y el servicio no se publica a Internet sin TLS y sin el proxy de `deploy/nginx/api.conf.example`. Esta aceptación no cubre un despliegue público. Si XUI incorpora después una URL de corta duración, esta construcción debe sustituirse.

## Qué no demuestra la página de desarrollo

Reproducir en `/dev/player` demuestra el navegador de este equipo, con un conversor local que no va en la imagen. La prueba de la API desplegable es `node scripts/smoke-deploy.mjs` contra el contenedor: autorización y apertura de la referencia, sin imprimirla.
