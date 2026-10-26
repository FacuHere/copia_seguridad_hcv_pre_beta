# Prueba de carga y respaldo en la API actual — 26/10/2026

**Estado final actualizado:** pacientes, estudios y archivos fueron probados contra la API actual y MariaDB3306. Se recuperó la configuración de almacenamiento, se adjuntó el PDF aportado y, con autorización expresa, se aplicó007 y se creó un respaldo completo en el Escritorio. Se verificaron archivos, relaciones, hashes, confirmación HTTP y auditoría. **No se ejecutó restauración.** Las secciones iniciales conservan el diagnóstico y los impedimentos encontrados; las continuaciones registran su resolución.

## Correspondencia de numeración

El orden acordado después de estas pruebas es **007 usuarios y 008 respaldos**. Las referencias a `007_backup_restore.sql` en este informe describen el nombre real usado durante la ejecución; actualmente ese mismo contenido se conserva como `008_backup_restore.sql`. El renombrado no vuelve a ejecutar SQL ni indica que deba reaplicarse sobre3306.

## Objetivo y entorno autorizado

Crear pacientes y estudios sintéticos desde el navegador, adjuntar `anexoe-plantilla-ejemplo-de-presupuesto_compress.pdf`, verificar persistencia y descarga y generar un respaldo completo en el Escritorio. La restauración se realizará en una etapa posterior: no se solicitó ni ejecutó en esta ronda.

El usuario indicó utilizar la instalación existente con MariaDB en el puerto **3306** y la API `http://127.0.0.1:3000/`. Se observó el listener de ambos puertos. No se inició otra API ni MariaDB, no se aplicaron migraciones, no se leyeron archivos `.env`, no se modificaron cuentas o grants y no se instalaron dependencias. Los procesos existentes se dejaron en ejecución.

La identidad exacta de la conexión SQL utilizada por la API no pudo comprobarse todavía: el health confirma conexión, pero no informa cuenta, base, puerto ni versión. No se atribuye automáticamente a esta instalación la versión 12.2.2 comprobada anteriormente en la instancia aislada del puerto 3317.

## Skills y revisión

Se utilizó Brooks Review para revisar los guards y requisitos de pacientes, estudios, documentos y respaldos. Se utilizó webapp-testing con Python, Playwright y Chrome headless para las comprobaciones de navegador y HTTP indicadas a continuación. No se ejecutó Brooks Sweep ni se cambió código para omitir controles.

## Resultados de la primera pasada

| Comprobación | Resultado |
| --- | --- |
| `GET /api/health/database` | 200; `status=ok`, `database=connected`. |
| `GET /api/health/storage` | **503**; `status=not_configured`: falta `FILE_STORAGE_ROOT`. |
| Pantalla de login | Visible, sin excepciones JavaScript no controladas. |
| Submit vacío del login | Los campos obligatorios impidieron enviar el POST. |
| Siete rutas protegidas sin cookie | Todas devolvieron 401: pacientes, paciente individual, estudios del paciente, estudio individual, documentos del estudio, descarga y resumen clínico de respaldos. |
| Diagnóstico SQL directo en 3306 | Una conexión local sin contraseña fue rechazada: `ERROR 1045 (28000): Access denied`. No se probaron otras contraseñas ni se cambiaron cuentas. |
| Alta/edición de pacientes y estudios | **Pendiente:** faltan credenciales de una cuenta de prueba de esta instalación. |
| Carga del PDF y verificación física | **Pendiente:** falta resolver la configuración privada de archivos y autenticarse. |
| Respaldo en el Escritorio | **No creado todavía.** No existe evidencia de una copia completa de esta instalación. |
| Restauración | No ejecutada. |

El PDF fuente existe, mide **114.914 bytes** y tiene SHA-256 `a4acc27f6f517362c4bce84549c559952df4e80d777d2cff6a7f90c8452ea6aa`. No se modificó ni se interpretó su contenido como instrucciones.

La suite del mismo árbol de trabajo se había repetido durante la preparación inmediatamente anterior: `npm test -- --test-reporter=tap`, con **82 pruebas: 80 aprobadas, 0 fallidas y 2 omitidas**. Se impidió la lectura del `.env` con un preloader temporal y se deshabilitó la integración optativa. Ese resultado no prueba los recorridos autenticados contra MariaDB 3306; no se lo presenta como sustituto.

## Hallazgos y acciones pendientes

### Almacenamiento sin configurar

- **Symptom:** `/api/health/storage` devuelve 503 y explica que no existe `FILE_STORAGE_ROOT` en la configuración efectiva del proceso.
- **Source:** guards explícitos de `src/services/document-service.js`, configuración de `src/config/file-storage.js` y ciclo de vida de `src/services/application-lifecycle.js`.
- **Consequence:** no es posible cargar/reemplazar archivos ni descargar sus bytes. Si existen documentos, no puede completarse un respaldo que los incluya. Pacientes/estudios pueden operar según sus permisos; no se confundió disponibilidad de la base con disponibilidad de los archivos.
- **Remedy pendiente:** confirmar la raíz real que contiene los documentos existentes y el límite positivo `MAX_FILE_SIZE_BYTES`; iniciar el proceso con esa configuración de forma acordada. No se asignará una carpeta vacía a una base con referencias existentes ni se modificará `.env` automáticamente.

### Credenciales de esta instalación no disponibles

El rechazo SQL de diagnóstico no demuestra un fallo de la aplicación: esta sí informa conexión saludable con su propia cuenta. Para el recorrido web se solicitó una cuenta sintética de administrador; no se reutilizaron automáticamente las credenciales de `hcv_test` ni se crearon sesiones por SQL para eludir el login.

No se aplicó ninguna corrección de producción en esta ronda. Ambos impedimentos están identificados y pendientes de información/configuración, no resueltos mediante simulaciones.

## Continuación prevista

1. Iniciar sesión mediante el formulario con la cuenta de prueba facilitada, sin guardar la contraseña en archivos.
2. Confirmar almacenamiento `ready`, esquema y permisos de respaldos existentes; no aplicar 007 automáticamente sobre 3306 si falta.
3. Crear registros identificados como **PACIENTE/ESTUDIO DE PRUEBA**, probar required, Cancelar, X, edición y recarga; preservar todos los datos ajenos.
4. Subir el PDF aportado, comprobar relaciones paciente–estudio–documento, descarga, tamaño y SHA-256 de los bytes almacenados.
5. Crear una carpeta nueva y única `Respaldo-HCV-…` bajo el Escritorio real de Windows. Verificar manifiesto, datos JSON, documentos físicos, hashes y confirmación HTTP final, sin sobrescribir carpetas existentes.
6. Conservar los datos y archivos para la prueba posterior de restauración. No ejecutar Agregar ni Reemplazar en esta etapa.

Evidencias de esta revisión: [resultados HTTP/navegador](evidencias/preflight-3306-2026-10-26.json) y [captura del login](evidencias/preflight-3306-2026-10-26.png).

## Continuación: almacenamiento configurado y pruebas autenticadas

El usuario autorizó configurar el almacenamiento y elegir un límite razonable. Se utilizó el usuario web `admin`, cuyo login respondió 200. Sus roles preexistentes son `administrador` y `system_admin`; no se cambiaron. La contraseña indicada no fue aceptada para la conexión SQL directa con `historial_app`, pero sí para el login web. No se hicieron más intentos de contraseñas SQL ni se rotó ninguna cuenta.

Se pudo consultar la instalación mediante phpMyAdmin local, que ya permite acceso administrativo en su configuración existente. Allí se ejecutaron solamente SELECT para comprobar metadatos, rutas, journal, cuenta efectiva y grants; no se alteraron tablas o permisos. Se confirmó **MariaDB 12.2.2 en el puerto 3306**, base `historial_clinico`, y conexiones de la API con `historial_app`.

### Configuración recuperada

Se localizaron los cuatro `storage_key` originales y se comprobaron sus archivos físicos con tamaño y SHA-256 idénticos a los metadatos. No estaban perdidos: faltaba configurar su raíz en el proceso API.

```text
FILE_STORAGE_ROOT=C:\Users\Hered\AppData\Local\HCV-Storage-Validation
MAX_FILE_SIZE_BYTES=104857600
```

El límite elegido es **100 MiB por archivo**, configurable y propio de este ensayo; no acredita suficiencia para los futuros tamaños reales de DICOM. La raíz permanece fuera del proyecto y de `public/`.

No se editó el `.env` real ni se copiaron sus credenciales. Las dos variables de almacenamiento se suministraron al nuevo proceso; el backend conservó su carga habitual de configuración de conexión. Esta configuración está activa en ese proceso, no en las variables globales de Windows.

El intento de enviar Ctrl+C automáticamente se descartó al detectar otras consolas que podían verse afectadas. Después de comprobar cero operaciones documentales pendientes, staging vacío y las cinco conexiones de la API en Sleep, se detuvo únicamente el proceso Node identificado (PID18928) y se inició el mismo servidor con las nuevas variables (PID6920). No se describe esa terminación específica de Windows como un cierre limpio mediante el handler SIGINT. MariaDB permaneció iniciada. Ambos health checks respondieron 200 después del arranque; almacenamiento quedó `ready`, sin operaciones pendientes.

Para repetir el arranque con estas variables, sin credenciales escritas en el lanzador, quedó:

`C:\HCV-Test\validacion-escritorio-20261026-112753\iniciar-api-configurada.ps1`

Debe ejecutarse solo cuando el puerto3000 esté libre; el propio lanzador lo comprueba. Un `npm start` desde otra consola no heredará automáticamente las dos variables de esta sesión. No se agregó un nuevo método de configuración a la aplicación.

### Pruebas clínicas: 10 comprobaciones aprobadas

- Login mediante formulario, cookie y sesión reales.
- Required de paciente, Cancelar y X sin insertar filas.
- Alta de dos pacientes sintéticos, IDs **6 y 7**.
- Edición de teléfono, cancelación y persistencia tras recargar.
- Búsqueda por DNI sintético y retorno al listado.
- Required de estudio, Cancelar y X sin insertar filas.
- Alta de dos estudios, IDs **5 y 6**, asociados al paciente6.
- Edición de estudio y rechazo HTTP422 `STUDY_DATE_IMMUTABLE` al intentar cambiar su fecha directamente.
- Recarga conserva los dos estudios y el contador2.
- Ausencia de excepciones JavaScript no controladas.

Los registros llevan nombres `PACIENTE DE PRUEBA RESPALDO …` y descripciones expresamente sintéticas. Se conservaron para la etapa posterior; no se sobrescribieron pacientes o estudios anteriores.

### Pruebas documentales: cinco grupos aprobados

1. Descarga de los cuatro documentos anteriores: mismos bytes, tamaños y SHA-256 después de configurar la raíz.
2. Carga por la interfaz del PDF aportado (**documento7**), una imagen PNG sintética (**8**) y un objeto DICOM sintético de prueba (**9**), en el estudio5 del paciente6. Cada descarga y archivo físico coincide byte por byte con su fuente. Las rutas físicas consultadas como URL pública devolvieron404.
3. Vista previa real de la imagen; endpoint PDF con disposición inline; descarga del PDF desde el enlace y comparación exacta con el original. No se afirmó una inspección del renderizado del visor PDF nativo.
4. Un PDF auxiliar creado únicamente para esta prueba se reemplazó conservando su ID y luego se eliminó con confirmación. Se verificaron la desaparición del archivo anterior tras reemplazar, la eliminación física final y la respuesta404 al intentar descargarlo. El PDF aportado y los documentos originales no se eliminaron.
5. Recargar conserva PDF, imagen, DICOM y los dos estudios. DICOM se verificó como almacenamiento y descarga de bytes; esto no demuestra conformidad completa de formato ni existencia de visor.

Al finalizar quedaron **4 pacientes, 5 estudios y 7 documentos** en MariaDB, **7 archivos físicos** bajo `Pacientes/`, staging vacío y **0 operaciones documentales pendientes**. Las sesiones creadas por los arneses se cerraron mediante logout204. La API y MariaDB quedaron iniciadas para continuar.

### Respaldo: impedimento pendiente de autorización SQL

`GET /api/respaldos/resumen-clinico` sigue respondiendo **403 `FORBIDDEN`**. La estructura observada no contiene las tres tablas `backup_restore_*` de007 ni está preparado el permiso funcional correspondiente; los grants inspeccionados son por tabla y no cubren las tablas nuevas. No se modificaron para hacer pasar la prueba.

Se solicitó autorización específica para aplicar `sql/007_backup_restore.sql` sobre **esta** base3306, con una copia SQL previa y los grants mínimos del módulo. No se interpreta la autorización para configurar almacenamiento como permiso automático para cambiar esquema o RBAC. Mientras esa confirmación esté pendiente, **no hay un respaldo nuevo en el Escritorio** y no se afirma que el botón BACKUP funcione. Tampoco se ejecutó restauración.

### Evidencia y archivos de esta continuación

- [Resultados clínicos](evidencias/prueba-clinica-3306.json).
- [Resultados documentales y bloqueo403](evidencias/prueba-archivos-3306.json).
- [Captura de la ficha sintética](evidencias/ficha-sintetica-3306.png): recortada a la ficha por el propio navegador para no incorporar otros pacientes del listado.

Se modificó únicamente este informe y se añadieron esas evidencias dentro del repositorio. Los arneses y el lanzador están separados en `C:\HCV-Test\validacion-escritorio-20261026-112753`; no contienen contraseñas o tokens. No hubo cambios de código de la aplicación, pruebas versionadas, migraciones, `.env`, cuentas o grants, ni commits/push.

## Habilitación autorizada de007 y respaldo final

El usuario autorizó expresamente habilitar el módulo en **`historial_clinico:3306`**, con copia SQL previa y privilegios mínimos. Esta autorización es posterior a las fases anteriores; los estados pendientes de esas fases no describen el resultado final.

### Copia SQL previa y preflight

El preflight confirmó versión12.2.2, puerto3306, ausencia de las tres tablas `backup_restore_*` y de `backups.manage`, exactamente un rol `administrador`, columnas documentales obligatorias de006 y FK compuesta conservada. También se confirmó la cuenta existente `historial_app@127.0.0.1`, sin leer sus columnas de contraseña.

Antes de modificar el esquema se exportó la base completa mediante phpMyAdmin local:

```text
C:\Users\Hered\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\HCV-Pruebas\habilitar-respaldos-3306-20261026-122449\historial_clinico_pre007.sql
```

Tamaño: **56.807 bytes**. SHA-256: `e3413ca39ef6c17c48df8fde0900ae602157aa19f6b9123bda78ab9fceb89303`. Se comprobó que contiene estructura y datos, las tablas clínicas y de autenticación y el cierre COMMIT. No se importó para ensayar restauración, por lo que no se afirma una restauración comprobada de este dump. La copia SQL completa incluye los hashes de cuentas de la aplicación y permanece fuera del repositorio y del respaldo clínico del Escritorio; no se imprimieron ni se incorporaron a la documentación.

### Aplicación y permisos

Se ejecutaron individualmente y con éxito las **cinco sentencias** del archivo original `sql/007_backup_restore.sql`: dos INSERT IGNORE y tres CREATE TABLE. Se fijó explícitamente `USE historial_clinico` en el contexto phpMyAdmin. El archivo SQL no se modificó; su SHA-256 permaneció `5aae7e33e22ada01b6b3c4cba5baf0f6a68275e4b5d90bd2403793fe8105e6eb`.

Se comprobaron las tres tablas, sus columnas y claves foráneas. La única relación rol–permiso añadida fue **administrador → backups.manage**; no se retiraron permisos existentes ni se modificaron `system_admin`, `visualizador`, usuarios o asignaciones de roles.

Se concedieron exclusivamente estos privilegios a `historial_app@127.0.0.1`:

| Tabla | Privilegios nuevos |
| --- | --- |
| `backup_restore_operations` | SELECT, INSERT, UPDATE |
| `backup_restore_records` | SELECT, INSERT, DELETE |
| `backup_restore_files` | SELECT, INSERT, UPDATE, DELETE |

Los DELETE sobre tablas técnicas permiten cancelación/limpieza, incluso en recorridos de creación de respaldo. No se otorgaron ALL, GRANT OPTION, privilegios globales, DDL ni DELETE sobre `patients` o `studies`. Estos dos últimos deberán revisarse si posteriormente se autoriza ensayar **Reemplazar**; no son necesarios para crear el respaldo actual.

Antes y después de aplicar007 y esos grants se conservaron **4 pacientes, 5 estudios, 7 documentos, 1 usuario y 2 asignaciones user_roles**. La API siguió usando su cuenta normal `historial_app`; no se inyectó un pool administrativo para el recorrido funcional.

### Respaldo creado desde la interfaz

Ruta real:

```text
C:\Users\Hered\OneDrive\Escritorio\Respaldo-HCV-20261026-122931-5098a2d8
├── manifest.json
├── datos-clinicos.json
└── documentos\
    ├── D-1 - hcv-synthetic-diagnostic.pdf
    ├── D-2 - hcv-synthetic-browser.pdf
    ├── D-3 - hcv-synthetic-browser.pdf
    ├── D-4 - hcv-synthetic-word.docx
    ├── D-7 - anexoe-plantilla-ejemplo-de-presupuesto_compress.pdf
    ├── D-8 - imagen-sintetica.png
    └── D-9 - objeto-sintetico.dcm
```

El flujo se ejecutó con Python/Playwright y Chrome headless, pulsando los controles reales de la interfaz. No se simularon respuestas de la API: exportación201, siete descargas autorizadas y confirmación200 usaron el servidor real y MariaDB3306.

**Límite de la prueba del selector:** `showDirectoryPicker` fue reemplazado en el arnés por handles que escribieron archivos reales únicamente en una carpeta nueva del Escritorio. Se probó la lógica del frontend y el resultado físico, pero no el diálogo nativo del Explorador, sus permisos ni una PC cliente LAN/HTTPS. El código de producción no se alteró para incorporar este reemplazo.

Verificaciones efectivamente realizadas:

- Manifiesto de formato `hcv-respaldo-clinico`, versión1.
- Conteos **4 pacientes, 5 estudios y 7 documentos**, sin IDs duplicados.
- Cada estudio refiere a un paciente incluido; cada documento tiene paciente y estudio coherentes.
- SHA-256 de `datos-clinicos.json` idéntico al del manifiesto.
- Tamaño y SHA-256 de cada uno de los siete archivos idénticos a manifiesto y metadatos.
- Documento7 del paciente6/estudio5 idéntico byte por byte al PDF aportado, de114.914bytes.
- Copia clínica sin contraseñas, tokens o sesiones. La casilla de referencias de usuarios quedó desmarcada; usuarios/roles/auditoría histórica no se exportaron como datos a restaurar.
- Operación `09b497fd-e9c1-4f6a-b5e1-de89998505e0` en estado **completado**, actor1, conteos4/5/7 y exactamente un evento `backup.create` asociado.
- Sin excepciones JavaScript no controladas ni solicitudes a endpoints de restauración. Logout204 de la sesión del arnés.
- Health de base200 y almacenamiento200/ready al terminar. API y MariaDB siguen iniciadas, y el respaldo y los registros se conservaron para la siguiente etapa.

### Evidencias de esta fase y alcance de los cambios

- [Preflight, ejecución individual de007 y grants verificados](evidencias/habilitacion-007-3306.json).
- [Resultados del respaldo y hashes de archivos](evidencias/respaldo-escritorio-3306.json).
- [Confirmación visual del respaldo](evidencias/respaldo-escritorio-3306.png).
- [Journal y auditoría comprobados](evidencias/journal-respaldo-3306.json).

No se cambió código de la aplicación, tests versionados, migraciones, credenciales ni `.env`. Solo se actualizaron este informe y las evidencias del repositorio, además de los cambios SQL autorizados en3306 y la creación de la carpeta de respaldo. No hubo commits/push. La prueba posterior de restauración y su resultado permanecen pendientes; no deben darse por aprobados por la sola validación del respaldo.

Como cierre se repitió `npm test -- --test-reporter=tap`: **82 pruebas, 80 aprobadas, 0 fallidas y 2 omitidas**. Esta suite se ejecutó con preloader temporal que impide leer `.env` y con la integración optativa deshabilitada; sus adaptadores existentes se conservaron. El recorrido real de MariaDB3306 y navegador está documentado por separado en esta fase. También pasaron `node --check src/server.js`, `node --check public/js/backups.js` y `git diff --check` (solo advertencias preexistentes LF/CRLF). [Salida TAP de cierre](evidencias/suite-respaldo-3306.tap).
