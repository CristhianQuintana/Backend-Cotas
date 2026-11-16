# Resumen ejecutivo — Auditoría backend COTAS

- **Última actualización:** 2026-11-16
- **API evaluada:** `https://api.cotasperu.com/api/v1`
- **Commit local de referencia:** `113a538`
- **Cuentas de prueba:** Cuenta A (`10200000`, tope API **10000**), Cuenta B (`userprueba`, tope **15**)

---

## Veredicto

| Veredicto | Condición |
| --- | --- |
| **APTO CONDICIONAL** para piloto / pruebas controladas | Flujos críticos OK; cupo A corregido en API; anuncios de catálogo expuestos |
| **NO APTO** como producción comercial sin restricciones | Media satura a **10 VU** (503); tickets con **404 intermitentes**; cobertura ~70%; multi-IP no medido |

---

## Capacidad demostrada (2026-11-16)

| Dominio | Estable (1 IP) | Saturación |
| --- | --- | --- |
| API JSON | **20 VU** (p95 ~583 ms) | 30 VU → 429 |
| Playlist HLS (tickets distintos) | **5 VU** (p95 ~533 ms) | 10 VU → 503 |
| RPS sostenible / IP | **~3.5–5** | Rate limit global ~300/min |
| Estimación TV tentativa | **≈5** playlists concurrentes / edge-IP | No extrapolar a granja |

Detalle: `04-rendimiento/resultados-pruebas-estres.md` e `informe-capacidad.md`.

---

## Hallazgos prioritarios abiertos

1. **PERF-001** — proxy media 503 desde 10 VU con streams independientes.  
2. **PERF-003** — tickets 404 intermitentes bajo emisión escalonada (multi-instancia/Redis).  
3. Cobertura **~70%** (&lt;80%).  
4. OpenAPI incompleto; SSRF/MFA staff: corregidos en código, validación staging parcial.

**Cerrado / mejorado vs auditoría inicial:** Cuenta A ya no devuelve `maxConnections=null` (ahora **10000**). Soak con pacing sin errores. Endpoint de anuncios operativo.

---

## Notificaciones de películas/series nuevas

| Capa | Estado |
| --- | --- |
| Backend detecta altas en sync XUI | **Sí** (`CatalogAnnouncementsService`) |
| API `GET /catalog/announcements` | **Sí** — verificado 200 con `MOVIE` + `syncCursor` |
| Push FCM de catálogo | **No** (diseño actual = poll + local) |
| App móvil muestra “Nueva película” | **Pendiente en Flutter** |

**Cómo debe conectarse la app móvil:** ver `INSTRUCCIONES_DEV_FLUTTER_NOTIFICACIONES.md` y `docs/qa/CONTRATO_API_NOTIFICACIONES_FLUTTER.md`. Resumen: Bearer + poll incremental `since/syncCursor` cada 15–30 min / foreground → notificación local con texto “Nueva película” / “Nueva serie” / “Nuevo episodio”.

---

## Regresión

72 unit + 12 e2e **PASS** (2026-11-16).

---

## Para cerrar el proyecto

1. Redis compartido verificado en todas las réplicas (tickets).  
2. Staging de media multi-IP con métricas host/XUI.  
3. Flutter: poller + notificaciones locales de catálogo.  
4. Subir cobertura crítica a ≥80%.  
5. Re-auditoría corta post-deploy.
