# Unidad 4 — Diseño de pruebas de HCV: EP, BVA y BAOE

Fecha: 16/11/2026. Estado: **diseño documentado; ejecución de este alcance pendiente**.

Se revisó el banco existente para explicar cómo se seleccionan entradas representativas y fronteras. No se afirma que esta justificación se hubiera documentado al generar originalmente los casos. Se conservan sus identificadores, los Word originales y sus resultados. Este trabajo no ejecutó altas de pacientes o usuarios ni amplió la automatización Behave.

Índice común: [RTM](matriz-trazabilidad-hcv.md). Antecedentes: [requisitos](requisitos-hcv.md), [arquitectura de pruebas](qc-unidad-3-arquitectura-pruebas.md) y [plan del trabajo final](plan-trabajo-final-qc.md).

## 1. Qué significa BAOE y qué documento ya se parece

La Unidad 4, apartados 4.1 y 4.2, usa estas denominaciones:

| Elemento | Significado en la bibliografía | Campo equivalente de nuestra plantilla de pruebas |
| --- | --- | --- |
| B | **Breve descripción**: objetivo concreto, máximo 15 palabras. | DESCRIPCIÓN. |
| A | **Antecedentes / precondiciones**: estado exacto necesario antes de empezar. | PRECONDICIONES. |
| O | **Operaciones / pasos**: acciones ordenadas, con datos precisos. | PASOS A SEGUIR, complementado por DATOS DE ENTRADA. |
| E | **Éxito / resultado esperado**: condición observable para decidir si se cumplió la expectativa. | RESULTADO ESPERADO. |

IDENTIFICADOR y vínculos RN/RF/HU aportan identificación y trazabilidad. RESULTADO OBTENIDO, ESTADO y evidencia pertenecen a una ejecución posterior. **E no significa que el sistema deba aceptar siempre la entrada**: rechazar correctamente un dato inválido también satisface el resultado esperado.

El [documento de casos de uso](Casos%20de%20uso%20HCV.docx) tiene partes semejantes: descripción, actores, precondiciones, secuencia actor–sistema, postcondiciones y excepciones. Describe una función y sus alternativas. Por ejemplo, HU-01 explica iniciar sesión, pero no fija todas las credenciales y variantes concretas de cada prueba. La comparación se apoya en la [extracción verificada de HU-01 a HU-03](../reports/qc/unidades-1-2/fuentes-documentales.json); el archivo estaba bloqueado al intentar releerlo en esta revisión.

El [plan de pruebas manuales](Plan%20de%20pruebas%20manuales%20QC%20HCV.docx) es el que **ya se corresponde directamente con BAOE**, aunque use otros rótulos. No hace falta sustituir su plantilla. Sí hace falta precisar algunos datos y pasos: «otros campos válidos» resulta insuficiente si no se define una base común, y un paso que solo dice «guardar la variante admitida» no explica qué hacer con la variante inválida.

**Relación con Gherkin:** A se corresponde aproximadamente con `Given`, O con `When` y E con `Then`; B resume el objetivo. Las cuatro letras BAOE no son palabras clave de Behave. Se mantienen las palabras clave Gherkin en inglés, como se acordó.

## 2. Alcance y fuentes de los resultados esperados

La bibliografía admite requisitos, casos de uso y contratos OpenAPI como entradas para diseñar pruebas de caja negra. Aquí las reglas se toman de la documentación existente y se contrastan con la interfaz y sus validadores; **no se toma cualquier comportamiento del código como prueba de que sea una regla de negocio correcta**.

| Familia | Trazabilidad | Regla técnica utilizada | Fuente principal |
| --- | --- | --- | --- |
| Alta de paciente | RN-002 → RF-2.3 → HU-07 | Nombre obligatorio, máximo 240; DNI 32, teléfono 80, dirección 500, notas 10000. Estos cuatro últimos campos son opcionales. | [OpenAPI, PatientWrite](openapi-hcv.yaml), [API REST](api-rest-hcv.md), TC-025–027 y TC-031–045. |
| Alta de usuario | RN-005 → RF-5.3 → HU-27 / HU-29 | Usuario de 3 a 100 caracteres ASCII; primero alfanumérico, siguientes alfanuméricos o punto, guion y guion bajo; recorte de espacios exteriores. | OpenAPI, UserCreate; API REST, Gestión de usuarios; TC-122–127. |
| Contraseña de alta administrativa | RN-005 → RF-5.3 → HU-27 / HU-29 | Mínimo 12 puntos Unicode, máximo 1024 unidades UTF-16; sin recortar; confirmación idéntica. | OpenAPI, AdministrativePassword; API REST; TC-128–131. |

El mínimo de 12 corresponde al **alta/cambio administrativo**, no al inicio de sesión de una cuenta existente. Es una política técnica actual, no una aprobación hospitalaria. Tampoco se deduce que el DNI o el teléfono solo admitan números por el atributo `inputmode` del formulario. Las reglas clínicas de DNI, duplicados, edades y fechas futuras pendientes siguen pendientes.

Para las fronteras de longitud se usan cadenas **ASCII sin espacios exteriores**. Así, cada carácter ocupa un punto Unicode y una unidad UTF-16, y no se mezclan medidas. Acentos, emoji, caracteres combinados y normalización requieren un diseño adicional: esta selección no prueba todo Unicode. TC-028 aporta un caso de conservación de tildes y apóstrofos, pero no completa ese análisis.

La [lectura de las fuentes](../reports/qc/unidad4/fuentes-diseno.json) conserva descripciones, expectativas, estados y huellas documentales. El [catálogo de diseño](qc/diseno-ep-bva-hcv.json) registra los puntos de frontera y su TC de origen. No contiene resultados del producto.

## 3. Partición de equivalencia: elegir clases antes de elegir valores

Las clases siguientes son disjuntas **dentro del dominio elegido: texto ASCII de formulario, sin caracteres de control**. No incluyen ausencia de una propiedad JSON, `null`, objetos o números enviados en lugar de cadenas; esos requieren otras pruebas de API. La aceptación supone que el resto de los datos, la autorización y el entorno son válidos.

### 3.1 Nombre del paciente

| Clase | Condición | Representante | Resultado esperado | Vínculo existente |
| --- | --- | --- | --- | --- |
| EP-N-01 | Cadena vacía. | `""` | No crear una ficha sin nombre. | TC-026. |
| EP-N-02 | Cadena no vacía que queda vacía al recortar espacios. | Tres espacios. | No crear una ficha con nombre vacío. | TC-027. |
| EP-N-03 | Nombre no vacío después del recorte, longitud hasta 240. | `Paciente QC ficticio` | Admitir el alta y conservar el nombre. | TC-025 cubre nombre con opcionales vacíos; el representante aquí elegido es un dato propuesto para repetir esa condición. |
| EP-N-04 | Nombre cuya longitud después del recorte supera 240. | 300 letras A. | API: `400 INVALID_PATIENT`, sin alta. La interfaz puede impedir que se llegue a enviar ese valor. | TC-033 cubre el exceso por interfaz con 241; 300 es otro representante propuesto de la misma clase. |

La condición de nombre vacío/solo espacios está expresada en TC-026/027. El recorte se contrastó en el validador actual; las fronteras de esta revisión no dependen de espacios exteriores. Una expectativa del banco no equivale a validación institucional de una regla clínica.

### 3.2 Nombre de usuario nuevo

Se evalúa la longitud después de recortar espacios exteriores. Primero se separan las longitudes inválidas y, dentro de 3–100, se separa el formato. Esto evita clases superpuestas.

| Clase | Condición | Representante | Resultado esperado de API | Vínculo existente |
| --- | --- | --- | --- | --- |
| EP-U-01 | Longitud de 0 a 2. | `q2` | `422 INVALID_USER`; no crear cuenta. | TC-122, representante de longitud 2. No demuestra por sí solo que se probaron 0 y 1. |
| EP-U-02 | Longitud superior a 100. | 150 letras q. | `422 INVALID_USER`; no crear cuenta. | TC-127 representa esta clase por interfaz con 101. |
| EP-U-03 | Longitud 3–100; primer carácter no alfanumérico. | `_qc` | `422 INVALID_USER`. | Sin caso dedicado identificado para este representante. |
| EP-U-04 | Longitud 3–100; primero alfanumérico y algún carácter posterior no permitido. | `qc@` | `422 INVALID_USER`. | TC-123 y TC-124 cubren espacio interno y arroba. |
| EP-U-05 | Longitud 3–100 y patrón permitido. | `qc_u4_interior` | `201`, conservando el usuario, si no existe previamente. | TC-125 y TC-126 ejercitan los extremos válidos; este representante interior se propone para una repetición independiente. |

Un duplicado pertenece a otra dimensión: con formato válido puede producir `409 CONFLICT` (TC-120). No se usa un usuario ya existente para comprobar una longitud válida, porque el conflicto ocultaría el objetivo del caso.

### 3.3 Contraseña administrativa y confirmación

Para cadenas ASCII: longitudes 0–11 son inválidas, 12–1024 válidas y mayores de 1024 inválidas. Representantes interiores: 8, 20 y 1100 letras A. En los casos de longitud, la confirmación debe ser idéntica. La API espera `422 INVALID_PASSWORD` en las clases inválidas y `201` en la válida, con el resto del alta correcto.

La confirmación se analiza por separado, manteniendo una contraseña válida: coincidencia exacta frente a diferencia. TC-131 representa la diferencia y espera `422 PASSWORD_MISMATCH` en API. Combinar 11 caracteres **y** confirmación distinta impediría saber qué validación produjo el rechazo.

La repetición de una letra es un dato sintético para aislar longitud, no una recomendación de contraseña ni una credencial real. No se usan estas cadenas en cuentas operativas.

## 4. Análisis de valores límite: BVA de tres valores

Se eligen el límite y sus vecinos inmediatos: `límite − 1`, `límite`, `límite + 1`. Para un nombre obligatorio con longitud mínima 1 son **0, 1 y 2**, no una longitud negativa imposible. Para el máximo 240 son **239, 240 y 241**.

En la tabla, «admitir» supone las demás condiciones válidas; «exceso» distingue la limitación de interfaz del rechazo de API. Un TC asociado acredita que el dato está diseñado en el banco, **no que se ejecutó ni aprobó**.

| Campo y frontera | Valores seleccionados | TC existentes, en ese orden | Expectativa por longitud |
| --- | --- | --- | --- |
| Nombre, mínimo 1 | 0 / 1 / 2 | TC-026 / **falta dedicado** / **falta dedicado** | Rechazar / admitir / admitir. |
| Nombre, máximo 240 | 239 / 240 / 241 | TC-031 / TC-032 / TC-033 | Admitir / admitir / exceso. |
| DNI, máximo 32 | 31 / 32 / 33 | TC-034 / TC-035 / TC-036 | Admitir / admitir / exceso. |
| Teléfono, máximo 80 | 79 / 80 / 81 | TC-037 / TC-038 / TC-039 | Admitir / admitir / exceso. |
| Dirección, máximo 500 | 499 / 500 / 501 | TC-040 / TC-041 / TC-042 | Admitir / admitir / exceso. |
| Notas, máximo 10000 | 9999 / 10000 / 10001 | TC-043 / TC-044 / TC-045 | Admitir / admitir / exceso. |
| Usuario nuevo, mínimo 3 | 2 / 3 / 4 | TC-122 / TC-125 / **falta dedicado** | Rechazar / admitir / admitir. |
| Usuario nuevo, máximo 100 | 99 / 100 / 101 | **falta dedicado** / TC-126 / TC-127 | Admitir / admitir / exceso. |
| Contraseña administrativa, mínimo 12 | 11 / 12 / 13 | TC-128 / TC-129 / TC-130 | Rechazar / admitir / admitir. |
| Contraseña administrativa, máximo 1024 | 1023 / 1024 / 1025 | **faltan dedicados para los tres** | Admitir / admitir / exceso. |

**Balance de diseño:** 30 puntos de frontera en siete campos. Se vincularon 23 con un TC existente y se identificaron siete sin caso dedicado: nombre 1/2, usuario 4/99 y contraseña 1023/1024/1025. Se registran como variantes propuestas `U4-…`, no se inventan TC-186 en adelante ni se modifica la numeración del Word. Este recuento solo mide el diseño seleccionado; no es cobertura de ejecución, de código ni de todos los formularios.

En los cuatro campos opcionales se revisa aquí la frontera superior. TC-025 contempla su ausencia conjunta; faltan variantes individuales de vacío/espacios/nulo y sus combinaciones si se amplía la prueba de normalización/API. Tampoco se da por completo BVA de nombre visible, búsqueda, estudios o tamaño de archivos: quedan fuera de esta selección.

EP explica por qué se puede seleccionar un representante de una clase en vez de todas sus cadenas posibles. BVA añade los puntos donde una comparación incorrecta puede admitir 241 o rechazar 240. La reducción es una decisión de muestreo justificada, **no una garantía de detectar todo defecto**.

## 5. Separar lo que prueba la interfaz de lo que prueba la API

| Canal | Operación | Qué demuestra | Qué no demuestra |
| --- | --- | --- | --- |
| Interfaz | Pegar 241 letras en Nombre, cuyo `maxlength` es 240. | Si el campo impide/limita el exceso y si ningún nombre de 241 queda guardado. Si reduce a 240 y permite guardar ese valor válido, se registra el recorte. | Que el servidor haya recibido y rechazado 241 letras. |
| API | Enviar realmente `fullName` con 241 letras a `POST /api/pacientes`, con sesión autorizada. | Si responde `400 INVALID_PATIENT` y no crea el recurso. | Que el mensaje o la interacción del formulario sean correctos. |

La variante API de TC-033 complementa su objetivo, pero no existía como ejecución ni se presenta como un TC nuevo ya aprobado. Lo mismo se aplica al exceso de DNI, teléfono, dirección, notas, usuario y contraseña. Un `maxlength` no sustituye la validación del servidor.

Hay una dependencia de datos que conviene corregir al preparar TC-126/127: el Word propone 100 letras q y luego 101 letras q. Si el segundo valor se recorta a 100 y esa cuenta ya fue creada, el alta puede fallar por duplicado. Registrar un `409 CONFLICT` en esa situación no demuestra que el servidor rechazó 101 caracteres. Revisar la limitación del campo antes del envío y preparar de forma independiente cualquier variante de alta; no borrar cuentas para ocultar el conflicto.

En la interfaz el mínimo de contraseña administrativa no está declarado mediante `minlength`; no se exige que sea el navegador quien lo detecte. Se observa el rechazo previsto y la ausencia del alta, y la variante API comprueba el código definido. La limitación superior de la interfaz tampoco demuestra el rechazo de 1025 unidades por el backend.

## 6. Casos concretos con estructura BAOE

Son fichas de diseño complementarias. No reemplazan las filas ni estados originales del Word. Todos los resultados obtenidos de estas variantes están **sin registrar**.

### 6.1 TC-032 — Nombre en el máximo permitido

**Trazabilidad:** RN-002 → RF-2.3 → HU-07 → TC-032. **Técnica:** BVA-3 superior. **Canal:** interfaz.

- **B:** Verificar la conservación del nombre cuando contiene exactamente 240 caracteres.
- **A:** Docker beta de pruebas identificado y disponible; sesión con `patients.create`, consulta y edición de pacientes; formulario Nuevo paciente abierto y vacío; datos exclusivamente sintéticos. Registrar la imagen y comprobar el estado inicial del listado. No adjuntar estudios ni documentos.
- **Datos:** `fullName` = 240 letras A, como especifica el Word; demás campos vacíos. Dato preparado: `textos_ascii.240` del archivo de longitudes.
- **O:** 1. Pegar las 240 letras en Apellido y nombre. 2. Pulsar Guardar paciente una vez. 3. Seleccionar la ficha recién creada y registrar su identificador. 4. Abrir su edición, copiar el nombre completo y comprobar longitud y contenido. 5. Recargar la página, localizar la misma ficha por su identificador y volver a consultar su nombre.
- **E:** Se crea una única ficha para ese envío; su nombre contiene exactamente las mismas 240 letras antes y después de recargar. No hay truncamiento, sustitución de caracteres ni error de validación de longitud. La verificación usa el valor completo, no un rótulo visual abreviado.
- **Registro posterior:** fecha, imagen, navegador, ID sintético, resultado obtenido, estado y evidencia. Si existen ya fichas con el mismo nombre, distinguir por el ID; no borrar datos para preparar el caso.

### 6.2 TC-033 / variante API — Exceso real enviado al servidor

**Trazabilidad:** RN-002 → RF-2.3 → HU-07 → TC-033, variante API propuesta. **Técnica:** BVA-3 superior y EP inválida.

- **B:** Verificar el rechazo del nombre cuando el servidor recibe 241 caracteres.
- **A:** Entorno beta identificado; sesión válida con `patients.create` y consulta de pacientes; cliente de API autenticado; endpoint de creación disponible; sin otras altas simultáneas. Verificar primero la preparación con un dato base válido en el entorno de pruebas y registrar el listado inicial de IDs, recorriendo sus páginas. Este caso no se realiza pegando en un campo limitado a 240.
- **Datos:** cuerpo JSON con una sola propiedad: `fullName` = 241 letras A (`textos_ascii.241`). Los opcionales se omiten, como permite el contrato.
- **O:** 1. Confirmar que el cuerpo contiene 241 letras y no fue recortado por el cliente. 2. Enviar un único `POST /api/pacientes`. 3. Registrar el estado HTTP y `error.code`, sin cookies ni tokens. 4. Consultar nuevamente los IDs de pacientes, recorriendo sus páginas, y comparar con el listado inicial para comprobar que no se añadió una ficha por esa solicitud.
- **E:** Respuesta `400`, `error.code = INVALID_PATIENT`; no se obtiene un nuevo ID de paciente ni se crea una ficha por esa solicitud. Una respuesta `401`, `403` o `503` impide comprobar esta validación: registrar el impedimento y resolver la precondición antes de concluir sobre el límite.

### 6.3 TC-122 — Usuario por debajo del mínimo

**Trazabilidad:** RN-005 → RF-5.3 → HU-27 / HU-29 → TC-122. **Técnica:** EP inválida y BVA-3 inferior. **Canal:** interfaz.

- **B:** Verificar el rechazo del alta cuando el usuario contiene dos caracteres.
- **A:** Entorno beta identificado; sesión con `users.manage` y `roles.manage`; pantalla Gestión de usuarios / Nuevo usuario disponible; perfil Visualizador configurado; el usuario `q2` no existe al comienzo. La prueba usa una cuenta nueva ficticia, no modifica las dos cuentas del piloto.
- **Datos:** Usuario `q2`; nombre visible `QC prueba U4`; perfil Visualizador; contraseña sintética de 20 caracteres ASCII con confirmación idéntica. Usar el dato `textos_ascii.20` solo en este entorno de pruebas.
- **O:** 1. Completar los campos con esos datos. 2. Pulsar el botón de alta. 3. Observar qué control impide guardar y su mensaje. 4. Cancelar el formulario y buscar el usuario exacto `q2` para comprobar que la solicitud no creó una cuenta.
- **E:** El alta se rechaza por longitud mínima del usuario; no se crea una cuenta. La comprobación API equivalente, diseñada por separado, espera `422 INVALID_USER`; no se exige esa respuesta HTTP si el navegador impide enviar el formulario.

### 6.4 TC-129 — Contraseña en el mínimo administrativo

**Trazabilidad:** RN-005 → RF-5.3 → HU-27 / HU-29 → TC-129. **Técnica:** BVA-3 inferior. **Canal:** interfaz.

- **B:** Verificar el alta cuando la contraseña contiene exactamente doce caracteres.
- **A:** Mismo entorno y permisos de la ficha anterior; no existe el usuario `qc_u4_p12`; perfil Visualizador configurado; el nombre visible y el usuario cumplen sus propios límites. No reutilizar una cuenta operativa.
- **Datos:** Usuario `qc_u4_p12`; nombre visible `QC prueba U4`; perfil Visualizador; contraseña = 12 letras A (`textos_ascii.12`); confirmación idéntica. Son datos ficticios de diseño, no credenciales existentes.
- **O:** 1. Completar el alta con esos datos. 2. Guardar una vez. 3. Comprobar la cuenta por su usuario e ID. 4. Abrir un navegador/contexto independiente e ingresar con la cuenta creada y la contraseña exacta. 5. Cerrar esa sesión de prueba.
- **E:** Se crea una sola cuenta; se conserva el usuario y el perfil seleccionado; las credenciales creadas permiten ingresar como esa cuenta. No se informa un rechazo por mínimo de contraseña. Registrar el alta y el acceso como comprobaciones diferenciadas dentro del caso compuesto que ya contiene el Word.

En un ciclo de ejecución habrá que identificar también las cuentas sintéticas creadas y su conservación o desactivación según un procedimiento acordado. Este diseño no borra usuarios ni pacientes ni autoriza una limpieza de la base.

## 7. Datos listos y procedimiento para ejecutar después

El archivo [datos-longitudes.json](../reports/qc/unidad4/datos-longitudes.json) contiene cadenas ficticias con longitudes verificadas. No contiene contraseñas de las cuentas actuales, cookies ni datos de pacientes. Desde PowerShell, situado en la raíz del proyecto, se puede copiar un valor exacto sin escribir 240 letras a mano:

```powershell
$datosU4 = Get-Content -LiteralPath '.\reports\qc\unidad4\datos-longitudes.json' -Raw | ConvertFrom-Json
Set-Clipboard -Value $datosU4.textos_ascii.'240'
```

Luego se pega en el campo del caso elegido. Para TC-125 el usuario concreto del Word es `q3a`, no tres letras A; el archivo incluye `usuarios_ascii.'3'`. Para comparar con el Word siempre se conserva su dato explícito o se registra que se ejecutó una variante.

Orden de trabajo para el siguiente ciclo:

1. Revisar las fichas y confirmar el alcance a ejecutar. Primero paciente 239/240/241, después usuario 2/3/4 y contraseña 11/12/13, si el módulo y datos base están listos. Esto es un orden propuesto, no una ejecución nueva.
2. Identificar imagen, navegador, permisos y datos; mantener válidos los demás campos. No mezclar dos condiciones inválidas para justificar un rechazo.
3. Ejecutar cada variante por su canal y registrar el resultado obtenido, estado y evidencia. Preparar una ficha independiente para cada uno de los siete puntos sin TC antes de integrarlos en el banco formal.
4. Automatizar selectivamente: Behave + Playwright para comportamientos de usuario; las validaciones directas de API se pueden organizar después con Python. Todavía no existen nuevos escenarios `.feature` ni pruebas de API Python para estos límites.
5. Si se incorpora Behave, conservar RN/RF/HU/TC y una ejecución identificada por variante. Antes de publicar varias variantes del mismo TC en la documentación viva, adaptar y verificar su modelo: el piloto actual tiene un escenario por TC y no ofrece una agregación formal por variante.

### Ciclo de vida de los casos

La Unidad 4 también trata gestión/versionado en un TMS. Para este alcance se adapta el registro existente: **diseñado → revisado → listo → ejecución → aprobado/fallido/bloqueado**, conservando cada ejecución. La obsolescencia de una expectativa debe documentarse sin borrar su historia, como se hizo con TC-004. No se instaló un TMS ni se acredita una revisión o aprobación de la cátedra/hospital. Los estados originales del Word siguen intactos; las contradicciones históricas se tratan en la [conciliación de U1/U2](qc-unidades-1-2-aplicacion.md).

## 8. Qué se puede sostener en el informe

Se documentó la correspondencia entre la plantilla de pruebas y BAOE, se definieron clases de equivalencia para nombres/usuarios/contraseñas y se diseñaron 30 puntos de frontera para siete campos. Veintitrés puntos se vincularon con casos ya existentes y siete quedaron identificados como faltantes de diseño dedicado. Se precisaron cuatro fichas BAOE y se separó la comprobación de interfaz de la validación de API. La ejecución de este alcance permanece pendiente.

Para la defensa: mostrar **RF-2.3 → regla de 240 → clases de nombre → 239/240/241 → TC-031/032/033 → ficha BAOE → ejecución futura**. El fallo y aprobación reales de TC-015 siguen siendo el ejemplo ya ejecutado de autenticación; no se usan como prueba de estos límites ni se convierten sus doce fallos de contraseña en BVA de un umbral de bloqueo que fue eliminado.

Fuentes metodológicas: bibliografía aportada, **Unidad 4, apartados 1.2, 2.1–2.3, 3.1–3.3, 4.1–4.2 y 5**. Se consultó el HTML original `unidad4_pruebas_funcionales (2).html`, incluidas las definiciones BAOE de las tarjetas interactivas. Las cifras generales de detección de defectos del material no son métricas medidas en HCV; no se declara cumplimiento regulatorio por elegir BVA-3.
