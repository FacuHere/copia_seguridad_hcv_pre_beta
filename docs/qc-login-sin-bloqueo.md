# QC del inicio de sesión sin bloqueo por fallos

Fecha: 30 de octubre de 2026.

## Decisión y defecto

Se retira el bloqueo automático por intentos fallidos a pedido del responsable del proyecto. El contador anterior agrupaba todos los errores por IP y, tras diez fallos dentro de quince minutos, impedía ingresar durante quince minutos incluso con credenciales correctas. Esto podía afectar a varias personas en un puesto compartido o a varios puestos que llegaran con una misma IP por proxy o NAT.

Cada solicitud vuelve a validar formato, cuenta activa y contraseña. Los fallos no bloquean cuentas ni direcciones IP y no agregan esperas progresivas. Se conserva la auditoría de fallos con formato válido, el hash de contraseñas, las sesiones y los permisos existentes. La auditoría registra eventos; no limita la cantidad de intentos de contraseña.

El login ya no consulta ni modifica `auth_login_attempts`. La tabla y la migración histórica se conservan; sus filas no afectan el ingreso y no es necesario borrarlas. No se modificaron bases de datos, migraciones, credenciales ni configuración de proxy.

## Casos automatizados

Pruebas en [test/auth.test.js](../test/auth.test.js), con HTTP local, contraseñas sintéticas y dobles del repositorio, sin conexiones a MariaDB.

| Caso | Escenario y resultado esperado | Resultado |
| --- | --- | --- |
| QC-LOGIN-01 | Doce contraseñas incorrectas de una cuenta desde la misma IP: todas devuelven `401 INVALID_LOGIN`, sin cookie, `429` ni `Retry-After`. No crean sesiones y cada fallo se audita. | Aprobado |
| QC-LOGIN-02 | Inmediatamente después de esos fallos, ingresar con contraseña correcta de esa cuenta y de otra desde la misma IP. Ambas reciben `200`, cookie HttpOnly y sesión de ocho horas con token almacenado como SHA-256. | Aprobado |
| QC-LOGIN-03 | Acumular doce fallos de distintas cuentas, incluidas una inexistente y una inactiva, y luego ingresar con una cuenta activa desde la IP compartida. No se impide el ingreso válido. | Aprobado |
| QC-LOGIN-04 | Una cuenta inactiva con contraseña correcta sigue recibiendo `401 INVALID_LOGIN` sin crear sesión. | Aprobado |
| QC-LOGIN-05 | Credenciales vacías o de tipo incorrecto: `400 INVALID_CREDENTIALS_FORMAT`, sin acceso a MariaDB, auditoría de fallo ni sesión. | Aprobado |
| QC-LOGIN-06 | Si falla la auditoría, la transacción se revierte y la conexión se libera. | Aprobado |

Ejecuciones:

- `npm test -- test/auth.test.js`: cuatro pruebas aprobadas.
- `npm test`, con `HCV_MARIADB_INTEGRATION=0` y `HCV_MARIADB_USERS_INTEGRATION=0`: 105 pruebas, 102 aprobadas, ninguna fallida y tres omitidas. Dos requieren autorización/configuración de MariaDB real; la restante requiere crear un enlace simbólico que este entorno no permite.
- `git diff --check`: sin errores de espacios.
- Documento de casos de uso: actualizado HU-01 y comprobado visualmente mediante exportación de Word; el renderizador habitual no está disponible porque falta LibreOffice. Los demás contenidos y recursos del documento se preservaron.

La primera ejecución HTTP no pudo conectarse al servidor local por una restricción del entorno. La repetición con acceso local permitido y la suite completa finalizaron correctamente.

## TC-015 con Behave y Playwright (16/11/2026)

Trazabilidad: **RN-001 → RF-1.1 → HU-01 → TC-015**. El escenario está en [autenticacion.feature](../features/autenticacion.feature), las acciones y comprobaciones en [steps/autenticacion.py](../features/steps/autenticacion.py), y la preparación del navegador y las cuentas en [environment.py](../features/environment.py).

Entorno ejecutado: `http://127.0.0.1:3002`, proyecto Docker `hcv_docker_beta_test`, API Express y MariaDB reales del entorno beta, Chromium de Playwright en modo sin ventana. Versiones: Python 3.14.5, Behave 1.3.3 y Playwright 1.65.2. Se verificó primero el ingreso y cierre de sesión de las dos cuentas activas de prueba; luego se realizaron los doce intentos incorrectos y el ingreso inmediato de la otra cuenta.

| Ejecución | Resultado observado | Evidencia |
| --- | --- | --- |
| TC-015-20261116-150951 | Fallido: diez respuestas `401`, dos `429` y posterior ingreso válido de A rechazado con `429` y `Retry-After: 899`. Cuatro pasos aprobados, uno fallido y uno omitido. | [Reporte anterior a la actualización](../reports/qc/TC-015-20261116-150951.json) |
| TC-015-20261116-151206 | Aprobado: doce respuestas `401`; A ingresó con `200`, se confirmó su identidad mediante `/api/auth/me` y la interfaz, y no se exigió espera. Seis pasos aprobados, ninguno fallido ni omitido. | [Reporte posterior a la actualización](../reports/qc/TC-015-20261116-151206.json) |

La primera ejecución completa reprodujo el defecto porque Docker conservaba código de bloqueo en el servicio y repositorio de autenticación. Se reconstruyó la imagen con el código actual del proyecto y se recreó únicamente el servicio `api` mediante `up -d --no-deps --no-build --wait`. No se cambiaron las expectativas del escenario para obtener la aprobación.

- Imagen anterior: `sha256:c58521b74fd11d5193d27f0e5d4382936c30951887c98104c2f662918e63d72e`.
- Imagen aprobada: `sha256:cbc73deae761e1ceacdd21a9e0a30c4330337e8f47df94340721ef5983ddc6cb`.

MariaDB y phpMyAdmin conservaron sus contenedores y volúmenes. No se ejecutaron migraciones, inicializadores ni borrado de contadores o datos. Los inicios de sesión y las consultas de la aplicación generaron las sesiones y auditorías normales. La tabla heredada de intentos se conservó y el código actualizado dejó de utilizarla.

Se corrigieron dos problemas de automatización: búsquedas de campos restringidas a `loginForm`, y espera de la aplicación después de un ingreso aceptado, reservando la espera del error y del botón habilitado para los rechazos. La ejecución puede solicitar las credenciales por consola o leer las cuatro variables de proceso `HCV_QC_USUARIO_A`, `HCV_QC_CONTRASENA_A`, `HCV_QC_USUARIO_M` y `HCV_QC_CONTRASENA_M`. Las contraseñas utilizadas no se incorporaron a los archivos de código, escenarios o reportes de estas ejecuciones.

También se repitió `npm test -- test/auth.test.js`: cuatro pruebas aprobadas, sin acceso a MariaDB. El fallo y la aprobación del navegador corresponden a dos imágenes diferentes; se preservan ambos reportes. Los escenarios, sus implementaciones y los resultados regenerados constituyen la primera documentación ejecutable de este caso; la ejecución periódica en CI continúa pendiente.

Este resultado automatizado se registra separado del estado manual del Word. No acredita TC-014 (la propia cuenta después de errores), TC-016 (dos equipos con IP compartida), HTTPS ni aceptación en la red del hospital.

## Comprobación manual pendiente

Realizar en el entorno de QC con dos cuentas de prueba activas, después de reiniciar el servidor con el código actualizado y recargar la página:

1. Desde el mismo navegador, ingresar al menos doce veces una contraseña incorrecta para la primera cuenta. Debe mostrarse «Usuario o contraseña incorrectos» sin espera ni bloqueo temporal.
2. Ingresar inmediatamente la contraseña correcta de esa cuenta. Debe abrirse la aplicación.
3. Cerrar la sesión e ingresar con la segunda cuenta desde el mismo equipo. También debe acceder.
4. Repetir acumulando fallos de ambas cuentas desde el puesto compartido. Verificar después el acceso de las dos con credenciales válidas.
5. Si el entorno usa proxy o NAT, repetir desde dos equipos que el servidor vea bajo la misma IP. Los fallos de uno no deben impedir el ingreso del otro.

Los casos con dobles de repositorio no acreditan por sí solos una ejecución en navegador o con MariaDB real. La ejecución integrada de TC-015 se registra por separado arriba; la aceptación manual y la comprobación en la red del hospital siguen pendientes. No se marca el defecto como cerrado por QC hospitalario.

Contratos actualizados en [API REST](api-rest-hcv.md) y [OpenAPI](openapi-hcv.yaml); HU-01 actualizado en `Casos de uso HCV.docx`.

## Archivos del cambio

- `src/services/auth-service.js`: retiro del control de intentos y del error de bloqueo.
- `src/repositories/auth-repository.js`: retiro de consultas y métodos del contador.
- `public/js/app.js`: retiro del mensaje de bloqueo temporal.
- `test/auth.test.js`: pruebas de regresión del login y controles conservados.
- `docs/api-rest-hcv.md` y `docs/openapi-hcv.yaml`: contrato de login sin bloqueo por fallos.
- `README.md` y `sql/README.md`: comportamiento operativo y tabla heredada sin uso.
- `docs/Casos de uso HCV.docx`: actualización limitada a HU-01.
- `docs/qc-login-sin-bloqueo.md`: decisión, resultados y aceptación manual pendiente.

Los cambios previos del proyecto se conservaron. El reporte Word externo aportado para testing no pudo leerse porque otro proceso mantiene el archivo abierto con acceso exclusivo; su revisión queda pendiente.
