# Resultados de pruebas funcionales

## Seguimiento local del árbol de trabajo — 11 de noviembre de 2026

Corrida local aislada; no reemplaza los resultados históricos contra la API remota que siguen abajo. El árbol tenía cambios sin commit, por lo que este resultado no se atribuye a una versión publicada.

| ID | Estado | Procedimiento | Resultado |
|---|---|---|---|
| REG-LOCAL-UNIT | PASS | `npm test` | 23 suites, 69 tests PASS. Incluye validación de allowlist/puertos y payload FCM. |
| REG-LOCAL-E2E | PASS | `npm run test:e2e` | 1 suite, 12 tests PASS; API local con dobles. |
| REG-LOCAL-BUILD | PASS | `npm run build` | TypeScript compila. |
| REG-LOCAL-LINT | PASS | `npm run lint` | ESLint sin errores. |
| REG-LOCAL-FORMAT | PASS | `npm run format:check` | Archivos fuente cumplen Prettier. |
| NOTIF-REAL-FCM | NOT RUN | Envío a token/dispositivo de prueba | FCM y credenciales de entorno no verificadas; no se enviaron pushes. |
| NOTIF-ANDROID | BLOCKED | Recepción/foreground/background/tap | Flutter solo se inspeccionó; no hay integración FCM observada ni dispositivo de prueba. |
| DB-INTEGRATION | NOT RUN | Suite PostgreSQL | No se configuró ni contactó una base de pruebas para esta corrida. |

La prueba unitaria del payload confirma el mensaje construido por el código, no la entrega de Google FCM ni la presentación en Android.

- **Fecha ejecución:** 2026-11-11 ~08:15–08:20 America/Lima
- **Entorno:** `https://api.cotasperu.com/api/v1`
- **Commit backend (origen git local alineado a main):** `8fa5549`
- **Herramienta:** PowerShell `Invoke-WebRequest` + `curl.exe` (sin k6)
- **Cuentas:** Cuenta A, Cuenta B (sin credenciales en este documento)

---

| ID | Resultado | Resultado real | Evidencia | Defecto | Obs. |
| --- | --- | --- | --- | --- | --- |
| FUNC-001 | PASS | 200 `{"status":"ok"}` | curl health/live | — | |
| FUNC-002 | PASS | 200 | curl health/ready | — | |
| FUNC-003 | PASS | 401 | GET /auth/me sin Bearer | — | |
| FUNC-004 | PASS | 401 | login usuario inexistente | — | |
| FUNC-005 | PASS | 200 type=authenticated expiresIn=900 | login A | — | sin leak LAN/player_api en body |
| FUNC-006 | PASS | 200 role=CUSTOMER status=ACTIVE | /auth/me | — | **16-nov:** `maxDevices=10000` |
| FUNC-007 | PASS | 200 source=live activeConnections=0 | /account/subscription | — | **16-nov:** `maxConnections=10000` |
| FUNC-008 | PASS | 200 used/limit con presence | /devices | — | **16-nov:** used=7–8 limit=10000 |
| FUNC-009 | PASS | 204 | heartbeat con access vigente | — | 401 si se usa token post-refresh/logout |
| FUNC-010 | PASS | 200 ~26765 bytes | /catalog/home | — | |
| FUNC-011 | PASS | 200 | live/categories | — | |
| FUNC-012 | PASS | 200 items con id numérico | live/streams?limit=2 | — | |
| FUNC-013 | PASS | 200 delivery=direct URL `/playback/media/...` | authorize streamId=3537 | — | sin credenciales XUI en JSON |
| FUNC-014 | PASS | 200 body HLS `#EXTM3U` len=1560 | GET ticket **sin** JWT | CODE-004 | diseño proxy público |
| FUNC-015 | PASS | logout 204; me 401 | | — | |
| FUNC-016 | PASS | 200 | login B | — | |
| FUNC-017 | PASS | maxConnections=15 maxDevices=15 exp=2026-12-10T20:50:00.000Z | subscription B | — | status Active |
| FUNC-018 | PASS | used/limit=15/15; login paced **displace** (18×200); QR approve **403 DEVICE_LIMIT** | follow-up carga 2026-11-11 | — | límite 15 confirmado en approve; login no rechaza |
| FUNC-019 | PASS | 200 linkCode len=8 expiresIn=120 pollIntervalMs=1000 | device-link/session | — | |
| FUNC-020 | PASS | 401 | admin/users | — | |
| FUNC-021 | PASS | 400 | pageSize no es `limit` | — | contrato usa `limit` |
| FUNC-022 | PASS | 200 | refresh A | — | invalida uso posterior del access viejo |
| FUNC-023 | PASS | 200 items MOVIE + syncCursor | announcements?limit=5 | — | **16-nov** contrato notificaciones |

---

## Funcionalidades no implementadas / fuera de alcance

| Ítem | Clasificación |
| --- | --- |
| Favoritos | NOT APPLICABLE — sin controller |
| Approve QR E2E móvil+TV completo en lab | NOT RUN — requiere dos clientes coordinados; create session sí PASS |
| Verificación UI “Never Expire” en panel XUI | BLOCKED — sin acceso panel |
| LAN directa `10.10.0.31:3100` desde estación auditor | BLOCKED — no alcanzable |

---

## Resumen

| PASS | FAIL | BLOCKED | NOT RUN |
| --- | --- | --- | --- |
| 22 | 0 | 1 (LAN directa) | 1 (QR E2E TV+móvil completo) |

**Conclusión (16-nov):** Flujos críticos OK. Cupo A **10000** expuesto. Cupo B 15/15. Anuncios de catálogo disponibles para Flutter. Capacidad media y tickets intermitentes siguen abiertos (ver rendimiento).
