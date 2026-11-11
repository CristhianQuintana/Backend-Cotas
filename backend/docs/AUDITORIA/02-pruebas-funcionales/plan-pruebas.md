# Plan de pruebas funcionales

- **Fecha de elaboración:** 2026-11-11
- **Entorno objetivo:** `https://api.cotasperu.com/api/v1`
- **Cuentas:** Cuenta A (alta capacidad configurada), Cuenta B (límite 15) — credenciales solo en uso controlado, no reproducidas aquí
- **Commit:** `8fa5549`

---

## 1. Alcance

| Incluido | Excluido / no implementado |
| --- | --- |
| Auth login/refresh/logout | Favoritos (no hallado en controllers) |
| Perfil `/auth/me`, subscription | Panel XUI UI |
| Devices + heartbeat + device-link create | Estrés masivo de conexiones |
| Catálogo home/live/vod/series | Escrituras admin destructivas |
| Playback authorize + media proxy | MFA enrollment completo (no ejecutado E2E con usuario staff) |
| Autorización negativa (401) | |

---

## 2. Datos de prueba

| ID | Descripción |
| --- | --- |
| DATA-A | Cuenta A — línea alta capacidad |
| DATA-B | Cuenta B — max 15 |
| DATA-BAD | Usuario inexistente / clave incorrecta |
| DATA-DEV | `deviceId` UUID v4 estable por caso |

---

## 3. Casos de prueba

| ID | Prioridad | Endpoint / flujo | Precondiciones | Pasos | Esperado |
| --- | --- | --- | --- | --- | --- |
| FUNC-001 | P0 | GET /health/live | Red a API | GET | 200 ok |
| FUNC-002 | P0 | GET /health/ready | | GET | 200 |
| FUNC-003 | P0 | GET /auth/me sin token | | GET | 401 |
| FUNC-004 | P0 | POST /auth/login inválido | | credenciales falsas | 401 |
| FUNC-005 | P0 | POST /auth/login Cuenta A | DATA-A | login + deviceId | 200 + tokens |
| FUNC-006 | P0 | GET /auth/me Cuenta A | login A | GET | 200 CUSTOMER |
| FUNC-007 | P0 | GET /account/subscription A | login A | GET | 200 source live/cache |
| FUNC-008 | P0 | GET /devices A | login A | GET | used/limit/presence |
| FUNC-009 | P0 | POST /devices/heartbeat | login A | POST {} | 204 |
| FUNC-010 | P0 | GET /catalog/home | login A | GET | 200 cuerpo no vacío |
| FUNC-011 | P0 | GET /catalog/live/categories | login A | GET | 200 |
| FUNC-012 | P0 | GET /catalog/live/streams | login A | GET limit=2 | 200 + items |
| FUNC-013 | P0 | POST /playback/authorizations live | streamId válido | POST | 200 delivery + streamUrl proxy |
| FUNC-014 | P0 | GET streamUrl sin JWT | ticket fresco | GET URL | 200 HLS/media |
| FUNC-015 | P0 | POST /auth/logout | login A | POST | 204; me→401 |
| FUNC-016 | P0 | POST /auth/login Cuenta B | DATA-B | login | 200 |
| FUNC-017 | P0 | Subscription B límite | login B | GET subscription | maxConnections=15 |
| FUNC-018 | P1 | Llenar cupo B hasta DEVICE_LIMIT | login B | N logins deviceId nuevos | 403 DEVICE_LIMIT al superar 15 |
| FUNC-019 | P1 | POST /auth/device-link/session | | POST TV | 200 code 8 + poll 1000ms |
| FUNC-020 | P1 | GET /admin/users sin auth | | GET | 401 |
| FUNC-021 | P2 | GET live/streams?pageSize=2 | login A | query incorrecta | 400 validación |
| FUNC-022 | P1 | Refresh token A | login A | POST refresh | 200 |

**Entorno requerido:** API de pruebas alcanzable; cuentas A/B activas; no modificar límites XUI.
