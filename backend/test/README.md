# Pruebas

- `npm test` ejecuta unidad y la regla de arquitectura. XUI se sustituye por un servidor HTTP local o un doble. No usa la red de COTAS.
- `npm run test:e2e` levanta la aplicación Nest con identidad en memoria y el doble de XUI. Cubre autenticación, autorización, MFA, rotación de refresh, CORS, límites de cuerpo y el contrato de errores.
- `npm run test:integration` habla con PostgreSQL solo si `RUN_DB_INTEGRATION=true`. Sin esa variable los casos quedan omitidos.

No hay prueba de carga ni objetivo de latencia acordado. No hay certificación de penetración.
