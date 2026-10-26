# Esquema inicial de base de datos

`001_initial_schema.sql` define una propuesta relacional inicial para MariaDB/InnoDB. No crea la base ni inserta usuarios o servicios. `002_auth_sessions.sql` agrega sesiones persistentes. `003_security_scope_and_bootstrap.sql` prepara asignaciones de permisos por servicio, límites de login, integridad entre documentos y estudios, y el rol técnico inicial. `004_functional_roles_permissions.sql` agrega el catálogo de permisos funcionales y los roles `visualizador` y `administrador`, sin asignarlos a usuarios. `005_seed_general_service.sql` asegura el servicio técnico `GENERAL` requerido por `studies.service_id`; no lo utiliza para autorizar operaciones. `006_documents_storage_lifecycle.sql` implementa nulabilidad, metadata y journal documental. `008_backup_restore.sql` prepara el permiso de respaldo y tres tablas de operaciones/staging. Las migraciones deben revisarse y ejecutarse en orden, explícitamente, sobre una base de desarrollo; este proyecto no las ejecuta automáticamente.

## Entidades

- `services`: catálogo extensible de servicios.
- `app_users`: cuentas de acceso, con el hash de contraseña producido por el backend.
- `roles`, `permissions`, `user_roles`, `role_permissions`: estructura RBAC flexible; no determina todavía permisos clínicos.
- `user_services`: pertenencia organizativa; no concede por sí sola acceso a datos.
- `patients`: campos actuales de la ficha, mantenidos como propuesta transitoria.
- `studies`: relación paciente/servicio y campos del template como campos generales provisionales.
- `documents`: metadatos y clave relativa para archivos en almacenamiento privado del servidor.
- `audit_events`: eventos mínimos sin guardar el contenido de la historia clínica.
- `documents`: desde la migración 006 requiere paciente, estudio y SHA-256 no nulos.
- `document_file_operations`: journal técnico de cargas, reemplazos, eliminaciones y estados que deban recuperarse.
- `backup_restore_operations`, `backup_restore_records`, `backup_restore_files`: journal temporal para operaciones de respaldo/restauración, registros recibidos y movimientos de archivos. No son una papelera ni almacenan de forma permanente los bytes clínicos.
- `app_sessions`: sesiones con token aleatorio guardado únicamente como hash.
- `auth_login_attempts`: contador temporal de intentos fallidos por IP; no guarda nombres de usuario ni contraseñas.
- `role_service_permissions`: estructura heredada para vincular permisos de un rol a un servicio concreto. No participa en la autorización de esta instalación de servicio único.

Las claves foráneas usan restricciones para impedir borrar registros referenciados. Las tablas de unión permiten eliminar asignaciones al borrar una cuenta; las cuentas vinculadas a datos clínicos deben desactivarse, no borrarse. `version` en pacientes y estudios prepara actualizaciones optimistas para detectar cambios concurrentes.

## Pendiente de definición

- Campos y procesos definitivos de cada servicio, y si `diagnosis`, `procedure_description`, `description` y `conclusions` son adecuados.
- DNI obligatorio o único; se indexa, pero deliberadamente no se impone unicidad.
- Alcance de permisos por servicio. El esquema incluye roles globales y afiliación a servicios, pero no asignación de roles por servicio.
- Política de conservación y eliminación. Por eso no se implementa borrado en cascada para pacientes, estudios o documentos.
- Requisitos de integridad para documentos (asociación obligatoria a paciente, estudio o ambos), tipos MIME, tamaño y retención.
- Motor y versión exactos de MariaDB. El esquema evita tipos JSON nativos y restricciones `CHECK` para favorecer compatibilidad; `details_json` debe contener JSON producido por la aplicación.
- Estrategia de búsqueda de nombres. El índice normal ayuda a igualdad/prefijos, pero no optimiza búsquedas con comodín inicial.

La migración 003 agrega una clave única `(id, patient_id)` en `studies` y una clave foránea compuesta desde `(documents.study_id, documents.patient_id)`. La migración 006 hace obligatorios ambos vínculos y SHA-256. El backend deriva `patient_id` desde el estudio seleccionado, nunca desde un valor confiado del cliente.

La migración 003 siembra únicamente `system_admin` y los permisos técnicos `users.manage` y `roles.manage`; no le concede permisos clínicos. El bootstrap verifica que este rol tenga exactamente esos dos permisos globales y ningún permiso por servicio. La migración 004 crea los roles funcionales y les asigna permisos explícitos; no asigna esos roles a usuarios ni modifica `system_admin`.

La migración 005 crea o actualiza el registro `GENERAL` que exige la FK de `studies.service_id`. El backend lo resuelve internamente para guardar estudios; no es un criterio de autorización ni un filtro por servicio.

Las tablas ABM dinámicas se omiten en esta primera estructura. No se generarán tablas SQL desde definiciones de usuarios.

La autenticación y las APIs necesitan que las tres migraciones se hayan aplicado y que exista una cuenta activa con contraseña hasheada. La provisión inicial se realiza con `npm run bootstrap:admin`, desde una terminal local y usando credenciales temporales separadas; no hay un endpoint HTTP para crear el primer administrador.

El middleware comprueba autenticación y la relación `user_roles` → `role_permissions` → `permissions`. No consulta `services`, `user_services` ni `role_service_permissions` para autorizar operaciones clínicas. La migración 006 asigna `documents.upload`, `documents.replace` y `documents.delete` únicamente a `administrador`; el visualizador conserva lectura/descarga/imagen de 004. El rol `system_admin` no recibe permisos clínicos automáticamente.

## Migraciones y datos existentes

`CREATE TABLE IF NOT EXISTS` no compara columnas, índices ni claves foráneas de una tabla ya creada. Tampoco convierte un script parcialmente aplicado en una migración segura para volver a ejecutar. La migración 003 contiene `ALTER TABLE`, por lo que no es repetible sin revisar el estado.

Estrategia simple antes de utilizar datos reales: mantener archivos numerados e inmutables; probarlos primero sobre una base de desarrollo; registrar manualmente en un acta de despliegue el archivo, checksum, fecha, operador y resultado; y comprobar la estructura tras cada aplicación. Antes de producción, incorporar una tabla `schema_migrations` con versión y checksum y un ejecutor pequeño que aplique cada versión una sola vez. Si un script falla parcialmente, detenerse e inspeccionar la estructura antes de continuar; no volver a ejecutarlo a ciegas.

## Cuentas MariaDB

No se creó ninguna cuenta. Para producción, Express debe usar un usuario de aplicación distinto de `root`, sin permisos DDL ni administración global. Debe recibir únicamente las operaciones requeridas sobre las tablas de la aplicación y permisos específicos para mantener sesiones/contadores. Las migraciones deben ejecutarse por separado con una cuenta autorizada de esquema.

Privilegios de partida para revisar: `SELECT` en `app_users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_services`, `role_service_permissions`, `services`, `patients` y `studies`; `INSERT`/`UPDATE` en pacientes/estudios; `INSERT` en auditoría; `INSERT` y `DELETE` en sesiones; y `SELECT`/`INSERT`/`UPDATE`/`DELETE` en `auth_login_attempts` para el limitador. No otorgar `CREATE`, `ALTER`, `DROP`, `GRANT OPTION` ni privilegios globales a Express. Ajustar los grants a cada despliegue y revisar las claves foráneas al definir el usuario real.

El bootstrap usa credenciales temporales de MariaDB en `.env.bootstrap`; su alcance debe limitarse a leer `app_users`, `roles`, `permissions`, `role_permissions` y `role_service_permissions`, y a insertar en `app_users`, `user_roles` y `audit_events`. No incluya esas credenciales en `.env` de Express ni las reutilice como cuenta de ejecución.

El limitador usa un umbral técnico provisional de 10 fallos por IP en 15 minutos y bloquea esa IP durante 15 minutos. Los fallos con formato válido se escriben en `audit_events` sin guardar el usuario intentado; los intentos posteriores ya bloqueados y las solicitudes con formato inválido no generan un evento por cada solicitud para evitar crecimiento por inundación. La tabla de contadores se limpia oportunistamente y los contadores por IP antiguos se eliminan durante un intento nuevo. Los eventos de auditoría no tienen retención automática, incluida la IP registrada; su plazo debe definirse antes del uso hospitalario.
La migración `006_documents_storage_lifecycle.sql` debe revisarse y ejecutarse manualmente después de 005. No es repetible: su `ALTER TABLE` y `CREATE TABLE` no usan guardas para objetos ya existentes. Antes de cualquier cambio estructural, comprobar que no haya documentos con `patient_id`, `study_id` o `sha256` NULL, y verificar que las columnas, índices, restricciones y tabla de operaciones que agrega no existan ya. No modifica ni rellena filas clínicas.

Procedimiento de aplicación: respaldar MariaDB y el repositorio de archivos juntos si ya contienen documentos; probar primero en una copia desechable del esquema; ejecutar únicamente con una cuenta autorizada para DDL y registrar migración, checksum, operador, hora y resultado. Aplicar 006 una sola vez después de 001–005. Tras ejecutarla, inspeccionar `SHOW CREATE TABLE documents`, `SHOW CREATE TABLE document_file_operations`, índices/FKs y grants antes de iniciar la aplicación con almacenamiento habilitado.

Comprobación de NULL, antes de cualquier DDL (solo lectura):

```sql
SELECT
  SUM(patient_id IS NULL) AS patient_id_nulls,
  SUM(study_id IS NULL) AS study_id_nulls,
  SUM(sha256 IS NULL) AS sha256_nulls
FROM documents;
```

Los tres resultados deben ser cero. Antes de aplicar, revisar también `SHOW CREATE TABLE documents` y confirmar que no existan ya `file_status`, `updated_at`, `updated_by`, `derived_from_document_id`, el índice `idx_documents_derived_from` ni las FKs `fk_documents_updated_by`/`fk_documents_derived_from`; verificar que no exista `document_file_operations`. Después, revisar las asignaciones de los permisos nuevos a `administrador` y confirmar que `visualizador` y `system_admin` no recibieron permisos documentales de escritura.

La sentencia `ALTER TABLE` cambia la nulabilidad de tres columnas, agrega estado y metadata de actualización/derivación, un índice y dos FKs. Luego crea `document_file_operations`; finalmente siembra tres permisos y asignaciones al rol `administrador`. Un fallo posterior al `ALTER` puede dejar una aplicación parcial; no volver a ejecutar el archivo completo a ciegas. Inspeccionar cada objeto en `information_schema`/`SHOW CREATE TABLE`, identificar la última sentencia efectivamente aplicada y continuar con una reparación revisada que omita únicamente los pasos ya confirmados. Si hay datos NULL, detenerse antes de DDL y definir una migración de datos explícita; no inventar asociación ni SHA-256.

Después de aplicar 006, revisar los GRANT de la cuenta de aplicación: SELECT/INSERT/UPDATE/DELETE sobre `documents`, SELECT sobre `studies` y `patients`, INSERT sobre `audit_events`, y SELECT/INSERT/UPDATE sobre `document_file_operations`. Los GRANT de cuentas MariaDB no pueden ser otorgados por esta migración de esquema.

### Migración 008: respaldos y restauración

`008_backup_restore.sql` está destinada a aplicarse manualmente después de 006. Inserta de forma idempotente el permiso `backups.manage`, lo asigna únicamente al rol funcional `administrador` y crea `backup_restore_operations`, `backup_restore_records` y `backup_restore_files` con `CREATE TABLE IF NOT EXISTS`. No crea ni modifica usuarios, datos clínicos, documentos, servicios o archivos físicos. No concede GRANT MariaDB.

Antes de aplicarla, confirmar que `001`–`006` están aplicadas y que las tres tablas aún no existen parcialmente. Revisar en `SHOW CREATE TABLE` cualquier objeto homónimo ya existente: `IF NOT EXISTS` no compara ni repara estructuras. Confirmar que existan `permissions`, `role_permissions`, `roles.code`, `app_users` y el rol `administrador`. Respaldar la base según el procedimiento aprobado para ese entorno. Si una sentencia falla, detenerse, registrar la última sentencia confirmada e inspeccionar `SHOW CREATE TABLE`, `information_schema` y las filas del permiso/asignación; continuar con un plan revisado que no vuelva a ejecutar ciegamente el archivo completo.

Privilegios adicionales mínimos de la cuenta de aplicación para 008:

| Tabla | Privilegios |
| --- | --- |
| `backup_restore_operations` | `SELECT`, `INSERT`, `UPDATE` |
| `backup_restore_records` | `SELECT`, `INSERT`, `DELETE` |
| `backup_restore_files` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `patients`, `studies` | `DELETE` para el modo Reemplazar, además de sus accesos clínicos habituales |

También se mantienen los accesos existentes a `documents`, referencias clínicas y auditoría. No necesita `CREATE`, `ALTER`, `DROP`, `GRANT OPTION` ni privilegios globales. Inspeccionar los grants vigentes y conceder únicamente lo que falte mediante un procedimiento autorizado; estas pruebas no los modificaron. La migración solo prepara RBAC de aplicación (`backups.manage`); el usuario MariaDB no determina ese permiso.

Orden canónico acordado para nuevas instalaciones: 007_user_management_roles.sql (usuarios), seguido de 008_backup_restore.sql (respaldos). El script de respaldos se probó y aplicó anteriormente bajo el nombre 007_backup_restore.sql; el cambio de nombre conserva exactamente su contenido. Los informes históricos mantienen ese nombre como evidencia. En una base donde ya se aplicó, comprobar sus objetos y checksum: no ejecutarlo de nuevo por el mero cambio de número. Esta renumeración no altera bases de datos ni aplica la migración de usuarios pendiente.
