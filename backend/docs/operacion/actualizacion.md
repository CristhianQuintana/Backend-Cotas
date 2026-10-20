# Actualización rutinaria

1. Abra un pull request hacia `main`. El workflow `ci` tiene que terminar en verde. No despliega.
2. Integre el cambio en `main`.
3. `ci` vuelve a ejecutarse. Si pasa, `publish` construye y sube la imagen del SHA.
4. `deploy` corre en el runner `cotas-pruebas`, dentro del entorno `pruebas`.
5. El script copia la base si ya está en marcha, descarga solo ese SHA, aplica migraciones con una sola réplica y espera la salud.
6. El resultado queda en `/opt/cotas/state/deployments.log` y la imagen vigente en `current-image`.

No hace falta entrar al servidor para una actualización sana. Si el job queda en espera, el runner no está registrado o no tiene la etiqueta `cotas-pruebas`.

Para repetir un SHA ya publicado sin esperar un push, use la ejecución manual de `deploy` con la acción `deploy` y el SHA. No escriba otra etiqueta.
