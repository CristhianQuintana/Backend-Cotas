# Informe final de aceptación — Backend COTAS

**Fecha:** 2026-11-16  
**Rama:** `fix/cierre-backend-auditoria-final`  
**Alcance de evidencia:** código + Docker local (PostgreSQL, Redis, 2 API) + suites automatizadas

---

## Veredicto

# NO APTO PARA PRODUCCIÓN

El backend avanzó de “correcciones solo en código” a **evidencia local verificable** de Redis compartido, rate-limit distribuido, resiliencia PG y suites de integración.  
No se declara APTO porque faltan pruebas con **XUI alcanzable**, **FCM en dispositivo real** y **cobertura ≥80%**, y no hay staging comercial validado con este commit.

---

## Cumplimiento

| Área | ¿Cierre? | Evidencia |
| --- | --- | --- |
| Funcionalidad | PARCIAL | E2E/unit OK; regresión A/B bloqueada sin XUI |
| HLS / proxy | PARCIAL | Fix código + script carga; sin medición con upstream |
| Tickets Redis | SÍ (capa store) | IT cross-store PASS |
| Rate limiting | SÍ (Redis) | IT + clave en API viva |
| MFA / SSRF / deps | PARCIAL/SÍ | Código+tests; audit prod 0; retest HTTP staff/SSRF pendiente |
| Resiliencia | SÍ (local) | ready 503&lt;3s y recover |
| FCM | NO | Backend listo; sin evidencia dispositivo |
| Cobertura | NO | ~68.6% stmt |
| Infra local | SÍ | Compose multi-réplica 3200/3201 |
| Staging/prod deploy | NO | Commit no validado en staging remoto |

---

## Bloqueantes reales (únicos que impiden APTO)

1. **Red XUI/Astra:** `XUI_BASE_URL` no responde (timeout). Impide login real, tickets HTTP multi-réplica, carga HLS y regresión A/B.  
   **Acción:** habilitar ruta Docker→XUI (o VPN/host gateway) y ejecutar `smoke:deploy` + `validate:tickets-multi` + `validate:load-playback`.

2. **FCM E2E:** faltan credenciales FCM operativas en el entorno de prueba y dispositivo Android/Flutter.  
   **Acción:** `FCM_ENABLED=true` + credenciales; registrar token; sync catálogo; capturas FG/BG/killed.

3. **Cobertura &lt; 80%:** 68.6% statements / 59.3% branches en ámbito unitario.  
   **Acción:** ampliar tests de controllers/mappers/use-cases hasta el umbral.

4. **Staging dedicado:** despliegue del commit con respaldo/rollback y campaña de aceptación formal.

---

## Qué sí quedó cerrado con evidencia

- Provider Redis global + inyección en rate-limit (bug: guard sin DI → 503 falso).
- Tickets fail-closed + IT Redis multi-store.
- Resiliencia PG medida.
- Invalidación de tokens FCM UNREGISTERED.
- Scripts de validación automatizados y guía de deploy/rollback.
- `npm audit --omit=dev` limpio.

Detalle operativo: `REPORTE_PRUEBAS_CIERRE.md`, `INFORME_CAUSA_RAIZ_CIERRE.md`, `GUIA_DESPLIEGUE_ROLLBACK.md`.
