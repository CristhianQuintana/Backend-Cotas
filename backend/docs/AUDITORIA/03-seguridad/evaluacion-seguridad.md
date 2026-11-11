# Evaluación de seguridad

- **Fecha:** 2026-11-11 (UTC-5)
- **Commit:** `8fa5549`
- **Metodología:** revisión de código + pruebas no destructivas en API de pruebas + `npm audit`
- **Referencias:** OWASP API Top 10, ASVS (muestreo), buenas prácticas Nest/Node
- **Herramientas:** inspección manual, curl/PowerShell, npm audit 11.19.1  
  **No usadas:** ZAP, Semgrep, Gitleaks, Trivy, SonarQube

---

## 1. Alcance

Autenticación JWT, sesiones, dispositivos, autorización por roles, rate limiting, validación de entrada, proxy multimedia, secretos en respuestas, dependencias npm, CORS/Helmet (código).

---

## 2. Resultados por dominio

| Dominio | Resultado | Notas |
| --- | --- | --- |
| JWT (HS256, aud/iss/exp, sid+role) | OK con reservas | `jose`; secreto simétrico — rotación/gestión no auditada en servidor |
| Sesión server-side + logout | OK | me→401 tras logout verificado |
| BOLA/IDOR dispositivos | Parcial OK | devices scoped por userId en código; no se probó cross-user con dos cuentas sobre mismo id |
| Escalada de privilegios admin | OK superficie | /admin y /health/dependencies exigen auth/rol (401 sin token) |
| Enumeración usuarios | Residual | login inválido mensaje genérico PublicMessages |
| Fuerza bruta / rate limit | Parcial | Throttler global + SensitiveRateLimit in-memory; 429 observado |
| Validación entrada | OK | class-validator; pageSize inválido→400 |
| Inyección SQL | OK aparente | Prisma parametrizado; sin pruebas de fuzz avanzadas |
| CORS / Helmet | OK en código | `configure-http.ts` helmet + corsOrigins |
| Exposición secretos en API | OK en muestras | login/authorize sin password XUI ni LAN |
| Logs sensibles | No verificado en servidor | redact.ts existe; logs de contenedor no leídos |
| Tickets playback | Riesgo medio | públicos, TTL 6h, memoria (SEC-001/002) |
| SSRF proxy | Controles presentes | path segment valida `/` sin `..`/`://`; upstream desde ticket emitido server-side |
| Dependencias | 3 high (prisma toolchain deepmerge-ts) | ver vulnerabilidades.md |
| Docker/imagen | NOT RUN | sin Trivy |

---

## 3. Evaluación general

El backend muestra **controles de autenticación y encapsulación de XUI razonables** para un BFF IPTV. Los puntos más débiles observados son:

1. Ciclo de vida y almacenamiento de tickets de media.
2. Rate limiting no distribuido.
3. Cupo de dispositivos ausente cuando XUI no reporta máximo (abuso de registro de aparatos).
4. Superficie pública del proxy multimedia (necesario para players, pero requiere TTL/revocación más estrictos).

**Postura:** Aceptable para entorno de pruebas con deudas de seguridad **HIGH** no CRITICAL confirmadas en esta pasada.

---

## 4. Limitaciones

- Sin pentest autenticado de IDOR entre dos usuarios sobre `DELETE /devices/{id}` cruzado.
- Sin inspección de secretos en CI/CD ni `.env` del servidor (prohibido volcar secretos).
- Sin prueba de reutilización prolongada de ticket tras logout del emisor.
- LAN/XUI panel no auditados in-situ.
