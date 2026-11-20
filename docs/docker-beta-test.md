# Docker beta: usuarios, documentos y respaldos

## Alcance e independencia

Este procedimiento prepara una instalación **nueva de pruebas** del código actual, incluidos Gestión de usuarios y Respaldos. El proyecto Compose se llama `hcv_docker_beta_test`; su imagen propia de API es `hcv_docker_beta_test-api:beta`. Reutiliza el `Dockerfile` existente (Node 22, proceso no root), sin reconstruir la imagen del Docker anterior.

| Componente | Configuración |
| --- | --- |
| API | `http://localhost:3002` |
| phpMyAdmin | `http://localhost:8082`, conectado solo a la base beta |
| MariaDB | Imagen `mariadb:12.2.2`, base `hcv_docker_beta_test`, sin puerto publicado en Windows |
| Cuenta SQL de ejecución | `hcv_beta_app@%`, permisos por tabla, sin DDL ni administración global |
| Base persistente | Volumen nuevo `hcv_docker_beta_test_database_data` |
| Documentos persistentes | Volumen nuevo `hcv_docker_beta_test_document_files`, montado en `/var/lib/hcv-files` |
| Administrador web | `beta_admin` por defecto, solo rol `administrador` |

No monta el datadir de Windows, el almacenamiento Windows, los volúmenes anteriores ni el `.env` del proyecto. La red nueva pertenece exclusivamente a este proyecto. El prefijo evita mezclar los recursos del otro entorno; use siempre `-p hcv_docker_beta_test` y el archivo Compose específico. [Referencia de aislamiento por proyecto](https://docs.docker.com/compose/how-tos/project-name/).

Se conservan usuarios/roles/auditoría al restaurar datos clínicos, según el módulo implementado. Aquí no se copian pacientes ni archivos de otra instalación. Los datos de los dos volúmenes nuevos sobreviven al cierre de los contenedores. No confunda persistencia de volúmenes con un respaldo comprobado.

## 1. Ubicarse y comprobar que el nombre está libre

Desde PowerShell:

```powershell
Set-Location -LiteralPath 'C:\Users\Hered\OneDrive\Documentos\trabajo\SISTEMA IMAGENES-2026'
docker version
docker ps -a --filter 'label=com.docker.compose.project=hcv_docker_beta_test'
docker volume ls --filter 'label=com.docker.compose.project=hcv_docker_beta_test'
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3002,8082 }
```

Las dos listas filtradas deben estar vacías para esta primera instalación y los puertos libres. Si ya existen recursos beta o un puerto está ocupado, detenerse e inspeccionarlos; no borrarlos para resolverlo. No se necesitan cambios en el Docker anterior ni en MariaDB de Windows.

## 2. Crear configuración privada

```powershell
$carpetaBeta = 'C:\HCV-Docker-Beta-Test'
$secretos = Join-Path $carpetaBeta 'secrets.env'
if (Test-Path -LiteralPath $secretos) { throw 'El archivo ya existe: revisarlo; no sobrescribirlo.' }
if (-not (Test-Path -LiteralPath $carpetaBeta)) { New-Item -ItemType Directory -Path $carpetaBeta | Out-Null }
Copy-Item -LiteralPath '.\docker\beta-test\configuracion.example' -Destination $secretos
notepad $secretos
```

Reemplazar los tres valores `REEMPLAZAR_...` por contraseñas de al menos 12 caracteres. En este entorno beta se permite usar el mismo valor en los tres campos. Una es SQL administrativa, otra SQL de la API y otra del administrador web; siguen siendo cuentas diferentes aunque sus contraseñas coincidan. Si una contraseña contiene `$` o `#`, encerrarla entre comillas simples en el archivo de Compose. No enviar el archivo al chat ni a Git. Guardarlo con acceso limitado al operador: contiene secretos en texto legible. El ejemplo de límite es 100 MiB por archivo, configurable para este ensayo; no acredita capacidad para DICOM reales ni dimensionamiento hospitalario.

Definir una variable de argumentos para todos los comandos siguientes (solo dura en esta consola):

```powershell
$dc = @('-p', 'hcv_docker_beta_test', '--env-file', $secretos, '-f', '.\compose.beta-test.yaml')
docker compose @dc config --quiet
```

`config --quiet` comprueba la configuración sin mostrar contraseñas. No usar `config` sin esa opción para compartir su salida. En otra terminal, redefinir `$secretos` y `$dc` antes de operar. `--env-file` selecciona el archivo beta, sin editar ni depender del `.env` real del proyecto.

## 3. Construir únicamente la nueva imagen de API

```powershell
docker compose @dc build api
docker compose @dc run --rm --no-deps inicializar --validar-configuracion
```

El primer comando instala en la imagen las dependencias ya declaradas con `npm ci --omit=dev` y copia `src/` y `public/` actuales; no instala dependencias nuevas en Windows. No modifica `hcv-docker-test-api:latest`. El segundo ejecuta solo la validación de configuración, sin abrir una conexión SQL. Debe finalizar con código cero. Todavía no se iniciaron la API ni MariaDB beta.

## 4. Iniciar solo la base nueva

```powershell
docker compose @dc up -d --wait db
docker compose @dc ps
```

Docker crea el volumen de datos nuevo y MariaDB inicializa allí una base vacía. No se publican los puertos 3306 ni 3317 en Windows. Esperar a que `db` esté saludable antes de continuar. Los estados pueden inspeccionarse con `docker compose @dc logs --tail 80 db`; no compartir logs completos sin revisar datos sensibles.

## 5. Aplicar 001–008 y crear el administrador de pruebas

**Solo para esta instalación vacía y una única vez:**

```powershell
docker compose @dc run --rm inicializar
```

El servicio temporal `inicializar` usa su conexión administrativa exclusivamente en la red beta. Verifica versión 12.2.2, base, puerto interno y ausencia de tablas/cuenta de aplicación. Lee los ocho archivos antes de empezar, ejecuta `001` a `008` en orden y registra el resultado de cada archivo. `007` corresponde a usuarios; `008`, a respaldos. No los aplica el arranque habitual de Express.

Después crea `hcv_beta_app` con los privilegios revisados por tabla y un único administrador web usando `hashPassword` del proyecto. La creación del usuario, su rol y la auditoría es transaccional; no crea pacientes, estudios o documentos. Comprueba la conexión de aplicación, sus grants (sin imprimir hashes), lectura y tablas clínicas vacías. No otorga ALL, DDL, FILE, PROCESS ni GRANT OPTION a la API.

No se usa `MARIADB_USER` para aprovisionar la API porque la imagen oficial le concede acceso completo a la base; aquí los grants se definen por tabla. [Referencia oficial MariaDB](https://mariadb.com/docs/server/server-management/automated-mariadb-deployment-and-administration/docker-and-mariadb/mariadb-server-docker-official-image-environment-variables.md).

**Si falla, detenerse.** DDL, creación de cuentas y GRANT no forman una transacción única con los INSERT del administrador. El script informa el paso y código, sin imprimir contraseñas, hashes ni mensajes SQL completos. Inspeccionar el estado antes de continuar; no reejecutar a ciegas, no aplicar reparaciones automáticas ni eliminar volúmenes. El preflight rechaza una base ya poblada. El inicializador no es un actualizador de instalaciones existentes.

## 6. Iniciar y comprobar la aplicación completa

Solo después de que la inicialización termine correctamente:

```powershell
docker compose @dc up -d --wait api phpmyadmin
docker compose @dc ps
Invoke-RestMethod 'http://localhost:3002/api/health/database'
Invoke-RestMethod 'http://localhost:3002/api/health/storage'
Start-Process 'http://localhost:3002'
```

Ingresar con `HCV_BETA_ADMIN_USERNAME` y `HCV_BETA_ADMIN_PASSWORD` del archivo privado. No confundir con las cuentas SQL. En phpMyAdmin puede usarse `hcv_beta_app` para ver su acceso limitado; la cuenta SQL administrativa `root` queda reservada al operador beta. No hay login automático ni credenciales incluidas en la imagen.

La API usa su usuario SQL normal, nunca root. Documentos y base persisten en volúmenes separados y privados; el frontend se sirve desde la imagen recién construida. Cambiar archivos del proyecto no cambia una imagen ya creada: una actualización posterior requiere reconstruir **api de este Compose** y recrear ese servicio, revisando por separado cualquier migración nueva.

## 7. Pruebas manuales recomendadas

1. Crear y editar pacientes/estudios sintéticos; recargar y comprobar persistencia y fecha de estudio inmutable.
2. Cargar PDF, imagen y DICOM sintéticos; descargar y comparar sus bytes; probar reemplazo y eliminación sobre archivos auxiliares.
3. Crear cuentas de los perfiles acordados. Verificar permisos efectivos y cierre de sesiones al cambiar contraseña o desactivar.
4. Crear respaldo en una carpeta **nueva** del equipo del navegador. Comprobar manifiesto, datos y archivos; recordar que estos archivos quedan fuera de los volúmenes Docker.
5. Modificar datos sintéticos y ensayar Agregar/Reemplazar, comprobando relaciones, documentos y conservación de usuarios. Reemplazar afecta solo la base beta si se usa esta URL/configuración.
6. Detener/iniciar el conjunto y comprobar que persisten los datos en los volúmenes beta. Una inconsistencia o fallo debe investigarse; no se considera correcto por tener solo health verde.

Chrome/Edge en `localhost` pueden ofrecer el selector de carpetas. La publicación en la LAN necesita HTTPS confiable para esa funcionalidad y protección del tráfico; este Compose está limitado a loopback y `COOKIE_SECURE=false` para el ensayo local. No es todavía una instalación productiva hospitalaria: faltan TLS, acceso LAN, gestión operativa de secretos, dimensionamiento y pruebas de restauración.

## Cierre y arranques posteriores

```powershell
docker compose @dc stop
docker compose @dc ps -a
```

Detiene limpiamente este proyecto; concede hasta 60 segundos a API/MariaDB para cerrar y conserva los dos volúmenes. No ejecutar `down -v`, `volume rm`, `system prune` ni comandos globales de eliminación.

Para volver a iniciar **después del aprovisionamiento exitoso**, sin repetir migraciones:

```powershell
docker compose @dc up -d --wait db api phpmyadmin
```

Mantener `secrets.env` disponible también para `stop`, porque Compose interpola la configuración antes de actuar. No usar el archivo `compose.test.yaml` para este entorno. Una copia completa operativa debe contemplar MariaDB y documentos; el respaldo clínico del módulo conserva su alcance propio y no sustituye la administración de cuentas/secretos/configuración.

## Verificaciones de preparación

Antes del primer arranque solo puede acreditarse la validación estática del Compose, la sintaxis del inicializador y sus guardas sin conexión. Los comandos de construcción, migraciones, grants efectivos, login y flujos de la interfaz deben ejecutarse y comprobarse por separado. No se presentan como aprobados por la sola existencia de estos archivos.

Preparación verificada el 26/10/2026: Compose resuelto con configuración sintética tanto sin perfiles (tres servicios) como con `preparacion` (incluye el inicializador); nombres de volúmenes propios, puertos loopback y ausencia de puerto de MariaDB publicados comprobados. `node --check` y `git diff --check` aprobados. Diez comprobaciones del modo de validación aprobaron aceptación/rechazo de configuración usando dobles que impiden abrir SQL; no prueban el aprovisionamiento contra MariaDB. La suite general dio 101 pruebas: 98 aprobadas, 0 fallidas y 3 omitidas, sin leer `.env` ni habilitar las dos integraciones MariaDB optativas. La tercera omisión es el enlace simbólico restringido por Windows.

No se construyeron imágenes, iniciaron contenedores, crearon volúmenes ni ejecutaron migraciones durante esta preparación. La imagen beta, la aplicación de 001–008, las cuentas nuevas y el funcionamiento integrado siguen pendientes de ejecutar los pasos anteriores.

El 27/10/2026 se retiró, por decisión del usuario, la exigencia de contraseñas diferentes para este entorno beta. Se mantienen los tres campos y cuentas, el mínimo de 12 caracteres y las demás guardas. Se aprobaron 12 comprobaciones sin conexión SQL, incluidos valores iguales, parcialmente iguales y distintos; sintaxis y diff correctos. La suite conservó 98 aprobadas, 0 fallidas y 3 omitidas. Este ajuste no modificó secretos, cuentas, imágenes ni bases existentes. El inicializador se monta desde el proyecto: repetir su validación toma el cambio sin reconstruir la imagen.
