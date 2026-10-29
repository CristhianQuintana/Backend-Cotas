# Catálogo normalizado

XUI es la fuente del catálogo. PostgreSQL no lo duplica.

El caso de uso entrega identificadores de texto numérico, nombres, categorías e iconos ya mapeados. Se descarta `direct_source` y cualquier campo que el mapeador no conoce. La temporada 0 se conserva; la presentación puede llamarla especiales. Los episodios quedan ordenados por temporada y número. Una temporada existente sin episodios responde 200 con lista vacía. Una temporada o un título que no existe responde 404.

La paginación usa `page` y `limit`. El límite máximo es 50. `total` es el tamaño de la lista ya filtrada, no un cupo fijo. `categoryId` filtra por el identificador de XUI. `search` es opcional y corto.

La memoria de 60 segundos evita repetir la misma consulta al pasar de página. La clave incluye el usuario de la línea y no la contraseña. No sobrevive a un reinicio.

La EPG de canales en vivo está documentada para las plataformas en `epg.md` (`GET .../live/streams/{id}/epg` y `GET .../live/epg`).
