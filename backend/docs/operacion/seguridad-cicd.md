# Lista de verificación de seguridad del pipeline

- [ ] El repositorio no contiene `.env` ni tokens. `npm run scan:secrets` cubre el árbol de `backend/`.
- [ ] `main` exige pull request y, cuando la organización lo permita, revisión antes de integrar.
- [ ] El entorno `pruebas` exige un revisor.
- [ ] Los workflows declaran `permissions` y no piden escritura del código.
- [ ] Las acciones de GitHub están fijadas a un commit, con el número de versión en un comentario.
- [ ] Un pull request no tiene job de despliegue ni se ejecuta en el runner interno.
- [ ] La imagen de producción usa el usuario `cotas` y no copia `.env`.
- [ ] La etiqueta desplegada es el SHA. No se promociona `latest`.
- [ ] GHCR queda privado y ligado a este repositorio.
- [ ] El runner está limitado a este repositorio y a la etiqueta `cotas-pruebas`.
- [ ] El usuario del runner es dedicado. El riesgo del grupo `docker` está aceptado solo para ese servicio.
- [ ] PostgreSQL y la API se publican en `127.0.0.1`, no en todas las interfaces.
- [ ] TLS sigue siendo obligatorio antes de ofrecer la API fuera del propio servidor. La referencia está en `deploy/nginx/api.conf.example`.
- [ ] El despliegue no ejecuta `docker compose down -v`.
- [ ] Hay copia lógica antes de una actualización con datos, y la reversión de imagen no se presenta como reversión del esquema.
- [ ] Los logs de despliegue guardan SHA y resultado, no secretos.
- [ ] La auditoría crítica de npm está en el CI. Prisma 6 conserva tres avisos altos cuya corrección de la herramienta exige Prisma 7; no se cambia de mayor en este pipeline.

El límite de intentos de login sigue siendo de un proceso. No hay varias réplicas precisamente para que la migración del arranque no corra dos veces a la vez.
