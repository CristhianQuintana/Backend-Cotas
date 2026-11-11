# Dependencias — inventario y riesgos

- **Fecha:** 2026-11-11 (UTC-5)
- **Proyecto:** `cotas-backend@0.1.0`
- **Commit:** `8fa5549`
- **Runtime estación auditor:** Node `v24.13.0`, npm `11.19.1`
- **Engines declarados:** `node >=24 <25`

---

## 1. Dependencias directas de producción

| Paquete | Versión en package.json | Uso observado |
| --- | --- | --- |
| `@nestjs/common/core/platform-express/config/swagger/throttler` | ^12.x / ^6.x | Framework HTTP |
| `@prisma/client` | 6.19.3 | ORM |
| `argon2` | ^0.45.1 | Hash de contraseñas staff |
| `jose` | ^6.2.12 | JWT HS256 |
| `otpauth` | ^9.5.2 | MFA TOTP |
| `helmet` | ^8.3.0 | Cabeceras HTTP |
| `class-validator` / `class-transformer` | ^0.15 / ^0.5 | DTO |
| `bullmq` / `ioredis` | ^6.x | Colas / Redis |
| `rxjs` / `reflect-metadata` | ^7 / ^0.2 | Nest |

Dev: Jest 30, Prisma CLI, ESLint 9, TypeScript 6, Supertest, tsx.

---

## 2. `npm audit` ejecutado

### Producción (`npm audit --omit=dev`)

```text
3 high severity vulnerabilities
Paquete raíz: deepmerge-ts <8.0.0 (GHSA-ggr8-5vv4-36mx)
Cadena: prisma → @prisma/config → deepmerge-ts
```

**Clasificación:** vulnerabilidad en dependencia de **herramienta/CLI Prisma** (cadena `@prisma/config`), no en runtime típico de `@prisma/client` en el proceso Nest. Riesgo de explotación en API en producción: **bajo / no confirmado en ruta HTTP**. Riesgo en pipelines que ejecutan Prisma CLI: **potencial**.

### Incluyendo dev

También reportó `deepmerge` / `glob` vía **Jest** (solo desarrollo/CI). Severidades moderate/high en toolchain de test.

**Comando:** `npm audit` / `npm audit --omit=dev`  
**Limitación:** no se ejecutó Trivy/Snyk/OWASP Dependency-Check (no instalados / no autorizados).

---

## 3. Licencias

Paquete principal: `UNLICENSED` (privado COTAS).  
No se generó inventario SPDX completo: `npm-license-crawler` no finalizó de forma usable en la sesión. **Limitación documentada.**

---

## 4. Riesgos de mantenimiento

| Riesgo | Evidencia | Severidad |
| --- | --- | --- |
| Prisma 6 + advisory deepmerge-ts | npm audit omit=dev | MEDIUM (toolchain) |
| TypeScript 6 / Nest 12 stack reciente | package.json | INFORMATIONAL |
| Redis/BullMQ opcionales | config | INFORMATIONAL — degradación si mal configurados |
| Ticket playback in-memory | código | ver SEC/PERF — no es CVE de paquete |

---

## 5. Herramientas usadas en esta fase

| Herramienta | Versión / notas |
| --- | --- |
| npm audit | npm 11.19.1 |
| Inspección package.json / lock implícito | lectura |
| Trivy / Gitleaks / Semgrep / SonarQube / ZAP | **NO ejecutados** (no disponibles o fuera de alcance autorizado) |

---

## 6. Limitaciones

- No se analizaron imágenes Docker publicadas en GHCR con escáner de contenedores.
- No se listaron todas las dependencias transitivas una a una.
- No se modificó `package.json` ni se aplicó `npm audit fix` (prohibido por el mandato de auditoría).
