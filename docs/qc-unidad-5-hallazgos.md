## Clasificación de los hallazgos documentados

Clasificación propuesta el 16/11/2026. Severidad y prioridad corresponden al contexto de cada fuente, no a una lista de defectos actualmente abiertos.

| ID | Hallazgo | Tipo | Severidad | Prioridad propuesta | Situación acreditada |
| --- | --- | --- | --- | --- | --- |
| HCV-01 | Restauración bloqueada al leer metadatos raíz | producto | S2 | P1 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-02 | Respaldo bloqueado por referencias residuales del journal | producto | S2 | P1 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-03 | Archivo temporal de eliminación sin limpiar hasta reiniciar | producto | S2 | P2 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-04 | Limpieza postcommit confundida con restauración no confirmada | producto | S2 | P1 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-05 | Cancelación podía abandonar archivos y detalles de recuperación | producto | S2 | P2 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-06 | Lotes de restauración válidos superaban el límite JSON | producto | S2 | P1 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-07 | Reentrada del diálogo permitía cambiar el origen de una operación | producto | S2 | P2 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-08 | Vista clínica conservaba identificadores después de restaurar | producto | S2 | P1 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-09 | Datos y roles anteriores conservados al cambiar de sesión | producto | S1 | P1 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-10 | DOCX válidos rechazados por el orden de sus elementos | producto | S3 | P2 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| HCV-11 | Bloqueo histórico se activaba un intento antes del umbral | producto | S3 | P2 | corregido históricamente; expectativa de bloqueo retirada después |
| HCV-12 | Restablecimiento por CLI no revocaba sesiones previas | producto | S1 | P1 | corrección documentada; verificación integral del CLI pendiente |
| HCV-13 | Cola de imágenes continuaba con una identidad nueva | producto | S1 | P1 | corregido y verificado según evidencia histórica; no reejecutado en U5 |
| QC-U5-PRO-01 | Otra cuenta rechazada por el bloqueo compartido del login | producto | S2 | P1 | corregido y verificado en Docker beta para TC-015; aceptación hospitalaria pendiente |
| QC-U5-AUT-01 | Selector Usuario resolvía dos campos | automatizacion | S3 | P1 | corregido; el piloto completó posteriormente el escenario |
| QC-U5-AUT-02 | Espera del botón de ingreso después de autenticar | automatizacion | S3 | P1 | corregido; el piloto completó posteriormente el escenario |
| QC-U5-ENV-01 | Docker ejecutaba una imagen anterior al retiro del bloqueo | entorno | S2 | P1 | resuelto: API beta actualizada y versión registrada |
| QC-U5-DOC-01 | Diez resultados manuales contradictorios | documentacion | S3 | P1 | por conciliar con el autor o evidencia verificable |
| QC-U5-DOC-02 | Lista de actores de HU-01 incompleta frente a los perfiles actuales | documentacion | S3 | P2 | ajuste editorial pendiente |
| QC-U5-DIS-01 | TC-126/127 pueden interferir por el usuario recortado | diseno | S3 | P2 | pendiente de ajuste de preparación |
| QC-U5-DIS-02 | Siete puntos BVA sin caso dedicado en el alcance elegido | diseno | S3 | P2 | pendiente de formalizar casos |
| QC-U5-ENV-02 | Almacenamiento privado sin configuración en la API 3306/3000 | entorno | S2 | P1 | resuelto según continuación histórica: almacenamiento ready |
| QC-U5-ENV-03 | Credenciales de prueba no disponibles al iniciar el recorrido 3306 | entorno | S3 | P1 | resuelto según continuación con pruebas autenticadas |
| QC-U5-ENV-04 | Preparación SQL de respaldos pendiente en la instalación 3306 | entorno | S2 | P1 | resuelto históricamente con autorización y respaldo final comprobado |

La justificación individual de impacto y urgencia, los RF/TC relacionados, las acciones y las evidencias se conservan en el [registro estructurado](qc/hallazgos-unidad-5-hcv.json).
