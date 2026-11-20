# Unidad 1 — Diagnóstico inicial de QC de HCV

Registro: U1-QC-001. Fecha: 15 de noviembre de 2026. Revisión realizada por Codex como asistencia al trabajo académico.

Estado: inspección inicial completada para el alcance indicado. Las comprobaciones funcionales y la aceptación hospitalaria permanecen pendientes. Este registro no cierra la evaluación del sistema ni el trabajo completo de la Unidad 1.

**Actualización del 16/11/2026:** este diagnóstico conserva el alcance y las huellas de la inspección del día 15. El ciclo funcional posterior U1-QC-002, sus etapas PHVA, la clasificación de costos y los indicadores están documentados en [QC aplicado a las unidades 1 y 2](qc-unidades-1-2-aplicacion.md). TC-015 cuenta ahora con evidencias locales de fallo y aprobación; esa actualización no cambia la aceptación hospitalaria pendiente ni los hallazgos de especificación de este registro.

## 1. Aplicación de la bibliografía

La Unidad 1 permite aplicar la distinción entre calidad del proceso y calidad del producto, clasificar el esfuerzo asociado a calidad y organizar la mejora con PHVA. La actividad concreta de QC realizada aquí es una **inspección de productos existentes**: documentación del sistema y lectura dirigida del servicio de autenticación, sin ejecutar la aplicación.

| Concepto de la Unidad 1 | Aplicación realizada o registrada | Límite |
| --- | --- | --- |
| QA frente a QC, apartados 2.1 y 2.2 | Se compararon artefactos existentes y se registraron coincidencias, carencias y límites de evidencia. | La inspección es QC estático. Organizar el trabajo o redactar criterios, por sí solos, no constituye una prueba funcional ejecutada. |
| Costos de calidad, apartado 3.1 | Se abrió un registro de actividades de evaluación y del retrabajo histórico documentado. | No hay horas ni importes medidos; no se calcula un ahorro ni se adopta el multiplicador teórico de 1.000× como dato de HCV. |
| PHVA | Se realizó el primer ciclo acotado de inspección, comparación y registro; se identificaron las acciones siguientes. | No se presenta como completado un ciclo de corrección y aceptación funcional. |
| KISS | Se usa este registro y los documentos existentes. | No se agregaron plataformas, dependencias ni cambios de arquitectura para producir el diagnóstico. No se evaluó aquí la complejidad del código. |

## 2. Objeto, método y versión examinada

Objetivo: identificar qué afirmaciones sobre autenticación, requisitos y preparación del entorno están respaldadas por los artefactos disponibles, y cuáles requieren una decisión o una comprobación adicional.

Método: lectura y comparación documental, más revisión estática dirigida de `login()` en [auth-service.js](../src/services/auth-service.js). No se auditó la totalidad del código ni se ejecutaron pruebas, contenedores, migraciones o conexiones a MariaDB. No se leyó el `.env` real ni se utilizaron datos clínicos.

Referencia Git: `fe5cdd9eac83ee8b4ffc1bf9dbf4ca8071fa7226`. El directorio de trabajo contiene modificaciones y archivos sin seguimiento, por lo que ese commit no identifica por sí solo todo el estado inspeccionado. Las huellas del apartado 8 identifican los archivos concretos revisados.

Los criterios siguientes delimitan esta inspección académica: consistencia entre fuentes para una decisión acordada; identificación de reglas pendientes; y evidencia suficiente antes de afirmar que un comportamiento fue comprobado. No agregan políticas clínicas ni requisitos institucionales nuevos.

## 3. Registro de inspección realizada

| ID | Pregunta de control y evidencia | Resultado de la inspección | Alcance de la conclusión |
| --- | --- | --- | --- |
| U1-REV-01 | ¿Las fuentes revisadas coinciden con retirar el bloqueo por fallos? [README, Implementado](../README.md), [API, Autenticación](api-rest-hcv.md), [OpenAPI, POST /api/auth/login](openapi-hcv.yaml), [decisión del cambio](qc-login-sin-bloqueo.md) y `login()` del servicio. | **Conforme en la revisión estática acotada.** Los documentos describen acceso sin bloqueo automático por cuenta/IP ni espera progresiva; el cuerpo revisado de `login()` valida cada solicitud sin consultar un contador de intentos. | No se comprobó el flujo en navegador, la instalación efectiva, otros componentes de red ni el comportamiento entre dos equipos. |
| U1-REV-02 | ¿Está definido el alcance clínico de lectura/escritura por servicio? [README, Pendiente de definición funcional](../README.md) y [API, Autenticación y autorización](api-rest-hcv.md). | **Carencia de especificación confirmada.** El alcance por servicio está pendiente; la API documenta los permisos técnicos actuales sin asociación por servicio. | Se registra H-U1-01. No se afirma una exposición de datos observada ni que todo el RBAC esté indefinido. |
| U1-REV-03 | ¿El mínimo técnico de contraseña equivale a una política institucional aprobada? [README, Pendiente de definición funcional](../README.md). | **Carencia de especificación confirmada.** El mínimo del bootstrap se declara provisional y la política institucional sigue pendiente. | Se registra H-U1-02. No se inventa una nueva longitud mínima ni se declara incorrecto el control técnico existente. |
| U1-REV-04 | ¿Existe aceptación manual del acceso sin bloqueo en el entorno hospitalario? [QC de inicio de sesión, Comprobación manual pendiente](qc-login-sin-bloqueo.md). | **Comprobación pendiente.** El documento conserva expresamente esa limitación. | Los resultados automatizados históricos no permiten cerrar por sí solos la aceptación manual ni la condición de IP compartida del hospital. |
| U1-REV-05 | ¿Está acreditado HTTPS en una instalación hospitalaria actual? [README, requisitos de LAN y producción](../README.md). | **Cumplimiento de la instalación no evaluado.** El requisito de HTTPS está documentado; la instalación y sus certificados no fueron inspeccionados. | No se afirma una captura de tráfico en texto plano ni un despliegue inseguro observado. |
| U1-REV-06 | ¿El procedimiento Docker demuestra una ejecución integrada o un Smoke Test ya aprobado? [Docker beta, Verificaciones de preparación](docker-beta-test.md). | **Ejecución pendiente de acreditar.** El registro acredita preparación estática y declara que no se iniciaron contenedores durante esa preparación. | Los ensayos históricos con HTTP/MariaDB de otro entorno no acreditan esta instalación beta. Un Smoke Test deberá tener su propia ejecución identificada. |

Resultado global: seis comprobaciones de inspección; una conforme en su alcance estático, dos carencias de especificación confirmadas y tres comprobaciones de entorno o ejecución pendientes de acreditar. Son categorías de esta revisión, no seis pruebas funcionales ejecutadas ni una tasa de calidad del software.

Las dos carencias ya estaban reconocidas en el README. Este registro las organiza como hallazgos de QC documental; no las presenta como dos bugs nuevos descubiertos en ejecución.

## 4. Hallazgos y tratamiento

### H-U1-01 — Alcance de permisos por servicio pendiente

- **Tipo:** carencia de especificación preexistente.
- **Evidencia:** el README deja pendiente la matriz y el alcance por servicio; la API describe permisos generales y aclara que no autoriza mediante asociación por servicio.
- **Consecuencia para QC:** los permisos técnicos definidos pueden comprobarse contra su contrato actual. La adecuación de esos permisos a la necesidad clínica por servicio requiere una regla acordada antes de emitir una conclusión.
- **Estado:** abierto como pendiente de definición, sin asignar severidad de un incidente clínico no observado.
- **Acción siguiente:** registrar la pregunta de requisitos en la Unidad 2 y obtener la decisión del responsable funcional y, para una validación institucional, del referente hospitalario competente. Vincular luego los casos afectados.
- **Cierre verificable:** regla de alcance documentada con su fuente y criterios observables; la implementación y sus pruebas se evaluarán por separado.

### H-U1-02 — Política institucional de contraseñas pendiente

- **Tipo:** carencia de especificación preexistente.
- **Evidencia:** el README identifica el mínimo del bootstrap como técnico y provisional.
- **Consecuencia para QC:** se pueden comprobar los contratos técnicos vigentes; no se puede afirmar conformidad con una política institucional que no está definida.
- **Estado:** abierto como pendiente de definición.
- **Acción siguiente:** registrar la política como decisión pendiente en la Unidad 2. Distinguir creación, restablecimiento e ingreso, sin trasladar automáticamente una regla de una operación a otra.
- **Cierre verificable:** política aprobada por quien corresponda, con alcance explícito y criterios comprobables. No se modifica el comportamiento en esta actividad.

## 5. PHVA aplicado a esta actividad

| Etapa | Acción y estado real |
| --- | --- |
| Planificar | **Realizado:** delimitar una inspección de autenticación y evidencia de preparación; identificar fuentes y preguntas de control. |
| Hacer | **Realizado:** leer y comparar las fuentes del apartado 3, incluyendo el servicio de autenticación. |
| Verificar | **Realizado:** registrar las coincidencias, dos carencias ya documentadas y los límites de las comprobaciones históricas. |
| Actuar | **Realizado para el registro:** incorporar los resultados y enlazarlos con la hoja de ruta. **Pendiente para el producto:** resolver las definiciones con el responsable funcional y comprobar el comportamiento en los ciclos posteriores. |

La evidencia permite afirmar que se realizó una inspección y se actualizaron sus registros. No permite afirmar que las carencias funcionales quedaron resueltas o que la aceptación manual se completó.

## 6. Registro inicial de esfuerzo y costo de calidad

La clasificación sigue la taxonomía de la Unidad 1. El esfuerzo no se midió durante estas actividades: se registra como **no medido**, no como cero. Se podrán incorporar tiempos reales de actividades siguientes cuando se registren al realizarlas.

| Actividad | Categoría | Estado y fuente | Esfuerzo/importes |
| --- | --- | --- | --- |
| Inspección documentada U1-QC-001. | Evaluación. | Realizada en esta fecha; apartado 3. | No medidos. |
| Retiro del bloqueo y regresiones técnicas del acceso. | Retrabajo por falla interna, anterior a la aceptación hospitalaria pendiente. | Antecedente documentado el 30/10/2026 en [QC de inicio de sesión](qc-login-sin-bloqueo.md); no se repitió ahora. | Históricos no medidos en este registro. |
| Ejecución manual del acceso en el entorno seleccionado. | Evaluación. | Pendiente; deberá registrar versión, resultado y evidencia. | Pendientes de registrar al realizarla. |
| Revisión anticipada de criterios para cambios futuros. | Prevención. | Actividad futura de mejora del proceso; no se contabiliza como QA realizado desde el origen. | Pendientes de registrar si se realiza. |

No hay evidencia aportada de pérdidas hospitalarias, incidentes productivos o costos externos atribuibles a estos hallazgos. Eso no demuestra que su costo sea cero: significa que no puede cuantificarse aquí.

## 7. Continuación práctica y revisión manual

El usuario puede revisar este diagnóstico abriendo las fuentes enlazadas y contrastando cada conclusión con el apartado señalado. Si aporta evidencia adicional de una definición o ejecución, se actualizará el resultado conservando la fecha y el motivo del cambio.

El primer comportamiento seleccionado para comprobación manual será el acceso válido después de errores de contraseña, ya descrito en [QC de inicio de sesión, Comprobación manual pendiente](qc-login-sin-bloqueo.md). Antes de ejecutarlo se identificarán la versión y el entorno de QC, dos cuentas sintéticas activas y sus precondiciones. No se solicitan contraseñas en el chat.

Las instrucciones existentes se reutilizarán y se vincularán con los casos del banco en las unidades siguientes. El registro de esa ejecución incluirá fecha, entorno, caso/versión, resultado observado y evidencia sin secretos. La condición de dos puestos con una IP compartida tendrá su comprobación específica cuando exista ese entorno.

El control de requisitos y Gherkin se desarrollará en la Unidad 2, el plan operativo en la Unidad 3, la revisión sistemática de casos en la Unidad 4 y su ejecución/seguimiento en la Unidad 5. Esta inspección inicial es una actividad ya realizada y reutilizable, sin adelantar resultados de esas etapas.

## 8. Identificación de las fuentes revisadas

Huellas SHA-256 de los archivos leídos. Permiten detectar si una fuente cambió después de esta inspección; no son pruebas del funcionamiento de la aplicación ni firmas de aprobación institucional.

| Archivo | SHA-256 |
| --- | --- |
| `README.md` | `4cc30f05298c8122ffc65c3be750bd2314f33c217c7aba341ebfe6e37a1076b3` |
| `docs/api-rest-hcv.md` | `ea24ea0d78d0fa4c1bb38b42e1dee1140de2eef3eead8ba92470b67198bb0666` |
| `docs/openapi-hcv.yaml` | `82e9c87c0e5b2204895a21f9acd862eb955ee3ff434bf28795ac43a373ec4344` |
| `src/services/auth-service.js` | `94a900f65587438770ceaf22fa1c6ac9ca66678925f46a815d156de8e333329c` |
| `docs/qc-login-sin-bloqueo.md` | `8f78dd9ae07e50e1a8ec804cdf53e15c618975763c564260ff72bf1486476405` |
| `docs/docker-beta-test.md` | `143c10766a247943709c97e9e94acb1ddbfe7dce3e114c4129a7c943239cb501` |
| `docs/revision-general-hcv-2026-10-26.md` | `a5da29bf8ed63be04be4b7ae71a2ae117d326630ddc8b59f4cfeccd47009f65f` |
| `test/browser/users-ui.py` | `543f7a8c032c6b16bf1adec3eb9325cebc7c0549fc79b1fec47b5d7f1b8c0423` |

La [revisión histórica del 26/10](revision-general-hcv-2026-10-26.md) y la [prueba de UI de usuarios](../test/browser/users-ui.py) se consultaron para distinguir comprobaciones reales anteriores y comprobaciones con respuestas sintéticas. No se reejecutaron.

Bibliografía aplicada: `unidad1 (2).html`, aportada por el usuario, especialmente apartados 2.1–2.2, 3.1, KISS y PHVA. Se utiliza como material de estudio; este diagnóstico no acredita certificación ISO ni un nivel de madurez CMMI.
