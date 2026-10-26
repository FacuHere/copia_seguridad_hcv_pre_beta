# Respaldos y restauración clínica

## Estado de la funcionalidad

La interfaz y las rutas del módulo están implementadas, pero dependen de que se aplique manualmente `sql/008_backup_restore.sql` en la base objetivo y de que estén disponibles el almacenamiento privado y el selector de carpetas del navegador. El 26/10/2026 se probaron HTTP, MariaDB 12.2.2 y Chrome con datos sintéticos en `hcv_test`; esa base fue restaurada a su estado previo y la 007 no quedó aplicada. El alcance y los fallos corregidos están en [la revisión general](revision-general-hcv-2026-10-26.md). El estado de aplicación de la migración en cada instalación debe comprobarse por separado.

El acceso se limita a cuentas con sesión y permiso RBAC `backups.manage`, que la migración asigna al rol `administrador`. El botón **Respaldos** se muestra a ese rol. La API sigue siendo la autoridad: ocultar el botón no sustituye su autorización.

## Formato de carpeta

El usuario selecciona una carpeta local con Chrome o Edge. En equipos de red, el sitio debe abrirse por HTTPS; `localhost` se considera origen seguro para desarrollo. La aplicación crea dentro del destino una carpeta nueva con esta estructura:

```text
Respaldo-HCV-AAAA-MM-DD-HHMMSS-<id>/
├── manifest.json
├── datos-clinicos.json
└── documentos/
    ├── D-<id> - <nombre>.pdf
    └── ...
```

`datos-clinicos.json` contiene pacientes, estudios y metadatos de documentos. Los archivos se copian en sus bytes originales. `manifest.json` se escribe al final e incluye formato/versión, conteos y SHA-256 de los datos y los archivos. Una carpeta sin manifiesto final se considera incompleta y no debe restaurarse.

No se crea ZIP ni se cifra el respaldo. La carpeta puede contener información clínica legible y debe protegerse con las medidas del medio de destino. El nombre físico es una etiqueta; MariaDB conserva las relaciones por IDs y el formato usa IDs de origen solo para reconstruir los vínculos al asignar IDs nuevos.

## Contenido y cuentas

El respaldo incluye todos los pacientes y estudios y solo documentos activos. Si hay operaciones documentales sin confirmar (`prepared`/`filesystem_applied`) o documentos en estados no activos, la API rechaza preparar el respaldo; esto no detiene el resto de la API. La limpieza residual de un journal documental `completed` se recupera por separado y no impide respaldar datos ya confirmados.

La casilla opcional **Incluir referencias de usuarios y roles** agrega nombres de usuario, nombres visibles, estado y códigos de roles/permisos como información. No incluye contraseñas ni sesiones. La restauración no importa esas referencias ni modifica cuentas, roles o permisos. Los autores clínicos del respaldo deben corresponder a usuarios ya existentes en el destino para conservar correctamente las claves foráneas. Los eventos históricos de auditoría tampoco se importan; la operación de restauración agrega su propio evento.

## Modos de restauración

Antes de iniciar, el navegador verifica el manifiesto, el hash del archivo de datos, los conteos, la lista de documentos y sus tamaños. El servidor vuelve a validar estructuras, relaciones paciente-estudio-documento, autores/servicios existentes, metadatos, tamaños y SHA-256 antes de tocar los datos actuales.

- **Agregar** inserta nuevos pacientes, estudios y documentos, con IDs nuevos. No fusiona ni busca coincidencias por DNI; un DNI repetido se admite como otro registro.
- **Reemplazar** sustituye pacientes, estudios y documentos actuales por el contenido validado del respaldo. La confirmación muestra conteos y hasta ocho nombres de pacientes actuales. Usuarios, roles, permisos y auditoría actual se conservan.

La restauración reemplazante coordina filesystem y MariaDB mediante un journal; no son una transacción única. Primero valida y prepara los archivos, luego cambia los registros clínicos dentro de una transacción y registra la limpieza física posterior. No conserva versiones históricas de los archivos reemplazados. Si una limpieza física falla después del commit, la interfaz informa que los datos ya fueron restaurados y que la limpieza requiere revisión técnica. El servidor no bloquea globalmente la API por errores del módulo. Una operación de reemplazo puede mantener bloqueos transaccionales en MariaDB mientras escribe los datos; realizarla en un período de poco uso reduce interferencias.

Un commit confirmado mantiene la fase `limpieza_pendiente` hasta terminar su limpieza; los reintentos no lo convierten en rollback. También se reconoce el estado histórico `requiere_atencion` con `RESTORE_FILE_CLEANUP_FAILED`. Si una versión anterior ya perdió esa evidencia y dejó `RECOVERY_FAILED`, el personal técnico debe inspeccionar el resultado antes de decidir: no se deduce automáticamente que la restauración haya fallado.

La cancelación conserva una fase recuperable hasta limpiar archivos y detalles y registrar su auditoría. La recuperación incluye cancelaciones históricas `fallido` que todavía tengan detalles pendientes. En la interfaz, los controles de carpetas, modo y ejecución quedan bloqueados durante cada operación; cambiar de sesión invalida sus referencias. Tras restaurar, se recarga el listado clínico y se descartan IDs/fichas anteriores al reemplazo.

Los lotes de la interfaz contienen como máximo cinco registros y 256 KiB de JSON UTF-8, incluido su sobre. Si un registro individual supera el límite, se informa antes de enviarlo; no se aumenta el límite global de Express. La API admite hasta diez registros por solicitud, siempre dentro del límite JSON.

## Rutas de la API

Todas requieren cookie `hcv_session` válida y `backups.manage`:

| Método y ruta | Función |
| --- | --- |
| `POST /api/respaldos/exportar` | Crea una instantánea clínica y una operación pendiente hasta que el navegador confirme que guardó la carpeta. |
| `GET /api/respaldos/resumen-clinico` | Devuelve conteos y una muestra de pacientes actuales para la previsualización de restauración. |
| `GET /api/respaldos/documentos/{id}` | Transmite un documento validado para guardarlo en la carpeta de respaldo; incluye el SHA-256 registrado en un encabezado de respuesta. |
| `POST /api/respaldos/exportar/{operationId}/completar` | Registra en auditoría que el navegador terminó y escribió el manifiesto. |
| `POST /api/respaldos/restauraciones` | Inicia la recepción de registros y selecciona `agregar` o `reemplazar`. |
| `POST /api/respaldos/restauraciones/{operationId}/registros` | Recibe lotes de hasta diez registros de un tipo. |
| `POST /api/respaldos/restauraciones/{operationId}/documentos/{documentId}` | Recibe y valida un archivo multipart individual. |
| `POST /api/respaldos/restauraciones/{operationId}/confirmar` | Valida el conjunto completo y aplica la restauración. |
| `POST /api/respaldos/operaciones/{operationId}/cancelar` | Cancela una preparación propia y limpia sus temporales. |

Los errores mantienen la forma común `{ error: { code, message, requestId? } }`. Las rutas de respaldo no convierten errores de integridad en un bloqueo global de almacenamiento.

## Configuración y operación

Para restaurar documentos, el servidor debe tener configurados `FILE_STORAGE_ROOT` y `MAX_FILE_SIZE_BYTES`. El valor de límite es obligatorio para recepción de archivos y debe ser suficientemente alto para cada archivo del respaldo. No hay un valor predeterminado definido aquí. La carpeta elegida por el administrador está en el equipo cliente; el servidor no recibe ni expone su ruta física.

El módulo no inicia ni detiene servicios y no aplica migraciones. Aplicar `sql/008_backup_restore.sql` manualmente después de 007_user_management_roles.sql y revisar el SQL, el estado real del esquema y los grants antes de habilitarlo. Además de los accesos clínicos/auditoría habituales, la cuenta de aplicación necesita `DELETE` en `patients` y `studies` para Reemplazar; `SELECT/INSERT/UPDATE` en `backup_restore_operations`; `SELECT/INSERT/DELETE` en `backup_restore_records`; y `SELECT/INSERT/UPDATE/DELETE` en `backup_restore_files`. No necesita DDL ni privilegios globales. Las pruebas con una conexión administrativa aislada no validan esos grants.

No considerar completa una copia que contenga solo MariaDB o solo archivos. Esta carpeta combina ambas partes y debe conservarse como unidad. La verificación del hash detecta alteraciones accidentales, pero no prueba autenticidad frente a alguien que pueda cambiar tanto el contenido como el manifiesto. No hay cifrado, firma de manifiesto, visor DICOM, backup automático ni restauración de cuentas.

## Verificación

Las regresiones versionadas cubren validadores, lectura de carpetas, lotes UTF-8, reentrada, cambios de sesión y estados de recuperación con filesystem temporal. Las pruebas HTTP/MariaDB y Playwright ejecutadas se detallan en [el registro de revisión](revision-general-hcv-2026-10-26.md). La suite habitual conserva adaptadores en memoria y no sustituye la comprobación con el motor real. Antes de uso operativo quedan pendientes los grants de la cuenta normal, el selector nativo de Windows, pruebas de infraestructura y la configuración definitiva. La presencia del SQL no demuestra que esté aplicado.
