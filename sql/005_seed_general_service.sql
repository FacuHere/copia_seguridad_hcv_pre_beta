-- Servicio técnico único requerido por studies.service_id.
-- No representa un alcance de autorización y no modifica usuarios ni permisos.
-- Aplicar después de 004_functional_roles_permissions.sql.

INSERT INTO services (code, name, is_active)
VALUES ('GENERAL', 'Servicio general', TRUE)
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  name = VALUES(name),
  is_active = VALUES(is_active);
