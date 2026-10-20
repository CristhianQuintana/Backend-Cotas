# Resultados de integración — 20 de octubre de 2026

Prueba contra los contenedores `backend` y `postgres` en el equipo de desarrollo. La API escuchaba en `127.0.0.1:3100`. No se imprimieron referencias ni contraseñas. No se inició sesión en `10.10.0.31`.

## Contenedores

- Imagen `cotas-backend:local`, usuario `cotas`, puerto interno 3000.
- Los dos servicios quedaron `healthy`.
- El arranque aplicó las migraciones contra el host `postgres:5432`. No había migraciones pendientes.
- `GET /api/v1/health/live` respondió 200. `GET /api/v1/health/ready` respondió 200 con la base en marcha.
- `GET /dev/player` y `GET /api/docs` respondieron 404.
- Con PostgreSQL detenido, `ready` respondió 503 y `live` siguió en 200. Al volver a arrancar la base, `ready` volvió a 200.
- La base tenía 3 roles antes de una copia, después de restaurarla en `cotas_restore` y después de reiniciar los dos contenedores.
- Los logs del backend no contenían la contraseña de la línea, el usuario de la línea, un Bearer ni un manifiesto `.m3u8`.

## Catálogo y reproducción

Conteos de esta corrida, no son cupos del sistema:

| Consulta | Total |
| --- | --- |
| Categorías en vivo | 12 |
| Canales | 150 |
| Categorías de películas | 20 |
| Películas | 592 |
| Categorías de series | 18 |
| Series | 96 |
| Filas EPG del primer canal probado | 4 |

Un anónimo recibió 401. Una línea incorrecta recibió 401. Un canal inexistente recibió 404. Un episodio pedido en otra temporada recibió 404.

| Contenido | Identificador | Apertura | Decodificación |
| --- | --- | --- | --- |
| Canal en vivo | 3537 | Manifiesto 200 y segmento 200 de 1218616 bytes | 8 segundos, imagen y audio |
| Película | 456 | `video/mp4`, HTTP 206 | 12 segundos, imagen y audio |
| Episodio | 3360 | `video/mp4`, HTTP 206 | 12 segundos, imagen y audio |

La decodificación usó FFmpeg en el equipo de prueba, leyendo la referencia directa. No es el conversor de la página de desarrollo: esa página no está en la imagen. No se dejó una reproducción de dos minutos.
