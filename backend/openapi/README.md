# OpenAPI

`npm run openapi:export` asigna una configuración ficticia de prueba, ignora `.env` y arranca la aplicación el tiempo necesario para escribir `openapi/openapi.json`. El script aborta si el JSON resultante contiene el secreto JWT, la clave MFA, la contraseña XUI o `DATABASE_URL`.

En desarrollo, con `SWAGGER_ENABLED` distinto de `false`, la UI queda en `http://127.0.0.1:3000/api/docs`. En `NODE_ENV=production` permanece apagada salvo `SWAGGER_ENABLED=true`.
