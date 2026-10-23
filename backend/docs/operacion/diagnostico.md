# Diagnóstico

No pegue `.env`, tokens ni la salida completa de un contenedor en un informe. Prisma y los logs de la API no deben mostrar la referencia de reproducción; si apareciera, detenga el copiado y rote la línea.

| Síntoma | Dónde mirar | Qué significa |
| --- | --- | --- |
| El CI falla en formato, lint o pruebas | El job `backend` del workflow `ci` | El cambio no está listo. No se publica imagen |
| `npm audit` falla | El mismo job | Hay un aviso crítico en dependencias de producción. Los avisos altos de Prisma 6 no fallan el job: su corrección publicada exige Prisma 7, y esta entrega permanece en Prisma 6 |
| `publish` falla al arrancar la imagen | Logs del paso de comprobación, sin copiar secretos de prueba al chat | La imagen no llegó a salud con PostgreSQL efímero |
| `deploy` en espera | Actions, runners | No hay runner `cotas-pruebas` en línea, o el entorno `pruebas` pide aprobación |
| `deploy` no encuentra la imagen en GHCR | Logs de `Actualizar el servidor` o del paso de comprobación | Suele ser un `workflow_dispatch` lanzado antes de que `publish` termine. El SHA debe coincidir con una versión ya publicada. Si `publish` ya está en verde, revise que el paquete esté privado y ligado a este repositorio |
| `find: .../backups/env: Permission denied` | Retención de copias en el script | El entorno vive en `/opt/cotas/env`, no bajo `backups/`. El script solo lista `cotas-*.dump` en la raíz de `backups/`. Si existe `backups/env`, cámbielo de dueño a `cotas-runner` o elimínelo si está vacío y no es el `.env` real |
| El script dice que falta el entorno o que sigue la contraseña local | `/opt/cotas/env/.env` en el servidor | Corrija el archivo allí. No lo suba |
| El backend se reinicia y la migración falla | `docker compose logs --tail=200 backend` | El script, si detecta la falta de salud, detiene `backend`. No borre el volumen. Use la copia de `/opt/cotas/backups` si los datos quedaron a medias |
| `ready` en 503 y `live` en 200 | PostgreSQL | La API vive, la base no acepta la consulta |
| La imagen vieja no arranca tras una reversión | Esquema nuevo contra código viejo | Restaure la copia previa. Cambiar solo la imagen no deshace la migración |

Comandos útiles, en el directorio del checkout del runner y sin imprimir el entorno:

```text
docker compose ps
docker compose logs --tail=100 backend
docker image inspect cotas-backend:local --format '{{.Id}} {{.Config.User}}'
```

Compare ese identificador con `/opt/cotas/state/current-image`.
