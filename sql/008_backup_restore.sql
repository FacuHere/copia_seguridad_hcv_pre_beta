-- Permiso y journal para respaldar/restaurar datos clínicos y archivos.
-- Aplicar manualmente después de 006_documents_storage_lifecycle.sql.
-- Esta migración no modifica usuarios, datos clínicos ni documentos existentes.

INSERT IGNORE INTO permissions (code, description)
VALUES ('backups.manage', 'Crear respaldos clínicos y restaurar datos desde una carpeta validada.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'backups.manage'
WHERE r.code = 'administrador';

CREATE TABLE IF NOT EXISTS backup_restore_operations (
  operation_id CHAR(36) NOT NULL,
  operation_mode ENUM('backup', 'agregar', 'reemplazar') NOT NULL,
  operation_state ENUM('recibiendo', 'aplicando', 'limpieza_pendiente', 'completado', 'fallido', 'requiere_atencion') NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  expected_patients INT UNSIGNED NOT NULL DEFAULT 0,
  expected_studies INT UNSIGNED NOT NULL DEFAULT 0,
  expected_documents INT UNSIGNED NOT NULL DEFAULT 0,
  failure_code VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_id),
  KEY idx_backup_restore_state (operation_state, updated_at),
  KEY idx_backup_restore_actor (actor_user_id, created_at),
  CONSTRAINT fk_backup_restore_actor FOREIGN KEY (actor_user_id) REFERENCES app_users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_restore_records (
  operation_id CHAR(36) NOT NULL,
  record_type ENUM('patient', 'study', 'document') NOT NULL,
  source_id VARCHAR(32) NOT NULL,
  record_json LONGTEXT NOT NULL,
  PRIMARY KEY (operation_id, record_type, source_id),
  CONSTRAINT fk_backup_restore_record_operation FOREIGN KEY (operation_id) REFERENCES backup_restore_operations (operation_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_restore_files (
  operation_id CHAR(36) NOT NULL,
  file_role ENUM('entrante', 'anterior') NOT NULL,
  source_document_id VARCHAR(32) NOT NULL,
  file_key VARCHAR(255) NOT NULL,
  target_key VARCHAR(255) NULL,
  original_name VARCHAR(255) NULL,
  mime_type VARCHAR(160) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  sha256 CHAR(64) NULL,
  file_state ENUM('preparado', 'instalado', 'pendiente_limpieza', 'eliminado') NOT NULL DEFAULT 'preparado',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_id, file_role, source_document_id),
  KEY idx_backup_restore_file_state (operation_id, file_state),
  CONSTRAINT fk_backup_restore_file_operation FOREIGN KEY (operation_id) REFERENCES backup_restore_operations (operation_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
