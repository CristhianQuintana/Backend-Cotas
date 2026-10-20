# Despliegue y reversión

Objetivo: dos contenedores en el servidor de pruebas. La planificación nombra `10.10.0.31`. Confirme puertos libres y acceso antes de copiar nada. Esta guía no abre sesión en ese equipo.

## Antes de cambiar el servidor

1. Anote sistema, CPU, RAM, disco, `docker version`, `docker compose version`, contenedores, redes, volúmenes y puertos en escucha.
2. Confirme que el proceso del servidor llega a XUI por la red privada.
3. Elija un directorio y un usuario de operación. No copie `.env` al repositorio ni a un informe.
4. Elija `POSTGRES_PASSWORD` y `PUBLIC_CORS_ORIGINS` con `https`. No reutilice `local_only_dev_password` en el servidor.
5. Si ya hubiera datos, haga la copia del apartado siguiente antes de la primera migración.

## Subir y arrancar

La actualización rutinaria no copia archivos a mano. Un push a `main` que supera la integración publica `ghcr.io/<propietario>/backend-cotas:<sha>` y el runner interno ejecuta `scripts/server-deploy.sh`. La primera instalación del servidor está en `instalacion-ubuntu.md`.

El script descarga esa imagen, la etiqueta como `cotas-backend:local` y ejecuta `docker compose up -d --no-build`. No usa `docker compose down -v`. Antes de cambiar contenedores que ya tienen datos, toma `pg_dump` en `/opt/cotas/backups` y conserva las siete copias más recientes.

Hay una sola réplica. `RUN_MIGRATIONS` vale `true` en un despliegue normal y `false` en una reversión de imagen. El valor entra por el entorno de Compose.

Compruebe `GET /api/v1/health/live` y `GET /api/v1/health/ready`. Después, desde un equipo que alcance la API, `node scripts/smoke-deploy.mjs`. No guarde la salida si en algún momento apareciera una referencia de reproducción: el script no debe imprimirla.

PostgreSQL queda publicado en la interfaz local del servidor (`127.0.0.1`), no en todas las interfaces. La API queda en `127.0.0.1` del puerto `BACKEND_PORT`. Para que otros equipos de la red de pruebas la usen, publique ese puerto a propósito o ponga Nginx delante. No haga las dos cosas sin decidirlo.

TLS no está dentro de Compose. Fuera de la red de pruebas, use `deploy/nginx/api.conf.example` y un certificado. Hasta entonces el límite es la red interna.

## Copia y restauración

La copia lógica, con el contenedor de PostgreSQL en marcha:

```text
docker compose exec -T postgres pg_dump -U cotas --format=custom --file=/tmp/cotas.dump cotas_dev
docker compose cp postgres:/tmp/cotas.dump ./cotas.dump
```

Cambie `cotas` y `cotas_dev` si definió `POSTGRES_USER` y `POSTGRES_DB`. Saque `cotas.dump` del servidor por un canal seguro y no lo versione.

Restauración controlada sobre una base vacía de recuperación, no sobre la base en uso hasta decidir el corte:

```text
docker compose exec -T postgres pg_restore -U cotas --dbname=cotas_dev --clean --if-exists /tmp/cotas.dump
```

El volumen Docker se llama `cotas_pg`. Borrar el volumen borra los datos aunque el archivo de copia siga existiendo.

## Si una migración falla

El contenedor `backend` sale con error y Compose lo reinicia. Lea `docker compose logs --tail=200 backend`. No borre el volumen para “reintentar”. Corrija el SQL o vuelva a la imagen anterior y, si la migración a medias tocó datos, restaure la copia tomada antes del arranque.

## Reversión de la imagen

El script guarda la imagen en uso en `/opt/cotas/state/current-image` y la anterior en `previous-image`. El historial breve queda en `deployments.log`. Esas líneas contienen el nombre de la imagen y el SHA, no secretos.

Para volver a una imagen ya publicada, ejecute a mano el workflow `deploy` con la acción `rollback` y el SHA de 40 caracteres. Eso descarga esa imagen, no aplica migraciones y no borra el volumen. No devuelve el esquema de PostgreSQL al estado anterior. Si la migración nueva es incompatible con la imagen vieja, restaure la copia tomada antes del despliegue y no deje que Compose reinicie el backend a ciegas.

Si la salud falla, el script detiene solo el servicio `backend`, deja PostgreSQL en marcha y termina con error. No vuelve solo a la imagen anterior: una migración ya aplicada puede hacer insegura esa vuelta automática.

La reversión la autoriza quien opera el servidor de pruebas. En esta entrega no se ejecutó esa vuelta sobre `10.10.0.31`, porque el runner todavía no está registrado allí.

`docker compose stop` detiene los dos servicios y conserva el volumen. `docker compose down` también conserva el volumen nombrado. `docker compose down -v` lo elimina: no lo use como reversión.
