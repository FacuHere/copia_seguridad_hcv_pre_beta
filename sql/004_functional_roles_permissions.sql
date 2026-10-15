-- Permisos funcionales para una instalación hospitalaria de servicio único.
-- Aplicar después de 001, 002 y 003. No asigna roles a usuarios.
-- system_admin conserva únicamente los permisos técnicos sembrados en 003.

INSERT IGNORE INTO roles (code, name, description)
VALUES
  ('visualizador', 'Visualizador', 'Consulta pacientes, estudios, documentos e imágenes.'),
  ('administrador', 'Administrador', 'Acceso clínico y administración técnica mediante permisos explícitos.');

INSERT IGNORE INTO permissions (code, description)
VALUES
  ('patients.read', 'Consultar pacientes.'),
  ('patients.create', 'Crear pacientes.'),
  ('patients.update', 'Modificar pacientes.'),
  ('studies.read', 'Consultar estudios.'),
  ('studies.create', 'Crear estudios.'),
  ('studies.update', 'Modificar estudios.'),
  ('documents.read', 'Consultar documentos.'),
  ('documents.download', 'Descargar documentos.'),
  ('images.read', 'Consultar imágenes.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'patients.read',
  'studies.read',
  'documents.read',
  'documents.download',
  'images.read'
)
WHERE r.code = 'visualizador';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'patients.read',
  'patients.create',
  'patients.update',
  'studies.read',
  'studies.create',
  'studies.update',
  'documents.read',
  'documents.download',
  'images.read',
  'users.manage',
  'roles.manage'
)
WHERE r.code = 'administrador';
