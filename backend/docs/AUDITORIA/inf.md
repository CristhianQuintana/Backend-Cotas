# INSTRUCCIÓN TÉCNICA – EVALUACIÓN Y AUDITORÍA FINAL DEL BACKEND
## COTAS PERÚ S.A.C.

### 1. Objetivo

Continuar y completar la evaluación técnica del backend de COTAS PERÚ S.A.C., considerando los resultados de la auditoría anterior y todas las pruebas que quedaron pendientes.

**En esta etapa está estrictamente prohibido modificar el backend.**

El trabajo se limita exclusivamente a:
- Inspeccionar el código y la arquitectura.
- Evaluar el comportamiento actual.
- Ejecutar pruebas funcionales, de seguridad, rendimiento y resiliencia.
- Investigar los hallazgos identificados.
- Recopilar evidencias.
- Determinar la capacidad y el estado real del backend.
- Elaborar un único informe técnico consolidado.

El propósito es obtener un diagnóstico objetivo que permita decidir si el backend está preparado para producción y cuáles son sus limitaciones actuales.

### 2. Restricciones obligatorias

Durante toda la evaluación:

1. No modificar código fuente.
2. No modificar configuraciones del backend, Nginx, Docker, PostgreSQL, Redis o XUI.
3. No ejecutar migraciones ni modificar registros de la base de datos.
4. No cambiar usuarios, contraseñas, suscripciones, límites de conexiones o dispositivos.
5. No modificar credenciales ni configuraciones de XUI/Astra.
6. No instalar, actualizar ni eliminar dependencias.
7. No reiniciar, detener ni desplegar servicios.
8. No alterar sesiones, tickets o dispositivos de usuarios reales.
9. No ejecutar pruebas destructivas o de estrés sobre producción.
10. No corregir observaciones durante la auditoría, aunque se identifiquen soluciones evidentes.

Si una prueba requiere modificar datos, configuraciones o infraestructura, debe realizarse únicamente en un entorno aislado y con autorización expresa. Si no existe ese entorno, registrar la prueba como pendiente de ejecución y explicar la limitación.

**Cualquier cambio accidental debe comunicarse inmediatamente y documentarse.**

### 3. Evaluación del usuario 10200000 (prioridad máxima)

Investigar específicamente el usuario `10200000`, sin modificar absolutamente nada de su configuración.

Se debe determinar:

**A. Información de la cuenta**
- Existencia del usuario en la base de datos.
- Correspondencia con su cuenta en XUI.
- Estado actual de la cuenta.
- Tipo de suscripción.
- Fecha de creación y vencimiento, si están disponibles.
- Límites configurados en COTAS y XUI.

**B. Dispositivos y conexiones**
- Cantidad de dispositivos registrados.
- Cantidad de dispositivos activos.
- Cantidad de sesiones vigentes.
- Conexiones simultáneas reales, si XUI permite consultarlas.
- Identificación de registros duplicados o inconsistentes.
- Diferencias entre los límites de COTAS y XUI.

**C. Comportamiento del backend**
- Qué devuelve el endpoint correspondiente al consultar los límites.
- Si `maxDevices` o `maxConnections` aparecen como `null`.
- Si el backend interpreta correctamente esos valores.
- Si el control de conexiones se aplica cuando XUI no devuelve un límite.
- Qué comportamiento presenta el login cuando se alcanza el límite.
- Qué sucede durante una aprobación QR.
- Qué sucede con el flujo `displace`.
- Si el usuario puede superar el límite configurado.

**D. Evidencia**

Registrar:
- Endpoint consultado.
- Fecha y hora de la prueba.
- Respuesta HTTP.
- Campos relevantes de la respuesta JSON.
- Valores observados en COTAS.
- Valores observados en XUI.
- Diferencias encontradas.
- Conclusión técnica.

No exponer contraseñas, tokens, credenciales ni datos sensibles en el informe.

Si no se dispone de permisos para consultar XUI o la base de datos, indicar expresamente qué información no pudo verificarse.

### 4. Evaluación de hallazgos HIGH de la auditoría anterior

Examinar nuevamente cada observación, determinar si continúa presente y recopilar evidencia.

| ID | Hallazgo | Evaluación requerida |
|---|---|---|
| H-01 | Tickets de reproducción en memoria | Evaluar almacenamiento, TTL, revocación, reinicios y compatibilidad multiinstancia. |
| H-02 | Control de dispositivos | Verificar límites, valores nulos, login, QR y desplazamiento de dispositivos. |
| H-03 | MFA administrativo | Comprobar si ADMIN y OPERATOR deben completar TOTP durante el login. |
| H-04 | SSRF en `/media/asset` | Evaluar validación de URL, redirecciones y destinos internos. |
| H-05 | SSRF en playback | Examinar allowlist y validación de cada redirección de XUI. |
| H-06 | Errores 503 multimedia | Investigar el comportamiento del proxy bajo concurrencia y las causas de los errores. |

Para cada hallazgo documentar:
- Estado actual.
- Evidencia de reproducción.
- Causa técnica probable o confirmada.
- Impacto funcional y de seguridad.
- Escenario de explotación o fallo.
- Severidad actual.
- Recomendación técnica, sin implementarla.

### 5. Evaluación de observaciones MEDIUM

Completar la revisión de:

1. Rate limiting y comportamiento ante solicitudes concurrentes.
2. Distribución del rate limiting entre instancias.
3. Disponibilidad de `/health/live` y `/health/ready`.
4. Comportamiento ante indisponibilidad de PostgreSQL.
5. Configuración CORS, incluidos PUT y PATCH.
6. Condiciones de carrera en el flujo QR.
7. Vulnerabilidades conocidas en dependencias npm y Prisma.
8. Cobertura de pruebas unitarias y E2E.
9. Consistencia de sesiones y dispositivos.
10. Gestión de errores y registros del sistema.

No modificar configuraciones ni ajustar límites durante estas pruebas.

### 6. Completar las pruebas pendientes

#### 6.1. Seguridad

Ejecutar una evaluación no destructiva de:

- Autenticación JWT.
- Autorización por roles.
- Separación de datos entre usuarios.
- IDOR con al menos dos cuentas de prueba.
- Acceso a recursos de otros usuarios.
- Exposición de información sensible.
- Protección de tickets de reproducción.
- SSRF y validación de redirecciones.
- Rate limiting.
- MFA administrativo.
- Gestión de secretos en logs.
- Vulnerabilidades de dependencias.

Herramientas de referencia:
- OWASP ZAP.
- Gitleaks.
- Trivy.
- npm audit.
- Análisis estático de código.

No ejecutar escaneos agresivos ni pruebas de explotación destructiva en producción.

#### 6.2. Pruebas funcionales

Verificar los siguientes módulos:

| Módulo | Casos que deben evaluarse |
|---|---|
| Autenticación | Login, logout, JWT inválido, expiración y autorización. |
| Usuarios | Perfil, suscripción y aislamiento de información. |
| Dispositivos | Registro, consulta, límites y sesiones. |
| QR | Generación, expiración, aprobación, rechazo y concurrencia. |
| Catálogo | Inicio, categorías y listado de contenido. |
| Canales | Consulta y disponibilidad de información. |
| Películas | Listado y autorización de reproducción. |
| Series | Listado y consulta de episodios. |
| Playback | Autorización, ticket, expiración y revocación. |
| Multimedia | HLS, MP4, redirecciones y HTTP Range. |
| XUI | Consultas, conectividad y respuestas. |
| Health | Estado del proceso y dependencias. |

Utilizar cuentas de prueba siempre que sea posible. No modificar cuentas reales.

#### 6.3. Rendimiento y capacidad

Realizar las pruebas únicamente en staging o en un entorno expresamente autorizado.

Evaluar progresivamente:
- 5 VU.
- 10 VU.
- 20 VU.
- 25 VU.
- 40 VU, si el entorno lo permite.

En multimedia, utilizar tickets y streams independientes.

Medir:
- Solicitudes por segundo.
- Latencia promedio.
- p50, p95 y p99.
- Porcentaje de errores.
- Respuestas 200, 403, 429, 500 y 503.
- CPU.
- Memoria.
- Conexiones PostgreSQL.
- Conexiones hacia XUI/Astra.
- Consumo de recursos de los contenedores.

Realizar también una prueba de larga duración y registrar cualquier degradación.

**No afirmar que determinada cantidad de VU equivale a la misma cantidad de televisores o usuarios reales.** Presentar los resultados como carga experimental y explicar sus limitaciones.

#### 6.4. Resiliencia

Evaluar el comportamiento ante:

- Reinicio controlado de una instancia en staging.
- Indisponibilidad simulada de PostgreSQL en staging.
- Indisponibilidad simulada de XUI en staging.
- Pérdida de conexión con Redis, si existe.
- Expiración de JWT.
- Expiración de tickets.
- Interrupción de una reproducción.
- Recuperación de servicios.

No detener servicios productivos ni provocar indisponibilidad real.

### 7. Comparación con la auditoría anterior

Utilizar los resultados de la auditoría anterior como línea base.

El informe debe comparar:

- Hallazgos anteriores frente al estado actual.
- Resultados funcionales anteriores frente a los actuales.
- Rendimiento anterior frente al actual.
- Cobertura anterior frente a la actual.
- Errores identificados anteriormente frente a los actuales.

Si una prueba anterior no puede repetirse en condiciones equivalentes, indicar que la comparación no es directamente válida.

No asumir que una observación está corregida simplemente porque no se reprodujo durante una prueba.

### 8. Entregable obligatorio: un solo informe

Entregar exclusivamente un informe técnico consolidado con el nombre:

`INFORME_FINAL_EVALUACION_BACKEND_COTAS.md`

No entregar informes independientes por módulo o tipo de prueba. Todos los resultados deben integrarse en este único archivo.

**Estructura obligatoria:**

1. Portada y datos de auditoría.
2. Resumen ejecutivo.
3. Alcance y metodología.
4. Arquitectura actual del backend.
5. Estado de infraestructura y dependencias.
6. Evaluación de los hallazgos HIGH.
7. Evaluación de los hallazgos MEDIUM.
8. Investigación detallada del usuario 10200000.
9. Resultados de pruebas funcionales.
10. Resultados de pruebas de seguridad.
11. Resultados de pruebas de rendimiento y capacidad.
12. Resultados de pruebas de resiliencia.
13. Estado de pruebas unitarias, integración y E2E.
14. Cobertura de código.
15. Comparación con la auditoría anterior.
16. Limitaciones de la evaluación.
17. Hallazgos adicionales.
18. Recomendaciones técnicas priorizadas.
19. Veredicto final sobre el estado del backend.
20. Anexos con evidencias y resultados relevantes.

### 9. Clasificación de resultados

Cada observación debe clasificarse como:

- CONFIRMADA: se reprodujo y existe evidencia.
- NO REPRODUCIDA: no se reprodujo, pero no se puede afirmar que esté resuelta.
- NO VERIFICABLE: faltan permisos, datos o infraestructura.
- SIN EVIDENCIA DE RIESGO: las pruebas ejecutadas no encontraron el comportamiento evaluado, indicando su alcance.
- FUERA DE ALCANCE: no pudo evaluarse por restricciones justificadas.

Cada prueba debe indicar:
- ID.
- Fecha y hora.
- Entorno.
- Cuenta o recurso de prueba.
- Procedimiento.
- Resultado esperado.
- Resultado obtenido.
- Evidencia.
- Conclusión.

### 10. Veredicto técnico final

El informe debe concluir con uno de estos estados:

**APTO PARA PRODUCCIÓN:** no se identifican riesgos críticos o altos pendientes y existe evidencia suficiente de estabilidad, seguridad, capacidad y resiliencia para el alcance evaluado.

**APTO CONDICIONAL:** existen limitaciones o riesgos pendientes que requieren aceptación formal y un plan de tratamiento antes de ampliar el uso.

**NO APTO PARA PRODUCCIÓN:** existen riesgos críticos o altos, fallos funcionales o limitaciones de capacidad que impiden recomendar su despliegue comercial.

El veredicto debe estar sustentado en resultados reales. No utilizar expresiones como «todo correcto», «sistema estable» o «listo para producción» sin evidencias que las respalden.

### 11. Condición de cierre

La evaluación finalizará únicamente cuando:

1. Se hayan revisado todos los hallazgos de la auditoría anterior.
2. Se hayan completado todas las pruebas pendientes que puedan ejecutarse sin modificar el sistema.
3. Se haya investigado específicamente al usuario 10200000.
4. Se hayan documentado las pruebas no ejecutables y sus limitaciones.
5. Se haya verificado el funcionamiento de los módulos críticos.
6. Se hayan recopilado evidencias suficientes.
7. Se haya entregado el archivo único `INFORME_FINAL_EVALUACION_BACKEND_COTAS.md`.

**RECORDATORIO FINAL: ESTA ETAPA ES EXCLUSIVAMENTE DE EVALUACIÓN. NO SE DEBE MODIFICAR, CORREGIR, ACTUALIZAR, CONFIGURAR NI DESPLEGAR NINGÚN COMPONENTE DEL BACKEND O DE SU INFRAESTRUCTURA.**

La prioridad es conocer con precisión el estado actual del backend de COTAS PERÚ S.A.C., identificar sus riesgos reales y determinar objetivamente si está preparado para producción.