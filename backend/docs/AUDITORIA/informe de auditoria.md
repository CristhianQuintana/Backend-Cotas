INFORME DE AUDITORÃA TÃ‰CNICA Y PLAN DE PRUEBAS QA
Backend de la plataforma IPTV â€” COTAS PERU S.A.C.
Destinatario:â€” Principal Backend QA Engineer & Software Auditor  
Sistema evaluado: Backend NestJS + PostgreSQL + integraciÃ³n XUI  
Base API: `https://api.cotasperu.com/api/v1`  
Fecha de elaboraciÃ³n: 10 de noviembre de 2026  
Tipo de trabajo: AuditorÃ­a integral, pruebas y documentaciÃ³n de hallazgos  
RestricciÃ³n principal evalÃºa y documenta. No corrige ni modifica el sistema.
---
1. Objetivo
Ejecutar una auditorÃ­a tÃ©cnica integral del backend de COTAS para determinar su estado real en tÃ©rminos de:
Calidad y mantenibilidad del cÃ³digo.
Correctitud funcional de los mÃ³dulos y endpoints.
Seguridad de API, autenticaciÃ³n, autorizaciÃ³n y reproducciÃ³n multimedia.
Integridad y rendimiento de PostgreSQL.
Capacidad de atenciÃ³n de usuarios, solicitudes y reproducciones concurrentes.
Resiliencia ante fallos de dependencias e infraestructura.
PreparaciÃ³n tÃ©cnica para operar en producciÃ³n.
El resultado debe ser un conjunto de informes Markdown con evidencia verificable, pruebas ejecutadas, resultados, riesgos, limitaciones y recomendaciones dirigidas al equipo de desarrollo.no debe implementar las recomendaciones ni corregir los defectos encontrados. Su responsabilidad termina al documentar y entregar los hallazgos.
2. Contexto tÃ©cnico conocido
La siguiente informaciÃ³n constituye el contexto inicial de la auditorÃ­a. debe verificarla en el repositorio y en el entorno autorizado; no debe asumir que sigue vigente si encuentra evidencia distinta.
2.1 Arquitectura e infraestructura
Componente	InformaciÃ³n conocida
Backend	NestJS
Base de datos	PostgreSQL
ORM	Verificar en el repositorio; se ha considerado Prisma
Contenedores	Docker
Sistema operativo del servidor	Ubuntu
Proxy inverso	Nginx
API pÃºblica	`https://api.cotasperu.com/api/v1`
Host del backend en LAN	`10.10.0.31`
Puerto interno del contenedor	`3000`
Puerto publicado en host	`3100`
Proxy inverso	Nginx en 80/443
Dominio API	`api.cotasperu.com`
IntegraciÃ³n IPTV	XUI mediante `player\_api.php`
XUI en LAN	`http://<XUI_INTERNAL_HOST>:80`
Health check conocido	`/api/v1/health/live`
IntegraciÃ³n de streaming	Backend como proxy de reproducciÃ³n
No modificar DNS, NAT, firewall, Nginx, Docker, XUI ni configuraciÃ³n de infraestructura durante la auditorÃ­a.
2.2 Arquitectura de reproducciÃ³n conocida
El flujo esperado es:
El cliente se autentica contra la API de COTAS mediante HTTPS.
El backend valida la identidad, permisos, estado de cuenta y restricciones aplicables.
El backend consulta XUI desde la red interna mediante `player\_api.php`.
El backend obtiene los datos necesarios para autorizar la reproducciÃ³n.
El cliente solicita una autorizaciÃ³n de reproducciÃ³n a `POST /playback/authorizations`.
El backend genera una autorizaciÃ³n/ticket de reproducciÃ³n.
El cliente recibe una URL de la forma:
`https://api.cotasperu.com/api/v1/playback/media/{ticket}`
El backend actÃºa como proxy y gestiona la comunicaciÃ³n con XUI/Astra.
El reproductor consume el contenido sin conectarse directamente a XUI ni recibir credenciales de XUI.
El auditor debe comprobar el flujo real y documentar cualquier diferencia.
Consideraciones conocidas sobre XUI y streaming
XUI se consulta desde la LAN mediante `http://<XUI_INTERNAL_HOST>` y `/player\_api.php`.
Se observÃ³ que XUI puede responder con una redirecciÃ³n HTTP 302 hacia rutas `/auth/...` y posteriormente hacia contenido HLS bajo `/hls/...`.
Para canales en vivo se ha observado HLS con segmentos MPEG-TS.
Para VOD y series se ha observado entrega progresiva MP4; si la extensiÃ³n es `m3u8`, debe tratarse como HLS.
Se reportÃ³ que XUI puede anunciar `<XUI_INTERNAL_HOST>:80` o una direcciÃ³n externa equivalente en ciertas respuestas, mientras que el acceso a esa direcciÃ³n desde el backend presentÃ³ problemas. Verificar la direcciÃ³n real observada en el entorno; no sustituirla por inferencia.
No se debe publicar el panel administrativo de XUI ni Astra como parte de esta auditorÃ­a.
Las credenciales XUI no deben aparecer en respuestas al cliente, logs, trazas ni informes pÃºblicos.
Se debe verificar el manejo de `HTTP Range`, `Content-Type`, redirecciones, manifiestos HLS, segmentos, cancelaciÃ³n de solicitudes y concurrencia.
Se ha observado que las URLs de XUI pueden contener usuario y contraseÃ±a de la lÃ­nea y no necesariamente son temporales de un solo uso. Comprobar cÃ³mo el backend protege el acceso mediante JWT, ticket opaco, expiraciÃ³n, revocaciÃ³n y validaciÃ³n de permisos.
3. Cuentas de prueba entregadas
Se proporcionan dos lÃ­neas de prueba para validar el comportamiento de las restricciones de conexiones de XUI y del backend.
Estas credenciales son sensibles. Utilizarlas Ãºnicamente en el entorno autorizado de pruebas. No copiarlas a repositorios, commits, tickets pÃºblicos, logs, capturas compartidas ni documentaciÃ³n de producciÃ³n. El presente archivo debe mantenerse en un espacio privado de trabajo y no debe publicarse. debe leer las credenciales desde variables de entorno o un mecanismo seguro, no incrustarlas en scripts ni comandos que queden registrados en el historial.
3.1 Cuenta A â€” Prueba de alta capacidad configurada
Campo	Valor
Usuario	`10200000`
ContraseÃ±a	`10200000`
Owner	`cotaservice`
MÃ¡ximo de conexiones configurado	100 000
Estado de expiraciÃ³n	En la captura, la opciÃ³n â€œNever Expireâ€ aparenta estar activada
Fecha mostrada en el formulario	`2026-11-10 15:48`
PropÃ³sito: utilizar esta cuenta para pruebas controladas de concurrencia, capacidad y comportamiento de reproducciÃ³n, sin que el lÃ­mite de conexiones configurado en la lÃ­nea sea el primer lÃ­mite artificial del experimento.
Importante: 100 000 es el lÃ­mite configurado en el formulario de la cuenta; no representa una capacidad demostrada del backend, XUI, Astra, red, servidor ni base de datos. No ejecutar 100 000 conexiones de golpe. La carga se incrementarÃ¡ por etapas y con autorizaciÃ³n expresa.
VerificaciÃ³n previa obligatoria: confirmar en XUI el estado real de â€œNever Expireâ€, la fecha efectiva, el lÃ­mite aplicado y si el contador de conexiones corresponde a sesiones, streams, conexiones HTTP u otra unidad.
3.2 Cuenta B â€” Prueba de lÃ­mite reducido
Campo	Valor
Usuario	`userprueba`
ContraseÃ±a	`prueba123`
Owner	`gestion`
MÃ¡ximo de conexiones configurado	15
Estado de expiraciÃ³n	â€œNever Expireâ€ aparenta estar desactivado
Fecha de expiraciÃ³n mostrada	`2026-12-10 20:50`
PropÃ³sito: comprobar que el backend y XUI respetan el lÃ­mite de conexiones de una lÃ­nea con capacidad reducida. Esta cuenta permite evaluar el comportamiento al aproximarse y superar el mÃ¡ximo permitido.
VerificaciÃ³n previa obligatoria: confirmar que la cuenta sigue activa, que la fecha de expiraciÃ³n corresponde a la zona horaria configurada en XUI y que el lÃ­mite de 15 se aplica efectivamente.
3.3 Reglas para el uso de las cuentas
No modificar usuarios, contraseÃ±as, owner, expiraciÃ³n ni lÃ­mites de conexiones.
No activar o desactivar â€œNever Expireâ€.
No cambiar bouquets, paquetes, restricciones ni permisos.
No utilizar estas cuentas para consumo real o pruebas fuera del alcance autorizado.
No ejecutar pruebas destructivas ni generar carga que afecte a clientes reales.
No compartir las credenciales en los informes finales de circulaciÃ³n general. En los informes, referirse a ellas como Cuenta A (100 000) y Cuenta B (15).
Si se necesita guardar credenciales en el entorno de ejecuciÃ³n, usar variables de entorno o un almacÃ©n de secretos local excluido del control de versiones.
Si las credenciales aparecen accidentalmente en logs, capturas o reportes, registrar el incidente y solicitar su rotaciÃ³n.
Ejemplo de variables locales â€”no guardar valores reales en el repositorioâ€”:
```bash
export IPTV\_TEST\_USER\_HIGH="..."
export IPTV\_TEST\_PASS\_HIGH="..."
export IPTV\_TEST\_USER\_LIMITED="..."
export IPTV\_TEST\_PASS\_LIMITED="..."
```
4. Alcance de la auditorÃ­a
4.1 Inventario y arquitectura
Revisar:
Estructura completa del backend.
MÃ³dulos NestJS, controladores, servicios, providers, guards, interceptors, pipes, filters y middlewares.
InyecciÃ³n de dependencias y lÃ­mites entre mÃ³dulos.
DTO, validaciones, serializaciÃ³n y manejo de errores.
ConfiguraciÃ³n por entorno y carga de variables.
IntegraciÃ³n con PostgreSQL y ORM.
IntegraciÃ³n con XUI y servicios externos.
GestiÃ³n de tareas asÃ­ncronas, colas y procesos en segundo plano, si existen.
Dockerfile, Docker Compose y configuraciÃ³n de ejecuciÃ³n.
Health checks, logs, mÃ©tricas y observabilidad.
Nginx y configuraciÃ³n de proxy, solo lectura.
Endpoints y contratos de API.
Pruebas existentes y su cobertura real.
Documentar arquitectura observada, dependencias, puntos de entrada, lÃ­mites de confianza y flujos de datos.
4.2 AuditorÃ­a estÃ¡tica y calidad del cÃ³digo
Buscar y documentar:
Errores lÃ³gicos y defectos potenciales.
CÃ³digo duplicado y complejidad innecesaria.
Acoplamiento elevado y responsabilidades mezcladas.
Incumplimientos relevantes de SOLID y Clean Code.
Validaciones incompletas o inconsistentes.
Manejo incorrecto de excepciones.
Promesas no esperadas, tareas asÃ­ncronas sin control y errores no capturados.
Condiciones de carrera y problemas de concurrencia.
Posibles fugas de memoria o recursos.
Uso incorrecto de streams, buffers y conexiones.
ExposiciÃ³n de datos sensibles.
Configuraciones inseguras.
Ausencia de pruebas en componentes crÃ­ticos.
No modificar el cÃ³digo para mejorar mÃ©tricas o eliminar observaciones.
4.3 Base de datos
Evaluar:
Modelo de datos, tablas, relaciones y restricciones.
Claves primarias y forÃ¡neas.
Ãndices y consultas frecuentes.
Integridad referencial.
Transacciones y aislamiento.
Riesgos de condiciones de carrera.
Consultas N+1.
Consultas costosas y escaneos completos.
Pool y lÃ­mites de conexiones.
Bloqueos, deadlocks y tiempos de espera.
Estrategia de migraciones, si existe.
Manejo de errores y reconexiÃ³n.
Consistencia entre datos locales y datos obtenidos desde XUI.
No ejecutar operaciones que alteren datos reales. Para pruebas que necesiten escrituras, utilizar Ãºnicamente registros de prueba expresamente autorizados y limpiarlos solo si existe autorizaciÃ³n previa y un procedimiento seguro.
4.4 Pruebas funcionales
Evaluar los mÃ³dulos que existan realmente en el repositorio:
AutenticaciÃ³n y cierre de sesiÃ³n.
Usuarios, perfiles y roles.
AutorizaciÃ³n y permisos.
Sesiones y dispositivos.
CatÃ¡logo.
CategorÃ­as.
Canales en vivo.
PelÃ­culas.
Series y episodios.
BÃºsqueda y filtros.
Favoritos, si estÃ¡ implementado.
Autorizaciones de reproducciÃ³n.
Tickets de reproducciÃ³n.
Proxy multimedia.
IntegraciÃ³n con XUI.
Manejo de cuentas expiradas o deshabilitadas.
Manejo de lÃ­mites de conexiones.
No marcar como fallida una funcionalidad que no estÃ© implementada: clasificarla como â€œno implementadaâ€ o â€œfuera de alcanceâ€, con evidencia.
4.5 Seguridad
Auditar, como mÃ­nimo:
AutenticaciÃ³n JWT: firma, algoritmo, expiraciÃ³n, claims y validaciÃ³n.
AutorizaciÃ³n por roles y permisos.
Acceso horizontal y vertical indebido (BOLA/IDOR).
Escalamiento de privilegios.
EnumeraciÃ³n de usuarios.
Fuerza bruta y abuso de endpoints.
Rate limiting y throttling.
ValidaciÃ³n y sanitizaciÃ³n de entradas.
InyecciÃ³n SQL y otras inyecciones.
CORS y configuraciÃ³n de cabeceras.
ExposiciÃ³n de secretos y datos personales.
Logs con credenciales, tokens o URLs sensibles.
GestiÃ³n de sesiones, revocaciÃ³n y expiraciÃ³n.
ProtecciÃ³n de tickets de reproducciÃ³n.
ReutilizaciÃ³n de tickets y acceso no autorizado a streams.
Redirecciones HTTP y validaciÃ³n de destinos.
SSRF y posibilidad de que parÃ¡metros controlados por el cliente fuercen solicitudes internas.
ValidaciÃ³n de dominios/IP permitidos para XUI.
ProtecciÃ³n ante abuso de proxy multimedia.
Dependencias vulnerables.
Seguridad de imÃ¡genes y contenedores Docker.
ConfiguraciÃ³n de producciÃ³n y manejo de errores.
Referencias orientativas:
OWASP API Security Top 10.
OWASP ASVS.
OWASP Top 10.
NIST Secure Software Development Framework (SSDF).
Buenas prÃ¡cticas de seguridad de NestJS, Node.js y PostgreSQL.
Herramientas posibles, solo si estÃ¡n disponibles y autorizadas: Semgrep, Gitleaks, Trivy, OWASP ZAP, SonarQube y npm audit. Registrar versiÃ³n, configuraciÃ³n y alcance de cada herramienta.
4.6 Rendimiento y capacidad
Usar Grafana k6 u otra herramienta aprobada. Las pruebas de carga deben ejecutarse exclusivamente en staging o en un entorno de pruebas aislado, con autorizaciÃ³n y lÃ­mites definidos.
Separar claramente:
Carga de API JSON: autenticaciÃ³n, catÃ¡logo, categorÃ­as, sesiones y autorizaciones.
Carga de reproducciÃ³n multimedia: autorizaciones, solicitudes al proxy, manifiestos, segmentos HLS y VOD.
Carga combinada: flujo realista de usuario con API y reproducciÃ³n.
No utilizar Ãºnicamente un endpoint de health check para afirmar capacidad del sistema.
Escalones de carga propuestos
Etapa	Usuarios virtuales (VU)	PropÃ³sito
Smoke	1â€“5	Confirmar funcionamiento bÃ¡sico
Carga inicial	50	LÃ­nea base
Carga 2	100	Comportamiento inicial de concurrencia
Carga 3	250	Incremento progresivo
Carga 4	500	EvaluaciÃ³n intermedia
Carga 5	1 000	Escenario de referencia solicitado
Carga 6	2 500	Identificar degradaciÃ³n
Carga 7	5 000	Evaluar saturaciÃ³n progresiva
Carga 8	10 000	Solo si las etapas previas son estables y existe autorizaciÃ³n
Las etapas superiores no son obligatorias. Detener el incremento cuando se alcance un umbral de seguridad, una degradaciÃ³n grave o un lÃ­mite de infraestructura.
No confundir:
Usuarios registrados.
Usuarios autenticados.
Usuarios virtuales (VU) del generador.
Solicitudes concurrentes.
Sesiones abiertas.
Reproducciones simultÃ¡neas.
Conexiones HTTP/TCP.
Segmentos HLS descargados.
Un VU no equivale necesariamente a una conexiÃ³n ni a un stream simultÃ¡neo.
Escenarios de carga
Inicio de sesiÃ³n concurrente.
Consulta de perfil y sesiÃ³n.
Consulta de catÃ¡logo y categorÃ­as.
BÃºsqueda.
Consulta de canales.
Consulta de pelÃ­culas y series.
Solicitud de autorizaciÃ³n de reproducciÃ³n.
ReproducciÃ³n de canal en vivo.
ReproducciÃ³n VOD.
Consumo de manifiestos HLS y segmentos.
RenovaciÃ³n, expiraciÃ³n y revocaciÃ³n de tickets.
Cierre de sesiÃ³n.
Solicitudes repetidas y patrones de navegaciÃ³n realistas.
MÃ©tricas obligatorias
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
Conexiones simultÃ¡neas y streams activos, cuando puedan medirse.
Tiempo de respuesta de XUI.
Tiempo de respuesta del proxy multimedia.
Punto de saturaciÃ³n.
Tiempo de recuperaciÃ³n tras reducir o detener la carga.
Tipos de prueba
Smoke test.
Load test.
Stress test.
Spike test.
Soak/endurance test.
Breakpoint test, Ãºnicamente si es seguro y autorizado.
No inventar umbrales de aceptaciÃ³n. Si el proyecto no define SLO/SLI, registrar la ausencia y proponer valores para aprobaciÃ³n, diferenciÃ¡ndolos de los resultados medidos.
4.7 Pruebas especÃ­ficas de conexiones IPTV
Este apartado es prioritario por las dos cuentas de prueba entregadas.
Cuenta A: lÃ­mite configurado de 100 000
Objetivo: evaluar el comportamiento del sistema con una lÃ­nea cuyo lÃ­mite configurado no deberÃ­a restringir las primeras etapas de carga.
Procedimiento:
Verificar la cuenta en XUI sin modificarla.
Confirmar que la cuenta estÃ¡ activa y que el lÃ­mite aplicado es 100 000.
Verificar el estado de expiraciÃ³n.
Registrar conexiones iniciales y streams activos.
Ejecutar pruebas de baja concurrencia.
Incrementar gradualmente la concurrencia segÃºn las etapas aprobadas.
Medir por separado API, autorizaciones y reproducciÃ³n multimedia.
Identificar el primer componente que se satura.
Detener la prueba ante errores generalizados, degradaciÃ³n grave o impacto en servicios.
Documentar el mÃ¡ximo nivel estable realmente observado.
No intentar alcanzar 100 000 conexiones solo porque la cuenta tenga ese lÃ­mite. El objetivo es medir la capacidad real y localizar el cuello de botella de forma controlada.
Cuenta B: lÃ­mite configurado de 15
Objetivo: comprobar el cumplimiento del lÃ­mite de conexiones de una lÃ­nea restringida.
Procedimiento:
Verificar que la cuenta estÃ¡ activa y que el lÃ­mite es 15.
Confirmar la expiraciÃ³n y el estado de â€œNever Expireâ€.
Iniciar una reproducciÃ³n y verificar que funciona.
Incrementar sesiones/reproducciones de forma controlada: 1, 5, 10, 14 y 15.
Intentar una conexiÃ³n adicional solo con autorizaciÃ³n y en staging.
Registrar si XUI rechaza la conexiÃ³n adicional, reemplaza una sesiÃ³n anterior o permite exceder el lÃ­mite.
Verificar que el backend interpreta correctamente el resultado.
Comprobar que el cliente recibe un error controlado y que no se filtran detalles internos.
Cerrar las sesiones de prueba y verificar liberaciÃ³n de conexiones.
Repetir solo si el entorno y la cuenta continÃºan en condiciones seguras.
No asumir que â€œ15 conexionesâ€ significa 15 usuarios. Determinar quÃ© unidad controla XUI y documentarla.
ComparaciÃ³n de ambas cuentas
El informe debe comparar:
Conexiones permitidas configuradas.
Conexiones efectivamente aceptadas.
Conexiones rechazadas.
Streams simultÃ¡neos.
Comportamiento al superar el lÃ­mite.
Tiempo de liberaciÃ³n de conexiones.
Estado de sesiones despuÃ©s de cerrar el reproductor.
Diferencias entre la respuesta de XUI y la respuesta del backend.
Posibles inconsistencias entre el contador de XUI y el estado registrado por COTAS.
4.8 Resiliencia
Evaluar de manera controlada:
PÃ©rdida de conectividad con PostgreSQL.
Indisponibilidad de XUI.
Latencia elevada de XUI.
Timeouts de servicios externos.
Reinicio controlado del backend en staging.
Agotamiento controlado del pool de conexiones.
Respuestas HTTP 4xx/5xx de XUI.
Redirecciones inesperadas.
InterrupciÃ³n de solicitudes multimedia.
CancelaciÃ³n de reproducciÃ³n por el cliente.
Fallos parciales de dependencias.
Comprobar:
Timeouts configurados.
Reintentos y sus lÃ­mites.
Circuit breakers, si existen.
LiberaciÃ³n de conexiones y recursos.
RecuperaciÃ³n de conexiones.
Integridad de datos.
Comportamiento degradado.
Mensajes de error.
Ausencia de exposiciÃ³n de informaciÃ³n sensible.
No provocar fallos en producciÃ³n ni interrumpir streams de clientes reales.
5. MetodologÃ­a de ejecuciÃ³n
Ejecutar las fases en este orden. Cada fase debe terminar con un registro documental antes de avanzar.
Fase 0 â€” Reconocimiento e inventario
Identificar estructura, mÃ³dulos y componentes.
Levantar endpoints y contratos.
Identificar modelo de datos.
Identificar integraciones externas.
Identificar pruebas existentes.
Verificar el entorno disponible.
Determinar quÃ© pruebas son seguras y cuÃ¡les requieren autorizaciÃ³n.
Salida: arquitectura, inventario de dependencias y lista de bloqueos.
Fase 1 â€” AuditorÃ­a estÃ¡tica
Analizar cÃ³digo fuente y configuraciÃ³n en modo lectura.
Revisar dependencias y vulnerabilidades.
Ejecutar herramientas estÃ¡ticas si estÃ¡n disponibles.
Revisar calidad, complejidad, errores y patrones de riesgo.
Salida: hallazgos de cÃ³digo y calidad.
Fase 2 â€” Pruebas funcionales
DiseÃ±ar casos de prueba a partir de los endpoints y requisitos reales.
Ejecutar pruebas en entorno autorizado.
Registrar resultados y evidencias.
Identificar funcionalidades no implementadas o no verificables.
Salida: plan y resultados funcionales.
Fase 3 â€” Seguridad
Revisar autenticaciÃ³n, autorizaciÃ³n y exposiciÃ³n de datos.
Ejecutar pruebas no destructivas.
Validar lÃ­mites de acceso, tickets y proxy multimedia.
Evaluar dependencias y configuraciÃ³n.
Salida: evaluaciÃ³n de seguridad y registro de vulnerabilidades.
Fase 4 â€” Rendimiento
Confirmar staging, datos de prueba y autorizaciÃ³n.
Establecer lÃ­nea base.
Ejecutar carga gradual.
Probar por separado API y streaming.
Evaluar las cuentas A y B.
Detener pruebas ante criterios de seguridad.
Salida: resultados de estrÃ©s e informe de capacidad.
Fase 5 â€” Resiliencia
Ejecutar fallos controlados y aislados.
Medir detecciÃ³n, degradaciÃ³n y recuperaciÃ³n.
Verificar liberaciÃ³n de recursos.
Salida: informe de resiliencia.
Fase 6 â€” RegresiÃ³n
Ejecutar la suite existente antes y despuÃ©s de las pruebas, si corresponde.
Comprobar que el entorno de pruebas sigue operativo.
No modificar pruebas ni cÃ³digo.
Documentar pruebas que no puedan ejecutarse.
Salida: resultados de regresiÃ³n.
Fase 7 â€” ConsolidaciÃ³n y cierre
Eliminar duplicados documentales, no archivos del proyecto.
Consolidar severidades y evidencias.
Identificar riesgos crÃ­ticos y bloqueos.
Establecer estado de preparaciÃ³n para producciÃ³n.
Entregar el informe final al equipo de desarrollo.
No existe una fase de correcciÃ³n dentro de esta asignaciÃ³n.
6. Estructura documental obligatoria
Crear o actualizar exclusivamente los archivos Markdown de esta estructura. No cambiar nombres, no agregar carpetas y no crear documentos fuera de `backend/aseguramiento-calidad/`.
```text
backend/
â””â”€â”€ aseguramiento-calidad/
    â”œâ”€â”€ 00-inventario-proyecto/
    â”‚   â”œâ”€â”€ arquitectura.md
    â”‚   â””â”€â”€ dependencias.md
    â”‚
    â”œâ”€â”€ 01-auditoria-codigo/
    â”‚   â”œâ”€â”€ hallazgos.md
    â”‚   â””â”€â”€ calidad-codigo.md
    â”‚
    â”œâ”€â”€ 02-pruebas-funcionales/
    â”‚   â”œâ”€â”€ plan-pruebas.md
    â”‚   â””â”€â”€ resultados-pruebas.md
    â”‚
    â”œâ”€â”€ 03-seguridad/
    â”‚   â”œâ”€â”€ evaluacion-seguridad.md
    â”‚   â””â”€â”€ vulnerabilidades.md
    â”‚
    â”œâ”€â”€ 04-rendimiento/
    â”‚   â”œâ”€â”€ plan-pruebas-carga.md
    â”‚   â”œâ”€â”€ resultados-pruebas-estres.md
    â”‚   â””â”€â”€ informe-capacidad.md
    â”‚
    â”œâ”€â”€ 05-resiliencia/
    â”‚   â””â”€â”€ informe-resiliencia.md
    â”‚
    â”œâ”€â”€ 06-pruebas-regresion/
    â”‚   â””â”€â”€ resultados-regresion.md
    â”‚
    â””â”€â”€ 07-informe-final/
        â”œâ”€â”€ resumen-ejecutivo.md
        â””â”€â”€ auditoria-tecnica.md
```
6.1 Contenido mÃ­nimo por documento
`00-inventario-proyecto/arquitectura.md`
DescripciÃ³n de arquitectura real.
Diagrama Mermaid de componentes y dependencias, si la informaciÃ³n lo permite.
MÃ³dulos NestJS y responsabilidades.
Endpoints y mÃ©todos HTTP.
Flujo de autenticaciÃ³n.
Flujo de catÃ¡logo.
Flujo de autorizaciÃ³n y reproducciÃ³n.
IntegraciÃ³n con XUI.
Dependencias internas y externas.
LÃ­mites de confianza y puntos de entrada.
Componentes no verificables.
`00-inventario-proyecto/dependencias.md`
Runtime y versiones.
Dependencias directas y transitivas relevantes.
Versiones obsoletas o sin soporte, si se confirma.
Vulnerabilidades reportadas por herramientas.
Licencias cuando la herramienta lo permita.
Riesgos de mantenimiento.
Comandos y herramientas ejecutadas.
Limitaciones del anÃ¡lisis.
`01-auditoria-codigo/hallazgos.md`
Registro consolidado de defectos, riesgos y observaciones de cÃ³digo con evidencia.
`01-auditoria-codigo/calidad-codigo.md`
MÃ©tricas disponibles.
Complejidad.
DuplicaciÃ³n.
Mantenibilidad.
Convenciones.
DiseÃ±o modular.
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
Alcance y metodologÃ­a.
Controles revisados.
Resultados por dominio de seguridad.
Herramientas y versiones.
Riesgos y limitaciones.
EvaluaciÃ³n general.
`03-seguridad/vulnerabilidades.md`
Vulnerabilidades confirmadas.
Riesgos potenciales.
Severidad.
Evidencia y reproducciÃ³n.
Impacto.
RecomendaciÃ³n.
Estado de validaciÃ³n.
`04-rendimiento/plan-pruebas-carga.md`
Objetivos.
Entorno.
Perfil de usuario.
Escenarios.
Etapas de VU.
DuraciÃ³n y ramp-up/ramp-down.
Datos de prueba.
MÃ©tricas.
Umbrales aprobados.
Criterios de parada.
Restricciones y autorizaciÃ³n.
`04-rendimiento/resultados-pruebas-estres.md`
Fecha y entorno.
VersiÃ³n de backend.
ConfiguraciÃ³n del generador.
Escenario ejecutado.
VU objetivo y VU alcanzados.
DuraciÃ³n.
RPS y throughput.
Latencias media, p50, p90, p95 y p99.
Errores y timeouts.
CPU, RAM, red y conexiones de BD.
Comportamiento de XUI y streaming.
Punto de degradaciÃ³n o saturaciÃ³n.
Evidencia y limitaciones.
`04-rendimiento/informe-capacidad.md`
Capacidad estable medida.
Capacidad mÃ¡xima observada, si se pudo determinar.
Cuellos de botella.
Diferencias entre API y streaming.
Diferencias entre Cuenta A y Cuenta B.
LÃ­mites de infraestructura.
ProyecciÃ³n: solo si se fundamenta y se etiqueta como estimaciÃ³n.
Recomendaciones tÃ©cnicas.
`05-resiliencia/informe-resiliencia.md`
Fallo inducido.
Componente afectado.
Procedimiento.
Resultado esperado y real.
Tiempo de detecciÃ³n y recuperaciÃ³n.
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
Hallazgos crÃ­ticos y altos.
Principales riesgos.
Capacidad medida.
Seguridad.
Calidad.
Resiliencia.
Limitaciones.
RecomendaciÃ³n de preparaciÃ³n para producciÃ³n.
`07-informe-final/auditoria-tecnica.md`
Alcance completo.
Arquitectura auditada.
MetodologÃ­a.
Herramientas.
Resultados por fase.
Hallazgos consolidados.
Evidencias.
Riesgos residuales.
Pruebas no ejecutadas y motivos.
Recomendaciones priorizadas.
ConclusiÃ³n tÃ©cnica.
7. ClasificaciÃ³n de resultados y hallazgos
7.1 Severidad
Severidad	Criterio
CRITICAL	Compromiso grave de seguridad, exposiciÃ³n masiva de datos, toma de control o caÃ­da crÃ­tica reproducible
HIGH	Vulnerabilidad o defecto de alto impacto que compromete una funciÃ³n importante o permite abuso significativo
MEDIUM	Defecto con impacto moderado, alcance limitado o condiciÃ³n de explotaciÃ³n mÃ¡s restrictiva
LOW	Defecto menor, impacto reducido o problema de calidad sin afectaciÃ³n crÃ­tica
INFORMATIONAL	ObservaciÃ³n, oportunidad de mejora o informaciÃ³n relevante sin defecto confirmado
7.2 ClasificaciÃ³n de certeza
Cada registro debe identificarse ademÃ¡s como uno de los siguientes:
CONFIRMED DEFECT: defecto reproducido y respaldado por evidencia.
CONFIRMED VULNERABILITY: vulnerabilidad validada mediante una prueba segura.
POTENTIAL RISK: riesgo tÃ©cnicamente plausible aÃºn no confirmado.
QUALITY OBSERVATION: observaciÃ³n de diseÃ±o, mantenibilidad o calidad.
NEEDS FURTHER TESTING: requiere entorno, permisos, datos o pruebas adicionales.
No presentar un riesgo potencial como vulnerabilidad confirmada.
7.3 Campos obligatorios de cada hallazgo
```markdown
### \[ID] TÃ­tulo del hallazgo

- Fecha:
- Plataforma/mÃ³dulo:
- Archivo, funciÃ³n o endpoint:
- ClasificaciÃ³n:
- Severidad:
- Estado:
- Entorno:
- Evidencia:

\*\*DescripciÃ³n:\*\*

\*\*Precondiciones:\*\*

\*\*Pasos de reproducciÃ³n:\*\*

\*\*Resultado esperado:\*\*

\*\*Resultado obtenido:\*\*

\*\*Impacto:\*\*

\*\*Causa raÃ­z:\*\* (solo si estÃ¡ confirmada)

\*\*RecomendaciÃ³n para desarrollo:\*\*

\*\*Limitaciones o informaciÃ³n pendiente:\*\*
```
Usar identificadores Ãºnicos y consecutivos por dominio, por ejemplo `CODE-001`, `FUNC-001`, `SEC-001`, `PERF-001` y `RES-001`.
8. Criterios de calidad y evaluaciÃ³n
Evaluar, sin modificar el proyecto:
Bugs confirmados.
Vulnerabilidades confirmadas.
Cobertura de pruebas existente.
Cobertura de rutas crÃ­ticas.
Correctitud de validaciones.
Manejo de errores.
Integridad de datos.
Rendimiento por endpoint.
Rendimiento de reproducciÃ³n.
Comportamiento bajo concurrencia.
RecuperaciÃ³n ante fallos.
Observabilidad.
La cobertura de pruebas del 80 % puede utilizarse como referencia de evaluaciÃ³n, pero no como autorizaciÃ³n para crear o modificar pruebas. Reportar cobertura real por mÃ³dulo y por tipo de prueba, si puede medirse.
No declarar â€œapto para producciÃ³nâ€ Ãºnicamente por ausencia de errores durante una prueba breve. La conclusiÃ³n debe considerar cobertura, evidencia, limitaciones y riesgos pendientes.
9. Restricciones estrictas para el dev
9.1 Prohibiciones
NO debe:
Corregir bugs.
Refactorizar cÃ³digo.
Cambiar controladores, servicios, mÃ³dulos, DTO, guards o providers.
Modificar lÃ³gica de negocio.
Crear, modificar o eliminar pruebas del proyecto.
Cambiar esquemas, tablas, Ã­ndices o migraciones.
Ejecutar escrituras no autorizadas en bases de datos.
Actualizar, instalar, eliminar o reemplazar dependencias.
Cambiar `package.json` o lockfiles.
Modificar `.env`, secretos o configuraciones.
Modificar Dockerfile, Docker Compose o imÃ¡genes.
Modificar Nginx, DNS, NAT, firewall o reglas de red.
Cambiar configuraciÃ³n de XUI/Astra.
Cambiar cuentas o lÃ­mites de las dos lÃ­neas de prueba.
Eliminar archivos, datos, logs o contenedores.
Reiniciar servicios de producciÃ³n.
Ejecutar pruebas de estrÃ©s en producciÃ³n.
Realizar commits, push, merge o despliegues.
Crear carpetas o archivos fuera de `backend/aseguramiento-calidad/`.
9.2 Ãšnica escritura permitida
La Ãºnica escritura autorizada es crear o actualizar los archivos `.md` listados en la secciÃ³n 6, dentro de:
`backend/aseguramiento-calidad/`
Si la estructura ya existe, conservar su contenido Ãºtil y actualizarlo sin borrar evidencia previa. No crear archivos auxiliares, scripts, reportes HTML, CSV, JSON ni configuraciones en otras rutas.
9.3 Seguridad operativa
No ejecutar pruebas destructivas.
No afectar clientes, streams ni servicios reales.
No bloquear cuentas reales.
No agotar deliberadamente recursos compartidos.
No enviar trÃ¡fico masivo a producciÃ³n.
No revelar credenciales en logs o informes generales.
No probar vulnerabilidades contra terceros.
Detener cualquier prueba que pueda afectar la disponibilidad o integridad.
Solicitar autorizaciÃ³n cuando falten permisos, entorno aislado, datos o configuraciÃ³n.
Ante un hallazgo CRITICAL, detener la prueba relacionada y reportar inmediatamente.
10. Reglas de evidencia y trazabilidad
Todo resultado debe ser reproducible y trazable.
Para cada prueba registrar:
Fecha y hora con zona horaria.
Entorno y URL/base URL utilizada.
VersiÃ³n o commit del backend auditado, si estÃ¡ disponible.
Herramienta y versiÃ³n.
ConfiguraciÃ³n relevante.
Datos de prueba utilizados, sin secretos.
Comando o procedimiento ejecutado, ocultando tokens y contraseÃ±as.
Resultado esperado.
Resultado observado.
Logs, mÃ©tricas o captura que respalden el resultado.
Limitaciones.
No incluir tokens JWT, contraseÃ±as, claves API, cookies, URLs con credenciales ni datos personales en los documentos. Enmascarar secretos, por ejemplo `u\*\*\*a`.
Regla de veracidad:
`PASS`: prueba ejecutada y superada.
`FAIL`: prueba ejecutada y fallida.
`BLOCKED`: no pudo ejecutarse por una dependencia o autorizaciÃ³n faltante.
`NOT RUN`: no se ejecutÃ³.
`NOT APPLICABLE`: no aplica, con justificaciÃ³n.
No registrar una prueba como ejecutada si solo se diseÃ±Ã³. No inventar mÃ©tricas, evidencias, resultados, capacidades ni causas raÃ­z.
11. Condiciones de parada
Interrumpir la prueba en curso y documentar el motivo si ocurre cualquiera de estas condiciones:
Impacto observable en clientes o streams reales.
Errores generalizados o caÃ­da de un servicio compartido.
CPU, memoria, disco, red o conexiones de BD alcanzan lÃ­mites peligrosos definidos por el responsable de infraestructura.
Aumento sostenido de timeouts o errores.
Riesgo de pÃ©rdida o corrupciÃ³n de datos.
Comportamiento no previsto que pueda afectar XUI/Astra.
Se detecta una vulnerabilidad crÃ­tica cuya explotaciÃ³n adicional no sea necesaria para demostrar el riesgo.
El entorno no puede distinguirse con certeza de producciÃ³n.
Si no existen umbrales operativos definidos, solicitarlos antes de iniciar pruebas de carga o estrÃ©s.
12. Entregables y cierre
Al terminar, debe entregar:
Los documentos Markdown completos dentro de la estructura indicada.
Resumen de fases ejecutadas y pendientes.
Hallazgos priorizados por severidad.
Evidencias suficientes para que desarrollo pueda reproducir los defectos.
Resultados medidos de carga y capacidad, solo si las pruebas se ejecutaron.
Riesgos que impiden considerar el backend listo para producciÃ³n.
Lista de permisos, accesos o condiciones que impidieron completar alguna prueba.
El informe final debe responder explÃ­citamente:
Â¿El backend funciona correctamente en los flujos crÃ­ticos?
Â¿QuÃ© defectos confirmados existen?
Â¿QuÃ© vulnerabilidades fueron confirmadas?
Â¿QuÃ© riesgos de seguridad siguen abiertos?
Â¿QuÃ© capacidad estable se midiÃ³ para API?
Â¿QuÃ© capacidad estable se midiÃ³ para reproducciÃ³n?
Â¿QuÃ© ocurre con la Cuenta A configurada con 100 000 conexiones?
Â¿QuÃ© ocurre con la Cuenta B configurada con 15 conexiones?
Â¿Se respetan los lÃ­mites de conexiones de XUI?
Â¿DÃ³nde se encuentran los cuellos de botella?
Â¿CÃ³mo responde el sistema ante fallos de PostgreSQL y XUI?
Â¿QuÃ© pruebas no pudieron ejecutarse y por quÃ©?
Â¿CuÃ¡l es el nivel de preparaciÃ³n para producciÃ³n y quÃ© evidencia lo respalda?
La auditorÃ­a se considera terminada cuando todos los documentos estÃ©n actualizados, los hallazgos estÃ©n trazados y el informe final indique claramente quÃ© se verificÃ³, quÃ© fallÃ³, quÃ© quedÃ³ pendiente y quÃ© no pudo comprobarse.
---
13. InstrucciÃ³n final para el dev.
ActÃºa como Principal Backend QA Engineer & Software Auditor de COTAS PERU S.A.C. Realiza una auditorÃ­a integral, objetiva y basada en evidencia del backend descrito en este documento.
Tu responsabilidad es inspeccionar, probar, medir y documentar. No eres el desarrollador encargado de corregir los problemas. No realices cambios funcionales ni tÃ©cnicos. No intentes â€œmejorarâ€ el sistema durante la auditorÃ­a.
Utiliza las dos cuentas de prueba exclusivamente para validar lÃ­mites de conexiones y reproducciÃ³n, respetando todas las restricciones de seguridad. La Cuenta A tiene un mÃ¡ximo configurado de 100 000 conexiones y la Cuenta B un mÃ¡ximo configurado de 15; esos valores son lÃ­mites configurados, no capacidades demostradas.
Trabaja por fases, registra cada resultado y crea/actualiza Ãºnicamente los archivos Markdown de `backend/aseguramiento-calidad/`. Si una prueba no es segura, no estÃ¡ autorizada o requiere infraestructura adicional, no la ejecutes: documenta el bloqueo y solicita lo necesario.
Entrega un diagnÃ³stico tÃ©cnico verificable para que el equipo de desarrollo implemente posteriormente las correcciones. No corrijas absolutamente nada.