# Catálogo de requisitos para la trazabilidad de HCV

Fecha de consolidación: 16 de noviembre de 2026. Versión documental: 1.

Este catálogo asigna identificadores a necesidades y funciones ya descritas en las fuentes del proyecto. RN y RF son códigos nuevos de organización documental; no acreditan un relevamiento previo ni aprobación institucional. No agregan reglas clínicas, permisos, validaciones o funciones nuevas. Las condiciones todavía no definidas permanecen pendientes.

Fuentes: [casos de uso](Casos%20de%20uso%20HCV.docx), [plan manual](Plan%20de%20pruebas%20manuales%20QC%20HCV.docx), [README](../README.md), [API REST](api-rest-hcv.md) y [OpenAPI](openapi-hcv.yaml). El índice común es la [matriz RTM](matriz-trazabilidad-hcv.md).

## Convenciones

- RN identifica la necesidad que organiza una familia de funciones; RF identifica su comportamiento funcional documentado; RNF identifica una condición transversal de evaluación.
- Se conservan todos los identificadores HU y TC. Las HU existentes están redactadas como casos de uso; no se afirma que cumplan automáticamente INVEST.
- Los RF se consolidan desde las HU y contratos actuales. Los RNF originados solo en casos de prueba se declaran exploratorios o pendientes de validación: un caso generado no reemplaza la aprobación del requisito.
- Completa en el documento de casos de uso describe el alcance identificado. El resultado de QC requiere una ejecución y evidencia vinculadas a una versión.
- HU-27 y HU-29 se conservan y comparten RF-5.3 por su solapamiento. HU-28 se separa en RF-6.1 y RF-6.2 para distinguir respaldo y restauración.

## Necesidades de negocio consolidadas

| ID | Necesidad | Propósito | Fuente |
| --- | --- | --- | --- |
| RN-001 | Acceso autorizado | Permitir que las personas identificadas utilicen las funciones habilitadas y finalicen su sesión. | HU-01 a HU-04; README, autenticación. |
| RN-002 | Gestión de pacientes | Organizar y consultar las fichas de pacientes y sus modificaciones autorizadas. | HU-05 a HU-09. |
| RN-003 | Gestión de estudios | Organizar los estudios asociados a cada paciente y consultar su información. | HU-10 a HU-13. |
| RN-004 | Documentos clínicos | Asociar, conservar y consultar documentos clínicos mediante acceso autorizado. | HU-18 a HU-23; README, almacenamiento privado. |
| RN-005 | Administración de cuentas | Disponer de mecanismos de administración de cuentas, perfiles y credenciales. | HU-25 a HU-27 y HU-29. |
| RN-006 | Respaldo y restauración | Permitir la copia y recuperación del conjunto clínico según los modos documentados. | HU-28; docs/respaldo-restauracion.md. |
| RN-007 | Operación del sistema | Contar con diagnóstico técnico y condiciones de acceso y operación verificables. | HU-24; README, requisitos de despliegue; casos transversales del plan manual. |
| RN-008 | Reportes pendientes | Mantener identificado el objetivo de reportes cuyo alcance todavía no se definió. | HU-30; no se especifican nuevos informes, filtros ni formatos. |

## Requisitos funcionales y condiciones transversales

### RF-1.1 Iniciar sesión

Revisión de claridad, alcance, actores y criterios del ciclo de acceso: [registro U2-QC-001](qc-unidades-1-2-aplicacion.md#4-unidad-2-revisión-formal-del-alcance-seleccionado). Complementa RF-1.1–1.3 y las HU fuente sin atribuir una validación institucional.

**Necesidad:** RN-001. **Origen HU:** HU-01.

Solicitar usuario y contraseña; validar formato, cuenta activa y credenciales. Crear la sesión y permitir nuevos intentos sin bloqueo automático por fallos.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-01; API REST vigente.

**Componentes relacionados:** [auth-service.js](../src/services/auth-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-001–004, TC-006, TC-016, TC-020–021, TC-023. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).

### RF-1.2 Consultar y restaurar sesión

**Necesidad:** RN-001. **Origen HU:** HU-02.

Restaurar una sesión vigente al cargar la interfaz; exigir autenticación cuando la cookie no sea válida o la sesión haya vencido.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-02; API REST vigente.

**Componentes relacionados:** [require-auth.js](../src/middleware/require-auth.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-003, TC-017, TC-022. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).

### RF-1.3 Cerrar sesión

**Necesidad:** RN-001. **Origen HU:** HU-03.

Invalidar la sesión actual, expirar su cookie y volver al ingreso; considerar la limpieza de datos de interfaz descrita en la API.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-03; API REST vigente.

**Componentes relacionados:** [auth-service.js](../src/services/auth-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-018–020. La fecha de ejecución no modifica este vínculo funcional.

### RF-1.4 Autorizar por permiso

**Necesidad:** RN-001. **Origen HU:** HU-04.

Comprobar sesión y permiso antes de ejecutar la operación. Conservar pendiente el alcance clínico por servicio declarado en el README.

**Alcance y definición:** Permisos técnicos descritos; alcance por servicio pendiente.

**Fuente:** Casos de uso HCV.docx: HU-04; API REST vigente.

**Componentes relacionados:** [require-auth.js](../src/middleware/require-auth.js), [require-permission.js](../src/middleware/require-permission.js).

**Casos vinculados:** TC-110–115. La fecha de ejecución no modifica este vínculo funcional.

### RF-2.1 Buscar y listar pacientes

**Necesidad:** RN-002. **Origen HU:** HU-05.

Buscar por nombre o DNI y presentar los resultados paginados según el contrato actual.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-05; API REST vigente.

**Componentes relacionados:** [patient-service.js](../src/services/patient-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-048–052. La fecha de ejecución no modifica este vínculo funcional.

### RF-2.2 Consultar ficha

**Necesidad:** RN-002. **Origen HU:** HU-06.

Consultar la ficha del paciente seleccionado y su actividad de estudios sin mezclar identidades.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-06; API REST vigente.

**Componentes relacionados:** [patient-service.js](../src/services/patient-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-053, TC-059. La fecha de ejecución no modifica este vínculo funcional.

### RF-2.3 Crear paciente

**Necesidad:** RN-002. **Origen HU:** HU-07.

Registrar el nombre requerido y los campos opcionales con las validaciones técnicas actuales. No atribuir una política clínica de DNI o duplicados todavía pendiente.

**Alcance y definición:** Contrato técnico descrito; reglas clínicas pendientes.

**Fuente:** Casos de uso HCV.docx: HU-07; API REST vigente.

**Componentes relacionados:** [patient-service.js](../src/services/patient-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-005, TC-024–047, TC-055 y TC-192–193.

### RF-2.4 Modificar paciente

**Necesidad:** RN-002. **Origen HU:** HU-08.

Actualizar la ficha con control de versión y coordinar los cambios de etiquetas documentales cuando corresponda.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-08; API REST vigente.

**Componentes relacionados:** [patient-service.js](../src/services/patient-service.js), [document-operations.js](../src/services/document-operations.js).

**Casos vinculados:** TC-054–058. La fecha de ejecución no modifica este vínculo funcional.

### RF-2.5 Eliminar paciente

**Necesidad:** RN-002. **Origen HU:** HU-09.

La eliminación no está disponible: el control permanece deshabilitado y no existe endpoint DELETE. La política de conservación está pendiente.

**Alcance y definición:** Parcial; TC-060 solo verifica el control deshabilitado.

**Fuente:** Casos de uso HCV.docx: HU-09; API REST vigente.

**Componentes relacionados:** [app.js](../public/js/app.js), [index.html](../public/index.html).

**Casos vinculados:** TC-060. La fecha de ejecución no modifica este vínculo funcional.

### RF-3.1 Listar estudios

**Necesidad:** RN-003. **Origen HU:** HU-10.

Consultar los estudios del paciente seleccionado y su orden de presentación documentado.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-10; API REST vigente.

**Componentes relacionados:** [study-service.js](../src/services/study-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-071–073. La fecha de ejecución no modifica este vínculo funcional.

### RF-3.2 Crear estudio

**Necesidad:** RN-003. **Origen HU:** HU-11.

Crear un estudio asociado al paciente y gestionar las cargas admitidas según las condiciones del contrato vigente.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-11; API REST vigente.

**Componentes relacionados:** [study-service.js](../src/services/study-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-061–065, TC-069, TC-074–076. La fecha de ejecución no modifica este vínculo funcional.

### RF-3.3 Consultar estudio

**Necesidad:** RN-003. **Origen HU:** HU-12.

Consultar la información de un estudio existente con los controles de sesión y permiso correspondientes.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-12; API REST vigente.

**Componentes relacionados:** [study-service.js](../src/services/study-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-187. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).

### RF-3.4 Modificar estudio

**Necesidad:** RN-003. **Origen HU:** HU-13.

Actualizar campos editables con control de versión y conservar inmutable la fecha del estudio.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-13; API REST vigente.

**Componentes relacionados:** [study-service.js](../src/services/study-service.js), [document-operations.js](../src/services/document-operations.js).

**Casos vinculados:** TC-066–070. La fecha de ejecución no modifica este vínculo funcional.

### RF-4.1 Listar documentos

**Necesidad:** RN-004. **Origen HU:** HU-18.

Listar los documentos asociados al estudio con acceso autorizado.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-18; API REST vigente.

**Componentes relacionados:** [document-service.js](../src/services/document-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-188. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).

### RF-4.2 Cargar documento

**Necesidad:** RN-004. **Origen HU:** HU-19.

Recibir documentos bajo los formatos y límites configurados, asociarlos al paciente y estudio y conservarlos en almacenamiento privado.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-19; API REST vigente.

**Componentes relacionados:** [document-service.js](../src/services/document-service.js), [document-storage.js](../src/services/document-storage.js).

**Casos vinculados:** TC-077–085, TC-091–101, TC-107, TC-109. La fecha de ejecución no modifica este vínculo funcional.

### RF-4.3 Visualizar o descargar

**Necesidad:** RN-004. **Origen HU:** HU-20.

Visualizar los formatos admitidos o descargar el archivo autorizado; no atribuir un visor ni validación semántica DICOM al sistema.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-20; API REST vigente.

**Componentes relacionados:** [document-service.js](../src/services/document-service.js), [app.js](../public/js/app.js).

**Casos vinculados:** TC-086–090, TC-108, TC-178. La fecha de ejecución no modifica este vínculo funcional.

### RF-4.4 Reemplazar documento

**Necesidad:** RN-004. **Origen HU:** HU-21.

Reemplazar un archivo conservando su identidad y asociación, con coordinación transaccional y journal.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-21; API REST vigente.

**Componentes relacionados:** [document-service.js](../src/services/document-service.js), [document-operations.js](../src/services/document-operations.js).

**Casos vinculados:** TC-102–104. La fecha de ejecución no modifica este vínculo funcional.

### RF-4.5 Eliminar documento

**Necesidad:** RN-004. **Origen HU:** HU-22.

Eliminar el documento mediante la operación autorizada y sus mecanismos de confirmación, auditoría y coordinación física.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-22; API REST vigente.

**Componentes relacionados:** [document-service.js](../src/services/document-service.js), [document-operations.js](../src/services/document-operations.js).

**Casos vinculados:** TC-105–106. La fecha de ejecución no modifica este vínculo funcional.

### RF-4.6 Recuperar journal

**Necesidad:** RN-004. **Origen HU:** HU-23.

Recuperar operaciones documentales pendientes al iniciar la API y mantener las restricciones de almacenamiento que corresponda.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-23; API REST vigente.

**Componentes relacionados:** [document-operations.js](../src/services/document-operations.js), [storage-readiness.js](../src/services/storage-readiness.js).

**Casos vinculados:** TC-189. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).

### RF-5.1 Crear administrador inicial

**Necesidad:** RN-005. **Origen HU:** HU-25.

Crear el primer administrador mediante la CLI y sus precondiciones documentadas; no es un alta desde el navegador.

**Alcance y definición:** CLI técnica; no se ejecuta durante esta tarea.

**Fuente:** Casos de uso HCV.docx, HU-25; README, bootstrap del primer administrador; sql/README.md.

**Componentes relacionados:** [bootstrap-admin.js](../src/cli/bootstrap-admin.js).

**Casos vinculados:** TC-190. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).

### RF-5.2 Restablecer contraseña local

**Necesidad:** RN-005. **Origen HU:** HU-26.

Restablecer mediante CLI la contraseña de una cuenta existente y revocar sus sesiones con auditoría.

**Alcance y definición:** CLI técnica; distinta del cambio web de HU-29.

**Fuente:** Casos de uso HCV.docx, HU-26; README y src/cli/reset-password.js.

**Componentes relacionados:** [reset-password.js](../src/cli/reset-password.js).

**Casos vinculados:** TC-191. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).

### RF-5.3 Administrar cuentas y perfiles

**Necesidad:** RN-005. **Origen HU:** HU-27, HU-29.

Listar, crear y editar cuentas; asignar perfiles generales y gestionar activación y contraseñas con las protecciones actuales. No incluye editor de permisos ni recuperación autoservicio.

**Alcance y definición:** Alcance web descrito; HU-27 y HU-29 se consolidan en este RF.

**Fuente:** Casos de uso HCV.docx: HU-27, HU-29; API REST vigente.

**Componentes relacionados:** [user-service.js](../src/services/user-service.js), [user-management.js](../public/js/user-management.js).

**Casos vinculados:** TC-114, TC-116–146 y TC-194–198.

### RF-6.1 Crear respaldo clínico

**Necesidad:** RN-006. **Origen HU:** HU-28.

Crear una carpeta con datos clínicos, documentos y manifiesto final, comprobando las condiciones de permiso, almacenamiento y navegador.

**Alcance y definición:** Requiere configuración y validación de la instalación.

**Fuente:** Casos de uso HCV.docx: HU-28; API REST vigente.

**Componentes relacionados:** [backup-service.js](../src/services/backup-service.js), [backups.js](../public/js/backups.js).

**Casos vinculados:** TC-147–154, TC-170–171, TC-177. La fecha de ejecución no modifica este vínculo funcional.

### RF-6.2 Validar y restaurar respaldo

**Necesidad:** RN-006. **Origen HU:** HU-28.

Validar la carpeta y restaurar en modo Agregar o Reemplazar según el contrato actual, preservando cuentas, permisos y auditoría histórica.

**Alcance y definición:** Requiere entorno aislado; no se restauran datos en esta tarea.

**Fuente:** Casos de uso HCV.docx: HU-28; API REST vigente.

**Componentes relacionados:** [backup-service.js](../src/services/backup-service.js), [backups.js](../public/js/backups.js).

**Casos vinculados:** TC-155–171. La fecha de ejecución no modifica este vínculo funcional.

### RF-7.1 Consultar salud técnica

**Necesidad:** RN-007. **Origen HU:** HU-24.

Exponer el diagnóstico de base de datos y almacenamiento conforme a los endpoints documentados.

**Alcance y definición:** Alcance descrito en la fuente.

**Fuente:** Casos de uso HCV.docx: HU-24; API REST vigente.

**Componentes relacionados:** [health-service.js](../src/services/health-service.js), [health.js](../src/routes/health.js).

**Casos vinculados:** TC-186. Resultado y evidencia en la [matriz](matriz-trazabilidad-hcv.md).

### RF-8.1 Reportes por definir

**Necesidad:** RN-008. **Origen HU:** HU-30.

Mantener visible la reserva funcional; no afirmar generación, filtros o exportaciones que todavía no están definidos.

**Alcance y definición:** Pendiente; TC-182 solo verifica el control reservado.

**Fuente:** Casos de uso HCV.docx: HU-30; API REST vigente.

**Componentes relacionados:** [index.html](../public/index.html).

**Casos vinculados:** TC-182. La fecha de ejecución no modifica este vínculo funcional.

### RNF-01 Acceso LAN mediante HTTPS

**Necesidad:** RN-007. **Origen HU:** sin HU dedicada.

Comprobar nombre de acceso, confianza y vigencia del certificado, tratamiento de HTTP y funcionamiento seguro de enlaces y respaldos. Nombre y CA concretos dependen del despliegue.

**Alcance y definición:** Requisito de despliegue; instalación no evaluada aquí.

**Fuente:** README, requisitos para producción y acceso LAN; TC-172 a TC-178.

**Componentes relacionados:** [README.md](../README.md), [backups.js](../public/js/backups.js).

**Casos vinculados:** TC-172–178. La fecha de ejecución no modifica este vínculo funcional.

### RNF-02 Uso con teclado y ampliación

**Necesidad:** RN-007. **Origen HU:** sin HU dedicada.

Registrar barreras en navegación por teclado y ampliación de pantalla. La aceptación formal y los umbrales de accesibilidad están pendientes de acordar.

**Alcance y definición:** Criterio exploratorio pendiente de validación.

**Fuente:** Plan manual: TC-179 y TC-180. No se atribuye conformidad con un estándar de accesibilidad.

**Componentes relacionados:** [index.html](../public/index.html), [styles.css](../public/styles.css), [app.js](../public/js/app.js).

**Casos vinculados:** TC-179–180. La fecha de ejecución no modifica este vínculo funcional.

### RNF-03 Presentación segura de texto

**Necesidad:** RN-007. **Origen HU:** sin HU dedicada.

Comprobar que los caracteres ingresados se presenten como texto sin interpretar etiquetas en el recorrido del caso.

**Alcance y definición:** Control técnico a comprobar; no es un pentest completo.

**Fuente:** Plan manual: TC-181; componentes de interfaz existentes.

**Componentes relacionados:** [app.js](../public/js/app.js), [user-management.js](../public/js/user-management.js).

**Casos vinculados:** TC-181. La fecha de ejecución no modifica este vínculo funcional.

### RNF-04 Manejo de indisponibilidad

**Necesidad:** RN-007. **Origen HU:** sin HU dedicada.

Comprobar mensajes de fallo y recuperación del recorrido previsto sin éxito falso ni detalles sensibles. Las interrupciones requieren preparación del entorno.

**Alcance y definición:** Criterios por precisar según entorno y operación.

**Fuente:** HU-02, excepciones; HU-24; TC-183 y TC-185.

**Componentes relacionados:** [app.js](../public/js/app.js), [health-service.js](../src/services/health-service.js).

**Casos vinculados:** TC-183, TC-185. La fecha de ejecución no modifica este vínculo funcional.

### RNF-05 Recorrido en Chrome y Edge

**Necesidad:** RN-007. **Origen HU:** sin HU dedicada.

Comparar el recorrido básico en ambos navegadores. Versiones y alcance definitivo de compatibilidad deben registrarse en el ciclo de ejecución.

**Alcance y definición:** Alcance de compatibilidad pendiente de acordar.

**Fuente:** Plan manual: TC-184; README, compatibilidad del selector de respaldos.

**Componentes relacionados:** [app.js](../public/js/app.js), [backups.js](../public/js/backups.js).

**Casos vinculados:** TC-184. La fecha de ejecución no modifica este vínculo funcional.

## Decisiones pendientes

El alcance clínico por servicio, política institucional de contraseñas, DNI/duplicados, retención, tipos definitivos de reportes, umbrales de accesibilidad y alcance de compatibilidad no se resuelven por asignarles un código. Se registrarán las decisiones del responsable funcional y se revisarán los casos afectados antes de emitir una aceptación funcional o institucional.
