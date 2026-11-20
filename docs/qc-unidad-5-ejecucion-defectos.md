# Unidad 5 — Ejecución, Smoke Test y clasificación de hallazgos

Fecha: 16/11/2026. Alcance: Docker beta local y revisión de evidencias existentes. No se modificaron el Word académico, la aplicación, SQL ni configuración real.

## 1. Qué es el Smoke Test

Es una comprobación breve de funciones esenciales para decidir si una versión está en condiciones de recibir las pruebas detalladas del alcance elegido. En HCV se verifica que la instalación responde, permite ingresar, conserva la sesión al recargar, entrega listados autorizados y permite cerrar la sesión.

Docker prepara el entorno; **no es la prueba**. Un contenedor `healthy` puede tener un formulario roto, una respuesta incorrecta o un problema de sesión. Por eso el smoke combina salud técnica con interacciones reales de navegador y API.

La Unidad 5, apartado 2.2, diferencia:

| Actividad | Propósito aplicado a HCV |
| --- | --- |
| Smoke | Revisar amplitud básica de acceso y consulta antes de profundizar en la versión. |
| Sanity | Revisar de forma dirigida un área que acaba de cambiar. |
| Retesting | Repetir el criterio que falló para verificar una corrección concreta, como TC-015. |
| Regresión | Buscar efectos sobre otros comportamientos del alcance después de un cambio. |

Se adoptó un **smoke acotado de acceso y consulta**. No se lo presenta como smoke integral de archivos, restauraciones ni todos los módulos. Su aprobación habilita continuar en ese alcance; no autoriza producción ni demuestra ausencia de defectos.

## 2. Protocolo preparado y ejecutado

Herramienta: [ejecutar_smoke.py](../scripts/qc/ejecutar_smoke.py). Usa Playwright y el navegador ya instalados; no agrega dependencias ni crea cuentas o datos clínicos.

Precondiciones: Docker beta iniciado, `.venv-qc` disponible, Chromium instalado y cuenta A administrativa de pruebas activa con permisos de consulta y administración. Las credenciales se solicitan localmente o se reciben mediante las variables de proceso ya utilizadas por QC; no se guardan en reportes. La URL está fijada a `http://127.0.0.1:3002` y se rechaza otro proyecto o una publicación diferente de la API.

| Control | Resultado esperado | Ejecución registrada |
| --- | --- | --- |
| SMK-01 | API y MariaDB del proyecto beta iniciadas, saludables e identificadas. | Aprobado. |
| SMK-02 | Health de base `200/connected` y almacenamiento `200/ready`. | Aprobado. |
| SMK-03 | Formulario visible; aplicación oculta; sesión y pacientes responden 401 sin autenticación. | Aprobado. |
| SMK-04 | Ingreso válido, identidad prevista y aplicación visible. | Aprobado. |
| SMK-05 | Recarga conserva sesión e identidad; nombre visible coherente con la cuenta. | Aprobado. |
| SMK-06 | Listado de pacientes con HTTP 200 y estructura de lista; búsqueda visible. | Aprobado. |
| SMK-07 | Control de gestión de usuarios disponible y listado administrativo con HTTP 200. | Aprobado. |
| SMK-08 | Logout 204; formulario visible; recursos protegidos nuevamente en 401. | Aprobado. |
| SMK-09 | Sin excepciones JavaScript no controladas durante el recorrido observado. | Aprobado. |
| SMK-10 | Mismas imágenes, IDs de contenedor e inicio de procesos al finalizar; estado saludable. | Aprobado. |

**Resultado real:** diez controles aprobados. Ejecución `SMOKE-20261116-205907-761026`, iniciada a las 20:59:07, UTC−03. Duración automática registrada: 2,31 segundos. No es un objetivo de rendimiento hospitalario; las duraciones ilustrativas del curso no son un tiempo mínimo que deba consumirse.

Evidencia: [reporte JSON](../reports/qc/unidad5/SMOKE-20261116-205907-761026.json) y [huella SHA-256](../reports/qc/unidad5/SMOKE-20261116-205907-761026.sha256). La sesión de prueba terminó cerrada. Solo se realizaron consultas y las operaciones normales de login/logout, con sus sesiones y auditoría; no hubo altas de pacientes, usuarios, documentos, restauraciones ni migraciones.

| Componente | Imagen registrada al inicio y al final |
| --- | --- |
| API beta | `sha256:cbc73deae761e1ceacdd21a9e0a30c4330337e8f47df94340721ef5983ddc6cb` |
| MariaDB beta | `sha256:6a4c4bbf0447c2247801309513fcc0dd17c3f35390368139ce419387fdd1144d` |

El reporte conserva contexto, navegador, tiempos, estados y huella de la herramienta. No conserva nombres de pacientes, contenido de listados, contraseñas, cookies ni tokens. No se tomaron capturas del listado clínico.

Los diez controles SMK no son diez nuevos TC del Word. Tampoco se mezclan con los JSON de Behave en el generador de documentación viva actual. El registro de Behave sigue mostrando sus cinco ejecuciones de un único TC; este smoke tiene su evidencia separada.

## 3. Cómo utilizarlo antes del siguiente caso

Desde la raíz del proyecto:

```powershell
.\.venv-qc\Scripts\python.exe scripts/qc/ejecutar_smoke.py
if ($LASTEXITCODE -eq 0) {
    .\.venv-qc\Scripts\python.exe scripts/qc/ejecutar_behave.py
}
```

Este procedimiento detiene la continuación si el smoke no aprueba. Es un protocolo local explícito; el ejecutor de Behave por sí solo no invoca el smoke y no se configuró CI.

Los códigos son: `0` aprobado; `1` diferencia observada; `2` impedimento de preparación/contexto. La aprobación exige todos los controles del plan y contexto estable. Si un control falla, las comprobaciones funcionales posteriores no ejecutadas no se convierten en aprobaciones; el cierre de contexto se intenta de todos modos. Un fallo no determina por sí mismo su causa: hay que distinguir producto, datos, entorno y herramienta.

Repetirlo al comenzar un ciclo o al cambiar la versión/configuración que se va a evaluar. El smoke de hoy no se atribuye retroactivamente a las pruebas de octubre ni a las ejecuciones anteriores de TC-015. Tampoco vuelve ejecutados los casos BVA de la Unidad 4.

## 4. Severidad y prioridad son dimensiones diferentes

Se utilizan los niveles del material de cátedra: **S1 Crítica, S2 Alta, S3 Media, S4 Baja; P1 Alta, P2 Media, P3 Baja**. Las definiciones operativas siguientes se adaptan al alcance académico, sin inventar SLA o plazos institucionales.

| Severidad | Criterio de impacto |
| --- | --- |
| S1 Crítica | Compromiso grave de separación de identidades, confidencialidad, autorización o integridad; pérdida grave o indisponibilidad general si estuvieran acreditadas. |
| S2 Alta | Función importante bloqueada o resultado incoherente de una operación relevante, sin evidencia de un compromiso general S1. |
| S3 Media | Afectación acotada, compatibilidad de una clase de entradas, problema de prueba o de documentación dentro de su propio ámbito. |
| S4 Baja | Presentación o detalle menor sin afectación relevante de operaciones o datos. |

| Prioridad propuesta | Criterio de urgencia |
| --- | --- |
| P1 Alta | Atender antes de continuar el recorrido afectado, usarlo en una aceptación o sustentar una conclusión importante. |
| P2 Media | Planificar la corrección/preparación antes de ampliar el área afectada, con alternativa o alcance acotado. |
| P3 Baja | Mejora postergable con fundamento y seguimiento. |

La severidad no se limita a que Node o MariaDB se caigan: una aplicación que responde 200 pero conserva datos de otra identidad puede tener un impacto mayor que un error visible. La prioridad depende del uso, alcance, alternativas y urgencia del proyecto. No se deduce de la facilidad de arreglar el código.

Para los problemas de herramientas, entorno, documentos y diseño se explicita su ámbito: S3 de automatización no significa S3 del producto clínico. Las prioridades son propuestas fundamentadas con la información disponible, no decisiones de un comité hospitalario.

## 5. Hallazgos reales organizados

Se catalogaron **24 registros**: 14 de producto, dos de automatización, cuatro de entorno, dos documentales y dos de diseño. No son 24 defectos actuales del sistema: trece registros de producto proceden del informe del 26/10, con sus correcciones y verificaciones; otros describen impedimentos de preparación o calidad de los artefactos.

La [tabla de hallazgos](qc-unidad-5-hallazgos.md) permite revisarlos sin perder sus IDs. El [registro estructurado](qc/hallazgos-unidad-5-hcv.json) conserva para cada uno: impacto, urgencia, fuentes, fechas, RF/TC, situación y siguiente acción.

Las etiquetas Critical del informe técnico anterior no se copiaron automáticamente a S1. Se revisó el impacto de cada hallazgo con esta escala. La clasificación se realizó ahora; no se inventan reuniones, responsables asignados, tiempos de resolución ni cambios de estado que no se registraron entonces.

Casos que muestran la diferencia:

| Hallazgo | Severidad y razón | Prioridad propuesta y razón | Situación |
| --- | --- | --- | --- |
| HCV-09, datos anteriores al cambiar sesión | S1: separación de identidades y confidencialidad. | P1: resolver antes de permitir uso compartido. | Corregido/verificado según fuente histórica. |
| TC-015, bloqueo de otra cuenta | S2: impide un ingreso válido en una condición concreta; no se demostró caída total del hospital. | P1: afecta el acceso compartido que motivó el requisito. | Corregido/verificado en beta; aceptación hospitalaria pendiente. |
| HCV-10, DOCX válidos rechazados | S3: compatibilidad de una clase de documentos. | P2: planificar su corrección sin omitir integridad. | Corregido/verificado según fuente histórica. |
| Selector ambiguo de Behave | S3 en herramienta: impide preparar el caso, sin acreditar fallo del producto. | P1: debía corregirse para evaluar el piloto. | Corregido; las ejecuciones posteriores completaron el escenario. |
| Pass/PASS junto a No ejecutado | S3 documental: resultado manual no acreditable con esos campos. | P1: resolver antes de usarlo como evidencia de aprobación. | Pendiente de conciliación. |

Dos precauciones de cierre:

- **HCV-11:** el error de umbral fue corregido respecto de la política de bloqueo antigua; esa funcionalidad se retiró después. No se reabre una tarea para volver a bloquear al décimo intento.
- **HCV-12:** hay corrección documentada y verificación del helper de revocación con SQL, pero no ejecución integral del CLI interactivo. Se conserva como resuelto con retesting integral pendiente, no cerrado completamente.

La imagen desactualizada y el bloqueo observado en TC-015 pertenecen al mismo incidente. Se registran causa/contexto y síntoma relacionados, sin sumarlos como dos bloqueos independientes.

## 6. Reporte de defecto aplicado: QC-U5-PRO-01

**Título:** otra cuenta no puede ingresar después de fallos de contraseña desde el mismo navegador.

**Tipo:** producto en una imagen anterior desplegada. **Severidad propuesta:** S2 Alta. **Prioridad propuesta:** P1 Alta. **Trazabilidad:** RN-001 → RF-1.1 → HU-01 → TC-015.

**Precondiciones:** instalación beta identificada, cuentas A y M distintas y activas, navegador de prueba sin sesión. Las dos cuentas se verificaron mediante el ingreso y cierre normales; no se eludió autenticación con SQL.

**Pasos:** 1. Acumular doce intentos incorrectos de M desde el navegador. 2. Intentar inmediatamente un ingreso válido de A. 3. Observar respuesta, acceso e identidad.

**Esperado:** A accede con su identidad; los errores de M no imponen una espera automática.

**Obtenido:** la imagen anterior devolvió `429` para A y `Retry-After: 899`; el escenario falló. No se afirma que todo el hospital se haya bloqueado ni que haya ocurrido daño clínico.

**Contexto:** API beta `http://127.0.0.1:3002`. Imagen fallida `sha256:c58521b74fd11d5193d27f0e5d4382936c30951887c98104c2f662918e63d72e`. El código de trabajo ya había retirado ese control; el contenedor conservaba la implementación anterior.

**Intervención registrada:** reconstrucción y recreación de la API beta con el código actualizado, conservando base y archivos. No se cambió la expectativa ni se borraron contadores para obtener un aprobado.

**Retesting:** [fallo original](../reports/qc/TC-015-20261116-150951.json) y [aprobación posterior](../reports/qc/TC-015-20261116-151206.json). En la imagen actualizada hubo doce rechazos por credenciales (`401`) y posterior ingreso de A (`200`), identidad verificada y ausencia de espera impuesta. Son ejecuciones de un TC, no casos diferentes.

**Estado de gestión:** cerrado para el criterio y entorno beta comprobados; no equivale al cierre de todo RF-1.1, UAT o red hospitalaria. La historia se conserva en [QC del login](qc-login-sin-bloqueo.md).

## 7. Separar estados de ejecución y estados del defecto

| Estado de ejecución | Aplicación a las evidencias |
| --- | --- |
| Pasó | Los controles del smoke actual coinciden con sus expectativas. |
| Falló | TC-015 observó 429 donde debía permitir el ingreso. |
| Bloqueado | La falta de credenciales o configuración impedía preparar un recorrido; se resuelve el impedimento antes de concluir sobre ese comportamiento. |
| No ejecutado | Casos y variantes de U4 diseñados sin ejecución nueva. |
| Omitido | Exclusión deliberada con motivo registrado; no convertir una omisión en aprobación. |

Las respuestas 401 de acceso anónimo son éxitos cuando ese es el resultado esperado. Los primeros errores de Behave se conservaron como `error`/`failed` en sus reportes originales y se analizaron como problemas de automatización; no se reescriben sus estados para adaptarlos a una tabla académica.

La Unidad 5 describe el ciclo de defecto Nuevo → Abierto → En progreso → Resuelto → Cerrado, con Reabierto y Rechazado cuando correspondan. Para las fuentes antiguas se registra la situación acreditada, sin simular la existencia de tickets o transiciones. Resuelto no basta para cerrar si falta retesting; una prueba aprobada tampoco prueba una regresión completa.

En este trabajo no se interpreta falta de especificación como comportamiento aprobado, ni falta de reproducción como evidencia automática de inexistencia. HTTPS hospitalario, reglas clínicas y otros riesgos pendientes no se convirtieron en fallos reproducidos de producción.

## 8. Validación y pendientes

Se ejecutaron siete comprobaciones nuevas de la herramienta de smoke: destino correcto, rechazo de otra instalación o publicación, detección de reinicio aunque conserve imagen y prevención de falsos aprobados con controles faltantes, fallidos o contexto cambiado. Aprobaron las siete; se conserva la [salida completa](../reports/qc/unidad5/herramienta-smoke-20261116.txt). No se contabilizan como unitarias del backend ni como TC nuevos.

No se ejecutó `npm test`: los cambios de esta actividad son herramientas Python y documentación, sin modificación funcional de Node/Express/MariaDB. Se conservan separados los resultados históricos de las suites.

Pendientes concretos: conciliar diez resultados manuales, actualizar actores de HU-01, completar preparación de variantes BVA y sus siete fichas faltantes, verificar el CLI de recuperación de forma integral en un destino aislado autorizado, ampliar los cinco TC de sesiones y acordar UAT/red/HTTPS. No se aplicaron migraciones para cerrar estas tareas.

Fuentes metodológicas: **Unidad 5**, apartados 1.1–1.3, 2.1–2.3, 3, 4, 5.1–5.3 y 6 del HTML aportado. El comité de triage se trata como modelo de decisión; no se presenta como una reunión institucional realizada.
