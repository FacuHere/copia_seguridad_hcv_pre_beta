# Plan del trabajo final de QC aplicado a HCV

Fecha de elaboración: 15 de noviembre de 2026.

Estado actualizado el 16/11/2026: diagnóstico inicial de la Unidad 1 y catálogo/RTM de la Unidad 2 disponibles; piloto Behave TC-015 ejecutado, con fallo y aprobación conservados; clasificación y arquitectura de la Unidad 3 organizadas en un [registro específico](qc-unidad-3-arquitectura-pruebas.md). La aceptación hospitalaria sigue pendiente. Los borradores y antecedentes fechados se distinguen de los resultados nuevos enlazados.

**Cierre parcial posterior de U1/U2:** [PHVA, indicadores, costos, revisión de requisitos, criterios de aceptación, INVEST, DoR/DoD y tratamiento de brechas](qc-unidades-1-2-aplicacion.md) documentados. Se implementó el mantenimiento local de la documentación viva con registro de versión y [vista HTML](../reports/qc/documentacion-viva/index.html), se verificó el ejecutor contra Docker beta y aprobaron doce comprobaciones de las herramientas. Los diez resultados manuales contradictorios y los acuerdos institucionales siguen pendientes de confirmación real.

**Avance de U4:** [EP, BVA y BAOE](qc-unidad-4-diseno-pruebas.md) documentados para un alcance seleccionado de siete campos. Se relacionaron 23 de 30 puntos de frontera con casos existentes, se identificaron siete sin caso dedicado y se prepararon cuatro fichas BAOE y datos sintéticos. La ejecución de este alcance permanece pendiente.

**Avance de U5:** [Smoke Test y gestión de hallazgos](qc-unidad-5-ejecucion-defectos.md) documentados. El smoke acotado de acceso/consulta aprobó diez controles en Docker beta, con imágenes y contenedores estables. Se clasificaron 24 registros de producto, automatización, entorno, documentos y diseño, conservando fechas, contexto y límites; no son 24 defectos abiertos. Las prioridades son propuestas académicas, sin atribuir un triage hospitalario.

## 1. Propósito y criterio de trabajo

La consigna informada es aplicar el análisis de QC de las cinco unidades a un sistema. No se indicó una cantidad mínima de pruebas, una extensión obligatoria ni una exigencia de automatización.

Se propone desarrollar un estudio de caso sobre **Historial Clínico Visual (HCV)**. El objetivo es aplicar un proceso de control de calidad a un conjunto delimitado de comportamientos del sistema: revisar su especificación, identificar riesgos, diseñar pruebas justificadas, registrar las ejecuciones reales y evaluar los resultados y sus límites.

El enfoque será la **evaluación de un producto existente mediante QC**. La historia del desarrollo se utilizará como contexto y fuente de limitaciones; no se reconstruirá como si se hubiera seguido desde el inicio una metodología de QA o Shift-Left que no puede acreditarse. Las recomendaciones para prevenir problemas futuros se distinguirán de las actividades efectivamente realizadas.

Cada unidad producirá un apartado del informe y un artefacto práctico. El informe se construirá durante el trabajo, conservando la diferencia entre lo planificado, lo ejecutado y lo pendiente. La defensa deberá permitir explicar por qué se eligió cada prueba y qué evidencia permite sostener cada conclusión.

El usuario realizará las pruebas manuales. La asistencia incluye análisis, diseño, explicación, documentación y revisión de evidencia. El 16/11/2026 se autorizó además corregir y ejecutar la automatización del piloto; sus resultados se registran por separado. Planificar otro caso no equivale a haberlo ejecutado ni autoriza migraciones o cambios sobre datos clínicos reales.

## 2. Sistema y antecedentes disponibles

HCV es una aplicación web destinada a gestionar pacientes, estudios y documentos clínicos. La implementación actual utiliza Node.js, Express, MariaDB y un frontend de HTML, CSS y JavaScript. Se conserva esta arquitectura. Python se considerará para herramientas de pruebas, sin convertir ese aprendizaje en una migración de la aplicación.

El [README](../README.md) distingue funciones implementadas, requisitos pendientes de definición y condiciones pendientes para producción. Esa distinción debe mantenerse en el trabajo académico: un comportamiento observado en el código no reemplaza una regla de negocio acordada.

| Recurso existente | Uso previsto en el trabajo |
| --- | --- |
| [Casos de uso HCV](Casos%20de%20uso%20HCV.docx) | Identificar actores, flujos y requisitos; revisar ambigüedades. |
| [API REST](api-rest-hcv.md) y [OpenAPI](openapi-hcv.yaml) | Consultar contratos técnicos y contrastarlos con los flujos de usuario. |
| [Plan de pruebas manuales QC HCV](Plan%20de%20pruebas%20manuales%20QC%20HCV.docx) | Revisar y seleccionar casos del banco existente, conservando la plantilla y sus identificadores. |
| [QC del inicio de sesión sin bloqueo](qc-login-sin-bloqueo.md) | Recuperar la decisión funcional, las verificaciones históricas y la aceptación manual pendiente. |
| [Entorno beta con Docker](docker-beta-test.md) | Instalación separada utilizada para TC-015; registrar imagen y preparar datos sintéticos antes de ampliar casos que alteren información. |
| [Catálogo de requisitos](requisitos-hcv.md) | Consultar los identificadores RN, RF y RNF, sus fuentes y las definiciones pendientes, conservando las HU existentes. |
| [Matriz de trazabilidad](matriz-trazabilidad-hcv.md) | Recorrer en ambos sentidos los vínculos con los 185 TC y los componentes; mantener separados procedencia, automatización y ejecución. |
| [Arquitectura de la Unidad 3](qc-unidad-3-arquitectura-pruebas.md) e [inventario de niveles](inventario-niveles-pruebas-hcv.json) | Clasificar pruebas reales, diferenciar dobles/SQL real y organizar criterios, entorno, riesgos y ejemplos para la exposición. |
| [Aplicación de las unidades 1 y 2](qc-unidades-1-2-aplicacion.md) | Consultar PHVA, indicadores, costos, revisión de requisitos, criterios, INVEST, DoR/DoD, conciliación y mantenimiento de evidencia. |
| [Diseño de la Unidad 4](qc-unidad-4-diseno-pruebas.md) | Consultar clases EP, fronteras BVA, fichas BAOE, datos sintéticos y brechas; distinguir diseño de ejecución y controles de interfaz/API. |
| [Aplicación de la Unidad 5](qc-unidad-5-ejecucion-defectos.md) y [clasificación de hallazgos](qc-unidad-5-hallazgos.md) | Consultar smoke ejecutado, evidencia por versión, severidad/prioridad justificadas, reporte de defecto y límites de cierre. |

Cada TC conserva su vínculo funcional y los resultados de ejecución aportados. La fecha, versión y entorno de una ejecución se registran por separado: un resultado previo no elimina la relación con el requisito ni demuestra por sí solo el estado de otra instalación. La inclusión de un caso en el banco no acredita su ejecución.

### Diagnóstico de partida y afirmaciones que pueden sostenerse

La evidencia disponible muestra controles técnicos, revisiones y pruebas incorporados durante el desarrollo. No demuestra un proceso sistemático de calidad desde la definición inicial de requisitos. El README mantiene pendientes reglas de permisos por servicio, DNI y duplicados, retención, validaciones clínicas y otros criterios. La arquitectura por capas y la existencia de pruebas no acreditan por sí solas Shift-Left ni una definición temprana de criterios de aceptación.

El defecto histórico del bloqueo de acceso permite analizar una diferencia entre una decisión técnica y el contexto de uso hospitalario. Su detección y la decisión posterior de retirar el bloqueo constituyen un antecedente de evaluación y corrección; no prueban que ese riesgo se hubiera prevenido antes de implementar la función.

| Afirmación | Estado respaldado por los artefactos revisados |
| --- | --- |
| QA y Shift-Left aplicados sistemáticamente desde el inicio. | No acreditados. Hay prácticas puntuales y decisiones pendientes; no corresponde atribuir retrospectivamente un proceso integral. |
| Behave con documentación viva ejecutable. | Piloto TC-015 implementado y ejecutado el 16/11/2026: defecto de bloqueo reproducido y posterior aprobación en otra imagen. Se conservan ambos reportes. Automatización periódica y CI pendientes. |
| Pruebas con Node.js, MariaDB y Playwright. | Existen pruebas y registros históricos. La [revisión del 26/10](revision-general-hcv-2026-10-26.md) documenta comprobaciones reales; la [prueba de UI de usuarios](../test/browser/users-ui.py) usa respuestas sintéticas. Sus alcances son distintos. |
| Pirámide de pruebas e integración ejecutada mediante Docker Compose. | Suite clasificada en la Unidad 3. TC-015 acredita una ejecución de sistema con Express/MariaDB reales en Docker beta. No se midió la distribución de la pirámide ni se acreditan todas las integraciones o criterios de salida. |
| EP, BVA y BAOE aplicados sistemáticamente a todo el banco. | Revisión acotada documentada en la [Unidad 4](qc-unidad-4-diseno-pruebas.md): clases EP, 30 puntos BVA en siete campos, 23 vinculados a TC existentes y siete sin caso dedicado; cuatro fichas BAOE. No acredita revisión de todo el banco ni ejecución de esos límites. |
| Smoke Test formal por versión en Docker. | Implementado y ejecutado en U5: diez controles de acceso/consulta aprobados en la imagen beta registrada. No representa archivos/restauraciones ni se atribuye a ejecuciones históricas anteriores. |

La Unidad 1, apartado 2.2, advierte contra esperar que un QC intensivo compense procesos deficientes. Aquí se aplicará QC para identificar discrepancias y aportar evidencia sobre el estado actual. La falta de un resultado esperado acordado se registrará como una deficiencia de especificación; no se decidirá un aprobado o fallido funcional inventando la regla ni tomando automáticamente el comportamiento actual como correcto.

La amplificación de costos de hasta 1.000× aparece en el material como fundamento teórico. No se ha medido ese multiplicador ni un ahorro equivalente en HCV. El informe podrá analizar retrabajo y esfuerzo observado, sin atribuir cifras ni pérdidas hospitalarias no documentadas.

## 3. Recorrido por las unidades

| Unidad y fundamento | Aplicación a HCV | Entregable | Condición para avanzar |
| --- | --- | --- | --- |
| **1. Gestión de calidad:** QA/QC, costo de calidad, PHVA y simplicidad. | Describir el sistema y el problema de calidad; diagnosticar las limitaciones del proceso previo; distinguir prevención, evaluación y corrección; identificar atributos prioritarios. | Presentación del caso, diagnóstico inicial, objetivo, alcance preliminar y distinción entre actividades realizadas y propuestas. | El objeto de evaluación y sus límites se entienden sin asumir reglas clínicas pendientes ni atribuir un QA temprano no acreditado. |
| **2. Requisitos y trazabilidad:** requisitos funcionales y no funcionales, historias, INVEST, Gherkin, documentación viva, RTM y DoR/DoD. | Revisar requisitos seleccionados, registrar dudas, acordar criterios observables y redactar escenarios en español. | Requisitos revisados, escenarios Gherkin, matriz requisito–caso–ejecución–defecto y acuerdos de preparación/finalización adaptados. | Cada caso seleccionado tiene un resultado esperado respaldado por una fuente identificable. |
| **3. Planificación:** plan maestro, niveles de pruebas y priorización por riesgos. | Precisar alcance, entorno, datos sintéticos, responsables, recursos y criterios de entrada/salida; ordenar riesgos por impacto y probabilidad estimados con justificación. | Plan de pruebas del ciclo y registro de riesgos. | Se conoce qué se probará, en qué versión y entorno, con qué datos y cómo se informará el cierre. |
| **4. Diseño funcional:** caja negra, particiones de equivalencia, valores límite, BAOE y gestión de casos. | Revisar el banco existente y derivar casos desde requisitos; separar entradas inválidas; aplicar límites únicamente donde estén definidos. | Conjunto de casos revisados, tabla de clases/límites y registro de revisión. | Otra persona puede repetir cada caso y decidir su resultado sin interpretar expresiones vagas. |
| **5. Ejecución y defectos:** estados, evidencias, versiones, smoke/sanity, reportes, severidad/prioridad y seguimiento. | El usuario ejecuta las rondas; se registran resultados y defectos; se verifica cada corrección y se selecciona regresión. | Registro de ejecuciones, evidencias, reportes, métricas e informe de cierre con limitaciones. | Las conclusiones se apoyan en ejecuciones identificadas; los pendientes y defectos abiertos permanecen visibles. |

Las unidades se trabajarán en ese orden. Si el diseño revela un requisito ambiguo, se volverá a la Unidad 2 y se actualizará su trazabilidad, en lugar de inventar una respuesta para completar el caso.

**Práctica actual de la Unidad 2:** el 16/11/2026 se asignaron códigos documentales a 8 necesidades RN, 26 RF y 5 condiciones RNF, relacionándolos con las 26 HU y los 185 TC existentes. El catálogo y la RTM son los índices comunes; los Word de detalle no se renumeraron ni se reescribieron. Los criterios exploratorios y reglas pendientes no se presentan como aprobados institucionalmente. El informe académico incorpora la matriz resumida como primer apartado de desarrollo después de la introducción. La escritura de escenarios y su ejecución con Behave continúa como práctica guiada; no se ejecutaron pruebas al construir estos documentos.

**Avance posterior del 16/11/2026:** TC-015 quedó implementado y ejecutado en Docker beta; los resultados anterior/posterior están en [QC del login](qc-login-sin-bloqueo.md). Para la Unidad 3 se clasificaron 23 artefactos de verificación y tres de soporte, se verificó una selección de 13 unitarias y cuatro comprobaciones mixtas de autenticación, y se organizó el ciclo QC-U3-001 con seis TC. La presentación HTML y su actualización local quedaron implementadas después en esta jornada. Las pruebas Python de API, las integraciones SQL optativas, CI remoto y UAT permanecen pendientes.

**Criterio de trazabilidad de los registros iniciales:** TC-001 a TC-005 se muestran en la columna principal del requisito que comprueban, conservando sus resultados. TC-001 a TC-004 se vinculan al acceso; TC-003 también a la consulta de sesiones; TC-005 a creación de paciente. Para TC-004 se mantiene el vínculo y el Fail registrado, distinguiendo que la expectativa de bloqueo fue retirada. La fecha de una ejecución no clasifica ni excluye un caso de su requisito funcional.

## 4. Alcance propuesto y selección de casos

**Primer ciclo: autenticación y sesiones.** Permite trabajar con una decisión ya documentada: los errores de contraseña no deben generar bloqueos automáticos de cuentas o IP. Se incluirán el acceso válido, rechazo de credenciales incorrectas, ingreso válido después de fallos y cierre de sesión, según los contratos vigentes.

La comprobación con varios equipos que compartan una IP requiere un entorno donde esa condición pueda verificarse. Si no está disponible, ese caso se registrará como pendiente o bloqueado, según corresponda; una prueba en un solo navegador no demuestra su cumplimiento en la red hospitalaria.

**Ampliación posterior:** seleccionar flujos de pacientes y documentos para representar validaciones, persistencia, asociación correcta de información y acceso autorizado. La selección exacta dependerá de requisitos definidos, riesgos y disponibilidad del entorno. No se fija un número arbitrario de pruebas ni se propone automatizar todo el banco.

Las reglas de permisos por servicio, DNI, duplicados, retención y otras decisiones que el README declara pendientes se registrarán como dudas de requisitos. No se inventarán reglas para convertirlas en resultados esperados.

HTTPS se tratará como requisito y riesgo de despliegue documentado. La falta de evidencia de su configuración no equivale a una ejecución fallida ya realizada. Su comprobación práctica requerirá un entorno publicado y una configuración identificada.

Se usarán cuentas, pacientes y documentos sintéticos. Las restauraciones, eliminaciones y demás pruebas que alteren datos deberán planificarse en un entorno separado. Este plan no autoriza migraciones ni cambios sobre una base clínica real.

## 5. Behave y documentación viva

La documentación viva aparece en la **Unidad 2, sección 4.3**. La secuencia aplicada al piloto fue:

1. Escribir y revisar el comportamiento de TC-015 en Gherkin con etiquetas RN/RF/HU/TC y palabras clave en inglés.
2. Implementar sus pasos con **Behave y Playwright para Python**, corregir la automatización y ejecutar el caso en el Docker beta. Se conservaron un fallo funcional y una aprobación después de actualizar únicamente la API. El tratamiento completo de ejecución y defectos se desarrollará en la Unidad 5.

Esta combinación se eligió por el interés del usuario en aprender Python y por el carácter web de HCV. Behave, Playwright y Chromium están instalados en el entorno de QC. Se conservan las pruebas existentes de Node.js; las pruebas de sistema en Python cumplen otra función y no se presentan como UAT hospitalaria.

Behave organiza el escenario y vincula sus pasos con código Python; Playwright realiza las acciones y comprobaciones en el navegador. Los reportes JSON generados por ejecución y el registro del piloto muestran el escenario, pasos, estado, fecha y las imágenes de aplicación probadas. La presentación HTML local ya está implementada y se actualiza al usar `scripts/qc/ejecutar_behave.py`; conserva los estados originales y omite trazas o valores arbitrarios en la vista de exposición.

La cadena de documentación mantenida es:

**Requisito acordado → escenario Gherkin → caso vinculado → ejecución identificada → evidencia o defecto → verificación de la corrección.**

Un archivo Gherkin por sí solo es una especificación estructurada. La parte ejecutable se mantiene viva cuando se ejecuta con regularidad, se publican sus resultados y se revisan conjuntamente requisitos y pasos al cambiar el sistema. La automatización valida las comprobaciones programadas; no garantiza que la especificación sea completa o correcta.

El piloto ya dispone de ejecución local y reportes conservados. La arquitectura de la Unidad 3 organiza su ampliación y la preparación reproducible de más casos. Una integración automática ante cambios puede incorporarse después; no se describe un pipeline como existente mientras no esté configurado. Los controles de infraestructura y las acciones que requieran intervención humana permanecen identificados como verificaciones manuales.

## 6. Criterios proporcionados al alcance académico

- **Simplicidad:** adaptar las prácticas al proyecto; las herramientas empresariales mencionadas en el material no son requisitos de la consigna. El registro inicial puede aprovechar los documentos existentes y una tabla de seguimiento.
- **Riesgos:** justificar impacto y probabilidad con la información disponible. Sin datos económicos, se utilizará una clasificación cualitativa, sin inventar pérdidas ni un valor monetario esperado.
- **Costos de calidad:** clasificar actividades de prevención, evaluación y fallas internas/externas. Si se mide esfuerzo, registrar horas desde el inicio de esta actividad; no reconstruir cifras sin evidencia ni afirmar costos externos que no ocurrieron.
- **Niveles:** distinguir pruebas unitarias, de integración y de sistema. Una comprobación del autor del proyecto no se presentará como aceptación institucional de usuarios clínicos.
- **Severidad y prioridad:** la severidad expresa el impacto del defecto en usuarios, funciones, datos, confidencialidad o disponibilidad; no se limita a fallas técnicas de Node.js o MariaDB. La prioridad expresa la urgencia y el orden de atención según el contexto y los riesgos.
- **Umbrales:** los ejemplos del material, como cobertura del 80 %, no son mediciones actuales de HCV ni exigencias ya acordadas. Los criterios del ciclo se definirán antes de su ejecución.
- **Evidencia:** conservar contexto suficiente para reproducir el problema y retirar contraseñas, cookies, tokens y datos personales. No copiar credenciales por seguir literalmente un ejemplo de reporte.
- **Fuentes:** citar las unidades realmente consultadas. Los libros y estándares citados en ellas se identificarán como referencias de ese material, salvo consulta directa posterior. Las cifras generales del curso no se presentarán como resultados del proyecto.

Los [indicadores iniciales](qc-unidades-1-2-aplicacion.md#3-unidad-1-indicadores-observables) ya registran 1/6 TC del ciclo con Behave aprobado, las diez contradicciones manuales y los resultados por ejecución/versión. Se indica el denominador de cada porcentaje. La ampliación podrá incorporar requisitos verificables seleccionados, estados y defectos clasificados. Ninguna de estas cifras se confunde con cobertura de código o garantía de ausencia de defectos.

## 7. Primera actividad: borrador de la Unidad 1

**Actividad realizada:** [diagnóstico inicial U1-QC-001](qc-unidad-1-diagnostico-inicial.md), del 15/11/2026. Se inspeccionaron documentos y el servicio de autenticación: seis comprobaciones acotadas, con una concordancia estática, dos carencias de especificación preexistentes confirmadas y tres comprobaciones de ejecución/entorno pendientes de acreditar. El registro incluye fuentes, límites, clasificación de esfuerzo y seguimiento PHVA. No se ejecutó la aplicación ni se completó la aceptación manual. Los textos siguientes se conservan como borrador del informe, pendiente de revisión del usuario.

### Título provisional

**Aplicación de un proceso de control de calidad a Historial Clínico Visual: requisitos, pruebas funcionales y gestión de defectos.**

### Presentación del caso

Historial Clínico Visual es una aplicación web en desarrollo para gestionar pacientes, estudios y documentos clínicos en un contexto hospitalario. Ese contexto vuelve relevantes la disponibilidad del acceso, la asociación correcta de la información y la protección de los datos. El proyecto presenta funciones implementadas y decisiones funcionales y de despliegue pendientes, por lo que su evaluación debe explicitar el alcance y las condiciones de cada comprobación.

### Objetivo general

Aplicar los conceptos de las cinco unidades a un conjunto seleccionado de funciones de HCV, desde la revisión de requisitos hasta el diseño y la ejecución documentada de pruebas, para identificar discrepancias, verificar correcciones y explicar el alcance de las conclusiones obtenidas.

### QA y QC en este trabajo

La tabla clasifica actividades que pueden formar parte del trabajo; no afirma que todas se hayan realizado desde el inicio del proyecto. El eje evaluado será QC. QA se tratará como marco para interpretar las carencias observadas y formular mejoras futuras.

| Actividad | Enfoque | Justificación |
| --- | --- | --- |
| Acordar una plantilla, revisar criterios de aceptación y preparar un entorno reproducible. | QA: prevención y mejora del proceso. | Reduce ambigüedades y errores al desarrollar o comprobar cambios. |
| Inspeccionar requisitos y casos para detectar contradicciones concretas. | QC estático del producto documental. | Evalúa la calidad de artefactos sin ejecutar la aplicación. |
| Ejecutar un caso y comparar el comportamiento observado con el esperado. | QC dinámico del software. | Busca evidencia sobre el producto bajo condiciones concretas. |
| Analizar un defecto y actualizar el procedimiento de revisión para prevenir su repetición. | Mejora del proceso apoyada en resultados de QC. | Conecta lo aprendido con la prevención del siguiente ciclo. |

### Atributos prioritarios iniciales

| Atributo | Ejemplo de aplicación a HCV | Estado de la evidencia |
| --- | --- | --- |
| Disponibilidad y confiabilidad | Que fallos de contraseña no impidan posteriormente un acceso válido por el bloqueo retirado. | Decisión documentada; aceptación manual del entorno hospitalario pendiente. |
| Adecuación funcional e integridad | Que una operación conserve y muestre la información del paciente o estudio previsto. | Casos y requisitos concretos por seleccionar y comprobar. |
| Seguridad y confidencialidad | Que el acceso a información y documentos corresponda a los permisos definidos; transporte cifrado al publicar en LAN. | Alcance de permisos y configuración del entorno por revisar; no se afirma validación integral. |

### Ejemplo del ciclo PHVA

- **Planificar:** identificar el problema histórico del bloqueo por IP, la decisión funcional y los escenarios que deben comprobarse.
- **Hacer:** preparar el entorno y ejecutar los casos de acceso con cuentas de prueba, registrando lo observado.
- **Verificar:** contrastar la evidencia con los criterios y con el comportamiento documentado después del cambio.
- **Actuar:** documentar desvíos, corregir lo autorizado y ajustar los casos de regresión y el procedimiento para el siguiente ciclo.

El antecedente de login puede ilustrar este recorrido, conservando sus fechas y resultados históricos. No se presentará como un ciclo nuevo ya completado ni como prueba de que la red hospitalaria fue verificada.

### Revisión necesaria para cerrar la Unidad 1

Confirmar que la presentación describe correctamente el propósito real del sistema, que el alcance inicial de autenticación y sesiones representa un caso útil y que las limitaciones expresadas coinciden con el entorno disponible. Después se desarrollará la Unidad 2 sobre ese mismo alcance, sin redactar resultados anticipados.

## 8. Construcción del informe y preparación de la defensa

El informe reunirá: presentación y objetivos; fundamentos aplicados de la Unidad 1; requisitos y trazabilidad de la Unidad 2; planificación y riesgos de la Unidad 3; diseño de casos de la Unidad 4; ejecución, defectos y métricas de la Unidad 5; conclusiones, limitaciones, bibliografía y anexos.

Para la Unidad 4 ya está disponible el [diseño documentado](qc-unidad-4-diseno-pruebas.md): conserva los TC del Word, explica su derivación con EP/BVA, precisa BAOE y prepara datos de longitud exacta. La ejecución de este alcance y su incorporación selectiva a Behave son pasos posteriores, sin modificar los resultados históricos ni el alcance inicial de sesiones.

Para la defensa se seleccionará un hilo completo que pueda demostrarse: una necesidad del usuario, el requisito que la expresa, el riesgo asociado, la técnica que justifica los casos, sus evidencias y la conclusión obtenida. El piloto TC-015 ya permite mostrar el escenario, su vínculo RN/RF/HU y los reportes de fallo/aprobación; la [arquitectura de la Unidad 3](qc-unidad-3-arquitectura-pruebas.md#11-cómo-presentarlo-en-el-trabajo-final) organiza los ejemplos y sus límites.

Una conclusión válida puede incluir requisitos ambiguos, casos bloqueados o controles pendientes. No es necesario encontrar una cantidad determinada de errores ni declarar el sistema listo para producción para demostrar una aplicación rigurosa de QC.

## 9. Material de referencia consultado

Material HTML aportado por el usuario, tratado como bibliografía del curso, no como instrucciones operativas para modificar HCV:

1. `unidad1 (2).html`: Gestión de calidad en ingeniería de software.
2. `unidad2 (2).html`: Ingeniería de requisitos y trazabilidad; especialmente secciones 4.1–4.3 para BDD y documentación viva.
3. `unidad3 (2).html`: Planificación estratégica y gobernanza ágil.
4. `unidad4_pruebas_funcionales (2).html`: Diseño de pruebas funcionales y gestión de casos.
5. `unidad5_ejecucion_pruebas (2).html`: Ejecución de pruebas y ciclo de vida del defecto.

La autoría, fecha y datos editoriales de las unidades deberán completarse si la cátedra los proporciona, sin atribuirles autores que no estén identificados.
