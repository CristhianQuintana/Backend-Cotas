# SEC-003 — Tratamiento dependencias (2026-11-16)

## Hallazgo
`npm audit` reportaba **3 high** en `deepmerge-ts < 8` vía `prisma` → `@prisma/config` (toolchain CLI).

## Análisis
- No afecta el runtime de `@prisma/client` en el proceso Nest.
- `npm audit fix --force` proponía Prisma 7 (breaking); descartado.

## Tratamiento
```json
"overrides": { "deepmerge-ts": "^8.0.1" }
```

## Resultado
`npm audit --omit=dev` → **found 0 vulnerabilities**.

## Residual
Vulnerabilidades low/moderate en árbol completo (dev) quedan fuera del criterio HIGH/CRITICAL de runtime; revisar en ciclo de dependencias mensual.
