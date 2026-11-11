# Informe final de evaluación técnica del backend COTAS PERÚ S.A.C.

- Fecha de cierre documental: 2026-11-11 (UTC-5)
- Organización: COTAS PERÚ S.A.C.
- Evaluación: backend, sin cambios de código ni infraestructura
- Alcance: código, comportamiento actual, seguridad, rendimiento, resiliencia, regresión y comparación de auditoría previa
- Base de revisión: repositorio local, evidencia documental previa y pruebas no destructivas ejecutadas o informadas en la auditoría de referencia

## 1. Portada y datos de auditoría

- Auditor: revisión técnica documental y operativa del backend
- Repositorio principal: `CristhianQuintana/Backend-Cotas`
- Entorno evaluado: backend de COTAS, con API pública de pruebas `https://api.cotasperu.com/api/v1`
- Estado del código auditado: sin correcciones aplicadas durante la evaluación; no se modificó el backend
- Commit auditado de referencia: `8fa5549a7cd15e4204edfbd944a5328596c12d84`
- Evidencias de la auditoría previa: `backend/docs/AUDITORIA/00-inventario-proyecto`, `01-auditoria-codigo`, `02-pruebas-funcionales`, `03-seguridad`, `04-rendimiento`, `05-resiliencia`, `06-pruebas-regresion`, `07-informe-final`
- Entregable principal: este informe único consolidado

## 2. Resumen ejecutivo

El backend de COTAS muestra un camino crítico funcional correcto en el entorno de pruebas: login, acceso autenticado, suscripción, catálogo, autorización de reproducción, proxy de media y logout operan de forma consistente en los escenarios documentados. Se registran además evidencias de capacidad, resiliencia y regresión que permiten concluir que el servicio tiene un comportamiento funcional aceptable para pilotaje y pruebas controladas.

Sin embargo, la evaluación no permite recomendar despliegue comercial sin restricciones. Se identifican riesgos de alta severidad y fallas técnicas relevantes que no fueron corregidas durante la auditoría, principalmente en torno a:

- tickets de media en memoria del proceso, sin persistencia compartida ni revocación robusta,
- falta de fail-safe cuando XUI no reporta maxConnections/maxDevices,
- MFA administrativo no aplicado en el flujo de login,
- validación insuficiente de redirects en media/playback con riesgo de SSRF,
- capacidad limitada del proxy multimedia bajo concurrencia, con 503 en carga media a 25 VU,
- rate limiting por instancia y por memoria local, no distribuido.

El estado real del backend es, por tanto, compatible con un despliegue experimental o pilotado con control operativo, pero no con una producción robusta sin un plan formal de mitigación y seguimiento.

## 3. Alcance y metodología

### Alcance

- Revisión del código y arquitectura del backend.
- Evaluación funcional de flujos críticos.
- Revisión de hallazgos HIGH y MEDIUM de la auditoría anterior.
- Investigación no destructiva del usuario `10200000` y de cupos/dispositivos.
- Evaluación de seguridad, capacidad y resiliencia sin alterar producción ni cambios de infraestructura.
- Consolidación en un único informe final.

### Metodología

- Inspección estática del backend y de la documentación de auditoría previa.
- Lectura de hallazgos, resultados funcionales, rendimiento y resiliencia documentados en `backend/docs/AUDITORIA/`.
- Comparación entre resultados previos y estado actual.
- Verificación funcional de los módulos críticos a partir de evidencia documental disponible.
- Clasificación por evidencia y no por suposición.

### Restricciones aplicadas

- No se realizaron modificaciones al código.
- No se cambiaron configuraciones ni infraestructura.
- No se ejecutaron migraciones ni procesos destructivos en producción.
- No se alteraron cuentas, sesiones, dispositivos, tickets o registros.
- Los resultados se expresan como estado real observado bajo las condiciones evaluadas.

## 4. Arquitectura actual del backend

La arquitectura persistente del backend es la que aparece documentada en `backend/docs/AUDITORIA/00-inventario-proyecto/arquitectura.md` y corresponde a un BFF NestJS con:

- API principal para autenticación, dispositivos, catálogo, playback y health.
- PostgreSQL como almacenamiento principal y Prisma como capa de acceso.
- Integración con XUI como sistema upstream para catálogo, autenticación y autorización de reproducción.
- Endpoint de reproducción multimedia que se apoya en un proxy de media con ticket de acceso.
- Control de dispositivos, sesiones y suscripción según políticas locales y datos recibidos desde XUI.

La estructura tecnológica es coherente con un servicio de IPTV/BFF; el problema principal no es la arquitectura básica, sino la consistencia y robustez de algunos controles críticos, especialmente en dispositivos, playback y seguridad de redirecciones.

## 5. Estado de infraestructura y dependencias

### Infraestructura

La auditoría previa documenta un entorno con:

- API de pruebas activa `https://api.cotasperu.com/api/v1`.
- PostgreSQL disponible y controlado en staging/lab.
- Stack local Docker para pruebas de resiliencia.
- Dependencia remota XUI con integración real, sin alterar producción.

### Dependencias y herramientas

- El repositorio incluye Prisma, NestJS y componentes que se ejecutan sobre Node.js 24.
- La auditoría previa reporta vulnerabilidades en dependencias de npm/Prisma, sin demostrar explotación directa en runtime, pero con riesgo en el toolchain y en procesos de CLI.
- No se instalaron ni actualizaron dependencias durante esta evaluación.

## 6. Evaluación de los hallazgos HIGH

### H-01 — Tickets de reproducción en memoria

- Estado: CONFIRMADA.
- Evidencia: `src/modules/playback/infrastructure/playback-media-ticket.store.ts` usa almacenamiento en `Map` del proceso; el TTL está documentado como 6 h. La auditoría previa y el código indican que los tickets no sobreviven reinicios ni de una instancia a otra.
- Impacto funcional y seguridad: los streams pueden perder vigencia tras reinicio o despliegue; el ticket público puede ser compartido durante la vida útil del mismo; la autorización no está vinculada con un control fuerte de sesión y dispositivo.
- Severidad actual: HIGH.
- Conclusión: persistencia insuficiente para producción con múltiples instancias o despliegues frecuentes.

### H-02 — Control de dispositivos

- Estado: CONFIRMADA.
- Evidencia: la Cuenta A muestra `maxConnections`/`maxDevices = null` mientras `used` es mayor que cero; la Cuenta B reporta `maxConnections=15`, `maxDevices=15` y el flujo QR approve falla con `403 DEVICE_LIMIT` cuando se alcanza el tope.
- Impacto: si XUI omite el límite, el backend no aplica un fail-safe y puede admitir más dispositivos de los que se desea.
- Severidad: HIGH.
- Conclusión: la lógica de cupo es inconsistente entre cuentas y especialmente frágil con límites faltantes.

### H-03 — MFA administrativo

- Estado: CONFIRMADA por diseño insuficiente.
- Evidencia: el código disponible y la auditoría previa muestran que los campos MFA existen, pero el login de staff no exige TOTP/del flujo de enrollment. La lógica no está integrada al login productivo.
- Impacto: un usuario ADMIN/OPERATOR puede autenticarse sin cumplir la validación del segundo factor si el control no está materializado en el flujo real.
- Severidad: HIGH.
- Conclusión: control de seguridad de acceso sin unenforcement real.

### H-04 — SSRF en `/media/asset`

- Estado: CONFIRMADA.
- Evidencia: la auditoría previa identificó que el endpoint de media se basa en redirects y validación insuficiente; el comportamiento no se corrigió durante esta etapa.
- Impacto: un origen permitido o un redirect mal validado puede llevar la solicitud a destinos internos o fuera del allowlist.
- Severidad: HIGH.
- Conclusión: requiere validación de cada hop y bloqueo de redirects no autorizados.

### H-05 — SSRF en playback

- Estado: CONFIRMADA como riesgo técnico con evidencia suficiente.
- Evidencia: la validación final del upstream de streams depende del comportamiento de XUI y del allowlist del backend; la auditoría previa identifica que el componente de resolución tiene riesgo de salida de allowlist tras redirects o destinos no controlados.
- Impacto: exfiltración de peticiones internas o abuso del proxy de reproducción.
- Severidad: HIGH.
- Conclusión: la validación del host de upstream debe revalidarse por hop.

### H-06 — Errores 503 multimedia bajo concurrencia

- Estado: CONFIRMADA.
- Evidencia: la capacidad medida para playback media muestra que a 25 VU aparecen 49 errores 503 sobre 75 peticiones evaluadas; el proxy de media se satura bajo fan-out concurrente.
- Impacto: la reproducción falla bajo carga no trivial; la experiencia de usuarios se ve afectada antes de llegar a un nivel tolerable.
- Severidad: HIGH.
- Conclusión: cuello de botella funcional y operativo en streaming multimedia.

## 7. Evaluación de hallazgos MEDIUM

Los hallazgos MEDIUM documentados en la auditoría previa siguen siendo relevantes y no se corrigieron durante esta etapa:

1. Rate limiting en memoria por proceso.
2. Falta de distribución real del rate limit entre instancias.
3. `ready` lento ante indisponibilidad de PostgreSQL.
4. CORS con extensiones no completamente controladas.
5. Condiciones de carrera en el flujo QR y la gestión de dispositivos.
6. Dependencias de npm/Prisma con vulnerabilidades conocidas.
7. Cobertura de pruebas por debajo del umbral recomendado.
8. Consistencia de sesiones y dispositivos bajo carga.
9. Gestión de errores y trazabilidad limitada en algunos paths.

Todos estos hallazgos se consideran vigentes si no hay evidencia de corrección material durante la auditoría final. No se aplicaron cambios ni mitigaciones.

## 8. Investigación detallada del usuario 10200000

### 8.1 Objetivo de la investigación

Determinar si el usuario `10200000` cumple con la cuenta real del sistema, sus límites de dispositivos, sus conexiones y su comportamiento comparado con XUI y con el backend COTAS.

### 8.2 Resultados verificables

Se evidenció, en la documentación de auditoría previa, que:

- el usuario tipo A, con un límite aparentemente no reportado por XUI, muestra `maxConnections` y `maxDevices` como `null`,
- la API devuelve `used`/`activeDevices` con valores superiores a cero,
- el endpoint de suscripción y el endpoint de perfil no son lo bastante estrictos cuando el valor de XUI falta,
- la cuenta B confirma que el tope operativo sí existe (`15/15`), y que el flujo de QR falla con `403 DEVICE_LIMIT` cuando se supera el límite.

### 8.3 Limitaciones de verificación

No se tuvo acceso a la base de datos del sistema ni al panel de XUI para corroborar los datos reales del usuario en tiempo real. Por tanto:

- La existencia del usuario en base de datos se considera verificada solo indirectamente a través de flujo de API y de la auditoría previa.
- La correspondencia con XUI no se pudo comprobar de forma directa en panel externo.
- No se exponen datos sensibles ni credenciales en este informe.

### 8.4 Conclusión

El usuario o perfil tipo A presenta un caso crítico de inconsistencia: el backend interpreta el límite como nulo y permite funcionamiento sin tope efectivo. Este comportamiento es un riesgo operativo y de seguridad significativo, especialmente si el valor del proveedor XUI no llega en el snapshot requerido.

## 9. Resultados de pruebas funcionales

La auditoría previa documenta pruebas funcionales con resultado `PASS` para los flujos principales:

- health live/ready,
- login con usuario válido e inválido,
- refresh token y logout,
- perfil de usuario y autorización,
- catálogo de canales,
- autorización de playback,
- proxy HLS de media,
- consulta de dispositivos,
- control de sesión y heartbeat,
- flujo de QR y creación de device-link.

Los casos de resultado documentado por la auditoría previa fueron:

- `FUNC-001` a `FUNC-022`: 21 `PASS`, 0 `FAIL` en la ruta funcional crítica documentada.
- `FUNC-013` y `FUNC-014`: la autorización de stream y la entrega del ticket HLS presentan una exposición funcional del proxy público (no un fallo de negocio, sino un diseño de acceso público con ticket temporal).
- `FUNC-017` y `FUNC-018`: la Cuenta B confirma que `maxConnections=15` y que `QR approve` produce `403 DEVICE_LIMIT` cuando el cupo está lleno.

Conclusión funcional: los flujos críticos están funcionando, pero la seguridad del acceso y la consistencia del cupo no son adecuadas para producción robusta.

## 10. Resultados de pruebas de seguridad

Se documentan las siguientes observaciones confirmadas:

| ID | Hallazgo | Severidad | Estado |
|---|---|---|---|
| SEC-001 | Ticket de media público reutilizable hasta 6 horas | HIGH | CONFIRMADA |
| SEC-002 | Ausencia de tope cuando XUI no reporta max_connections | HIGH | CONFIRMADA |
| SEC-003 | Prisma / deepmerge-ts (npm audit) | MEDIUM | POTENCIAL |
| SEC-004 | Rate limit sensible solo en memoria | MEDIUM | POTENCIAL |
| SEC-005 | SSRF por redirects en `/media/asset` | HIGH | CONFIRMADA |
| SEC-006 | MFA staff no enforced | HIGH | CONFIRMADA |
| SEC-007 | Upstream de playback fuera de allowlist por redirects | HIGH | CONFIRMADA / CONDICIONAL |

El panorama de seguridad no es crítico por vulnerabilidad explotada masiva ni evidencia de acceso directo a producción, pero sí presenta riesgos reales y no resueltos en la capa de control de sesiones, media, redirecciones, cupos y MFA.

## 11. Resultados de pruebas de rendimiento y capacidad

La auditoría previa reporta resultados cuantificados:

- Health y API JSON estables en ~10–20 VU con p95 razonable.
- Playback media estable solo en ~10 VU; a 25 VU dominan los 503.
- Health con spike 80 VU produce 429.
- Catalog y health con 40 VU presentan saturación y throttling.
- El cuello de botella no es solo un límite puntual; incluye el proxy de media y el rate limit global.

### Capacidad útil observada

- `Health`: ~10 VU sin errores.
- `Catalog`: ~10–20 VU sin errores; p95 0.4–1.2 s.
- `Playback media`: ~10 VU estable; p95 aproximado 0.7 s; 25 VU dispara 503.

### Conclusión de capacidad

La capacidad actual es suficiente para una primera etapa de operación controlada, pero no para producción comercial de alto tráfico con varios usuarios concurrentes y reproducciones simultáneas.

## 12. Resultados de pruebas de resiliencia

El informe de resiliencia documenta:

- `live` responde 200 durante caída de PostgreSQL local.
- `ready` reacciona lentamente ante la caída de PostgreSQL y puede permanecer en timeout antes de reflejar fallo limpio.
- El reinicio del proceso backend recupera servicios, pero los tickets de media no sobreviven al restart, por diseño.
- La pérdida de tickets tras reinicio es una defectología confirmada.
- El control de fallos de XUI en producción no se ejecutó para no afectar clientes, por lo que la comparación no es total.

### Hallazgos de resiliencia confirmados

- RES-001: pérdida de tickets tras reinicio del backend.
- RES-002: `/health/ready` puede colgar durante caída de PostgreSQL.
- RES-003: proxy media retorna 503 bajo carga concurrente.

## 13. Estado de pruebas unitarias, integración y E2E

La auditoría previa reporta:

- Unit tests: 63 PASS.
- E2E: 12 PASS.
- Cobertura de statements: 72.48%.

Se reconoce que la cobertura está por debajo de la referencia recomendada (80%), especialmente en zonas de FCM, XUI y sesiones.

## 14. Cobertura de código

La cobertura está en 72.48% de statements. Este nivel aporta cierta confianza, pero no es suficiente para una plataforma con riesgos de seguridad y disponibilidad de streaming. Debe considerarse como un indicador de preparación parcial, no como garantía de producción.

## 15. Comparación con la auditoría anterior

La comparación entre el estado previo y el actual indica que:

- los flujos funcionales básicos siguen correctos,
- la evidencia funcional no se ha degradado en los caminos felices,
- permanecen identificados los mismos riesgos HIGH y varios MEDIUM,
- la capacidad y la resiliencia siguen sujetas a las limitaciones observadas,
- no se detecta una corrección material de los hallazgos críticos ni de la baja cobertura.

No se puede asumir que un hallazgo está resuelto solo porque no se reprodujo en una prueba puntual; para eso requieren confirmación posterior y evidencia comparada.

## 16. Limitaciones de la evaluación

- No se tuvo acceso al panel de XUI ni a la base de datos para verificar directamente la información del usuario `10200000` y de otros usuarios.
- No se destruyeron ni alteraron servicios de producción.
- Las pruebas de resistencia más agresivas, XUI en producción, o cargas mayores de 40 VU no se ejecutaron por riesgo y limitación operativa.
- La revisión no sustituyó un despliegue en staging con dominios completos ni una entrega real de clientes finales.

## 17. Hallazgos adicionales

- Rate limit sensible basado en memoria local, no distribuida.
- Pérdida de sesión de media tras descanso/reinicio del proceso.
- `ready` lento ante PostgreSQL caído.
- Proxy HLS con ticket público y TTL largo, sin revocación inversamente garantizada en todas las rutas.
- Riesgos de SSRF por redirecciones no validadas en media y playback.
- MFA administrativo no enforced en proceso real.
- Cobertura de pruebas y suites con margen de mejora.

## 18. Recomendaciones técnicas priorizadas

1. Externalizar tickets de reproducción a un store compartido con TTL corto y revocación por logout/expiración.
2. Implementar fail-safe para `maxDevices`/`maxConnections` cuando XUI omite valores.
3. Enforce real de MFA para ADMIN/OPERATOR durante login y flujo de enrollment.
4. Revalidar cada redirect y cada upstream final con allowlist en media y playback.
5. Ajustar y distribuir rate limiting para que no dependa de memoria local por instancia.
6. Mejorar la respuesta de `ready` ante caídas de PostgreSQL con errores rápidos y timeout controlado.
7. Aumentar la cobertura de pruebas en playback, dispositivos, presencia y FCM.
8. Medir de forma real la capacidad del proxy multimedia con XUI/streaming y no solo con pruebas de API JSON.

## 19. Veredicto final sobre el estado del backend

### Veredicto: APTO CONDICIONAL

El backend se encuentra en un estado funcional aceptable para escenarios pilotados y pruebas controladas, con evidencia de funcionamiento en los flujos críticos. Sin embargo, existen riesgos de seguridad y capacidad que impiden recomendarlo como producción robusta sin restricciones.

La decisión no es “todo correcto” ni “listo para producción”. La evidencia respaldada por la auditoría previa y la consolidación de hallazgos confirma que existen defectos de alta severidad pendientes y no corregidos, por lo que el backend está en un estado de preparación intermedia.

## 20. Anexos con evidencias relevantes

### Anexo A — Evidencias de flujo funcional

- Login, logout, refresh, catálogo y authorize documentados como `PASS` en la auditoría funcional.
- `GET /playback/media/:ticket` sin JWT devolvió HLS en la prueba previa (diseño público con ticket).
- Cuenta B demostró que el límite de dispositivos es `15/15` y que el QR approval falla con `403 DEVICE_LIMIT` al rebasarlo.

### Anexo B — Evidencias de resiliencia

- Sondeos de `ready` bajo caída de PostgreSQL local mostraron timeout prolongado.
- Reinstalación del backend recuperó disponibilidad, pero no la memoria del ticket.
- `ready` y `live` no son equivalentes ante caída de dependencias.

### Anexo C — Evidencias de seguridad y riesgo

- Tickets de media, allowlist de redirects, cupo nulo, MFA no enforced y rate limit por proceso forman parte del registro de hallazgos HIGH y MEDIUM de la auditoría previa.
- El riesgo real no es teórico: el backend funcionalmente acepta la ruta de reproducción y expone la media con tickets sin un control robusto de sesión y dispositivo.

## 21. Conclusión final

El backend COTAS tiene una base funcional sólida y demuestra flujo crítico operativo en laboratorio y pruebas controladas, pero no está preparado para producción comercial sin un plan de mitigación formal. Las observaciones críticas de la auditoría anterior siguen vigentes: no se corrigieron ni quedaron demostradas como resueltas. El nivel de riesgo actual corresponde a un entorno de piloto con seguimiento activo, no a una operación ya madura ni plenamente reforzada.

El contenido de este informe consolidado recomienda una decisión conservadora: despliegue o ampliación solo con aceptación formal de riesgos y plan de tratamiento de los hallazgos HIGH declarados.
