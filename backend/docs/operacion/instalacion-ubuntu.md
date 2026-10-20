# Instalación inicial en Ubuntu

Servidor previsto: Ubuntu 24.04, red interna, Docker Engine y Docker Compose ya instalados. Confirme `docker version` y `docker compose version` antes de continuar. No abra puertos hacia Internet.

## 1. Runner y directorios

Siga `runner-autohospedado.md`. Cree el entorno `pruebas` con revisores antes de dejar el servicio del runner en marcha.

## 2. Entorno

Cree `/opt/cotas/env/.env` en el servidor, a partir de `backend/.env.example`, con secretos nuevos. `NODE_ENV` puede quedar en `development` dentro del archivo: Compose fuerza `production` para el contenedor. `PUBLIC_CORS_ORIGINS` tiene que ser `https`. `XUI_BASE_URL` tiene que ser la dirección que el propio servidor alcanza, con su puerto. No copie ese archivo al repositorio.

Compruebe desde el servidor, sin guardar la salida en Git, que el puerto del panel responde. La aplicación no tiene la dirección escrita en el código.

Permisos:

```text
sudo chown cotas-runner:cotas-runner /opt/cotas/env/.env
sudo chmod 600 /opt/cotas/env/.env
```

## 3. Primera imagen

Hasta que el primer push a `main` publique una imagen, no hay SHA que desplegar. Cuando el workflow `publish` termine en verde, anote el SHA. Puede lanzar `deploy` a mano con la acción `deploy` y ese SHA, o dejar que la cadena automática llegue al runner.

El primer arranque crea el volumen `cotas_pg`. Si el directorio de datos ya existiera de una prueba anterior, la contraseña de PostgreSQL no cambia al editar `.env`: la fija el primer inicio del volumen. Use una contraseña definitiva antes de ese primer inicio.

## 4. Comprobación

En el servidor:

```text
docker compose -f RUTA_DEL_CHECKOUT/backend/docker-compose.yml ps
```

`GET http://127.0.0.1:3100/api/v1/health/live` y `/api/v1/health/ready` deben responder 200. PostgreSQL solo escucha en `127.0.0.1`. La API también, salvo que más adelante se decida otro enlace y un proxy TLS.

No ejecute `docker compose up --build` en el servidor. La imagen tiene que venir de GHCR.

## 5. Disco

Hay unos 24 GB en total. El script solo borra imágenes colgantes y conserva siete copias lógicas. Revise `docker system df` después de los primeros despliegues. No borre el volumen `cotas_pg`.
