# Astra y VOD

No existe conexión directa con Astra ni con un almacenamiento de VOD distinto de XUI.

Evidencia en el código: el único cliente HTTP de streaming está en `src/modules/integrations/xui`. Las películas salen de `get_vod_streams` y `get_vod_info`. Las series salen de `get_series` y `get_series_info`. La referencia de reproducción usa el host que XUI devuelve en `server_info`, si ese host está en `XUI_ALLOWED_STREAM_HOSTS`.

Si más adelante un título no aparece en esas acciones, falta una operación concreta de XUI, no un cliente Astra nuevo. Hasta esa evidencia no se abre otra integración.
