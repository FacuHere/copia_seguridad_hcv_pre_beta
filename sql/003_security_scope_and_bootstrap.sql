-- Estructura de permisos por servicio, limitación de intentos y rol técnico inicial.
-- Aplicar después de 001_initial_schema.sql y 002_auth_sessions.sql.

CREATE TABLE IF NOT EXISTS role_service_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, service_id, permission_id),
  KEY idx_role_service_permissions_service (service_id, permission_id),
  CONSTRAINT fk_role_service_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_role_service_permissions_service FOREIGN KEY (service_id) REFERENCES services (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_role_service_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  client_ip VARCHAR(45) NOT NULL,
  window_started_at DATETIME NOT NULL,
  failure_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  blocked_until DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (client_ip),
  KEY idx_auth_login_attempts_window (window_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE studies
  ADD UNIQUE KEY uq_studies_id_patient (id, patient_id);

ALTER TABLE documents
  ADD CONSTRAINT fk_documents_study_patient
  FOREIGN KEY (study_id, patient_id) REFERENCES studies (id, patient_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

INSERT INTO roles (code, name, description)
VALUES ('system_admin', 'Administrador técnico del sistema', 'Administración técnica de usuarios y roles; no incluye permisos clínicos.')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

INSERT INTO permissions (code, description)
VALUES
  ('users.manage', 'Administrar cuentas de usuario.'),
  ('roles.manage', 'Administrar roles y asignaciones de permisos.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('users.manage', 'roles.manage')
WHERE r.code = 'system_admin'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);
