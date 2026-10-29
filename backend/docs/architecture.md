# Arquitectura

El backend es un monolito modular NestJS. La API pública vive bajo `/api/v1`. PostgreSQL, mediante Prisma, guarda solo datos propios de COTAS: usuarios, roles, sesiones, MFA, la cuenta IPTV cifrada y auditoría. El vídeo no entra a Nest ni a PostgreSQL.

## Módulos

- `identity`: login con la línea XUI, refresh, logout, perfil, sesiones y enrolamiento TOTP del operador.
- `catalog`: canales en vivo, películas, series, temporadas, episodios y EPG corto. Se leen de XUI y se paginan en memoria.
- `playback`: autoriza un contenido que existe en el catálogo de esa línea y devuelve la referencia directa.
- `integrations/xui`: único lugar que conoce `player_api.php`, los tiempos de espera y el formato de las referencias.
- `audit`: consulta de eventos para el rol `OPERATOR`.
- `health`: viveza pública, preparación pública contra PostgreSQL y dependencias solo para operador.

Los controladores validan y delegan. Los casos de uso dependen de puertos. Prisma y el cliente HTTP están en infraestructura. `test/architecture.spec.ts` impide que el dominio importe Nest, Prisma o clientes HTTP.

## Catálogo

Las listas y fichas se cachean por usuario de línea: memoria de proceso (TTL corto) y Redis compartido (`CATALOG_CACHE_TTL_SECONDS`). El worker BullMQ refresca periódicamente el catálogo de la línea de sonda en Redis. Si Redis cae, la API sigue con memoria local y XUI. No hay tablas de catálogo en PostgreSQL. Detalle operativo en `docs/operacion/redis-catalogo.md`.

## Reproducción

La referencia la abre el cliente contra el servidor de medios, no contra esta API.

- En vivo: ruta `/live/` y manifiesto `.m3u8`.
- Película: ruta `/movie/` y la extensión que devolvió XUI.
- Episodio: ruta `/series/` y la extensión del episodio.

El host tiene que estar en `XUI_ALLOWED_STREAM_HOSTS`. El cliente no envía una URL. La respuesta declara `delivery: direct` y `accessMaterialEmbedded: true`. `expiresAt` es `null` porque XUI no entrega una caducidad distinta de la propia línea. La contraseña de esa línea va dentro de la referencia. No se escribe en logs ni en auditoría. El detalle está en `docs/integraciones/autorizacion-reproduccion.md`.

`/dev/player` y el preparador local de imagen solo existen con `NODE_ENV=development`. La imagen de producción no los publica.

## Ejecución

El despliegue de esta entrega son cuatro contenedores en `docker-compose.yml`: `postgres`, `redis`, `backend` y `worker` (misma imagen que el API, `APP_ROLE=worker`). Redis no publica puertos. El backend aplica `prisma migrate deploy` al arrancar. Nginx queda como referencia en `deploy/nginx/api.conf.example`.

## Límites conscientes

- El límite de login, refresh y MFA es por proceso; con Redis el catálogo sí se comparte entre API y worker.
- Una sola réplica debe aplicar migraciones. No escale el servicio `backend` sin sacar la migración del arranque.
- Swagger se publica en `/api/docs` fuera de `NODE_ENV=production`, salvo `SWAGGER_ENABLED=true`. El Compose de despliegue lo deja en `false`.
