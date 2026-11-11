# Calidad de código

- **Fecha:** 2026-11-11 (UTC-5)
- **Commit:** `8fa5549`

---

## 1. Métricas disponibles

| Métrica | Valor | Fuente |
| --- | --- | --- |
| Suites unitarias | 21 passed | `npm test` |
| Tests unitarios | 63 passed | `npm test` |
| Suites e2e | 1 passed / 12 tests | `npm run test:e2e` |
| Cobertura statements | **72.48%** | `npm run test:cov` |
| Cobertura branches | **60.6%** | idem |
| Cobertura functions | **69.4%** | idem |
| Cobertura lines | **72.23%** | idem |
| Referencia informe QA | 80% | no alcanzada |

---

## 2. Diseño modular y SOLID

**Fortalezas observadas:**

- Separación por bounded contexts (`identity`, `catalog`, `playback`, `integrations/xui`).
- Puertos/adapters en identity (`identity.ports.ts`) y use-cases inyectables.
- Errores de dominio centralizados (`DomainError`, `PublicMessages`) — mensajes públicos sin stack traces a cliente.
- Validación DTO con `class-validator` en queries de catálogo y auth.

**Debilidades:**

- `PrismaIdentityStore` concentra muchos puertos (User/Session/Line/DeviceLink) → alto acoplamiento a infraestructura (SRP tensionado).
- Ticket store y rate-limit sensible como estado de proceso → dificulta escala horizontal (ver CODE-001/002).

---

## 3. Complejidad y duplicación

- Mappers XUI extensos pero con tests unitarios dedicados.
- Lógica de cupo de dispositivos duplicada conceptualmente entre Prisma store e in-memory fake (aceptable para tests).
- Redacción de secretos presente (`common/logging/redact.ts` con spec).

---

## 4. Convenciones

- TypeScript estricto de build (`tsconfig.build.json`).
- Prettier/ESLint en CI (histórico de bloqueos por formato).
- Docs de integración en `docs/integraciones/` alineadas en gran parte con la API.

---

## 5. Manejo de errores y async

- Filter HTTP unifica respuestas.
- Cliente XUI registra outcomes (`timeout`, `upstream_auth`, etc.) — visto en logs de test.
- Proxy playback usa streams Node `http`/`https` con validación de path en segmentos (`..`, `://` rechazados).

---

## 6. Cobertura por área (cualitativa)

| Área | Cobertura aparente | Comentario |
| --- | --- | --- |
| Login / device quota / device-link | Alta | specs dedicadas |
| Catalog home/cache | Media-alta | |
| Playback resolve upstream | Media-alta | |
| XUI HTTP client | Media (~51%) | paths de error parciales |
| FCM | Baja (~12%) | |
| Session use-cases (logout notify) | Media-baja | |

---

## 7. Observaciones y recomendaciones (sin implementar)

1. Elevar cobertura hacia ≥80% en rutas críticas de reproducción y auth.
2. Extraer `PrismaIdentityStore` en repositorios más pequeños.
3. Alinear TTL/documentación de tickets.
4. Rate limiting distribuido.
5. Contrato OpenAPI exportable (`openapi:export`) — verificar que se publica en CI (no validado aquí).

**Deuda adicional confirmada en revisión estática:** MFA staff no cableado al login; SSRF por redirects en media/playback; CORS incompleto; OpenAPI desfasado; `PrismaIdentityStore` / `AppModule` como puntos de acoplamiento.

**Evaluación general de mantenibilidad:** **MEDIA** (antes media-alta) por la combinación de proxy efímero, cupo inconsistente y controles MFA/SSRF incompletos.
