INFORME DE AUDITORÍA TÉCNICA Y PLAN DE PRUEBAS QA
Backend de la plataforma IPTV — COTAS PERU S.A.C.
Destinatario:— Principal Backend QA Engineer & Software Auditor  
Sistema evaluado: Backend NestJS + PostgreSQL + integración XUI  
Base API: `https://api.cotasperu.com/api/v1`  
Fecha de elaboración: 10 de noviembre de 2026  
Tipo de trabajo: Auditoría integral, pruebas y documentación de hallazgos  
Restricción principal evalúa y documenta. No corrige ni modifica el sistema.
---
1. Objetivo
Ejecutar una auditoría técnica integral del backend de COTAS para determinar su estado real en términos de:
Calidad y mantenibilidad del código.
Correctitud funcional de los módulos y endpoints.
Seguridad de API, autenticación, autorización y reproducción multimedia.
Integridad y rendimiento de PostgreSQL.
Capacidad de atención de usuarios, solicitudes y reproducciones concurrentes.
Resiliencia ante fallos de dependencias e infraestructura.
Preparación técnica para operar en producción.
El resultado debe ser un conjunto de informes Markdown con evidencia verificable, pruebas ejecutadas, resultados, riesgos, limitaciones y recomendaciones dirigidas al equipo de desarrollo.no debe implementar las recomendaciones ni corregir los defectos encontrados. Su responsabilidad termina al documentar y entregar los hallazgos.
2. Contexto técnico conocido
La siguiente información constituye el contexto inicial de la auditoría. debe verificarla en el repositorio y en el entorno autorizado; no debe asumir que sigue vigente si encuentra evidencia distinta.
2.1 Arquitectura e infraestructura
Componente	Información conocida
Backend	NestJS
Base de datos	PostgreSQL
ORM	Verificar en el repositorio; se ha considerado Prisma
Contenedores	Docker
Sistema operativo del servidor	Ubuntu
Proxy inverso	Nginx
API pública	`https://api.cotasperu.com/api/v1`
Host del backend en LAN	`10.10.0.31`
Puerto interno del contenedor	`3000`
Puerto publicado en host	`3100`
Proxy inverso	Nginx en 80/443
Dominio API	`api.cotasperu.com`
Integración IPTV	XUI mediante `player\_api.php`
XUI en LAN	`http://10.10.0.100:80`
Health check conocido	`/api/v1/health/live`
Integración de streaming	Backend como proxy de reproducción
No modificar DNS, NAT, firewall, Nginx, Docker, XUI ni configuración de infraestructura durante la auditoría.
2.2 Arquitectura de reproducción conocida
El flujo esperado es:
El cliente se autentica contra la API de COTAS mediante HTTPS.
El backend valida la identidad, permisos, estado de cuenta y restricciones aplicables.
El backend consulta XUI desde la red interna mediante `player\_api.php`.
El backend obtiene los datos necesarios para autorizar la reproducción.
El cliente solicita una autorización de reproducción a `POST /playback/authorizations`.
El backend genera una autorización/ticket de reproducción.
El cliente recibe una URL de la forma:
`https://api.cotasperu.com/api/v1/playback/media/{ticket}`
El backend actúa como proxy y gestiona la comunicación con XUI/Astra.
El reproductor consume el contenido sin conectarse directamente a XUI ni recibir credenciales de XUI.
El auditor debe comprobar el flujo real y documentar cualquier diferencia.
Consideraciones conocidas sobre XUI y streaming
XUI se consulta desde la LAN mediante `http://10.10.0.100` y `/player\_api.php`.
Se observó que XUI puede responder con una redirección HTTP 302 hacia rutas `/auth/...` y posteriormente hacia contenido HLS bajo `/hls/...`.
Para canales en vivo se ha observado HLS con segmentos MPEG-TS.
Para VOD y series se ha observado entrega progresiva MP4; si la extensión es `m3u8`, debe tratarse como HLS.
Se reportó que XUI puede anunciar `192.168.98.91:80` o una dirección externa equivalente en ciertas respuestas, mientras que el acceso a esa dirección desde el backend presentó problemas. Verificar la dirección real observada en el entorno; no sustituirla por inferencia.
No se debe publicar el panel administrativo de XUI ni Astra como parte de esta auditoría.
Las credenciales XUI no deben aparecer en respuestas al cliente, logs, trazas ni informes públicos.
Se debe verificar el manejo de `HTTP Range`, `Content-Type`, redirecciones, manifiestos HLS, segmentos, cancelación de solicitudes y concurrencia.
Se ha observado que las URLs de XUI pueden contener usuario y contraseña de la línea y no necesariamente son temporales de un solo uso. Comprobar cómo el backend protege el acceso mediante JWT, ticket opaco, expiración, revocación y validación de permisos.
3. Cuentas de prueba entregadas
Se proporcionan dos líneas de prueba para validar el comportamiento de las restricciones de conexiones de XUI y del backend.
Estas credenciales son sensibles. Utilizarlas únicamente en el entorno autorizado de pruebas. No copiarlas a repositorios, commits, tickets públicos, logs, capturas compartidas ni documentación de producción. El presente archivo debe mantenerse en un espacio privado de trabajo y no debe publicarse. debe leer las credenciales desde variables de entorno o un mecanismo seguro, no incrustarlas en scripts ni comandos que queden registrados en el historial.
3.1 Cuenta A — Prueba de alta capacidad configurada
Campo	Valor
Usuario	`10200000`
Contraseña	`10200000`
Owner	`cotaservice`
Máximo de conexiones configurado	100 000
Estado de expiración	En la captura, la opción “Never Expire” aparenta estar activada
Fecha mostrada en el formulario	`2026-11-10 15:48`
Propósito: utilizar esta cuenta para pruebas controladas de concurrencia, capacidad y comportamiento de reproducción, sin que el límite de conexiones configurado en la línea sea el primer límite artificial del experimento.
Importante: 100 000 es el límite configurado en el formulario de la cuenta; no representa una capacidad demostrada del backend, XUI, Astra, red, servidor ni base de datos. No ejecutar 100 000 conexiones de golpe. La carga se incrementará por etapas y con autorización expresa.
Verificación previa obligatoria: confirmar en XUI el estado real de “Never Expire”, la fecha efectiva, el límite aplicado y si el contador de conexiones corresponde a sesiones, streams, conexiones HTTP u otra unidad.
3.2 Cuenta B — Prueba de límite reducido
Campo	Valor
Usuario	`userprueba`
Contraseña	`prueba123`
Owner	`gestion`
Máximo de conexiones configurado	15
Estado de expiración	“Never Expire” aparenta estar desactivado
Fecha de expiración mostrada	`2026-12-10 20:50`
Propósito: comprobar que el backend y XUI respetan el límite de conexiones de una línea con capacidad reducida. Esta cuenta permite evaluar el comportamiento al aproximarse y superar el máximo permitido.
Verificación previa obligatoria: confirmar que la cuenta sigue activa, que la fecha de expiración corresponde a la zona horaria configurada en XUI y que el límite de 15 se aplica efectivamente.
3.3 Reglas para el uso de las cuentas
No modificar usuarios, contraseñas, owner, expiración ni límites de conexiones.
No activar o desactivar “Never Expire”.
No cambiar bouquets, paquetes, restricciones ni permisos.
No utilizar estas cuentas para consumo real o pruebas fuera del alcance autorizado.
No ejecutar pruebas destructivas ni generar carga que afecte a clientes reales.
No compartir las credenciales en los informes finales de circulación general. En los informes, referirse a ellas como Cuenta A (100 000) y Cuenta B (15).
Si se necesita guardar credenciales en el entorno de ejecución, usar variables de entorno o un almacén de secretos local excluido del control de versiones.
Si las credenciales aparecen accidentalmente en logs, capturas o reportes, registrar el incidente y solicitar su rotación.
Ejemplo de variables locales —no guardar valores reales en el repositorio—:
```bash
export IPTV\_TEST\_USER\_HIGH="..."
export IPTV\_TEST\_PASS\_HIGH="..."
export IPTV\_TEST\_USER\_LIMITED="..."
export IPTV\_TEST\_PASS\_LIMITED="..."
```
4. Alcance de la auditoría
4.1 Inventario y arquitectura
Revisar:
Estructura completa del backend.
Módulos NestJS, controladores, servicios, providers, guards, interceptors, pipes, filters y middlewares.
Inyección de dependencias y límites entre módulos.
DTO, validaciones, serialización y manejo de errores.
Configuración por entorno y carga de variables.
Integración con PostgreSQL y ORM.
Integración con XUI y servicios externos.
Gestión de tareas asíncronas, colas y procesos en segundo plano, si existen.
Dockerfile, Docker Compose y configuración de ejecución.
Health checks, logs, métricas y observabilidad.
Nginx y configuración de proxy, solo lectura.
Endpoints y contratos de API.
Pruebas existentes y su cobertura real.
Documentar arquitectura observada, dependencias, puntos de entrada, límites de confianza y flujos de datos.
4.2 Auditoría estática y calidad del código
Buscar y documentar:
Errores lógicos y defectos potenciales.
Código duplicado y complejidad innecesaria.
Acoplamiento elevado y responsabilidades mezcladas.
Incumplimientos relevantes de SOLID y Clean Code.
Validaciones incompletas o inconsistentes.
Manejo incorrecto de excepciones.
Promesas no esperadas, tareas asíncronas sin control y errores no capturados.
Condiciones de carrera y problemas de concurrencia.
Posibles fugas de memoria o recursos.
Uso incorrecto de streams, buffers y conexiones.
Exposición de datos sensibles.
Configuraciones inseguras.
Ausencia de pruebas en componentes críticos.
No modificar el código para mejorar métricas o eliminar observaciones.
4.3 Base de datos
Evaluar:
Modelo de datos, tablas, relaciones y restricciones.
Claves primarias y foráneas.
Índices y consultas frecuentes.
Integridad referencial.
Transacciones y aislamiento.
Riesgos de condiciones de carrera.
Consultas N+1.
Consultas costosas y escaneos completos.
Pool y límites de conexiones.
Bloqueos, deadlocks y tiempos de espera.
Estrategia de migraciones, si existe.
Manejo de errores y reconexión.
Consistencia entre datos locales y datos obtenidos desde XUI.
No ejecutar operaciones que alteren datos reales. Para pruebas que necesiten escrituras, utilizar únicamente registros de prueba expresamente autorizados y limpiarlos solo si existe autorización previa y un procedimiento seguro.
4.4 Pruebas funcionales
Evaluar los módulos que existan realmente en el repositorio:
Autenticación y cierre de sesión.
Usuarios, perfiles y roles.
Autorización y permisos.
Sesiones y dispositivos.
Catálogo.
Categorías.
Canales en vivo.
Películas.
Series y episodios.
Búsqueda y filtros.
Favoritos, si está implementado.
Autorizaciones de reproducción.
Tickets de reproducción.
Proxy multimedia.
Integración con XUI.
Manejo de cuentas expiradas o deshabilitadas.
Manejo de límites de conexiones.
No marcar como fallida una funcionalidad que no esté implementada: clasificarla como “no implementada” o “fuera de alcance”, con evidencia.
4.5 Seguridad
Auditar, como mínimo:
Autenticación JWT: firma, algoritmo, expiración, claims y validación.
Autorización por roles y permisos.
Acceso horizontal y vertical indebido (BOLA/IDOR).
Escalamiento de privilegios.
Enumeración de usuarios.
Fuerza bruta y abuso de endpoints.
Rate limiting y throttling.
Validación y sanitización de entradas.
Inyección SQL y otras inyecciones.
CORS y configuración de cabeceras.
Exposición de secretos y datos personales.
Logs con credenciales, tokens o URLs sensibles.
Gestión de sesiones, revocación y expiración.
Protección de tickets de reproducción.
Reutilización de tickets y acceso no autorizado a streams.
Redirecciones HTTP y validación de destinos.
SSRF y posibilidad de que parámetros controlados por el cliente fuercen solicitudes internas.
Validación de dominios/IP permitidos para XUI.
Protección ante abuso de proxy multimedia.
Dependencias vulnerables.
Seguridad de imágenes y contenedores Docker.
Configuración de producción y manejo de errores.
Referencias orientativas:
OWASP API Security Top 10.
OWASP ASVS.
OWASP Top 10.
NIST Secure Software Development Framework (SSDF).
Buenas prácticas de seguridad de NestJS, Node.js y PostgreSQL.
Herramientas posibles, solo si están disponibles y autorizadas: Semgrep, Gitleaks, Trivy, OWASP ZAP, SonarQube y npm audit. Registrar versión, configuración y alcance de cada herramienta.
4.6 Rendimiento y capacidad
Usar Grafana k6 u otra herramienta aprobada. Las pruebas de carga deben ejecutarse exclusivamente en staging o en un entorno de pruebas aislado, con autorización y límites definidos.
Separar claramente:
Carga de API JSON: autenticación, catálogo, categorías, sesiones y autorizaciones.
Carga de reproducción multimedia: autorizaciones, solicitudes al proxy, manifiestos, segmentos HLS y VOD.
Carga combinada: flujo realista de usuario con API y reproducción.
No utilizar únicamente un endpoint de health check para afirmar capacidad del sistema.
Escalones de carga propuestos
Etapa	Usuarios virtuales (VU)	Propósito
Smoke	1–5	Confirmar funcionamiento básico
Carga inicial	50	Línea base
Carga 2	100	Comportamiento inicial de concurrencia
Carga 3	250	Incremento progresivo
Carga 4	500	Evaluación intermedia
Carga 5	1 000	Escenario de referencia solicitado
Carga 6	2 500	Identificar degradación
Carga 7	5 000	Evaluar saturación progresiva
Carga 8	10 000	Solo si las etapas previas son estables y existe autorización
Las etapas superiores no son obligatorias. Detener el incremento cuando se alcance un umbral de seguridad, una degradación grave o un límite de infraestructura.
No confundir:
Usuarios registrados.
Usuarios autenticados.
Usuarios virtuales (VU) del generador.
Solicitudes concurrentes.
Sesiones abiertas.
Reproducciones simultáneas.
Conexiones HTTP/TCP.
Segmentos HLS descargados.
Un VU no equivale necesariamente a una conexión ni a un stream simultáneo.
Escenarios de carga
Inicio de sesión concurrente.
Consulta de perfil y sesión.
Consulta de catálogo y categorías.
Búsqueda.
Consulta de canales.
Consulta de películas y series.
Solicitud de autorización de reproducción.
Reproducción de canal en vivo.
Reproducción VOD.
Consumo de manifiestos HLS y segmentos.
Renovación, expiración y revocación de tickets.
Cierre de sesión.
Solicitudes repetidas y patrones de navegación realistas.
Métricas obligatorias
RPS (requests per second).
Throughput.
Latencia media.
p50, p90, p95 y p99.
Tasa de errores HTTP y errores funcionales.
Timeouts.
CPU.
RAM.
Uso de red y ancho de banda.
Conexiones y pool de PostgreSQL.
Consultas lentas.
Uso de CPU y memoria de contenedores.
Conexiones simultáneas y streams activos, cuando puedan medirse.
Tiempo de respuesta de XUI.
Tiempo de respuesta del proxy multimedia.
Punto de saturación.
Tiempo de recuperación tras reducir o detener la carga.
Tipos de prueba
Smoke test.
Load test.
Stress test.
Spike test.
Soak/endurance test.
Breakpoint test, únicamente si es seguro y autorizado.
No inventar umbrales de aceptación. Si el proyecto no define SLO/SLI, registrar la ausencia y proponer valores para aprobación, diferenciándolos de los resultados medidos.
4.7 Pruebas específicas de conexiones IPTV
Este apartado es prioritario por las dos cuentas de prueba entregadas.
Cuenta A: límite configurado de 100 000
Objetivo: evaluar el comportamiento del sistema con una línea cuyo límite configurado no debería restringir las primeras etapas de carga.
Procedimiento:
Verificar la cuenta en XUI sin modificarla.
Confirmar que la cuenta está activa y que el límite aplicado es 100 000.
Verificar el estado de expiración.
Registrar conexiones iniciales y streams activos.
Ejecutar pruebas de baja concurrencia.
Incrementar gradualmente la concurrencia según las etapas aprobadas.
Medir por separado API, autorizaciones y reproducción multimedia.
Identificar el primer componente que se satura.
Detener la prueba ante errores generalizados, degradación grave o impacto en servicios.
Documentar el máximo nivel estable realmente observado.
No intentar alcanzar 100 000 conexiones solo porque la cuenta tenga ese límite. El objetivo es medir la capacidad real y localizar el cuello de botella de forma controlada.
Cuenta B: límite configurado de 15
Objetivo: comprobar el cumplimiento del límite de conexiones de una línea restringida.
Procedimiento:
Verificar que la cuenta está activa y que el límite es 15.
Confirmar la expiración y el estado de “Never Expire”.
Iniciar una reproducción y verificar que funciona.
Incrementar sesiones/reproducciones de forma controlada: 1, 5, 10, 14 y 15.
Intentar una conexión adicional solo con autorización y en staging.
Registrar si XUI rechaza la conexión adicional, reemplaza una sesión anterior o permite exceder el límite.
Verificar que el backend interpreta correctamente el resultado.
Comprobar que el cliente recibe un error controlado y que no se filtran detalles internos.
Cerrar las sesiones de prueba y verificar liberación de conexiones.
Repetir solo si el entorno y la cuenta continúan en condiciones seguras.
No asumir que “15 conexiones” significa 15 usuarios. Determinar qué unidad controla XUI y documentarla.
Comparación de ambas cuentas
El informe debe comparar:
Conexiones permitidas configuradas.
Conexiones efectivamente aceptadas.
Conexiones rechazadas.
Streams simultáneos.
Comportamiento al superar el límite.
Tiempo de liberación de conexiones.
Estado de sesiones después de cerrar el reproductor.
Diferencias entre la respuesta de XUI y la respuesta del backend.
Posibles inconsistencias entre el contador de XUI y el estado registrado por COTAS.
4.8 Resiliencia
Evaluar de manera controlada:
Pérdida de conectividad con PostgreSQL.
Indisponibilidad de XUI.
Latencia elevada de XUI.
Timeouts de servicios externos.
Reinicio controlado del backend en staging.
Agotamiento controlado del pool de conexiones.
Respuestas HTTP 4xx/5xx de XUI.
Redirecciones inesperadas.
Interrupción de solicitudes multimedia.
Cancelación de reproducción por el cliente.
Fallos parciales de dependencias.
Comprobar:
Timeouts configurados.
Reintentos y sus límites.
Circuit breakers, si existen.
Liberación de conexiones y recursos.
Recuperación de conexiones.
Integridad de datos.
Comportamiento degradado.
Mensajes de error.
Ausencia de exposición de información sensible.
No provocar fallos en producción ni interrumpir streams de clientes reales.
5. Metodología de ejecución
Ejecutar las fases en este orden. Cada fase debe terminar con un registro documental antes de avanzar.
Fase 0 — Reconocimiento e inventario
Identificar estructura, módulos y componentes.
Levantar endpoints y contratos.
Identificar modelo de datos.
Identificar integraciones externas.
Identificar pruebas existentes.
Verificar el entorno disponible.
Determinar qué pruebas son seguras y cuáles requieren autorización.
Salida: arquitectura, inventario de dependencias y lista de bloqueos.
Fase 1 — Auditoría estática
Analizar código fuente y configuración en modo lectura.
Revisar dependencias y vulnerabilidades.
Ejecutar herramientas estáticas si están disponibles.
Revisar calidad, complejidad, errores y patrones de riesgo.
Salida: hallazgos de código y calidad.
Fase 2 — Pruebas funcionales
Diseñar casos de prueba a partir de los endpoints y requisitos reales.
Ejecutar pruebas en entorno autorizado.
Registrar resultados y evidencias.
Identificar funcionalidades no implementadas o no verificables.
Salida: plan y resultados funcionales.
Fase 3 — Seguridad
Revisar autenticación, autorización y exposición de datos.
Ejecutar pruebas no destructivas.
Validar límites de acceso, tickets y proxy multimedia.
Evaluar dependencias y configuración.
Salida: evaluación de seguridad y registro de vulnerabilidades.
Fase 4 — Rendimiento
Confirmar staging, datos de prueba y autorización.
Establecer línea base.
Ejecutar carga gradual.
Probar por separado API y streaming.
Evaluar las cuentas A y B.
Detener pruebas ante criterios de seguridad.
Salida: resultados de estrés e informe de capacidad.
Fase 5 — Resiliencia
Ejecutar fallos controlados y aislados.
Medir detección, degradación y recuperación.
Verificar liberación de recursos.
Salida: informe de resiliencia.
Fase 6 — Regresión
Ejecutar la suite existente antes y después de las pruebas, si corresponde.
Comprobar que el entorno de pruebas sigue operativo.
No modificar pruebas ni código.
Documentar pruebas que no puedan ejecutarse.
Salida: resultados de regresión.
Fase 7 — Consolidación y cierre
Eliminar duplicados documentales, no archivos del proyecto.
Consolidar severidades y evidencias.
Identificar riesgos críticos y bloqueos.
Establecer estado de preparación para producción.
Entregar el informe final al equipo de desarrollo.
No existe una fase de corrección dentro de esta asignación.
6. Estructura documental obligatoria
Crear o actualizar exclusivamente los archivos Markdown de esta estructura. No cambiar nombres, no agregar carpetas y no crear documentos fuera de `backend/aseguramiento-calidad/`.
```text
backend/
└── aseguramiento-calidad/
    ├── 00-inventario-proyecto/
    │   ├── arquitectura.md
    │   └── dependencias.md
    │
    ├── 01-auditoria-codigo/
    │   ├── hallazgos.md
    │   └── calidad-codigo.md
    │
    ├── 02-pruebas-funcionales/
    │   ├── plan-pruebas.md
    │   └── resultados-pruebas.md
    │
    ├── 03-seguridad/
    │   ├── evaluacion-seguridad.md
    │   └── vulnerabilidades.md
    │
    ├── 04-rendimiento/
    │   ├── plan-pruebas-carga.md
    │   ├── resultados-pruebas-estres.md
    │   └── informe-capacidad.md
    │
    ├── 05-resiliencia/
    │   └── informe-resiliencia.md
    │
    ├── 06-pruebas-regresion/
    │   └── resultados-regresion.md
    │
    └── 07-informe-final/
        ├── resumen-ejecutivo.md
        └── auditoria-tecnica.md
```
6.1 Contenido mínimo por documento
`00-inventario-proyecto/arquitectura.md`
Descripción de arquitectura real.
Diagrama Mermaid de componentes y dependencias, si la información lo permite.
Módulos NestJS y responsabilidades.
Endpoints y métodos HTTP.
Flujo de autenticación.
Flujo de catálogo.
Flujo de autorización y reproducción.
Integración con XUI.
Dependencias internas y externas.
Límites de confianza y puntos de entrada.
Componentes no verificables.
`00-inventario-proyecto/dependencias.md`
Runtime y versiones.
Dependencias directas y transitivas relevantes.
Versiones obsoletas o sin soporte, si se confirma.
Vulnerabilidades reportadas por herramientas.
Licencias cuando la herramienta lo permita.
Riesgos de mantenimiento.
Comandos y herramientas ejecutadas.
Limitaciones del análisis.
`01-auditoria-codigo/hallazgos.md`
Registro consolidado de defectos, riesgos y observaciones de código con evidencia.
`01-auditoria-codigo/calidad-codigo.md`
Métricas disponibles.
Complejidad.
Duplicación.
Mantenibilidad.
Convenciones.
Diseño modular.
Principios SOLID y Clean Code.
Cobertura de pruebas existente.
Observaciones y recomendaciones.
`02-pruebas-funcionales/plan-pruebas.md`
Alcance.
Requisitos y endpoints.
Casos de prueba.
Datos de prueba.
Precondiciones.
Pasos.
Resultado esperado.
Prioridad.
Entorno requerido.
`02-pruebas-funcionales/resultados-pruebas.md`
Identificador de caso.
Fecha y entorno.
Resultado: PASS, FAIL, BLOCKED o NOT RUN.
Resultado real.
Evidencia.
Defecto asociado.
Observaciones.
`03-seguridad/evaluacion-seguridad.md`
Alcance y metodología.
Controles revisados.
Resultados por dominio de seguridad.
Herramientas y versiones.
Riesgos y limitaciones.
Evaluación general.
`03-seguridad/vulnerabilidades.md`
Vulnerabilidades confirmadas.
Riesgos potenciales.
Severidad.
Evidencia y reproducción.
Impacto.
Recomendación.
Estado de validación.
`04-rendimiento/plan-pruebas-carga.md`
Objetivos.
Entorno.
Perfil de usuario.
Escenarios.
Etapas de VU.
Duración y ramp-up/ramp-down.
Datos de prueba.
Métricas.
Umbrales aprobados.
Criterios de parada.
Restricciones y autorización.
`04-rendimiento/resultados-pruebas-estres.md`
Fecha y entorno.
Versión de backend.
Configuración del generador.
Escenario ejecutado.
VU objetivo y VU alcanzados.
Duración.
RPS y throughput.
Latencias media, p50, p90, p95 y p99.
Errores y timeouts.
CPU, RAM, red y conexiones de BD.
Comportamiento de XUI y streaming.
Punto de degradación o saturación.
Evidencia y limitaciones.
`04-rendimiento/informe-capacidad.md`
Capacidad estable medida.
Capacidad máxima observada, si se pudo determinar.
Cuellos de botella.
Diferencias entre API y streaming.
Diferencias entre Cuenta A y Cuenta B.
Límites de infraestructura.
Proyección: solo si se fundamenta y se etiqueta como estimación.
Recomendaciones técnicas.
`05-resiliencia/informe-resiliencia.md`
Fallo inducido.
Componente afectado.
Procedimiento.
Resultado esperado y real.
Tiempo de detección y recuperación.
Impacto.
Recursos liberados.
Riesgos y recomendaciones.
`06-pruebas-regresion/resultados-regresion.md`
Suite ejecutada.
Casos.
Resultado.
Fallos preexistentes y nuevos, si pueden diferenciarse.
Pruebas bloqueadas o no ejecutadas.
Evidencias.
`07-informe-final/resumen-ejecutivo.md`
Estado general.
Hallazgos críticos y altos.
Principales riesgos.
Capacidad medida.
Seguridad.
Calidad.
Resiliencia.
Limitaciones.
Recomendación de preparación para producción.
`07-informe-final/auditoria-tecnica.md`
Alcance completo.
Arquitectura auditada.
Metodología.
Herramientas.
Resultados por fase.
Hallazgos consolidados.
Evidencias.
Riesgos residuales.
Pruebas no ejecutadas y motivos.
Recomendaciones priorizadas.
Conclusión técnica.
7. Clasificación de resultados y hallazgos
7.1 Severidad
Severidad	Criterio
CRITICAL	Compromiso grave de seguridad, exposición masiva de datos, toma de control o caída crítica reproducible
HIGH	Vulnerabilidad o defecto de alto impacto que compromete una función importante o permite abuso significativo
MEDIUM	Defecto con impacto moderado, alcance limitado o condición de explotación más restrictiva
LOW	Defecto menor, impacto reducido o problema de calidad sin afectación crítica
INFORMATIONAL	Observación, oportunidad de mejora o información relevante sin defecto confirmado
7.2 Clasificación de certeza
Cada registro debe identificarse además como uno de los siguientes:
CONFIRMED DEFECT: defecto reproducido y respaldado por evidencia.
CONFIRMED VULNERABILITY: vulnerabilidad validada mediante una prueba segura.
POTENTIAL RISK: riesgo técnicamente plausible aún no confirmado.
QUALITY OBSERVATION: observación de diseño, mantenibilidad o calidad.
NEEDS FURTHER TESTING: requiere entorno, permisos, datos o pruebas adicionales.
No presentar un riesgo potencial como vulnerabilidad confirmada.
7.3 Campos obligatorios de cada hallazgo
```markdown
### \[ID] Título del hallazgo

- Fecha:
- Plataforma/módulo:
- Archivo, función o endpoint:
- Clasificación:
- Severidad:
- Estado:
- Entorno:
- Evidencia:

\*\*Descripción:\*\*

\*\*Precondiciones:\*\*

\*\*Pasos de reproducción:\*\*

\*\*Resultado esperado:\*\*

\*\*Resultado obtenido:\*\*

\*\*Impacto:\*\*

\*\*Causa raíz:\*\* (solo si está confirmada)

\*\*Recomendación para desarrollo:\*\*

\*\*Limitaciones o información pendiente:\*\*
```
Usar identificadores únicos y consecutivos por dominio, por ejemplo `CODE-001`, `FUNC-001`, `SEC-001`, `PERF-001` y `RES-001`.
8. Criterios de calidad y evaluación
Evaluar, sin modificar el proyecto:
Bugs confirmados.
Vulnerabilidades confirmadas.
Cobertura de pruebas existente.
Cobertura de rutas críticas.
Correctitud de validaciones.
Manejo de errores.
Integridad de datos.
Rendimiento por endpoint.
Rendimiento de reproducción.
Comportamiento bajo concurrencia.
Recuperación ante fallos.
Observabilidad.
La cobertura de pruebas del 80 % puede utilizarse como referencia de evaluación, pero no como autorización para crear o modificar pruebas. Reportar cobertura real por módulo y por tipo de prueba, si puede medirse.
No declarar “apto para producción” únicamente por ausencia de errores durante una prueba breve. La conclusión debe considerar cobertura, evidencia, limitaciones y riesgos pendientes.
9. Restricciones estrictas para el dev
9.1 Prohibiciones
NO debe:
Corregir bugs.
Refactorizar código.
Cambiar controladores, servicios, módulos, DTO, guards o providers.
Modificar lógica de negocio.
Crear, modificar o eliminar pruebas del proyecto.
Cambiar esquemas, tablas, índices o migraciones.
Ejecutar escrituras no autorizadas en bases de datos.
Actualizar, instalar, eliminar o reemplazar dependencias.
Cambiar `package.json` o lockfiles.
Modificar `.env`, secretos o configuraciones.
Modificar Dockerfile, Docker Compose o imágenes.
Modificar Nginx, DNS, NAT, firewall o reglas de red.
Cambiar configuración de XUI/Astra.
Cambiar cuentas o límites de las dos líneas de prueba.
Eliminar archivos, datos, logs o contenedores.
Reiniciar servicios de producción.
Ejecutar pruebas de estrés en producción.
Realizar commits, push, merge o despliegues.
Crear carpetas o archivos fuera de `backend/aseguramiento-calidad/`.
9.2 Única escritura permitida
La única escritura autorizada es crear o actualizar los archivos `.md` listados en la sección 6, dentro de:
`backend/aseguramiento-calidad/`
Si la estructura ya existe, conservar su contenido útil y actualizarlo sin borrar evidencia previa. No crear archivos auxiliares, scripts, reportes HTML, CSV, JSON ni configuraciones en otras rutas.
9.3 Seguridad operativa
No ejecutar pruebas destructivas.
No afectar clientes, streams ni servicios reales.
No bloquear cuentas reales.
No agotar deliberadamente recursos compartidos.
No enviar tráfico masivo a producción.
No revelar credenciales en logs o informes generales.
No probar vulnerabilidades contra terceros.
Detener cualquier prueba que pueda afectar la disponibilidad o integridad.
Solicitar autorización cuando falten permisos, entorno aislado, datos o configuración.
Ante un hallazgo CRITICAL, detener la prueba relacionada y reportar inmediatamente.
10. Reglas de evidencia y trazabilidad
Todo resultado debe ser reproducible y trazable.
Para cada prueba registrar:
Fecha y hora con zona horaria.
Entorno y URL/base URL utilizada.
Versión o commit del backend auditado, si está disponible.
Herramienta y versión.
Configuración relevante.
Datos de prueba utilizados, sin secretos.
Comando o procedimiento ejecutado, ocultando tokens y contraseñas.
Resultado esperado.
Resultado observado.
Logs, métricas o captura que respalden el resultado.
Limitaciones.
No incluir tokens JWT, contraseñas, claves API, cookies, URLs con credenciales ni datos personales en los documentos. Enmascarar secretos, por ejemplo `u\*\*\*a`.
Regla de veracidad:
`PASS`: prueba ejecutada y superada.
`FAIL`: prueba ejecutada y fallida.
`BLOCKED`: no pudo ejecutarse por una dependencia o autorización faltante.
`NOT RUN`: no se ejecutó.
`NOT APPLICABLE`: no aplica, con justificación.
No registrar una prueba como ejecutada si solo se diseñó. No inventar métricas, evidencias, resultados, capacidades ni causas raíz.
11. Condiciones de parada
Interrumpir la prueba en curso y documentar el motivo si ocurre cualquiera de estas condiciones:
Impacto observable en clientes o streams reales.
Errores generalizados o caída de un servicio compartido.
CPU, memoria, disco, red o conexiones de BD alcanzan límites peligrosos definidos por el responsable de infraestructura.
Aumento sostenido de timeouts o errores.
Riesgo de pérdida o corrupción de datos.
Comportamiento no previsto que pueda afectar XUI/Astra.
Se detecta una vulnerabilidad crítica cuya explotación adicional no sea necesaria para demostrar el riesgo.
El entorno no puede distinguirse con certeza de producción.
Si no existen umbrales operativos definidos, solicitarlos antes de iniciar pruebas de carga o estrés.
12. Entregables y cierre
Al terminar, debe entregar:
Los documentos Markdown completos dentro de la estructura indicada.
Resumen de fases ejecutadas y pendientes.
Hallazgos priorizados por severidad.
Evidencias suficientes para que desarrollo pueda reproducir los defectos.
Resultados medidos de carga y capacidad, solo si las pruebas se ejecutaron.
Riesgos que impiden considerar el backend listo para producción.
Lista de permisos, accesos o condiciones que impidieron completar alguna prueba.
El informe final debe responder explícitamente:
¿El backend funciona correctamente en los flujos críticos?
¿Qué defectos confirmados existen?
¿Qué vulnerabilidades fueron confirmadas?
¿Qué riesgos de seguridad siguen abiertos?
¿Qué capacidad estable se midió para API?
¿Qué capacidad estable se midió para reproducción?
¿Qué ocurre con la Cuenta A configurada con 100 000 conexiones?
¿Qué ocurre con la Cuenta B configurada con 15 conexiones?
¿Se respetan los límites de conexiones de XUI?
¿Dónde se encuentran los cuellos de botella?
¿Cómo responde el sistema ante fallos de PostgreSQL y XUI?
¿Qué pruebas no pudieron ejecutarse y por qué?
¿Cuál es el nivel de preparación para producción y qué evidencia lo respalda?
La auditoría se considera terminada cuando todos los documentos estén actualizados, los hallazgos estén trazados y el informe final indique claramente qué se verificó, qué falló, qué quedó pendiente y qué no pudo comprobarse.
---
13. Instrucción final para el dev.
Actúa como Principal Backend QA Engineer & Software Auditor de COTAS PERU S.A.C. Realiza una auditoría integral, objetiva y basada en evidencia del backend descrito en este documento.
Tu responsabilidad es inspeccionar, probar, medir y documentar. No eres el desarrollador encargado de corregir los problemas. No realices cambios funcionales ni técnicos. No intentes “mejorar” el sistema durante la auditoría.
Utiliza las dos cuentas de prueba exclusivamente para validar límites de conexiones y reproducción, respetando todas las restricciones de seguridad. La Cuenta A tiene un máximo configurado de 100 000 conexiones y la Cuenta B un máximo configurado de 15; esos valores son límites configurados, no capacidades demostradas.
Trabaja por fases, registra cada resultado y crea/actualiza únicamente los archivos Markdown de `backend/aseguramiento-calidad/`. Si una prueba no es segura, no está autorizada o requiere infraestructura adicional, no la ejecutes: documenta el bloqueo y solicita lo necesario.
Entrega un diagnóstico técnico verificable para que el equipo de desarrollo implemente posteriormente las correcciones. No corrijas absolutamente nada.