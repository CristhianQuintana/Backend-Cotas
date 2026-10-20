# Despliegue y reversión

Objetivo: dos contenedores en el servidor de pruebas. La planificación nombra `10.10.0.31`. Confirme puertos libres y acceso antes de copiar nada. Esta guía no abre sesión en ese equipo.

## Antes de cambiar el servidor

1. Anote sistema, CPU, RAM, disco, `docker version`, `docker compose version`, contenedores, redes, volúmenes y puertos en escucha.
2. Confirme que el proceso del servidor llega a XUI por la red privada.
3. Elija un directorio y un usuario de operación. No copie `.env` al repositorio ni a un informe.
4. Elija `POSTGRES_PASSWORD` y `PUBLIC_CORS_ORIGINS` con `https`. No reutilice `local_only_dev_password` en el servidor.
5. Si ya hubiera datos, haga la copia del apartado siguiente antes de la primera migración.

## Subir y arrancar

En el directorio que contiene `docker-compose.yml`, el `Dockerfile` y `.env`:

```text
docker compose up -d --build
docker compose ps
```

El servicio `backend` aplica las migraciones y después acepta tráfico. Hay una sola réplica: no levante varias copias con la migración en el arranque.

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

1. Conserve la etiqueta de la imagen que estaba en marcha, por ejemplo `cotas-backend:local` renombrada a un identificador de fecha antes de construir la nueva.
2. Para volver: etiquete otra vez esa imagen como `cotas-backend:local` y ejecute `docker compose up -d` sin `--build`.
3. Si la migración nueva no es reversible, restaure la copia. No hay bajada automática de esquema.
4. La reversión la autoriza quien opera el servidor de pruebas.

`docker compose stop` detiene los dos servicios y conserva el volumen. `docker compose down` también conserva el volumen nombrado. `docker compose down -v` lo elimina: no lo use como reversión.
