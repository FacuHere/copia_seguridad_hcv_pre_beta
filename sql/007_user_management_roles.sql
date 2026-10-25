-- Perfiles generales de Gestión de usuarios. Aplicación MANUAL después de 001–006.
-- No crea usuarios, no asigna roles a cuentas y no modifica system_admin ni servicios.
-- Antes de aplicar: revisar que medico/secretario no tengan concesiones personalizadas.
-- Es aditiva e idempotente; no elimina permisos preexistentes. Revisar la matriz resultante.
START TRANSACTION;

INSERT IGNORE INTO roles (code, name, description) VALUES
  ('medico', 'Médico', 'Gestiona pacientes, estudios y archivos clínicos sin eliminar archivos.'),
  ('secretario', 'Secretario', 'Gestiona pacientes, crea estudios y consulta archivos clínicos.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'patients.read', 'patients.create', 'patients.update',
  'studies.read', 'studies.create', 'studies.update',
  'documents.read', 'documents.download', 'documents.upload', 'documents.replace', 'images.read'
) WHERE r.code = 'medico';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'patients.read', 'patients.create', 'patients.update', 'studies.read', 'studies.create',
  'documents.read', 'documents.download', 'images.read'
) WHERE r.code = 'secretario';

COMMIT;
