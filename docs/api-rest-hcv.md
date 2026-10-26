# API REST de Historial Clínico Visual

## Alcance

La API implementa autenticación, permisos RBAC, consultas y modificaciones de pacientes y estudios, y el ciclo de vida de documentos clínicos. El almacenamiento de documentos se mantiene fuera de `public/` y se sirve únicamente mediante endpoints protegidos. Este documento describe los contratos que se encuentran en el código; no supone que un endpoint, permiso o funcionalidad futura exista.

La especificación OpenAPI complementaria está en [`openapi-hcv.yaml`](openapi-hcv.yaml). Puede importarse en [Swagger Editor](https://editor.swagger.io/) o en Postman. Swagger UI no está integrado en la aplicación.

## Organización del backend

| Carpeta | Responsabilidad | Ejemplos |
| --- | --- | --- |
| `src/server.js` | Configura Express, middlewares globales, archivos estáticos, recuperación previa al inicio y routers. | `app.use`, `start()` |
| `src/routes/` | Declara método, ruta y middlewares; delega en un controlador. | `routes/patients.js` |
| `src/controllers/` | Adapta HTTP: lee parámetros/cuerpo, invoca servicios y construye status, headers y respuestas. | `controllers/studies-controller.js` |
| `src/services/` | Coordina validación y reglas de aplicación, transacciones y operaciones compuestas. | `services/document-service.js` |
| `src/repositories/` | Ejecuta consultas SQL parametrizadas y concentra el acceso a MariaDB por funcionalidad. | `repositories/patient-repository.js` |
| `src/middleware/` | Autenticación, autorización y controles transversales. | `require-auth.js`, `require-permission.js` |
| `src/utils/` | Funciones compartidas para errores y validación. | `application-error.js`, `validation.js` |

`services/document-storage.js` y `services/document-operations.js` conservan las rutinas especializadas de filesystem y recuperación/journal existentes. Esas operaciones coordinan MariaDB y el filesystem porque no pueden compartir una transacción atómica.

## Recorrido de una solicitud

1. `src/server.js` asigna `requestId`, instala el parser JSON y monta el router bajo su prefijo actual.
2. `src/routes/` asocia el endpoint con autenticación, permiso y, cuando aplica, disponibilidad del almacenamiento.
3. `src/controllers/` toma los datos HTTP y pasa los valores necesarios al servicio.
4. `src/services/` valida y coordina el caso de uso; usa el repositorio para las consultas y transacciones.
5. El repositorio ejecuta SQL parametrizado con la conexión o pool recibido.
6. El controlador devuelve la respuesta con el status y el JSON vigentes. Los errores de aplicación mantienen el código y mensaje definidos; los errores inesperados se registran mediante el logger actual.

## Autenticación y autorización

El inicio de sesión está en `POST /api/auth/login`. Una sesión válida se devuelve en la cookie `hcv_session`, configurada como `HttpOnly`, `SameSite=Strict`, con ruta `/api` y duración de ocho horas. El atributo `Secure` depende de `COOKIE_SECURE`. El token no se incluye en el JSON.

Los demás endpoints clínicos requieren una sesión válida. El middleware consulta la sesión en MariaDB y `require-permission.js` comprueba los permisos vinculados por `user_roles → role_permissions → permissions`. No se usa asociación por servicio para autorizar estas rutas. `401` indica sesión ausente o inválida, `403` permiso insuficiente y `503` imposibilidad de validar autenticación o disponibilidad del servicio.

Permisos requeridos por endpoint:

- Pacientes: `patients.read`, `patients.create`, `patients.update`.
- Estudios: `studies.read`, `studies.create`, `studies.update`.
- Documentos: `documents.read`, `documents.upload`, `documents.download`, `documents.replace`, `documents.delete`.
- Visualización inline de imágenes: además requiere `images.read`. PDF se puede visualizar inline con `documents.read`; los demás tipos se descargan.

Los endpoints de salud no requieren autenticación. No hay endpoints DELETE de pacientes o estudios.

## Endpoints

Las rutas indicadas son rutas completas, después del prefijo instalado en `server.js`.

### Salud

| Método y ruta | Acceso | Respuesta |
| --- | --- | --- |
| `GET /api/health/database` | Público | `200 {"status":"ok","database":"connected"}`; `503 {"status":"unavailable","database":"disconnected"}` si no puede obtenerse una conexión. |
| `GET /api/health/storage` | Público | `200` solo cuando `status` es `ready`; en otro estado responde `503`. El JSON contiene `status`, `message` y `operations`. |

### Autenticación

| Método y ruta | Permiso | Uso |
| --- | --- | --- |
| `POST /api/auth/login` | Público | Inicia sesión y establece `hcv_session`. Cuerpo: `username`, `password`. Respuesta `200`: `{"user":{"id":1,"username":"...","displayName":"...","roles":["..."]}}`. |
| `GET /api/auth/me` | Sesión válida | Devuelve `{"user":{"id":1,"username":"...","displayName":"...","roles":["..."]}}`. |
| `POST /api/auth/logout` | Cookie opcional | Invalida la sesión activa y borra la cookie. Respuesta `204` sin cuerpo; si no puede comprobarse o invalidarse la sesión puede responder `503`. |

El login puede responder `400 INVALID_CREDENTIALS_FORMAT`, `401 INVALID_LOGIN`, `429 LOGIN_RATE_LIMITED` (incluye `Retry-After`) o `503` si la base no está disponible.

El contador por IP activa el bloqueo al registrar el décimo fallo dentro de la ventana de 15 minutos; las solicitudes durante los siguientes 15 minutos responden `429`. Un login correcto limpia ese contador. Al cerrar o perder la sesión, el frontend borra fichas, formularios y referencias de respaldo; las respuestas y colas de carga de una sesión anterior no actualizan la vista ni continúan bajo otra sesión.

### Pacientes

| Método y ruta | Permiso | Parámetros / cuerpo | Respuesta principal |
| --- | --- | --- | --- |
| `GET /api/pacientes` | `patients.read` | Query opcional: `search`, `page` (por defecto 1), `pageSize` (por defecto 50; máximo 100). | `200 {"data":[{"id":"1","fullName":"...","dni":"..."}],"pagination":{"page":1,"pageSize":50}}`. |
| `POST /api/pacientes` | `patients.create` | JSON con `fullName` obligatorio; `dni`, `birthDate` (`AAAA-MM-DD`), `phone`, `address`, `notes` opcionales. | `201 {"data":{"id":"1","fullName":"...","dni":null,"birthDate":null,"phone":null,"address":null,"notes":null,"version":1}}`. |
| `GET /api/pacientes/{id}` | `patients.read` | `id` positivo. | `200 {"data":{...}}`; `404 PATIENT_NOT_FOUND` si no existe. |
| `PUT /api/pacientes/{id}` | `patients.update` | JSON de creación más `version` positiva requerida. | `200 {"data":{...}}`; conflicto de versión `409 VERSION_CONFLICT`. |

La búsqueda admite hasta 120 caracteres. `400` se usa para identificadores, paginación, búsqueda o datos inválidos. El esquema actual indexa el DNI sin imponer unicidad; no se documenta un rechazo de DNI repetido que el código no realiza. La actualización incrementa `version` y devuelve `409 VERSION_CONFLICT` si la versión enviada está desactualizada. Si cambia el nombre o DNI y existen documentos, puede requerir almacenamiento configurado y completar un movimiento recuperable de carpeta.

### Estudios

| Método y ruta | Permiso | Parámetros / cuerpo | Respuesta principal |
| --- | --- | --- | --- |
| `GET /api/pacientes/{patientId}/estudios` | `studies.read` | `patientId` positivo. | `200 {"data":[{"id":"1","patientId":"1","serviceId":"1","type":"...","date":"AAAA-MM-DD","professional":null,"diagnosis":null,"procedure":null,"description":null,"conclusions":null,"version":1}]}`. |
| `POST /api/estudios` | `studies.create` | JSON: `patientId`, `type`, `date` obligatorios; `professional`, `diagnosis`, `procedure`, `description`, `conclusions` opcionales. | `201 {"data":{"id":"1",...,"serviceId":"1","version":1}}`. |
| `GET /api/estudios/{id}` | `studies.read` | `id` positivo. | `200 {"data":{...}}`; `404 STUDY_NOT_FOUND` si no existe. |
| `PUT /api/estudios/{id}` | `studies.update` | JSON de creación más `version` positiva. Paciente y fecha deben coincidir con los valores persistidos. | `200 {"data":{...}}`; `422 STUDY_DATE_IMMUTABLE` si cambia la fecha y `422 PATIENT_REASSIGNMENT_NOT_ALLOWED` si cambia el paciente. |

El backend asigna el servicio activo `GENERAL`; el cliente no envía `serviceId`. Las actualizaciones utilizan control de versión y no cambian `study_date`.

### Documentos

| Método y ruta | Permiso | Cuerpo / comportamiento |
| --- | --- | --- |
| `GET /api/estudios/{studyId}/documentos` | `documents.read` | `200 {"data":[metadatos...]}`. |
| `POST /api/estudios/{studyId}/documentos` | `documents.upload` | `multipart/form-data`, campo de archivo `file`. El paciente se deriva del estudio en el backend. `201 {"data":{id,patientId,studyId,originalName,mimeType,sizeBytes,sha256,uploadedBy}}`. |
| `GET /api/documentos/{id}/content` | `documents.read` | Transmite PDF o imagen inline; imágenes requieren además `images.read`. |
| `GET /api/documentos/{id}/download` | `documents.download` | Descarga el contenido como archivo adjunto. |
| `PUT /api/documentos/{id}` | `documents.replace` | `multipart/form-data`, campo de archivo `file`; mantiene `documents.id`. `200 {"data":{id,patientId,studyId,originalName,mimeType,sizeBytes,sha256,updatedBy}}`. |
| `DELETE /api/documentos/{id}` | `documents.delete` | Elimina físicamente el archivo y su registro tras completar el journal. Respuesta `204` sin cuerpo. |

El código acepta PDF, DOC, DOCX, JPG/JPEG, PNG, GIF, WEBP y `.dcm`. DOC/DOCX están incluidos porque así lo valida actualmente `document-storage.js`, aunque los formatos originalmente previstos deben revisarse si se cambia esa política.

El soporte DICOM se limita al almacenamiento privado y la descarga autorizada de archivos originales, con SHA-256. Cada carga recibe un archivo; un estudio puede contener varios `.dcm`. Además de los controles generales de extensión/MIME, tamaño, nombre y ruta, la comprobación de contenido DICOM solo exige que no esté vacío: no interpreta `DICM`, tags o series ni valida completamente el formato. No hay visor, PACS, DICOMweb o integración con equipos, ni conversión a imágenes comunes. El inline solo se admite para PDF e imágenes; DICOM se descarga por `/download`.

Las pruebas registradas usaron DICOM sintéticos y comprobaron asociación, persistencia, bytes y hash. La compatibilidad con archivos DICOM reales representativos y sus tamaños sigue pendiente; no debe inferirse de esas pruebas.

Carga, reemplazo, descarga y eliminación dependen de que el almacenamiento esté configurado y listo; si no, pueden devolver `503`. Un tamaño superior a `MAX_FILE_SIZE_BYTES` produce `413 FILE_TOO_LARGE`. Extensión, MIME y firma de contenido incompatibles producen `415`; multipart o metadatos inválidos producen `400`. Documento o contenido ausente produce `404`; integridad SHA-256 inconsistente produce `409` y bloquea el almacenamiento para revisión.

### Respaldos y restauración

El router está montado en `/api/respaldos`. Todos sus endpoints requieren sesión y el permiso RBAC `backups.manage`; `sql/008_backup_restore.sql` prepara ese permiso para `administrador` y crea el journal del módulo. La migración es manual y su presencia en el repositorio no confirma que esté aplicada en una instalación.

La interfaz usa el selector de carpetas del navegador y requiere Chrome o Edge en un origen seguro. En la LAN se necesita HTTPS. El servidor no expone la ruta elegida por el usuario y transmite cada documento por una ruta protegida. La carpeta se considera completa solo después de escribir `manifest.json`.

| Método y ruta | Cuerpo / respuesta | Comportamiento |
| --- | --- | --- |
| `POST /api/respaldos/exportar` | JSON opcional `{ "incluirReferenciasUsuarios": false }`; `201 { "data": { operationId, formato, version, creadoEn, conteos, datos } }`. | Exporta pacientes, estudios y documentos activos; crea una operación que el navegador cierra al terminar de guardar. Las referencias de usuarios/roles son opcionales e informativas, sin contraseñas ni sesiones. |
| `GET /api/respaldos/resumen-clinico` | `200 { "data": { pacientes, estudios, documentos, muestraPacientes, hayMasPacientes } }`. | Devuelve conteos y una muestra limitada para advertir qué datos hay actualmente. |
| `GET /api/respaldos/documentos/{id}` | Respuesta binaria, con `Content-Disposition`, `Content-Length` y `X-Document-SHA256`. | Envía el documento por streaming después de comparar tamaño/hash. Usa auditoría `backup.document.export`; una discrepancia se registra sin bloquear globalmente el almacenamiento. |
| `POST /api/respaldos/exportar/{operationId}/completar` | `200 { "data": { operationId, completado: true } }`. | Registra el respaldo completado y audita la operación. El navegador lo solicita después de guardar manifiesto y archivos. |
| `POST /api/respaldos/restauraciones` | JSON `{ formato, version, modo, conteos }`; `201 { "data": { operationId, modo, estado: "recibiendo" } }`. | Inicia una preparación en modo `agregar` o `reemplazar`. |
| `POST /api/respaldos/restauraciones/{operationId}/registros` | JSON `{ tipo, registros }`; `201 { "data": { recibidos } }`. | Recibe lotes de 1 a 10 pacientes, estudios o documentos. Los IDs de origen deben ser positivos y únicos por tipo. |
| `POST /api/respaldos/restauraciones/{operationId}/documentos/{documentId}` | `multipart/form-data`, campo `file`; `201 { "data": { documentoId, recibido: true } }`. | Recibe cada archivo individual y comprueba nombre, MIME, tamaño y SHA-256 contra los metadatos recibidos. Requiere `FILE_STORAGE_ROOT` y `MAX_FILE_SIZE_BYTES`. |
| `POST /api/respaldos/restauraciones/{operationId}/confirmar` | `200 { "data": { operationId, modo, conteos, completado: true, limpiezaPendiente } }`. | Valida el conjunto completo antes de escribir. `agregar` crea IDs nuevos y permite DNI repetidos sin fusionar; `reemplazar` sustituye pacientes, estudios y documentos. Ambos conservan usuarios, roles, permisos y auditoría histórica y agregan un evento de auditoría de restauración. |
| `POST /api/respaldos/operaciones/{operationId}/cancelar` | `200 { "data": { operationId, cancelada: true } }`. | Cancela una operación propia aún en preparación. El journal se conserva si falla una limpieza necesaria. |

Los errores posibles incluyen `400` por opciones, lotes o rutas inválidos, `401` por falta de sesión, `403` por permiso u operación perteneciente a otra cuenta, `404` por operación/documento inexistente, `409` por estado o autores/servicios no disponibles, `422` por estructura, relaciones, conteos o integridad del archivo recibido incompatibles, `413` por límite de archivo o JSON y `503` por configuración ausente o MariaDB no disponible. El cuerpo sigue el formato común de error; `requestId` aparece según el handler. La interfaz divide los lotes por bytes UTF-8 y cantidad para respetar el límite JSON de 256 KiB.

La restauración reemplazante conserva la auditoría actual y no importa eventos históricos. El servidor no detiene globalmente la API; una transacción de reemplazo sí puede mantener bloqueos MariaDB sobre tablas clínicas durante su ejecución. Realizarla cuando haya pocos usuarios reduce interferencias. Si la respuesta informa `limpiezaPendiente`, los datos ya se confirmaron y queda trabajo físico registrado para revisión; no se afirma que una limpieza haya terminado hasta verificarla.

La recuperación conserva esa evidencia de commit mientras reintenta la limpieza y no la reclasifica como rollback. La cancelación sigue recuperable hasta limpiar y auditar; incluye filas históricas fallidas con detalles pendientes. Tras un resultado confirmado, la interfaz recarga la vista clínica. Los resultados y límites de las pruebas están en [la revisión del 26/10/2026](revision-general-hcv-2026-10-26.md).

## Errores y formato

La mayoría de los errores de API usan:

```json
{
  "error": {
    "code": "INVALID_ID",
    "message": "El identificador no es válido."
  }
}
```

El `requestId` aparece en algunas respuestas de error y en el header `X-Request-Id`; su presencia en el cuerpo depende del handler actual. No se debe asumir que todos los errores incluyen ese campo. El middleware global también responde `413 REQUEST_TOO_LARGE`, `400 INVALID_JSON` y `500 INTERNAL_ERROR` para errores de parser o no controlados. Las respuestas 404 de rutas API desconocidas usan `API_ROUTE_NOT_FOUND`.

Errores de aplicación relevantes verificados en los handlers y servicios:

| HTTP | Código | Condición |
| --- | --- | --- |
| `400` | `INVALID_ID` | Identificador de ruta ausente, mal formado o fuera del rango aceptado. |
| `400` | `INVALID_SEARCH` / `INVALID_PAGINATION` | Búsqueda de pacientes superior a 120 caracteres o página/tamaño inválido. |
| `400` | `INVALID_PATIENT` / `INVALID_STUDY` | Falla una validación de campos del cuerpo. |
| `400` | `VERSION_REQUIRED` | Una actualización de paciente o estudio no incluye una versión positiva. |
| `400` | `INVALID_MULTIPART` / `INVALID_FILENAME` | La carga no cumple el formato multipart o el nombre no es aceptable. |
| `401` | `UNAUTHENTICATED` | Falta una sesión autenticada válida. En login, `INVALID_LOGIN` significa que usuario/contraseña no son válidos o la cuenta no está activa. |
| `403` | `FORBIDDEN` | La sesión no tiene el permiso RBAC requerido. |
| `404` | `PATIENT_NOT_FOUND`, `STUDY_NOT_FOUND`, `DOCUMENT_NOT_FOUND` | No existe el recurso solicitado o el documento no está activo. |
| `409` | `CONFLICT` / `VERSION_CONFLICT` | Clave única en conflicto o el registro cambió desde la versión leída. |
| `409` | `DOCUMENT_INTEGRITY_MISMATCH` | Tamaño/hash del archivo no coincide con la metadata registrada; el almacenamiento se bloquea para revisión. |
| `413` | `FILE_TOO_LARGE` / `REQUEST_TOO_LARGE` | El archivo supera `MAX_FILE_SIZE_BYTES` o el JSON supera el límite del parser. |
| `415` | `UNSUPPORTED_FILE_TYPE`, `MIME_MISMATCH`, `INVALID_FILE_CONTENT`, `INLINE_NOT_SUPPORTED` | Tipo/contenido no permitido o formato que no tiene visualización inline. |
| `422` | `INVALID_DATA` | Los datos incumplen una restricción de MariaDB; `STUDY_DATE_IMMUTABLE` y `PATIENT_REASSIGNMENT_NOT_ALLOWED` protegen la fecha y la asociación del estudio. |
| `429` | `LOGIN_RATE_LIMITED` | Se superó el límite temporal de intentos; el servidor añade `Retry-After`. |
| `503` | `DATABASE_UNAVAILABLE`, `AUTH_UNAVAILABLE`, `FILE_STORAGE_NOT_CONFIGURED`, `FILE_UPLOAD_NOT_CONFIGURED`, `GENERAL_SERVICE_NOT_CONFIGURED`, `STORAGE_RECOVERY_REQUIRED` | Base/sesión, configuración de archivos, servicio GENERAL o recuperación no disponibles. |

La lista resume los errores observados y no reemplaza el código como fuente de verdad. Algunas respuestas de error específicas usan otro código para la misma clase de status, y el `requestId` en el cuerpo no es uniforme.

## Ejemplos sintéticos

Login (no guardar ni compartir la cookie):

```sh
curl -i -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"usuario-de-prueba","password":"<contraseña-local>"}' \
  http://127.0.0.1:3000/api/auth/login
```

Consultar sesión con esa cookie:

```sh
curl -i -b cookies.txt http://127.0.0.1:3000/api/auth/me
```

Crear estudio con datos sintéticos:

```sh
curl -i -b cookies.txt -H "Content-Type: application/json" \
  -d '{"patientId":"1","type":"Control","date":"2026-10-23"}' \
  http://127.0.0.1:3000/api/estudios
```

No incluyas contraseñas, cookies, tokens, datos reales ni archivos clínicos en capturas, tickets o documentación.

## Importar y probar la especificación

1. Abrí [`openapi-hcv.yaml`](openapi-hcv.yaml) en Swagger Editor o importalo en Postman como especificación OpenAPI. No hay un validador OpenAPI instalado en el proyecto: en Swagger Editor comprobá que el documento cargue sin errores de sintaxis YAML ni referencias `$ref` sin resolver. Hacelo con contratos y datos sintéticos; no pegues credenciales ni datos clínicos.
2. Configurá el servidor local mostrado por la aplicación (por ejemplo `http://127.0.0.1:3000`).
3. Ejecutá el login con una cuenta y datos sintéticos. La API responderá con `Set-Cookie`; los clientes compatibles deben conservar `hcv_session` para llamadas siguientes.
4. En Postman, habilitá el manejo de cookies para el host local. En herramientas que no persistan la cookie, guardala solo en la sesión local y enviala como cookie HTTP; no la pegues en documentación compartida.
5. Para probar autorización, usá una cuenta de prueba con el permiso requerido. No cambies roles de producción para una prueba.

Swagger Editor/Postman sirven para importar y ejercitar la especificación; la aplicación no integra Swagger UI.

## Cómo seguir y agregar un endpoint

Para entender una ruta, buscá primero su declaración en `src/routes/`. Seguí el controlador asociado, luego la función del servicio y finalmente los métodos del repositorio. Por ejemplo, `POST /api/estudios` está declarado en `routes/studies.js`, lo recibe `controllers/studies-controller.js`, valida y coordina en `services/study-service.js` y consulta MariaDB en `repositories/study-repository.js`.

Para agregar una operación existente al diseño por capas:

1. Declarar método, ruta, middlewares y controlador en el router del área.
2. Leer parámetros/cuerpo en el controlador y delegar sin trasladar reglas de negocio allí.
3. Validar y coordinar el caso de uso en el servicio; mantener objetos `req`/`res` fuera del servicio salvo que se necesite explícitamente un stream entrante.
4. Escribir consultas parametrizadas en el repositorio del área y mantener las transacciones en el caso de uso que las coordina.
5. Agregar el contrato y ejemplos en `docs/openapi-hcv.yaml` y su explicación en este documento. Verificar ruta, permisos, status, campos y errores contra el código y las pruebas.
6. Ejecutar las verificaciones seguras existentes y revisar el diff.

El repositorio no tiene un generador OpenAPI. Mantener ambas documentaciones actualizadas es parte del cambio del endpoint; Swagger UI tampoco está instalado.
