# Runner autohospedado

Hágalo un administrador del repositorio, en el servidor de pruebas, con un usuario distinto del de acceso personal.

## Usuario y directorios

```text
sudo useradd --create-home --shell /bin/bash cotas-runner
sudo usermod -aG docker cotas-runner
sudo install -d -o cotas-runner -g cotas-runner -m 750 /opt/cotas
sudo install -d -o cotas-runner -g cotas-runner -m 700 /opt/cotas/env /opt/cotas/state /opt/cotas/backups /opt/cotas/actions-runner
```

El archivo `.env` va solo en `/opt/cotas/env/.env` (modo `600`, dueño `cotas-runner`). No cree `/opt/cotas/backups/env`: ahí solo deben quedar `cotas-*.dump`. Si ya existiera esa carpeta por error, no la abra en un informe; ajústela al mismo dueño o quítela si está vacía.

El grupo `docker` permite controlar el motor. No dé este usuario a otras personas y no ejecute con él tareas ajenas al despliegue.

## Registro

1. En GitHub: Settings, Actions, Runners, New self-hosted runner. Elija Linux x64.
2. Copie el token de registro que muestra esa pantalla. Caduca pronto. No lo pegue en el repositorio, en un informe ni en un chat.
3. Como `cotas-runner`, en `/opt/cotas/actions-runner`, descargue el paquete y la suma que muestra GitHub. Compruebe la suma antes de extraer.
4. Configure solo este repositorio, con el nombre `cotas-pruebas` y la etiqueta `cotas-pruebas`:

```text
./config.sh --url https://github.com/CristhianQuintana/Backend-Cotas --token EL_TOKEN_DE_UN_SOLO_USO --name cotas-pruebas --labels cotas-pruebas --unattended --replace
```

5. Instale y arranque el servicio con el usuario dedicado:

```text
sudo ./svc.sh install cotas-runner
sudo ./svc.sh start
```

6. En la lista de runners debe aparecer Idle, con las etiquetas `self-hosted`, `linux` y `cotas-pruebas`.

No marque el runner como disponible para todos los repositorios de la organización.

## Entorno protegido

En Settings, Environments, cree `pruebas` antes de confiar en el despliegue automático. Añada los revisores requeridos y limite el despliegue a la rama `main`. El workflow `deploy` usa ese entorno. Si el entorno no tiene revisores, la primera ejecución puede salir sin aprobación: por eso se crea la protección antes de registrar el runner, o se deja el runner detenido hasta entonces.

## Actualización

GitHub muestra la versión nueva en la misma pantalla del runner. Detenga el servicio, sustituya el paquete tras comprobar su suma y vuelva a arrancar `svc.sh`. No reutilice un token de registro viejo.

## Retirada

```text
sudo ./svc.sh stop
sudo ./svc.sh uninstall
./config.sh remove --token EL_TOKEN_DE_RETIRADA
```

Después borre el runner en la pantalla de GitHub. Quite al usuario del grupo `docker` si ya no va a desplegar. No borre `/opt/cotas/env` ni `/opt/cotas/backups` al retirar el runner: ahí están los secretos y las copias.

## Qué no ejecuta este runner

- Pull requests.
- Workflows de otros repositorios.
- Un comando escrito en el campo libre del despacho. El SHA tiene que ser 40 hexadecimales y la acción solo puede ser `deploy` o `rollback`.
