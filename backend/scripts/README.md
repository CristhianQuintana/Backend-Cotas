# Scripts

- `npm run check:env` valida el entorno actual e imprime solo el nombre del campo inválido.
- `npm run scan:secrets` recorre este directorio, omite `node_modules`, `dist`, `coverage` y archivos `.env` reales, y falla ante claves privadas, la IP interna de XUI o una URL de PostgreSQL cuya contraseña no sea una de las locales permitidas.
- `npm run openapi:export` genera el contrato descrito en `openapi/README.md`.
- `npm run seed` crea cuentas locales (`SEED_ADMIN_*` / `SEED_OPERATOR_*`) solo si el usuario no existe. Exige contraseñas de 12+ caracteres, no las imprime y en `production` se niega salvo `SEED_ALLOW_PRODUCTION=true`.
