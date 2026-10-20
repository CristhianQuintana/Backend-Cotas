# Integración XUI

Hay un solo adaptador: `XuiHttpClient`. La URL, la línea de sonda, el tiempo de espera y el tamaño máximo salen del entorno. No hay credenciales en el código.

Producto observado en la planificación: XUI.one 1.5.13, por HTTP en la red privada. La dirección no se repite en este árbol. Astra y el almacenamiento de VOD no tienen adaptador propio: el catálogo y la referencia de reproducción salen de `player_api.php`. Esa decisión y su límite están en `docs/integraciones/astra-vod.md`.

## Acciones

| Acción | Uso |
| --- | --- |
| Sin `action` | Estado de la línea (`user_info.auth`) y `server_info` |
| `get_live_categories` | Categorías de canales |
| `get_live_streams` | Canales en vivo |
| `get_short_epg` | EPG corto de un canal que existe |
| `get_vod_categories` | Categorías de películas |
| `get_vod_streams` | Películas |
| `get_vod_info` | Ficha de una película (`vod_id`) |
| `get_series_categories` | Categorías de series |
| `get_series` | Series |
| `get_series_info` | Ficha, temporadas y episodios (`series_id`) |

Los conteos cambian en XUI. No son constantes del sistema. La medición de una corrida se anota en el informe de entrega, con fecha, y no se copia aquí como contrato.

## Comportamiento

`fetch` con tiempo de espera, sin seguir redirecciones y con tope de bytes. Un 401 o 403 de XUI no se reintenta y la API responde 502. Un 404 HTML al comprobar la línea se trata como credencial rechazada. Un tiempo de espera es 504. Una caída es 503. Un JSON inválido es 502. Un catálogo vacío con `auth=0` es fallo de autenticación, no una lista vacía válida. Un EPG vacío de un canal que sí existe es 200. Un identificador ausente es 404.

Las pruebas automáticas usan un servidor HTTP local o un cliente falso. No llaman a la XUI real. La prueba contra el panel se hace con el contenedor en marcha y `node scripts/smoke-deploy.mjs`.

## Referencias

- En vivo: `{protocol}://{host}:{port}/live/{user}/{pass}/{id}.m3u8`
- Película: `{protocol}://{host}:{port}/movie/{user}/{pass}/{id}.{ext}`
- Episodio: `{protocol}://{host}:{port}/series/{user}/{pass}/{id}.{ext}`

Esas rutas llevan material de acceso. No se registran. El riesgo y las mitigaciones están en `docs/integraciones/autorizacion-reproduccion.md`.
