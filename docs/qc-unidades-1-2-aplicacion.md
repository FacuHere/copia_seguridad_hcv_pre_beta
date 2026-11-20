# QC aplicado a las unidades 1 y 2

Fecha: 16 de noviembre de 2026. Alcance: autenticación y sesiones de HCV, ciclo QC-U3-001.

Este registro completa el análisis que puede realizarse con las fuentes y evidencias disponibles. Incluye el ciclo PHVA del defecto observado, costos e indicadores de calidad, revisión de requisitos, criterios observables, evaluación INVEST y condiciones de preparación y finalización del trabajo. Las decisiones institucionales y los resultados manuales contradictorios se conservan pendientes; no se inventa su aprobación.

Fuentes: unidades 1 y 2 de la bibliografía aportada; [catálogo](requisitos-hcv.md), [RTM](matriz-trazabilidad-hcv.md), [contrato API](api-rest-hcv.md), documentos Word de casos de uso y pruebas, [registro del login](qc-login-sin-bloqueo.md) y reportes de Behave. La extracción acotada y las huellas de los Word se conservan en [fuentes documentales](../reports/qc/unidades-1-2/fuentes-documentales.json). Los documentos Word originales no fueron modificados por esta actividad.

## 1. Unidad 1 ciclo PHVA del defecto de acceso

Registro U1-QC-002. Complementa el [diagnóstico estático U1-QC-001 del 15/11](qc-unidad-1-diagnostico-inicial.md), sin reescribir sus conclusiones históricas.

| Etapa | Actividad efectivamente realizada | Evidencia y límite |
| --- | --- | --- |
| Planificar | Tomar la decisión existente de retirar el bloqueo por errores, vincular RN-001/RF-1.1/HU-01/TC-015 y preparar dos cuentas activas y un navegador aislado. | Requisito y escenario previos a la ejecución; no se atribuye QA sistemático al desarrollo inicial. |
| Hacer | Implementar el escenario con Behave/Playwright; corregir los problemas de selector y espera del guion; ejecutar el caso en Docker beta. | Se conservan los dos reportes de automatización y la ejecución funcional fallida, sin confundir sus causas. |
| Verificar | Observar HTTP 429 y una espera de 899 segundos para la otra cuenta; contrastar la versión desplegada con el código de trabajo. | [TC-015-20261116-150951](../reports/qc/TC-015-20261116-150951.json). El bloqueo estaba en la imagen anterior del contenedor. |
| Actuar | Reconstruir y recrear únicamente la API beta con el código ya actualizado; repetir el mismo criterio y conservar el antes/después. Incorporar registro automático de versión a las futuras ejecuciones. | [Aprobación inicial](../reports/qc/TC-015-20261116-151206.json) y nueva comprobación con el ejecutor documentada en el reporte HTML. |

**Conclusión del ciclo:** se verificó localmente la corrección de TC-015 en la imagen beta actualizada. El ciclo de este defecto queda documentado en ese alcance. La aceptación hospitalaria, la condición de varios puestos con IP compartida y los demás casos no quedan cerrados por esta conclusión.

Lecciones incorporadas: registrar la imagen al inicio y al final; localizar controles dentro del formulario correspondiente; esperar estados observables apropiados al éxito o rechazo; y separar el error de la herramienta del defecto del producto. Son mejoras del proceso adoptadas a partir de este QC, no prácticas que se atribuyan al origen del proyecto.

## 2. Unidad 1 costos de calidad

La clasificación utiliza las cuatro categorías de la Unidad 1. **No medido no significa cero.** No se reconstruyen horas de trabajo humano, importes, porcentajes de presupuesto ni ahorros retrospectivos.

| Actividad | Categoría | Registro disponible |
| --- | --- | --- |
| Inspección de requisitos, fuentes y trazabilidad. | Evaluación. | Diagnóstico inicial y esta revisión documental; esfuerzo humano no medido. |
| Primeras ejecuciones de Behave y detección del bloqueo compartido. | Evaluación. | Duraciones automáticas de pasos en los reportes; no equivalen a horas de una persona. |
| Corregir selectores y esperas del guion de pruebas. | Falla interna de la herramienta de QC. | Dos problemas de automatización identificados; tiempo de corrección no medido. |
| Actualizar la API beta que conservaba el bloqueo retirado. | Falla interna antes de la aceptación productiva. | Imágenes anterior/posterior y registro de intervención; tiempo humano no medido. |
| Repetir TC-015 para verificar la corrección. | Retrabajo/retesting asociado a falla interna. | Reporte posterior a la actualización. No se cuenta de nuevo como costo de evaluación en esta tabla. |
| Incorporar controles de versión y mantenimiento de documentación para los siguientes ciclos. | Prevención, como mejora actual del proceso. | Nuevo ejecutor, criterios DoR/DoD adaptados y generador de reportes; no se presenta como QA histórico. |
| Incidentes o pérdidas en producción. | Fallas externas. | Sin evidencia aportada de un incidente clínico productivo; no se asigna costo cero ni se inventa una pérdida. |

Los [indicadores calculados](../reports/qc/unidades-1-2/indicadores-calidad.json) separan duraciones automáticas, hallazgos y denominadores. El costo económico sigue sin cuantificarse. El multiplicador teórico de reparación de la unidad no se utiliza como una medición de HCV.

## 3. Unidad 1 indicadores observables

| Aspecto | Indicador y denominador | Fuente y resultado | Límite |
| --- | --- | --- | --- |
| Disponibilidad del acceso después de errores | Resultado de TC-015 en una imagen identificada: doce rechazos de contraseña y posterior ingreso de otra cuenta sin bloqueo. | Ejecución anterior fallida; dos verificaciones posteriores aprobadas, incluida la nueva ejecución con imagen estable. | No es porcentaje de uptime, disponibilidad hospitalaria ni prueba de carga. |
| Identidad de sesión | Identidad esperada frente a la devuelta por /api/auth/me y la visible al acceder. | Comprobación incluida en TC-015 aprobado. | No acredita el modelo clínico completo de permisos por servicio. |
| Integridad de la evidencia | Coincidencia del SHA-256 del reporte con su registro de contexto. | El generador rechaza un reporte modificado después de registrar su huella; se verificó con una prueba sintética. | No es una firma institucional ni prueba de integridad de toda la base clínica. |
| Confidencialidad del reporte de exposición | Ausencia de trazas, nombres y valores arbitrarios del JSON en la vista generada. | La herramienta publica rótulos revisados; su prueba sintética de privacidad aprobó. | Los originales se conservan aparte. No se declara un pentest ni cumplimiento normativo. |
| Cobertura de automatización del ciclo | TC con evidencia Behave aprobada / TC seleccionados = 1/6, 16,67 %. | TC-015 frente a TC-006, 007, 014, 015, 017 y 018. | No es cobertura de código, de requisitos completos ni del banco de 185 casos. |
| Consistencia documental manual | Registros con Pass/PASS y resultado No ejecutado. | Diez registros confirmados: TC-006 a TC-015. | Es un hallazgo documental; no permite decidir si el autor ejecutó esas pruebas. |

La palabra “inmediatamente” del requisito de acceso se concreta como ausencia de bloqueo, enfriamiento o espera impuesta por fallos anteriores. No se inventa un SLA de milisegundos. Las esperas técnicas de Playwright no son objetivos de rendimiento del hospital.

## 4. Unidad 2 revisión formal del alcance seleccionado

Registro U2-QC-001. Método: contraste documental de RF-1.1, RF-1.2 y RF-1.3 con HU-01, HU-02 y HU-03, API y resultados esperados del Word. Se revisan claridad, consistencia, verificabilidad, origen y límites. Es QC estático del producto documental; no se presenta como inspección formal Fagan ni aprobación del hospital.

| Requisito | Resultado de la revisión | Aclaración aplicada al trabajo |
| --- | --- | --- |
| RF-1.1 Iniciar sesión | Verificable en su alcance técnico: cuenta activa, credenciales, respuesta de ingreso y ausencia de bloqueo. | “Inmediato” no se convierte en tiempo numérico. La política institucional de contraseñas no se deduce del mínimo técnico del bootstrap. |
| RF-1.2 Consultar y restaurar sesión | Verificable mediante identidad, recarga y conservación/ausencia de sesión. | Comprobar una recarga no acredita expiración a ocho horas ni toda la matriz de permisos; esos aspectos tienen otros casos. |
| RF-1.3 Cerrar sesión | Verificable mediante invalidación de la sesión actual, cookie y retorno al ingreso, conservando otra sesión. | El éxito de logout y sus fallos 503 se distinguen. TC-018 conserva su requisito de Chrome/Edge y consulta autorizada de un paciente sintético. |

Hallazgos de consistencia:

- **Actores de HU-01:** el Word enumera visualizador, administrador y system_admin; el modelo actual también contempla otros perfiles generales. Esa enumeración no se utiliza para inventar una prohibición de login. El criterio técnico revisado es cuenta activa con credenciales válidas; las acciones posteriores dependen de permisos existentes. La lista del Word se conserva como fuente y su actualización editorial queda identificada.
- **HU rotuladas “Completa”:** la etiqueta del documento no acredita INVEST completo, estimación, criterios de rendimiento, aprobación institucional ni ejecución de todos los casos.
- **TC-017 y TC-018:** los pasos fuente requieren Chrome y Edge, la misma cuenta M y consulta de un paciente. Dos contextos de Chromium comprueban parte del aislamiento, pero no cubren por sí solos todo ese procedimiento. Se corrigió la arquitectura prevista para conservar esa distinción.
- **Precondición de consulta:** usar un paciente sintético y una cuenta con el permiso de lectura ya exigido por la API. Esta revisión no concede permisos, crea pacientes ni define el alcance clínico por servicio.

## 5. Unidad 2 criterios de aceptación del ciclo

Los criterios siguientes se derivan de las fuentes vigentes; no agregan reglas clínicas. Son especificaciones revisadas. Solo TC-015 tiene implementación Behave ejecutada; los bloques de los otros casos no se incorporan a features/ como si ya estuvieran automatizados.

### TC-006 acceso y recarga

RF-1.1 + RF-1.2; HU-01 + HU-02.

~~~gherkin
Given que una cuenta de prueba está activa y no hay sesión en el navegador
When ingreso con sus credenciales válidas y recargo la aplicación
Then la aplicación muestra la identidad de esa cuenta
And conserva su sesión después de recargar
~~~

No basta recibir HTTP 200: debe comprobarse el comportamiento de la interfaz después de la recarga.

### TC-007 contraseña incorrecta

RF-1.1; HU-01.

~~~gherkin
Given que una cuenta de prueba está activa y no hay sesión en el navegador
When intento ingresar con una contraseña incorrecta
Then se muestra el mensaje genérico de usuario o contraseña incorrectos
And la aplicación permanece sin acceso autenticado
And el campo de contraseña queda vacío
~~~

Una prueba solo de API cubre parte del criterio; el mensaje visible y el campo vacío requieren la interfaz.

### TC-014 acceso de la propia cuenta tras errores

RF-1.1; HU-01.

~~~gherkin
Given que una cuenta de prueba activa realizó doce intentos con contraseña incorrecta
When intento ingresar con la contraseña correcta de esa misma cuenta
Then puedo acceder con la identidad esperada
And no se exige un bloqueo temporal ni una espera por los errores anteriores
~~~

El contrato vigente también exige que los fallos con formato válido se rechacen por credenciales, sin respuesta de limitación por ese contador. No se provoca una desactivación de cuenta ni se cambia su contraseña para preparar este caso.

### TC-015 acceso de otra cuenta tras errores

RF-1.1; HU-01. Especificación ejecutable canónica: [autenticacion.feature](../features/autenticacion.feature). Se conserva ese archivo como fuente, evitando duplicar un segundo escenario ejecutable del mismo caso.

Las precondiciones verifican dos cuentas distintas y activas. La acción es ingresar con A después de doce intentos incorrectos de M en el mismo navegador; el resultado comprueba identidad, acceso y ausencia de espera. Los reportes de imágenes distintas se mantienen separados.

### TC-017 dos sesiones independientes

RF-1.2; HU-02.

~~~gherkin
Given que M es una cuenta de prueba activa con consulta autorizada de un paciente sintético
And que Chrome y Edge están disponibles en las versiones registradas
When inicio sesión con M en ambos navegadores y recargo cada uno
Then ambos conservan acceso con la identidad de M
And permiten consultar el paciente sintético previsto
~~~

No dependerá de que TC-006 haya corrido antes: prepara sus propias sesiones.

### TC-018 cierre selectivo de una sesión

RF-1.3; HU-03.

~~~gherkin
Given que M tiene sesiones independientes en Chrome y Edge
And que puede consultar un paciente sintético previsto para la prueba
When cierro la sesión en Chrome y recargo Chrome
Then Chrome solicita iniciar sesión
And Edge conserva la sesión de M y permite la consulta autorizada
~~~

No se confunde el cierre de una sesión con un cambio de contraseña o desactivación que pueda revocar todas.

## 6. Unidad 2 revisión INVEST

Los documentos identifican HU pero están redactados principalmente como casos de uso. Se aplica INVEST como diagnóstico de las tres fichas, sin afirmar que el formato ya sea una historia ágil completa.

| Criterio | HU-01 iniciar | HU-02 consultar/restaurar | HU-03 cerrar | Evidencia y tratamiento |
| --- | --- | --- | --- | --- |
| Independiente | Parcial | Parcial | Parcial | Consultar y cerrar requieren una sesión originada por otro flujo. Preparar fixtures independientes hace repetibles los tests, pero no demuestra independencia de entrega de las historias. |
| Negociable | Parcial | Parcial | Parcial | El valor está identificado y la implementación puede evolucionar dentro del contrato. No se acredita una conversación formal de refinamiento ni un acuerdo institucional. |
| Valiosa | Respaldada | Respaldada | Respaldada | Acceso disponible, continuidad de sesión y cierre controlado aportan valor observable al uso del sistema. No se cuantifica un valor económico no medido. |
| Estimable | No acreditada | No acreditada | No acreditada | No hay estimación de equipo o Planning Poker registrada. Se identificaron dependencias técnicas; no se inventan puntos ni horas retrospectivas. |
| Pequeña | Parcial | Parcial | Parcial | Los flujos están delimitados y los TC separan variantes; no hay sprint ni capacidad acordada que acredite su tamaño en una iteración. |
| Testeable | Respaldada en el alcance | Respaldada en el alcance | Respaldada en el alcance | Criterios observables, fuentes e identificadores definidos en esta revisión. Ejecución de un TC no aprueba todas las variantes de su HU. |

La revisión está realizada; **INVEST no se declara aprobado al 100 %**. La estimación y los acuerdos colectivos requieren participación real del equipo. No son requisitos clínicos que el asistente deba decidir.

## 7. Unidad 2 DoR y DoD adaptados

La bibliografía define DoR para admitir una historia y DoD como acuerdo de calidad del incremento. Aquí se establecen condiciones operativas para el trabajo de QC. Son una adaptación local formulada ahora; no se afirma que fueran un control obligatorio aplicado desde el desarrollo inicial ni que representen un acuerdo de entrega del hospital.

### Definition of Ready del trabajo de QC

Antes de implementar o ejecutar un caso:

- Identificar RN/RF/HU/TC y su fuente.
- Contar con un resultado observable; registrar dudas y excluir reglas sin definición.
- Identificar dependencias, datos de prueba y efectos de la operación.
- Determinar qué componentes serán reales y cuáles estarán sustituidos.
- Antes de una ejecución de sistema, confirmar el entorno beta, su salud y su imagen.
- Disponer de cuentas y datos de prueba necesarios; no incluir contraseñas en código o reportes de exposición.
- Conocer los navegadores exigidos y preparar el caso sin depender de un TC anterior.

**Aplicación actual:** TC-015 tiene fuentes, implementación y evidencia. La nueva ejecución registró una imagen saludable y estable. Los demás cinco casos tienen criterios revisados; no se declaran listos para ejecutar hasta implementar sus pasos y confirmar sus datos/navegadores.

### Definition of Done del trabajo de QC

Para cerrar una actividad de evaluación:

- Registrar qué se evaluó, en qué versión, modalidad y entorno.
- Conservar resultado y evidencia, incluidos fallos u omisiones.
- Distinguir defecto de producto, automatización, entorno y falta de especificación.
- Actualizar la trazabilidad y los pendientes; proteger los originales.
- Si se corrigió algo, identificar la intervención y verificar el mismo criterio después.
- Regenerar la vista legible y verificar que sus enlaces y estados coincidan con las fuentes.

Una evaluación puede estar terminada con un defecto abierto. Para declarar un caso aprobado se exige evidencia conforme al criterio en una versión identificada. Para declarar un incremento listo para entrega se requiere un acuerdo de DoD de producto y aceptación que esta lista académica no reemplaza.

## 8. Unidad 2 tratamiento de los registros manuales

Se verificaron en el Word actual **diez contradicciones**: TC-006–015 tienen Pass/PASS y resultado textual No ejecutado. El [registro de conciliación](../reports/qc/unidades-1-2/conciliacion-manual.json) conserva ambos valores y la huella de la fuente.

Tratamiento aplicado: resultado manual **no acreditado con esos campos; por conciliar**. No se interpreta como prueba fallida ni como confirmación de que nadie la ejecutó. No se cambian los campos del autor. El resultado de Behave para TC-015 se enlaza en modalidad automática separada.

Para resolver el resultado manual se necesita confirmación del autor o evidencia de la ejecución, versión y entorno. Este dato no puede deducirse por código ni por una nueva ejecución automática.

## 9. Unidad 2 justificación de las seis brechas de RTM

El alcance académico actual selecciona autenticación y sesiones. Los seis RF sin un TC manual específico quedan justificados fuera de ese ciclo; **no se declara eliminada su brecha ni aprobada su función**.

| RF y HU | Situación y fundamento | Tratamiento registrado |
| --- | --- | --- |
| RF-3.3 / HU-12 consultar estudio | Hay contrato de GET /api/estudios/{id}; no hay un TC manual dedicado que demuestre por sí solo la consulta completa. | Diseñar después un caso de consulta y sus permisos conforme al contrato, sin inventar reglas clínicas. |
| RF-4.1 / HU-18 listar documentos | Otros casos requieren ver archivos, pero eso no acredita un caso explícito de listado. | Mantener cobertura indirecta como contexto; no convertir una precondición en ejecución aprobada. |
| RF-4.6 / HU-23 recuperar journal | Existen tests técnicos de recuperación y filesystem con dobles, clasificados en U3. | Vincularlos como evidencia técnica de alcance limitado, distinta de un TC manual y de una recuperación SQL real. |
| RF-5.1 / HU-25 bootstrap inicial | CLI administrativa con precondiciones y alteración de cuentas; no es un flujo ordinario de navegador. | Fuera del ciclo de acceso; no ejecutar el inicializador sobre una instalación existente para cerrar una celda de RTM. |
| RF-5.2 / HU-26 restablecimiento local | CLI distinta del cambio web de contraseña; revoca sesiones y modifica cuentas. | Diseñar un ensayo aislado específico antes de alterar credenciales. No reutilizar un caso web como equivalencia automática. |
| RF-7.1 / HU-24 salud técnica | Hay endpoints y healthchecks; la salud del entorno fue comprobada al ejecutar TC-015. | Registrar control operativo y pruebas técnicas existentes; no inventar un TC manual dedicado ni una cobertura total. |

El catálogo y la RTM conservan los vínculos originales. Para estos RF la decisión actual es de alcance del ciclo, no de eliminación del requisito.

## 10. Unidad 2 mantenimiento de la documentación viva

Se implementó una rutina local, sin nuevas dependencias:

~~~powershell
.\.venv-qc\Scripts\python.exe scripts/qc/ejecutar_behave.py
~~~

El comando comprueba la imagen saludable del Docker beta, ejecuta Behave, guarda un JSON con identificador único, vuelve a consultar la imagen y registra las huellas de las pruebas y el reporte. Después regenera automáticamente la [vista HTML de evidencias](../reports/qc/documentacion-viva/index.html). Las credenciales siguen solicitándose de forma oculta o llegan por las variables de proceso existentes; no se guardan en el ejecutor.

Para reconstruir solamente la vista, sin Docker ni ejecutar pruebas:

~~~powershell
.\.venv-qc\Scripts\python.exe scripts/qc/ejecutar_behave.py --solo-reportes
~~~

Frecuencia operativa: repetir el caso cuando cambie su requisito, su implementación, sus pasos o la imagen a evaluar, y antes de utilizar esa evidencia para una conclusión del trabajo. Cada ejecución mediante este comando actualiza la vista. Regenerar solo el HTML no es volver a validar el sistema.

El registro está en [registro-ejecuciones-behave.json](qc/registro-ejecuciones-behave.json). Los reportes originales permanecen intactos. Una huella distinta impide regenerar como si el original no hubiera cambiado. Un cambio de imagen durante el caso impide aceptar su contexto, aunque Behave termine aprobado.

La vista muestra identificadores, rótulos revisados, estados, pasos, contexto y notas. No copia trazas completas, nombres ni valores arbitrarios del reporte. Al verificar esta actividad se registraron cinco ejecuciones de un único TC, con dos aprobaciones; eso no es cinco casos ni una tasa de calidad de 40 %.

**Comprobación realizada:** la nueva ejecución QC-20261116-160706-645857 aprobó los seis pasos en la imagen beta registrada al inicio y final. El HTML se revisó en pantalla amplia y pequeña, con sus pasos desplegables. Las doce pruebas de las herramientas de QC aprobaron; son pruebas de los reportes/ejecutor, no nuevas unitarias del backend HCV.

~~~powershell
.\.venv-qc\Scripts\python.exe -m unittest discover -s scripts/qc/pruebas -v
~~~

[Evidencia de las doce pruebas](../reports/qc/unidades-1-2/herramientas-qc-20261116.txt). La primera ejecución de estas pruebas encontró una restricción de acceso a temporales del entorno del asistente; se repitió con acceso permitido y aprobó, sin modificar HCV ni MariaDB.

No se configuró un pipeline remoto ni una tarea programada. El mantenimiento automático está implementado por ejecución local; la integración CI depende de disponer de un entorno y secretos de pruebas adecuados fuera de este equipo.

## 11. Pendientes que esta actividad no cierra

- Confirmación de los resultados manuales contradictorios.
- Definiciones institucionales de alcance por servicio y política de contraseñas.
- Aprobación hospitalaria/UAT, HTTPS y pruebas en la red real.
- Acuerdos colectivos de estimación, capacidad de sprint y DoD de entrega.
- Costos monetarios y esfuerzo humano histórico, que no fueron medidos.

El siguiente incremento técnico puede implementar los otros cinco TC a partir de los criterios ya revisados, preparando sus datos y navegadores. Su ejecución no se atribuye a esta revisión de las unidades 1 y 2. La revisión documental, la justificación de brechas y el mantenimiento local ya cuentan con artefactos verificables; las confirmaciones anteriores no se rellenan con supuestos.
