# Hallazgos de la campaña de la matriz HCV

Registro separado para preparar posteriormente el documento de hallazgos. No integra el trabajo final de QC.

## QC-MAT-001 Archivo del tamaño máximo exacto rechazado

Un PDF de exactamente MAX_FILE_SIZE_BYTES recibía HTTP 413; el archivo de un byte menos se admitía.

Se ajustó el límite de Busboy y se mantiene la comprobación de bytes para rechazar únicamente los excesos.

**Caso:** TC-097. **Estado:** corregido y verificado en Docker beta.

[Fallo](../reports/qc/matriz-ejecucion-20261117/MATRIZ-20261117-113027-api.json) · [Repetición aprobada](../reports/qc/matriz-ejecucion-20261117/MATRIZ-20261117-113613-retest.json)

## QC-MAT-002 Nombre de archivo con tilde alterado

El nombre multipart UTF-8 Informe clínico QC.pdf se almacenaba con caracteres alterados. Los bytes del contenido no eran el origen del fallo.

Se configuró la lectura UTF-8 de los parámetros multipart.

**Caso:** TC-100. **Estado:** corregido y verificado en Docker beta.

[Fallo](../reports/qc/matriz-ejecucion-20261117/MATRIZ-20261117-113027-api.json) · [Repetición aprobada](../reports/qc/matriz-ejecucion-20261117/MATRIZ-20261117-113613-retest.json)

## QC-MAT-003 Cambio de tipo de estudio bloqueado por su carpeta

Una carga guardaba la carpeta con la representación textual de Date; al editar el tipo se buscaba una fecha ISO y se devolvía DOCUMENT_RENAME_SOURCE_MISMATCH.

La consulta de carga devuelve fecha ISO. El renombrado conserva como origen una carpeta heredada cuando todos sus archivos corresponden al mismo paciente y estudio, manteniendo el journal y la verificación de integridad.

**Caso:** TC-068. **Estado:** corregido y verificado en Docker beta.

[Fallo](../reports/qc/matriz-ejecucion-20261117/MATRIZ-20261117-113027-api.json) · [Repetición aprobada](../reports/qc/matriz-ejecucion-20261117/MATRIZ-20261117-113613-retest.json)

## Ajustes del guion

- Se corrigió /api/users a /api/usuarios. Los 404 producidos por esa ruta del guion no se atribuyen al producto.
- Se ajustó el código esperado del cambio de contraseña a HTTP 204 y el tipo del identificador de usuario.
- La identidad visible se comparó con displayName; username se verificó por API.
- Se esperó al fin de la carga de imágenes y a la entrada de las vistas previas diferidas en pantalla.
- El botón Reportes se evaluó como control reservado según el caso original; no se exigió que estuviera deshabilitado.
- Se corrigió la forma de sustituir el selector para que AbortError y NotAllowedError se produjeran durante la acción del usuario.
- El bootstrap requiere una cuenta SQL temporal con sus permisos específicos; la cuenta SQL normal de la API no tiene todos esos permisos.
