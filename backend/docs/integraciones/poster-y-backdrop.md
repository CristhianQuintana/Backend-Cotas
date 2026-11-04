# Póster y fondo (backdrop) — contrato para apps

**Base URL:** `https://api.cotasperu.com/api/v1`  
**Auth:** `Authorization: Bearer <accessToken>`

## Regla de UI

| Campo | Uso |
| --- | --- |
| `posterUrl` | Afiche / logo delante (`contain`, proporción vertical o logo) |
| `backdropUrl` | Fondo ancho detrás (`cover`, a sangre) |

- **Nunca** usar `posterUrl` como fondo.
- Si `backdropUrl` es `null` → fondo de **color oscuro plano**, no el póster.
- Si `posterUrl` es `null` → no meter el backdrop en el hueco del afiche.
- Las URLs ya vienen firmadas en `https://api.cotasperu.com/api/v1/media/asset?...`. No llamar a XUI, ni `s:1:`, ni `resize?url=`.

## Dónde viene cada dato

| Contenido | Endpoint | posterUrl | backdropUrl |
| --- | --- | --- | --- |
| Película (ficha) | `GET /catalog/vod/streams/{id}` | afiche | fondo (o `null`) |
| Serie (ficha) | `GET /catalog/series/{id}` | afiche | fondo (o `null`) |
| Película (lista) | `GET /catalog/vod/streams` | miniatura (`posterUrl` / `iconUrl`) | siempre `null` |
| Serie (lista) | `GET /catalog/series` | miniatura | siempre `null` |
| Canal | `GET /catalog/live/streams` | logo (`posterUrl` = `iconUrl`) | siempre `null` |

El fondo solo está en la **ficha** (detalle). En grilla basta el póster.

## Ejemplo película (La 8.ª noche, id `3721`)

```http
GET /catalog/vod/streams/3721
```

```json
{
  "id": "3721",
  "name": "La 8.ª noche",
  "posterUrl": "https://api.cotasperu.com/api/v1/media/asset?u=...poster...&exp=...&sig=...",
  "backdropUrl": "https://api.cotasperu.com/api/v1/media/asset?u=...backdrop...&exp=...&sig=...",
  "plot": "...",
  "genre": "...",
  "year": "2021",
  "duration": "...",
  "rating": "..."
}
```

Comprobar: `posterUrl` ≠ `backdropUrl` (archivos distintos). Afiche rojo delante; rostro en oscuridad detrás.

## Ejemplo canal

```json
{
  "id": "3715",
  "name": "Willax",
  "iconUrl": "https://api.cotasperu.com/api/v1/media/asset?...",
  "posterUrl": "https://api.cotasperu.com/api/v1/media/asset?...",
  "backdropUrl": null
}
```

Logo completo sobre fondo oscuro; no inventar backdrop.

## Composición recomendada (ficha / hero)

1. Capa atrás: `backdropUrl` a todo el ancho, `cover`, centrado.  
2. Velo oscuro para legibilidad del texto.  
3. Delante: `posterUrl` vertical / logo, `contain`.  
4. Textos (título, año, géneros, duración, nota, plot) del mismo JSON.

## Criterio de aceptación

1. Detalle de `3721` con dos URLs distintas y ambas imagen real.  
2. Serie con backdrop (p. ej. id `97`) igual: afiche ≠ fondo.  
3. Canal con logo y `backdropUrl: null`.  
4. Ficha sin fondo no repite el póster detrás.
