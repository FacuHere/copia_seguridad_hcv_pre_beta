# Historial Clínico Visual

Aplicación web en transición desde un template local hacia una arquitectura cliente-servidor.

## Implementado

- Node.js y Express sirven la plantilla conservada desde `public/`.
- Configuración por `.env`; Express usa `PORT` y MariaDB usa `DB_PORT` (3306 como valor de ejemplo). Los puertos se validan completos y `HOST=0.0.0.0` está permitido para una futura escucha LAN.
- Pool MariaDB y consulta `GET /api/health/database`.
- Esquema SQL numerado para usuarios, servicios, pacientes, estudios, documentos, sesiones, permisos y auditoría.
- Login/logout con cookie HTTP-only, token de sesión almacenado como hash, contraseña hasheada con `scrypt`, registro de intentos fallidos y límite técnico de intentos por IP.
- Limpieza periódica de sesiones vencidas.
- API JSON de pacientes y estudios con consultas parametrizadas, transacciones, auditoría de lecturas/escrituras y control optimista mediante `version`.
- Almacenamiento privado de documentos en `FILE_STORAGE_ROOT`, separado del código y de `public/`; carga individual de PDF, JPG/JPEG, PNG, GIF, WEBP y DICOM `.dcm`, con SHA-256, visualización PDF/imágenes y descarga autorizada.
- Las cargas permanecen deshabilitadas hasta configurar `FILE_STORAGE_ROOT` y `MAX_FILE_SIZE_BYTES`. No se establece un límite de tamaño predeterminado.
- Reemplazo conservando el ID del documento, eliminación física confirmada y registro de operaciones pendientes para recuperación tras interrupciones.
- Módulo de respaldos clínicos en carpeta elegida por un administrador: incluye pacientes, estudios y documentos activos; permite restaurar agregando registros nuevos o reemplazando el conjunto clínico. La función requiere aplicar manualmente la migración 008, configuración de almacenamiento para documentos y un navegador compatible en origen seguro. Las pruebas aisladas de MariaDB y Chrome del 26/10/2026 y sus límites están registradas en [la revisión general](docs/revision-general-hcv-2026-10-26.md); no acreditan el despliegue ni los grants de otra instalación.
- Fecha de estudio inmutable después de su creación.
- Las rutas no reconocidas bajo `/api` responden JSON. Los errores internos se registran con identificador de solicitud y tipo/código de error, sin registrar contraseña, token, mensaje SQL ni parámetros.
- La autorización clínica falla cerrada mientras el alcance por servicio esté pendiente. El rol técnico inicial no tiene permisos clínicos.
- Bootstrap local del primer administrador, sin endpoint HTTP.

## Preparado pero pendiente

- Pacientes y estudios se consumen desde la API; el almacenamiento local que queda pertenece a tablas dinámicas y datos auxiliares del frontend.
- `role_service_permissions` prepara asignaciones de permisos por servicio; el middleware clínico aún no utiliza esta tabla, porque falta definir el modelo de acceso.
- Migraciones nuevas `006_documents_storage_lifecycle.sql` y `008_backup_restore.sql` requieren revisión y aplicación manual en orden. Node.js no las ejecuta automáticamente.
- El esquema contempla servicios extensibles y campos generales actuales del template como propuesta transitoria.
- La paginación simple existe en el listado de pacientes. La lista de estudios no está paginada; revisar límites cuando se conozcan volúmenes reales.

## Pendiente de definición funcional

- Campos, procesos, catálogos y validaciones de Anatomía Patológica, Cirugía Endoscópica y otros servicios.
- Matriz de roles/permisos, alcance de lectura y escritura por servicio, y qué datos generales del paciente puede ver cada perfil.
- Reglas de DNI, duplicados, reasignación de estudios, eliminación, retención y corrección de registros.
- Reglas definitivas para asociar documentos con pacientes/estudios, formatos, tamaño y conservación.
- Política de intentos de acceso y ajuste operativo del límite inicial de 10 fallos por 15 minutos con bloqueo de 15 minutos. El límite se aplica por IP; equipos detrás de una misma dirección pueden compartir el contador.
- Política institucional de contraseñas; el mínimo de 12 caracteres exigido por el bootstrap es un control técnico provisional.
- Retención de direcciones IP registradas en auditoría. El contador de limitación es temporal; los eventos de auditoría no se eliminan automáticamente.
- Requisitos de búsqueda y paginación a escala.

## Pendiente para producción

- Aplicar las migraciones revisadas `001` a `008` en orden sobre una base de desarrollo. El proyecto nunca las ejecuta automáticamente. La migración 008 prepara el permiso `backups.manage` y las tablas de journal de respaldo/restauración.
- Usar una cuenta MariaDB de aplicación distinta de `root`, sin privilegios DDL ni permisos de administración de MariaDB. El README técnico SQL detalla los privilegios previstos; no se creó ninguna cuenta.
- Definir `FILE_STORAGE_ROOT` en el `.env` local con una ruta absoluta fuera del proyecto y de `public/`; asegurar que la cuenta del servicio Node pueda leer/escribir y que los usuarios no autorizados del servidor no tengan acceso.
- Definir `MAX_FILE_SIZE_BYTES` tras relevar capacidad de disco, tamaños DICOM/PDF/imágenes y estrategia de respaldo. Sin ambos valores, la API rechaza carga/reemplazo.
- Revisar y aplicar manualmente `sql/006_documents_storage_lifecycle.sql` después de las migraciones anteriores. Verificar primero que `documents.patient_id`, `study_id` y `sha256` no tengan NULL; la migración se detiene si no cumple la precondición. Ajustar los privilegios de `historial_app` para SELECT/INSERT/UPDATE/DELETE en `documents`, SELECT en `studies` y `patients`, INSERT en `audit_events`, y acceso de lectura/escritura a `document_file_operations`; no requiere DDL desde la aplicación.
- Los DICOM se conservan byte a byte. Para `.dcm` se comprueban extensión/MIME permitidos y contenido no vacío; no se exige ni se interpreta el marcador `DICM`. Estos controles no validan la estructura ni la semántica DICOM.
- Una copia funcional debe incluir conjuntamente MariaDB y el contenido completo de `FILE_STORAGE_ROOT`. Una copia de solo uno de ambos componentes no constituye un backup restaurable.
- Para crear o restaurar una carpeta de respaldo, la interfaz requiere Chrome o Edge con File System Access API y un origen seguro. `localhost` es válido para desarrollo; en la LAN se debe publicar mediante HTTPS. La carpeta elegida reside en el equipo del navegador. No se configura TLS automáticamente.
- El modo **Agregar** crea pacientes, estudios y documentos con IDs nuevos y permite pacientes con DNI repetido sin fusionarlos. **Reemplazar** cambia el conjunto clínico tras validar la carpeta y confirmar; conserva cuentas, roles, permisos y auditoría histórica. No importa contraseñas, sesiones ni eventos de auditoría del respaldo. Realizar restauraciones en períodos de poco uso: el servidor no detiene globalmente la API, aunque la transacción de reemplazo puede mantener bloqueos en MariaDB.

### Almacenamiento de documentos

Los archivos nunca se sirven con `express.static` y nunca se guardan en `public/`. La jerarquía usa IDs estables (`P-<id>`, `E-<id>`, `D-<id>`) y etiquetas humanas sanitizadas; `storage_key` es una clave relativa privada, nunca una ruta absoluta. El nombre original completo se conserva en MariaDB.

El soporte actual de DICOM permite cargar individualmente varios `.dcm` en un mismo estudio, conservar sus bytes originales, calcular SHA-256 y descargarlos con autorización. No interpreta tags o series ni incorpora visor DICOM, PACS, DICOMweb o integración con equipos médicos; tampoco convierte los archivos a JPG/PNG. No se presupone que un `.dcm` represente una serie completa.

Las [pruebas documentadas](docs/prueba-carga-respaldo-3306-2026-10-26.md) utilizaron archivos DICOM sintéticos. Queda pendiente comprobar compatibilidad con DICOM reales representativos y sus tamaños; la preservación de bytes y el hash no acreditan conformidad completa ni compatibilidad con todos los archivos o equipos.

Al iniciar, el servidor recupera las operaciones documentales registradas antes de aceptar solicitudes. No utiliza un lease global ni crea, lee o requiere `.staging/.service.lock`; si ese marcador existe de una versión anterior, se ignora y se conserva. Se espera una sola instancia de API por raíz de almacenamiento; la aplicación no coordina varias instancias compartiendo la misma raíz. La concurrencia normal de solicitudes se controla por operación y documento mediante transacciones y estados del journal. Si una recuperación queda sin resolver o staging contiene entradas desconocidas, las operaciones que acceden o modifican archivos quedan temporalmente bloqueadas; login y funciones independientes de los documentos siguen disponibles. `GET /api/health/database` y `GET /api/health/storage` permanecen disponibles para diagnóstico. Tras recuperar el journal, el servidor elimina únicamente temporales con nombre aleatorio reconocido y sin referencia a una operación activa. Los nombres desconocidos en staging requieren inspección manual. La limpieza se limita a `FILE_STORAGE_ROOT`.

La validación de rutas y enlaces es una defensa de aplicación, no sustituye las ACL de Windows. Configure la raíz fuera del proyecto con permisos de lectura/escritura solo para la cuenta del servicio Node y los administradores del servidor. Las comprobaciones de filesystem no eliminan todas las carreras frente a otro proceso con permisos para modificar esa carpeta; limite quién puede acceder a ella y evite ejecutar más de una instancia concurrente sobre la misma raíz.

Ejemplo de configuración local (no copiar un límite inventado):

```dotenv
FILE_STORAGE_ROOT=E:\HistorialClinico
MAX_FILE_SIZE_BYTES=<definir luego del relevamiento>
```

La migración 006 prepara el estado del archivo, metadata de reemplazo/derivación y un journal para recuperar cargas, reemplazos, eliminaciones y movimientos de etiquetas de carpetas interrumpidos. Ejecutar la migración antes de usar rutas documentales. No se incluye todavía un visor DICOM, procesamiento/firma PDF ni backup automático.

Si se modifica el DNI/nombre del paciente o el tipo del estudio, el backend actualiza las claves relativas y mueve las carpetas con IDs estables. Ante una operación de archivo simultánea, deja el cambio registrado como pendiente para completarlo al reiniciar; los documentos en movimiento no se muestran hasta verificar su integridad.
- Crear el primer administrador con el procedimiento local que sigue.
- Definir HTTPS/TLS, certificados, firewall, acceso LAN, copias de seguridad coordinadas de MariaDB y documentos, monitoreo y restauración.
- Revisar campos y permisos con los servicios antes de cargar datos reales. El sistema no está preparado para datos clínicos reales.

## Inicio del servidor

1. Copie `.env.example` a `.env` y configure la conexión MariaDB con una cuenta de aplicación no administrativa.
2. Aplique las migraciones solo en una base de desarrollo revisada y con una cuenta de esquema autorizada; consulte las precondiciones de `006` y `008` en `sql/README.md`.
3. Ejecute `npm install` y `npm start`.
4. Abra `http://localhost:3000`.

Para escuchar en la LAN, configure `HOST=0.0.0.0` y `PORT=3000`, y gestione el firewall del servidor. Esto solo habilita la escucha de red: **no cifra ni protege por sí mismo credenciales o datos clínicos**. No usar HTTP plano para producción hospitalaria. `COOKIE_SECURE=true` se requiere al publicar detrás de HTTPS; el ejemplo `false` es solo para desarrollo local.

## Bootstrap del primer administrador

El bootstrap necesita que las migraciones `001`–`003` estén aplicadas y que `app_users` no contenga ninguna cuenta. La migración `003` crea el rol `system_admin` con exactamente `users.manage` y `roles.manage`; no le concede acceso clínico ni permisos por servicio.

1. El responsable de MariaDB crea una cuenta temporal de bootstrap con acceso al servidor/base y permisos mínimos: `SELECT` en `app_users`, `roles`, `permissions`, `role_permissions` y `role_service_permissions`; `INSERT` en `app_users`, `user_roles` y `audit_events`. No necesita DDL, permisos globales ni acceso a datos clínicos.
2. Copie `.env.bootstrap.example` como `.env.bootstrap` y complete allí `DB_USER` y `DB_PASSWORD` de esa cuenta temporal. El archivo está excluido de Git y no lo lee Express.
3. Verifique que `.env` contiene `DB_HOST`, `DB_PORT` y `DB_NAME` para la base objetivo. La herramienta tomará de `.env.bootstrap` solo las credenciales MariaDB de bootstrap.
4. Desde una terminal interactiva en el servidor, ejecute `npm run bootstrap:admin`. Ingrese usuario, nombre y contraseña en los prompts; la contraseña no se muestra, debe tener al menos 12 caracteres y se solicita dos veces. No acepta argumentos.
5. Proteja `.env.bootstrap` con permisos del sistema operativo para que solo el operador pueda leerlo. Al terminar, revoque/elimine la cuenta temporal según el procedimiento del administrador y retire `.env.bootstrap`. No reutilice esas credenciales para Express.

El comando adquiere un bloqueo MariaDB, vuelve a comprobar que no existan usuarios y que el rol tenga exactamente los dos permisos técnicos esperados y ningún permiso por servicio. Crea el usuario, la asignación estándar de rol y un evento de auditoría en una transacción. Si una comprobación falla, no crea la cuenta.

## Migraciones

`CREATE TABLE IF NOT EXISTS` evita el error cuando una tabla ya existe, pero **no compara ni corrige su estructura**. Consulte [sql/README.md](sql/README.md) antes de aplicar scripts; allí se describe la estrategia de versionado propuesta. No aplique scripts contra una base con datos reales sin revisar el plan y respaldo.

## Restablecimiento local de contraseña

`npm run reset:password` solicita usuario y contraseña desde una terminal interactiva; no acepta la contraseña como argumento. Configure una cuenta local de recuperación mediante `.env.password-reset`, usando `.env.password-reset.example` como plantilla. Este archivo es independiente del `.env` de la API y no debe compartirse ni versionarse.

La cuenta de recuperación requiere `SELECT` y `UPDATE` en `app_users`, `DELETE` en `app_sessions` e `INSERT` en `audit_events` de la base elegida. No necesita DDL ni privilegios globales. La actualización del hash, la revocación de todas las sesiones de ese usuario y la auditoría forman una sola transacción: si falla algún paso, se revierte. Quien tenía una sesión anterior debe iniciar sesión nuevamente.

## Registro de revisión y pruebas

[Revisión general del 26/10/2026](docs/revision-general-hcv-2026-10-26.md): fallos encontrados, archivos corregidos, regresiones, pruebas HTTP/MariaDB y navegador, y limitaciones pendientes. Los cambios de funcionamiento deben mantener también actualizados los contratos en `docs/api-rest-hcv.md` y `docs/openapi-hcv.yaml`.
