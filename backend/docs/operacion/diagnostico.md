# Diagnóstico

No pegue `.env`, tokens ni la salida completa de un contenedor en un informe. Prisma y los logs de la API no deben mostrar la referencia de reproducción; si apareciera, detenga el copiado y rote la línea.

| Síntoma | Dónde mirar | Qué significa |
| --- | --- | --- |
| El CI falla en formato, lint o pruebas | El job `backend` del workflow `ci` | El cambio no está listo. No se publica imagen |
| `npm audit` falla | El mismo job | Hay un aviso crítico en dependencias de producción. Los avisos altos de Prisma 6 no fallan el job: su corrección publicada exige Prisma 7, y esta entrega permanece en Prisma 6 |
| `publish` falla al arrancar la imagen | Logs del paso de comprobación, sin copiar secretos de prueba al chat | La imagen no llegó a salud con PostgreSQL efímero |
| `deploy` en espera | Actions, runners | No hay runner `cotas-pruebas` en línea |
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
