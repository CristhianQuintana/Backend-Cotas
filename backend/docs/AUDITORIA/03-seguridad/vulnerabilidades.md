# Vulnerabilidades y riesgos de seguridad

## Seguimiento de levantamiento — 11 de noviembre de 2026

Estados del árbol local, no de un despliegue. No hubo retest remoto ni acceso a XUI/FCM.

| Hallazgo | Estado actual |
|---|---|
| SEC-001 — ticket público de media | **Mitigado parcialmente:** TTL default 900 s, Redis cuando está habilitado y revocación de tickets del usuario en logout. Fallback en memoria y falta de binding/verificación por sesión mantienen riesgo residual. |
| SEC-002 — límite nulo de dispositivos | **Corregido en código con fail-safe configurable:** parser ahora acepta `100000`; confirmar semántica de `max_connections` con producto/XUI y validar en staging. |
| SEC-005 — redirect SSRF en media asset | **Corregido en código:** redirects manuales y allowlist por salto/origen, límite de saltos y puerto; requiere retest dinámico seguro. |
| SEC-006 — MFA staff | **Corregido en código:** TOTP/recovery exigido y enrolamiento inicial; E2E local PASS. Staging pendiente. |
| SEC-007 — redirect SSRF playback | **Corregido en código:** allowlist comprobada por salto y puerto; unit tests locales PASS. Retest dinámico pendiente. |
| SEC-003 — advisories Prisma/deepmerge | **Abierto:** no se actualizó dependencia ni se ejecutó nuevo `npm audit`; no hacer upgrade mayor sin validar compatibilidad. |
| SEC-004 — rate limiting por proceso | **Mitigado parcialmente:** Redis cuando disponible; fallback local sigue. Multiinstancia/Redis down pendientes. |

Pruebas locales del árbol actual: `npm test` 69/69 PASS; `npm run test:e2e` 12/12 PASS; `npm run build`, `npm run lint` y `npm run format:check` PASS. No certifican entorno productivo.

- **Fecha:** 2026-11-11 (UTC-5)
- **Commit:** `8fa5549`

---

### [SEC-001] Ticket de media público reutilizable hasta 6 horas (memoria de proceso)

- Fecha: 2026-11-11
- Plataforma/módulo: Playback
- Archivo, función o endpoint: `PlaybackMediaTicketStore`, `GET /playback/media/:ticketId`
- Clasificación: CONFIRMED VULNERABILITY (control insuficiente de acceso temporal)
- Severidad: HIGH
- Estado: open
- Entorno: código + api.cotasperu.com
- Evidencia: ticket obtenido por authorize; GET sin JWT devolvió HLS 200; TTL default 6h en código.

**Descripción:**  
El conocimiento de la URL equivale a autorización de lectura del stream durante la vida del ticket, sin revalidar sesión ni dispositivo.

**Precondiciones:** Authorize exitoso; posesión de `streamUrl`.

**Pasos de reproducción:**  
1. Login + `POST /playback/authorizations`.  
2. Abrir `streamUrl` sin header Authorization.  
3. Observar 200 y playlist.

**Resultado esperado:** Acceso acotado (TTL corto y/o sesión válida / un solo uso según política).

**Resultado obtenido:** 200 sin JWT; store in-memory TTL 6h.

**Impacto:** Compartir o filtrar URL permite visionado no autorizado; reinicios rompen streams legítimos.

**Causa raíz:** Proxy público + ticket longevo en memoria.

**Recomendación para desarrollo:** TTL minutos; opcional bind user/device; revocar tickets al logout; store compartido.

**Limitaciones:** No se midió adivinabilidad práctica (entropía alta); no se probó exfiltración vía logs de CDN.

---

### [SEC-002] Ausencia de tope de dispositivos cuando max_connections no llega desde XUI

- Fecha: 2026-11-11
- Plataforma/módulo: Identity
- Archivo, función o endpoint: claimDeviceSlot / subscription snapshot
- Clasificación: CONFIRMED DEFECT con impacto de seguridad (abuso de recurso / cuenta)
- Severidad: HIGH
- Estado: open
- Entorno: Cuenta A en api.cotasperu.com
- Evidencia: `maxConnections`/`maxDevices` null; `used` 13–14 dispositivos ACTIVE.

**Descripción:**  
Permite registrar aparatos sin límite API-side si XUI no informa el tope.

**Impacto:** Agotamiento de cupo lógico, enumeración de “presencia”, posible abuso de cuenta compartida.

**Recomendación:** Fail-safe: no aceptar null como ilimitado sin política explícita.

---

### [SEC-003] Dependencia Prisma CLI — deepmerge-ts (GHSA-ggr8-5vv4-36mx)

- Fecha: 2026-11-11
- Plataforma/módulo: Toolchain
- Archivo, función o endpoint: `npm audit --omit=dev`
- Clasificación: POTENTIAL RISK (no confirmada en runtime API)
- Severidad: MEDIUM
- Estado: open
- Entorno: estación de desarrollo/CI
- Evidencia: npm reportó 3 high vía `prisma` → `@prisma/config` → `deepmerge-ts`.

**Impacto:** Principalmente en procesos que ejecutan Prisma CLI con entradas no confiables; explotación remota vía API Nest **no demostrada**.

**Recomendación:** Actualizar Prisma cuando haya fix compatible; no usar `audit fix --force` a ciegas en producción.

---

### [SEC-004] Rate limit sensible solo en memoria de instancia

- Fecha: 2026-11-11
- Plataforma/módulo: Common
- Archivo, función o endpoint: `SensitiveRateLimitGuard`
- Clasificación: POTENTIAL RISK
- Severidad: MEDIUM
- Estado: open
- Evidencia: código Map; 429 en ráfaga de logins Cuenta B.

**Impacto:** Bypass multi-nodo / inconsistencia de protección.

---

### [SEC-005] SSRF por seguimiento de redirects en `/media/asset`

- Fecha: 2026-11-11
- Plataforma/módulo: Media
- Archivo, función o endpoint: `media.controller.ts` `redirect: 'follow'`
- Clasificación: CONFIRMED VULNERABILITY (control de redirect insuficiente)
- Severidad: HIGH
- Estado: open
- Entorno: código fuente
- Evidencia: ver CODE-009; allowlist solo en URL firmada inicial.

**Impacto:** Alcance a hosts internos vía open-redirect o origen allowlisted comprometido.

**Recomendación:** Validar cada hop; `redirect: 'manual'`.

---

### [SEC-006] MFA staff no enforced en login

- Fecha: 2026-11-11
- Plataforma/módulo: Identity
- Archivo, función o endpoint: `login.use-case.ts`
- Clasificación: CONFIRMED VULNERABILITY (bypass de control MFA)
- Severidad: HIGH
- Estado: open
- Entorno: código fuente
- Evidencia: ver CODE-008; `signEnrollmentToken` sin callers productivos.

**Impacto:** Cuentas ADMIN/OPERATOR con MFA “activo” siguen autenticándose solo con password.

**Recomendación:** Enforcement en login + emisión de enrollment token.

---

### [SEC-007] Upstream de playback puede salir de allowlist tras redirects

- Fecha: 2026-11-11
- Plataforma/módulo: Playback
- Archivo, función o endpoint: `resolve-stream-upstream.ts`
- Clasificación: CONFIRMED DEFECT / POTENTIAL RISK de SSRF (depende de redirects XUI)
- Severidad: HIGH
- Estado: open
- Evidencia: ver CODE-010.

**Recomendación:** Revalidar hostname por hop contra `xuiAllowedStreamHosts`.

---

## Confirmadas vs potenciales

| ID | Tipo | Severidad |
| --- | --- | --- |
| SEC-001 | CONFIRMED VULNERABILITY | HIGH |
| SEC-002 | CONFIRMED DEFECT (seguridad operativa) | HIGH |
| SEC-005 | CONFIRMED VULNERABILITY | HIGH |
| SEC-006 | CONFIRMED VULNERABILITY | HIGH |
| SEC-007 | CONFIRMED DEFECT / SSRF condicional | HIGH |
| SEC-003 | POTENTIAL RISK | MEDIUM |
| SEC-004 | POTENTIAL RISK | MEDIUM |

**CRITICAL confirmadas en esta auditoría:** ninguna.
