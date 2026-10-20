# Matriz de interfaces de streaming

| Sistema | Quién lo llama | Qué aporta | Qué no hace esta API |
| --- | --- | --- | --- |
| Aplicaciones cliente | Usan `/api/v1` | Identidad, catálogo y autorización | No abren PostgreSQL ni `player_api.php` |
| Backend COTAS | Llama a XUI y a PostgreSQL | Normaliza el catálogo y entrega la referencia | No almacena ni retransmite el vídeo en producción |
| XUI.one `player_api.php` | Lo llama solo `XuiHttpClient` | Línea, canales, EPG, películas, series y datos del servidor de medios | No es la base de usuarios de COTAS |
| Servidor de medios de XUI | Lo abre el cliente con la referencia | HLS en vivo y archivo de película o episodio | No pasa por Nest |
| Astra | No hay conexión directa | Queda detrás de XUI, si el panel ya lo usa como origen | No hay adaptador en este repositorio |
| PostgreSQL | Solo el backend | Identidad, sesiones, MFA y auditoría | No guarda catálogo ni segmentos |

La red de Compose se llama `cotas`. PostgreSQL no se publica fuera de `127.0.0.1`. El vídeo no tiene puerto en Compose.
